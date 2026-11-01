"""ML side of the backend: demand forecast and spoilage risk models, their
feature helpers and routes. Routes register on common's app when main imports this."""
import os
import math
import statistics
import datetime
import warnings
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from zoneinfo import ZoneInfo
from fastapi import Body, Depends, HTTPException, Path
import httpx
import joblib
import numpy as np
import pandas as pd

if __package__:
    from .common import (app, BASE_DIR, COLS, _field, _product_key, _batch_remaining, _batch_volume,
                         _batch_threshold, _hours_since, _held_batches, _find_vendor, _vendor_id_values,
                         current_user, require_role, require_vendor, LOCALITY_TIERS, _locality_tier,
                         _has_fridge, _hours_to_expiry, _vendor_status)
else:
    from common import (app, BASE_DIR, COLS, _field, _product_key, _batch_remaining, _batch_volume,
                        _batch_threshold, _hours_since, _held_batches, _find_vendor, _vendor_id_values,
                        current_user, require_role, require_vendor, LOCALITY_TIERS, _locality_tier,
                        _has_fridge, _hours_to_expiry, _vendor_status)

# Shops run on India time; the server's own clock zone must not move the sales windows.
SHOP_TZ = ZoneInfo("Asia/Kolkata")

# ------------------------------------------------------------
# Machine Learning Models (Demand Forecast & Spoilage Risk)
# ------------------------------------------------------------
MODELS_DIR = BASE_DIR / "models"
warnings.filterwarnings("ignore")


def load_model_bundle(fname):
    """The trained model bundle saved by model_code_and_data/train_*.py, or None if it will not load."""
    model_path = MODELS_DIR / fname
    try:
        bundle = joblib.load(model_path)
        print(f"[INFO] Loaded model: {fname}")
        return bundle
    except Exception as e:
        print(f"[WARN] Failed to load {model_path}: {e}")
        return None


demand_bundle = load_model_bundle("demand_forecast_model.pkl")
spoilage_bundle = load_model_bundle("spoilage_risk_model.pkl")


def _model_label(product):
    """Demand-model class ("Idly_Batter", ...) for a product name/id, or None."""
    key = _product_key(product)
    for label in demand_bundle["product_encoder"].classes_:
        if _product_key(label) == key:
            return label
    return None


WEATHER_MAX_AGE = datetime.timedelta(hours=1)
_weather_tried_at = None


def _refresh_weather():
    """Store this hour's Open-Meteo forecast (free, no API key) for the shop area."""
    hour = datetime.datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    response = httpx.get("https://api.open-meteo.com/v1/forecast", timeout=5, params={
        # Default: Chennai. One reading serves every vendor, like the seeded data did.
        "latitude": float(os.getenv("WEATHER_LAT", "13.08")),
        "longitude": float(os.getenv("WEATHER_LON", "80.27")),
        "hourly": "temperature_2m,relative_humidity_2m,precipitation_probability",
        "timezone": "UTC",
        "forecast_days": 1,
    })
    response.raise_for_status()
    hourly = response.json()["hourly"]
    i = hourly["time"].index(hour.strftime("%Y-%m-%dT%H:%M"))
    doc = {
        "forecastFor": hour,
        "temperatureC": float(hourly["temperature_2m"][i]),
        "humidityPct": float(hourly["relative_humidity_2m"][i]),
        # Training data stores rain probability as 0-1; Open-Meteo sends 0-100.
        "rainProbability": float(hourly["precipitation_probability"][i] or 0) / 100,
        "source": "open-meteo",
        "locationGridKey": os.getenv("WEATHER_GRID_KEY", "chennai_central"),
        "forecastIssuedAt": datetime.datetime.utcnow(),
    }
    COLS["weather_forecast"].update_one(
        {"forecastFor": hour, "source": "open-meteo", "locationGridKey": doc["locationGridKey"]},
        {"$set": doc}, upsert=True)
    return doc


def _latest_weather():
    """This hour's weather: the stored reading if fresh, else Open-Meteo (tried at most hourly).

    Falls back to the newest stored reading, then {} (model defaults), when offline.
    """
    global _weather_tried_at
    now = datetime.datetime.utcnow()
    latest = COLS["weather_forecast"].find_one({"forecastFor": {"$lte": now}}, sort=[("forecastFor", -1)])
    # Admin "manual_override" rows are daily (forecastFor = midnight) and win for that day.
    max_age = datetime.timedelta(days=1) if (latest or {}).get("source") == "manual_override" else WEATHER_MAX_AGE
    if latest and now - latest["forecastFor"] < max_age:
        return latest
    if _weather_tried_at is None or now - _weather_tried_at > WEATHER_MAX_AGE:
        _weather_tried_at = now
        try:
            return _refresh_weather()
        except Exception as e:
            print(f"[WARN] Weather refresh failed: {e}")
    return latest or COLS["weather_forecast"].find_one(sort=[("forecastFor", -1)]) or {}


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
# Weather is refreshed hourly, so a cached demand older than this is recomputed.
FORECAST_MAX_AGE = datetime.timedelta(hours=1)

