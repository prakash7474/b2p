"""Shared by main.py (app routes) and ml.py (model routes): app, database, helpers,
login checks and the batch-expiry rules. Neither route module imports the other."""
import os
import re
import base64
import hashlib
import hmac
import json
import time
import datetime
from pathlib import Path as FilePath
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from pymongo import MongoClient
from bson import ObjectId
import bcrypt

BASE_DIR = FilePath(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

app = FastAPI()

@app.exception_handler(HTTPException)
async def _error_body(request, exc):
    """Every error the routes raise has one shape, {"error": message}, with a real HTTP status."""
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code, headers=exc.headers)


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
    "logs": db["logs"],
    "restock_requests": db["restock_requests"],
    "predictions": db["predictions"],
    "inventory_movement": db["inventory_movement"],
    "weather_forecast": db["weather_forecast"],
    "festival_calendar": db["festival_calendar"],
    "feature_snapshots": db["feature_snapshots"],
    "inventory_alerts": db["inventory_alerts"],
}


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


def _vendor_id_values(vendor):
    values = [vendor.get("vendor_id"), str(vendor.get("_id", ""))]
    return [value for value in values if value]


def _find_vendor(vendor_id):
    query = {"vendor_id": vendor_id}
    if ObjectId.is_valid(vendor_id):
        query = {"$or": [{"_id": ObjectId(vendor_id)}, {"vendor_id": vendor_id}]}
    return COLS["vendors"].find_one(query)


# ------------------------------------------------------------
# Shelf life and expiry (rules, not ML; the forecast, risk, orders and the
# expiry job all use them)
# ------------------------------------------------------------
_catalog_cache = {"at": None, "rows": []}


def _catalog():
    """Product rows, re-read at most once a minute: shelf life is looked up per batch."""
    now = datetime.datetime.utcnow()
    if _catalog_cache["at"] is None or (now - _catalog_cache["at"]).total_seconds() > 60:
        _catalog_cache.update(at=now, rows=list(COLS["products"].find()))
    return _catalog_cache["rows"]


def _forget_catalog():
    """Call after any product write so shelf-life changes apply at once."""
    _catalog_cache["at"] = None


def _shelf_life_hours(batch, has_fridge):
    """Product shelf life for the vendor's storage: fridge vs room temperature."""
    keys = ("shelf_life_fridge_hrs", "shelf_life_hours") if has_fridge else ("shelf_life_ambient_hrs",)
    name = _product_key(_field(batch, "product_name", "product_id"))
    for product in _catalog():
        same = product.get("product_id") == batch.get("product_id") or _product_key(product.get("product_name")) == name
        if same and _field(product, *keys) is not None:
            return float(_field(product, *keys))
    # shortcut: catalog has no shelf life for this product; typical idli batter values
    return 72.0 if has_fridge else 24.0


def _has_fridge(vendor):
    return 1 if _field(vendor, "hasRefrigerator", "has_refrigerator", default=True) else 0


def _hours_to_expiry(vendor, batch):
    """Shelf life left in hours; zero or below means the batch has expired."""
    elapsed = _hours_since(batch.get("created_at")) or 0.0
    expires = batch.get("expires_at")
    if isinstance(expires, datetime.datetime):  # older batches carry a fixed expiry
        return (expires - datetime.datetime.utcnow()).total_seconds() / 3600
    if _field(batch, "hours_to_expiry", "hoursToExpiry") is not None:
        return float(_field(batch, "hours_to_expiry", "hoursToExpiry")) - elapsed
    manufactured = _field(batch, "manufactured_at", "mfgTimestamp")
    hours_mfg = _hours_since(manufactured) if manufactured else \
        float(_field(batch, "hours_since_manufacture", "hoursSinceManufacture", default=0)) + elapsed
    return _shelf_life_hours(batch, _has_fridge(vendor)) - hours_mfg


