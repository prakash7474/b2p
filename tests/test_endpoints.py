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

from datetime import datetime, timedelta
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
    # Swap in place: backend/ml.py shares this same dict, so its routes move too.
    original_cols = dict(main.COLS)
    main.COLS.update({name: db[name] for name in original_cols})
    yield
    main.COLS.update(original_cols)


@pytest.fixture(autouse=True)
def _empty_collections(db):
    """Every test starts with empty collections."""
    for name in db.list_collection_names():
        db[name].drop()
    main._forget_catalog()  # products are cached for shelf-life lookups
    yield


ADMIN = {"sub": "U001", "role": "admin", "vendor_id": None}


@pytest.fixture(scope="session")
def client():
    # Endpoint tests run as the admin; auth itself is tested with real tokens below.
    main.app.dependency_overrides[main.current_user] = lambda: ADMIN
    main.app.dependency_overrides[main.optional_user] = lambda: ADMIN
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.clear()


@pytest.fixture()
def no_auth_override():
    """Run one test with real token checks instead of the admin override."""
    saved = dict(main.app.dependency_overrides)
    main.app.dependency_overrides.clear()
    yield
    main.app.dependency_overrides.update(saved)


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
    """Store a pending product demand and return its demand_id.

    The API now only takes batch requests, but product demands already in the
    database still go through confirm + sync, so they are written here in the
    shape the endpoint used to store (items enriched from the inventory row).
    """
    stored_items = []
    for item in items:
        row = main.COLS["inventory"].find_one({"vendor_id": vendor_id, "product_id": item["product_id"]})
        stored_items.append({
            "product_id": item["product_id"],
            "product_name": row.get("product_name"),
            "batch_number": row.get("batch_number"),
            "inventory_id": row.get("inventory_id"),
            "quantity": item["quantity"],
        })
    result = main.COLS["restock_requests"].insert_one({
        "vendor_id": vendor_id, "items": stored_items, "priority": priority or "normal",
        "status": "pending", "created_at": datetime.utcnow(),
    })
    return str(result.inserted_id)


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

@pytest.mark.xfail(strict=True, reason="product demands were re-enabled after the batch-only change")
def test_create_demand_refuses_product_quantities(client, seeded):
    # stock only reaches a shop as a batch, so a plain product quantity is refused
    response = client.post(f"/vendors/{ACTIVE_VENDOR}/demands",
                           json={"items": [{"product_id": "P200", "quantity": 10}]})
    assert response.json() == {"error": "Request a specific batch from the available batches list"}
    assert seeded.restock_requests.count_documents({}) == 3


def test_create_demand_batch_request_defaults_priority_to_normal(client, seeded):
    make_batch(seeded, "B-PRIO", status="available")
    demand_id = client.post(f"/vendors/{ACTIVE_VENDOR}/demands",
                            json={"items": [{"batch_id": "B-PRIO"}]}).json()["demand_id"]
    stored = seeded.restock_requests.find_one({"_id": ObjectId(demand_id)})
    assert stored["priority"] == "normal"
    assert stored["items"][0]["batch_id"] == "B-PRIO"


def test_create_demand_without_items(client, seeded):
    response = client.post(f"/vendors/{ACTIVE_VENDOR}/demands", json={"items": []})
    assert response.json() == {"error": "No products selected"}
    # a missing "items" key behaves the same way
    response = client.post(f"/vendors/{ACTIVE_VENDOR}/demands", json={})
    assert response.json() == {"error": "No products selected"}
    assert seeded.restock_requests.count_documents({}) == 3


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
    demands = client.get(f"/vendors/{ACTIVE_VENDOR}/restock-requests").json()["restock_requests"]
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
    demands = client.get(f"/vendors/{ACTIVE_VENDOR}/restock-requests").json()["restock_requests"]
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


# ---------------------------------------------------------------------------
# auth: tokens, roles, vendor ownership
# ---------------------------------------------------------------------------

