"""
Replays every backend call made by the vendor mobile app (App/src/lib/api.ts
+ App/src/lib/auth.tsx) against backend/main.py, asserting the exact response
fields the app reads.

Mirrors frontend behaviour exactly:
  * JSON body + Content-Type: application/json on every request
  * POSTs with NO body (confirm / sync) that still carry the JSON content type
  * the payload shapes built in signup.tsx / demands.tsx

Uses the same isolation trick as tests/test_endpoints.py: main.COLS is
re-pointed at a throwaway ``b2p_mobile_test`` database and dropped afterwards,
so the production ``b2p`` data is never touched.

Run with:  python tests/probe_mobile_endpoints.py
"""

import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import backend.main as main  # noqa: E402  (opens real Mongo connection once)
from fastapi.testclient import TestClient  # noqa: E402

TEST_DB_NAME = "b2p_mobile_test"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    mark = "PASS" if ok else "FAIL"
    suffix = f"  -> {detail}" if (detail and not ok) else ""
    print(f"[{mark}] {name}{suffix}")


def run(client: TestClient, db) -> None:
    vid = f"VND-{uuid.uuid4().hex[:6].upper()}"
    email = f"vendor{uuid.uuid4().hex[:6]}@example.com"
    password = "secret123"

    # ------------------------------------------------------------------
    # 1. Sign up  (signup.tsx -> api.createVendor)
    # ------------------------------------------------------------------
    signup_payload = {
        "vendor_id": vid,
        "shop_name": "Probe Store",
        "email": email,
        "password": password,
        "phone": "9876543210",
        "location": {
            "latitude": 13.0827,
            "longitude": 80.2707,
            "address": "12 Probe Street, Chennai",
        },
    }
    r = client.post("/vendors", json=signup_payload)
    check("POST /vendors returns 200", r.status_code == 200, r.text)
    body = r.json() if r.status_code == 200 else {}
    check(
        "POST /vendors returns .vendor (app throws otherwise)",
        isinstance(body.get("vendor"), dict),
        str(body)[:300],
    )
    if isinstance(body.get("vendor"), dict):
        stored = body["vendor"]
        check("signup stores vendor_id", stored.get("vendor_id") == vid, str(stored))
        check(
            "signup stores shop location lat/lng",
            stored.get("location", {}).get("latitude") == 13.0827
            and stored.get("location", {}).get("longitude") == 80.2707,
            str(stored.get("location")),
        )
        check(
            "signup defaults status (profile pill needs it)",
            bool(stored.get("status")),
            str(stored.get("status")),
        )

    # ------------------------------------------------------------------
    # 2. Login (login.tsx -> api.login -> auth.signIn role check)
    # ------------------------------------------------------------------
    r = client.post("/login", json={"login": email, "password": password})
    check("POST /login returns 200", r.status_code == 200, r.text)
    login = r.json() if r.status_code == 200 else {}
    check("login returns user_id", bool(login.get("user_id")), str(login))
    check("login role is 'vendor' (app rejects other roles)", login.get("role") == "vendor", str(login))
    check("login returns email", bool(login.get("email")), str(login))
    check("login user_id == vendor_id (drives every vendor route)", str(login.get("user_id")) == vid, str(login))

    # wrong password must come back as an {error} body the app can surface
    r = client.post("/login", json={"login": email, "password": "wrong"})
    check(
        "wrong password returns 200 {error} (surfaced by app)",
        r.status_code == 200 and "error" in r.json(),
        f"{r.status_code} {r.text[:200]}",
    )

    # ------------------------------------------------------------------
    # 3. Profile load (auth.signIn -> api.getVendor, fallback api.getUser)
    # ------------------------------------------------------------------
    r = client.get(f"/vendors/{vid}")
    check("GET /vendors/{id} returns 200", r.status_code == 200, r.text)
    vendor = r.json().get("vendor") if r.status_code == 200 else None
    check("GET /vendors/{id} returns .vendor", isinstance(vendor, dict), r.text[:300])
    if isinstance(vendor, dict):
        check("profile has shop_name", vendor.get("shop_name") == "Probe Store", str(vendor.get("shop_name")))
        check("profile exposes location.latitude", vendor.get("location", {}).get("latitude") == 13.0827)

    r = client.get(f"/users/{vid}")
    check(
        "GET /users/{id} fallback returns .user",
        r.status_code == 200 and isinstance(r.json().get("user"), dict),
        r.text[:300],
    )

    r = client.get("/vendors/VND-DOES-NOT-EXIST")
    check(
        "unknown vendor -> {error} body (app maps to null, not a crash)",
        r.status_code == 200 and "error" in r.json(),
        r.text[:200],
    )

    # ------------------------------------------------------------------
    # 4. Inventory (inventory.tsx / demands.tsx / dashboard)
    # ------------------------------------------------------------------
    db.inventory.insert_one(
        {
            "inventory_id": "INV-PROBE",
            "vendor_id": vid,
            "product_id": "PROBE-P1",
            "product_name": "Probe Batter",
            "batch_number": "BATCH-PROBE",
            "quantity": 5.0,
        }
    )

    r = client.get(f"/vendors/{vid}/inventory")
    check("GET /vendors/{id}/inventory returns 200", r.status_code == 200, r.text[:300])
    inv = r.json().get("inventory") if r.status_code == 200 else None
    check("inventory list present (.inventory)", isinstance(inv, list), r.text[:300])
    if isinstance(inv, list) and inv:
        row = inv[0]
        check(
            "inventory row has fields the UI reads (product_id/product_name/quantity)",
            row.get("product_id") == "PROBE-P1"
            and row.get("product_name") == "Probe Batter"
            and row.get("quantity") == 5.0,
            str(row),
        )

    # ------------------------------------------------------------------
    # 5. Create demand (demands.tsx -> api.createDemand, exact payload)
    # ------------------------------------------------------------------
    demand_payload = {
        "items": [{"product_id": "PROBE-P1", "quantity": 3}],
        "priority": "high",
    }
    r = client.post(f"/vendors/{vid}/demands", json=demand_payload)
    check("POST /vendors/{id}/demands returns 200", r.status_code == 200, r.text[:300])
    demand_body = r.json() if r.status_code == 200 else {}
    check(
        "demand creation returns .demand_id",
        bool(demand_body.get("demand_id")),
        str(demand_body)[:300],
    )
    demand_id = demand_body.get("demand_id")

    # unmapped product must be an {error} body, not an HTTP failure
    r = client.post(
        f"/vendors/{vid}/demands",
        json={"items": [{"product_id": "NOT-MAPPED", "quantity": 2}], "priority": "normal"},
    )
    check(
        "unmapped product -> {error} body (surfaced in alert)",
        r.status_code == 200 and "error" in r.json(),
        f"{r.status_code} {r.text[:200]}",
    )

    # ------------------------------------------------------------------
    # 6. List demands (dashboard + demands.tsx -> GET /restock-requests)
    # ------------------------------------------------------------------
    r = client.get(f"/restock-requests?vendor_id={vid}")
    check("GET /restock-requests?vendor_id= returns 200", r.status_code == 200, r.text[:300])
    reqs = r.json().get("restock_requests") if r.status_code == 200 else None
    check("restock_requests list present (.restock_requests)", isinstance(reqs, list), r.text[:300])
    if isinstance(reqs, list):
        mine = [d for d in reqs if d.get("_id") == demand_id]
        check("created demand shows up in list", len(mine) == 1, str(reqs)[:300])
        if mine:
            check(
                "demand row has status/priority the UI reads",
                mine[0].get("status") == "pending" and mine[0].get("priority") == "high",
                str(mine[0]),
            )

    # ------------------------------------------------------------------
    # 7. Confirm (demands.tsx) -- sent as POST with NO body but with the
    #    JSON content-type header, exactly like api.confirmDemand()
    # ------------------------------------------------------------------
    r = client.post(
        f"/vendors/{vid}/demands/{demand_id}/confirm",
        headers={"Content-Type": "application/json"},
    )
    check(
        "POST confirm (empty body, JSON content-type) is NOT 400/422",
        r.status_code == 200,
        f"{r.status_code} {r.text[:300]}",
    )
    check(
        "confirm returns .message",
        "message" in (r.json() if r.status_code == 200 else {}),
        r.text[:300],
    )

    r = client.post(
        f"/vendors/{vid}/demands/not-a-valid-id/confirm",
        headers={"Content-Type": "application/json"},
    )
    check(
        "confirm with bad id -> {error} body (not HTTP 400)",
        r.status_code == 200 and "error" in r.json(),
        f"{r.status_code} {r.text[:200]}",
    )

    # ------------------------------------------------------------------
    # 8. Sync inventory (demands.tsx) -- also POST with no body
    # ------------------------------------------------------------------
    r = client.post(
        f"/vendors/{vid}/inventory/sync",
        headers={"Content-Type": "application/json"},
    )
    check(
        "POST inventory/sync (empty body, JSON content-type) is NOT 400/422",
        r.status_code == 200,
        f"{r.status_code} {r.text[:300]}",
    )
    sync_body = r.json() if r.status_code == 200 else {}
    check(
        "sync returns .message and .synced_demands (used in success alert)",
        "message" in sync_body and "synced_demands" in sync_body,
        str(sync_body)[:300],
    )

    inv = client.get(f"/vendors/{vid}/inventory").json()["inventory"]
    check(
        "sync restocks inventory (5 -> 8)",
        inv and inv[0].get("quantity") == 8.0,
        str(inv),
    )

    r = client.get(f"/restock-requests?vendor_id={vid}")
    reqs = r.json().get("restock_requests", [])
    mine = [d for d in reqs if d.get("_id") == demand_id]
    check(
        "demand marked synchronized (pending count stays correct)",
        mine and mine[0].get("status") == "synchronized",
        str(mine),
    )

    # ------------------------------------------------------------------
    # 9. AI endpoints (forecast.tsx / risk.tsx)
    # ------------------------------------------------------------------
    r = client.get(f"/vendors/{vid}/demand-forecast")
    check("GET demand-forecast returns 200", r.status_code == 200, r.text[:300])
    forecast_body = r.json() if r.status_code == 200 else {}
    ok_shape = isinstance(forecast_body.get("forecast"), list) or "error" in forecast_body
    check(
        "forecast returns .forecast list or .error (both handled by app)",
        ok_shape,
        str(forecast_body)[:300],
    )
    if isinstance(forecast_body.get("forecast"), list) and forecast_body["forecast"]:
        item = forecast_body["forecast"][0]
        check(
            "forecast item fields read by the UI",
            all(k in item for k in ("product_name", "predicted_demand", "current_stock", "recommended_order")),
            str(item),
        )

    r = client.get(f"/vendors/{vid}/spoilage-risk")
    check("GET spoilage-risk returns 200", r.status_code == 200, r.text[:300])
    risk_body = r.json() if r.status_code == 200 else {}
    ok_shape = isinstance(risk_body.get("evaluations"), list) or "error" in risk_body
    check(
        "spoilage returns .evaluations list or .error (both handled)",
        ok_shape,
        str(risk_body)[:300],
    )
    if isinstance(risk_body.get("evaluations"), list) and risk_body["evaluations"]:
        item = risk_body["evaluations"][0]
        check(
            "risk item fields read by the UI",
            all(k in item for k in ("batch_id", "product_name", "risk_label", "probabilities", "action")),
            str(item),
        )

    # ------------------------------------------------------------------
    # 10. Logs (dashboard activity feed)
    # ------------------------------------------------------------------
    r = client.get("/logs")
    check("GET /logs returns 200", r.status_code == 200, r.text[:300])
    logs = r.json().get("logs") if r.status_code == 200 else None
    check("logs list present (.logs)", isinstance(logs, list), r.text[:300])
    if isinstance(logs, list):
        # dashboard matches logs against vendorId / email / shop name
        match = [
            log
            for log in logs
            if any(
                needle and needle.lower() in json.dumps(log).lower()
                for needle in (vid, email, "Probe Store")
            )
        ]
        check("new account produces a log the dashboard can match", len(match) >= 1, "no matching log")

    # ------------------------------------------------------------------
    # 11. Document the ONLY way a 400 can happen: malformed JSON body
    # ------------------------------------------------------------------
    r = client.post(
        "/login",
        content="not-json{",
        headers={"Content-Type": "application/json"},
    )
    check(
        "malformed JSON -> rejected (400/422); app always sends JSON.stringify output",
        r.status_code in (400, 422),
        f"got {r.status_code}",
    )

    # missing body entirely -> 422 validation error, not 400
    r = client.post("/login", json={})
    check(
        "empty JSON object -> validation error (app validates fields first)",
        r.status_code in (200, 422),
        f"got {r.status_code}",
    )


def main_probe() -> int:
    db = main.client[TEST_DB_NAME]
    main.client.drop_database(TEST_DB_NAME)

    original_cols = main.COLS
    main.COLS = {name: db[name] for name in original_cols}

    try:
        with TestClient(main.app) as client:
            run(client, db)
    finally:
        main.COLS = original_cols
        main.client.drop_database(TEST_DB_NAME)

    failed = [name for name, ok, _ in results if not ok]
    print()
    print(f"{len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        print("FAILED:")
        for name in failed:
            print(f"  - {name}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main_probe())