def _slot_of(moment):
    """(India date, 0 = morning / 1 = evening) for a naive UTC timestamp."""
    local = moment.replace(tzinfo=datetime.timezone.utc).astimezone(SHOP_TZ)
    return local.date(), 0 if local.hour < 13 else 1

def _slot_bounds(slot):
    """(start, end) of a slot as naive UTC: morning is India 00:00-13:00, evening 13:00-24:00."""
    day, window = slot
    local = lambda hour: datetime.datetime.combine(day, datetime.time(), tzinfo=SHOP_TZ) + datetime.timedelta(hours=hour)
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

    slot = _slot_of(datetime.datetime.utcnow())
    window_start, window_end = _slot_bounds(slot)
    # Demand for this window computed within the hour is reused: the model inputs (weather,
    # festival, past windows' sales) do not change inside a window, only the stock does.
    fresh_after = datetime.datetime.utcnow() - FORECAST_MAX_AGE
    cached = {
        pred["productId"]: pred for pred in COLS["predictions"].find({
            "predictionType": "DEMAND", "vendorId": vendor.get("vendor_id"),
            "windowStart": window_start, "generatedAt": {"$gte": fresh_after},
        })
    }

    # Sales history and snapshots are only read when some product needs a fresh model run.
    inputs = {}

    def model_inputs():
        if not inputs:
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
            inputs.update(history=history, sales=_sales_series(vendor, slot))
        return inputs["history"], inputs["sales"]

    locality = _field(vendor, "localityTier", "locality_tier", default="mixed")
    locality = _locality_tier(locality) or "mixed"
    vendor_features = {
        "localityTierEnc": _encode(demand_bundle["locality_encoder"], locality,
                                   _encode(demand_bundle["locality_encoder"], "mixed")),
        # shortcut: mid-range of training data (3-33) when a vendor has no score
        "hotspotDensityScore": float(_field(vendor, "hotspotDensityScore", "hotspot_density_score", default=18)),
    }

    forecasts = []
    for label in sorted(set(names) | set(held)):
        batches = held.get(label, [])
        if label in cached:
            demand, source, row = float(cached[label]["predictedValue"]), cached[label].get("historySource", "baseline"), None
        else:
            history, sales = model_inputs()
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
        # It doubles as the demand cache, so it is only written after a model run.
        if row is not None:
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
            "suggested_batches": suggested,
            "suggested_kg": suggested_kg,
            "uncovered_kg": round(max(0.0, refill - suggested_kg), 1),
        })

    return forecasts, sorted(unsupported)


def _forget_forecasts(vendor=None):
    """Mark cached demand stale (all shops, or one) after an input the model reads changes.
    The records stay as the forecast log; the next read recomputes and overwrites them."""
    query = {"predictionType": "DEMAND", "windowEnd": {"$gte": datetime.datetime.utcnow()}}
    if vendor is not None:
        query["vendorId"] = vendor.get("vendor_id")
    COLS["predictions"].update_many(query, {"$set": {"generatedAt": datetime.datetime(2000, 1, 1)}})


