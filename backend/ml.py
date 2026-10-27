"""ML side of the backend: demand forecast and spoilage risk models, their
feature helpers and routes. Routes register on main's app when main imports this."""
import math
import statistics
import datetime
import warnings
from typing import Optional
from fastapi import Path
import joblib
import numpy as np
import pandas as pd

from main import (
    app, BASE_DIR, COLS, _field, _product_key, _batch_remaining, _batch_volume,
    _batch_threshold, _hours_since, _held_batches, _find_vendor, _vendor_id_values,
)

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


def _model_label(product):
    """Demand-model class ("Idly_Batter", ...) for a product name/id, or None."""
    key = _product_key(product)
    for label in demand_bundle["product_encoder"].classes_:
        if _product_key(label) == key:
            return label
    return None


def _latest_weather():
    return COLS["weather_forecast"].find_one(sort=[("forecastFor", -1)]) or {}


def _active_festival_type():
    """festivalType of a festival whose window covers today, else "none"."""
    today = datetime.datetime.utcnow()
    for festival in COLS["festival_calendar"].find({
        "date": {"$lte": today, "$gte": today - datetime.timedelta(days=31)}
    }):
        days = int(_field(festival, "windowDays", "window_days", default=1))
        if festival["date"] + datetime.timedelta(days=days) > today:
            return _field(festival, "festivalType", "festival_type", default="none")
    return "none"


def _encode(encoder, value, default=0):
    try:
        return int(encoder.transform([value])[0])
    except Exception:
        return default


# The model only knows two sales windows: training rows are hour 8 or hour 18.
SLOT_HOURS = (8, 18)

def _slot_of(moment):
    """(local date, 0 = morning / 1 = evening) for a naive UTC timestamp."""
    local = moment.replace(tzinfo=datetime.timezone.utc).astimezone()
    return local.date(), 0 if local.hour < 13 else 1

def _slot_bounds(slot):
    """(start, end) of a slot as naive UTC: morning is local 00:00-13:00, evening 13:00-24:00."""
    day, window = slot
    local = lambda hour: datetime.datetime.combine(day, datetime.time()) + datetime.timedelta(hours=hour)
    to_utc = lambda moment: moment.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    start, end = (0, 13) if window == 0 else (13, 24)
    return to_utc(local(start)), to_utc(local(end))

def _demand_shared_context():
    """Model features that are the same for every vendor right now:
    time-of-day/week cyclic encodings, weekend + festival flags, latest weather."""
    day, window = _slot_of(datetime.datetime.utcnow())
    hour = SLOT_HOURS[window]
    weekday = day.weekday()

    weather = _latest_weather()
    festival_type = _active_festival_type()

    return {
        "hourSin": math.sin(2 * math.pi * hour / 24),
        "hourCos": math.cos(2 * math.pi * hour / 24),
        "weekdaySin": math.sin(2 * math.pi * weekday / 7),
        "weekdayCos": math.cos(2 * math.pi * weekday / 7),
        "isWeekend": 1 if weekday >= 5 else 0,
        "isFestivalWindow": 0 if festival_type == "none" else 1,
        "festivalTypeEnc": _encode(demand_bundle["festival_encoder"], festival_type, 1),
        "forecastTemperatureC": float(_field(weather, "temperatureC", "temperature_c", default=30.0)),
        "forecastRainProbability": float(_field(weather, "rainProbability", "rain_probability", default=0.1)),
    }


HISTORY_FEATURES = ["lag1", "lag7", "sameSlot4WeekMean", "rolling7DayMean", "rolling7DayStd", "recentTrend"]
# Vendors store "commercial"; the model was trained on "commercial_offices".
LOCALITY_ALIASES = {"commercial": "commercial_offices"}

LOCALITY_TIERS = ["commercial_offices", "institutional", "mixed", "residential_budget", "residential_premium"]


def _locality_tier(value):
    """A known locality tier for ``value`` (aliases allowed), else None."""
    tier = LOCALITY_ALIASES.get(value, value)
    return tier if tier in LOCALITY_TIERS else None