def bearer(user_id, role, vendor_id=None):
    return {"Authorization": f"Bearer {main.issue_token(user_id, role, vendor_id)}"}


def test_routes_reject_missing_or_forged_tokens(client, seeded, no_auth_override):
    assert client.get("/users").status_code == 401
    # re-encode the payload with role=admin but keep the vendor's signature
    payload, signature = main.issue_token("U200", "vendor", ACTIVE_VENDOR).split(".")
    claims = main.json.loads(main.base64.urlsafe_b64decode(payload))
    forged = main.base64.urlsafe_b64encode(main.json.dumps({**claims, "role": "admin"}).encode()).decode()
    assert client.get("/users", headers={"Authorization": f"Bearer {forged}.{signature}"}).status_code == 401
    assert client.get("/", ).status_code == 200  # health check stays public


def test_vendor_token_only_reaches_its_own_shop(client, seeded, no_auth_override):
    headers = bearer("U200", "vendor", ACTIVE_VENDOR)
    assert client.get(f"/vendors/{ACTIVE_VENDOR}/inventory", headers=headers).status_code == 200
    assert client.get(f"/vendors/{PENDING_VENDOR}/inventory", headers=headers).status_code == 403
    assert client.get("/users", headers=headers).status_code == 403
    # a vendor listing restock requests only ever sees its own
    body = client.get("/restock-requests", params={"vendor_id": PENDING_VENDOR}, headers=headers).json()
    assert {r["vendor_id"] for r in body["restock_requests"]} == {ACTIVE_VENDOR}


def test_login_returns_token_with_linked_vendor(client, seeded, no_auth_override):
    seeded.users.insert_one({"user_id": "U200", "email": "Shop@Test.com", "phone": "999",
                             "password_hash": main.hash_password("pw"), "role": "vendor", "is_verified": True})
    # emails match case-insensitively
    body = client.post("/login", json={"login": "shop@test.com", "password": "pw"}).json()
    assert body["vendor_id"] == ACTIVE_VENDOR
    headers = {"Authorization": f"Bearer {body['token']}"}
    assert client.get(f"/vendors/{ACTIVE_VENDOR}/batches", headers=headers).status_code == 200


def test_public_signup_cannot_self_approve(client, db, no_auth_override):
    body = client.post("/vendors", json={"vendor_id": "V950", "shop_name": "Sneaky", "status": "active",
                                         "email": "X@Y.com", "password": "pw"}).json()
    assert body["vendor"]["status"] == "pending"
    assert db.users.find_one({"user_id": "V950"})["email"] == "x@y.com"


# ---------------------------------------------------------------------------
# vendor approval, batch returns, expiry, all-or-nothing orders
# ---------------------------------------------------------------------------

def make_batch(db, batch_id, vendor_id=None, status="received", remaining=10.0, age_hours=1):
    now = datetime.utcnow()
    db.batches.insert_one({
        "batch_id": batch_id, "vendor_id": vendor_id, "product_id": "P200", "product_name": "Test Batter",
        "volume_kg": 10.0, "remaining_volume_kg": remaining, "status": status, "exposed": True,
        "manufactured_at": now - timedelta(hours=age_hours), "created_at": now,
    })


def test_pending_vendor_cannot_request_batches_until_approved(client, seeded):
    make_batch(seeded, "B-AV", status="available")
    blocked = client.post(f"/vendors/{PENDING_VENDOR}/demands", json={"items": [{"batch_id": "B-AV"}]}).json()
    assert "awaiting admin approval" in blocked["error"]

    approved = client.post(f"/vendors/{PENDING_VENDOR}/status", json={"status": "active"}).json()
    assert approved["status"] == "active"
    assert seeded.vendors.find_one({"vendor_id": PENDING_VENDOR})["verificationStatus"] == "active"
    assert "demand_id" in client.post(f"/vendors/{PENDING_VENDOR}/demands",
                                      json={"items": [{"batch_id": "B-AV"}]}).json()


