import os
import math
import datetime
import warnings
from pathlib import Path as FilePath
from typing import Optional
from fastapi import FastAPI, Body, HTTPException, status
from fastapi import FastAPI, HTTPException, Path, Body
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pymongo import MongoClient
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
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
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

    if not email or not password:
        return {"error": "Email and password are required to create a vendor account"}

    if vendor_id and COLS["vendors"].find_one({"vendor_id": vendor_id}):
        return {"error": "Vendor with this vendor_id already exists"}

    if COLS["users"].find_one({"email": email}):
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
        "locality_tier": data.get("locality_tier", "mixed"),
        "status": data.get("status", "pending"),
        "location": vendor_location,
        "email": email,
        "phone": phone
    }
    if vendor_coords:
        vendor_doc["location_geo"] = {
            "type": "Point",
            "coordinates": [vendor_coords[1], vendor_coords[0]]
        }

    vendor_result = COLS["vendors"].insert_one(vendor_doc)
    vendor_doc["_id"] = str(vendor_result.inserted_id)


    user_doc = {
        "user_id": vendor_id or vendor_doc["_id"],
        "email": email,
        "phone": phone,
        "password_hash": hash_password(password),
        "role": "vendor",
        "is_verified": data.get("is_verified", True)  # Set default verification
    }

    user_result = COLS["users"].insert_one(user_doc)

    COLS["logs"].insert_one({
        "type": "activity",
        "action": "create_vendor",
        "vendor_id": vendor_doc["_id"],
        "user_id": str(user_result.inserted_id),
        "message": f"Registered new vendor {data.get('shop_name', '')}"
    })

    return {
        "message": "Vendor and User account created successfully",
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
        return {
            "count": 0,
            "products": []
        }

    products = list(
        COLS["products"].find(query)
    )

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
    batch_id = data.get("batch_id") or f"BATCH-{vendor_id}-{product_id}-{datetime.datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    if COLS["batches"].find_one({"batch_id": batch_id}):
        return {"error": f"Batch {batch_id} already exists"}
    batch_doc = {
        "batch_id": batch_id,
        "vendor_id": vendor_id,
        "product_id": product_id,
        "product_name": product.get("product_name"),
        "quantity": float(data.get("quantity", 0)),
        "initial_ph": float(data.get("initial_ph", data.get("initialPH", 4.5))),
        "hours_since_manufacture": float(data.get("hours_since_manufacture", data.get("hoursSinceManufacture", 0))),
        "ambient_temperature_c": float(data.get("ambient_temperature_c", data.get("ambientTemperatureC", 30.0))),
        "humidity_pct": float(data.get("humidity_pct", data.get("humidityPct", 65.0))),
        "fridge_temperature_c": float(data.get("fridge_temperature_c", data.get("fridgeTemperatureC", 4.0))),
        "hours_on_shelf": float(data.get("hours_on_shelf", data.get("hoursOnShelf", 0))),
        "sell_through_rate": float(data.get("sell_through_rate", data.get("sellThroughRate", 0.5))),
        "hours_to_expiry": float(data.get("hours_to_expiry", data.get("hoursToExpiry", 72.0))),
        "status": data.get("status", "active"),
        "created_at": datetime.datetime.utcnow().isoformat()
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
def list_batches(vendor_id: str = None, product_id: str = None):
    query = {}
    if vendor_id:
        query["vendor_id"] = vendor_id
    if product_id:
        query["product_id"] = product_id
    batches = list(COLS["batches"].find(query))
    for batch in batches:
        batch["_id"] = str(batch["_id"])
    return {"count": len(batches), "batches": batches}


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


@app.get("/vendors/{vendor_id}/demand-forecast")
def get_demand_forecast(vendor_id: str = Path(...)):
    if not demand_bundle:
        return {"error": "Demand model not loaded"}

    query = {"vendor_id": vendor_id}
    if ObjectId.is_valid(vendor_id):
        query = {"$or": [{"_id": ObjectId(vendor_id)}, {"vendor_id": vendor_id}]}

    vendor = COLS["vendors"].find_one(query)
    if not vendor:
        return {"error": "Vendor not found"}

    vid = vendor.get("vendor_id", vendor_id)

    now = datetime.datetime.now()
    hour = now.hour
    weekday = now.weekday()
    is_weekend = 1 if weekday >= 5 else 0

    hour_sin = math.sin(2 * math.pi * hour / 24)
    hour_cos = math.cos(2 * math.pi * hour / 24)
    weekday_sin = math.sin(2 * math.pi * weekday / 7)
    weekday_cos = math.cos(2 * math.pi * weekday / 7)

    locality_tier = vendor.get("locality_tier", "mixed")
    hotspot_score = float(vendor.get("hotspot_density_score", 0.5))

    try:
        locality_enc = int(demand_bundle["locality_encoder"].transform([locality_tier])[0])
    except Exception:
        locality_enc = 0

    weather = COLS["weather_forecast"].find_one() or {}
    temperature = float(weather.get("temperature_c", 30.0))
    rain_prob = float(weather.get("rain_probability", 0.1))

    festival = COLS["festival_calendar"].find_one() or {}
    is_festival = int(festival.get("is_festival", 0))
    festival_type = festival.get("festival_type", "none")

    try:
        festival_enc = int(demand_bundle["festival_encoder"].transform([festival_type])[0])
    except Exception:
        festival_enc = 1

    inventory_items = list(COLS["inventory"].find({
        "$or": [{"vendor_id": vid}, {"vendor_id": vendor_id}]
    }))

    stock_map = {}
    for item in inventory_items:
        name = item.get("product_name", item.get("product_id"))
        stock_map[name] = float(item.get("quantity", 0))

    products = list(demand_bundle["product_encoder"].classes_)
    forecasts = []

    for product_name in products:
        snapshot = COLS["feature_snapshots"].find_one({
            "vendor_id": vid,
            "product_id": product_name
        }) or {}

        lag1 = float(snapshot.get("lag1", 15.0))
        lag7 = float(snapshot.get("lag7", 14.0))
        same_slot_mean = float(snapshot.get("sameSlot4WeekMean", 16.0))
        rolling_mean = float(snapshot.get("rolling7DayMean", 15.0))
        rolling_std = float(snapshot.get("rolling7DayStd", 3.0))
        recent_trend = float(snapshot.get("recentTrend", 1.0))
        product_enc = int(demand_bundle["product_encoder"].transform([product_name])[0])

        feature_row = {
            "hourSin": hour_sin,
            "hourCos": hour_cos,
            "weekdaySin": weekday_sin,
            "weekdayCos": weekday_cos,
            "isWeekend": is_weekend,
            "isFestivalWindow": is_festival,
            "festivalTypeEnc": festival_enc,
            "forecastTemperatureC": temperature,
            "forecastRainProbability": rain_prob,
            "lag1": lag1,
            "lag7": lag7,
            "sameSlot4WeekMean": same_slot_mean,
            "rolling7DayMean": rolling_mean,
            "rolling7DayStd": rolling_std,
            "recentTrend": recent_trend,
            "localityTierEnc": locality_enc,
            "hotspotDensityScore": hotspot_score,
            "productIdEnc": product_enc
        }

        df_input = pd.DataFrame([feature_row])[demand_bundle["features"]]
        predicted_demand = float(np.clip(demand_bundle["model"].predict(df_input)[0], 0, None))
        safety_stock = float(demand_bundle["safety_stock"].get(product_name, 5.0))
        current_stock = stock_map.get(product_name, 0.0)
        recommended_order = max(0, int(round(predicted_demand + safety_stock - current_stock)))

        forecasts.append({
            "product_name": product_name,
            "predicted_demand": round(predicted_demand, 1),
            "safety_stock": round(safety_stock, 1),
            "current_stock": round(current_stock, 1),
            "recommended_order": recommended_order
        })

    return {
        "vendor_id": vid,
        "count": len(forecasts),
        "forecast": forecasts
    }


@app.get("/vendors/{vendor_id}/spoilage-risk")
def get_vendor_spoilage_risk(vendor_id: str = Path(...)):
    if not spoilage_bundle:
        return {"error": "Spoilage model not loaded"}

    query = {"vendor_id": vendor_id}
    if ObjectId.is_valid(vendor_id):
        query = {"$or": [{"_id": ObjectId(vendor_id)}, {"vendor_id": vendor_id}]}

    vendor = COLS["vendors"].find_one(query)
    if not vendor:
        return {"error": "Vendor not found"}

    vid = vendor.get("vendor_id", vendor_id)

    has_refrigerator = 1 if vendor.get("has_refrigerator", True) else 0
    storage_type = vendor.get("storage_type", "fridge" if has_refrigerator else "counter")

    try:
        storage_enc = int(spoilage_bundle["storage_encoder"].transform([storage_type])[0])
    except Exception:
        storage_enc = 0

    vendor_rating = float(vendor.get("rating", vendor.get("vendor_rating", 4.0)))

    batches = list(COLS["batches"].find({
        "$or": [{"vendor_id": vid}, {"vendor_id": vendor_id}]
    }))

    if not batches:
        batches = list(COLS["inventory"].find({
            "$or": [{"vendor_id": vid}, {"vendor_id": vendor_id}]
        }))

    if not batches:
        return {
            "vendor_id": vid,
            "message": "No active batches found for this vendor",
            "evaluations": []
        }

    evaluations = []

    for b in batches:
        batch_id = str(b.get("batch_id", b.get("batch_number", b.get("_id", "unknown"))))
        product_name = b.get("product_name", "Batter")

        ph = float(b.get("initial_ph", b.get("initialPH", 4.5)))
        hours_mfg = float(b.get("hours_since_manufacture", b.get("hoursSinceManufacture", 12.0)))
        ambient_temp = float(b.get("ambient_temperature_c", b.get("ambientTemperatureC", 30.0)))
        humidity = float(b.get("humidity_pct", b.get("humidityPct", 65.0)))
        fridge_temp = float(b.get("fridge_temperature_c", b.get("fridgeTemperatureC", 4.0 if has_refrigerator else ambient_temp)))
        hours_shelf = float(b.get("hours_on_shelf", b.get("hoursOnShelf", 4.0)))
        sell_through = float(b.get("sell_through_rate", b.get("sellThroughRate", 0.5)))
        effective_temp = fridge_temp if has_refrigerator else ambient_temp
        hours_expiry = float(b.get("hours_to_expiry", b.get("hoursToExpiry", max(1.0, 72.0 - hours_mfg))))
        volume = float(b.get("volume_kg", b.get("volumeKg", b.get("quantity", 5.0))))

        row = {
            "initialPH": ph,
            "hoursSinceManufacture": hours_mfg,
            "hasRefrigerator": has_refrigerator,
            "storageTypeEnc": storage_enc,
            "ambientTemperatureC": ambient_temp,
            "humidityPct": humidity,
            "fridgeTemperatureC": fridge_temp,
            "hoursOnShelf": hours_shelf,
            "sellThroughRate": sell_through,
            "effectiveTemperatureExposure": effective_temp,
            "hoursToExpiry": hours_expiry,
            "volumeKg": volume,
            "vendorRating": vendor_rating
        }

        df_input = pd.DataFrame([row])[spoilage_bundle["features"]]
        pred_class = spoilage_bundle["model"].predict(df_input)[0]
        risk_label = str(spoilage_bundle["label_encoder"].inverse_transform([pred_class])[0])

        probas = spoilage_bundle["model"].predict_proba(df_input)[0]
        prob_dict = {
            str(cls): round(float(p), 2)
            for cls, p in zip(spoilage_bundle["label_encoder"].classes_, probas)
        }

        action = "Normal shelf rotation"
        if risk_label == "High":
            action = "Urgent: sell first or return"
        elif risk_label == "Medium":
            action = "Monitor temperature closely"

        evaluations.append({
            "batch_id": batch_id,
            "product_name": product_name,
            "risk_label": risk_label,
            "probabilities": prob_dict,
            "action": action
        })

    return {
        "vendor_id": vid,
        "count": len(evaluations),
        "evaluations": evaluations
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
                "error": f"Product {product_id} is not mapped to this vendor"
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
        "status": "pending"
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
            "error": "Invalid demand_id"
        }

    result = COLS["restock_requests"].update_one(
        {
            "_id": ObjectId(demand_id),
            "vendor_id": vendor_id
        },
        {
            "$set": {
                "status": "confirmed"
            }
        }
    )

    if result.matched_count == 0:
        return {
            "error": "Demand not found"
        }

    return {
        "message": "Demand confirmed",
        "demand_id": demand_id
    }


@app.post("/vendors/{vendor_id}/inventory/sync")
def sync_inventory(vendor_id: str = Path(...)):
    demands = list(
        COLS["restock_requests"].find({
            "vendor_id": vendor_id,
            "status": "confirmed"
        })
    )

    for demand in demands:
        for item in demand.get("items", []):
            COLS["inventory"].update_one(
                {
                    "vendor_id": vendor_id,
                    "product_id": item.get("product_id")
                },
                {
                    "$inc": {
                        "quantity": item.get("quantity", 0)
                    }
                },
                upsert=False
            )

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
        "synced_demands": len(demands)
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