def _history_features(series):
    """History inputs from per-slot sales (oldest first, ending at the previous slot),
    computed exactly as the training CSV defines them (2 slots per day)."""
    s = list(series) or [0.0]
    last7, last28 = s[-14:], s[-56:]
    mean7 = sum(last7) / len(last7)
    mean28 = sum(last28) / len(last28)
    # Same window on each of the last 4 days: what the CSV's "sameSlot4WeekMean" holds.
    same_slot = s[-2::-2][:4]
    return {
        "lag1": s[-1],
        "lag7": s[-14] if len(s) >= 14 else 0.0,
        "sameSlot4WeekMean": sum(same_slot) / len(same_slot) if same_slot else 0.0,
        "rolling7DayMean": mean7,
        "rolling7DayStd": statistics.stdev(last7) if len(last7) > 1 else 0.0,
        "recentTrend": mean7 / mean28 if mean28 else 1.0,
    }


def _sales_series(vendor, current_slot):
    """Per model product: kg sold per slot, from the vendor's first recorded sale
    (last 28 days) up to the slot before ``current_slot``. Empty slots count as 0."""
    since = datetime.datetime.utcnow() - datetime.timedelta(days=29)
    names = {p.get("product_id"): p.get("product_name") for p in COLS["products"].find({}, {"product_id": 1, "product_name": 1})}
    per_slot = {}
    for move in COLS["inventory_movement"].find({
        "vendorId": {"$in": _vendor_id_values(vendor)},
        "movementType": "sale",
        "occurredAt": {"$gte": since},
    }):
        label = _model_label(names.get(move.get("productId"), move.get("productId")))
        if not label or not isinstance(move.get("occurredAt"), datetime.datetime):
            continue
        slot = _slot_of(move["occurredAt"])
        if slot < current_slot:
            slots = per_slot.setdefault(label, {})
            slots[slot] = slots.get(slot, 0.0) + float(move.get("quantity") or 0)

    series = {}
    for label, slots in per_slot.items():
        day, window = min(slots)
        values = []
        while (day, window) < current_slot:
            values.append(slots.get((day, window), 0.0))
            day, window = (day, 1) if window == 0 else (day + datetime.timedelta(days=1), 0)
        series[label] = values
    return series


def _load_baseline_history():
    """Typical history inputs per (product, window, locality) from the training data.

    A shop with no sales yet is forecast from these instead of all-zero history,
    which the model never saw in training (it then predicts ~11 kg for every product).
    """
    path = BASE_DIR / "model_code_and_data" / "b2p_demand_forecasting_data.csv"
    if not path.exists():
        return {}
    df = pd.read_csv(path)
    baseline = {}
    for keys in (["productId", "window_order"], ["productId", "window_order", "localityTier"]):
        for key, row in df.groupby(keys)[HISTORY_FEATURES].median().iterrows():
            baseline[key] = {name: float(row[name]) for name in HISTORY_FEATURES}
    return baseline


BASELINE_HISTORY = _load_baseline_history()


def _batch_chip(batch):
    return {
        "batch_id": batch.get("batch_id"),
        "remaining_kg": round(_batch_remaining(batch), 2),
        "status": batch.get("status"),
        "received_at": _field(batch, "received_at", "assigned_at", "created_at"),
        "expired": batch.get("expired", False),
    }


def _suggest_batches(batches, needed_kg):
    """Freshest available batches that together cover ``needed_kg`` (greedy)."""
    picked, covered = [], 0.0
    for hours_left, batch in sorted(batches, key=lambda pair: -pair[0]):
        if covered >= needed_kg:
            break
        picked.append({**_batch_chip(batch), "hours_to_expiry": round(hours_left, 1)})
        covered += _batch_remaining(batch)
    return picked, round(covered, 1)


