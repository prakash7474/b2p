"""Add or remove fake (demo) batches assigned to a few vendors, for testing the app.

    python tools/demo_batches.py            # dry run: show what would be added
    python tools/demo_batches.py --apply    # add them
    python tools/demo_batches.py --remove   # delete every demo batch again

Batches look exactly like ones the admin assigned through the app (same fields),
and each vendor's inventory total is adjusted the same way assignment does.
Every demo batch has batch_id "DEMO-..." and demo=True, so removal is exact.
"""
import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend.main as main  # noqa: E402  (connects with MONGODB_URI from .env)

# (product_id, product_name, kg, kg already sold, hours since made: (with fridge, without), status)
PLAN = [
    ("P001", "Idli Batter", 15.0, 0.0, (3, 3), "received"),     # fresh
    ("P002", "Dosa Batter", 10.0, 4.0, (20, 6), "received"),    # partly sold
    ("P003", "Combo Pack", 6.0, 0.0, (40, 12), "received"),     # older: higher spoilage risk
    ("P001", "Idli Batter", 12.0, 0.0, (1, 1), "assigned"),     # waiting for the shop to confirm
]
VENDORS = ["V100", "V101", "V102", "V103", "VND-6KRVI1"]


def add(apply):
    now = datetime.datetime.utcnow()
    for vendor_id in VENDORS:
        vendor = main._find_vendor(vendor_id)
        if not vendor:
            print(f"skip {vendor_id}: not found")
            continue
        fridge = bool(main._field(vendor, "hasRefrigerator", "has_refrigerator", default=True))
        for i, (pid, name, kg, sold, ages, status) in enumerate(PLAN, 1):
            made = now - datetime.timedelta(hours=ages[0] if fridge else ages[1])
            batch = {
                "batch_id": f"DEMO-{vendor_id}-{pid}-{i}",
                "vendor_id": vendor_id, "product_id": pid, "product_name": name,
                "quantity": kg, "volume_kg": kg, "remaining_volume_kg": kg - sold,
                "threshold_kg": round(0.2 * kg, 2), "manufactured_at": made,
                "exposed": True, "initial_ph": 4.5, "status": status,
                "created_at": made, "assigned_at": made + datetime.timedelta(minutes=30),
                "assignment_log": [{"vendor_id": vendor_id, "assigned_by": "Admin",
                                    "assigned_at": made + datetime.timedelta(minutes=30)}],
                "updated_at": now, "demo": True,
            }
            if sold:
                batch["sell_through_rate"] = round(sold / kg, 3)
            if status == "received":
                batch["received_at"] = made + datetime.timedelta(hours=1)
            if main.COLS["batches"].find_one({"batch_id": batch["batch_id"]}):
                print(f"exists  {batch['batch_id']}")
                continue
            print(f"{'add' if apply else 'would add'} {batch['batch_id']:28s} {status:8s} "
                  f"{kg - sold:5.1f} kg, made {(now - made).total_seconds() / 3600:.0f} h ago "
                  f"({'fridge' if fridge else 'no fridge'})")
            if apply:
                main.COLS["batches"].insert_one(batch)
                # Assignment adds the batch's kg to the shop's inventory row.
                main._adjust_inventory(vendor_id, batch, batch["remaining_volume_kg"])


def remove():
    for batch in main.COLS["batches"].find({"demo": True, "batch_id": {"$regex": "^DEMO-"}}):
        # Take back whatever kg is still counted in inventory (expired kg was already removed).
        if batch.get("status") in main.HELD_STATUSES and not batch.get("expired_at"):
            main._adjust_inventory(batch["vendor_id"], batch, -main._batch_remaining(batch))
        main.COLS["batches"].delete_one({"_id": batch["_id"]})
        print(f"removed {batch['batch_id']}")


if __name__ == "__main__":
    if "--remove" in sys.argv:
        remove()
    else:
        add("--apply" in sys.argv)
        if "--apply" not in sys.argv:
            print("\nDry run only. Re-run with --apply to add.")
