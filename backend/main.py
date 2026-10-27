import os
import math
import re
import datetime
import warnings
from pathlib import Path as FilePath
from typing import Optional
from fastapi import FastAPI, Body, HTTPException, status
from fastapi import FastAPI, HTTPException, Path, Body
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument
from bson import ObjectId
import bcrypt
import joblib
import numpy as np
import pandas as pd

BASE_DIR = FilePath(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    # Admin (Vite :5173) and the Expo web app (:8081, or the next free port), opened
    # via localhost, 127.0.0.1 or the machine's LAN IP. Other sites stay blocked.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MONGODB_URI = os.getenv("MONGODB_URI")
if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI is missing. Add it to the project root .env file.")
client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000)

db = client["b2p"]

COLS = {
    "users": db["users"],
    "customers": db["customers"],
    "vendors": db["vendors"],
    "products": db["products"],
    "batches": db["batches"],
    "inventory": db["inventory"],
    "orders": db["orders"],
    "order_items": db["order_items"],
    "logs": db["logs"],
    "restock_requests": db["restock_requests"],
    "predictions": db["predictions"],
    "inventory_movement": db["inventory_movement"],
    "weather_forecast": db["weather_forecast"],
    "festival_calendar": db["festival_calendar"],
    "feature_snapshots": db["feature_snapshots"],
    "inventory_alerts": db["inventory_alerts"],
}

# ------------------------------------------------------------
# Machine Learning Models (Demand Forecast & Spoilage Risk)
# ------------------------------------------------------------
MODELS_DIR = BASE_DIR / "models"
warnings.filterwarnings("ignore")


def load_model_bundle(filenames):
    for fname in filenames:
        model_path = MODELS_DIR / fname
        if model_path.exists():
            try:
                bundle = joblib.load(model_path)
                print(f"[INFO] Loaded model: {fname}")
                return bundle
            except Exception as e:
                print(f"[WARN] Failed to load {model_path}: {e}")
    return None


demand_bundle = load_model_bundle([
    "demand_forecast_model (2).pkl",
    "demand_forecast_model.pkl"
])

spoilage_bundle = load_model_bundle([
    "spoilage_risk_model (2).pkl",
    "spoilage_risk_model.pkl"
])



def _normalize_name(text):
    return re.sub(r"[^a-z0-9]", "", str(text).lower())


def _field(doc, *keys, default=None):
    """First non-empty value among the spellings of one field.

    The database mixes snake_case (backend writes) and camelCase (seed/ML
    pipeline writes), e.g. `has_refrigerator` vs `hasRefrigerator`.
    """
    for key in keys:
        value = (doc or {}).get(key)
        if value is not None and value != "":
            return value
    return default


def _product_key(text):
    # "Idli Batter", "Idly Batter" and the model's "Idly_Batter" are one product
    return _normalize_name(text).replace("idli", "idly")


def _model_label(product):
    """Demand-model class ("Idly_Batter", ...) for a product name/id, or None."""
    key = _product_key(product)
    for label in demand_bundle["product_encoder"].classes_:
        if _product_key(label) == key:
            return label
    return None


# Batch lifecycle: available (admin exposed) -> assigned (admin approved a
# vendor request) -> received (vendor confirmed delivery) -> stockout.
HELD_STATUSES = ["assigned", "received", "active"]
SELLABLE_STATUSES = ["received", "active"]


def _batch_remaining(batch):
    return float(_field(batch, "remaining_volume_kg", "quantity_kg", "quantity", "volume_kg", default=0))


def _batch_volume(batch):
    return float(_field(batch, "volume_kg", "quantity_kg", "quantity", default=0)) or _batch_remaining(batch)


def _batch_threshold(batch):
    return float(_field(batch, "threshold_kg", default=round(0.2 * _batch_volume(batch), 2)))


def _hours_since(value):
    if isinstance(value, str):
        try:
            value = datetime.datetime.fromisoformat(value)
        except ValueError:
            return None
    if not isinstance(value, datetime.datetime):
        return None
    return max(0.0, (datetime.datetime.utcnow() - value.replace(tzinfo=None)).total_seconds() / 3600)


def _held_batches(vendor):
    """Batches currently in the vendor's hands with stock left (no archived/sold-out)."""
    batches = COLS["batches"].find({
        "vendor_id": {"$in": _vendor_id_values(vendor)},
        "status": {"$in": HELD_STATUSES},
    })
    return [b for b in batches if _batch_remaining(b) > 0]


def _adjust_inventory(vendor_id, batch, delta):
    """Keep the per-product inventory row in step with batch stock."""
    key = _product_key(_field(batch, "product_name", "product_id"))
    now = datetime.datetime.utcnow()
    for row in COLS["inventory"].find({"vendor_id": vendor_id}):
        same_id = batch.get("product_id") and row.get("product_id") == batch.get("product_id")
        if same_id or _product_key(_field(row, "product_name", "product_id")) == key:
            COLS["inventory"].update_one({"_id": row["_id"]}, [{"$set": {
                "quantity": {"$max": [0, {"$add": [{"$ifNull": ["$quantity", 0]}, delta]}]},
                "last_updated": now,
            }}])
            return
    COLS["inventory"].insert_one({
        "vendor_id": vendor_id,
        "product_id": batch.get("product_id") or batch.get("product_name"),
        "product_name": batch.get("product_name"),
        "batch_number": batch.get("batch_id"),
        "quantity": max(0.0, delta),
        "created_at": now,
        "last_updated": now,
    })