def _vendor_forecast(vendor, ctx):
    """Forecast every catalog product for this shop's current sales window.

    stock      = unexpired kg in batches the shop holds (assigned or received)
    requested  = kg in the shop's pending batch requests
    refill     = demand + safety stock - stock - requested (never below 0)
    """
    held, unsupported = {}, set()
    for batch in _held_batches(vendor):
        label = _model_label(_field(batch, "product_name", "product_id"))
        if label:
            held.setdefault(label, []).append(batch)
        else:
            unsupported.add(_field(batch, "product_name", "product_id"))

    # Every sellable product gets a forecast, held or not (a new shop still has demand).
    names = {}
    for product in COLS["products"].find():
        label = _model_label(product.get("product_name"))
        if label and label not in names:
            names[label] = product.get("product_name")

    requested = {}
    pending = list(COLS["restock_requests"].find({"vendor_id": {"$in": _vendor_id_values(vendor)}, "status": "pending"}))
    pending_batch_ids = {item.get("batch_id") for r in pending for item in r.get("items", []) if item.get("batch_id")}
    for r in pending:
        for item in r.get("items", []):
            label = _model_label(_field(item, "product_name", "product_id"))
            if label and item.get("batch_id"):
                requested[label] = requested.get(label, 0.0) + float(item.get("quantity") or 0)

    available = {}
    for batch in COLS["batches"].find({"status": "available", "exposed": {"$ne": False}}):
        label = _model_label(_field(batch, "product_name", "product_id"))
        hours_left = _hours_to_expiry(vendor, batch)
        if label and hours_left > 0 and _batch_remaining(batch) > 0 and batch.get("batch_id") not in pending_batch_ids:
            available.setdefault(label, []).append((hours_left, batch))

    # Latest DEMAND feature snapshot per product. The ML pipeline writes these in
    # camelCase with the inputs nested under featureVector.
    history = {}
    for snap in COLS["feature_snapshots"].find({
        "vendorId": {"$in": _vendor_id_values(vendor)},
        "predictionType": "DEMAND",
    }).sort("windowEnd", -1):
        label = _model_label(snap.get("productId"))
        if label and label not in history:
            history[label] = snap.get("featureVector") or {}

    locality = _field(vendor, "localityTier", "locality_tier", default="mixed")
    locality = _locality_tier(locality) or "mixed"
    vendor_features = {
        "localityTierEnc": _encode(demand_bundle["locality_encoder"], locality,
                                   _encode(demand_bundle["locality_encoder"], "mixed")),
        # shortcut: mid-range of training data (3-33) when a vendor has no score
        "hotspotDensityScore": float(_field(vendor, "hotspotDensityScore", "hotspot_density_score", default=18)),
    }

    slot = _slot_of(datetime.datetime.utcnow())
    sales = _sales_series(vendor, slot)
    window_start, window_end = _slot_bounds(slot)

    forecasts = []
    for label in sorted(set(names) | set(held)):
        batches = held.get(label, [])
        series, snapshot = sales.get(label), history.get(label)
        # shortcut: under a week of real sales, the snapshot or the baseline wins; blend them once shops have data.
        if series and len(series) >= 14:
            source, past = "sales", _history_features(series)
        elif snapshot is not None:
            source, past = "snapshot", {name: float(snapshot.get(name, 0.0)) for name in HISTORY_FEATURES}
        else:
            source = "baseline"
            past = BASELINE_HISTORY.get((label, slot[1], locality)) or BASELINE_HISTORY.get((label, slot[1])) \
                or {name: 0.0 for name in HISTORY_FEATURES}
        row = {
            **ctx,
            **vendor_features,
            **past,
            "productIdEnc": _encode(demand_bundle["product_encoder"], label),
        }
        df_input = pd.DataFrame([row])[demand_bundle["features"]]
        demand = round(float(np.clip(demand_bundle["model"].predict(df_input)[0], 0, None)), 1)
        safety = round(float(demand_bundle["safety_stock"].get(label, 0.0)), 1)
        recommended = round(demand + safety, 1)
        # Expired stock cannot be sold, so it does not cover demand.
        stock = round(sum(_batch_remaining(b) for b in batches if _hours_to_expiry(vendor, b) > 0), 1)
        incoming = round(requested.get(label, 0.0), 1)
        refill = round(max(0.0, recommended - stock - incoming), 1)
        suggested, suggested_kg = _suggest_batches(available.get(label, []), refill) if refill > 0 else ([], 0.0)

        # One record per vendor/product/window (same shape as the ML pipeline's
        # rows), so forecasts can later be scored against that window's sales.
        COLS["predictions"].update_one(
            {"predictionType": "DEMAND", "vendorId": vendor.get("vendor_id"), "productId": label,
             "windowStart": window_start},
            {"$set": {"windowEnd": window_end, "numericValue": demand, "predictedValue": demand,
                      "recommendedDispatch": refill, "inputFeatures": row, "modelVersion": "v1.0",
                      "historySource": source, "generatedAt": datetime.datetime.utcnow()}},
            upsert=True,
        )

        if refill > 0:
            status = "Restock Needed"
        elif incoming > 0 and stock < recommended:
            status = "Covered by pending request"
        else:
            status = "Stock OK"
        forecasts.append({
            "product_name": names.get(label) or _field(batches[0], "product_name", default=label),
            "model_product": label,
            "predicted_demand": demand,
            "safety_stock": safety,
            "recommended_stock": recommended,
            "current_stock": stock,
            "requested_kg": incoming,
            "deficit": round(max(0.0, demand - stock), 1),
            "refill_quantity": refill,
            "restock_needed": refill > 0,
            "status": status,
            "history_source": source,
            "has_sales_history": source != "baseline",
            "batches": [_batch_chip(b) for b in batches],
            "suggested_batches": suggested,
            "suggested_kg": suggested_kg,
            "uncovered_kg": round(max(0.0, refill - suggested_kg), 1),
        })

    return forecasts, sorted(unsupported)


