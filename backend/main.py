import os

from fastapi import FastAPI, Path
from dotenv import load_dotenv
from pymongo import MongoClient
from pathlib import Path as FilePath
from bson import ObjectId

BASE_DIR = FilePath(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

app = FastAPI()

MONGODB_URI = os.getenv("MONGODB_URI")
client = MongoClient(MONGODB_URI)

db = client["b2p"]

COLS = {
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


@app.get("/")
def home():
    return {
        "database": "b2p",
        "collections": list(COLS.keys())
    }


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
@app.get("/vendors/{vendor_id}")
def get_vendor(vendor_id: str = Path(...)):

    vendor = COLS["vendors"].find_one({
        "_id": ObjectId(vendor_id)
    })

    if vendor is None:
        return {"error": "Vendor not found"}

    vendor["_id"] = str(vendor["_id"])

    return {
        "vendor": vendor
    }
@app.get("/vendors/{vendor_id}/products")
def get_vendor_products(vendor_id: str = Path(...)):

    products = list(COLS["products"].find({
        "vendor_id": ObjectId(vendor_id)
    }))

    for product in products:
        product["_id"] = str(product["_id"])
        product["vendor_id"] = str(product["vendor_id"])

    return {
        "count": len(products),
        "products": products
    }


@app.get("/pending/vendors")
def get_pending_vendors():

    vendors = list(
        COLS["vendors"].find({
            "status": "pending"
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

    user = COLS["vendors"].find_one({
        "_id": ObjectId(user_id)
    })

    if user is None:
        return {"error": "User not found"}

    user["_id"] = str(user["_id"])

    return {
        "user": user
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=5000
    )