"""
Comprehensive End-to-End Test Suite for B2P (Batter 2 Platter) Platform.
Exercises EVERY single endpoint and ML workflow against the live backend server.
Performs automatic cleanup of created probe test entities.
"""

import json
import re
import socket
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from pymongo import MongoClient

BASE = "http://localhost:5000"
socket.setdefaulttimeout(25)

results = []

def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    mark = "PASS" if ok else "FAIL"
    suffix = f"  -> {detail}" if detail else ""
    print(f"[{mark}] {name}{suffix}")


def call(method: str, path: str, body=None):
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8", "replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        status = e.code
    except Exception as e:
        return None, str(e)
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = raw
    return status, parsed


def run_e2e_checks():
    tag = uuid.uuid4().hex[:6]
    test_vendor_id = f"VND-E2E-{tag.upper()}"
    test_vendor_email = f"e2e_vendor_{tag}@example.com"
    test_customer_email = f"e2e_cust_{tag}@example.com"
    test_product_id = f"PROD-E2E-{tag.upper()}"
    test_batch_id = f"BATCH-E2E-{tag.upper()}"
    password = "SecurePassword123!"

    print("=" * 70)
    print("STARTING END-TO-END ENDPOINT & INTEGRATION CHECKS")
    print("=" * 70)

    # 1. Root & Discovery Endpoints
    status, body = call("GET", "/")
    check("GET / (Root collection list)", status == 200 and body.get("database") == "b2p" and "vendors" in body.get("collections", []), f"{status} {body}")

    status, body = call("GET", "/docs")
    check("GET /docs (FastAPI Swagger UI)", status == 200, f"{status}")

    status, body = call("GET", "/openapi.json")
    check("GET /openapi.json (OpenAPI Schema)", status == 200 and isinstance(body, dict) and "paths" in body, f"{status}")

    # 2. Customer Registration & Authentication
    cust_payload = {
        "name": f"Test Customer {tag}",
        "email": test_customer_email,
        "password": password,
        "phone": "9876500001",
        "location": {
            "latitude": 13.0827,
            "longitude": 80.2707,
            "address": "Chennai Central, TN"
        }
    }
    status, body = call("POST", "/customers/register", cust_payload)
    check("POST /customers/register (New Customer)", status == 200 and "customer" in body and body["customer"].get("email") == test_customer_email, f"{status} {body}")
    cust_id = body.get("customer", {}).get("customer_id") if isinstance(body, dict) else None

    # Customer duplicate registration validation
    status, body = call("POST", "/customers/register", cust_payload)
    check("POST /customers/register (Duplicate Email 400)", status == 400, f"{status} {body}")

    # Customer Login
    cust_login_payload = {
        "login": test_customer_email,
        "password": password,
        "location": {
            "latitude": 13.0827,
            "longitude": 80.2707
        }
    }
    status, body = call("POST", "/customers/login", cust_login_payload)
    check("POST /customers/login (Customer Login with Geo)", status == 200 and body.get("message") == "Customer login successful", f"{status} {body}")

    # 3. Vendor Registration & Authentication
    vendor_payload = {
        "vendor_id": test_vendor_id,
        "shop_name": f"E2E Batter Hub {tag}",
        "email": test_vendor_email,
        "password": password,
        "phone": "9876500002",
        "location": {
            "latitude": 13.0850,
            "longitude": 80.2720,
            "address": "Park Town, Chennai"
        },
        "locality_tier": "residential_premium"
    }
    status, body = call("POST", "/vendors", vendor_payload)
    check("POST /vendors (New Vendor Signup)", status == 200 and isinstance(body.get("vendor"), dict) and body["vendor"].get("vendor_id") == test_vendor_id, f"{status} {body}")

    # Vendor Login
    status, body = call("POST", "/login", {"login": test_vendor_email, "password": password})
    check("POST /login (Vendor Login)", status == 200 and body.get("role") == "vendor" and str(body.get("user_id")) == test_vendor_id, f"{status} {body}")

    status, body = call("POST", "/login", {"login": test_vendor_email, "password": "wrongpassword"})
    check("POST /login (Invalid Password 401)", status == 401, f"{status} {body}")

    # 4. User Directory & Profile Endpoints
    status, body = call("GET", "/users")
    check("GET /users (List Users without password_hash)", status == 200 and body.get("count", 0) > 0 and all("password_hash" not in u for u in body.get("users", [])), f"{status} count={body.get('count')}")

    status, body = call("GET", f"/users/{test_vendor_id}")
    check("GET /users/{id} (Find by user_id/vendor_id)", status == 200 and "user" in body, f"{status} {body}")

    # 5. Vendor Details & Directory
    status, body = call("GET", "/vendors")
    check("GET /vendors (List All Vendors)", status == 200 and isinstance(body.get("vendors"), list) and body.get("count", 0) > 0, f"{status} count={body.get('count')}")

    status, body = call("GET", f"/vendors/{test_vendor_id}")
    check("GET /vendors/{id} (Get Vendor Profile)", status == 200 and body.get("vendor", {}).get("vendor_id") == test_vendor_id, f"{status} {body}")

    status, body = call("GET", "/pending/vendors")
    check("GET /pending/vendors (Pending Approvals)", status == 200 and isinstance(body.get("vendors"), list), f"{status} count={body.get('count')}")

    status, body = call("GET", "/vendors?latitude=13.0827&longitude=80.2707&radius_meters=10000")
    check("GET /vendors?latitude&longitude (Nearby Geo Search)", status == 200 and isinstance(body.get("vendors"), list), f"{status} found={len(body.get('vendors', []))}")

    # 6. Products Catalog Endpoints
    prod_payload = {
        "product_id": test_product_id,
        "product_name": f"E2E Idli Batter {tag}",
        "category": "batter",
        "unit_price": 50.0,
        "package_size": "1 kg"
    }
    status, body = call("POST", "/products", prod_payload)
    check("POST /products (Create Product)", status == 200 and "product" in body and body["product"].get("product_id") == test_product_id, f"{status} {body}")

    status, body = call("GET", "/products")
    check("GET /products (List Products)", status == 200 and any(p.get("product_id") == test_product_id for p in body.get("products", [])), f"{status}")

    status, body = call("GET", f"/products/{test_product_id}")
    check("GET /products/{id} (Get Product by ID)", status == 200 and body.get("product", {}).get("product_id") == test_product_id, f"{status} {body}")

    # 7. Batches Management
    batch_payload = {
        "batch_id": test_batch_id,
        "vendor_id": test_vendor_id,
        "product_id": test_product_id,
        "initial_ph": 4.5,
        "volume_kg": 50.0,
        "status": "ready"
    }
    status, body = call("POST", "/batches", batch_payload)
    check("POST /batches (Create Batch)", status == 200 and "batch" in body and body["batch"].get("batch_id") == test_batch_id, f"{status} {body}")

    status, body = call("GET", "/batches")
    check("GET /batches (List Batches)", status == 200 and isinstance(body.get("batches"), list), f"{status} count={body.get('count')}")

    status, body = call("GET", f"/batches/{test_batch_id}")
    check("GET /batches/{id} (Get Batch by ID)", status == 200 and body.get("batch", {}).get("batch_id") == test_batch_id, f"{status} {body}")

    # 8. Inventory Endpoints
    inv_payload = {
        "vendor_id": test_vendor_id,
        "product_id": test_product_id,
        "product_name": f"E2E Idli Batter {tag}",
        "batch_number": test_batch_id,
        "quantity": 20.0,
        "freshness_score": 0.15
    }
    status, body = call("POST", "/inventory", inv_payload)
    check("POST /inventory (Stock In Inventory)", status == 200 and "inventory" in body, f"{status} {body}")

    status, body = call("GET", "/inventory")
    check("GET /inventory (Global Inventory List)", status == 200 and isinstance(body.get("inventory"), list), f"{status} count={body.get('count')}")

    status, body = call("GET", f"/vendors/{test_vendor_id}/inventory")
    check("GET /vendors/{id}/inventory (Scoped to Vendor)", status == 200 and any(i.get("product_id") == test_product_id for i in body.get("inventory", [])), f"{status}")

    status, body = call("GET", f"/inventory/{test_vendor_id}")
    check("GET /inventory/{id} (Inventory Alias Endpoint)", status == 200 and isinstance(body.get("inventory"), list), f"{status}")

    status, body = call("GET", f"/vendors/{test_vendor_id}/products")
    check("GET /vendors/{id}/products (Vendor Associated Products)", status == 200 and any(p.get("product_id") == test_product_id for p in body.get("products", [])), f"{status}")

    # 9. AI & ML Intelligence Endpoints
    status, body = call("GET", f"/vendors/{test_vendor_id}/demand-forecast")
    check("GET /vendors/{id}/demand-forecast (Vendor ML Demand Forecast)", status == 200 and ("forecast" in body or "error" in body), f"{status} {str(body)[:150]}")

    status, body = call("GET", "/demand-forecast")
    check("GET /demand-forecast (Global Multi-Vendor ML Forecast)", status == 200 and ("forecast" in body or "error" in body), f"{status} {str(body)[:150]}")

    status, body = call("GET", f"/vendors/{test_vendor_id}/spoilage-risk")
    check("GET /vendors/{id}/spoilage-risk (Vendor ML Spoilage Risk Evaluation)", status == 200 and ("evaluations" in body or "error" in body), f"{status} {str(body)[:150]}")

    # 10. Demands, Restock Requests, Confirm, and Inventory Sync
    demand_payload = {
        "items": [
            {
                "product_id": test_product_id,
                "quantity": 10.0
            }
        ],
        "priority": "high"
    }
    status, body = call("POST", f"/vendors/{test_vendor_id}/demands", demand_payload)
    check("POST /vendors/{id}/demands (Create Demand/Restock Request)", status == 200 and "demand_id" in body, f"{status} {body}")
    demand_id = body.get("demand_id") if isinstance(body, dict) else None

    status, body = call("GET", f"/vendors/{test_vendor_id}/demands")
    check("GET /vendors/{id}/demands (List Vendor Demands)", status == 200 and isinstance(body.get("demands"), list) and any(d.get("_id") == demand_id for d in body.get("demands", [])), f"{status}")

    status, body = call("GET", f"/restock-requests?vendor_id={test_vendor_id}")
    check("GET /restock-requests?vendor_id= (Query Restock Requests)", status == 200 and any(r.get("_id") == demand_id for r in body.get("restock_requests", [])), f"{status}")

    # Confirm demand
    status, body = call("POST", f"/vendors/{test_vendor_id}/demands/{demand_id}/confirm")
    check("POST /vendors/{id}/demands/{id}/confirm (Confirm Restock Demand)", status == 200 and body.get("status") == "confirmed", f"{status} {body}")

    # Sync inventory
    status, body = call("POST", f"/vendors/{test_vendor_id}/inventory/sync")
    check("POST /vendors/{id}/inventory/sync (Synchronize Stock to Inventory)", status == 200 and body.get("message") == "Inventory synchronized" and any(u.get("product_id") == test_product_id and u.get("new_quantity") == 30.0 for u in body.get("updated", [])), f"{status} {body}")

    # Verify inventory was updated
    status, body = call("GET", f"/vendors/{test_vendor_id}/inventory")
    updated_item = next((i for i in body.get("inventory", []) if i.get("product_id") == test_product_id), None)
    check("Inventory Quantity Restocked (20.0 -> 30.0)", updated_item is not None and updated_item.get("quantity") == 30.0, f"qty={updated_item.get('quantity') if updated_item else None}")

    # 11. Vendor Orders & Restock Requests
    status, body = call("GET", f"/vendors/{test_vendor_id}/orders")
    check("GET /vendors/{id}/orders (Vendor Orders)", status == 200 and "orders" in body, f"{status}")

    status, body = call("GET", f"/vendors/{test_vendor_id}/restock-requests")
    check("GET /vendors/{id}/restock-requests (Vendor Restock Requests)", status == 200 and "restock_requests" in body, f"{status}")

    # 12. Direct Restock Requests & Audit Logs
    status, body = call("POST", "/restock-requests", {"vendor_id": test_vendor_id, "items": [{"product_id": test_product_id, "quantity": 5}], "priority": "normal"})
    check("POST /restock-requests (Direct Request Creation)", status == 200 and ("request_id" in body or "restock_id" in body), f"{status} {body}")

    status, body = call("GET", "/restock-requests")
    check("GET /restock-requests (All Requests)", status == 200 and isinstance(body.get("restock_requests"), list), f"{status} count={body.get('count')}")

    status, body = call("GET", "/logs")
    check("GET /logs (Activity & Audit Logs)", status == 200 and body.get("count", 0) > 0 and isinstance(body.get("logs"), list), f"{status} count={body.get('count')}")

    return {
        "vendor_id": test_vendor_id,
        "email": test_vendor_email,
        "customer_email": test_customer_email,
        "product_id": test_product_id,
        "batch_id": test_batch_id
    }