def _forecast_response(vendor, ctx):
    """Wrap vendor forecasts in the standard response envelope."""
    forecasts, unsupported = _vendor_forecast(vendor, ctx)
    day, window = _slot_of(datetime.datetime.utcnow())
    total = lambda key: round(sum(item[key] for item in forecasts), 1)
    response = {
        "vendor_id": vendor.get("vendor_id"),
        # Demand is per sales window: morning (before 1 pm) or evening.
        "window": {"date": day.isoformat(), "label": ("morning", "evening")[window]},
        "count": len(forecasts),
        "summary": {
            "predicted_demand": total("predicted_demand"),
            "recommended_stock": total("recommended_stock"),
            "current_stock": total("current_stock"),
            "requested_kg": total("requested_kg"),
            "refill_quantity": total("refill_quantity"),
            "products_to_restock": sum(1 for item in forecasts if item["restock_needed"]),
        },
        "forecast": forecasts,
        "unsupported_products": unsupported,
    }
    if unsupported:
        response["message"] = f"The demand model has no data for: {', '.join(unsupported)}"
    elif forecasts and all(item["history_source"] == "baseline" for item in forecasts):
        response["message"] = "No sales recorded yet: these are baseline estimates for a shop like yours, and they adjust as sales come in."
    return response


@app.get("/vendors/{vendor_id}/demand-forecast")
def get_demand_forecast(vendor_id: str = Path(...)):
    if not demand_bundle:
        return {"error": "Demand model not loaded"}
    vendor = _find_vendor(vendor_id)
    if not vendor:
        return {"error": "Vendor not found"}
    return _forecast_response(vendor, _demand_shared_context())


@app.get("/demand-forecast")
def get_all_demand_forecasts(vendor_id: Optional[str] = None):
    if not demand_bundle:
        return {"error": "Demand model not loaded"}

    ctx = _demand_shared_context()
    if vendor_id:
        vendor = _find_vendor(vendor_id)
        if not vendor:
            return {"error": "Vendor not found"}
        return _forecast_response(vendor, ctx)

    results = []
    for vendor in COLS["vendors"].find({"vendor_id": {"$exists": True}}):
        for row in _vendor_forecast(vendor, ctx)[0]:
            results.append({"vendor_id": vendor["vendor_id"], **row})
    return {"count": len(results), "forecast": results}


def risk_label_for(score):
    """<=30 Low, 30-70 Medium, >70 High (score is 0-100)."""
    if score <= 30:
        return "Low"
    return "Medium" if score <= 70 else "High"


RISK_ACTIONS = {
    "High": "Urgent: sell first or return",
    "Medium": "Monitor temperature closely",
    "Low": "Normal shelf rotation",
}
STORAGE_ALIASES = {"refrigerated": "fridge"}