def test_return_batch_removes_stock_and_logs_movement(client, seeded):
    make_batch(seeded, "B-RET", vendor_id=ACTIVE_VENDOR, remaining=4.0)
    body = client.post(f"/vendors/{ACTIVE_VENDOR}/batches/B-RET/return", json={"reason": "expired"}).json()
    assert body == {"message": "Batch B-RET returned (4.0 kg)", "batch_id": "B-RET", "returned_kg": 4.0, "status": "returned"}
    assert seeded.batches.find_one({"batch_id": "B-RET"})["status"] == "returned"
    assert seeded.inventory.find_one({"inventory_id": "INV200"})["quantity"] == 31.0  # 35 - 4
    assert seeded.logs.find_one({"action": "return_batch", "batch_id": "B-RET"})["returned_kg"] == 4.0
    # a returned batch is no longer in the shop, so it cannot be returned twice
    again = client.post(f"/vendors/{ACTIVE_VENDOR}/batches/B-RET/return", json={}).json()
    assert "not in this vendor's store" in again["error"]


def test_order_skips_expired_batches(client, seeded):
    make_batch(seeded, "B-OLD", vendor_id=ACTIVE_VENDOR, remaining=6.0, age_hours=200)
    make_batch(seeded, "B-NEW", vendor_id=ACTIVE_VENDOR, remaining=2.0)
    body = client.post("/orders", json={"vendor_id": ACTIVE_VENDOR, "quantity_kg": 5}).json()
    assert body["error"] == "Only 2.0 kg available"  # the expired 6 kg is not sellable
    assert seeded.batches.find_one({"batch_id": "B-OLD"})["remaining_volume_kg"] == 6.0


def test_order_rolls_back_when_a_batch_changes_mid_sale(client, seeded, monkeypatch):
    make_batch(seeded, "B-1", vendor_id=ACTIVE_VENDOR, remaining=3.0, age_hours=5)
    make_batch(seeded, "B-2", vendor_id=ACTIVE_VENDOR, remaining=3.0, age_hours=2)
    real = main.COLS["batches"]

    class LosesSecondBatch:
        """Delegates to the real collection, but the sale's write to B-2 hits a stale lock."""
        def __getattr__(self, name):
            return getattr(real, name)

        def update_one(self, query, update, **kwargs):
            if query.get("_id") == real.find_one({"batch_id": "B-2"})["_id"] and "updated_at" in query \
                    and update.get("$set", {}).get("remaining_volume_kg") == 1.0:
                query = {**query, "updated_at": "someone-else-changed-it"}
            return real.update_one(query, update, **kwargs)

    monkeypatch.setitem(main.COLS, "batches", LosesSecondBatch())
    body = client.post("/orders", json={"vendor_id": ACTIVE_VENDOR, "quantity_kg": 5}).json()

    assert "please retry" in body["error"]
    assert seeded.batches.find_one({"batch_id": "B-1"})["remaining_volume_kg"] == 3.0  # put back
    assert seeded.batches.find_one({"batch_id": "B-1"})["status"] == "received"
    assert seeded.orders.count_documents({"order_id": {"$regex": "^ORD-"}}) == 0
    assert seeded.inventory_movement.count_documents({}) == 0


def test_restock_request_rejects_bad_items(client, seeded):
    bad = client.post("/restock-requests", json={"vendor_id": ACTIVE_VENDOR,
                                                 "items": [{"product_id": "P200", "quantity": -1}]}).json()
    assert bad == {"error": "Each item needs a quantity greater than 0"}
    assert seeded.restock_requests.count_documents({}) == 3


def test_festival_calendar_accepts_only_trained_types(client, seeded):
    bad = client.post("/festival-calendar", json={"date": "2027-01-15", "festivalType": "carnival"}).json()
    assert "festivalType must be one of" in bad["error"]
    ok = client.post("/festival-calendar", json={"date": "2027-01-15", "festivalType": "harvestFestival",
                                                 "windowDays": 4, "festivalName": "Pongal"}).json()
    assert ok["festival"]["festivalName"] == "Pongal"
    assert client.get("/festival-calendar").json()["count"] == 1


