import os
import math
import datetime
import warnings
from pathlib import Path as FilePath

from fastapi import FastAPI, Path, Body
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
client = MongoClient(MONGODB_URI)

db = client["b2p"]

COLS = {
    "users": db["users"],
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


@app.post("/login")
def login(data: dict = Body(...)):

    login = data.get("login")
    password = data.get("password")

    return login_user(login, password)

@app.get("/users")
def get_users():
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
def get_vendors():
    vendors = list(COLS["vendors"].find())

    for vendor in vendors:
        vendor["_id"] = str(vendor["_id"])

    return {
        "count": len(vendors),
        "vendors": vendors
    }


@app.post("/vendors")
def create_vendor(data: dict = Body(...)):
    vendor_id = data.get("vendor_id")

    if vendor_id:
        existing = COLS["vendors"].find_one({
            "vendor_id": vendor_id
        })

        if existing:
            return {
                "error": "Vendor with this vendor_id already exists"
            }

    if "status" not in data:
        data["status"] = "pending"

    result = COLS["vendors"].insert_one(data)
    data["_id"] = str(result.inserted_id)

    COLS["logs"].insert_one({
        "type": "activity",
        "action": "create_vendor",
        "vendor_id": data["_id"],
        "message": f"Registered new vendor {data.get('shop_name', '')}"
    })

    return {
        "message": "Vendor created successfully",
        "vendor": data
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




@app.post("/vendors/{vendor_id}/demands")
def create_demand(vendor_id: str = Path(...), data: dict = Body(...)):
    demand = {
        "vendor_id": vendor_id,
        "items": data.get("items", []),
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
        "demand_id": demand_id
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
                upsert=True
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=5000
    )