def _shelf_life_hours(batch, has_fridge):
    """Product shelf life for the vendor's storage: fridge vs room temperature."""
    keys = ("shelf_life_fridge_hrs", "shelf_life_hours") if has_fridge else ("shelf_life_ambient_hrs",)
    name = _product_key(_field(batch, "product_name", "product_id"))
    for product in COLS["products"].find():
        same = product.get("product_id") == batch.get("product_id") or _product_key(product.get("product_name")) == name
        if same and _field(product, *keys) is not None:
            return float(_field(product, *keys))
    # shortcut: catalog has no shelf life for this product; typical idli batter values
    return 72.0 if has_fridge else 24.0


def _has_fridge(vendor):
    return 1 if _field(vendor, "hasRefrigerator", "has_refrigerator", default=True) else 0


def _hours_to_expiry(vendor, batch):
    """Shelf life left in hours; zero or below means the batch has expired."""
    elapsed = _hours_since(batch.get("created_at")) or 0.0
    expires = batch.get("expires_at")
    if isinstance(expires, datetime.datetime):  # older batches carry a fixed expiry
        return (expires - datetime.datetime.utcnow()).total_seconds() / 3600
    if _field(batch, "hours_to_expiry", "hoursToExpiry") is not None:
        return float(_field(batch, "hours_to_expiry", "hoursToExpiry")) - elapsed
    manufactured = _field(batch, "manufactured_at", "mfgTimestamp")
    hours_mfg = _hours_since(manufactured) if manufactured else \
        float(_field(batch, "hours_since_manufacture", "hoursSinceManufacture", default=0)) + elapsed
    return _shelf_life_hours(batch, _has_fridge(vendor)) - hours_mfg


def _spoilage_features(vendor, batch, weather):
    """Model inputs for one batch, computed the way the training data defined them."""
    has_fridge = _has_fridge(vendor)
    storage = _field(vendor, "storageType", "storage_type", default="")
    storage = STORAGE_ALIASES.get(storage, storage)
    if storage not in spoilage_bundle["storage_encoder"].classes_:
        storage = "fridge" if has_fridge else "counter"

    ambient = float(_field(batch, "ambient_temperature_c", "ambientTemperatureC",
                           default=_field(weather, "temperatureC", "temperature_c", default=30.0)))
    # Training data uses -1 as the fridge temperature of shops without a fridge.
    fridge = float(_field(batch, "fridge_temperature_c", "fridgeTemperatureC",
                          default=_field(vendor, "fridgeTemperatureC", "fridge_temperature_c", default=4.0))) if has_fridge else -1.0

    # Stored hour counts were true when the record was written; age them since.
    elapsed = _hours_since(batch.get("created_at")) or 0.0
    manufactured = _field(batch, "manufactured_at", "mfgTimestamp")
    hours_mfg = _hours_since(manufactured) if manufactured else \
        float(_field(batch, "hours_since_manufacture", "hoursSinceManufacture", default=0)) + elapsed
    received = batch.get("received_at")
    hours_shelf = _hours_since(received) if received else \
        float(_field(batch, "hours_on_shelf", "hoursOnShelf", default=0))
    hours_expiry = _hours_to_expiry(vendor, batch)

    volume = _batch_volume(batch)
    sell_through = _field(batch, "sell_through_rate", "sellThroughRate")
    if sell_through is None:
        sell_through = 1 - _batch_remaining(batch) / volume if volume else 0.0

    return {
        "initialPH": float(_field(batch, "initial_ph", "initialPH", default=4.5)),
        "hoursSinceManufacture": hours_mfg,
        "hasRefrigerator": has_fridge,
        "storageTypeEnc": _encode(spoilage_bundle["storage_encoder"], storage),
        "ambientTemperatureC": ambient,
        "humidityPct": float(_field(batch, "humidity_pct", "humidityPct",
                                    default=_field(weather, "humidityPct", default=65.0))),
        "fridgeTemperatureC": fridge,
        "hoursOnShelf": hours_shelf,
        "sellThroughRate": float(sell_through),
        "effectiveTemperatureExposure": (fridge if has_fridge else ambient) * hours_mfg,
        "hoursToExpiry": max(0.0, hours_expiry),
        "volumeKg": volume,
        "vendorRating": float(_field(vendor, "rating", "vendor_rating", "vendorRating", default=4.0)),
    }


