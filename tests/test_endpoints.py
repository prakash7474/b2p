"""
Pytest coverage for every endpoint defined in backend/main.py.

How isolation works
-------------------
Importing ``backend.main`` opens the real MongoDB connection (from .env)
and runs index setup exactly once, just like starting the server does.
Right after import the suite re-points ``main.COLS`` at a throwaway
``b2p_test`` database, drops its collections before every test, and drops
the database entirely when the session ends -- so the production ``b2p``
data is never read or written by any test.

Run with:  pytest            (pytest.ini collects tests/ only)
"""

import os
from datetime import datetime
from pathlib import Path

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient

# pytest.ini sets `pythonpath = .`; this fallback allows `pytest tests/...`
# to be invoked from any working directory.
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import backend.main as main

TEST_DB_NAME = "b2p_test"

ACTIVE_VENDOR = "V200"   # status: active
PENDING_VENDOR = "V201"  # status: pending

EXPECTED_COLLECTIONS = [
    "vendors",
    "products",
    "batches",
    "inventory",
    "orders",
    "order_items",
    "logs",
    "restock_requests",
    "predictions",
    "inventory_movement",
    "weather_forecast",
    "festival_calendar",
    "feature_snapshots",
]


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def db():
    """Disposable test database, dropped when the suite finishes."""
    database = main.client[TEST_DB_NAME]
    yield database
    main.client.drop_database(TEST_DB_NAME)


@pytest.fixture(scope="session", autouse=True)
def _redirect_to_test_db(db):
    """Point every endpoint at b2p_test instead of the production b2p."""
    original_cols = main.COLS
    main.COLS = {name: db[name] for name in original_cols}
    yield
    main.COLS = original_cols


@pytest.fixture(autouse=True)
def _empty_collections(db):
    """Every test starts with empty collections."""
    for name in db.list_collection_names():
        db[name].drop()
    yield


@pytest.fixture(scope="session")
def client():
    with TestClient(main.app) as test_client:
        yield test_client


@pytest.fixture()
def seeded(db, _empty_collections):
    """Baseline data shared by most tests."""
    db.vendors.insert_many(
        [
            {
                "vendor_id": ACTIVE_VENDOR,
                "user_id": "U200",
                "shop_name": "Active Shop",
                "owner_name": "Owner A",
                "email": "a@test.com",
                "status": "active",
            },
            {
                "vendor_id": PENDING_VENDOR,
                "user_id": "U201",
                "shop_name": "Pending Shop",
                "owner_name": "Owner B",
                "email": "b@test.com",
                "status": "pending",
            },
        ]
    )
    db.products.insert_many(
        [
            {"product_id": "P200", "product_name": "Test Batter",
             "category": "batter", "vendor_id": ACTIVE_VENDOR},
            {"product_id": "P201", "product_name": "Other Batter",
             "category": "batter", "vendor_id": ACTIVE_VENDOR},
            # no vendor_id -> exercises the "if vendor_id in product" branch
            {"product_id": "P202", "product_name": "Unrelated Mix",
             "category": "combo"},
        ]
    )
    db.inventory.insert_many(
        [
            {"inventory_id": "INV200", "vendor_id": ACTIVE_VENDOR,
             "product_id": "P200", "product_name": "Test Batter",
             "batch_number": "BATCH-200", "quantity": 35.0,
             "last_updated": "2026-01-01T00:00:00"},
            {"inventory_id": "INV201", "vendor_id": ACTIVE_VENDOR,
             "product_id": "P201", "product_name": "Other Batter",
             "batch_number": "BATCH-201", "quantity": 10.0,
             "last_updated": "2026-01-01T00:00:00"},
            {"inventory_id": "INV202", "vendor_id": PENDING_VENDOR,
             "product_id": "P201", "product_name": "Other Batter",
             "batch_number": "BATCH-202", "quantity": 5.0,
             "last_updated": "2026-01-01T00:00:00"},
        ]
    )
    db.orders.insert_many(
        [
            {"order_id": "ORD200", "vendor_id": ACTIVE_VENDOR,
             "status": "pending", "total_amount": 100.0},
            {"order_id": "ORD201", "vendor_id": PENDING_VENDOR,
             "status": "delivered", "total_amount": 50.0},
        ]
    )
    db.logs.insert_many(
        [
            {"type": "activity", "action": "seed", "message": "one"},
            {"type": "activity", "action": "seed", "message": "two"},
        ]
    )
    db.restock_requests.insert_many(
        [
            {"request_id": "RSR200", "vendor_id": ACTIVE_VENDOR,
             "status": "approved"},
            {"request_id": "RSR201", "vendor_id": ACTIVE_VENDOR,
             "status": "pending"},
            {"request_id": "RSR202", "vendor_id": PENDING_VENDOR,
             "status": "approved"},
        ]
    )
    return db