def test_vendor_sees_only_its_own_logs(client, seeded, no_auth_override):
    seeded.logs.insert_many([{"action": "receive_batch", "vendor_id": ACTIVE_VENDOR},
                             {"action": "receive_batch", "vendor_id": PENDING_VENDOR}])
    body = client.get("/logs", headers=bearer("U200", "vendor", ACTIVE_VENDOR)).json()
    assert {log["vendor_id"] for log in body["logs"]} == {ACTIVE_VENDOR}


# ---------------------------------------------------------------------------
# products: add / update / remove
# ---------------------------------------------------------------------------

NEW_PRODUCT = {"product_name": "Coconut Chutney", "category": "side", "shelf_life_fridge_hrs": 48,
               "shelf_life_ambient_hrs": "8", "price": 40}


def test_create_product_assigns_next_id_and_numbers(client, db):
    db.products.insert_one({"product_id": "P001", "product_name": "Idli Batter"})
    response = client.post("/products", json=NEW_PRODUCT)
    assert response.status_code == 200
    product = response.json()["product"]
    assert product["product_id"] == "P002"
    assert (product["shelf_life_ambient_hrs"], product["price"], product["unit_type"]) == (8.0, 40.0, "kg")


def test_create_product_refuses_duplicates_and_bad_numbers(client, db):
    db.products.insert_one({"product_id": "P001", "product_name": "Idli Batter"})
    dup = client.post("/products", json={**NEW_PRODUCT, "product_name": "idly batter"})
    assert (dup.status_code, dup.json()) == (409, {"error": "idly batter already exists as P001"})
    bad = client.post("/products", json={**NEW_PRODUCT, "shelf_life_fridge_hrs": "soon"})
    assert (bad.status_code, bad.json()) == (400, {"error": "shelf_life_fridge_hrs must be a number"})
    missing = client.post("/products", json={"product_name": "Sambar"})
    assert missing.status_code == 400


def test_update_product_changes_metadata_but_not_model_names(client, db):
    db.products.insert_many([{"product_id": "P001", "product_name": "Idli Batter", "price": 80},
                             {"product_id": "P010", "product_name": "Sambar", "price": 30}])
    response = client.put("/products/P001", json={"price": 90, "shelf_life_fridge_hrs": 70})
    assert response.status_code == 200
    assert db.products.find_one({"product_id": "P001"})["price"] == 90.0
    renamed_model = client.put("/products/P001", json={"product_name": "Classic Idli"})
    assert renamed_model.status_code == 400
    renamed = client.put("/products/P010", json={"product_name": "Tiffin Sambar"})
    assert renamed.json()["product"]["product_name"] == "Tiffin Sambar"
    assert client.put("/products/P999", json={"price": 1}).status_code == 404


def test_delete_product_refuses_while_batches_are_active(client, db):
    db.products.insert_one({"product_id": "P010", "product_name": "Sambar"})
    db.batches.insert_one({"batch_id": "B1", "product_id": "P010", "status": "available",
                           "volume_kg": 5, "remaining_kg": 5})
    blocked = client.delete("/products/P010")
    assert blocked.status_code == 409
    db.batches.update_one({"batch_id": "B1"}, {"$set": {"status": "returned"}})
    assert client.delete("/products/P010").status_code == 200
    assert db.products.count_documents({}) == 0


