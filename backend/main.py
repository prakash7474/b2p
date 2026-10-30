import datetime
import secrets
import threading
from typing import Optional
from fastapi import Body, Depends, HTTPException, Path, Query, status
from pymongo import ReturnDocument
from bson import ObjectId

# Shared app, database, helpers and login checks live in common.py; ml.py adds the model
# routes to the same app. Relative imports when loaded as backend.main (the tests do).
if __package__:
    from .common import *  # noqa: F401,F403
    from .common import (_field, _product_key, _batch_remaining, _batch_volume, _batch_threshold,
                         _sellable_batches, _adjust_inventory, _hours_to_expiry,
                         _find_vendor, _vendor_id_values, _find_login_user, _vendor_for_user,
                         _vendor_status, _locality_tier, _held_batches, _log, _hours_since,
                         _forget_catalog)
    from . import ml  # noqa: F401  registers the model routes
else:
    from common import *  # noqa: F401,F403
    from common import (_field, _product_key, _batch_remaining, _batch_volume, _batch_threshold,
                        _sellable_batches, _adjust_inventory, _hours_to_expiry,
                        _find_vendor, _vendor_id_values, _find_login_user, _vendor_for_user,
                        _vendor_status, _locality_tier, _held_batches, _log, _hours_since,
                        _forget_catalog)
    import ml  # noqa: F401  registers the model routes


def _valid_coordinates(latitude, longitude):
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


def _location_payload(data):
    location = data.get("location") or {}
    latitude = location.get("latitude", data.get("latitude"))
    longitude = location.get("longitude", data.get("longitude"))
    address = location.get("address", data.get("address", ""))
    coords = _valid_coordinates(latitude, longitude)
    if not coords:
        return None
    return {
        "latitude": coords[0],
        "longitude": coords[1],
        "address": address or "",
        "updated_at": datetime.datetime.utcnow().isoformat()
    }


def _save_customer_location(user, location):
    if not location or user.get("role") != "customer":
        return False
    customer_id = user.get("user_id")
    if not customer_id or not ObjectId.is_valid(str(customer_id)):
        return False
    result = COLS["customers"].update_one(
        {"_id": ObjectId(str(customer_id))},
        {"$set": {"location": location}}
    )
    return result.matched_count > 0


def find_nearby_vendors(latitude, longitude, radius_meters=5000, product_id=None):
    """Return active vendors within a radius that have mapped, positive stock."""
    coords = _valid_coordinates(latitude, longitude)
    if not coords:
        raise HTTPException(status_code=400, detail="Valid latitude and longitude are required")
    try:
        radius_meters = float(radius_meters)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="radius_meters must be a number")
    if radius_meters <= 0 or radius_meters > 100000:
        raise HTTPException(status_code=400, detail="radius_meters must be between 1 and 100000")

    pipeline = [
        {"$geoNear": {
            "near": {"type": "Point", "coordinates": [coords[1], coords[0]]},
            "key": "location_geo",
            "distanceField": "distance_meters",
            "maxDistance": radius_meters,
            "spherical": True,
            "query": {"$or": [
                {"status": {"$in": APPROVED_STATUSES}},
                {"verificationStatus": {"$in": APPROVED_STATUSES}}
            ]}
        }}
    ]
    prices = {_product_key(p.get("product_name")): p.get("price") for p in COLS["products"].find()}
    results = []
    for vendor in COLS["vendors"].aggregate(pipeline):
        vendor_ids = _vendor_id_values(vendor)
        if not vendor_ids:
            continue
        # Stock comes from fresh batches, not the inventory rows, so expired kg never shows.
        stock = {}
        for batch in _sellable_batches(vendor):
            if product_id and product_id not in (batch.get("product_id"), batch.get("product_name")):
                continue
            name = _field(batch, "product_name", "product_id", default="Batter")
            item = stock.setdefault(_product_key(name), {
                "product_id": batch.get("product_id") or name, "product_name": name, "quantity": 0.0,
                "price": prices.get(_product_key(name)), "made_at": None})
            item["quantity"] = round(item["quantity"] + _batch_remaining(batch), 2)
            # The freshest batch is what a customer cares about.
            made = _field(batch, "manufactured_at", "mfgTimestamp", "created_at")
            if isinstance(made, datetime.datetime) and (item["made_at"] is None or made > item["made_at"]):
                item["made_at"] = made
        for item in stock.values():
            item["quantity"] = round(max(0.0, item["quantity"] - _reserved_kg(vendor, item["product_name"])), 2)
        stock_items = [item for item in stock.values() if item["quantity"] > 0]
        if not stock_items:
            continue
        vendor["_id"] = str(vendor["_id"])
        vendor["distance_km"] = round(float(vendor.pop("distance_meters", 0)) / 1000, 2)
        vendor["available_inventory"] = stock_items
        results.append(vendor)
    results.sort(key=lambda item: item.get("distance_km", float("inf")))
    return results


def _migrate_vendor_geo_locations():
    """Create a GeoJSON point from the existing nested latitude/longitude fields."""
    for vendor in COLS["vendors"].find({"location_geo": {"$exists": False}}):
        location = vendor.get("location") or {}
        latitude = location.get("latitude", vendor.get("latitude")) if isinstance(location, dict) else None
        longitude = location.get("longitude", vendor.get("longitude")) if isinstance(location, dict) else None
        coords = _valid_coordinates(latitude, longitude)
        if coords:
            COLS["vendors"].update_one(
                {"_id": vendor["_id"]},
                {"$set": {"location_geo": {
                    "type": "Point",
                    "coordinates": [coords[1], coords[0]]
                }}}
            )


def ensure_indexes():
    _migrate_vendor_geo_locations()

    def _create_index(collection, keys, name, **kwargs):
        try:
            collection.create_index(keys, name=name, **kwargs)
        except Exception as e:
            # Ignore conflicts with pre-existing indexes (e.g. auto-named status_1)
            if "already exists" in str(e) or "IndexOptionsConflict" in str(e) or getattr(e, "code", None) == 85:
                print(f"[WARN] Skipping index {name}: {e}")
            else:
                raise

    _create_index(COLS["vendors"], [("location_geo", "2dsphere")], "vendor_location_geo_2dsphere")
    _create_index(COLS["vendors"], [("status", 1)], "vendor_status_idx")
    _create_index(COLS["inventory"], [("vendor_id", 1), ("product_id", 1)], "inventory_vendor_product_idx")
    _create_index(COLS["inventory"], [("product_id", 1), ("quantity", 1)], "inventory_product_quantity_idx")
    _create_index(COLS["products"], [("product_id", 1)], "products_product_id_idx")
    _create_index(COLS["users"], [("email", 1)], "users_email_idx")
    _create_index(COLS["users"], [("phone", 1)], "users_phone_idx")
    _create_index(COLS["restock_requests"], [("vendor_id", 1), ("status", 1)], "restock_vendor_status_idx")


EXPIRY_CHECK_SECONDS = 15 * 60


def _expiry_loop():
    while True:
        try:
            expire_batches()
        except Exception as e:  # a failed run is retried next time; never kill the thread
            print(f"[WARN] Expiry check failed: {e}")
        try:
            ml.refresh_forecasts()
        except Exception as e:
            print(f"[WARN] Forecast refresh failed: {e}")
        threading.Event().wait(EXPIRY_CHECK_SECONDS)


@app.on_event("startup")
def startup_database_setup():
    client.admin.command("ping")
    ensure_indexes()
    # shortcut: one in-process timer; with several backend processes, run expire_batches from one job instead.
    threading.Thread(target=_expiry_loop, daemon=True).start()


@app.get("/")
def home():
    expected_collections = [
        "vendors", "products", "batches", "inventory", "orders",
        "logs", "restock_requests", "predictions",
        "inventory_movement", "weather_forecast", "festival_calendar",
        "feature_snapshots"
    ]
    return {
        "database": "b2p",
        "collections": expected_collections
    }


@app.post("/login")
def login(data: dict = Body(...)):

    login_id = (data.get("login") or "").strip()
    if "@" in login_id:
        login_id = login_id.lower()
    password = data.get("password")

    if not login_id or not password:
        raise HTTPException(status_code=400, detail="Login and password are required")
    user = _find_login_user(login_id)
    if not user or not user.get("password_hash") or not check_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid login")
    if not user.get("is_verified", False):
        raise HTTPException(status_code=403, detail="User is not verified")

    vendor_id = None
    if user.get("role") == "vendor":
        vendor = _vendor_for_user(user)
        if vendor and _vendor_status(vendor) in ("rejected", "suspended"):
            raise HTTPException(status_code=403, detail=f"This shop account was {_vendor_status(vendor)} by the admin")
        vendor_id = (vendor or {}).get("vendor_id") or (str(vendor["_id"]) if vendor else None)

    response = {
        "message": "Login successful",
        "user_id": user.get("user_id"),
        "role": user.get("role"),
        "email": user.get("email"),
        "vendor_id": vendor_id,
        "token": issue_token(user.get("user_id"), user.get("role"), vendor_id),
    }
    location = _location_payload(data)
    if user.get("role") == "customer" and location:
        _save_customer_location(user, location)
        response["nearby_vendors"] = find_nearby_vendors(
            location["latitude"], location["longitude"],
            data.get("radius_meters", 5000), data.get("product_id")
        )
    return response

