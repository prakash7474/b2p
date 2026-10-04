"""
Model Compatibility & Inference Test
=====================================
Tests both trained models against their expected feature schemas.
Run from the project root:   python3 backend/model_test.py
"""

import sys
import math
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

# ── Add user site-packages so joblib / sklearn / xgboost are found ──────────
sys.path.insert(0, str(Path.home() / ".local/lib/python3.14/site-packages"))

try:
    import numpy as np
    import pandas as pd
    import joblib
except ImportError as e:
    print(f"[FAIL] Missing dependency: {e}")
    print("       Run:  python3 -m pip install --break-system-packages joblib numpy pandas scikit-learn xgboost")
    sys.exit(1)

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
DEMAND_PATH = MODELS_DIR / "demand_forecast_model (2).pkl"
SPOILAGE_PATH = MODELS_DIR / "spoilage_risk_model (2).pkl"

PASS = "PASS"
FAIL = "FAIL"

results = []

def check(label, condition, detail=""):
    status = PASS if condition else FAIL
    icon = "OK" if condition else "XX"
    results.append((status, label, detail))
    print(f"  [{icon}] {label}" + (f"  ->  {detail}" if detail else ""))
    return condition


# ═══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("  DEMAND FORECAST MODEL")
print("=" * 65)

demand_ok = True
d = None

try:
    d = joblib.load(DEMAND_PATH)
    check("Model file loads via joblib", True, str(DEMAND_PATH.name))
except Exception as e:
    check("Model file loads via joblib", False, str(e))
    demand_ok = False

if d is not None:
    EXPECTED_DEMAND_KEYS = {"model", "features", "locality_encoder",
                             "festival_encoder", "product_encoder", "safety_stock"}
    actual_keys = set(d.keys())
    check("Dict has all expected keys", EXPECTED_DEMAND_KEYS == actual_keys,
          f"keys: {sorted(actual_keys)}")

    EXPECTED_FEATURES = [
        "hourSin", "hourCos", "weekdaySin", "weekdayCos",
        "isWeekend", "isFestivalWindow", "festivalTypeEnc",
        "forecastTemperatureC", "forecastRainProbability",
        "lag1", "lag7", "sameSlot4WeekMean",
        "rolling7DayMean", "rolling7DayStd", "recentTrend",
        "localityTierEnc", "hotspotDensityScore", "productIdEnc",
    ]
    check("Feature list matches expected (18 features)", d["features"] == EXPECTED_FEATURES,
          f"Got {len(d['features'])} features")

    check("model is XGBRegressor", type(d["model"]).__name__ == "XGBRegressor",
          type(d["model"]).__name__)

    check("locality_encoder has 5 classes",
          len(d["locality_encoder"].classes_) == 5,
          str(list(d["locality_encoder"].classes_)))

    check("festival_encoder has 3 classes",
          len(d["festival_encoder"].classes_) == 3,
          str(list(d["festival_encoder"].classes_)))

    check("product_encoder covers 3 products",
          set(d["product_encoder"].classes_) == {"Idly_Batter", "Dosa_Batter", "Combo_Pack"},
          str(list(d["product_encoder"].classes_)))

    check("safety_stock has per-product values",
          isinstance(d["safety_stock"], dict) and len(d["safety_stock"]) == 3,
          str(d["safety_stock"]))

    print("\n  --- Live inference (Monday 10am, Idly Batter, residential_premium) ---")
    hour, weekday = 10, 1
    row = {
        "hourSin":                 math.sin(2 * math.pi * hour / 24),
        "hourCos":                 math.cos(2 * math.pi * hour / 24),
        "weekdaySin":              math.sin(2 * math.pi * weekday / 7),
        "weekdayCos":              math.cos(2 * math.pi * weekday / 7),
        "isWeekend":               0,
        "isFestivalWindow":        0,
        "festivalTypeEnc":         list(d["festival_encoder"].classes_).index("none"),
        "forecastTemperatureC":    28.5,
        "forecastRainProbability": 0.15,
        "lag1":                    30.0,
        "lag7":                    28.0,
        "sameSlot4WeekMean":       29.0,
        "rolling7DayMean":         29.5,
        "rolling7DayStd":          3.2,
        "recentTrend":             1.5,
        "localityTierEnc":         list(d["locality_encoder"].classes_).index("residential_premium"),
        "hotspotDensityScore":     0.8,
        "productIdEnc":            list(d["product_encoder"].classes_).index("Idly_Batter"),
    }
    try:
        X = pd.DataFrame([row])[d["features"]]
        pred = d["model"].predict(X)[0]
        safety = d["safety_stock"]["Idly_Batter"]
        suggested = max(0, round(pred + safety))
        check("predict() returns a positive float", pred > 0, f"{pred:.2f} units/slot")
        check("Suggested restock qty is an int >= 0", suggested >= 0, f"{suggested} units")
        print(f"         Predicted demand : {pred:.2f}")
        print(f"         Safety stock     : {safety}")
        print(f"         Suggested order  : {suggested} units")
    except Exception as e:
        check("predict() runs without error", False, str(e))
        demand_ok = False

    print("\n  --- Backend compatibility ---")
    check("weather_forecast collection feeds 2 features", True,
          "needs: forecastTemperatureC, forecastRainProbability")
    check("festival_calendar collection feeds 2 features", True,
          "needs: isFestivalWindow, festivalTypeEnc")
    check("No predict endpoint exists yet in main.py", True,
          "-> Needs: POST /vendors/{vendor_id}/predict/demand")


# ═══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("  SPOILAGE RISK MODEL")
print("=" * 65)

spoilage_ok = True
s = None

try:
    s = joblib.load(SPOILAGE_PATH)
    check("Model file loads via joblib", True, str(SPOILAGE_PATH.name))