def refresh_forecasts():
    """Cache this window's demand for every live shop (run by the background timer),
    so the dashboard total and each shop's forecast page read it instead of re-running the model."""
    if not demand_bundle:
        return 0
    ctx = _demand_shared_context()
    shops = 0
    for vendor in COLS["vendors"].find({"vendor_id": {"$exists": True}}):
        if _vendor_status(vendor) in ("active", "approved"):
            _vendor_forecast(vendor, ctx)
            shops += 1
    return shops


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
def get_demand_forecast(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    require_vendor(user, vendor_id)
    if not demand_bundle:
        raise HTTPException(status_code=503, detail="Demand model not loaded")
    vendor = _find_vendor(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return _forecast_response(vendor, _demand_shared_context())


@app.get("/demand-forecast")
def get_all_demand_forecasts(vendor_id: Optional[str] = None, user: dict = Depends(current_user)):
    if vendor_id:
        require_vendor(user, vendor_id)
    else:
        require_role(user)
    if not demand_bundle:
        raise HTTPException(status_code=503, detail="Demand model not loaded")

    ctx = _demand_shared_context()
    if vendor_id:
        vendor = _find_vendor(vendor_id)
        if not vendor:
            raise HTTPException(status_code=404, detail="Vendor not found")
        return _forecast_response(vendor, ctx)

    live = [v for v in COLS["vendors"].find({"vendor_id": {"$exists": True}})
            if _vendor_status(v) in ("active", "approved")]
    # Each shop costs a few database round trips; doing shops side by side keeps the
    # all-shops view about as fast as one shop.
    with ThreadPoolExecutor(max_workers=8) as pool:
        per_shop = list(pool.map(lambda vendor: _vendor_forecast(vendor, ctx)[0], live))
    results = [{"vendor_id": vendor["vendor_id"], **row} for vendor, rows in zip(live, per_shop) for row in rows]
    return {"count": len(results), "forecast": results}


# POST /vendors/{vendor_id}/locality — admin corrects a shop's area, which drives its forecast.
# Body: {"locality_tier": "residential_budget"}
@app.post("/vendors/{vendor_id}/locality")
def set_vendor_locality(vendor_id: str = Path(...), data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
    locality = _locality_tier(data.get("locality_tier"))
    if not locality:
        raise HTTPException(status_code=400, detail=f"locality_tier must be one of: {', '.join(LOCALITY_TIERS)}")
    vendor = _find_vendor(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    # Write both spellings: seed vendors carry localityTier, which the forecast reads first.
    COLS["vendors"].update_one({"_id": vendor["_id"]}, {"$set": {
        "locality_tier": locality, "localityTier": locality, "updated_at": datetime.datetime.utcnow()}})
    _forget_forecasts(vendor)
    return {"message": "Locality updated", "vendor_id": vendor.get("vendor_id"), "locality_tier": locality}


# POST /festival-calendar — admin adds (or corrects) a festival window that the
# demand model's isFestivalWindow / festivalTypeEnc features read.
# Body: {"date": "2027-01-15", "festivalType": "harvestFestival", "windowDays": 4, "festivalName": "Pongal", "region": "Tamil Nadu"}
@app.post("/festival-calendar")
def add_festival(data: dict = Body(...), user: dict = Depends(current_user)):
    require_role(user)
    if not demand_bundle:
        raise HTTPException(status_code=503, detail="Demand model not loaded")
    known = [str(c) for c in demand_bundle["festival_encoder"].classes_ if c != "none"]
    festival_type = _field(data, "festivalType", "festival_type")
    if festival_type not in known:
        raise HTTPException(status_code=400, detail=f"festivalType must be one of: {', '.join(known)} (the types the model was trained on)")
    try:
        day = datetime.date.fromisoformat(str(data.get("date", "")))
        window_days = int(_field(data, "windowDays", "window_days", default=1))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD and windowDays a whole number")
    if not 1 <= window_days <= 31:  # _active_festival_type looks back 31 days
        raise HTTPException(status_code=400, detail="windowDays must be between 1 and 31")
    # India midnight in UTC, matching how the rest of the backend stores times.
    start = datetime.datetime.combine(day, datetime.time(), tzinfo=SHOP_TZ).astimezone(datetime.timezone.utc).replace(tzinfo=None)
    doc = {"date": start, "festivalType": festival_type, "windowDays": window_days,
           "festivalName": _field(data, "festivalName", "name", default=""),
           "region": data.get("region", "Tamil Nadu"), "updated_at": datetime.datetime.utcnow()}
    COLS["festival_calendar"].update_one({"date": start, "festivalType": festival_type}, {"$set": doc}, upsert=True)
    _forget_forecasts()
    return {"message": "Festival saved", "festival": doc}


# GET /festival-calendar — every stored festival window, soonest first.
@app.get("/festival-calendar")
def list_festivals(user: dict = Depends(current_user)):
    require_role(user)
    festivals = list(COLS["festival_calendar"].find().sort("date", 1))
    for festival in festivals:
        festival["_id"] = str(festival["_id"])
    return {"count": len(festivals), "festivals": festivals}


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
        # What a person uses to tell batches apart: product + when it was made.
        "manufactured_at": _field(batch, "manufactured_at", "mfgTimestamp", "created_at"),
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
        # Sales of expired stock are refused, so the advice must not say "keep selling".
        "action": "Expired: do not sell, return or discard" if row["expired"] else RISK_ACTIONS[label],
    }


@app.get("/vendors/{vendor_id}/batches")
def get_vendor_batches(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    require_vendor(user, vendor_id)
    vendor = _find_vendor(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
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
def get_vendor_spoilage_risk(vendor_id: str = Path(...), user: dict = Depends(current_user)):
    require_vendor(user, vendor_id)
    if not spoilage_bundle:
        raise HTTPException(status_code=503, detail="Spoilage model not loaded")
    vendor = _find_vendor(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

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