def hash_password(password):
    return bcrypt.hashpw(
        password.encode(),
        bcrypt.gensalt()
    ).decode()


def check_password(password, password_hash):
    return bcrypt.checkpw(
        password.encode(),
        password_hash.encode()
    )
    

def login_user(login, password):

    user = COLS["users"].find_one({
        "$or": [
            {"email": login},
            {"phone": login}
        ]
    })

    if not user:
        return {"error": "Invalid login"}

    if not check_password(
        password,
        user["password_hash"]
    ):
        return {"error": "Invalid login"}

    if not user.get("is_verified", False):
        return {"error": "User is not verified"}

    return {
        "message": "Login successful",
        "user_id": user["user_id"],
        "role": user["role"],
        "email": user["email"]
    }


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


def _vendor_id_values(vendor):
    values = [vendor.get("vendor_id"), str(vendor.get("_id", ""))]
    return [value for value in values if value]


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
                {"status": {"$in": ["active", "approved", "verified"]}},
                {"verificationStatus": {"$in": ["active", "approved", "verified"]}}
            ]}
        }}
    ]
    results = []
    for vendor in COLS["vendors"].aggregate(pipeline):
        vendor_ids = _vendor_id_values(vendor)
        if not vendor_ids:
            continue
        inventory_query = {
            "vendor_id": {"$in": vendor_ids},
            "quantity": {"$gt": 0}
        }
        if product_id:
            inventory_query["product_id"] = product_id
        stock_items = list(COLS["inventory"].find(inventory_query))
        if not stock_items:
            continue
        for item in stock_items:
            item["_id"] = str(item["_id"])
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


@app.on_event("startup")
def startup_database_setup():
    client.admin.command("ping")
    ensure_indexes()


@app.get("/")
def home():
    expected_collections = [
        "vendors", "products", "batches", "inventory", "orders",
        "order_items", "logs", "restock_requests", "predictions",
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
    user = COLS["users"].find_one({"$or": [{"email": login_id}, {"phone": login_id}]})
    if not user or not user.get("password_hash") or not check_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid login")
    if not user.get("is_verified", False):
        raise HTTPException(status_code=403, detail="User is not verified")

    response = {
        "message": "Login successful",
        "user_id": user.get("user_id"),
        "role": user.get("role"),
        "email": user.get("email")
    }
    location = _location_payload(data)
    if user.get("role") == "customer" and location:
        _save_customer_location(user, location)
        response["nearby_vendors"] = find_nearby_vendors(
            location["latitude"], location["longitude"],
            data.get("radius_meters", 5000), data.get("product_id")
        )
    return response

@app.get("/users")
def get_users():
    users = list(COLS["users"].find({}, {"password_hash": 0}))
    if not users:
        users = list(COLS["vendors"].find())

    for user in users:
        user["_id"] = str(user["_id"])

    return {
        "count": len(users),
        "users": users
    }


@app.get("/logs")
def get_logs():
    logs = list(COLS["logs"].find())

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
    product_id: Optional[str] = None
):
    # Existing GET /vendors still returns the full list when coordinates are omitted.
    # Supplying latitude and longitude turns it into a nearby-stock search.
    if latitude is not None or longitude is not None:
        if latitude is None or longitude is None:
            raise HTTPException(status_code=400, detail="Send both latitude and longitude")
        vendors = find_nearby_vendors(latitude, longitude, radius_meters, product_id)
        return {"count": len(vendors), "vendors": vendors}
    vendors = list(COLS["vendors"].find())
    for vendor in vendors:
        vendor["_id"] = str(vendor["_id"])
    return {"count": len(vendors), "vendors": vendors}


@app.post("/vendors")
def create_vendor(data: dict = Body(...)):
    vendor_id = data.get("vendor_id")
    email = data.get("email")
    password = data.get("password")
    phone = data.get("phone", "")

    if vendor_id and COLS["vendors"].find_one({"vendor_id": vendor_id}):
        return {"error": "Vendor with this vendor_id already exists"}

    if email and COLS["users"].find_one({"email": email}):
        return {"error": "User with this email already exists"}

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
        "locality_tier": data.get("locality_tier", "mixed"),
        "status": data.get("status", "pending"),
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
            "is_verified": data.get("is_verified", True)  # Set default verification
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
def get_vendor(vendor_id: str = Path(...)):
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
        return {
            "error": "Vendor not found"
        }

    vendor["_id"] = str(vendor["_id"])

    return {
        "vendor": vendor
    }

@app.get("/vendors/{vendor_id}/products")
def get_vendor_products(vendor_id: str = Path(...)):
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
def get_vendor_inventory(vendor_id: str = Path(...)):
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


