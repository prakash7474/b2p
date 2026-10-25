"""b2p backend — FastAPI service for the batter-to-parent (b2p) supply chain.

Connects to MongoDB (MONGODB_URI from the project-root .env) and exposes:
  * auth        — /login, /customers/register, /customers/login
  * vendors     — CRUD, nearby geo search, batches, orders, restock requests
  * catalog     — /products, /batches, /inventory
  * ML insights — demand forecast + spoilage risk (joblib model bundles)
  * admin flows — demand confirm/reject, batch visibility, inventory sync

Run with:  python backend/main.py   (uvicorn on 0.0.0.0:5000)
"""

import os
import base64
import hashlib
import hmac
import json
import math
import re
import time
import datetime
import statistics
import warnings
from pathlib import Path as FilePath
from typing import Optional
from fastapi import FastAPI, Body, Depends, Header, HTTPException, Path, status
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument
from bson import ObjectId
import bcrypt
import httpx
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
# Model bundles are joblib pickles stored in <project-root>/models.
# Each bundle holds a trained model, its feature list and fitted encoders.
# ------------------------------------------------------------
MODELS_DIR = BASE_DIR / "models"
warnings.filterwarnings("ignore")


def load_model_bundle(filenames):
    """Load the first joblib bundle found among ``filenames`` in MODELS_DIR.

    Returns None (endpoint handlers then degrade gracefully) when no
    model file can be loaded.
    """
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


# Demand-forecast bundle: model, features, product/locality/festival encoders,
# per-product safety-stock table. Products: Idly_Batter, Dosa_Batter, Combo_Pack.
# The training scripts write the plain names, so a retrained model wins.
demand_bundle = load_model_bundle([
    "demand_forecast_model.pkl",
    "demand_forecast_model (2).pkl"
])