# List routes return one page, newest first: ?limit= (default 500, at most 1000) and ?skip=.
# shortcut: the apps read only the first page; page with skip once a list outgrows 500.
@app.get("/users")
def get_users(limit: int = Query(500, ge=1, le=1000), skip: int = Query(0, ge=0), user: dict = Depends(current_user)):
    require_role(user)
    users = list(COLS["users"].find({}, {"password_hash": 0}).sort("_id", -1).skip(skip).limit(limit))
    if not users:
        users = list(COLS["vendors"].find().sort("_id", -1).skip(skip).limit(limit))

    for user in users:
        user["_id"] = str(user["_id"])

    return {
        "count": len(users),
        "users": users
    }


@app.get("/logs")
def get_logs(limit: int = Query(500, ge=1, le=1000), skip: int = Query(0, ge=0), user: dict = Depends(current_user)):
    # Admins see every entry; a vendor sees only its own.
    require_role(user, "vendor")
    query = {}
    if user["role"] == "vendor":
        vendor = _find_vendor(user["vendor_id"]) or {}
        query = {"vendor_id": {"$in": _vendor_id_values(vendor) or [user["vendor_id"]]}}
    logs = list(COLS["logs"].find(query).sort("_id", -1).skip(skip).limit(limit))  # newest first

    for log in logs:
        log["_id"] = str(log["_id"])

    return {
        "count": len(logs),
        "logs": logs
    }


@app.get("/vendors")
def get_vendors(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    radius_meters: float = 5000,
    product_id: Optional[str] = None,
    limit: int = Query(500, ge=1, le=1000), skip: int = Query(0, ge=0),
    user: dict = Depends(current_user)
):
    # Existing GET /vendors still returns the full list when coordinates are omitted.
    # Supplying latitude and longitude turns it into a nearby-stock search.
    if latitude is not None or longitude is not None:
        if latitude is None or longitude is None:
            raise HTTPException(status_code=400, detail="Send both latitude and longitude")
        vendors = find_nearby_vendors(latitude, longitude, radius_meters, product_id)
        return {"count": len(vendors), "vendors": vendors}
    require_role(user)
    vendors = list(COLS["vendors"].find().sort("_id", -1).skip(skip).limit(limit))
    for vendor in vendors:
        vendor["_id"] = str(vendor["_id"])
    return {"count": len(vendors), "vendors": vendors}


@app.post("/vendors")
def create_vendor(data: dict = Body(...), user: Optional[dict] = Depends(optional_user)):
    is_admin = bool(user) and user["role"] == "admin"
    vendor_id = data.get("vendor_id")
    email = (data.get("email") or "").strip().lower()
    password = data.get("password")
    phone = data.get("phone", "")

    if vendor_id and COLS["vendors"].find_one({"vendor_id": vendor_id}):
        raise HTTPException(status_code=409, detail="Vendor with this vendor_id already exists")

    if email and _find_login_user(email):
        raise HTTPException(status_code=409, detail="User with this email already exists")

    locality = _locality_tier(data.get("locality_tier", "mixed"))
    if not locality:
        raise HTTPException(status_code=400, detail=f"locality_tier must be one of: {', '.join(LOCALITY_TIERS)}")

    location = data.get("location", {})
    vendor_location = {
        "latitude": location.get("latitude", data.get("latitude")),
        "longitude": location.get("longitude", data.get("longitude")),
        "address": location.get("address", data.get("address", ""))
    }
    vendor_coords = _valid_coordinates(vendor_location["latitude"], vendor_location["longitude"])

    vendor_doc = {
        "vendor_id": vendor_id,
        "shop_name": data.get("shop_name", ""),
        "owner_name": data.get("owner_name", ""),
        "locality_tier": locality,
        # Public sign-ups always wait for admin approval.
        "status": data.get("status", "pending") if is_admin else "pending",
        "location": vendor_location,
        "email": email or "",
        "phone": phone
    }
    if vendor_coords:
        vendor_doc["location_geo"] = {
            "type": "Point",
            "coordinates": [vendor_coords[1], vendor_coords[0]]
        }

    vendor_result = COLS["vendors"].insert_one(vendor_doc)
    vendor_doc["_id"] = str(vendor_result.inserted_id)

    user_result_id = None
    if email and password:
        user_doc = {
            "user_id": vendor_id or vendor_doc["_id"],
            "email": email,
            "phone": phone,
            "password_hash": hash_password(password),
            "role": "vendor",
            "is_verified": data.get("is_verified", True) if is_admin else True
        }
        user_result = COLS["users"].insert_one(user_doc)
        user_result_id = str(user_result.inserted_id)

    COLS["logs"].insert_one({
        "type": "activity",
        "action": "create_vendor",
        "vendor_id": vendor_doc["_id"],
        "user_id": user_result_id,
        "message": f"Registered new vendor {data.get('shop_name', '')}"
    })

    return {
        "message": "Vendor created successfully",
        "vendor": vendor_doc
    }