@app.get("/inventory/{vendor_id}")
def get_inventory(vendor_id: str = Path(...)):
    return get_vendor_inventory(vendor_id)


@app.get("/vendors/{vendor_id}/orders")
def get_vendor_orders(vendor_id: str = Path(...)):
    orders = list(
        COLS["orders"].find({
            "$or": [
                {"vendor_id": vendor_id},
                {"vendor_id": str(vendor_id)}
            ]
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
def get_vendor_restock_requests(vendor_id: str = Path(...)):
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


@app.get("/vendors/{vendor_id}/demands")
def get_vendor_demands(vendor_id: str = Path(...)):
    demands = list(
        COLS["restock_requests"].find({
            "$or": [
                {"vendor_id": vendor_id},
                {"vendor_id": str(vendor_id)}
            ]
        })
    )
    for demand in demands:
        demand["_id"] = str(demand["_id"])
    return {
        "vendor_id": vendor_id,
        "demands": demands
    }


@app.post("/products")
def create_product(data: dict = Body(...)):
    product_id = data.get("product_id")
    product_name = data.get("product_name")
    if not product_id or not product_name:
        return {"error": "product_id and product_name are required"}
    if COLS["products"].find_one({"product_id": product_id}):
        return {"error": f"Product with product_id {product_id} already exists"}
    product_doc = {
        "product_id": product_id,
        "product_name": product_name,
        "category": data.get("category", ""),
        "unit": data.get("unit", "kg"),
        "shelf_life_hours": data.get("shelf_life_hours", 72),
        "description": data.get("description", ""),
        "created_at": datetime.datetime.utcnow().isoformat()
    }
    result = COLS["products"].insert_one(product_doc)
    product_doc["_id"] = str(result.inserted_id)
    COLS["logs"].insert_one({
        "type": "activity",
        "action": "create_product",
        "product_id": product_id,
        "message": f"Created product {product_name}"
    })
    return {"message": "Product created successfully", "product": product_doc}


@app.get("/products")
def list_products():
    products = list(COLS["products"].find())
    for product in products:
        product["_id"] = str(product["_id"])
    return {"count": len(products), "products": products}


@app.get("/products/{product_id}")
def get_product(product_id: str = Path(...)):
    product = COLS["products"].find_one({"product_id": product_id})
    if product is None and ObjectId.is_valid(product_id):
        product = COLS["products"].find_one({"_id": ObjectId(product_id)})
    if product is None:
        return {"error": "Product not found"}
    product["_id"] = str(product["_id"])
    return {"product": product}


@app.post("/batches")
def create_batch(data: dict = Body(...)):
    # Without vendor_id the batch is "available": exposed for vendors to request.
    vendor_id = data.get("vendor_id")
    product_id = data.get("product_id")
    if not product_id:
        return {"error": "product_id is required"}
    if vendor_id and not _find_vendor(vendor_id):
        return {"error": f"Vendor {vendor_id} not found"}
    product = COLS["products"].find_one({"product_id": product_id})
    if not product:
        return {"error": f"Product {product_id} not found. Create the product first."}
    try:
        volume = float(data.get("volume_kg", data.get("quantity", 0)))
        initial_ph = float(data.get("initial_ph", data.get("initialPH", 4.5)))
    except (TypeError, ValueError):
        return {"error": "volume_kg and initial_ph must be numbers"}
    if volume <= 0:
        return {"error": "volume_kg must be greater than 0"}
    now = datetime.datetime.utcnow()
    # Manufacture time drives batch age, the strongest spoilage input; default: now.
    manufactured_at = now
    if data.get("manufactured_at"):
        try:
            manufactured_at = datetime.datetime.fromisoformat(str(data["manufactured_at"]).replace("Z", "+00:00"))
        except ValueError:
            return {"error": "manufactured_at must be an ISO date-time"}
        if manufactured_at.tzinfo:
            manufactured_at = manufactured_at.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        if manufactured_at > now + datetime.timedelta(minutes=5):
            return {"error": "manufactured_at cannot be in the future"}
    batch_id = data.get("batch_id") or f"BATCH-{product_id}-{now.strftime('%Y%m%d%H%M%S')}"
    if COLS["batches"].find_one({"batch_id": batch_id}):
        return {"error": f"Batch {batch_id} already exists"}
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
        "message": f"Created batch {batch_id} for product {product_id}"
    })
    return {"message": "Batch created successfully", "batch": batch_doc}


@app.get("/batches")
def list_batches(vendor_id: str = None, product_id: str = None, status: str = None, exposed: Optional[bool] = None):
    query = {}
    if vendor_id:
        query["vendor_id"] = vendor_id
    if product_id:
        query["product_id"] = product_id
    if status:
        query["status"] = status
    if exposed is not None:
        query["exposed"] = {"$ne": False} if exposed else False
    batches = list(COLS["batches"].find(query).sort("_id", -1))
    for batch in batches:
        batch["_id"] = str(batch["_id"])
        batch["remaining_kg"] = _batch_remaining(batch)
        batch["volume_kg"] = _batch_volume(batch)
        batch["threshold_kg"] = _batch_threshold(batch)
    return {"count": len(batches), "batches": batches}


@app.post("/batches/{batch_id}/visibility")
def set_batch_visibility(batch_id: str = Path(...), data: dict = Body(...)):
    """Admin hides/exposes an unassigned batch from the vendors' request list."""
    result = COLS["batches"].update_one(
        {"batch_id": batch_id, "status": "available"},
        {"$set": {"exposed": bool(data.get("exposed")), "updated_at": datetime.datetime.utcnow()}}
    )
    if result.matched_count == 0:
        return {"error": "Only available (unassigned) batches can be exposed or hidden"}
    return {"message": "Batch visibility updated", "batch_id": batch_id, "exposed": bool(data.get("exposed"))}


@app.get("/batches/{batch_id}")
def get_batch(batch_id: str = Path(...)):
    batch = COLS["batches"].find_one({"batch_id": batch_id})
    if batch is None and ObjectId.is_valid(batch_id):
        batch = COLS["batches"].find_one({"_id": ObjectId(batch_id)})
    if batch is None:
        return {"error": "Batch not found"}
    batch["_id"] = str(batch["_id"])
    return {"batch": batch}


@app.post("/inventory")
def create_inventory(data: dict = Body(...)):
    vendor_id = data.get("vendor_id")
    product_id = data.get("product_id")
    if not vendor_id or not product_id:
        return {"error": "vendor_id and product_id are required"}
    vendor = COLS["vendors"].find_one({
        "$or": [{"vendor_id": vendor_id}, {"_id": ObjectId(vendor_id) if ObjectId.is_valid(vendor_id) else None}]
    })
    if not vendor:
        return {"error": f"Vendor {vendor_id} not found"}
    product = COLS["products"].find_one({"product_id": product_id})
    if not product:
        return {"error": f"Product {product_id} not found. Create the product first."}
    quantity = float(data.get("quantity", 0))
    if quantity < 0:
        return {"error": "quantity must be >= 0"}
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
def list_inventory(vendor_id: str = None, product_id: str = None):
    query = {}
    if vendor_id:
        query["vendor_id"] = vendor_id
    if product_id:
        query["product_id"] = product_id
    items = list(COLS["inventory"].find(query))
    for item in items:
        item["_id"] = str(item["_id"])
    return {"count": len(items), "inventory": items}


def _latest_weather():
    return COLS["weather_forecast"].find_one(sort=[("forecastFor", -1)]) or {}


def _active_festival_type():
    """festivalType of a festival whose window covers today, else "none"."""
    today = datetime.datetime.utcnow()
    for festival in COLS["festival_calendar"].find({
        "date": {"$lte": today, "$gte": today - datetime.timedelta(days=31)}
    }):
        days = int(_field(festival, "windowDays", "window_days", default=1))
        if festival["date"] + datetime.timedelta(days=days) > today:
            return _field(festival, "festivalType", "festival_type", default="none")
    return "none"


def _encode(encoder, value, default=0):
    try:
        return int(encoder.transform([value])[0])
    except Exception:
        return default


def _demand_shared_context():
    now = datetime.datetime.now()
    hour = now.hour
    weekday = now.weekday()

    weather = _latest_weather()
    festival_type = _active_festival_type()

    return {
        "hourSin": math.sin(2 * math.pi * hour / 24),
        "hourCos": math.cos(2 * math.pi * hour / 24),
        "weekdaySin": math.sin(2 * math.pi * weekday / 7),
        "weekdayCos": math.cos(2 * math.pi * weekday / 7),
        "isWeekend": 1 if weekday >= 5 else 0,
        "isFestivalWindow": 0 if festival_type == "none" else 1,
        "festivalTypeEnc": _encode(demand_bundle["festival_encoder"], festival_type, 1),
        "forecastTemperatureC": float(_field(weather, "temperatureC", "temperature_c", default=30.0)),
        "forecastRainProbability": float(_field(weather, "rainProbability", "rain_probability", default=0.1)),
    }


def _find_vendor(vendor_id):
    query = {"vendor_id": vendor_id}
    if ObjectId.is_valid(vendor_id):
        query = {"$or": [{"_id": ObjectId(vendor_id)}, {"vendor_id": vendor_id}]}
    return COLS["vendors"].find_one(query)


HISTORY_FEATURES = ["lag1", "lag7", "sameSlot4WeekMean", "rolling7DayMean", "rolling7DayStd", "recentTrend"]
# Vendors store "commercial"; the model was trained on "commercial_offices".
LOCALITY_ALIASES = {"commercial": "commercial_offices"}


def _batch_chip(batch):
    return {
        "batch_id": batch.get("batch_id"),
        "remaining_kg": round(_batch_remaining(batch), 2),
        "status": batch.get("status"),
        "received_at": _field(batch, "received_at", "assigned_at", "created_at"),
    }


def _vendor_forecast(vendor, ctx):
    """Forecast only the products the vendor actually holds batches of."""
    by_label, unsupported = {}, set()
    for batch in _held_batches(vendor):
        label = _model_label(_field(batch, "product_name", "product_id"))
        if label:
            by_label.setdefault(label, []).append(batch)
        else:
            unsupported.add(_field(batch, "product_name", "product_id"))

    # Latest DEMAND feature snapshot per product. The ML pipeline writes these in
    # camelCase with the inputs nested under featureVector.
    history = {}
    for snap in COLS["feature_snapshots"].find({
        "vendorId": {"$in": _vendor_id_values(vendor)},
        "predictionType": "DEMAND",
    }).sort("windowEnd", -1):
        label = _model_label(snap.get("productId"))
        if label and label not in history:
            history[label] = snap.get("featureVector") or {}

    locality = _field(vendor, "localityTier", "locality_tier", default="mixed")
    vendor_features = {
        "localityTierEnc": _encode(demand_bundle["locality_encoder"], LOCALITY_ALIASES.get(locality, locality),
                                   _encode(demand_bundle["locality_encoder"], "mixed")),
        # shortcut: mid-range of training data (3-33) when a vendor has no score
        "hotspotDensityScore": float(_field(vendor, "hotspotDensityScore", "hotspot_density_score", default=18)),
    }

    forecasts = []
    for label, batches in sorted(by_label.items()):
        snapshot = history.get(label)
        row = {
            **ctx,
            **vendor_features,
            # No snapshot = no recorded sales yet: cold start with zero history.
            **{name: float((snapshot or {}).get(name, 0.0)) for name in HISTORY_FEATURES},
            "productIdEnc": _encode(demand_bundle["product_encoder"], label),
        }
        df_input = pd.DataFrame([row])[demand_bundle["features"]]
        demand = round(float(np.clip(demand_bundle["model"].predict(df_input)[0], 0, None)), 1)
        safety = round(float(demand_bundle["safety_stock"].get(label, 0.0)), 1)
        stock = round(sum(_batch_remaining(b) for b in batches), 1)

        deficit = round(max(0.0, demand - stock), 1)
        refill = round(deficit + safety, 1) if deficit > 0 else 0.0

        forecasts.append({
            "product_name": _field(batches[0], "product_name", default=label),
            "model_product": label,
            "predicted_demand": demand,
            "safety_stock": safety,
            "recommended_stock": round(demand + safety, 1),
            "current_stock": stock,
            "deficit": deficit,
            "refill_quantity": refill,
            "restock_needed": deficit > 0,
            "status": "Restock Needed" if deficit > 0 else "No Restock Needed",
            "has_sales_history": snapshot is not None,
            "batches": [_batch_chip(b) for b in batches],
        })

    return forecasts, sorted(unsupported)


def _forecast_response(vendor, ctx):
    forecasts, unsupported = _vendor_forecast(vendor, ctx)
    response = {
        "vendor_id": vendor.get("vendor_id"),
        "count": len(forecasts),
        "forecast": forecasts,
        "unsupported_products": unsupported,
    }
    if unsupported:
        response["message"] = f"The demand model has no data for: {', '.join(unsupported)}"
    elif not forecasts:
        response["message"] = "No batches assigned to this vendor"
    return response


@app.get("/vendors/{vendor_id}/demand-forecast")
def get_demand_forecast(vendor_id: str = Path(...)):
    if not demand_bundle:
        return {"error": "Demand model not loaded"}
    vendor = _find_vendor(vendor_id)
    if not vendor:
        return {"error": "Vendor not found"}
    return _forecast_response(vendor, _demand_shared_context())


@app.get("/demand-forecast")
def get_all_demand_forecasts(vendor_id: Optional[str] = None):
    if not demand_bundle:
        return {"error": "Demand model not loaded"}

    ctx = _demand_shared_context()
    if vendor_id:
        vendor = _find_vendor(vendor_id)
        if not vendor:
            return {"error": "Vendor not found"}
        return _forecast_response(vendor, ctx)

    results = []
    for vendor in COLS["vendors"].find({"vendor_id": {"$exists": True}}):
        for row in _vendor_forecast(vendor, ctx)[0]:
            results.append({"vendor_id": vendor["vendor_id"], **row})
    return {"count": len(results), "forecast": results}


def risk_label_for(score):
    """<=30 Low, 30-70 Medium, >70 High (score is 0-100)."""
    if score <= 30:
        return "Low"
    return "Medium" if score <= 70 else "High"


RISK_ACTIONS = {
    "High": "Urgent: sell first or return",
    "Medium": "Monitor temperature closely",
    "Low": "Normal shelf rotation",
}
STORAGE_ALIASES = {"refrigerated": "fridge"}


def _shelf_life_hours(batch, has_fridge):
    """Product shelf life for the vendor's storage: fridge vs room temperature."""
    keys = ("shelf_life_fridge_hrs", "shelf_life_hours") if has_fridge else ("shelf_life_ambient_hrs",)
    name = _product_key(_field(batch, "product_name", "product_id"))
    for product in COLS["products"].find():
        same = product.get("product_id") == batch.get("product_id") or _product_key(product.get("product_name")) == name
        if same and _field(product, *keys) is not None:
            return float(_field(product, *keys))
    # shortcut: catalog has no shelf life for this product; typical idli batter values
    return 72.0 if has_fridge else 24.0


def _spoilage_features(vendor, batch, weather):
    """Model inputs for one batch, computed the way the training data defined them."""
    has_fridge = 1 if _field(vendor, "hasRefrigerator", "has_refrigerator", default=True) else 0
    storage = _field(vendor, "storageType", "storage_type", default="")
    storage = STORAGE_ALIASES.get(storage, storage)
    if storage not in spoilage_bundle["storage_encoder"].classes_:
        storage = "fridge" if has_fridge else "counter"

    ambient = float(_field(batch, "ambient_temperature_c", "ambientTemperatureC",
                           default=_field(weather, "temperatureC", "temperature_c", default=30.0)))
    # Training data uses -1 as the fridge temperature of shops without a fridge.
    fridge = float(_field(batch, "fridge_temperature_c", "fridgeTemperatureC",
                          default=_field(vendor, "fridgeTemperatureC", "fridge_temperature_c", default=4.0))) if has_fridge else -1.0

    # Stored hour counts were true when the record was written; age them since.
    elapsed = _hours_since(batch.get("created_at")) or 0.0
    manufactured = _field(batch, "manufactured_at", "mfgTimestamp")
    hours_mfg = _hours_since(manufactured) if manufactured else \
        float(_field(batch, "hours_since_manufacture", "hoursSinceManufacture", default=0)) + elapsed
    received = batch.get("received_at")
    hours_shelf = _hours_since(received) if received else \
        float(_field(batch, "hours_on_shelf", "hoursOnShelf", default=0))
    expires = batch.get("expires_at")
    if isinstance(expires, datetime.datetime):  # older batches carry a fixed expiry
        hours_expiry = (expires - datetime.datetime.utcnow()).total_seconds() / 3600
    elif _field(batch, "hours_to_expiry", "hoursToExpiry") is not None:
        hours_expiry = float(_field(batch, "hours_to_expiry", "hoursToExpiry")) - elapsed
    else:
        hours_expiry = _shelf_life_hours(batch, has_fridge) - hours_mfg

    volume = _batch_volume(batch)
    sell_through = _field(batch, "sell_through_rate", "sellThroughRate")
    if sell_through is None:
        sell_through = 1 - _batch_remaining(batch) / volume if volume else 0.0

    return {
        "initialPH": float(_field(batch, "initial_ph", "initialPH", default=4.5)),
        "hoursSinceManufacture": hours_mfg,
        "hasRefrigerator": has_fridge,
        "storageTypeEnc": _encode(spoilage_bundle["storage_encoder"], storage),
        "ambientTemperatureC": ambient,
        "humidityPct": float(_field(batch, "humidity_pct", "humidityPct",
                                    default=_field(weather, "humidityPct", default=65.0))),
        "fridgeTemperatureC": fridge,
        "hoursOnShelf": hours_shelf,
        "sellThroughRate": float(sell_through),
        "effectiveTemperatureExposure": (fridge if has_fridge else ambient) * hours_mfg,
        "hoursToExpiry": max(0.0, hours_expiry),
        "volumeKg": volume,
        "vendorRating": float(_field(vendor, "rating", "vendor_rating", "vendorRating", default=4.0)),
    }


def _batch_evaluation(vendor, batch, weather):
    """Stock state of a held batch plus its model spoilage risk (0-100)."""
    remaining = _batch_remaining(batch)
    threshold = _batch_threshold(batch)
    row = {
        "batch_id": batch.get("batch_id"),
        "product_name": _field(batch, "product_name", "product_id", default="Batter"),
        "status": batch.get("status"),
        "volume_kg": _batch_volume(batch),
        "remaining_kg": round(remaining, 2),
        "threshold_kg": threshold,
        "low_stock": remaining <= threshold,
        "received_at": batch.get("received_at"),
        "assigned_at": batch.get("assigned_at"),
        "expires_at": batch.get("expires_at"),
    }
    if not spoilage_bundle:
        return row

    df_input = pd.DataFrame([_spoilage_features(vendor, batch, weather)])[spoilage_bundle["features"]]
    probas = spoilage_bundle["model"].predict_proba(df_input)[0]
    classes = spoilage_bundle["label_encoder"].inverse_transform(spoilage_bundle["model"].classes_)
    prob = {str(c): float(p) for c, p in zip(classes, probas)}
    score = round(prob.get("High", 0) * 100 + prob.get("Medium", 0) * 50, 1)
    label = risk_label_for(score)
    return {
        **row,
        "risk_score": score,
        "risk_label": label,
        "probabilities": {k: round(v, 3) for k, v in prob.items()},
        "action": RISK_ACTIONS[label],
    }


@app.get("/vendors/{vendor_id}/batches")
def get_vendor_batches(vendor_id: str = Path(...)):
    vendor = _find_vendor(vendor_id)
    if not vendor:
        return {"error": "Vendor not found"}
    weather = _latest_weather()
    batches = [_batch_evaluation(vendor, b, weather) for b in _held_batches(vendor)]
    batches.sort(key=lambda b: b["remaining_kg"] - b["threshold_kg"])
    return {
        "vendor_id": vendor.get("vendor_id"),
        "count": len(batches),
        "low_stock_count": sum(1 for b in batches if b["low_stock"]),
        "batches": batches,
    }


@app.get("/vendors/{vendor_id}/spoilage-risk")
def get_vendor_spoilage_risk(vendor_id: str = Path(...)):
    if not spoilage_bundle:
        return {"error": "Spoilage model not loaded"}
    vendor = _find_vendor(vendor_id)
    if not vendor:
        return {"error": "Vendor not found"}

    weather = _latest_weather()
    evaluations = [_batch_evaluation(vendor, b, weather) for b in _held_batches(vendor)]
    if not evaluations:
        return {
            "vendor_id": vendor.get("vendor_id"),
            "count": 0,
            "message": "No batches assigned to this vendor",
            "aggregate_risk_score": None,
            "aggregate_risk_label": None,
            "summary": {"high": 0, "medium": 0, "low": 0},
            "evaluations": [],
        }

    evaluations.sort(key=lambda e: -e["risk_score"])
    # Volume-weighted: a nearly empty risky batch matters less than a full one.
    total_kg = sum(e["remaining_kg"] for e in evaluations)
    aggregate = round(sum(e["risk_score"] * e["remaining_kg"] for e in evaluations) / total_kg, 1)
    return {
        "vendor_id": vendor.get("vendor_id"),
        "count": len(evaluations),
        "aggregate_risk_score": aggregate,
        "aggregate_risk_label": risk_label_for(aggregate),
        "summary": {
            level.lower(): sum(1 for e in evaluations if e["risk_label"] == level)
            for level in ("High", "Medium", "Low")
        },
        "evaluations": evaluations,
    }


@app.post("/vendors/{vendor_id}/demands")
def create_demand(
    vendor_id: str = Path(...),
    data: dict = Body(...)
):

    items = data.get("items", [])

    if not items:
        return {
            "error": "No products selected"
        }

    demand_items = []

    for item in items:

        # Batch-wise request: the vendor asks for one specific exposed batch.
        batch_id = item.get("batch_id")
        if batch_id:
            if len(items) != 1:
                return {"error": "Request one batch at a time"}
            if not _find_vendor(vendor_id):
                return {"error": "Vendor not found"}
            batch = COLS["batches"].find_one({
                "batch_id": batch_id, "status": "available", "exposed": {"$ne": False}
            })
            if not batch:
                return {"error": f"Batch {batch_id} is not available"}
            if COLS["restock_requests"].find_one({
                "vendor_id": vendor_id, "status": "pending", "items.batch_id": batch_id
            }):
                return {"error": f"Batch {batch_id} is already requested"}
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
            return {
                "error": "product_id is required"
            }

        if quantity <= 0:
            return {
                "error": "Quantity must be greater than 0"
            }

        inventory = COLS["inventory"].find_one({
            "vendor_id": vendor_id,
            "product_id": product_id
        })

        if not inventory:
            return {
                "error": f"Product {product_id} is not mapped"
            }

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
        "demand_id": demand_id
    })

    return {
        "message": "Demand created",
        "demand_id": demand_id,
        "status": "pending"
    }