@pytest.mark.xfail(strict=True, reason="inventory-alert routes and auto-resolve removed in 504b9c7")
def test_receiving_fresh_stock_clears_that_products_alerts(client, seeded):
    make_batch(seeded, "B-LOW", vendor_id=ACTIVE_VENDOR, remaining=1.0)
    make_batch(seeded, "B-NEXT", vendor_id=ACTIVE_VENDOR, status="assigned")
    seeded.inventory_alerts.insert_one({"alert_id": "ALT-1", "vendor_id": ACTIVE_VENDOR, "batch_id": "B-LOW",
                                        "alert_status": "active"})
    assert client.get("/inventory-alerts", params={"status": "active"}).json()["count"] == 1
    client.post(f"/vendors/{ACTIVE_VENDOR}/batches/B-NEXT/receive")
    alert = client.get("/inventory-alerts").json()["alerts"][0]
    assert (alert["alert_status"], alert["resolved_by"]) == ("resolved", "received B-NEXT")
    assert client.get("/orders").json()["count"] == 2


def test_nearby_search_lists_only_fresh_sellable_stock(client, seeded):
    seeded.vendors.update_one({"vendor_id": ACTIVE_VENDOR},
                              {"$set": {"location_geo": {"type": "Point", "coordinates": [80.27, 13.08]}}})
    main.COLS["vendors"].create_index([("location_geo", "2dsphere")])
    make_batch(seeded, "B-FRESH", vendor_id=ACTIVE_VENDOR, remaining=4.0)
    make_batch(seeded, "B-STALE", vendor_id=ACTIVE_VENDOR, remaining=9.0, age_hours=200)
    vendors = client.get("/vendors", params={"latitude": 13.08, "longitude": 80.27}).json()["vendors"]
    assert vendors[0]["available_inventory"] == [{"product_id": "P200", "product_name": "Test Batter", "quantity": 4.0}]


def test_new_shop_gets_baseline_forecast_for_every_product(client, seeded):
    seeded.products.insert_many([{"product_id": "P001", "product_name": "Idli Batter"},
                                 {"product_id": "P002", "product_name": "Dosa Batter"},
                                 {"product_id": "P003", "product_name": "Combo Pack"}])
    now = datetime.utcnow()
    seeded.batches.insert_one({"batch_id": "B-IDLI", "product_id": "P001", "product_name": "Idli Batter",
                               "volume_kg": 15.0, "remaining_volume_kg": 15.0, "status": "available",
                               "exposed": True, "manufactured_at": now, "created_at": now})

    body = client.get(f"/vendors/{ACTIVE_VENDOR}/demand-forecast").json()
    rows = {row["model_product"]: row for row in body["forecast"]}
    assert set(rows) == {"Idly_Batter", "Dosa_Batter", "Combo_Pack"}
    assert all(row["history_source"] == "baseline" for row in rows.values())
    idli = rows["Idly_Batter"]
    # nothing held or requested: restock is the whole demand + safety stock
    assert idli["predicted_demand"] > 15 and idli["refill_quantity"] == idli["recommended_stock"]
    assert [b["batch_id"] for b in idli["suggested_batches"]] == ["B-IDLI"]
    assert idli["uncovered_kg"] == round(idli["refill_quantity"] - 15.0, 1)
    assert body["summary"]["refill_quantity"] == round(sum(r["refill_quantity"] for r in rows.values()), 1)
    assert body["summary"]["products_to_restock"] == 3

    # requesting the suggested batch counts as incoming stock and is no longer suggested
    client.post(f"/vendors/{ACTIVE_VENDOR}/demands", json={"items": [{"batch_id": "B-IDLI"}]})
    idli = {r["model_product"]: r for r in client.get(f"/vendors/{ACTIVE_VENDOR}/demand-forecast").json()["forecast"]}["Idly_Batter"]
    assert idli["requested_kg"] == 15.0
    assert idli["refill_quantity"] == round(idli["recommended_stock"] - 15.0, 1)
    assert idli["suggested_batches"] == []


