# Replays the demand test period: how many units would be left unsold or short if each
# shop stocked by the B2P rule vs by the same-slot four-week average.
import json
import numpy as np, pandas as pd
from xgboost import XGBRegressor
from sklearn.preprocessing import LabelEncoder

# Run from this folder, like the training scripts.
data, metrics_file = "b2p_demand_forecasting_data.csv", "demand_metrics.json"
best = json.load(open(metrics_file))["best_params"]

# same preparation and split as train_demand_model.py
df = pd.read_csv(data)
df["date"] = pd.to_datetime(df["date"])
df = df.sort_values(["date", "window_order", "vendorId", "productId"]).reset_index(drop=True)
df = df[df["stockoutFlag"] == 0].reset_index(drop=True)
for col, enc in [("localityTier", "localityTierEnc"), ("festivalType", "festivalTypeEnc"), ("productId", "productIdEnc")]:
    df[enc] = LabelEncoder().fit_transform(df[col])
features = ["hourSin", "hourCos", "weekdaySin", "weekdayCos", "isWeekend", "isFestivalWindow", "festivalTypeEnc",
            "forecastTemperatureC", "forecastRainProbability", "lag1", "lag7", "sameSlot4WeekMean", "rolling7DayMean",
            "rolling7DayStd", "recentTrend", "localityTierEnc", "hotspotDensityScore", "productIdEnc"]
days = np.sort(df["date"].unique())
cutoff = days[int(len(days) * 0.8)]
train, test = df[df["date"] < cutoff], df[df["date"] >= cutoff].copy()

model = XGBRegressor(objective="reg:squarederror", tree_method="hist", random_state=42, n_jobs=-1, **best)
model.fit(train[features], train["unitsSoldNextWindow"])
test["pred"] = np.clip(model.predict(test[features]), 0, None)
test["base"] = test["sameSlot4WeekMean"]
d = test["unitsSoldNextWindow"]
wape = (d - test["pred"]).abs().sum() / d.sum() * 100
print(f"check: model WAPE {wape:.2f}% (report 13.28%), test windows {len(test)}, days {test['date'].nunique()}, "
      f"{test['date'].min().date()}..{test['date'].max().date()}, demand {d.sum():.0f}")
assert abs(wape - 13.28) < 0.3, "model does not reproduce the reported WAPE"

def safety(col):  # 90th percentile of under-forecast per product, as in the training script
    return (d - test[col]).groupby(test["productId"]).quantile(0.9).clip(lower=0)

def policy(name, stock):
    stock = stock.round().clip(lower=0)
    unsold, short = (stock - d).clip(lower=0), (d - stock).clip(lower=0)
    return {"policy": name, "stocked": stock.sum(), "unsold": unsold.sum(), "short": short.sum(),
            "unsold_pct": unsold.sum() / d.sum() * 100, "short_pct": short.sum() / d.sum() * 100,
            "stockout_windows_pct": (short > 0).mean() * 100}

rows = [
    policy("Habit: same-slot 4-week average", test["base"]),
    policy("Habit + 90% safety stock", test["base"] + test["productId"].map(safety("base"))),
    policy("B2P forecast only", test["pred"]),
    policy("B2P: forecast + 90% safety stock", test["pred"] + test["productId"].map(safety("pred"))),
]
out = pd.DataFrame(rows)
pd.set_option("display.width", 200)
print(out.round(1).to_string(index=False))
print("safety stock base:", safety("base").round(1).to_dict(), "pred:", safety("pred").round(1).to_dict())