@app.post("/vendors/{vendor_id}/demands/{demand_id}/confirm")
def confirm_demand(vendor_id: str = Path(...), demand_id: str = Path(...)):
    if not ObjectId.is_valid(demand_id):
        return {
            "error": "Invalid demand ID"
        }

    demand = COLS["restock_requests"].find_one({"_id": ObjectId(demand_id), "vendor_id": vendor_id})
    if not demand:
        return {
            "error": "Demand not found"
        }

    # Batch request: confirming = the admin assigns the batch to this vendor.
    now = datetime.datetime.utcnow()
    batch_ids = [item["batch_id"] for item in demand.get("items", []) if item.get("batch_id")]
    if batch_ids:
        if demand.get("status") != "pending":
            return {"error": "Only pending requests can be assigned"}
        for batch_id in batch_ids:
            batch = COLS["batches"].find_one_and_update(
                {"batch_id": batch_id, "status": "available"},
                {"$set": {"status": "assigned", "vendor_id": vendor_id, "assigned_at": now, "updated_at": now},
                 "$push": {"assignment_log": {"vendor_id": vendor_id, "assigned_at": now,
                                              "assigned_by": "Admin", "request_id": demand_id}}},
                return_document=ReturnDocument.AFTER
            )
            if not batch:
                return {"error": f"Batch {batch_id} is no longer available"}
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

    return {
        "message": "Demand confirmed",
        "demand_id": demand_id,
        "status": "confirmed"
    }