@app.get("/vendors/{vendor_id}")
def get_vendor(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    query = {
        "vendor_id": vendor_id
    }

    if ObjectId.is_valid(vendor_id):
        query = {
            "$or": [
                {
                    "_id": ObjectId(vendor_id)
                },
                {
                    "vendor_id": vendor_id
                }
            ]
        }

    vendor = COLS["vendors"].find_one(query)

    if vendor is None:
        raise HTTPException(status_code=404, detail="Vendor not found")

    vendor["_id"] = str(vendor["_id"])

    return {
        "vendor": vendor
    }

@app.get("/vendors/{vendor_id}/products")
def get_vendor_products(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    require_vendor(user, vendor_id)
    vid = vendor_id

    if ObjectId.is_valid(vendor_id):
        vendor = COLS["vendors"].find_one({
            "_id": ObjectId(vendor_id)
        })

        if vendor and "vendor_id" in vendor:
            vid = vendor["vendor_id"]

    inventory = list(
        COLS["inventory"].find({
            "$or": [
                {"vendor_id": vid},
                {"vendor_id": vendor_id}
            ]
        })
    )

    product_ids = [
        item.get("product_id")
        for item in inventory
        if item.get("product_id")
    ]

    product_names = [
        item.get("product_name")
        for item in inventory
        if item.get("product_name")
    ]

    query = {
        "$or": []
    }

    if product_ids:
        query["$or"].append({
            "product_id": {
                "$in": product_ids
            }
        })

    if product_names:
        query["$or"].append({
            "product_name": {
                "$in": product_names
            }
        })

    if not query["$or"]:
        products = list(COLS["products"].find())
    else:
        products = list(COLS["products"].find(query))

    for product in products:
        product["_id"] = str(product["_id"])

    return {
        "count": len(products),
        "products": products
    }



@app.get("/vendors/{vendor_id}/inventory")
def get_vendor_inventory(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    require_vendor(user, vendor_id)
    vid = vendor_id

    if ObjectId.is_valid(vendor_id):
        vendor = COLS["vendors"].find_one({
            "_id": ObjectId(vendor_id)
        })

        if vendor and "vendor_id" in vendor:
            vid = vendor["vendor_id"]

    inventory = list(
        COLS["inventory"].find({
            "$or": [
                {
                    "vendor_id": vid
                },
                {
                    "vendor_id": vendor_id
                }
            ]
        })
    )

    for item in inventory:
        item["_id"] = str(item["_id"])

    return {
        "count": len(inventory),
        "inventory": inventory
    }


@app.get("/vendors/{vendor_id}/orders")
def get_vendor_orders(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    require_vendor(user, vendor_id)
    orders = list(
        COLS["orders"].find({
            "$or": [
                {"vendor_id": vendor_id},
                {"vendor_id": str(vendor_id)}
            ],
            "order_type": {"$ne": "restock"},  # restock requests are not sales
        })
    )
    for order in orders:
        order["_id"] = str(order["_id"])
    return {
        "vendor_id": vendor_id,
        "count": len(orders),
        "orders": orders
    }


@app.get("/vendors/{vendor_id}/restock-requests")
def get_vendor_restock_requests(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    require_vendor(user, vendor_id)
    requests = list(
        COLS["restock_requests"].find({
            "$or": [
                {"vendor_id": vendor_id},
                {"vendor_id": str(vendor_id)}
            ]
        })
    )
    for req in requests:
        req["_id"] = str(req["_id"])
    return {
        "vendor_id": vendor_id,
        "count": len(requests),
        "restock_requests": requests
    }


PRODUCT_FIELDS = ("product_name", "category", "unit_type", "shelf_life_fridge_hrs", "shelf_life_ambient_hrs", "price")
PRODUCT_NUMBERS = ("shelf_life_fridge_hrs", "shelf_life_ambient_hrs", "price")


def _product_fields(data, partial):
    """Validated product metadata from a request body (only the fields sent when partial)."""
    fields = {key: data[key] for key in PRODUCT_FIELDS if key in data}
    if "product_name" in fields or not partial:
        fields["product_name"] = str(fields.get("product_name") or "").strip()
        if not fields["product_name"]:
            raise HTTPException(status_code=400, detail="product_name is required")
    for key in PRODUCT_NUMBERS:
        if key in fields:
            try:
                fields[key] = float(fields[key])
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"{key} must be a number")
            # Shelf life must be positive; a price of 0 is allowed.
            if fields[key] < 0 or (key != "price" and fields[key] == 0):
                raise HTTPException(status_code=400, detail=f"{key} must be greater than 0")
    if not partial:
        fields.setdefault("category", "")
        fields.setdefault("unit_type", "kg")
        for key in ("shelf_life_fridge_hrs", "shelf_life_ambient_hrs"):
            if key not in fields:
                raise HTTPException(status_code=400, detail=f"{key} is required")
    return fields


def _same_name_product(name, exclude_id=None):
    key = _product_key(name)
    for product in COLS["products"].find({}, {"product_id": 1, "product_name": 1}):
        if _product_key(product.get("product_name")) == key and product.get("product_id") != exclude_id:
            return product
    return None


@app.post("/products")
def create_product(data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
    fields = _product_fields(data, partial=False)
    duplicate = _same_name_product(fields["product_name"])
    if duplicate:
        raise HTTPException(status_code=409, detail=f"{fields['product_name']} already exists as {duplicate['product_id']}")
    product_id = str(data.get("product_id") or "").strip()
    if not product_id:
        # Next free P### id; the catalog is small, so a scan is fine.
        taken = {p.get("product_id") for p in COLS["products"].find({}, {"product_id": 1})}
        number = len(taken) + 1
        while f"P{number:03d}" in taken:
            number += 1
        product_id = f"P{number:03d}"
    if COLS["products"].find_one({"product_id": product_id}):
        raise HTTPException(status_code=409, detail=f"Product with product_id {product_id} already exists")
    product_doc = {"product_id": product_id, **fields, "created_at": datetime.datetime.utcnow().isoformat()}
    result = COLS["products"].insert_one(product_doc)
    _forget_catalog()
    product_doc["_id"] = str(result.inserted_id)
    COLS["logs"].insert_one({
        "type": "activity",
        "action": "create_product",
        "product_id": product_id,
        "message": f"Created product {fields['product_name']}"
    })
    return {"message": "Product created successfully", "product": product_doc}


@app.put("/products/{product_id}")
def update_product(product_id: str = Path(...), data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
    product = COLS["products"].find_one({"product_id": product_id})
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    fields = _product_fields(data, partial=True)
    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if "product_name" in fields and _product_key(fields["product_name"]) != _product_key(product.get("product_name")):
        # The demand model finds its products by name; a rename would drop this one from forecasts.
        if ml._model_label(product.get("product_name")):
            raise HTTPException(status_code=400, detail="The demand forecast uses this product's name, so it cannot be renamed")
        duplicate = _same_name_product(fields["product_name"], exclude_id=product_id)
        if duplicate:
            raise HTTPException(status_code=409, detail=f"{fields['product_name']} already exists as {duplicate['product_id']}")
    fields["updated_at"] = datetime.datetime.utcnow().isoformat()
    updated = COLS["products"].find_one_and_update(
        {"product_id": product_id}, {"$set": fields}, return_document=ReturnDocument.AFTER
    )
    _forget_catalog()
    updated["_id"] = str(updated["_id"])
    COLS["logs"].insert_one({
        "type": "activity",
        "action": "update_product",
        "product_id": product_id,
        "message": f"Updated product {updated['product_name']}"
    })
    return {"message": "Product updated", "product": updated}


@app.delete("/products/{product_id}")
def delete_product(product_id: str = Path(...), user: dict = Depends(current_user)):
    require_role(user)
    product = COLS["products"].find_one({"product_id": product_id})
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    active = sum(1 for batch in COLS["batches"].find({
        "product_id": product_id,
        "status": {"$in": ["available", *HELD_STATUSES]},
        "expired_at": {"$exists": False},
    }) if _batch_remaining(batch) > 0)
    if active:
        raise HTTPException(status_code=409, detail=f"{product['product_name']} still has {active} active batch(es)")
    COLS["products"].delete_one({"_id": product["_id"]})
    _forget_catalog()
    COLS["logs"].insert_one({
        "type": "activity",
        "action": "delete_product",
        "product_id": product_id,
        "message": f"Removed product {product['product_name']}"
    })
    return {"message": "Product removed", "product_id": product_id}


@app.get("/products")
def list_products(user: dict = Depends(current_user)):
    products = list(COLS["products"].find())
    for product in products:
        product["_id"] = str(product["_id"])
    return {"count": len(products), "products": products}


@app.get("/products/{product_id}")
def get_product(product_id: str = Path(...), user: dict = Depends(current_user)):
    product = COLS["products"].find_one({"product_id": product_id})
    if product is None and ObjectId.is_valid(product_id):
        product = COLS["products"].find_one({"_id": ObjectId(product_id)})
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    product["_id"] = str(product["_id"])
    return {"product": product}


@app.post("/batches")
def create_batch(data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
    # Without vendor_id the batch is "available": exposed for vendors to request.
    vendor_id = data.get("vendor_id")
    product_id = data.get("product_id")
    if not product_id:
        raise HTTPException(status_code=400, detail="product_id is required")
    if vendor_id and not _find_vendor(vendor_id):
        raise HTTPException(status_code=404, detail=f"Vendor {vendor_id} not found")
    product = COLS["products"].find_one({"product_id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found. Create the product first.")
    try:
        volume = float(data.get("volume_kg", data.get("quantity", 0)))
        initial_ph = float(data.get("initial_ph", data.get("initialPH", 4.5)))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="volume_kg and initial_ph must be numbers")
    if volume <= 0:
        raise HTTPException(status_code=400, detail="volume_kg must be greater than 0")
    now = datetime.datetime.utcnow()
    # Manufacture time drives batch age, the strongest spoilage input; default: now.
    manufactured_at = now
    if data.get("manufactured_at"):
        try:
            manufactured_at = datetime.datetime.fromisoformat(str(data["manufactured_at"]).replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="manufactured_at must be an ISO date-time")
        if manufactured_at.tzinfo:
            manufactured_at = manufactured_at.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        if manufactured_at > now + datetime.timedelta(minutes=5):
            raise HTTPException(status_code=400, detail="manufactured_at cannot be in the future")
    batch_id = data.get("batch_id") or f"BATCH-{product_id}-{now.strftime('%Y%m%d%H%M%S')}"
    if COLS["batches"].find_one({"batch_id": batch_id}):
        raise HTTPException(status_code=409, detail=f"Batch {batch_id} already exists")
    batch_doc = {
        "batch_id": batch_id,
        "vendor_id": vendor_id,
        "product_id": product_id,
        "product_name": product.get("product_name"),
        "quantity": volume,
        "volume_kg": volume,
        "remaining_volume_kg": volume,
        "threshold_kg": float(data.get("threshold_kg") or round(0.2 * volume, 2)),
        "manufactured_at": manufactured_at,
        "exposed": bool(data.get("exposed", True)),
        "initial_ph": initial_ph,
        "status": data.get("status", "active" if vendor_id else "available"),
        "created_at": now
    }
    result = COLS["batches"].insert_one(batch_doc)
    batch_doc["_id"] = str(result.inserted_id)
    COLS["logs"].insert_one({
        "type": "activity",
        "action": "create_batch",
        "vendor_id": vendor_id,
        "batch_id": batch_id,
        "product_id": product_id,
        "timestamp": datetime.datetime.utcnow(),
        "message": f"Made a {volume:g} kg {product.get('product_name') or product_id} batch"
    })
    return {"message": "Batch created successfully", "batch": batch_doc}


@app.get("/batches")
def list_batches(vendor_id: str = None, product_id: str = None, status: str = None, exposed: Optional[bool] = None,
                 limit: int = Query(500, ge=1, le=1000), skip: int = Query(0, ge=0), user: dict = Depends(current_user)):
    require_role(user, "vendor")
    if user["role"] != "admin":
        # Vendors only browse what the admin exposed for requesting.
        vendor_id, status, exposed = None, "available", True
    query = {}
    if vendor_id:
        query["vendor_id"] = vendor_id
    if product_id:
        query["product_id"] = product_id
    if status:
        query["status"] = status
    if exposed is not None:
        query["exposed"] = {"$ne": False} if exposed else False
    batches = list(COLS["batches"].find(query).sort("_id", -1).skip(skip).limit(limit))
    for batch in batches:
        batch["_id"] = str(batch["_id"])
        batch["remaining_kg"] = _batch_remaining(batch)
        batch["volume_kg"] = _batch_volume(batch)
        batch["threshold_kg"] = _batch_threshold(batch)
    return {"count": len(batches), "batches": batches}


@app.post("/batches/{batch_id}/visibility")
def set_batch_visibility(batch_id: str = Path(...), data: dict = Body(...), user: dict = Depends(current_user)):
    """Admin hides/exposes an unassigned batch from the vendors' request list."""
    require_role(user)
    result = COLS["batches"].update_one(
        {"batch_id": batch_id, "status": "available"},
        {"$set": {"exposed": bool(data.get("exposed")), "updated_at": datetime.datetime.utcnow()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Only available (unassigned) batches can be exposed or hidden")
    return {"message": "Batch visibility updated", "batch_id": batch_id, "exposed": bool(data.get("exposed"))}


@app.get("/batches/{batch_id}")
def get_batch(batch_id: str = Path(...), user: dict = Depends(current_user)):
    require_role(user, "vendor")
    batch = COLS["batches"].find_one({"batch_id": batch_id})
    if batch is None and ObjectId.is_valid(batch_id):
        batch = COLS["batches"].find_one({"_id": ObjectId(batch_id)})
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch not found")
    batch["_id"] = str(batch["_id"])
    return {"batch": batch}


@app.post("/inventory")
def create_inventory(data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
    vendor_id = data.get("vendor_id")
    product_id = data.get("product_id")
    if not vendor_id or not product_id:
        raise HTTPException(status_code=400, detail="vendor_id and product_id are required")
    vendor = COLS["vendors"].find_one({
        "$or": [{"vendor_id": vendor_id}, {"_id": ObjectId(vendor_id) if ObjectId.is_valid(vendor_id) else None}]
    })
    if not vendor:
        raise HTTPException(status_code=404, detail=f"Vendor {vendor_id} not found")
    product = COLS["products"].find_one({"product_id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found. Create the product first.")
    quantity = float(data.get("quantity", 0))
    if quantity < 0:
        raise HTTPException(status_code=400, detail="quantity must be >= 0")
    existing = COLS["inventory"].find_one({"vendor_id": vendor_id, "product_id": product_id})
    if existing:
        COLS["inventory"].update_one(
            {"_id": existing["_id"]},
            {"$set": {
                "quantity": quantity,
                "product_name": product.get("product_name"),
                "batch_number": data.get("batch_number", existing.get("batch_number")),
                "updated_at": datetime.datetime.utcnow().isoformat()
            }}
        )
        updated = COLS["inventory"].find_one({"_id": existing["_id"]})
        updated["_id"] = str(updated["_id"])
        COLS["logs"].insert_one({
            "type": "activity",
            "action": "update_inventory",
            "vendor_id": vendor_id,
            "product_id": product_id,
            "quantity": quantity,
            "message": f"Updated inventory for {product_id} at vendor {vendor_id}"
        })
        return {"message": "Inventory updated", "inventory": updated}
    inventory_doc = {
        "vendor_id": vendor_id,
        "product_id": product_id,
        "product_name": product.get("product_name"),
        "batch_number": data.get("batch_number"),
        "quantity": quantity,
        "created_at": datetime.datetime.utcnow().isoformat(),
        "updated_at": datetime.datetime.utcnow().isoformat()
    }
    result = COLS["inventory"].insert_one(inventory_doc)
    inventory_doc["_id"] = str(result.inserted_id)
    COLS["logs"].insert_one({
        "type": "activity",
        "action": "create_inventory",
        "vendor_id": vendor_id,
        "product_id": product_id,
        "quantity": quantity,
        "message": f"Mapped inventory for {product_id} at vendor {vendor_id}"
    })
    return {"message": "Inventory created successfully", "inventory": inventory_doc}


@app.get("/inventory")
def list_inventory(vendor_id: str = None, product_id: str = None, user: dict = Depends(current_user)):
    require_role(user)
    query = {}
    if vendor_id:
        query["vendor_id"] = vendor_id
    if product_id:
        query["product_id"] = product_id
    items = list(COLS["inventory"].find(query))
    for item in items:
        item["_id"] = str(item["_id"])
    return {"count": len(items), "inventory": items}


EXPIRY_SOON_HOURS = 6


def _kg(value):
    return f"{round(value, 1):g} kg"


def _shop_stock(vendors=None):
    """What every shop (or the given ones) holds right now, per product, built from batches
    (the source of truth), with the alerts for that shop. The admin's Inventory page and the
    shop's own app read the same alerts."""
    now = datetime.datetime.utcnow()
    # Latest forecast per shop and product for the window still open, from the predictions log.
    forecasts = {}
    for pred in COLS["predictions"].find({"windowEnd": {"$gte": now}}).sort("generatedAt", 1):
        forecasts[(pred.get("vendorId"), pred.get("productId"))] = float(pred.get("predictedValue") or 0)

    catalog = {}
    for product in COLS["products"].find({}, {"product_name": 1}):
        label = ml._model_label(product.get("product_name"))
        if label:
            catalog.setdefault(label, product["product_name"])
    blank = lambda name: {"product_name": name, "held_kg": 0.0, "sellable_kg": 0.0, "awaiting_kg": 0.0,
                          "expired_kg": 0.0, "threshold_kg": 0.0, "batches": 0, "next_expiry_hours": None}

    shops = []
    for vendor in (vendors if vendors is not None else COLS["vendors"].find()):
        held = _held_batches(vendor)
        if not held and str(_vendor_status(vendor)).lower() not in ("active", "approved"):
            continue
        products = {}
        for batch in held:
            name = _field(batch, "product_name", "product_id", default="Batter")
            row = products.setdefault(name, blank(name))
            kg = _batch_remaining(batch)
            row["batches"] += 1
            if batch["expired"]:
                row["expired_kg"] += kg
                continue
            row["held_kg"] += kg
            if batch["status"] == "assigned":
                row["awaiting_kg"] += kg
                continue
            row["sellable_kg"] += kg
            row["threshold_kg"] += _batch_threshold(batch)
            hours = _hours_to_expiry(vendor, batch)
            if row["next_expiry_hours"] is None or hours < row["next_expiry_hours"]:
                row["next_expiry_hours"] = hours

        # A product the shop is forecast to sell but holds none of still gets a row (out of stock).
        held_labels = {ml._model_label(name) for name in products}
        for (vid, label), kg in forecasts.items():
            if vid in _vendor_id_values(vendor) and label not in held_labels and kg > 0 and label in catalog:
                products[catalog[label]] = blank(catalog[label])
                held_labels.add(label)

        alerts = []
        for row in products.values():
            name = row["product_name"]
            label = ml._model_label(name)
            forecast = next((forecasts[(vid, label)] for vid in _vendor_id_values(vendor)
                             if (vid, label) in forecasts), None)
            row["forecast_kg"] = forecast
            row["low_stock"] = row["sellable_kg"] > 0 and row["sellable_kg"] <= row["threshold_kg"]
            for key in ("held_kg", "sellable_kg", "awaiting_kg", "expired_kg", "threshold_kg"):
                row[key] = round(row[key], 2)
            if row["next_expiry_hours"] is not None:
                row["next_expiry_hours"] = round(row["next_expiry_hours"], 1)
            if row["expired_kg"]:
                alerts.append({"product": name, "kind": "expired", "level": "danger",
                               "text": f"{name}: {_kg(row['expired_kg'])} expired, return or discard it"})
            if row["next_expiry_hours"] is not None and row["next_expiry_hours"] <= EXPIRY_SOON_HOURS:
                alerts.append({"product": name, "kind": "expiring", "level": "warning",
                               "text": f"{name}: a batch expires in {row['next_expiry_hours']:g} h, sell it first"})
            if row["low_stock"]:
                alerts.append({"product": name, "kind": "low", "level": "warning",
                               "text": f"{name}: low stock, {_kg(row['sellable_kg'])} left"})
            if forecast is not None and row["sellable_kg"] + row["awaiting_kg"] < forecast:
                alerts.append({"product": name, "kind": "below_forecast", "level": "warning",
                               "text": f"{name}: {_kg(row['sellable_kg'] + row['awaiting_kg'])} "
                                       f"on hand, below the {_kg(forecast)} forecast"})
            if row["awaiting_kg"]:
                alerts.append({"product": name, "kind": "awaiting", "level": "info",
                               "text": f"{name}: {_kg(row['awaiting_kg'])} on the way, not yet confirmed as received"})

        rows = sorted(products.values(), key=lambda r: r["product_name"])
        shops.append({
            "vendor_id": vendor.get("vendor_id") or str(vendor["_id"]),
            "shop_name": vendor.get("shop_name") or vendor.get("vendor_id"),
            "locality": _field(vendor, "locality_tier", "localityTier", default=""),
            "has_fridge": bool(_field(vendor, "hasRefrigerator", "has_refrigerator", default=True)),
            "status": _vendor_status(vendor),
            "held_kg": round(sum(r["held_kg"] for r in rows), 2),
            "sellable_kg": round(sum(r["sellable_kg"] for r in rows), 2),
            "products": rows,
            "alerts": alerts,
        })
    # Shops that need attention first.
    shops.sort(key=lambda s: (-sum(a["level"] != "info" for a in s["alerts"]), s["shop_name"] or ""))
    return shops


@app.get("/shop-stock")
def shop_stock(user: dict = Depends(current_user)):
    require_role(user)
    shops = _shop_stock()
    return {"count": len(shops), "shops": shops}


@app.get("/vendors/{vendor_id}/alerts")
def vendor_alerts(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    """The shop's own stock alerts (expired, expiring soon, low, below forecast, on the way)."""
    require_vendor(user, vendor_id)
    vendor = _find_vendor(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    shops = _shop_stock([vendor])
    alerts = shops[0]["alerts"] if shops else []
    # Problems first: danger, then warning, then info.
    order = {"danger": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: order.get(a["level"], 3))
    return {"count": len(alerts), "alerts": alerts}


@app.get("/dashboard-summary")
def dashboard_summary(user: dict = Depends(current_user)):
    """The admin dashboard's quick-reference numbers, in one call."""
    require_role(user)
    shops = _shop_stock()

    # Factory stock: unassigned batches that are still good (factory storage is assumed refrigerated).
    unassigned = [b for b in COLS["batches"].find({"status": "available", "expired_at": {"$exists": False}})
                  if _batch_remaining(b) > 0 and _hours_to_expiry({}, b) > 0]
    factory = {}
    for batch in unassigned:
        label = ml._model_label(_field(batch, "product_name", "product_id"))
        factory[label] = factory.get(label, 0.0) + _batch_remaining(batch)
    made = [_hours_since(_field(b, "manufactured_at", "created_at")) for b in unassigned]
    made = [hours for hours in made if hours is not None]

    # Network demand for the window: every shop's cached forecast, plus what each shop is short of
    # (demand + safety stock - what it holds or has on the way); factory stock covers part of that.
    safety = ml.demand_bundle["safety_stock"] if ml.demand_bundle else {}
    demand = {}
    for shop in shops:
        for row in shop["products"]:
            label = ml._model_label(row["product_name"])
            if not label or row["forecast_kg"] is None:
                continue
            entry = demand.setdefault(label, {"product_name": row["product_name"], "demand_kg": 0.0,
                                              "short_kg": 0.0, "shops": 0})
            entry["demand_kg"] += row["forecast_kg"]
            entry["short_kg"] += max(0.0, row["forecast_kg"] + float(safety.get(label, 0.0))
                                     - row["sellable_kg"] - row["awaiting_kg"])
            entry["shops"] += 1
    for label, entry in demand.items():
        entry["factory_kg"] = round(factory.get(label, 0.0), 1)
        entry["to_make_kg"] = round(max(0.0, entry["short_kg"] - entry["factory_kg"]), 1)
        entry["demand_kg"] = round(entry["demand_kg"], 1)
        entry["short_kg"] = round(entry["short_kg"], 1)
    products = sorted(demand.values(), key=lambda e: e["product_name"])

    attention = [s for s in shops if any(a["level"] != "info" for a in s["alerts"])]
    kinds = {}
    for shop in attention:
        for kind in {a["kind"] for a in shop["alerts"] if a["level"] != "info"}:
            kinds[kind] = kinds.get(kind, 0) + 1
    rows = [row for shop in shops for row in shop["products"]]
    day, window = ml._slot_of(datetime.datetime.utcnow())
    return {
        "window": {"date": day.isoformat(), "label": ("morning", "evening")[window]},
        "demand": {
            "products": products,
            "total_kg": round(sum(e["demand_kg"] for e in products), 1),
            "to_make_kg": round(sum(e["to_make_kg"] for e in products), 1),
            "shops_forecast": sum(1 for s in shops if any(r["forecast_kg"] is not None for r in s["products"])),
            "shops_live": sum(1 for s in shops if s["status"] in ("active", "approved")),
        },
        "attention": {"shops": len(attention), "by_kind": kinds},
        "stock": {
            "sellable_kg": round(sum(r["sellable_kg"] for r in rows), 1),
            "awaiting_kg": round(sum(r["awaiting_kg"] for r in rows), 1),
            "expired_kg": round(sum(r["expired_kg"] for r in rows), 1),
        },
        "unassigned": {
            "batches": len(unassigned),
            "kg": round(sum(_batch_remaining(b) for b in unassigned), 1),
            "oldest_hours": round(max(made), 1) if made else None,
        },
    }


@app.post("/vendors/{vendor_id}/demands")
def create_demand(
    vendor_id: str = Path(...),
    data: dict = Body(...),
    user: dict = Depends(current_user)
):
    require_vendor(user, vendor_id)

    items = data.get("items", [])

    if not items:
        raise HTTPException(status_code=400, detail="No products selected")

    demand_items = []

    for item in items:

        # Batch-wise request: the vendor asks for one specific exposed batch.
        batch_id = item.get("batch_id")
        if batch_id:
            if len(items) != 1:
                raise HTTPException(status_code=400, detail="Request one batch at a time")
            vendor = _find_vendor(vendor_id)
            if not vendor:
                raise HTTPException(status_code=404, detail="Vendor not found")
            if _vendor_status(vendor) not in APPROVED_STATUSES:
                raise HTTPException(status_code=409, detail="Your shop is awaiting admin approval; batches can be requested once it is approved")
            batch = COLS["batches"].find_one({
                "batch_id": batch_id, "status": "available", "exposed": {"$ne": False}
            })
            if not batch:
                raise HTTPException(status_code=409, detail=f"Batch {batch_id} is not available")
            if COLS["restock_requests"].find_one({
                "vendor_id": vendor_id, "status": "pending", "items.batch_id": batch_id
            }):
                raise HTTPException(status_code=409, detail=f"Batch {batch_id} is already requested")
            demand_items.append({
                "batch_id": batch_id,
                "product_id": batch.get("product_id"),
                "product_name": batch.get("product_name"),
                "quantity": _batch_remaining(batch)
            })
            continue

        product_id = item.get("product_id")
        quantity = item.get("quantity", 0)

        if not product_id:
            raise HTTPException(status_code=400, detail="product_id is required")

        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be greater than 0")

        inventory = COLS["inventory"].find_one({
            "vendor_id": vendor_id,
            "product_id": product_id
        })

        if not inventory:
            raise HTTPException(status_code=400, detail=f"Product {product_id} is not mapped")

        demand_items.append({
            "product_id": product_id,
            "product_name": inventory.get("product_name"),
            "batch_number": inventory.get("batch_number"),
            "inventory_id": inventory.get("inventory_id"),
            "quantity": quantity
        })

    demand = {
        "vendor_id": vendor_id,
        "items": demand_items,
        "priority": data.get("priority", "normal"),
        "status": "pending",
        "created_at": datetime.datetime.utcnow()
    }

    result = COLS["restock_requests"].insert_one(demand)

    demand_id = str(result.inserted_id)

    COLS["logs"].insert_one({
        "action": "create_demand",
        "vendor_id": vendor_id,
        "demand_id": demand_id,
        "timestamp": datetime.datetime.utcnow(),
        "message": f"{(_find_vendor(vendor_id) or {}).get('shop_name') or vendor_id} requested a batch",
    })

    return {
        "message": "Demand created",
        "demand_id": demand_id,
        "status": "pending"
    }




@app.post("/vendors/{vendor_id}/demands/{demand_id}/confirm")
def confirm_demand(vendor_id: str = Path(...), demand_id: str = Path(...), user: dict = Depends(current_user)):
    require_role(user)
    if not ObjectId.is_valid(demand_id):
        raise HTTPException(status_code=400, detail="Invalid demand ID")

    demand = COLS["restock_requests"].find_one({"_id": ObjectId(demand_id), "vendor_id": vendor_id})
    if not demand:
        raise HTTPException(status_code=404, detail="Demand not found")

    # Batch request: confirming = the admin assigns the batch to this vendor.
    now = datetime.datetime.utcnow()
    batch_ids = [item["batch_id"] for item in demand.get("items", []) if item.get("batch_id")]
    if batch_ids:
        if demand.get("status") != "pending":
            raise HTTPException(status_code=409, detail="Only pending requests can be assigned")
        for batch_id in batch_ids:
            batch = COLS["batches"].find_one_and_update(
                {"batch_id": batch_id, "status": "available"},
                {"$set": {"status": "assigned", "vendor_id": vendor_id, "assigned_at": now, "updated_at": now},
                 "$push": {"assignment_log": {"vendor_id": vendor_id, "assigned_at": now,
                                              "assigned_by": "Admin", "request_id": demand_id}}},
                return_document=ReturnDocument.AFTER
            )
            if not batch:
                raise HTTPException(status_code=409, detail=f"Batch {batch_id} is no longer available")
            _adjust_inventory(vendor_id, batch, _batch_remaining(batch))
        # Other vendors' requests for the same batch can no longer be met.
        COLS["restock_requests"].update_many(
            {"_id": {"$ne": demand["_id"]}, "status": "pending", "items.batch_id": {"$in": batch_ids}},
            {"$set": {"status": "rejected", "rejected_at": now, "admin_notes": "Batch assigned to another vendor"}}
        )

    COLS["restock_requests"].update_one(
        {"_id": demand["_id"]},
        {
            "$set": {
                "status": "confirmed",
                "confirmed_at": now
            }
        }
    )
    shop = (_find_vendor(vendor_id) or {}).get("shop_name") or vendor_id
    items = ", ".join(f"{_field(i, 'product_name', 'product_id', default='batter')} {i.get('quantity', '')} kg".strip()
                      for i in demand.get("items", [])) or "request"
    _log("assign_batch", f"Assigned {items} to {shop}", vendor_id, request_id=demand_id)

    return {
        "message": "Demand confirmed",
        "demand_id": demand_id,
        "status": "confirmed"
    }


@app.post("/vendors/{vendor_id}/demands/{demand_id}/reject")
def reject_demand(vendor_id: str = Path(...), demand_id: str = Path(...), data: dict = Body(default={}),
                  user: dict = Depends(current_user)):
    require_role(user)
    if not ObjectId.is_valid(demand_id):
        raise HTTPException(status_code=400, detail="Invalid demand ID")
    result = COLS["restock_requests"].update_one(
        {"_id": ObjectId(demand_id), "vendor_id": vendor_id, "status": "pending"},
        {"$set": {"status": "rejected", "rejected_at": datetime.datetime.utcnow(),
                  "admin_notes": data.get("reason", "")}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pending demand not found")
    shop = (_find_vendor(vendor_id) or {}).get("shop_name") or vendor_id
    _log("reject_request", f"Rejected a batch request from {shop}", vendor_id, request_id=demand_id)
    return {"message": "Demand rejected", "demand_id": demand_id, "status": "rejected"}


@app.post("/vendors/{vendor_id}/batches/{batch_id}/receive")
def receive_batch(vendor_id: str = Path(...), batch_id: str = Path(...), user: dict = Depends(current_user)):
    """Vendor confirms delivery of an assigned batch; closes the matching request."""
    require_vendor(user, vendor_id)
    vendor = _find_vendor(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    now = datetime.datetime.utcnow()
    batch = COLS["batches"].find_one_and_update(
        {"batch_id": batch_id, "vendor_id": {"$in": _vendor_id_values(vendor)}, "status": "assigned"},
        {"$set": {"status": "received", "received_at": now, "updated_at": now}},
        return_document=ReturnDocument.AFTER
    )
    if not batch:
        raise HTTPException(status_code=409, detail=f"Batch {batch_id} is not awaiting delivery for this vendor")
    COLS["restock_requests"].update_many(
        {"vendor_id": {"$in": _vendor_id_values(vendor)}, "status": "confirmed", "items.batch_id": batch_id},
        {"$set": {"status": "synchronized", "received_at": now}}
    )
    COLS["logs"].insert_one({
        "type": "activity", "action": "receive_batch", "vendor_id": vendor["vendor_id"],
        "batch_id": batch_id, "timestamp": now,
        "message": f"Vendor {vendor['vendor_id']} confirmed delivery of batch {batch_id}"
    })
    return {"message": "Batch assignment confirmed", "batch_id": batch_id, "status": "received"}


@app.post("/vendors/{vendor_id}/batches/{batch_id}/return")
def return_batch(vendor_id: str = Path(...), batch_id: str = Path(...), data: dict = Body(default={}),
                 user: dict = Depends(current_user)):
    """Vendor sends back a received batch (expired or too risky to sell); its stock leaves the shop."""
    require_vendor(user, vendor_id)
    vendor = _find_vendor(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    now = datetime.datetime.utcnow()
    reason = str(data.get("reason") or "returned by vendor")
    batch = COLS["batches"].find_one_and_update(
        {"batch_id": batch_id, "vendor_id": {"$in": _vendor_id_values(vendor)}, "status": {"$in": SELLABLE_STATUSES}},
        {"$set": {"status": "returned", "returned_at": now, "return_reason": reason, "updated_at": now}},
        return_document=ReturnDocument.BEFORE
    )
    if not batch:
        raise HTTPException(status_code=409, detail=f"Batch {batch_id} is not in this vendor's store")
    returned_kg = round(_batch_remaining(batch), 2)
    if not batch.get("expired_at"):  # expired kg already left the inventory total
        _adjust_inventory(vendor["vendor_id"], batch, -returned_kg)
    COLS["logs"].insert_one({
        "type": "activity", "action": "return_batch", "vendor_id": vendor["vendor_id"],
        "batch_id": batch_id, "reason": reason, "returned_kg": returned_kg, "timestamp": now,
        "message": f"Vendor {vendor['vendor_id']} returned batch {batch_id} ({returned_kg} kg): {reason}"
    })
    return {"message": f"Batch {batch_id} returned ({returned_kg} kg)", "batch_id": batch_id,
            "status": "returned", "returned_kg": returned_kg}


def _sell(vendor, product, batch_id, quantity, actor_id, customer_id, exclude_order=None):
    """Take kg out of the vendor's batches (one batch, or first-expiring first) and record the sale.
    All or nothing. Returns (order record, low-stock alerts)."""
    query = {"vendor_id": {"$in": _vendor_id_values(vendor)}, "status": {"$in": SELLABLE_STATUSES}}
    if batch_id:
        query["batch_id"] = batch_id
    batches = [b for b in COLS["batches"].find(query) if _batch_remaining(b) > 0]
    if batch_id and batches and _hours_to_expiry(vendor, batches[0]) <= 0:
        raise HTTPException(status_code=409, detail=f"Batch {batch_id} has expired and cannot be sold")
    batches = [b for b in batches if _hours_to_expiry(vendor, b) > 0]
    if product and not batch_id:
        batches = [b for b in batches if product in (b.get("product_id"), b.get("product_name"))
                   or _product_key(product) == _product_key(_field(b, "product_name", "product_id"))]
    # First-expiring (else oldest) batch sells first.
    def fefo(batch):
        when = _field(batch, "expires_at", "manufactured_at", "mfgTimestamp")
        return when if isinstance(when, datetime.datetime) else datetime.datetime.max
    batches.sort(key=fefo)
    available = sum(_batch_remaining(b) for b in batches)
    if not batches or available < quantity:
        raise HTTPException(status_code=409, detail=f"Only {round(available, 2)} kg available")
    # Kg set aside for customer pickups cannot be sold to someone else.
    name = product or _field(batches[0], "product_name", "product_id")
    reserved = _reserved_kg(vendor, name, exclude_order)
    if reserved:
        product_kg = sum(_batch_remaining(b) for b in _sellable_batches(vendor)
                         if _product_key(_field(b, "product_name", "product_id")) == _product_key(name))
        if product_kg - reserved < quantity:
            raise HTTPException(status_code=409, detail=f"Only {round(max(0.0, product_kg - reserved), 2)} kg of "
                                                        f"{name} is free; {round(reserved, 2)} kg is set aside for customer pickups")

    now = datetime.datetime.utcnow()
    left, taken = quantity, []
    for batch in batches:
        if left <= 0:
            break
        before = _batch_remaining(batch)
        take = min(before, left)
        after = round(before - take, 3)
        update = {"remaining_volume_kg": after, "updated_at": now,
                  "sell_through_rate": round(1 - after / (_batch_volume(batch) or before), 3)}
        if after <= 0:
            update.update(status="stockout", stocked_out_at=now)
        # Optimistic lock on updated_at so two concurrent sales cannot oversell a batch.
        if COLS["batches"].update_one({"_id": batch["_id"], "updated_at": batch.get("updated_at")},
                                      {"$set": update}).matched_count == 0:
            # All or nothing: put back what this sale already took, so no stock goes missing.
            for done, done_before, _, _ in taken:
                undo = {"$set": {"remaining_volume_kg": done_before, "status": done.get("status"),
                                 "sell_through_rate": done.get("sell_through_rate"),
                                 "updated_at": datetime.datetime.utcnow()}}
                if not done.get("stocked_out_at"):
                    undo["$unset"] = {"stocked_out_at": ""}
                COLS["batches"].update_one({"_id": done["_id"], "updated_at": now}, undo)
            raise HTTPException(status_code=409, detail=f"Batch {batch['batch_id']} changed during the sale, please retry")
        left -= take
        taken.append((batch, before, take, after))

    # Every batch update succeeded: now write the inventory, movements, alerts and order.
    deductions, alerts = [], []
    for batch, before, take, after in taken:
        deductions.append({"batch_id": batch["batch_id"], "quantity_kg": round(take, 3), "remaining_kg": after})
        _adjust_inventory(vendor["vendor_id"], batch, -take)
        COLS["inventory_movement"].insert_one({
            "vendorId": vendor["vendor_id"], "productId": _field(batch, "product_id", "product_name"),
            "batchId": batch["batch_id"], "movementType": "sale", "quantity": round(take, 3),
            "occurredAt": now, "triggeredBy": customer_id or actor_id,
            "metadata": {"previousQty": before, "newQty": after},
        })
        threshold = _batch_threshold(batch)
        if before > threshold >= after:
            alert = {
                "alert_id": f"ALT-{batch['batch_id']}-{now.strftime('%Y%m%d%H%M%S')}",
                "vendor_id": vendor["vendor_id"], "batch_id": batch["batch_id"],
                "alert_type": "stockout" if after <= 0 else "low_stock",
                "alert_message": f"Batch {batch['batch_id']} ({batch.get('product_name')}) has "
                                 f"{after} kg left (threshold {threshold} kg)",
                "alert_status": "active", "generated_time": now,
            }
            COLS["inventory_alerts"].insert_one(dict(alert))
            alerts.append(alert)

    order = {
        "order_id": f"ORD-{now.strftime('%Y%m%d%H%M%S%f')}",
        "vendor_id": vendor["vendor_id"],
        "user_id": customer_id,
        "product_name": product or batches[0].get("product_name"),
        "quantity_kg": quantity,
        "batches": deductions,
        "order_status": "completed",
        "order_date": now,
    }
    COLS["orders"].insert_one(dict(order))
    return order, alerts


# Customer pickup orders: placing one sets the kg aside (nothing is sold yet); the shop
# marks it collected, which records the sale. Unclaimed holds lapse after PICKUP_HOLD_HOURS.
PICKUP_HOLD_HOURS = 2


def _open_pickups(vendor, exclude_order=None):
    query = {"kind": "pickup", "vendor_id": vendor.get("vendor_id"), "status": "to_collect",
             "hold_until": {"$gt": datetime.datetime.utcnow()}}
    if exclude_order:
        query["order_id"] = {"$ne": exclude_order}
    return list(COLS["orders"].find(query))


def _reserved_kg(vendor, product, exclude_order=None):
    key = _product_key(product)
    return sum(float(item["quantity_kg"]) for order in _open_pickups(vendor, exclude_order)
               for item in order.get("items", []) if _product_key(item.get("product_name")) == key)


def _expire_pickups(query):
    """Holds past their time read as expired (stock was never taken, so nothing to give back)."""
    COLS["orders"].update_many({**query, "kind": "pickup", "status": "to_collect",
                                "hold_until": {"$lte": datetime.datetime.utcnow()}},
                               {"$set": {"status": "expired"}})


def _pickup_view(order):
    order["_id"] = str(order["_id"])
    return order


@app.post("/customer-orders")
def place_pickup_order(data: dict = Body(...), user: dict = Depends(current_user)):
    """A customer orders batter from one shop to collect and pay for there."""
    require_role(user, "customer")
    vendor = _find_vendor(str(data.get("vendor_id") or ""))
    if not vendor or _vendor_status(vendor) not in APPROVED_STATUSES:
        raise HTTPException(status_code=404, detail="Shop not found")
    wanted = {}
    for item in data.get("items") or []:
        name = str(item.get("product_name") or "").strip()
        try:
            kg = float(item.get("quantity_kg"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="quantity_kg must be a number")
        if not name or kg <= 0:
            continue
        wanted[name] = wanted.get(name, 0.0) + kg
    if not wanted:
        raise HTTPException(status_code=400, detail="Choose at least one product and an amount")

    prices = {_product_key(p.get("product_name")): p.get("price") for p in COLS["products"].find()}
    sellable = _sellable_batches(vendor)
    items, total = [], 0.0
    for name, kg in wanted.items():
        free = sum(_batch_remaining(b) for b in sellable
                   if _product_key(_field(b, "product_name", "product_id")) == _product_key(name))
        free -= _reserved_kg(vendor, name)
        # shortcut: two customers ordering the last kg at the same instant can both pass this check; fine at shop scale.
        if free < kg:
            raise HTTPException(status_code=409, detail=f"Only {round(max(0.0, free), 2)} kg of {name} is left at this shop")
        price = prices.get(_product_key(name))
        line = round(float(price) * kg, 2) if price is not None else None
        total += line or 0.0
        items.append({"product_name": name, "quantity_kg": round(kg, 3), "price_per_kg": price, "line_total": line})

    taken = {o.get("pickup_code") for o in _open_pickups(vendor)}
    code = f"{secrets.randbelow(10000):04d}"
    while code in taken:
        code = f"{secrets.randbelow(10000):04d}"
    customer = COLS["customers"].find_one({"_id": ObjectId(user["sub"])}) if ObjectId.is_valid(user["sub"]) else None
    now = datetime.datetime.utcnow()
    order = {
        "order_id": f"PU-{now.strftime('%Y%m%d%H%M%S%f')}",
        "kind": "pickup",
        "fulfilment": "pickup",
        "payment": "at_shop",
        "vendor_id": vendor["vendor_id"],
        "shop_name": vendor.get("shop_name"),
        "user_id": user["sub"],
        "customer_name": (customer or {}).get("name"),
        "items": items,
        "total": round(total, 2),
        "status": "to_collect",
        "pickup_code": code,
        "created_at": now,
        "hold_until": now + datetime.timedelta(hours=PICKUP_HOLD_HOURS),
    }
    COLS["orders"].insert_one(order)
    summary = ", ".join(f"{i['product_name']} {i['quantity_kg']:g} kg" for i in items)
    _log("pickup_order", f"A customer ordered {summary} for pickup at {vendor.get('shop_name') or vendor['vendor_id']}",
         vendor["vendor_id"])
    return {"message": "Order placed", "order": _pickup_view(order)}


@app.get("/customer-orders")
def my_pickup_orders(user: dict = Depends(current_user)):
    require_role(user, "customer")
    _expire_pickups({"user_id": user["sub"]})
    orders = COLS["orders"].find({"kind": "pickup", "user_id": user["sub"]}).sort("created_at", -1).limit(50)
    return {"orders": [_pickup_view(o) for o in orders]}


@app.get("/vendors/{vendor_id}/pickups")
def shop_pickups(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    """Orders customers will collect from this shop, oldest first."""
    require_vendor(user, vendor_id)
    vendor = _find_vendor(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    _expire_pickups({"vendor_id": vendor["vendor_id"]})
    orders = sorted(_open_pickups(vendor), key=lambda o: o["created_at"])
    return {"orders": [_pickup_view(o) for o in orders]}


@app.post("/vendors/{vendor_id}/pickups/{order_id}/collect")
def collect_pickup(vendor_id: str = Path(...), order_id: str = Path(...), data: dict = Body(default={}),
                   user: dict = Depends(current_user)):
    """The customer showed their code and paid: sell the held kg and close the order."""
    require_vendor(user, vendor_id)
    vendor = _find_vendor(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    order = COLS["orders"].find_one({"kind": "pickup", "order_id": order_id, "vendor_id": vendor["vendor_id"]})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] != "to_collect":
        raise HTTPException(status_code=409, detail=f"This order is already {order['status']}")
    if str(data.get("code") or "").strip() != order["pickup_code"]:
        raise HTTPException(status_code=400, detail="That pickup code does not match this order")
    # Mark it first so a double tap cannot sell twice; put it back if a sale fails.
    if COLS["orders"].update_one({"_id": order["_id"], "status": "to_collect"},
                                 {"$set": {"status": "collecting"}}).modified_count == 0:
        raise HTTPException(status_code=409, detail="This order is already being collected")
    try:
        for item in order["items"]:
            _sell(vendor, item["product_name"], None, float(item["quantity_kg"]), user["sub"],
                  order["user_id"], exclude_order=order_id)
    except HTTPException:
        COLS["orders"].update_one({"_id": order["_id"]}, {"$set": {"status": "to_collect"}})
        raise
    now = datetime.datetime.utcnow()
    COLS["orders"].update_one({"_id": order["_id"]}, {"$set": {"status": "collected", "collected_at": now}})
    _log("pickup_collected", f"{vendor.get('shop_name') or vendor['vendor_id']} handed over a customer pickup "
                             f"({order['total']:g} rupees)", vendor["vendor_id"])
    return {"message": "Order collected", "order_id": order_id, "status": "collected"}


@app.post("/orders")
def create_order(data: dict = Body(...), user: dict = Depends(current_user)):
    """Customer purchase: deducts kg from a batch (or FEFO across the vendor's batches)."""
    require_role(user, "vendor", "customer")
    if user["role"] == "vendor":
        require_vendor(user, str(data.get("vendor_id") or ""))
    # A customer buys as themself; only a vendor/admin may record a sale for someone else.
    customer_id = user["sub"] if user["role"] == "customer" else data.get("customer_id")
    vendor = _find_vendor(str(data.get("vendor_id") or ""))
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    try:
        quantity = float(data.get("quantity_kg", data.get("quantity", 0)))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="quantity_kg must be a number")
    if not quantity > 0:
        raise HTTPException(status_code=400, detail="quantity_kg must be greater than 0")

    product = data.get("product_name") or data.get("product_id")
    order, alerts = _sell(vendor, product, data.get("batch_id"), quantity, user["sub"], customer_id)
    return {"message": "Order placed", "order": order, "alerts": alerts}


@app.post("/vendors/{vendor_id}/inventory/sync")
def sync_inventory(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    require_vendor(user, vendor_id)
    # Batch requests are closed by /batches/{id}/receive, not by a product sync.
    demands = list(
        COLS["restock_requests"].find({
            "vendor_id": vendor_id,
            "status": "confirmed",
            "items.batch_id": {"$exists": False}
        })
    )

    if not demands:
        return {
            "message": "No confirmed demand"
        }

    updated = []
    for demand in demands:
        for item in demand.get("items", []):
            pid = item.get("product_id")
            qty = item.get("quantity", 0)
            inv = COLS["inventory"].find_one({
                "vendor_id": vendor_id,
                "product_id": pid
            })
            old_qty = float(inv.get("quantity", 0.0)) if inv else 0.0
            new_qty = old_qty + float(qty)
            COLS["inventory"].update_one(
                {
                    "vendor_id": vendor_id,
                    "product_id": pid
                },
                {
                    "$inc": {
                        "quantity": qty
                    },
                    "$set": {
                        "last_updated": datetime.datetime.utcnow().isoformat()
                    }
                },
                upsert=False
            )
            updated.append({
                "product_id": pid,
                "product_name": (inv.get("product_name") if inv else None) or item.get("product_name", ""),
                "batch_number": (inv.get("batch_number") if inv else None) or item.get("batch_number", ""),
                "old_quantity": old_qty,
                "new_quantity": new_qty
            })

        COLS["restock_requests"].update_one(
            {
                "_id": demand["_id"]
            },
            {
                "$set": {
                    "status": "synchronized"
                }
            }
        )

    return {
        "message": "Inventory synchronized",
        "synced_demands": len(demands),
        "updated": updated
    }


@app.get("/pending/vendors")
def get_pending_vendors(user: dict = Depends(current_user)):
    require_role(user)
    vendors = list(
        COLS["vendors"].find({
            "$or": [
                {
                    "status": "pending"
                },
                {
                    "verificationStatus": "pending"
                }
            ]
        })
    )

    for vendor in vendors:
        vendor["_id"] = str(vendor["_id"])

    return {
        "count": len(vendors),
        "vendors": vendors
    }


# POST /vendors/{vendor_id}/status — admin approves, rejects or suspends a vendor.
# Body: {"status": "active" | "rejected" | "suspended"}
@app.post("/vendors/{vendor_id}/status")
def set_vendor_status(vendor_id: str = Path(...), data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
    new_status = data.get("status")
    if new_status not in ("active", "rejected", "suspended"):
        raise HTTPException(status_code=400, detail="status must be active, rejected or suspended")
    vendor = _find_vendor(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    now = datetime.datetime.utcnow()
    # Write both fields: seed vendors read verificationStatus, app-created ones read status.
    COLS["vendors"].update_one({"_id": vendor["_id"]}, {"$set": {
        "status": new_status, "verificationStatus": new_status, "updated_at": now}})
    COLS["logs"].insert_one({
        "type": "activity", "action": "set_vendor_status", "vendor_id": vendor.get("vendor_id"),
        "status": new_status, "timestamp": now, "message": f"{vendor.get('shop_name') or vendor.get('vendor_id')} set to {new_status}",
    })
    return {"message": f"Vendor {new_status}", "vendor_id": vendor.get("vendor_id"), "status": new_status}


@app.get("/users/{user_id}")
def get_user(user_id: str = Path(...), user: dict = Depends(current_user)):
    if user["role"] != "admin" and user_id != user["sub"]:
        require_vendor(user, user_id)
    query = {
        "$or": [
            {
                "user_id": user_id
            },
            {
                "vendor_id": user_id
            }
        ]
    }

    if ObjectId.is_valid(user_id):
        query["$or"].append({
            "_id": ObjectId(user_id)
        })

    user = COLS["vendors"].find_one(query)

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    user["_id"] = str(user["_id"])

    return {
        "user": user
    }


@app.post("/restock-requests")
def create_restock_request(data: dict = Body(...), user: dict = Depends(current_user)):
    vendor_id = data.get("vendor_id")

    if not vendor_id:
        raise HTTPException(status_code=400, detail="vendor_id is required")
    require_vendor(user, str(vendor_id))
    if not _find_vendor(str(vendor_id)):
        raise HTTPException(status_code=404, detail=f"Vendor {vendor_id} not found")

    # Store only known fields: the body comes straight from the client.
    items = data.get("items")
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="items must be a non-empty list")
    clean_items = []
    for item in items:
        if not isinstance(item, dict) or not (item.get("product_id") or item.get("product_name")):
            raise HTTPException(status_code=400, detail="Each item needs a product_id or product_name")
        quantity = item.get("quantity")
        if isinstance(quantity, bool) or not isinstance(quantity, (int, float)) or quantity <= 0:
            raise HTTPException(status_code=400, detail="Each item needs a quantity greater than 0")
        clean_items.append({k: item[k] for k in ("product_id", "product_name", "quantity") if k in item})

    req = COLS["restock_requests"].insert_one({
        "vendor_id": vendor_id,
        "items": clean_items,
        "priority": data.get("priority", "normal"),
        "notes": str(data.get("notes", "")),
        "status": "pending",
        "created_at": datetime.datetime.utcnow(),
    })
    req_id = str(req.inserted_id)

    order = COLS["orders"].insert_one({
        "vendor_id": vendor_id,
        "restock_request_id": req_id,
        "order_type": "restock",  # not a customer sale
        "items": clean_items,
        "status": "pending"
    })

    COLS["logs"].insert_one({
        "action": "create_restock_request",
        "vendor_id": str(vendor_id),
        "request_id": req_id
    })

    return {
        "message": "Restock request created",
        "restock_id": req_id,
        "order_id": str(order.inserted_id)
    }


@app.get("/restock-requests")
def get_restock_requests(
    status: str = None,
    vendor_id: str = None,
    limit: int = Query(500, ge=1, le=1000), skip: int = Query(0, ge=0),
    user: dict = Depends(current_user)
):
    require_role(user, "vendor")
    if user["role"] == "vendor":
        vendor_id = user["vendor_id"]  # vendors only see their own requests
    query = {}

    if status:
        query["status"] = status

    if vendor_id:
        query["vendor_id"] = vendor_id

    requests = list(
        COLS["restock_requests"].find(query).sort("_id", -1).skip(skip).limit(limit)
    )

    for req in requests:
        req["_id"] = str(req["_id"])

    return {
        "count": len(requests),
        "restock_requests": requests
    }
@app.post("/customers/register")
def register_customer(data: dict = Body(...)):
    name = data.get("name", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password")
    phone = data.get("phone", "").strip()

    if not name or not email or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name, email, and password are required"
        )

    if COLS["users"].find_one({"email": email}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists"
        )

    location = data.get("location", {})
    customer_location = {
        "latitude": location.get("latitude", data.get("latitude")),
        "longitude": location.get("longitude", data.get("longitude")),
        "address": location.get("address", data.get("address", ""))
    }

    customer_doc = {
        "name": name,
        "email": email,
        "phone": phone,
        "location": customer_location,
        "status": data.get("status", "active"),
        "created_at": datetime.datetime.utcnow().isoformat()
    }
    cust_result = COLS["customers"].insert_one(customer_doc)
    customer_id = str(cust_result.inserted_id)

    user_doc = {
        "user_id": customer_id,
        "email": email,
        "phone": phone,
        "password_hash": hash_password(password),
        "role": "customer",
        "is_verified": True
    }
    COLS["users"].insert_one(user_doc)

    COLS["logs"].insert_one({
        "type": "activity",
        "action": "register_customer",
        "customer_id": customer_id,
        "message": f"Registered new customer {name}"
    })

    return {
        "message": "Customer registered successfully",
        "customer": {
            "customer_id": customer_id,
            "name": name,
            "email": email,
            "phone": phone,
            "location": customer_location
        }
    }
@app.post("/customers/login")
def login_customer(data: dict = Body(...)):
    login_id = (data.get("login") or "").strip()
    if "@" in login_id:
        login_id = login_id.lower()
    password = data.get("password")
    if not login_id or not password:
        raise HTTPException(status_code=400, detail="Login email/phone and password are required")

    user = _find_login_user(login_id)
    if not user or not user.get("password_hash") or not check_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email/phone or password")
    if user.get("role") != "customer":
        raise HTTPException(status_code=403, detail="This login is not a customer account")
    if not user.get("is_verified", True):
        raise HTTPException(status_code=403, detail="Customer account is not verified")

    location = _location_payload(data)
    location_updated = _save_customer_location(user, location)
    customer_id = user.get("user_id")
    customer = None
    if customer_id and ObjectId.is_valid(str(customer_id)):
        customer = COLS["customers"].find_one({"_id": ObjectId(str(customer_id))})
    if customer:
        customer["_id"] = str(customer["_id"])

    COLS["logs"].insert_one({
        "type": "activity",
        "action": "login_customer",
        "customer_id": str(customer_id),
        "location_updated": location_updated,
        "timestamp": datetime.datetime.utcnow().isoformat()
    })

    response = {"message": "Customer login successful", "customer": customer,
                "token": issue_token(customer_id, "customer")}
    if location:
        response["nearby_vendors"] = find_nearby_vendors(
            location["latitude"], location["longitude"],
            data.get("radius_meters", 5000), data.get("product_id")
        )
    return response

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=5000
    )
