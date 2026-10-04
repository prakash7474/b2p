import json
import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from xgboost import XGBRegressor
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import TimeSeriesSplit, RandomizedSearchCV
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

DATA_FILE = "b2p_demand_forecasting_data.csv"
MODEL_FILE = "demand_forecast_model.pkl"
RANDOM_STATE = 42
TEST_SHARE = 0.20
REFIT_ON_ALL_DATA = True

df = pd.read_csv(DATA_FILE)
df["date"] = pd.to_datetime(df["date"])
df = df.sort_values(["date", "window_order", "vendorId", "productId"]).reset_index(drop=True)

locality_encoder = LabelEncoder()
festival_encoder = LabelEncoder()
product_encoder = LabelEncoder()

df["localityTierEnc"] = locality_encoder.fit_transform(df["localityTier"])
df["festivalTypeEnc"] = festival_encoder.fit_transform(df["festivalType"])
df["productIdEnc"] = product_encoder.fit_transform(df["productId"])

features = [
    "hourSin",
    "hourCos",
    "weekdaySin",
    "weekdayCos",
    "isWeekend",
    "isFestivalWindow",
    "festivalTypeEnc",
    "forecastTemperatureC",
    "forecastRainProbability",
    "lag1",
    "lag7",
    "sameSlot4WeekMean",
    "rolling7DayMean",
    "rolling7DayStd",
    "recentTrend",
    "localityTierEnc",
    "hotspotDensityScore",
    "productIdEnc"
]
target = "unitsSoldNextWindow"

all_days = np.sort(df["date"].unique())
cutoff_date = all_days[int(len(all_days) * (1 - TEST_SHARE))]

train = df[df["date"] < cutoff_date]
test = df[df["date"] >= cutoff_date]

X_train, y_train = train[features], train[target]
X_test, y_test = test[features], test[target]


def get_metrics(y_true, y_pred):
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    wape = np.abs(y_true - y_pred).sum() / y_true.sum() * 100
    bias = (y_pred - y_true).mean()
    r2 = r2_score(y_true, y_pred)
    return {
        "MAE": round(float(mae), 3),
        "RMSE": round(float(rmse), 3),
        "WAPE_%": round(float(wape), 2),
        "Bias": round(float(bias), 3),
        "R2": round(float(r2), 3)
    }


baseline_pred = test["sameSlot4WeekMean"]
baseline_metrics = get_metrics(y_test, baseline_pred)
print(f"Baseline Metrics: {baseline_metrics}")

# XGBoost model tuning
xgb = XGBRegressor(
    objective="reg:squarederror",
    tree_method="hist",
    random_state=RANDOM_STATE,
    n_jobs=-1
)

param_space = {
    "n_estimators": [200, 400, 600],
    "learning_rate": [0.03, 0.05, 0.1],
    "max_depth": [3, 4, 5, 6],
    "min_child_weight": [1, 5, 10],
    "subsample": [0.7, 0.85, 1.0],
    "colsample_bytree": [0.7, 0.85, 1.0],
    "reg_lambda": [1, 5, 10]
}

time_cv = TimeSeriesSplit(n_splits=4)
search = RandomizedSearchCV(
    estimator=xgb,
    param_distributions=param_space,
    n_iter=25,
    scoring="neg_mean_absolute_error",
    cv=time_cv,
    random_state=RANDOM_STATE,
    n_jobs=1,
    verbose=1
)
search.fit(X_train, y_train)

best_params = search.best_params_
model = search.best_estimator_
print(f"Best Parameters: {best_params}")
print(f"Best CV MAE: {-search.best_score_:.3f}")

# Test evaluation
test_pred = np.clip(model.predict(X_test), 0, None)
model_metrics = get_metrics(y_test, test_pred)
print(f"Test Model Metrics: {model_metrics}")

# Safety stock calculation
SERVICE_LEVEL = 0.90
result = test.copy()
result["predicted"] = test_pred
result["shortfall"] = result[target] - result["predicted"]

safety_stock = {}
for product_name, rows in result.groupby("productId"):
    amount = np.quantile(rows["shortfall"], SERVICE_LEVEL)
    safety_stock[product_name] = round(max(0.0, float(amount)), 1)

print(f"Safety Stock: {safety_stock}")

# Plots
plt.figure(figsize=(5, 5))
plt.scatter(result[target], result["predicted"], s=4, alpha=0.4)
top = result[target].max()
plt.plot([0, top], [0, top], color="red")
plt.xlabel("Real units sold")
plt.ylabel("Predicted units")
plt.title("Demand: Predicted vs Real")
plt.savefig("demand_predicted_vs_real.png", dpi=120, bbox_inches="tight")
plt.close()

importance = pd.Series(model.feature_importances_, index=features).sort_values(ascending=False)
importance.sort_values().plot(kind="barh", title="Demand Feature Importance")
plt.savefig("demand_feature_importance.png", dpi=120, bbox_inches="tight")
plt.close()

# Retrain on all data if configured
if REFIT_ON_ALL_DATA:
    final_model = XGBRegressor(
        objective="reg:squarederror",
        tree_method="hist",
        random_state=RANDOM_STATE,
        n_jobs=-1,
        **best_params
    )
    final_model.fit(df[features], df[target])
else:
    final_model = model

# Save bundle and metrics
bundle = {
    "model": final_model,
    "features": features,
    "locality_encoder": locality_encoder,
    "festival_encoder": festival_encoder,
    "product_encoder": product_encoder,
    "safety_stock": safety_stock
}
joblib.dump(bundle, MODEL_FILE)

with open("demand_metrics.json", "w") as f:
    json.dump({
        "model": model_metrics,
        "baseline": baseline_metrics,
        "safety_stock": safety_stock,
        "best_params": {
            k: (int(v) if float(v).is_integer() else float(v))
            for k, v in best_params.items()
        }
    }, f, indent=2)

print(f"Saved model to {MODEL_FILE} and demand_metrics.json")