@app.post("/vendors/{vendor_id}/demands/{demand_id}/reject")
def reject_demand(vendor_id: str = Path(...), demand_id: str = Path(...), data: dict = Body(default={})):
    if not ObjectId.is_valid(demand_id):
        return {"error": "Invalid demand ID"}
    result = COLS["restock_requests"].update_one(
        {"_id": ObjectId(demand_id), "vendor_id": vendor_id, "status": "pending"},
        {"$set": {"status": "rejected", "rejected_at": datetime.datetime.utcnow(),
                  "admin_notes": data.get("reason", "")}}
    )
    if result.matched_count == 0:
        return {"error": "Pending demand not found"}
    return {"message": "Demand rejected", "demand_id": demand_id, "status": "rejected"}


@app.post("/vendors/{vendor_id}/batches/{batch_id}/receive")
def receive_batch(vendor_id: str = Path(...), batch_id: str = Path(...)):
    """Vendor confirms delivery of an assigned batch; closes the matching request."""
    vendor = _find_vendor(vendor_id)
    if not vendor:
        return {"error": "Vendor not found"}
    now = datetime.datetime.utcnow()
    batch = COLS["batches"].find_one_and_update(
        {"batch_id": batch_id, "vendor_id": {"$in": _vendor_id_values(vendor)}, "status": "assigned"},
        {"$set": {"status": "received", "received_at": now, "updated_at": now}},
        return_document=ReturnDocument.AFTER
    )
    if not batch:
        return {"error": f"Batch {batch_id} is not awaiting delivery for this vendor"}
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


