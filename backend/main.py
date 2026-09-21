import os

from fastapi import FastAPI, Path, Body
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
    # health check returning accessible collection names
    return {
        "database": "b2p",
        "collections": list(COLS.keys())
    }


@app.get("/users")
def get_users():
    # retrieve all users (stored in vendors collection)
    users = list(COLS["vendors"].find())

    for user in users:
        user["_id"] = str(user["_id"])

    return {
        "count": len(users),
        "users": users
    }


@app.get("/logs")
def get_logs():
    # fetch all system activity and alert logs
    logs = list(COLS["logs"].find())

    for log in logs:
        log["_id"] = str(log["_id"])

    return {
        "count": len(logs),
        "logs": logs
    }
@app.get("/vendors")
def get_vendors():
    # list all registered partner shops
    vendors = list(COLS["vendors"].find())

    for vendor in vendors:
        vendor["_id"] = str(vendor["_id"])

    return {
        "count": len(vendors),
        "vendors": vendors
    }
@app.post("/vendors")
def create_vendor(data: dict = Body(...)):

    # check vendor_id uniqueness if provided
    vendor_id = data.get("vendor_id")
    if vendor_id:
        existing = COLS["vendors"].find_one({"vendor_id": vendor_id})
        if existing:
            return {"error": "Vendor with this vendor_id already exists"}

    if "status" not in data:
        data["status"] = "pending"

    result = COLS["vendors"].insert_one(data)
    data["_id"] = str(result.inserted_id)

    # write audit log
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

    # lookup vendor profile by vendor_id or MongoDB ObjectId
    query = {"vendor_id": vendor_id}
    if ObjectId.is_valid(vendor_id):
        query = {"$or": [{"_id": ObjectId(vendor_id)}, {"vendor_id": vendor_id}]}

    vendor = COLS["vendors"].find_one(query)

    if vendor is None:
        return {"error": "Vendor not found"}

    vendor["_id"] = str(vendor["_id"])

    return {
        "vendor": vendor
    }
@app.get("/vendors/{vendor_id}/products")
def get_vendor_products(vendor_id: str = Path(...)):

    # resolve vendor_id string if ObjectId was passed
    vid = vendor_id
    if ObjectId.is_valid(vendor_id):
        v = COLS["vendors"].find_one({"_id": ObjectId(vendor_id)})
        if v and "vendor_id" in v:
            vid = v["vendor_id"]

    # find products from vendor inventory or fall back to master product catalog
    inv_items = list(COLS["inventory"].find({"$or": [{"vendor_id": vid}, {"vendor_id": vendor_id}]}))
    product_names = [i.get("product_name") for i in inv_items if i.get("product_name")]

    if product_names:
        products = list(COLS["products"].find({"product_name": {"$in": product_names}}))
    else:
        products = list(COLS["products"].find())

    for product in products:
        product["_id"] = str(product["_id"])
        if "vendor_id" in product:
            product["vendor_id"] = str(product["vendor_id"])

    return {
        "count": len(products),
        "products": products
    }
@app.get("/vendors/{vendor_id}/inventory")
def get_vendor_inventory(vendor_id: str = Path(...)):

    # resolve vendor_id string if ObjectId was passed
    vid = vendor_id
    if ObjectId.is_valid(vendor_id):
        v = COLS["vendors"].find_one({"_id": ObjectId(vendor_id)})
        if v and "vendor_id" in v:
            vid = v["vendor_id"]

    inventory = list(COLS["inventory"].find({
        "$or": [{"vendor_id": vid}, {"vendor_id": vendor_id}]
    }))

    for item in inventory:
        item["_id"] = str(item["_id"])

    return {
        "count": len(inventory),
        "inventory": inventory
    }


@app.get("/inventory/{vendor_id}")
def get_inventory(vendor_id: str = Path(...)):
    return get_vendor_inventory(vendor_id)


@app.get("/pending/vendors")
def get_pending_vendors():

    # filter vendors waiting for admin approval
    vendors = list(
        COLS["vendors"].find({
            "$or": [{"status": "pending"}, {"verificationStatus": "pending"}]
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

    # lookup single user by user_id, vendor_id, or ObjectId
    query = {"$or": [{"user_id": user_id}, {"vendor_id": user_id}]}
    if ObjectId.is_valid(user_id):
        query["$or"].append({"_id": ObjectId(user_id)})

    user = COLS["vendors"].find_one(query)

    if user is None:
        return {"error": "User not found"}

    user["_id"] = str(user["_id"])

    return {
        "user": user
    }


@app.post("/restock-requests")
def create_restock_request(data: dict = Body(...)):

    vendor_id = data.get("vendor_id")
    if not vendor_id:
        return {"error": "vendor_id is required"}

    data.setdefault("status", "pending")
    req = COLS["restock_requests"].insert_one(data)
    req_id = str(req.inserted_id)

    # create cross-linked order and log
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=5000
    )