def _held_batches(vendor):
    """Batches in the vendor's hands with stock left (no archived/sold-out), each flagged
    "expired". Read-only: expire_batches() moves expired kg out of the inventory totals."""
    held = []
    for batch in COLS["batches"].find({
        "vendor_id": {"$in": _vendor_id_values(vendor)},
        "status": {"$in": HELD_STATUSES},
    }):
        if _batch_remaining(batch) <= 0:
            continue
        batch["expired"] = _hours_to_expiry(vendor, batch) <= 0
        held.append(batch)
    return held


def _sellable_batches(vendor):
    """Received batches with stock left that have not expired: what a customer can buy."""
    return [b for b in _held_batches(vendor) if b["status"] in SELLABLE_STATUSES and not b["expired"]]


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


def _log(action, message, vendor_id=None, kind="activity", **extra):
    """One audit-log entry; kind "alert" marks things the admin should act on."""
    COLS["logs"].insert_one({"type": kind, "action": action, "message": message, "vendor_id": vendor_id,
                             "timestamp": datetime.datetime.utcnow(), **extra})


def expire_batches():
    """Stamp newly expired held batches and take their kg out of inventory, once each.

    Runs on a timer (see main.py), so reads never write. Returns how many batches it expired.
    """
    expired = 0
    vendors = {}
    for batch in COLS["batches"].find({"status": {"$in": HELD_STATUSES}, "expired_at": {"$exists": False}}):
        vid = batch.get("vendor_id")
        vendor = vendors.get(vid) or vendors.setdefault(vid, _find_vendor(str(vid or "")) or {})
        if _batch_remaining(batch) <= 0 or _hours_to_expiry(vendor, batch) > 0:
            continue
        # Filter on expired_at/status so a concurrent run or return cannot deduct twice.
        if COLS["batches"].update_one(
            {"_id": batch["_id"], "expired_at": {"$exists": False}, "status": {"$in": HELD_STATUSES}},
            {"$set": {"expired_at": datetime.datetime.utcnow()}}
        ).modified_count:
            _adjust_inventory(vendor.get("vendor_id") or vid, batch, -_batch_remaining(batch))
            _log("batch_expired",
                 f"{_field(batch, 'product_name', 'product_id', default='Batter')} at "
                 f"{vendor.get('shop_name') or vid} expired with {round(_batch_remaining(batch), 2)} kg left",
                 vendor.get("vendor_id") or vid, kind="alert", batch_id=batch.get("batch_id"))
            expired += 1
    return expired


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


# ------------------------------------------------------------
# Auth: /login and /customers/login hand out an HMAC-signed token (user id, role,
# vendor id, 7-day expiry). Routes read it with Depends(current_user) and check it
# with require_role / require_vendor.
# ------------------------------------------------------------
# shortcut: without AUTH_SECRET the key is derived from MONGODB_URI; set AUTH_SECRET in .env before deploying.
AUTH_SECRET = (os.getenv("AUTH_SECRET") or hashlib.sha256(MONGODB_URI.encode()).hexdigest()).encode()
TOKEN_TTL_SECONDS = 7 * 24 * 3600
APPROVED_STATUSES = ["active", "approved", "verified"]


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


def _vendor_status(vendor):
    # Seed vendors keep their state in verificationStatus, app-created ones in status.
    return str(_field(vendor, "status", "verificationStatus", default="pending")).lower()


# Vendors store "commercial"; the demand model was trained on "commercial_offices".
LOCALITY_ALIASES = {"commercial": "commercial_offices"}
# The shop surroundings the demand model knows; sign-up and the forecast both use this list.
LOCALITY_TIERS = ["commercial_offices", "institutional", "mixed", "residential_budget", "residential_premium"]


def _locality_tier(value):
    """A known locality tier for ``value`` (aliases allowed), else None."""
    tier = LOCALITY_ALIASES.get(value, value)
    return tier if tier in LOCALITY_TIERS else None
