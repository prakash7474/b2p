import os

from fastapi import FastAPI, Path, Body
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pymongo import MongoClient
from pathlib import Path as FilePath
from bson import ObjectId

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

    inv_items = list(
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

    product_names = [
        item.get("product_name")
        for item in inv_items
        if item.get("product_name")
    ]

    if product_names:
        products = list(
            COLS["products"].find({
                "product_name": {
                    "$in": product_names
                }
            })
        )
    else:
        products = list(
            COLS["products"].find()
        )

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