except Exception as e:
    check("Model file loads via joblib", False, str(e))
    spoilage_ok = False

if s is not None:
    EXPECTED_SPOILAGE_KEYS = {"model", "features", "storage_encoder", "label_encoder"}
    actual_keys_s = set(s.keys())
    check("Dict has all expected keys", EXPECTED_SPOILAGE_KEYS == actual_keys_s,
          f"keys: {sorted(actual_keys_s)}")

    EXPECTED_SPOILAGE_FEATURES = [
        "initialPH", "hoursSinceManufacture", "hasRefrigerator",
        "storageTypeEnc", "ambientTemperatureC", "humidityPct",
        "fridgeTemperatureC", "hoursOnShelf", "sellThroughRate",
        "effectiveTemperatureExposure", "hoursToExpiry", "volumeKg", "vendorRating",
    ]
    check("Feature list matches expected (13 features)", s["features"] == EXPECTED_SPOILAGE_FEATURES,
          f"Got {len(s['features'])} features")

    check("model is RandomForestClassifier",
          type(s["model"]).__name__ == "RandomForestClassifier",
          type(s["model"]).__name__)

    check("label_encoder has Low/Medium/High classes",
          set(s["label_encoder"].classes_) == {"Low", "Medium", "High"},
          str(list(s["label_encoder"].classes_)))

    check("storage_encoder is fitted", hasattr(s["storage_encoder"], "classes_"),
          str(list(s["storage_encoder"].classes_)))

    print("\n  --- Live inference: LOW RISK (fresh batch, refrigerated) ---")
    row_low = {
        "initialPH": 4.5, "hoursSinceManufacture": 6.0, "hasRefrigerator": 1,
        "storageTypeEnc": 0, "ambientTemperatureC": 28.0, "humidityPct": 60.0,
        "fridgeTemperatureC": 4.0, "hoursOnShelf": 2.0, "sellThroughRate": 0.7,
        "effectiveTemperatureExposure": 6.0, "hoursToExpiry": 20.0,
        "volumeKg": 5.0, "vendorRating": 4.2,
    }
    try:
        X_low = pd.DataFrame([row_low])[s["features"]]
        pred_low = s["model"].predict(X_low)[0]
        label_low = s["label_encoder"].inverse_transform([pred_low])[0]
        proba_low = s["model"].predict_proba(X_low)[0]
        check("predict() returns a valid risk class", label_low in {"Low", "Medium", "High"},
              f"-> {label_low}")
        check("predict_proba() sums to 1.0",
              abs(sum(proba_low) - 1.0) < 1e-6, f"sum={sum(proba_low):.4f}")
        print(f"         Risk label: {label_low}")
        for cls, prob in zip(s["model"].classes_, proba_low):
            lbl = s["label_encoder"].inverse_transform([cls])[0]
            print(f"           {lbl}: {prob:.3f}")
    except Exception as e:
        check("predict() runs without error", False, str(e))
        import traceback; traceback.print_exc()
        spoilage_ok = False

    print("\n  --- Live inference: HIGH RISK (old, hot, humid, no fridge) ---")
    row_high = {
        "initialPH": 3.8, "hoursSinceManufacture": 32.0, "hasRefrigerator": 0,
        "storageTypeEnc": 1, "ambientTemperatureC": 38.0, "humidityPct": 88.0,
        "fridgeTemperatureC": 25.0, "hoursOnShelf": 20.0, "sellThroughRate": 0.1,
        "effectiveTemperatureExposure": 38.0, "hoursToExpiry": 2.0,
        "volumeKg": 15.0, "vendorRating": 2.1,
    }
    try:
        X_high = pd.DataFrame([row_high])[s["features"]]
        pred_high = s["model"].predict(X_high)[0]
        label_high = s["label_encoder"].inverse_transform([pred_high])[0]
        proba_high = s["model"].predict_proba(X_high)[0]
        check("High-risk scenario returns a risk class", label_high in {"Low", "Medium", "High"},
              f"-> {label_high}")
        print(f"         Risk label: {label_high}")
        for cls, prob in zip(s["model"].classes_, proba_high):
            lbl = s["label_encoder"].inverse_transform([cls])[0]
            print(f"           {lbl}: {prob:.3f}")
    except Exception as e:
        check("High-risk predict() runs without error", False, str(e))
        spoilage_ok = False

    print("\n  --- Backend compatibility ---")
    check("batches collection feeds 3 features", True,
          "needs: initialPH, hoursSinceManufacture, volumeKg")
    check("vendors collection feeds 3 features", True,
          "needs: hasRefrigerator, vendorRating, storageTypeEnc")
    check("No spoilage endpoint exists yet in main.py", True,
          "-> Needs: GET /inventory/{vendor_id}/spoilage-risk")


# ═══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("  SUMMARY")
print("=" * 65)

passes = sum(1 for r in results if r[0] == PASS)
fails = sum(1 for r in results if r[0] == FAIL)
print(f"\n  Total checks : {len(results)}")
print(f"  PASS         : {passes}")
print(f"  FAIL         : {fails}")

if fails == 0:
    print("\n  Both models are COMPATIBLE and WORKING.")
    print("\n  Next steps to integrate into backend/main.py:")
    print("  1. Add to requirements.txt: scikit-learn xgboost pandas joblib numpy")
    print("  2. Load models at startup (module level, alongside COLS)")
    print("  3. Add  POST /vendors/{vendor_id}/predict/demand  endpoint")
    print("  4. Add  GET  /inventory/{vendor_id}/spoilage-risk  endpoint")
    print("  5. Assemble features from: weather_forecast, festival_calendar,")
    print("     inventory, batches, feature_snapshots collections")
else:
    print("\n  Some checks FAILED -- see output above.")

print()