# Spoilage-risk bundle: model, features, storage-type + label encoders.
spoilage_bundle = load_model_bundle([
    "spoilage_risk_model.pkl",
    "spoilage_risk_model (2).pkl"
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
    """bcrypt-hash a plaintext password (salt included)."""
    return bcrypt.hashpw(
        password.encode(),
        bcrypt.gensalt()
    ).decode()


def check_password(password, password_hash):
    """Verify a plaintext password against a stored bcrypt hash."""
    return bcrypt.checkpw(
        password.encode(),
        password_hash.encode()
    )
    

# ------------------------------------------------------------
# Auth: /login and /customers/login hand out an HMAC-signed token
# (user id, role, vendor id, 7-day expiry). Routes read it with
# Depends(current_user) and check it with require_role / require_vendor.
# ------------------------------------------------------------
# shortcut: without AUTH_SECRET the key is derived from MONGODB_URI; set AUTH_SECRET in .env before deploying.
AUTH_SECRET = (os.getenv("AUTH_SECRET") or hashlib.sha256(MONGODB_URI.encode()).hexdigest()).encode()
TOKEN_TTL_SECONDS = 7 * 24 * 3600


def _sign(payload):
    return hmac.new(AUTH_SECRET, payload.encode(), hashlib.sha256).hexdigest()


def issue_token(user_id, role, vendor_id=None):
    """Signed bearer token for a signed-in user."""
    payload = base64.urlsafe_b64encode(json.dumps({
        "sub": str(user_id), "role": role, "vendor_id": vendor_id,
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }).encode()).decode()
    return f"{payload}.{_sign(payload)}"


def _decode_token(authorization):
    token = (authorization or "").removeprefix("Bearer ").strip()
    payload, _, signature = token.partition(".")
    if not payload or not hmac.compare_digest(signature.encode(), _sign(payload).encode()):
        raise HTTPException(status_code=401, detail="Please sign in")
    claims = json.loads(base64.urlsafe_b64decode(payload))
    if claims.get("exp", 0) < time.time():
        raise HTTPException(status_code=401, detail="Session expired, please sign in again")
    return claims


def current_user(authorization: str = Header(default="")):
    """The signed-in caller ({sub, role, vendor_id}); 401 without a valid token."""
    return _decode_token(authorization)


def optional_user(authorization: str = Header(default="")):
    """Like current_user, but None for anonymous callers (public sign-up)."""
    return _decode_token(authorization) if authorization else None


def require_role(user, *roles):
    """Admins may do anything; everyone else needs one of ``roles``."""
    if user["role"] != "admin" and user["role"] not in roles:
        raise HTTPException(status_code=403, detail="You do not have access to this")


def require_vendor(user, vendor_id):
    """Admins, or the vendor the path names (by vendor_id or Mongo _id)."""
    if user["role"] == "admin":
        return
    if user["role"] == "vendor" and user.get("vendor_id"):
        if vendor_id == user["vendor_id"]:
            return
        vendor = _find_vendor(vendor_id)
        if vendor and user["vendor_id"] in _vendor_id_values(vendor):
            return
    raise HTTPException(status_code=403, detail="You can only access your own shop")


def _find_login_user(login_id):
    """User by phone or email; emails match case-insensitively (older rows kept their casing)."""
    return COLS["users"].find_one({"$or": [
        {"email": {"$regex": f"^{re.escape(login_id)}$", "$options": "i"}},
        {"phone": login_id},
    ]})


def _vendor_for_user(user):
    """Vendor document linked to a vendor login (vendors.user_id, vendor_id or _id)."""
    uid = str(user.get("user_id") or "")
    if not uid:
        return None
    query = [{"user_id": uid}, {"vendor_id": uid}]
    if ObjectId.is_valid(uid):
        query.append({"_id": ObjectId(uid)})
    return COLS["vendors"].find_one({"$or": query})


APPROVED_STATUSES = ["active", "approved", "verified"]


def _vendor_status(vendor):
    # Seed vendors keep their state in verificationStatus, app-created ones in status.
    return str(_field(vendor, "status", "verificationStatus", default="pending")).lower()


def _valid_coordinates(latitude, longitude):
    """Return (lat, lon) as floats when both values are in range, else None."""
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


def _location_payload(data):
    """Normalize request location fields into a valid location dict, or None."""
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
    """Persist the given location on the customer linked to this user."""
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
    """All values that may appear as vendor_id for this vendor (field + _id)."""
    values = [vendor.get("vendor_id"), str(vendor.get("_id", ""))]
    return [value for value in values if value]


def find_nearby_vendors(latitude, longitude, radius_meters=5000, product_id=None):
    """Return active vendors within a radius that have stock a customer can buy now."""
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
    results = []
    for vendor in COLS["vendors"].aggregate(pipeline):
        vendor_ids = _vendor_id_values(vendor)
        if not vendor_ids:
            continue
        # Same stock /orders can sell: received batches with kg left that have not expired.
        batch_query = {"vendor_id": {"$in": vendor_ids}, "status": {"$in": SELLABLE_STATUSES}}
        if product_id:
            batch_query["product_id"] = product_id
        stock = {}
        for batch in COLS["batches"].find(batch_query):
            kg = _batch_remaining(batch)
            if kg > 0 and _hours_to_expiry(vendor, batch) > 0:
                item = stock.setdefault(batch.get("product_id"), {
                    "product_id": batch.get("product_id"), "product_name": batch.get("product_name"), "quantity": 0.0})
                item["quantity"] = round(item["quantity"] + kg, 3)
        if not stock:
            continue
        stock_items = list(stock.values())
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
    """Create the indexes the app relies on (geo, lookups) and backfill vendor geo points."""
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
    """On boot: ping MongoDB, backfill vendor geo points and create indexes."""
    client.admin.command("ping")
    ensure_indexes()


# GET / — service health check: database name and the collections we expose.
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


# POST /login — email/phone + password auth; for customers with a location in
# the body it also saves the location and returns nearby vendors with stock.
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

# GET /users — list all users (password hashes stripped); falls back to the
# vendors collection when the users collection is empty.
@app.get("/users")
def get_users(user: dict = Depends(current_user)):
    require_role(user)
    users = list(COLS["users"].find({}, {"password_hash": 0}))
    if not users:
        users = list(COLS["vendors"].find())

    for user in users:
        user["_id"] = str(user["_id"])

    return {
        "count": len(users),
        "users": users
    }


# GET /logs — full activity log for admins; a vendor sees only its own entries.
@app.get("/logs")
def get_logs(user: dict = Depends(current_user)):
    require_role(user, "vendor")
    query = {}
    if user["role"] == "vendor":
        vendor = _find_vendor(user["vendor_id"]) or {}
        query = {"vendor_id": {"$in": _vendor_id_values(vendor) or [user["vendor_id"]]}}
    logs = list(COLS["logs"].find(query))

    for log in logs:
        log["_id"] = str(log["_id"])

    return {
        "count": len(logs),
        "logs": logs
    }


# GET /vendors — with ?latitude=&longitude= returns active nearby vendors that
# have positive stock (geo search, optional product_id + radius_meters);
# without coordinates it returns the full vendor list.
@app.get("/vendors")
def get_vendors(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    radius_meters: float = 5000,
    product_id: Optional[str] = None,
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
    vendors = list(COLS["vendors"].find())
    for vendor in vendors:
        vendor["_id"] = str(vendor["_id"])
    return {"count": len(vendors), "vendors": vendors}


# POST /vendors — register a vendor; with email+password also creates the
# linked vendor user account and an activity log entry. Public sign-ups
# always start "pending" until an admin approves them.
@app.post("/vendors")
def create_vendor(data: dict = Body(...), user: Optional[dict] = Depends(optional_user)):
    is_admin = bool(user) and user["role"] == "admin"
    vendor_id = data.get("vendor_id")
    email = (data.get("email") or "").strip().lower()
    password = data.get("password")
    phone = data.get("phone", "")

    if vendor_id and COLS["vendors"].find_one({"vendor_id": vendor_id}):
        # 409 so clients can tell a clash apart from a successful create.
        raise HTTPException(status_code=409, detail="Vendor with this vendor_id already exists")

    if email and _find_login_user(email):
        return {"error": "User with this email already exists"}

    locality = _locality_tier(data.get("locality_tier", "mixed"))
    if not locality:
        return {"error": f"locality_tier must be one of: {', '.join(LOCALITY_TIERS)}"}

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
            # Vendors can sign in while pending; the pending status gates batch requests.
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


# GET /vendors/{vendor_id} — single vendor by vendor_id or Mongo _id.
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

# GET /vendors/{vendor_id}/products — catalog entries for products this
# vendor has in inventory (empty inventory = full catalog).
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



# GET /vendors/{vendor_id}/inventory — stock rows for one vendor.
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


# GET /inventory/{vendor_id} — alias of /vendors/{vendor_id}/inventory.
@app.get("/inventory/{vendor_id}")
def get_inventory(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    return get_vendor_inventory(vendor_id, user)


# GET /vendors/{vendor_id}/orders — customer orders placed at this vendor.
@app.get("/vendors/{vendor_id}/orders")
def get_vendor_orders(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    require_vendor(user, vendor_id)
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


# GET /vendors/{vendor_id}/restock-requests — restock requests for one vendor.
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


# GET /vendors/{vendor_id}/demands — demand view backed by restock_requests.
@app.get("/vendors/{vendor_id}/demands")
def get_vendor_demands(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    require_vendor(user, vendor_id)
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


# POST /products — add a catalog product. Only the products the demand model
# knows (Idli, Dosa, Combo) are allowed, once each under any spelling.
@app.post("/products")
def create_product(data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
    product_id = data.get("product_id")
    product_name = data.get("product_name")
    if not product_id or not product_name:
        return {"error": "product_id and product_name are required"}
    if COLS["products"].find_one({"product_id": product_id}):
        return {"error": f"Product with product_id {product_id} already exists"}
    if not demand_bundle or not _model_label(product_name):
        return {"error": "Only Idli Batter, Dosa Batter and Combo Pack can be sold (the products the forecast model knows)"}
    duplicate = next((p for p in COLS["products"].find()
                      if _product_key(p.get("product_name")) == _product_key(product_name)), None)
    if duplicate:
        return {"error": f"{product_name} already exists as {duplicate.get('product_id')}"}
    try:
        # Expiry reads these two (fridge vs room temperature); same fields as the seeded catalog.
        fridge_hrs = float(data.get("shelf_life_fridge_hrs", data.get("shelf_life_hours", 72)))
        ambient_hrs = float(data.get("shelf_life_ambient_hrs", 24))
    except (TypeError, ValueError):
        return {"error": "shelf life hours must be numbers"}
    if fridge_hrs <= 0 or ambient_hrs <= 0:
        return {"error": "shelf life hours must be greater than 0"}
    product_doc = {
        "product_id": product_id,
        "product_name": product_name,
        "category": data.get("category", ""),
        "unit": data.get("unit", "kg"),
        "shelf_life_hours": data.get("shelf_life_hours", 72),
        "shelf_life_fridge_hrs": fridge_hrs,
        "shelf_life_ambient_hrs": ambient_hrs,
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


# GET /products — full product catalog.
@app.get("/products")
def list_products(user: dict = Depends(current_user)):
    products = list(COLS["products"].find())
    for product in products:
        product["_id"] = str(product["_id"])
    return {"count": len(products), "products": products}


# GET /products/{product_id} — one product by product_id (or Mongo _id).
@app.get("/products/{product_id}")
def get_product(product_id: str = Path(...), user: dict = Depends(current_user)):
    product = COLS["products"].find_one({"product_id": product_id})
    if product is None and ObjectId.is_valid(product_id):
        product = COLS["products"].find_one({"_id": ObjectId(product_id)})
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    product["_id"] = str(product["_id"])
    return {"product": product}


# POST /batches — create a batch. Without vendor_id it is "available" for
# vendors to request; with vendor_id it is assigned straight to that vendor.
@app.post("/batches")
def create_batch(data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
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


# GET /batches — list batches; filter by vendor_id / product_id / status,
# and exposed=false for the admin's hidden batch list.
@app.get("/batches")
def list_batches(vendor_id: str = None, product_id: str = None, status: str = None, exposed: Optional[bool] = None,
                 user: dict = Depends(current_user)):
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
    batches = list(COLS["batches"].find(query).sort("_id", -1))
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
        return {"error": "Only available (unassigned) batches can be exposed or hidden"}
    return {"message": "Batch visibility updated", "batch_id": batch_id, "exposed": bool(data.get("exposed"))}


# GET /batches/{batch_id} — one batch by batch_id (or Mongo _id).
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


# POST /inventory — map (or overwrite) a product's stock quantity at a vendor.
@app.post("/inventory")
def create_inventory(data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
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


# GET /inventory — list inventory rows (optional vendor_id / product_id filter).
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


WEATHER_MAX_AGE = datetime.timedelta(hours=1)
_weather_tried_at = None


def _refresh_weather():
    """Store this hour's Open-Meteo forecast (free, no API key) for the shop area."""
    hour = datetime.datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    response = httpx.get("https://api.open-meteo.com/v1/forecast", timeout=5, params={
        # Default: Chennai. One reading serves every vendor, like the seeded data did.
        "latitude": float(os.getenv("WEATHER_LAT", "13.08")),
        "longitude": float(os.getenv("WEATHER_LON", "80.27")),
        "hourly": "temperature_2m,relative_humidity_2m,precipitation_probability",
        "timezone": "UTC",
        "forecast_days": 1,
    })
    response.raise_for_status()
    hourly = response.json()["hourly"]
    i = hourly["time"].index(hour.strftime("%Y-%m-%dT%H:%M"))
    doc = {
        "forecastFor": hour,
        "temperatureC": float(hourly["temperature_2m"][i]),
        "humidityPct": float(hourly["relative_humidity_2m"][i]),
        # Training data stores rain probability as 0-1; Open-Meteo sends 0-100.
        "rainProbability": float(hourly["precipitation_probability"][i] or 0) / 100,
        "source": "open-meteo",
        "locationGridKey": os.getenv("WEATHER_GRID_KEY", "chennai_central"),
        "forecastIssuedAt": datetime.datetime.utcnow(),
    }
    COLS["weather_forecast"].update_one(
        {"forecastFor": hour, "source": "open-meteo", "locationGridKey": doc["locationGridKey"]},
        {"$set": doc}, upsert=True)
    return doc


def _latest_weather():
    """Weather for the current hour; refreshed from Open-Meteo (at most hourly) when stale.

    Falls back to the newest stored reading, then {} (model defaults), when offline.
    """
    global _weather_tried_at
    now = datetime.datetime.utcnow()
    latest = COLS["weather_forecast"].find_one({"forecastFor": {"$lte": now}}, sort=[("forecastFor", -1)])
    # Admin "manual_override" rows are daily (forecastFor = midnight) and win for that day.
    max_age = datetime.timedelta(days=1) if (latest or {}).get("source") == "manual_override" else WEATHER_MAX_AGE
    if latest and now - latest["forecastFor"] < max_age:
        return latest
    if _weather_tried_at is None or now - _weather_tried_at > WEATHER_MAX_AGE:
        _weather_tried_at = now
        try:
            return _refresh_weather()
        except Exception as e:
            print(f"[WARN] Weather refresh failed: {e}")
    return latest or COLS["weather_forecast"].find_one(sort=[("forecastFor", -1)]) or {}


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
    """Integer-encode a value with a fitted sklearn encoder, with a fallback."""
    try:
        return int(encoder.transform([value])[0])
    except Exception:
        return default


# The model only knows two sales windows: training rows are hour 8 or hour 18.
SLOT_HOURS = (8, 18)


def _slot_of(moment):
    """(local date, 0 = morning / 1 = evening) for a naive UTC timestamp."""
    local = moment.replace(tzinfo=datetime.timezone.utc).astimezone()
    return local.date(), 0 if local.hour < 13 else 1


def _slot_bounds(slot):
    """(start, end) of a slot as naive UTC: morning is local 00:00-13:00, evening 13:00-24:00."""
    day, window = slot
    local = lambda hour: datetime.datetime.combine(day, datetime.time()) + datetime.timedelta(hours=hour)
    to_utc = lambda moment: moment.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    start, end = (0, 13) if window == 0 else (13, 24)
    return to_utc(local(start)), to_utc(local(end))


def _demand_shared_context():
    """Model features that are the same for every vendor right now:
    time-of-day/week cyclic encodings, weekend + festival flags, latest weather."""
    day, window = _slot_of(datetime.datetime.utcnow())
    hour = SLOT_HOURS[window]
    weekday = day.weekday()

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
    """Find a vendor by vendor_id or, when it is valid, by Mongo _id."""
    query = {"vendor_id": vendor_id}
    if ObjectId.is_valid(vendor_id):
        query = {"$or": [{"_id": ObjectId(vendor_id)}, {"vendor_id": vendor_id}]}
    return COLS["vendors"].find_one(query)


HISTORY_FEATURES = ["lag1", "lag7", "sameSlot4WeekMean", "rolling7DayMean", "rolling7DayStd", "recentTrend"]
# Vendors store "commercial"; the model was trained on "commercial_offices".
LOCALITY_ALIASES = {"commercial": "commercial_offices"}
# The shop surroundings the demand model was trained on; demand differs ~2x between them.
LOCALITY_TIERS = ["commercial_offices", "institutional", "mixed", "residential_budget", "residential_premium"]


def _locality_tier(value):
    """A known locality tier for ``value`` (aliases allowed), else None."""
    tier = LOCALITY_ALIASES.get(value, value)
    return tier if tier in LOCALITY_TIERS else None


def _history_features(series):
    """History inputs from per-slot sales (oldest first, ending at the previous slot),
    computed exactly as the training CSV defines them (2 slots per day)."""
    s = list(series) or [0.0]
    last7, last28 = s[-14:], s[-56:]
    mean7 = sum(last7) / len(last7)
    mean28 = sum(last28) / len(last28)
    # Same window on each of the last 4 days: what the CSV's "sameSlot4WeekMean" holds.
    same_slot = s[-2::-2][:4]
    return {
        "lag1": s[-1],
        "lag7": s[-14] if len(s) >= 14 else 0.0,
        "sameSlot4WeekMean": sum(same_slot) / len(same_slot) if same_slot else 0.0,
        "rolling7DayMean": mean7,
        "rolling7DayStd": statistics.stdev(last7) if len(last7) > 1 else 0.0,
        "recentTrend": mean7 / mean28 if mean28 else 1.0,
    }


def _sales_series(vendor, current_slot):
    """Per model product: kg sold per slot, from the vendor's first recorded sale
    (last 28 days) up to the slot before ``current_slot``. Empty slots count as 0."""
    since = datetime.datetime.utcnow() - datetime.timedelta(days=29)
    names = {p.get("product_id"): p.get("product_name") for p in COLS["products"].find({}, {"product_id": 1, "product_name": 1})}
    per_slot = {}
    for move in COLS["inventory_movement"].find({
        "vendorId": {"$in": _vendor_id_values(vendor)},
        "movementType": "sale",
        "occurredAt": {"$gte": since},
    }):
        label = _model_label(names.get(move.get("productId"), move.get("productId")))
        if not label or not isinstance(move.get("occurredAt"), datetime.datetime):
            continue
        slot = _slot_of(move["occurredAt"])
        if slot < current_slot:
            slots = per_slot.setdefault(label, {})
            slots[slot] = slots.get(slot, 0.0) + float(move.get("quantity") or 0)

    series = {}
    for label, slots in per_slot.items():
        day, window = min(slots)
        values = []
        while (day, window) < current_slot:
            values.append(slots.get((day, window), 0.0))
            day, window = (day, 1) if window == 0 else (day + datetime.timedelta(days=1), 0)
        series[label] = values
    return series


def _load_baseline_history():
    """Typical history inputs per (product, window, locality) from the training data.

    A shop with no sales yet is forecast from these instead of all-zero history,
    which the model never saw in training (it then predicts ~11 kg for every product).
    """
    path = BASE_DIR / "model_code_and_data" / "b2p_demand_forecasting_data.csv"
    if not path.exists():
        return {}
    df = pd.read_csv(path)
    baseline = {}
    for keys in (["productId", "window_order"], ["productId", "window_order", "localityTier"]):
        for key, row in df.groupby(keys)[HISTORY_FEATURES].median().iterrows():
            baseline[key] = {name: float(row[name]) for name in HISTORY_FEATURES}
    return baseline


BASELINE_HISTORY = _load_baseline_history()


def _batch_chip(batch, vendor=None):
    """Small batch summary embedded in a forecast row."""
    chip = {
        "batch_id": batch.get("batch_id"),
        "remaining_kg": round(_batch_remaining(batch), 2),
        "status": batch.get("status"),
        "received_at": _field(batch, "received_at", "assigned_at", "created_at"),
    }
    if vendor is not None:
        chip["expired"] = _hours_to_expiry(vendor, batch) <= 0
    return chip


def _suggest_batches(batches, needed_kg):
    """Freshest available batches that together cover ``needed_kg`` (greedy)."""
    picked, covered = [], 0.0
    for hours_left, batch in sorted(batches, key=lambda pair: -pair[0]):
        if covered >= needed_kg:
            break
        picked.append({**_batch_chip(batch), "hours_to_expiry": round(hours_left, 1)})
        covered += _batch_remaining(batch)
    return picked, round(covered, 1)


def _vendor_forecast(vendor, ctx):
    """Forecast every catalog product for this shop's current sales window.

    stock      = unexpired kg in batches the shop holds (assigned or received)
    requested  = kg in the shop's pending batch requests
    refill     = demand + safety stock - stock - requested (never below 0)
    """
    held, unsupported = {}, set()
    for batch in _held_batches(vendor):
        label = _model_label(_field(batch, "product_name", "product_id"))
        if label:
            held.setdefault(label, []).append(batch)
        else:
            unsupported.add(_field(batch, "product_name", "product_id"))

    # Every sellable product gets a forecast, held or not (a new shop still has demand).
    names = {}
    for product in COLS["products"].find():
        label = _model_label(product.get("product_name"))
        if label and label not in names:
            names[label] = product.get("product_name")

    requested = {}
    pending = list(COLS["restock_requests"].find({"vendor_id": {"$in": _vendor_id_values(vendor)}, "status": "pending"}))
    pending_batch_ids = {item.get("batch_id") for r in pending for item in r.get("items", []) if item.get("batch_id")}
    for r in pending:
        for item in r.get("items", []):
            label = _model_label(_field(item, "product_name", "product_id"))
            if label and item.get("batch_id"):
                requested[label] = requested.get(label, 0.0) + float(item.get("quantity") or 0)

    available = {}
    for batch in COLS["batches"].find({"status": "available", "exposed": {"$ne": False}}):
        label = _model_label(_field(batch, "product_name", "product_id"))
        hours_left = _hours_to_expiry(vendor, batch)
        if label and hours_left > 0 and _batch_remaining(batch) > 0 and batch.get("batch_id") not in pending_batch_ids:
            available.setdefault(label, []).append((hours_left, batch))

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
    locality = _locality_tier(locality) or "mixed"
    vendor_features = {
        "localityTierEnc": _encode(demand_bundle["locality_encoder"], locality,
                                   _encode(demand_bundle["locality_encoder"], "mixed")),
        # shortcut: mid-range of training data (3-33) when a vendor has no score
        "hotspotDensityScore": float(_field(vendor, "hotspotDensityScore", "hotspot_density_score", default=18)),
    }

    slot = _slot_of(datetime.datetime.utcnow())
    sales = _sales_series(vendor, slot)
    window_start, window_end = _slot_bounds(slot)

    forecasts = []
    for label in sorted(set(names) | set(held)):
        batches = held.get(label, [])
        series, snapshot = sales.get(label), history.get(label)
        # shortcut: under a week of real sales, the snapshot or the baseline wins; blend them once shops have data.
        if series and len(series) >= 14:
            source, past = "sales", _history_features(series)
        elif snapshot is not None:
            source, past = "snapshot", {name: float(snapshot.get(name, 0.0)) for name in HISTORY_FEATURES}
        else:
            source = "baseline"
            past = BASELINE_HISTORY.get((label, slot[1], locality)) or BASELINE_HISTORY.get((label, slot[1])) \
                or {name: 0.0 for name in HISTORY_FEATURES}
        row = {
            **ctx,
            **vendor_features,
            **past,
            "productIdEnc": _encode(demand_bundle["product_encoder"], label),
        }
        df_input = pd.DataFrame([row])[demand_bundle["features"]]
        demand = round(float(np.clip(demand_bundle["model"].predict(df_input)[0], 0, None)), 1)
        safety = round(float(demand_bundle["safety_stock"].get(label, 0.0)), 1)
        recommended = round(demand + safety, 1)
        # Expired stock cannot be sold, so it does not cover demand.
        stock = round(sum(_batch_remaining(b) for b in batches if _hours_to_expiry(vendor, b) > 0), 1)
        incoming = round(requested.get(label, 0.0), 1)
        refill = round(max(0.0, recommended - stock - incoming), 1)
        suggested, suggested_kg = _suggest_batches(available.get(label, []), refill) if refill > 0 else ([], 0.0)

        # One record per vendor/product/window (same shape as the ML pipeline's
        # rows), so forecasts can later be scored against that window's sales.
        COLS["predictions"].update_one(
            {"predictionType": "DEMAND", "vendorId": vendor.get("vendor_id"), "productId": label,
             "windowStart": window_start},
            {"$set": {"windowEnd": window_end, "numericValue": demand, "predictedValue": demand,
                      "recommendedDispatch": refill, "inputFeatures": row, "modelVersion": "v1.0",
                      "historySource": source, "generatedAt": datetime.datetime.utcnow()}},
            upsert=True,
        )

        if refill > 0:
            status = "Restock Needed"
        elif incoming > 0 and stock < recommended:
            status = "Covered by pending request"
        else:
            status = "Stock OK"
        forecasts.append({
            "product_name": names.get(label) or _field(batches[0], "product_name", default=label),
            "model_product": label,
            "predicted_demand": demand,
            "safety_stock": safety,
            "recommended_stock": recommended,
            "current_stock": stock,
            "requested_kg": incoming,
            "deficit": round(max(0.0, demand - stock), 1),
            "refill_quantity": refill,
            "restock_needed": refill > 0,
            "status": status,
            "history_source": source,
            "has_sales_history": source != "baseline",
            "batches": [_batch_chip(b, vendor) for b in batches],
            "suggested_batches": suggested,
            "suggested_kg": suggested_kg,
            "uncovered_kg": round(max(0.0, refill - suggested_kg), 1),
        })

    return forecasts, sorted(unsupported)


def _forecast_response(vendor, ctx):
    """Wrap vendor forecasts in the standard response envelope."""
    forecasts, unsupported = _vendor_forecast(vendor, ctx)
    day, window = _slot_of(datetime.datetime.utcnow())
    total = lambda key: round(sum(item[key] for item in forecasts), 1)
    response = {
        "vendor_id": vendor.get("vendor_id"),
        # Demand is per sales window: morning (before 1 pm) or evening.
        "window": {"date": day.isoformat(), "label": ("morning", "evening")[window]},
        "count": len(forecasts),
        "summary": {
            "predicted_demand": total("predicted_demand"),
            "recommended_stock": total("recommended_stock"),
            "current_stock": total("current_stock"),
            "requested_kg": total("requested_kg"),
            "refill_quantity": total("refill_quantity"),
            "products_to_restock": sum(1 for item in forecasts if item["restock_needed"]),
        },
        "forecast": forecasts,
        "unsupported_products": unsupported,
    }
    if unsupported:
        response["message"] = f"The demand model has no data for: {', '.join(unsupported)}"
    elif forecasts and all(item["history_source"] == "baseline" for item in forecasts):
        response["message"] = "No sales recorded yet: these are baseline estimates for a shop like yours, and they adjust as sales come in."
    return response


@app.get("/vendors/{vendor_id}/demand-forecast")
def get_demand_forecast(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    """Demand forecast for one vendor (the products it actually holds)."""
    require_vendor(user, vendor_id)
    if not demand_bundle:
        return {"error": "Demand model not loaded"}
    vendor = _find_vendor(vendor_id)
    if not vendor:
        return {"error": "Vendor not found"}
    return _forecast_response(vendor, _demand_shared_context())


# GET /demand-forecast — forecasts for every vendor with held batches, or a
# single vendor when ?vendor_id= is supplied.
@app.get("/demand-forecast")
def get_all_demand_forecasts(vendor_id: Optional[str] = None, user: dict = Depends(current_user)):
    if vendor_id:
        require_vendor(user, vendor_id)
    else:
        require_role(user)
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


# POST /festival-calendar — admin adds (or corrects) a festival window that the
# demand model's isFestivalWindow / festivalTypeEnc features read.
# Body: {"date": "2027-01-15", "festivalType": "harvestFestival", "windowDays": 4, "festivalName": "Pongal", "region": "Tamil Nadu"}
@app.post("/festival-calendar")
def add_festival(data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
    if not demand_bundle:
        return {"error": "Demand model not loaded"}
    known = [str(c) for c in demand_bundle["festival_encoder"].classes_ if c != "none"]
    festival_type = _field(data, "festivalType", "festival_type")
    if festival_type not in known:
        return {"error": f"festivalType must be one of: {', '.join(known)} (the types the model was trained on)"}
    try:
        day = datetime.date.fromisoformat(str(data.get("date", "")))
        window_days = int(_field(data, "windowDays", "window_days", default=1))
    except (TypeError, ValueError):
        return {"error": "date must be YYYY-MM-DD and windowDays a whole number"}
    if not 1 <= window_days <= 31:  # _active_festival_type looks back 31 days
        return {"error": "windowDays must be between 1 and 31"}
    # Local midnight in UTC, matching how the rest of the backend stores times.
    start = datetime.datetime.combine(day, datetime.time()).astimezone(datetime.timezone.utc).replace(tzinfo=None)
    doc = {"date": start, "festivalType": festival_type, "windowDays": window_days,
           "festivalName": _field(data, "festivalName", "name", default=""),
           "region": data.get("region", "Tamil Nadu"), "updated_at": datetime.datetime.utcnow()}
    COLS["festival_calendar"].update_one({"date": start, "festivalType": festival_type}, {"$set": doc}, upsert=True)
    return {"message": "Festival saved", "festival": doc}


# GET /festival-calendar — every stored festival window, soonest first.
@app.get("/festival-calendar")
def list_festivals(user: dict = Depends(current_user)):
    require_role(user)
    festivals = list(COLS["festival_calendar"].find().sort("date", 1))
    for festival in festivals:
        festival["_id"] = str(festival["_id"])
    return {"count": len(festivals), "festivals": festivals}


def risk_label_for(score):
    """<=30 Low, 30-70 Medium, >70 High (score is 0-100)."""
    if score <= 30:
        return "Low"
    return "Medium" if score <= 70 else "High"


# Suggested handling per spoilage risk label (surfaced in API responses).
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


def _hours_since_manufacture(batch):
    """Batch age in hours. Stored hour counts were true when written; age them since."""
    manufactured = _field(batch, "manufactured_at", "mfgTimestamp")
    if manufactured:
        return _hours_since(manufactured) or 0.0
    elapsed = _hours_since(batch.get("created_at")) or 0.0
    return float(_field(batch, "hours_since_manufacture", "hoursSinceManufacture", default=0)) + elapsed


def _hours_to_expiry(vendor, batch):
    """Shelf life left in hours at this vendor's storage (<= 0 means expired)."""
    expires = batch.get("expires_at")
    if isinstance(expires, datetime.datetime):  # older batches carry a fixed expiry
        return (expires - datetime.datetime.utcnow()).total_seconds() / 3600
    if _field(batch, "hours_to_expiry", "hoursToExpiry") is not None:
        elapsed = _hours_since(batch.get("created_at")) or 0.0
        return float(_field(batch, "hours_to_expiry", "hoursToExpiry")) - elapsed
    has_fridge = bool(_field(vendor, "hasRefrigerator", "has_refrigerator", default=True))
    return _shelf_life_hours(batch, has_fridge) - _hours_since_manufacture(batch)


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

    hours_mfg = _hours_since_manufacture(batch)
    received = batch.get("received_at")
    hours_shelf = _hours_since(received) if received else \
        float(_field(batch, "hours_on_shelf", "hoursOnShelf", default=0))

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
        "hoursToExpiry": max(0.0, _hours_to_expiry(vendor, batch)),
        "volumeKg": volume,
        "vendorRating": float(_field(vendor, "rating", "vendor_rating", "vendorRating", default=4.0)),
    }


def _batch_evaluation(vendor, batch, weather):
    """Stock state of a held batch plus its model spoilage risk (0-100)."""
    remaining = _batch_remaining(batch)
    threshold = _batch_threshold(batch)
    hours_left = _hours_to_expiry(vendor, batch)
    row = {
        "hours_to_expiry": round(hours_left, 1),
        "expired": hours_left <= 0,
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
        # /orders refuses expired stock, so say so instead of "sell first".
        "action": "Expired: do not sell, return or discard" if row["expired"] else RISK_ACTIONS[label],
    }


@app.get("/vendors/{vendor_id}/batches")
def get_vendor_batches(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    """Stock + spoilage evaluation for every batch this vendor holds,
    sorted worst stock first (remaining - threshold)."""
    require_vendor(user, vendor_id)
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
def get_vendor_spoilage_risk(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    """Spoilage risk for all held batches, plus a volume-weighted aggregate."""
    require_vendor(user, vendor_id)
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


# POST /vendors/{vendor_id}/demands — vendor asks for one specific available
# batch (items: [{batch_id}]).
@app.post("/vendors/{vendor_id}/demands")
def create_demand(
    vendor_id: str = Path(...),
    data: dict = Body(...),
    user: dict = Depends(current_user)
):
    require_vendor(user, vendor_id)

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
            vendor = _find_vendor(vendor_id)
            if not vendor:
                return {"error": "Vendor not found"}
            if _vendor_status(vendor) not in APPROVED_STATUSES:
                return {"error": "Your shop is awaiting admin approval; batches can be requested once it is approved"}
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

        # Stock reaches a shop only as a batch, so plain product quantities are
        # refused; confirmed product requests already stored still sync as before.
        return {"error": "Request a specific batch from the available batches list"}

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




# POST /vendors/{vendor_id}/demands/{demand_id}/confirm — admin approves a
# pending demand; batch requests assign the batch to this vendor (and reject
# competing requests for the same batch).
@app.post("/vendors/{vendor_id}/demands/{demand_id}/confirm")
def confirm_demand(vendor_id: str = Path(...), demand_id: str = Path(...), user: dict = Depends(current_user)):
    require_role(user)
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


# POST /vendors/{vendor_id}/demands/{demand_id}/reject — admin rejects a
# pending demand with an optional reason (body: {"reason": "..."}).
@app.post("/vendors/{vendor_id}/demands/{demand_id}/reject")
def reject_demand(vendor_id: str = Path(...), demand_id: str = Path(...), data: dict = Body(default={}),
                  user: dict = Depends(current_user)):
    require_role(user)
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


# POST /vendors/{vendor_id}/batches/{batch_id}/receive — vendor confirms
# delivery of an assigned batch (status assigned -> received).
@app.post("/vendors/{vendor_id}/batches/{batch_id}/receive")
def receive_batch(vendor_id: str = Path(...), batch_id: str = Path(...), user: dict = Depends(current_user)):
    """Vendor confirms delivery of an assigned batch; closes the matching request."""
    require_vendor(user, vendor_id)
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
    # Fresh stock of this product arrived, so the shop's low-stock alerts for it are settled.
    same_product = [b["batch_id"] for b in COLS["batches"].find(
        {"vendor_id": {"$in": _vendor_id_values(vendor)}, "product_id": batch.get("product_id")}, {"batch_id": 1})]
    COLS["inventory_alerts"].update_many(
        {"batch_id": {"$in": same_product}, "alert_status": "active"},
        {"$set": {"alert_status": "resolved", "resolved_at": now, "resolved_by": f"received {batch_id}"}})
    COLS["logs"].insert_one({
        "type": "activity", "action": "receive_batch", "vendor_id": vendor["vendor_id"],
        "batch_id": batch_id, "timestamp": now,
        "message": f"Vendor {vendor['vendor_id']} confirmed delivery of batch {batch_id}"
    })
    return {"message": "Batch assignment confirmed", "batch_id": batch_id, "status": "received"}


# POST /vendors/{vendor_id}/batches/{batch_id}/return — vendor sends back (or
# writes off) a held batch, e.g. expired or high spoilage risk. Body: {"reason": "..."}
@app.post("/vendors/{vendor_id}/batches/{batch_id}/return")
def return_batch(vendor_id: str = Path(...), batch_id: str = Path(...), data: dict = Body(default={}),
                 user: dict = Depends(current_user)):
    require_vendor(user, vendor_id)
    vendor = _find_vendor(vendor_id)
    if not vendor:
        return {"error": "Vendor not found"}
    batch = COLS["batches"].find_one({
        "batch_id": batch_id, "vendor_id": {"$in": _vendor_id_values(vendor)}, "status": {"$in": HELD_STATUSES}})
    if not batch:
        return {"error": f"Batch {batch_id} is not held by this vendor"}
    now = datetime.datetime.utcnow()
    kg = _batch_remaining(batch)
    reason = str(data.get("reason") or "returned")
    # Same optimistic lock as /orders, so a sale and a return cannot both take the stock.
    if COLS["batches"].update_one({"_id": batch["_id"], "updated_at": batch.get("updated_at")}, {"$set": {
        "status": "returned", "returned_kg": kg, "remaining_volume_kg": 0, "return_reason": reason,
        "returned_at": now, "updated_at": now,
    }}).matched_count == 0:
        return {"error": f"Batch {batch_id} changed meanwhile, please retry"}
    # Assignment already added this batch to the inventory row, so take it back out.
    _adjust_inventory(vendor["vendor_id"], batch, -kg)
    COLS["inventory_movement"].insert_one({
        "vendorId": vendor["vendor_id"], "productId": _field(batch, "product_id", "product_name"),
        "batchId": batch_id, "movementType": "return", "quantity": round(kg, 3), "occurredAt": now,
        "triggeredBy": user["sub"], "metadata": {"previousQty": kg, "newQty": 0, "reason": reason},
    })
    COLS["inventory_alerts"].update_many({"batch_id": batch_id, "alert_status": "active"},
                                         {"$set": {"alert_status": "resolved", "resolved_at": now,
                                                   "resolved_by": f"returned {batch_id}"}})
    COLS["logs"].insert_one({
        "type": "activity", "action": "return_batch", "vendor_id": vendor["vendor_id"], "batch_id": batch_id,
        "timestamp": now, "message": f"Vendor {vendor['vendor_id']} returned batch {batch_id} ({round(kg, 2)} kg): {reason}",
    })
    return {"message": "Batch returned", "batch_id": batch_id, "returned_kg": round(kg, 3), "status": "returned"}


# GET /orders — every order, newest first (admin). Optional vendor_id filter.
@app.get("/orders")
def list_orders(vendor_id: Optional[str] = None, user: dict = Depends(current_user)):
    require_role(user)
    orders = list(COLS["orders"].find({"vendor_id": vendor_id} if vendor_id else {}).sort("_id", -1))
    for order in orders:
        order["_id"] = str(order["_id"])
    return {"count": len(orders), "orders": orders}


# GET /inventory-alerts — low-stock / stockout alerts written by /orders (admin).
# They resolve themselves when the shop receives a batch of that product or returns the batch.
@app.get("/inventory-alerts")
def list_inventory_alerts(status: Optional[str] = None, user: dict = Depends(current_user)):
    require_role(user)
    alerts = list(COLS["inventory_alerts"].find({"alert_status": status} if status else {}).sort("_id", -1))
    for alert in alerts:
        alert["_id"] = str(alert["_id"])
    return {"count": len(alerts), "alerts": alerts}


# POST /orders — customer purchase (vendor_id + quantity_kg, optional
# batch_id / product filter); writes order, movements and stock alerts.
@app.post("/orders")
def create_order(data: dict = Body(...), user: dict = Depends(current_user)):
    """Customer purchase: deducts kg from a batch (or FEFO across the vendor's batches)."""
    require_role(user, "vendor", "customer")
    if user["role"] == "vendor":
        require_vendor(user, str(data.get("vendor_id") or ""))
    customer_id = user["sub"] if user["role"] == "customer" else data.get("customer_id")
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
    # Expired batter is never sold; it stays on the batch list until returned.
    expired = [b for b in batches if _hours_to_expiry(vendor, b) <= 0]
    batches = [b for b in batches if b not in expired]
    # First-expiring (else oldest) batch sells first.
    def fefo(batch):
        when = _field(batch, "expires_at", "manufactured_at", "mfgTimestamp")
        return when if isinstance(when, datetime.datetime) else datetime.datetime.max
    batches.sort(key=fefo)
    available = sum(_batch_remaining(b) for b in batches)
    if not batches or available < quantity:
        note = f" ({round(sum(_batch_remaining(b) for b in expired), 2)} kg more has expired)" if expired else ""
        return {"error": f"Only {round(available, 2)} kg available{note}"}

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
            return {"error": f"Batch {batch['batch_id']} changed during the sale, please retry"}
        left -= take
        taken.append((batch, before, take, after))

    deductions, alerts = [], []
    for batch, before, take, after in taken:
        deductions.append({"batch_id": batch["batch_id"], "quantity_kg": round(take, 3), "remaining_kg": after})
        _adjust_inventory(vendor["vendor_id"], batch, -take)
        COLS["inventory_movement"].insert_one({
            "vendorId": vendor["vendor_id"], "productId": _field(batch, "product_id", "product_name"),
            "batchId": batch["batch_id"], "movementType": "sale", "quantity": round(take, 3),
            "occurredAt": now, "triggeredBy": customer_id or user["sub"],
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
    return {"message": "Order placed", "order": order, "alerts": alerts}


# POST /vendors/{vendor_id}/inventory/sync — apply confirmed product-based
# demands to inventory and mark those requests "synchronized".
@app.post("/vendors/{vendor_id}/inventory/sync")
def sync_inventory(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    """Apply confirmed product-based requests once, even if calls overlap."""
    require_vendor(user, vendor_id)

    # Read the candidate requests. Each one is re-checked atomically below,
    # because another call may be trying to synchronize the same demand.
    demands = list(
        COLS["restock_requests"].find({
            "vendor_id": vendor_id,
            "status": "confirmed",
            "items.batch_id": {"$exists": False}
        })
    )

    updated = []
    synced_count = 0

    for demand in demands:
        # Claim the request before changing inventory: only one concurrent
        # call can move it from "confirmed" to "synchronizing".
        claim = COLS["restock_requests"].update_one(
            {
                "_id": demand["_id"],
                "vendor_id": vendor_id,
                "status": "confirmed",
                "items.batch_id": {"$exists": False}
            },
            {"$set": {"status": "synchronizing"}}
        )
        if claim.modified_count != 1:
            # Another call has already claimed or completed this request.
            continue

        for item in demand.get("items", []):
            product_id = item.get("product_id")
            quantity = item.get("quantity", 0)
            inventory = COLS["inventory"].find_one({
                "vendor_id": vendor_id,
                "product_id": product_id
            })
            old_quantity = float(inventory.get("quantity", 0.0)) if inventory else 0.0
            new_quantity = old_quantity + float(quantity)
            COLS["inventory"].update_one(
                {
                    "vendor_id": vendor_id,
                    "product_id": product_id
                },
                {
                    "$inc": {"quantity": quantity},
                    "$set": {
                        "last_updated": datetime.datetime.utcnow().isoformat()
                    },
                    # A confirmed demand for a product with no inventory row creates the row.
                    "$setOnInsert": {
                        "product_name": item.get("product_name", ""),
                        "batch_number": item.get("batch_number", ""),
                        "created_at": datetime.datetime.utcnow().isoformat()
                    }
                },
                upsert=True
            )
            updated.append({
                "product_id": product_id,
                "product_name": (inventory.get("product_name") if inventory else None) or item.get("product_name", ""),
                "batch_number": (inventory.get("batch_number") if inventory else None) or item.get("batch_number", ""),
                "old_quantity": old_quantity,
                "new_quantity": new_quantity
            })

        # Mark it complete only after its inventory updates have finished.
        COLS["restock_requests"].update_one(
            {"_id": demand["_id"], "status": "synchronizing"},
            {"$set": {"status": "synchronized"}}
        )
        synced_count += 1

    if synced_count == 0:
        return {"message": "No confirmed demand"}

    return {
        "message": "Inventory synchronized",
        "synced_demands": synced_count,
        "updated": updated
    }


# GET /pending/vendors — vendors awaiting admin approval (status or
# verificationStatus == "pending").
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


# POST /vendors/{vendor_id}/locality — admin corrects a shop's locality tier,
# which drives its demand forecast. Body: {"locality_tier": "residential_budget"}
@app.post("/vendors/{vendor_id}/locality")
def set_vendor_locality(vendor_id: str = Path(...), data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
    locality = _locality_tier(data.get("locality_tier"))
    if not locality:
        return {"error": f"locality_tier must be one of: {', '.join(LOCALITY_TIERS)}"}
    vendor = _find_vendor(vendor_id)
    if not vendor:
        return {"error": "Vendor not found"}
    # Write both spellings: seed vendors carry localityTier, which the forecast reads first.
    COLS["vendors"].update_one({"_id": vendor["_id"]}, {"$set": {
        "locality_tier": locality, "localityTier": locality, "updated_at": datetime.datetime.utcnow()}})
    COLS["logs"].insert_one({
        "type": "activity", "action": "set_vendor_locality", "vendor_id": vendor.get("vendor_id"),
        "timestamp": datetime.datetime.utcnow(), "message": f"Vendor {vendor.get('vendor_id')} locality set to {locality}",
    })
    return {"message": "Locality updated", "vendor_id": vendor.get("vendor_id"), "locality_tier": locality}


# POST /vendors/{vendor_id}/status — admin approves, rejects or suspends a
# vendor. Body: {"status": "active" | "rejected" | "suspended"}
@app.post("/vendors/{vendor_id}/status")
def set_vendor_status(vendor_id: str = Path(...), data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
    new_status = data.get("status")
    if new_status not in ("active", "rejected", "suspended"):
        return {"error": "status must be active, rejected or suspended"}
    vendor = _find_vendor(vendor_id)
    if not vendor:
        return {"error": "Vendor not found"}
    # Write both fields: seed vendors read verificationStatus, app-created ones read status.
    COLS["vendors"].update_one({"_id": vendor["_id"]}, {"$set": {
        "status": new_status, "verificationStatus": new_status, "updated_at": datetime.datetime.utcnow()}})
    COLS["logs"].insert_one({
        "type": "activity", "action": "set_vendor_status", "vendor_id": vendor.get("vendor_id"),
        "status": new_status, "timestamp": datetime.datetime.utcnow(),
        "message": f"Vendor {vendor.get('vendor_id')} set to {new_status}",
    })
    return {"message": f"Vendor {new_status}", "vendor_id": vendor.get("vendor_id"), "status": new_status}


# GET /users/{user_id} — vendor profile by user_id, vendor_id or Mongo _id.
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
        return {
            "error": "User not found"
        }

    user["_id"] = str(user["_id"])

    return {
        "user": user
    }


# POST /restock-requests — admin/vendor creates a restock request; also
# opens a pending order linked to the request.
@app.post("/restock-requests")
def create_restock_request(data: dict = Body(...), user: dict = Depends(current_user)):
    vendor_id = data.get("vendor_id")

    if not vendor_id:
        return {
            "error": "vendor_id is required"
        }
    require_vendor(user, str(vendor_id))
    if not _find_vendor(str(vendor_id)):
        return {"error": f"Vendor {vendor_id} not found"}

    # Store only known fields: the body comes straight from the client.
    items = data.get("items")
    if not isinstance(items, list) or not items:
        return {"error": "items must be a non-empty list"}
    clean_items = []
    for item in items:
        if not isinstance(item, dict) or not (item.get("product_id") or item.get("product_name")):
            return {"error": "Each item needs a product_id or product_name"}
        quantity = item.get("quantity")
        if isinstance(quantity, bool) or not isinstance(quantity, (int, float)) or quantity <= 0:
            return {"error": "Each item needs a quantity greater than 0"}
        clean_items.append({k: item[k] for k in ("product_id", "product_name", "quantity") if k in item})

    request_doc = {
        "vendor_id": vendor_id,
        "items": clean_items,
        "priority": data.get("priority", "normal"),
        "notes": str(data.get("notes", "")),
        "status": "pending",
        "created_at": datetime.datetime.utcnow(),
    }
    req = COLS["restock_requests"].insert_one(request_doc)
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


# GET /restock-requests — list restock requests (optional status/vendor_id).
@app.get("/restock-requests")
def get_restock_requests(
    status: str = None,
    vendor_id: str = None,
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
        COLS["restock_requests"].find(query)
    )

    for req in requests:
        req["_id"] = str(req["_id"])

    return {
        "count": len(requests),
        "restock_requests": requests
    }
# POST /customers/register — create a customer profile + login user in one
# step; the customer's Mongo _id becomes the user's user_id.
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
# POST /customers/login — customer auth; with a location in the body it
# refreshes the saved location and returns nearby vendors with stock.
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

# Entry point: run the API with uvicorn on all interfaces, port 5000.
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=5000
    )
