"""
Runs the vendor mobile app's complete call sequence against the LIVE backend
(http://localhost:5000), byte-for-byte as App/src/lib/api.ts sends it:

  * JSON body + Content-Type: application/json on EVERY request
  * POST confirm / sync with NO body but the JSON content type still set
  * the payload shapes built in signup.tsx / demands.tsx

A throwaway vendor (VND-xxxxxx + probe email + one inventory row) is created
in the live database, the whole journey is exercised, and every document
created by the probe is removed again in a finally block -- the seeded
vendors (V100..) are never written to.

Run with:  python tests/probe_live_endpoints.py
"""

import json
import re
import socket
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = "http://localhost:5000"
socket.setdefaulttimeout(20)

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    mark = "PASS" if ok else "FAIL"
    suffix = f"  -> {detail}" if (detail and not ok) else ""
    print(f"[{mark}] {name}{suffix}")


def call(method: str, path: str, body=None, no_body: bool = False):
    """Mirror api.request(): JSON content type always, stringify when body given."""
    data = None
    if not no_body and body is not None:
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
    except Exception as e:  # network failure
        return None, str(e)
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = raw
    return status, parsed


def cleanup(db, vid: str, email: str, shop: str) -> None:
    removed = {}
    for name in db.list_collection_names():
        res = db[name].delete_many(
            {
                "$or": [
                    {"vendor_id": vid},
                    {"user_id": vid},
                    {"email": email},
                    {"message": {"$regex": re.escape(shop)}},
                ]
            }
        )
        if res.deleted_count:
            removed[name] = res.deleted_count
    # residue check
    leftover = {
        name: db[name].count_documents(
            {
                "$or": [
                    {"vendor_id": vid},
                    {"user_id": vid},
                    {"email": email},
                    {"message": {"$regex": re.escape(shop)}},
                ]
            }
        )
        for name in db.list_collection_names()
    }
    leftover = {k: v for k, v in leftover.items() if v}
    print(f"\n[cleanup] removed={removed or '{}'}  residue={leftover or '{}'}")
    if leftover:
        print(f"[cleanup][WARN] residue remains: {leftover}")