def test_locality_is_validated_and_drives_the_baseline_forecast(client, seeded):
    bad = client.post("/vendors", json={"vendor_id": "V960", "shop_name": "X", "locality_tier": "downtown"}).json()
    assert bad["error"].startswith("locality_tier must be one of")
    ok = client.post("/vendors", json={"vendor_id": "V961", "shop_name": "Y", "locality_tier": "commercial"}).json()
    assert ok["vendor"]["locality_tier"] == "commercial_offices"  # alias normalised

    seeded.products.insert_one({"product_id": "P001", "product_name": "Idli Batter"})
    demand = {}
    for tier in ("residential_budget", "commercial_offices"):
        assert client.post(f"/vendors/{ACTIVE_VENDOR}/locality", json={"locality_tier": tier}).json()["locality_tier"] == tier
        vendor = seeded.vendors.find_one({"vendor_id": ACTIVE_VENDOR})
        assert vendor["locality_tier"] == vendor["localityTier"] == tier
        demand[tier] = client.get(f"/vendors/{ACTIVE_VENDOR}/demand-forecast").json()["forecast"][0]["predicted_demand"]
    # office areas sell far more batter than budget housing in the training data
    assert demand["commercial_offices"] > demand["residential_budget"] * 1.5


def test_errors_use_real_status_codes_and_one_body_shape(client, seeded):
    missing = client.get("/vendors/V999")
    assert (missing.status_code, missing.json()) == (404, {"error": "Vendor not found"})
    dup = client.post("/vendors", json={"vendor_id": ACTIVE_VENDOR, "shop_name": "Again"})
    assert dup.status_code == 409
    bad = client.post("/orders", json={"vendor_id": ACTIVE_VENDOR, "quantity_kg": 0})
    assert (bad.status_code, bad.json()) == (400, {"error": "quantity_kg must be greater than 0"})


def test_list_routes_page_newest_first(client, seeded):
    seeded.logs.insert_one({"type": "activity", "action": "seed", "message": "three"})
    first = client.get("/logs", params={"limit": 2}).json()["logs"]
    assert [log["message"] for log in first] == ["three", "two"]
    assert [log["message"] for log in client.get("/logs", params={"limit": 2, "skip": 2}).json()["logs"]] == ["one"]
    assert client.get("/logs", params={"limit": 0}).status_code == 422


# ---------------------------------------------------------------------------
# GET /shop-stock
# ---------------------------------------------------------------------------

def test_shop_stock_splits_sellable_awaiting_and_expired(client, seeded, db):
    now = datetime.utcnow()
    db.products.insert_one({"product_id": "P001", "product_name": "Idli Batter",
                            "shelf_life_fridge_hrs": 72, "shelf_life_ambient_hrs": 24})
    db.batches.insert_many([
        # received, fresh, 2 of 10 kg left: sellable and low (threshold 2 kg)
        {"batch_id": "S1", "product_id": "P001", "product_name": "Idli Batter", "vendor_id": ACTIVE_VENDOR,
         "status": "received", "volume_kg": 10, "remaining_volume_kg": 2, "manufactured_at": now - timedelta(hours=2)},
        # assigned, not yet confirmed by the shop
        {"batch_id": "S2", "product_id": "P001", "product_name": "Idli Batter", "vendor_id": ACTIVE_VENDOR,
         "status": "assigned", "volume_kg": 5, "manufactured_at": now - timedelta(hours=1)},
        # past its 72 h shelf life
        {"batch_id": "S3", "product_id": "P001", "product_name": "Idli Batter", "vendor_id": ACTIVE_VENDOR,
         "status": "received", "volume_kg": 4, "manufactured_at": now - timedelta(hours=80)},
    ])
    body = client.get("/shop-stock").json()
    shop = next(s for s in body["shops"] if s["vendor_id"] == ACTIVE_VENDOR)
    row = shop["products"][0]
    assert (row["sellable_kg"], row["awaiting_kg"], row["expired_kg"], row["held_kg"]) == (2.0, 5.0, 4.0, 7.0)
    assert row["low_stock"] is True
    levels = sorted(alert["level"] for alert in shop["alerts"])
    assert levels == ["danger", "info", "warning"]
    # the pending vendor holds nothing, so it is left out
    assert PENDING_VENDOR not in {s["vendor_id"] for s in body["shops"]}