def raise_demand(client, vendor_id, items, priority=None):
    """POST a demand and return its demand_id."""
    payload = {"items": items}
    if priority is not None:
        payload["priority"] = priority
    response = client.post(f"/vendors/{vendor_id}/demands", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert "demand_id" in body, body
    return body["demand_id"]


# ---------------------------------------------------------------------------
# meta: home, docs, routing, validation, CORS
# ---------------------------------------------------------------------------

def test_home_lists_all_collections(client):
    body = client.get("/").json()
    assert body["database"] == "b2p"
    assert body["collections"] == EXPECTED_COLLECTIONS


def test_unknown_route_returns_404(client):
    assert client.get("/definitely-not-a-route").status_code == 404


def test_docs_and_openapi_are_served(client):
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_malformed_json_returns_422(client):
    response = client.post(
        "/vendors",
        content="not-json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_missing_body_returns_422(client):
    assert client.post("/vendors").status_code == 422


def test_cors_preflight_allows_local_frontend(client):
    response = client.options(
        "/vendors",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cors_does_not_leak_to_other_origins(client):
    response = client.get("/vendors", headers={"Origin": "http://evil.example"})
    assert response.status_code == 200  # endpoint itself still works
    assert "access-control-allow-origin" not in response.headers


# ---------------------------------------------------------------------------
# GET /users, GET /users/{user_id}
# ---------------------------------------------------------------------------

def test_get_users_empty(client):
    assert client.get("/users").json() == {"count": 0, "users": []}


def test_get_users(client, seeded):
    body = client.get("/users").json()
    assert body["count"] == 2
    assert {u["vendor_id"] for u in body["users"]} == {ACTIVE_VENDOR, PENDING_VENDOR}
    assert all(isinstance(u["_id"], str) for u in body["users"])


def test_get_user_by_user_id(client, seeded):
    user = client.get("/users/U200").json()["user"]
    assert user["vendor_id"] == ACTIVE_VENDOR


def test_get_user_by_vendor_id(client, seeded):
    user = client.get(f"/users/{PENDING_VENDOR}").json()["user"]
    assert user["user_id"] == "U201"


def test_get_user_by_object_id(client, seeded):
    doc = seeded.vendors.find_one({"vendor_id": ACTIVE_VENDOR})
    user = client.get(f"/users/{doc['_id']}").json()["user"]
    assert user["vendor_id"] == ACTIVE_VENDOR


def test_get_user_not_found(client, seeded):
    assert client.get("/users/U404").json() == {"error": "User not found"}


# ---------------------------------------------------------------------------
# GET /logs
# ---------------------------------------------------------------------------

def test_get_logs_empty(client):
    assert client.get("/logs").json() == {"count": 0, "logs": []}


def test_get_logs(client, seeded):
    body = client.get("/logs").json()
    assert body["count"] == 2
    assert all(log["action"] == "seed" for log in body["logs"])
    assert all(isinstance(log["_id"], str) for log in body["logs"])


# ---------------------------------------------------------------------------
# GET/POST /vendors, GET /vendors/{vendor_id}
# ---------------------------------------------------------------------------

def test_get_vendors_empty(client):
    assert client.get("/vendors").json() == {"count": 0, "vendors": []}


def test_get_vendors(client, seeded):
    body = client.get("/vendors").json()
    assert body["count"] == 2
    assert {v["vendor_id"] for v in body["vendors"]} == {ACTIVE_VENDOR, PENDING_VENDOR}


def test_create_vendor_success(client, db):
    response = client.post(
        "/vendors",
        json={"vendor_id": "V900", "shop_name": "New Shop", "status": "active"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "Vendor created successfully"
    assert body["vendor"]["vendor_id"] == "V900"
    assert body["vendor"]["status"] == "active"
    assert isinstance(body["vendor"]["_id"], str)

    assert db.vendors.count_documents({}) == 1

    # activity log written, referencing the new vendor's id
    log = db.logs.find_one({"action": "create_vendor"})
    assert log["vendor_id"] == body["vendor"]["_id"]
    assert "New Shop" in log["message"]


def test_create_vendor_defaults_status_to_pending(client, db):
    response = client.post("/vendors", json={"vendor_id": "V900", "shop_name": "New Shop"})
    assert response.json()["vendor"]["status"] == "pending"

    # and it therefore shows up in the pending queue
    pending = client.get("/pending/vendors").json()
    assert pending["count"] == 1
    assert pending["vendors"][0]["vendor_id"] == "V900"


def test_create_vendor_duplicate_id_rejected(client, db):
    client.post("/vendors", json={"vendor_id": "V900", "shop_name": "First"})
    response = client.post("/vendors", json={"vendor_id": "V900", "shop_name": "Dup"})

    assert response.json() == {"error": "Vendor with this vendor_id already exists"}
    assert db.vendors.count_documents({}) == 1
    # only the successful first create wrote a log -- the rejected attempt did not
    assert db.logs.count_documents({"action": "create_vendor"}) == 1


def test_get_vendor_found(client, seeded):
    vendor = client.get(f"/vendors/{ACTIVE_VENDOR}").json()["vendor"]
    assert vendor["shop_name"] == "Active Shop"
    assert isinstance(vendor["_id"], str)


def test_get_vendor_by_object_id(client, seeded):
    doc = seeded.vendors.find_one({"vendor_id": ACTIVE_VENDOR})
    vendor = client.get(f"/vendors/{doc['_id']}").json()["vendor"]
    assert vendor["vendor_id"] == ACTIVE_VENDOR


def test_get_vendor_not_found(client, seeded):
    assert client.get("/vendors/V404").json() == {"error": "Vendor not found"}


def test_pending_vendors_matches_status_or_verification_status(client, seeded):
    seeded.vendors.insert_one(
        {"vendor_id": "V202", "shop_name": "Awaiting Check",
         "status": "active", "verificationStatus": "pending"}
    )
    body = client.get("/pending/vendors").json()
    assert {v["vendor_id"] for v in body["vendors"]} == {PENDING_VENDOR, "V202"}


# ---------------------------------------------------------------------------
# GET /vendors/{vendor_id}/products
# ---------------------------------------------------------------------------

def test_vendor_products(client, seeded):
    body = client.get(f"/vendors/{ACTIVE_VENDOR}/products").json()
    assert body["count"] == 2
    assert {p["product_name"] for p in body["products"]} == {"Test Batter", "Other Batter"}
    assert all(isinstance(p["_id"], str) for p in body["products"])


def test_vendor_products_via_object_id(client, seeded):
    doc = seeded.vendors.find_one({"vendor_id": ACTIVE_VENDOR})
    body = client.get(f"/vendors/{doc['_id']}/products").json()
    assert body["count"] == 2


def test_vendor_products_scoped_by_inventory(client, seeded):
    # V201 only stocks "Other Batter", so only that product is returned
    body = client.get(f"/vendors/{PENDING_VENDOR}/products").json()
    assert [p["product_name"] for p in body["products"]] == ["Other Batter"]


def test_vendor_products_without_inventory_returns_all(client, seeded):
    """Documents current fallback behaviour: no inventory rows => every product."""
    body = client.get("/vendors/V999/products").json()
    assert body["count"] == 3


# ---------------------------------------------------------------------------
# GET /vendors/{vendor_id}/inventory and GET /inventory/{vendor_id}
# ---------------------------------------------------------------------------

def test_vendor_inventory(client, seeded):
    body = client.get(f"/vendors/{ACTIVE_VENDOR}/inventory").json()
    assert body["count"] == 2
    by_id = {i["inventory_id"]: i for i in body["inventory"]}
    assert by_id["INV200"]["quantity"] == 35.0
    assert by_id["INV201"]["quantity"] == 10.0


def test_inventory_alias_endpoint(client, seeded):
    body = client.get(f"/inventory/{ACTIVE_VENDOR}").json()
    assert body["count"] == 2
    assert {i["inventory_id"] for i in body["inventory"]} == {"INV200", "INV201"}


def test_vendor_inventory_scoped_to_vendor(client, seeded):
    # V201 sees only its own row even though V200 also stocks product P201
    body = client.get(f"/vendors/{PENDING_VENDOR}/inventory").json()
    assert [i["inventory_id"] for i in body["inventory"]] == ["INV202"]


# ---------------------------------------------------------------------------
# GET /vendors/{vendor_id}/orders
# ---------------------------------------------------------------------------

def test_vendor_orders(client, seeded):
    body = client.get(f"/vendors/{ACTIVE_VENDOR}/orders").json()
    assert body["vendor_id"] == ACTIVE_VENDOR
    assert body["count"] == 1
    assert body["orders"][0]["order_id"] == "ORD200"
    assert isinstance(body["orders"][0]["_id"], str)


def test_vendor_orders_unknown_vendor_is_empty(client, seeded):
    body = client.get("/vendors/V999/orders").json()
    assert body == {"vendor_id": "V999", "count": 0, "orders": []}


# ---------------------------------------------------------------------------
# GET /vendors/{vendor_id}/restock-requests
# ---------------------------------------------------------------------------

def test_vendor_restock_requests(client, seeded):
    body = client.get(f"/vendors/{ACTIVE_VENDOR}/restock-requests").json()
    assert body["vendor_id"] == ACTIVE_VENDOR
    assert body["count"] == 2
    assert {r["request_id"] for r in body["restock_requests"]} == {"RSR200", "RSR201"}


# ---------------------------------------------------------------------------
# GET/POST /restock-requests
# ---------------------------------------------------------------------------

def test_get_restock_requests_empty(client):
    assert client.get("/restock-requests").json() == {"count": 0, "restock_requests": []}


def test_create_restock_request(client, seeded):
    response = client.post(
        "/restock-requests",
        json={"vendor_id": ACTIVE_VENDOR,
              "items": [{"product_name": "Test Batter", "quantity": 5}]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "Restock request created"

    # request persisted with default status
    request = seeded.restock_requests.find_one({"_id": ObjectId(body["restock_id"])})
    assert request["status"] == "pending"
    assert request["items"] == [{"product_name": "Test Batter", "quantity": 5}]

    # companion order links back to the restock request
    order = seeded.orders.find_one({"_id": ObjectId(body["order_id"])})
    assert order["restock_request_id"] == body["restock_id"]
    assert order["status"] == "pending"

    # audit log written
    assert seeded.logs.count_documents({"action": "create_restock_request"}) == 1


def test_create_restock_request_requires_vendor_id(client, seeded):
    response = client.post("/restock-requests", json={"items": []})
    assert response.json() == {"error": "vendor_id is required"}
    # nothing was written
    assert seeded.restock_requests.count_documents({}) == 3


def test_restock_request_filters(client, seeded):
    assert client.get("/restock-requests").json()["count"] == 3

    approved = client.get("/restock-requests", params={"status": "approved"}).json()
    assert approved["count"] == 2
    assert {r["status"] for r in approved["restock_requests"]} == {"approved"}

    vendor = client.get("/restock-requests", params={"vendor_id": ACTIVE_VENDOR}).json()
    assert vendor["count"] == 2
    assert {r["vendor_id"] for r in vendor["restock_requests"]} == {ACTIVE_VENDOR}

    both = client.get(
        "/restock-requests",
        params={"vendor_id": ACTIVE_VENDOR, "status": "pending"},
    ).json()
    assert both["count"] == 1
    assert both["restock_requests"][0]["request_id"] == "RSR201"


# ---------------------------------------------------------------------------
# GET/POST /vendors/{vendor_id}/demands
# ---------------------------------------------------------------------------

def test_get_demands_empty_for_vendor_without_requests(client, seeded):
    body = client.get("/vendors/V999/demands").json()
    assert body == {"vendor_id": "V999", "demands": []}


def test_get_demands_returns_vendor_restock_requests(client, seeded):
    """Documents that /demands reads the shared restock_requests collection."""
    body = client.get(f"/vendors/{ACTIVE_VENDOR}/demands").json()
    assert body["vendor_id"] == ACTIVE_VENDOR
    assert {d["request_id"] for d in body["demands"]} == {"RSR200", "RSR201"}
    assert all(isinstance(d["_id"], str) for d in body["demands"])


def test_create_demand_maps_inventory_fields(client, seeded):
    demand_id = raise_demand(
        client, ACTIVE_VENDOR,
        items=[{"product_id": "P200", "quantity": 10}],
        priority="high",
    )

    stored = seeded.restock_requests.find_one({"_id": ObjectId(demand_id)})
    assert stored["vendor_id"] == ACTIVE_VENDOR
    assert stored["status"] == "pending"
    assert stored["priority"] == "high"
    assert isinstance(stored["created_at"], datetime)
    # demand items are enriched from the vendor's inventory row
    assert stored["items"] == [
        {
            "inventory_id": "INV200",
            "product_id": "P200",
            "product_name": "Test Batter",
            "batch_number": "BATCH-200",
            "quantity": 10,
        }
    ]


def test_create_demand_defaults_priority_to_normal(client, seeded):
    demand_id = raise_demand(
        client, ACTIVE_VENDOR, items=[{"product_id": "P200", "quantity": 1}]
    )
    stored = seeded.restock_requests.find_one({"_id": ObjectId(demand_id)})
    assert stored["priority"] == "normal"


def test_create_demand_without_items(client, seeded):
    response = client.post(f"/vendors/{ACTIVE_VENDOR}/demands", json={"items": []})
    assert response.json() == {"error": "No products selected"}
    # a missing "items" key behaves the same way
    response = client.post(f"/vendors/{ACTIVE_VENDOR}/demands", json={})
    assert response.json() == {"error": "No products selected"}
    assert seeded.restock_requests.count_documents({}) == 3


def test_create_demand_unmapped_product(client, seeded):
    response = client.post(
        f"/vendors/{ACTIVE_VENDOR}/demands",
        json={"items": [{"product_id": "P999", "quantity": 5}]},
    )
    assert response.json() == {"error": "Product P999 is not mapped"}
    assert seeded.restock_requests.count_documents({}) == 3


def test_create_demand_cannot_use_another_vendors_inventory(client, seeded):
    # P200 exists in inventory, but only for V200 -- V201 must not map it
    response = client.post(
        f"/vendors/{PENDING_VENDOR}/demands",
        json={"items": [{"product_id": "P200", "quantity": 2}]},
    )
    assert response.json() == {"error": "Product P200 is not mapped"}


# ---------------------------------------------------------------------------
# POST /vendors/{vendor_id}/demands/{demand_id}/confirm
# ---------------------------------------------------------------------------

def test_confirm_demand(client, seeded):
    demand_id = raise_demand(
        client, ACTIVE_VENDOR, items=[{"product_id": "P200", "quantity": 10}]
    )

    response = client.post(f"/vendors/{ACTIVE_VENDOR}/demands/{demand_id}/confirm")
    assert response.json() == {
        "message": "Demand confirmed",
        "demand_id": demand_id,
        "status": "confirmed",
    }

    stored = seeded.restock_requests.find_one({"_id": ObjectId(demand_id)})
    assert stored["status"] == "confirmed"
    assert isinstance(stored["confirmed_at"], datetime)


def test_confirm_demand_invalid_id(client, seeded):
    response = client.post(f"/vendors/{ACTIVE_VENDOR}/demands/not-a-valid-id/confirm")
    assert response.json() == {"error": "Invalid demand ID"}


def test_confirm_demand_wrong_vendor(client, seeded):
    demand_id = raise_demand(
        client, ACTIVE_VENDOR, items=[{"product_id": "P200", "quantity": 10}]
    )

    response = client.post(f"/vendors/{PENDING_VENDOR}/demands/{demand_id}/confirm")
    assert response.json() == {"error": "Demand not found"}
    # the demand stays untouched
    stored = seeded.restock_requests.find_one({"_id": ObjectId(demand_id)})
    assert stored["status"] == "pending"


# ---------------------------------------------------------------------------
# POST /vendors/{vendor_id}/inventory/sync
# ---------------------------------------------------------------------------

def test_sync_without_confirmed_demand(client, seeded):
    endpoint = f"/vendors/{ACTIVE_VENDOR}/inventory/sync"
    assert client.post(endpoint).json() == {"message": "No confirmed demand"}

    # merely raising a demand is not enough -- it must be confirmed first
    raise_demand(client, ACTIVE_VENDOR, items=[{"product_id": "P200", "quantity": 10}])
    assert client.post(endpoint).json() == {"message": "No confirmed demand"}


def test_full_demand_to_sync_flow(client, seeded):
    """End-to-end: raise -> list -> confirm -> sync -> verify -> re-sync."""
    demand_id = raise_demand(
        client, ACTIVE_VENDOR, items=[{"product_id": "P200", "quantity": 10}]
    )

    # shows up as pending (alongside the two seeded restock requests)
    demands = client.get(f"/vendors/{ACTIVE_VENDOR}/demands").json()["demands"]
    mine = next(d for d in demands if d["_id"] == demand_id)
    assert mine["status"] == "pending"
    assert len(demands) == 3

    # confirm
    confirm = client.post(f"/vendors/{ACTIVE_VENDOR}/demands/{demand_id}/confirm")
    assert confirm.json()["status"] == "confirmed"

    # sync restocks the inventory and reports the audit trail
    response = client.post(f"/vendors/{ACTIVE_VENDOR}/inventory/sync")
    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "Inventory synchronized"
    assert body["updated"] == [
        {
            "product_id": "P200",
            "product_name": "Test Batter",
            "batch_number": "BATCH-200",
            "old_quantity": 35.0,
            "new_quantity": 45.0,
        }
    ]

    # only the mapped inventory row changed, other vendor untouched
    inventory = {
        i["inventory_id"]: i
        for i in client.get(f"/vendors/{ACTIVE_VENDOR}/inventory").json()["inventory"]
    }
    assert inventory["INV200"]["quantity"] == 45.0
    assert inventory["INV200"]["last_updated"] != "2026-01-01T00:00:00"
    assert inventory["INV201"]["quantity"] == 10.0
    assert seeded.inventory.find_one({"inventory_id": "INV202"})["quantity"] == 5.0

    # demand marked as synchronized
    demands = client.get(f"/vendors/{ACTIVE_VENDOR}/demands").json()["demands"]
    mine = next(d for d in demands if d["_id"] == demand_id)
    assert mine["status"] == "synchronized"

    # running sync again has nothing left to do
    re_sync = client.post(f"/vendors/{ACTIVE_VENDOR}/inventory/sync")
    assert re_sync.json() == {"message": "No confirmed demand"}


def test_sync_updates_every_item_in_demand(client, seeded):
    demand_id = raise_demand(
        client,
        ACTIVE_VENDOR,
        items=[
            {"product_id": "P200", "quantity": 10},
            {"product_id": "P201", "quantity": 5},
        ],
    )
    client.post(f"/vendors/{ACTIVE_VENDOR}/demands/{demand_id}/confirm")

    body = client.post(f"/vendors/{ACTIVE_VENDOR}/inventory/sync").json()
    by_product = {u["product_id"]: u for u in body["updated"]}
    assert by_product["P200"]["old_quantity"] == 35.0
    assert by_product["P200"]["new_quantity"] == 45.0
    assert by_product["P201"]["old_quantity"] == 10.0
    assert by_product["P201"]["new_quantity"] == 15.0

    inventory = {
        i["inventory_id"]: i["quantity"]
        for i in client.get(f"/vendors/{ACTIVE_VENDOR}/inventory").json()["inventory"]
    }
    assert inventory == {"INV200": 45.0, "INV201": 15.0}
    # the other vendor's copy of P201 is untouched
    assert seeded.inventory.find_one({"inventory_id": "INV202"})["quantity"] == 5.0


def test_sync_is_scoped_to_the_requested_vendor(client, seeded):
    # V201 demands P201; V200 also stocks P201 but must not be touched
    demand_id = raise_demand(
        client, PENDING_VENDOR, items=[{"product_id": "P201", "quantity": 3}]
    )
    client.post(f"/vendors/{PENDING_VENDOR}/demands/{demand_id}/confirm")

    body = client.post(f"/vendors/{PENDING_VENDOR}/inventory/sync").json()
    assert body["updated"][0]["new_quantity"] == 8.0  # 5 + 3

    quantities = {
        i["inventory_id"]: i["quantity"]
        for i in seeded.inventory.find({})
    }
    assert quantities == {"INV200": 35.0, "INV201": 10.0, "INV202": 8.0}