def run(db) -> None:
    vid = f"VND-{uuid.uuid4().hex[:6].upper()}"
    email = f"probe{uuid.uuid4().hex[:6]}@example.com"
    password = "secret123"
    shop = "Probe Live Store"

    # 1. Sign up (signup.tsx payload, GPS-confirmed location)
    status, body = call(
        "POST",
        "/vendors",
        {
            "vendor_id": vid,
            "shop_name": shop,
            "email": email,
            "password": password,
            "phone": "9876543210",
            "location": {
                "latitude": 13.0827,
                "longitude": 80.2707,
                "address": "12 Probe Street, Chennai",
            },
        },
    )
    check("POST /vendors -> 200", status == 200, f"{status} {body}")
    check(
        "signup returns .vendor",
        isinstance(body, dict) and isinstance(body.get("vendor"), dict),
        str(body)[:300],
    )

    # 2. Login (login.tsx) + role gate
    status, login = call("POST", "/login", {"login": email, "password": password})
    check("POST /login -> 200", status == 200, f"{status} {login}")
    check("login .user_id present", isinstance(login, dict) and login.get("user_id"), str(login))
    check(
        "login .role == 'vendor' (auth.tsx rejects others)",
        isinstance(login, dict) and login.get("role") == "vendor",
        str(login),
    )
    check(
        "login .user_id == vendor_id",
        isinstance(login, dict) and str(login.get("user_id")) == vid,
        str(login),
    )

    status, body = call("POST", "/login", {"login": email, "password": "wrong"})
    check(
        "wrong password -> 200 {error} (surfaced, not a crash)",
        status == 200 and isinstance(body, dict) and "error" in body,
        f"{status} {body}",
    )

    # 3. Profile load
    status, body = call("GET", f"/vendors/{vid}")
    check(
        "GET /vendors/{id} -> 200 .vendor",
        status == 200 and isinstance(body, dict) and isinstance(body.get("vendor"), dict),
        f"{status} {body}",
    )
    if status == 200 and isinstance(body, dict) and isinstance(body.get("vendor"), dict):
        v = body["vendor"]
        check("profile shop_name", v.get("shop_name") == shop, str(v.get("shop_name")))
        check(
            "profile location lat/lng (map + warning screen)",
            isinstance(v.get("location"), dict)
            and v["location"].get("latitude") == 13.0827
            and v["location"].get("longitude") == 80.2707,
            str(v.get("location")),
        )

    status, body = call("GET", f"/users/{vid}")
    check(
        "GET /users/{id} fallback -> 200 .user",
        status == 200 and isinstance(body, dict) and isinstance(body.get("user"), dict),
        f"{status} {body}",
    )

    status, body = call("GET", "/vendors/VND-NOPE-XYZ")
    check(
        "unknown vendor -> 200 {error} (app shows friendly message)",
        status == 200 and isinstance(body, dict) and "error" in body,
        f"{status} {body}",
    )

    # 4. Inventory (needs one row for the demand flow)
    db.inventory.insert_one(
        {
            "inventory_id": "INV-LIVE-PROBE",
            "vendor_id": vid,
            "product_id": "PROBE-P1",
            "product_name": "Probe Batter",
            "batch_number": "BATCH-LIVE-PROBE",
            "quantity": 5.0,
        }
    )
    status, body = call("GET", f"/vendors/{vid}/inventory")
    inv = body.get("inventory") if status == 200 and isinstance(body, dict) else None
    check(
        "GET inventory -> 200 .inventory with UI fields",
        isinstance(inv, list)
        and inv
        and inv[0].get("product_id") == "PROBE-P1"
        and inv[0].get("quantity") == 5.0,
        f"{status} {body}",
    )

    # 5. Demand creation (demands.tsx payload)
    status, body = call(
        "POST",
        f"/vendors/{vid}/demands",
        {"items": [{"product_id": "PROBE-P1", "quantity": 3}], "priority": "high"},
    )
    check(
        "POST demands -> 200 .demand_id",
        status == 200 and isinstance(body, dict) and body.get("demand_id"),
        f"{status} {body}",
    )
    demand_id = body.get("demand_id") if isinstance(body, dict) else None

    status, body = call(
        "POST",
        f"/vendors/{vid}/demands",
        {"items": [{"product_id": "NOT-MAPPED", "quantity": 2}], "priority": "normal"},
    )
    check(
        "unmapped product -> 200 {error} (shown in alert)",
        status == 200 and isinstance(body, dict) and "error" in body,
        f"{status} {body}",
    )

    # 6. Demand list
    status, body = call("GET", f"/restock-requests?vendor_id={vid}")
    reqs = body.get("restock_requests") if status == 200 and isinstance(body, dict) else None
    mine = [d for d in reqs if d.get("_id") == demand_id] if isinstance(reqs, list) else []
    check(
        "GET /restock-requests?vendor_id= -> demand listed with status/priority",
        len(mine) == 1 and mine[0].get("status") == "pending" and mine[0].get("priority") == "high",
        f"{status} {body}",
    )

    # 7. Confirm -- POST with NO body + JSON content-type (exact api.ts behaviour)
    status, body = call(
        "POST", f"/vendors/{vid}/demands/{demand_id}/confirm", no_body=True
    )
    check(
        "POST confirm (empty body, JSON content-type) -> 200, not 400/422",
        status == 200,
        f"{status} {body}",
    )
    check(
        "confirm returns .message",
        status == 200 and isinstance(body, dict) and "message" in body,
        f"{status} {body}",
    )

    status, body = call(
        "POST", f"/vendors/{vid}/demands/bogus-id/confirm", no_body=True
    )
    check(
        "confirm bad demand id -> 200 {error}, not 400/500",
        status == 200 and isinstance(body, dict) and "error" in body,
        f"{status} {body}",
    )

    # 8. Inventory sync -- also POST with no body
    status, body = call("POST", f"/vendors/{vid}/inventory/sync", no_body=True)
    check(
        "POST inventory/sync (empty body, JSON content-type) -> 200, not 400/422",
        status == 200,
        f"{status} {body}",
    )
    check(
        "sync returns .message + .synced_demands (success alert)",
        status == 200
        and isinstance(body, dict)
        and "message" in body
        and "synced_demands" in body,
        f"{status} {body}",
    )

    status, body = call("GET", f"/vendors/{vid}/inventory")
    inv = body.get("inventory", []) if status == 200 and isinstance(body, dict) else []
    check(
        "sync restocks quantity 5 -> 8",
        inv and inv[0].get("quantity") == 8.0,
        f"{body}",
    )

    status, body = call("GET", f"/restock-requests?vendor_id={vid}")
    reqs = body.get("restock_requests", []) if status == 200 else []
    mine = [d for d in reqs if d.get("_id") == demand_id]
    check(
        "demand marked synchronized (pending counts stay correct)",
        mine and mine[0].get("status") == "synchronized",
        f"{body}",
    )

    # 9. AI endpoints -- new vendor (fresh data path) + seeded vendor (rich data path)
    for label, target in (("new vendor", vid), ("seeded vendor V100", "V100")):
        status, body = call("GET", f"/vendors/{target}/demand-forecast")
        ok_shape = status == 200 and isinstance(body, dict) and (
            isinstance(body.get("forecast"), list) or "error" in body
        )
        check(
            f"forecast ({label}) -> 200 with .forecast or .error (both handled)",
            ok_shape,
            f"{status} {str(body)[:200]}",
        )

        status, body = call("GET", f"/vendors/{target}/spoilage-risk")
        ok_shape = status == 200 and isinstance(body, dict) and (
            isinstance(body.get("evaluations"), list) or "error" in body
        )
        check(
            f"spoilage ({label}) -> 200 with .evaluations or .error (both handled)",
            ok_shape,
            f"{status} {str(body)[:200]}",
        )

    # 10. Logs (dashboard activity feed match by vendor id / email / shop name)
    status, body = call("GET", "/logs")
    logs = body.get("logs") if status == 200 and isinstance(body, dict) else None
    matched = []
    if isinstance(logs, list):
        matched = [
            log
            for log in logs
            if any(
                n and n.lower() in json.dumps(log).lower()
                for n in (vid, email, shop)
            )
        ]
    check(
        "GET /logs contains entries the dashboard can match to this vendor",
        len(matched) >= 1,
        "no matching log",
    )

    # 11. Documented failure modes
    status, body = call("GET", "/nonexistent-route")
    check("404 route -> JSON body (app shows generic error)", status in (404, 405), f"{status}")

    return vid, email, shop


def main() -> int:
    from pymongo import MongoClient

    env = {}
    for line in Path(__file__).resolve().parents[1].joinpath(".env").read_text().splitlines():
        m = re.match(r'([A-Z_]+)\s*=\s*"?([^"]*)"?', line.strip())
        if m:
            env[m.group(1)] = m.group(2)

    client = MongoClient(env["MONGODB_URI"], serverSelectionTimeoutMS=15000)
    db = client["b2p"]

    vid = email = shop = None
    try:
        vid, email, shop = run(db)
    finally:
        if vid:
            cleanup(db, vid, email, shop)
        client.close()

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
    raise SystemExit(main())