def _batch_evaluation(vendor, batch, weather):
    """Stock state of a held batch plus its model spoilage risk (0-100)."""
    remaining = _batch_remaining(batch)
    threshold = _batch_threshold(batch)
    hours_left = _hours_to_expiry(vendor, batch)
    row = {
        "batch_id": batch.get("batch_id"),
        "product_name": _field(batch, "product_name", "product_id", default="Batter"),
        "status": batch.get("status"),
        "volume_kg": _batch_volume(batch),
        "remaining_kg": round(remaining, 2),
        "threshold_kg": threshold,
        "low_stock": remaining <= threshold,
        "received_at": batch.get("received_at"),
        "assigned_at": batch.get("assigned_at"),
        "expires_at": batch.get("expires_at"),
        "hours_to_expiry": round(max(0.0, hours_left), 1),
        "expired": hours_left <= 0,
    }
    if not spoilage_bundle:
        return row

    df_input = pd.DataFrame([_spoilage_features(vendor, batch, weather)])[spoilage_bundle["features"]]
    probas = spoilage_bundle["model"].predict_proba(df_input)[0]
    classes = spoilage_bundle["label_encoder"].inverse_transform(spoilage_bundle["model"].classes_)
    prob = {str(c): float(p) for c, p in zip(classes, probas)}
    score = round(prob.get("High", 0) * 100 + prob.get("Medium", 0) * 50, 1)
    label = risk_label_for(score)
    return {
        **row,
        "risk_score": score,
        "risk_label": label,
        "probabilities": {k: round(v, 3) for k, v in prob.items()},
        "action": RISK_ACTIONS[label],
    }


@app.get("/vendors/{vendor_id}/batches")
def get_vendor_batches(vendor_id: str = Path(...)):
    vendor = _find_vendor(vendor_id)
    if not vendor:
        return {"error": "Vendor not found"}
    weather = _latest_weather()
    batches = [_batch_evaluation(vendor, b, weather) for b in _held_batches(vendor)]
    batches.sort(key=lambda b: b["remaining_kg"] - b["threshold_kg"])
    return {
        "vendor_id": vendor.get("vendor_id"),
        "count": len(batches),
        "low_stock_count": sum(1 for b in batches if b["low_stock"]),
        "batches": batches,
    }


@app.get("/vendors/{vendor_id}/spoilage-risk")
def get_vendor_spoilage_risk(vendor_id: str = Path(...)):
    if not spoilage_bundle:
        return {"error": "Spoilage model not loaded"}
    vendor = _find_vendor(vendor_id)
    if not vendor:
        return {"error": "Vendor not found"}

    weather = _latest_weather()
    evaluations = [_batch_evaluation(vendor, b, weather) for b in _held_batches(vendor)]
    if not evaluations:
        return {
            "vendor_id": vendor.get("vendor_id"),
            "count": 0,
            "message": "No batches assigned to this vendor",
            "aggregate_risk_score": None,
            "aggregate_risk_label": None,
            "summary": {"high": 0, "medium": 0, "low": 0},
            "evaluations": [],
        }

    evaluations.sort(key=lambda e: -e["risk_score"])
    # Volume-weighted: a nearly empty risky batch matters less than a full one.
    total_kg = sum(e["remaining_kg"] for e in evaluations)
    aggregate = round(sum(e["risk_score"] * e["remaining_kg"] for e in evaluations) / total_kg, 1)
    return {
        "vendor_id": vendor.get("vendor_id"),
        "count": len(evaluations),
        "aggregate_risk_score": aggregate,
        "aggregate_risk_label": risk_label_for(aggregate),
        "summary": {
            level.lower(): sum(1 for e in evaluations if e["risk_label"] == level)
            for level in ("High", "Medium", "Low")
        },
        "evaluations": evaluations,
    }