@app.post("/orders")
def create_order(data: dict = Body(...)):
    """Customer purchase: deducts kg from a batch (or FEFO across the vendor's batches)."""
    vendor = _find_vendor(str(data.get("vendor_id") or ""))
    if not vendor:
        return {"error": "Vendor not found"}
    try:
        quantity = float(data.get("quantity_kg", data.get("quantity", 0)))
    except (TypeError, ValueError):
        return {"error": "quantity_kg must be a number"}
    if not quantity > 0:
        return {"error": "quantity_kg must be greater than 0"}

    query = {"vendor_id": {"$in": _vendor_id_values(vendor)}, "status": {"$in": SELLABLE_STATUSES}}
    if data.get("batch_id"):
        query["batch_id"] = data["batch_id"]
    batches = [b for b in COLS["batches"].find(query) if _batch_remaining(b) > 0]
    product = data.get("product_name") or data.get("product_id")
    if product and not data.get("batch_id"):
        batches = [b for b in batches if product in (b.get("product_id"), b.get("product_name"))
                   or _product_key(product) == _product_key(_field(b, "product_name", "product_id"))]
    # First-expiring (else oldest) batch sells first.
    def fefo(batch):
        when = _field(batch, "expires_at", "manufactured_at", "mfgTimestamp")
        return when if isinstance(when, datetime.datetime) else datetime.datetime.max
    batches.sort(key=fefo)
    available = sum(_batch_remaining(b) for b in batches)
    if not batches or available < quantity:
        return {"error": f"Only {round(available, 2)} kg available"}

    now = datetime.datetime.utcnow()
    left, deductions, alerts = quantity, [], []
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
            return {"error": f"Batch {batch['batch_id']} changed during the sale, please retry",
                    "deducted": deductions}
        left -= take
        deductions.append({"batch_id": batch["batch_id"], "quantity_kg": round(take, 3), "remaining_kg": after})
        _adjust_inventory(vendor["vendor_id"], batch, -take)
        COLS["inventory_movement"].insert_one({
            "vendorId": vendor["vendor_id"], "productId": _field(batch, "product_id", "product_name"),
            "batchId": batch["batch_id"], "movementType": "sale", "quantity": round(take, 3),
            "occurredAt": now, "triggeredBy": data.get("customer_id") or "customer",
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
        "user_id": data.get("customer_id"),
        "product_name": product or batches[0].get("product_name"),
        "quantity_kg": quantity,
        "batches": deductions,
        "order_status": "completed",
        "order_date": now,
    }
    COLS["orders"].insert_one(dict(order))
    return {"message": "Order placed", "order": order, "alerts": alerts}


@app.post("/vendors/{vendor_id}/inventory/sync")
def sync_inventory(vendor_id: str = Path(...)):
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
def get_pending_vendors():
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


@app.get("/users/{user_id}")
def get_user(user_id: str = Path(...)):
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
        return {
            "error": "User not found"
        }

    user["_id"] = str(user["_id"])

    return {
        "user": user
    }


@app.post("/restock-requests")
def create_restock_request(data: dict = Body(...)):
    vendor_id = data.get("vendor_id")

    if not vendor_id:
        return {
            "error": "vendor_id is required"
        }

    data.setdefault(
        "status",
        "pending"
    )

    req = COLS["restock_requests"].insert_one(data)
    req_id = str(req.inserted_id)

    order = COLS["orders"].insert_one({
        "vendor_id": vendor_id,
        "restock_request_id": req_id,
        "items": data.get("items", []),
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
    vendor_id: str = None
):
    query = {}

    if status:
        query["status"] = status

    if vendor_id:
        query["vendor_id"] = vendor_id

    requests = list(
        COLS["restock_requests"].find(query)
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

    user = COLS["users"].find_one({"$or": [{"email": login_id}, {"phone": login_id}]})
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

    response = {"message": "Customer login successful", "customer": customer}
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