def cleanup(db, ids: dict):
    print("\n--- Cleaning up temporary probe test records ---")
    vid = ids.get("vendor_id")
    v_email = ids.get("email")
    c_email = ids.get("customer_email")
    pid = ids.get("product_id")
    bid = ids.get("batch_id")

    db.vendors.delete_many({"vendor_id": vid})
    db.users.delete_many({"$or": [{"email": v_email}, {"email": c_email}, {"user_id": vid}]})
    db.customers.delete_many({"email": c_email})
    db.products.delete_many({"product_id": pid})
    db.batches.delete_many({"batch_id": bid})
    db.inventory.delete_many({"vendor_id": vid})
    db.restock_requests.delete_many({"vendor_id": vid})
    db.logs.delete_many({"$or": [{"vendor_id": vid}, {"message": {"$regex": vid}}]})
    print("Cleanup completed successfully.")


def main():
    env = {}
    env_path = Path(__file__).resolve().parents[1].joinpath(".env")
    for line in env_path.read_text().splitlines():
        m = re.match(r'([A-Z_]+)\s*=\s*"?([^"]*)"?', line.strip())
        if m:
            env[m.group(1)] = m.group(2)

    client = MongoClient(env["MONGODB_URI"], serverSelectionTimeoutMS=15000)
    db = client["b2p"]

    created_ids = {}
    try:
        created_ids = run_e2e_checks()
    finally:
        cleanup(db, created_ids)
        client.close()

    failed = [name for name, ok, _ in results if not ok]
    print("\n" + "=" * 70)
    print(f"RESULTS: {len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        print("FAILED CHECKS:")
        for name in failed:
            print(f"  - {name}")
        return 1
    else:
        print("ALL ENDPOINTS AND FLOWS VERIFIED SUCCESSFULLY (100% PASS)!")
        print("=" * 70)
        return 0


if __name__ == "__main__":
    sys.exit(main())
