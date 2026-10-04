# Demand Forecast Model: Easy Guide

**File:** `demand_forecast_model.pkl`  |  **Training script:** `train_demand_model.py`  |  **Last updated:** 4 October 2026

---

## 1. Explain it in 60 seconds

Every day, each vendor sells idli batter, dosa batter and combo packs in two time slots: **morning (05:00 to 11:00)** and **evening (15:00 to 21:00)**. If the vendor has too little stock, customers go away. If they have too much, batter spoils.

This model answers one question:

> **"How many units will this vendor sell of this product in the next time slot?"**

The answer feeds a simple restock formula:

```
recommendedDispatch = max(0, predictedDemand + safetyStock - availableStock)
```

**Worked example** (a real row from the test results): vendor V100, Idly Batter, morning of 8 April 2026.

| Step | Value |
|---|---|
| Model predicts customers will buy | 45.1 units |
| Safety stock (extra cushion for Idly Batter) | + 10.4 units |
| Vendor already has in stock | - 36.6 units |
| **Send this many units** | **18.9 units** |

**Simple analogy:** the model works like a shopkeeper's experience. It looks at what sold in the same slot over the last four weeks, what sold last week, whether it is a weekend or festival, and then makes a good guess. (Technically this is *XGBoost*: many small decision trees built one after another, where each new tree fixes the mistakes of the earlier ones.)

---

## 2. Current state of the model

| Item | Value |
|---|---|
| Task | Regression (predict a number: units sold) |
| Algorithm | XGBoost Regressor (`reg:squarederror`) |
| Training data | 16,950 rows (13,500 for training, 3,450 for testing) |
| Input features | 18 |
| Average error on unseen days (MAE) | **4.71 units** |
| Error of the simple baseline | 5.72 units |
| Improvement over the baseline | **17.7%** |
| Total error as a share of sales (WAPE) | **15.8%** |
| Final model | Retrained on **all** days after testing, using the best settings |
| Safety stock | Calculated per product and saved inside the `.pkl` |
| Status | Trained and tested, saved as `.pkl`, **not yet connected to the backend** |
| Data type | **Synthetic (dummy) data**, made for the demo |

---

## 3. The data

### 3.1 What the CSV contains

File: `b2p_demand_forecasting_data.csv`: **16,950 rows**.

16,950 = 25 vendors x 3 products x 113 days x 2 time slots. The dates run from **8 January 2026 to 30 April 2026**. No values are missing. Each vendor belongs to one of 5 locality types, with 5 vendors in each type.

Sample rows (some columns hidden to fit):

| vendorId | productId | date | window | festivalType | forecastTemperatureC | forecastRainProbability | localityTier | unitsSoldNextWindow | lag1 | lag7 | sameSlot4WeekMean |
|---|---|---|---|---|---|---|---|---|---|---|---|
| V100 | Combo_Pack | 2026-01-08 | morning | none | 30.5 | 0.54 | residential_budget | 17.8 | 17.7 | 19.4 | 22.375 |
| V100 | Combo_Pack | 2026-01-08 | evening | none | 30.5 | 0.54 | residential_budget | 14.3 | 17.8 | 17.3 | 16.725 |
| V100 | Combo_Pack | 2026-01-09 | morning | none | 28.6 | 0.35 | residential_budget | 24.8 | 14.3 | 20.0 | 21.800 |

### 3.2 Where the data comes from (be honest about this with your instructor)

**The CSV is synthetic.** A script generated it. It was not collected from real vendors. The project documentation calls it "a placeholder for the demo only".

The generated numbers were made to behave like a real business. These patterns were **checked directly in the CSV**:

| Pattern in the data | What the numbers show |
|---|---|
| **Product popularity** | Average units per slot: Idly Batter 39.1, Dosa Batter 31.3, Combo Pack 19.6 |
| **Time of day** | Morning 34.3 units, evening 25.8 units |
| **Weekend** | Weekend 32.5 units, weekday 29.0 units |
| **Locality** | Office areas 37.8, institutional 31.2, premium residential 30.5, mixed 26.5, budget residential 24.1 |
| **Festival days** | 41.1 units on festival windows, against 29.6 on normal ones (about 35% higher compared with each vendor's own usual level) |
| **Weather** | One forecast per day, shared by all vendors. Sales are slightly lower when the rain chance is high. |
| **Past sales** | Each row carries the sales history (`lag1`, `lag7`, 4-week and 7-day averages) |

### 3.3 Festival days in the data

Only **4 festival days exist in the whole dataset**:

| Festival type | Dates in the data | Real-world match |
|---|---|---|
| `harvestFestival` | 14 to 16 January 2026 | Falls inside Pongal 2026. Sources give slightly different day-by-day schedules, but all place Pongal in mid-January (about 13 to 17 January). |
| `publicHoliday` | 14 April 2026 | 14 April is the usual date of the Tamil New Year. |

References: Pongal in Wikipedia, <https://en.wikipedia.org/wiki/Pongal_(festival)> and Pongal 2026 dates on timeanddate, <https://timeanddate.com/holidays/india/pongal>.

### 3.4 How the time columns are calculated (important for the backend)

| Column | How it is made | Check |
|---|---|---|
| `hourSin`, `hourCos` | Sine and cosine of the **middle hour of the slot**: 08:00 for morning, 18:00 for evening | Morning gives 0.866 and -0.5. Evening gives -1.0 and 0. |
| `weekdaySin`, `weekdayCos` | Sine and cosine of the weekday number, with **Monday = 0** (the cycle repeats every 7 days) | 8 Jan 2026 is a Thursday (3): sin = 0.4339, cos = -0.901 |
| `lag1` | Units sold in the **previous** slot (same vendor and product) | Matches in 99.6% of rows. The remaining 0.4% are the first rows of each series, which have no history. |
| `lag7` | Units sold in the same slot **7 days ago** (14 slots earlier) | Matches in 93.8% of rows. The rest are the first 7 days of each series. |
| `sameSlot4WeekMean` | Average of the same slot over the last 4 weeks | Used as the baseline |
| `rolling7DayMean`, `rolling7DayStd` | Average and spread of the last 7 days (not including the slot being predicted) | |
| `recentTrend` | Last 7-day average divided by last 28-day average (above 1 means sales are rising) | |

The model must **never see the future**. All history columns use only past sales, and our check confirmed this.

---

## 4. The inputs (18 features)

| # | Feature | Plain meaning |
|---|---|---|
| 1, 2 | `hourSin`, `hourCos` | Morning or evening (turned into numbers that wrap around the clock) |
| 3, 4 | `weekdaySin`, `weekdayCos` | Day of the week (turned into numbers that wrap around the week) |
| 5 | `isWeekend` | 1 for Saturday or Sunday |
| 6 | `isFestivalWindow` | 1 if it is a festival or holiday |
| 7 | `festivalTypeEnc` | Which festival (none, harvest festival, public holiday) as a number |
| 8 | `forecastTemperatureC` | Forecast temperature |
| 9 | `forecastRainProbability` | Forecast chance of rain (0 to 1) |
| 10 | `lag1` | Sales in the previous slot |
| 11 | `lag7` | Sales in the same slot a week ago |
| 12 | `sameSlot4WeekMean` | Average of the same slot over 4 weeks |
| 13, 14 | `rolling7DayMean`, `rolling7DayStd` | Recent average sales, and how much they jump around |
| 15 | `recentTrend` | Are sales rising or falling? |
| 16 | `localityTierEnc` | Type of area (offices, premium residential, and so on) as a number |
| 17 | `hotspotDensityScore` | How busy the vendor's neighbourhood is (3 to 33) |
| 18 | `productIdEnc` | Which product, as a number |

**Left out on purpose:**

| Column | Why it is not used |
|---|---|
| `availableStock`, `stockoutFlag` | Not known when predicting. When a vendor sells out, sales equal stock, so using stock would leak the answer. |
| `rolling28DayMean` | Only used to calculate `recentTrend` |
| `vendorId`, `date`, `window`, `window_order` | IDs and labels. The time-of-day and weekday information is already inside the sine/cosine features. |

---

## 5. How the model was trained (step by step)

1. **Load** the CSV and **sort it by date**.
2. **Convert text to numbers** (locality, festival type, product).
3. **Chronological split, never random.** The last 20% of days is the test set.
   - Training: 8 Jan to 7 Apr 2026 (13,500 rows)
   - Testing: 8 Apr to 30 Apr 2026 (3,450 rows)
4. **Baseline.** Predict "same as the 4-week average for this slot". Our model must beat this.
5. **Tune settings.** Try 25 random combinations, each tested on 4 time-ordered slices.
6. **Pick the best** by average error (MAE).
7. **Test once** on the 23 unseen days.
8. **Calculate the safety stock** per product.
9. **Retrain on all days** with the best settings, so the saved model has seen the most recent data.
10. **Save** the model and its helpers into `demand_forecast_model.pkl`.

### 5.1 Settings used and why

| Setting | Value used | Why |
|---|---|---|
| `objective` | `reg:squarederror` | The standard loss for predicting a number. It is the choice named in the project documentation. |
| `tree_method` | `hist` | A fast method that suits 17,000 rows. |
| `random_state` | 42 | Same random seed every time, so results can be repeated. |
| `n_estimators` (trees) | **200** (tried 200, 400, 600) | More trees can overfit. 200 was enough. |
| `learning_rate` | **0.05** (tried 0.03, 0.05, 0.1) | Small steps learn carefully and overfit less. |
| `max_depth` | **4** (tried 3 to 6) | Shallow trees generalise better. |
| `min_child_weight` | **10** (tried 1, 5, 10) | A leaf needs enough data behind it, so noise is ignored. |
| `subsample` | **0.85** (tried 0.7, 0.85, 1.0) | Each tree sees 85% of the rows, which reduces overfitting. |
| `colsample_bytree` | **0.7** (tried 0.7, 0.85, 1.0) | Each tree sees 70% of the features, which reduces overfitting. |
| `reg_lambda` | **10** (tried 1, 5, 10) | A penalty that keeps predictions smooth. 10 was the strongest value tried. |
| Cross-validation | `TimeSeriesSplit`, 4 folds | Each fold trains on the **past** and checks on the **future**, like real life. |
| Search type | Random search, 25 tries | Tries a sample of combinations. There are 2,916 possible ones, so testing all would take too long. |
| Scoring | MAE | Easy to explain: "we are off by about X units on average". |
| Test share | 20% of days | The last 23 days are kept hidden. |
| Predictions clipped at 0 | Yes | Sales cannot be negative. |
| Safety stock service level | 90% | We accept running short in about 1 of 10 slots. |

---

## 6. Results

### 6.1 Scores on the 23 unseen days (8 to 30 April 2026)

| Measure | Our model | Baseline (4-week average) | What it means |
|---|---|---|---|
| **MAE** | **4.71** | 5.72 | Average miss in units. Lower is better. |
| RMSE | 6.52 | 7.94 | Like MAE, but punishes big misses more |
| **WAPE** | **15.8%** | 19.2% | Total error as a share of total sales |
| Bias | -0.28 | +0.25 | Average over- or under-prediction. Close to 0 is good. |
| R2 | 0.83 | 0.75 | Share of the ups and downs the model explains (1.0 is perfect) |

**Improvement over the baseline: 17.7%.** The project rule is "only ship a model that beats the baseline", and this one does.

### 6.2 Overfitting check

| | MAE |
|---|---|
| Training data | 4.40 |
| Unseen test data | 4.71 |
| Best cross-validation | 4.70 |

The three numbers are close, so the model is not memorising.

### 6.3 Where is the model strong or weak?

| Group | Average miss (MAE) | Bias |
|---|---|---|
| Combo Pack | 2.97 | -0.09 |
| Dosa Batter | 5.02 | -0.32 |
| Idly Batter | 6.14 | -0.44 |
| Morning | 5.26 | -0.43 |
| Evening | 4.17 | -0.14 |
| Normal days | 4.59 | -0.04 |
| **Festival days** | **7.37** | **-5.72** |

Idly Batter has the biggest misses simply because it sells the most. Festival days are the weak spot (see section 8).

### 6.4 What the model pays attention to

| Feature | Importance |
|---|---|
| sameSlot4WeekMean | 40.8% |
| rolling7DayMean | 16.0% |
| lag7 | 15.5% |
| hourSin (morning or evening) | 5.6% |
| isFestivalWindow | 3.3% |
| the other 13 features together | about 18.8% |

Recent sales history matters most, as expected.

---

## 7. Safety stock

The model predicts the usual demand, but real demand is sometimes higher. Safety stock is an **extra cushion** added on top of the prediction.

**How it is calculated:** for each product, look at how far real sales went above the prediction on the test days, and take the amount that would have covered 90% of those cases.

| Product | Safety stock (units) |
|---|---|
| Combo Pack | 4.9 |
| Dosa Batter | 8.3 |
| Idly Batter | 10.4 |

| | Share of slots with enough stock |
|---|---|
| Prediction only | 50.2% |
| Prediction + safety stock | 90.0% |

The 90% figure is measured on the same test days used to pick the amounts, so present it as a demonstration of the idea. The three values are stored in the `.pkl` under the key `safety_stock`.

---

## 8. How to use the model

```python
import joblib
import numpy as np
import pandas as pd

bundle = joblib.load("demand_forecast_model.pkl")   # always use joblib, not pickle

row = {
    "hourSin": 0.866, "hourCos": -0.5,                 # morning slot (08:00)
    "weekdaySin": 0.4339, "weekdayCos": -0.901,        # Thursday (Monday = 0)
    "isWeekend": 0, "isFestivalWindow": 0,
    "festivalTypeEnc": bundle["festival_encoder"].transform(["none"])[0],
    "forecastTemperatureC": 30.5, "forecastRainProbability": 0.54,
    "lag1": 17.7, "lag7": 19.4, "sameSlot4WeekMean": 22.4,
    "rolling7DayMean": 19.5, "rolling7DayStd": 3.8, "recentTrend": 1.0,
    "localityTierEnc": bundle["locality_encoder"].transform(["residential_budget"])[0],
    "hotspotDensityScore": 33,
    "productIdEnc": bundle["product_encoder"].transform(["Combo_Pack"])[0],
}

X = pd.DataFrame([row])[bundle["features"]]                      # keep the right column order
predicted = max(0.0, float(bundle["model"].predict(X)[0]))       # units, never negative

safety = bundle["safety_stock"]["Combo_Pack"]
available_stock = 22.5
dispatch = max(0, predicted + safety - available_stock)
print(round(predicted, 1), round(dispatch, 1))
```

The `.pkl` file is a dictionary:

| Key | What it holds |
|---|---|
| `model` | The trained XGBoost model |
| `features` | The 18 feature names in the right order |
| `locality_encoder`, `festival_encoder`, `product_encoder` | Convert text to numbers. Order is alphabetical, for example Combo_Pack = 0, Dosa_Batter = 1, Idly_Batter = 2. |
| `safety_stock` | Extra units per product for the dispatch formula |

**Warnings:**
- Open the file with `joblib.load`. `pickle.load` fails on it.
- The backend must use the **same scikit-learn and xgboost versions** as Colab.
- Build the time features the same way as the training data (middle hour 08:00 or 18:00, Monday = 0).

---

## 9. Limitations (be upfront about these)

### Limitation 1: the data records sales, not demand

When a vendor runs out of stock, the data records only what was sold, not the customers who were turned away. In **51% of rows, sales exactly equal the available stock**, which means the vendor ran out. So the model learns "what was sold", which is lower than real demand.

**What we did:** the safety stock adds a cushion. It raises the share of slots with enough stock from about 50% to 90%.
**Better fix later:** record the time a vendor runs out, or the number of customers turned away, and retrain.

### Limitation 2: very few festival days

Only 4 festival days exist in the data. The training period has the three harvest-festival days in January. The test period has one day, the public holiday on 14 April, a festival type the model had never seen. On that day the model predicted about 5.7 units too low.

That number comes from a single day, so treat it as a warning, not a precise measurement. The saved model is retrained on all days, so it has seen both festival types.

**Possible fixes:**
- Collect a full year of data so there are many festival days.
- Add a small festival top-up to the safety stock on festival windows. (This is not in the current script.)

### Other limitations

3. **Synthetic data.** All numbers are for the demo. Retrain on real transaction data (the project plan says after 8 to 12 weeks of clean data).
4. **Not connected yet.** No backend endpoint calls the model.
5. **New products or localities** that were not in training will cause an error in the encoders. The backend needs to handle this.

---

## 10. How to retrain

1. Put `train_demand_model.py` and `b2p_demand_forecasting_data.csv` in the same folder (Colab or your computer).
2. Install the packages: `pip install pandas numpy scikit-learn xgboost matplotlib joblib`
3. Run: `python train_demand_model.py` (takes a few minutes because it tries 25 combinations).

It writes `demand_forecast_model.pkl`, `demand_metrics.json`, `demand_predicted_vs_real.png` and `demand_feature_importance.png`.

**Rule for shipping a retrained model:** it must beat the baseline on both MAE and WAPE, tested on the most recent days. Never shuffle the data before splitting it.

---

## 11. Questions your instructor may ask

**Why XGBoost?** It is accurate on tabular data, handles mixed features, and has built-in controls against overfitting.

**Why a chronological split and not a random one?** In real life we predict the future from the past. A random split would let the model peek at neighbouring days and give an unrealistically good score.

**What is the baseline, and why does it matter?** It is the same-slot 4-week average, a simple method a shopkeeper could use. A model is only useful if it beats it. Ours is 17.7% better.

**What is WAPE?** Total error divided by total sales. A WAPE of 15.8% means the total miss is about 16% of total sales.

**What is overfitting and how did you check?** It means memorising the training data. Our training error (4.40) and test error (4.71) are close.

**Why is MAE used for tuning but squared error for training?** Squared error is the standard training loss. MAE is easier to explain to a business ("off by about 5 units"), so we use it to choose the best settings.

**What is safety stock?** An extra cushion on top of the forecast. It covers the cases where real demand is higher, because the recorded sales cannot show the customers who were turned away.

**Why are the festival results weak?** The dummy data has only 4 festival days, and the test day was a festival type the model had not seen. More festival data would fix it.

**Is the data real?** No. It is synthetic. The patterns in it (popularity of products, morning vs evening, weekends, festivals) were checked and are realistic, and the festival dates match real 2026 festivals.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| Regression | Predicting a number (units sold), not a category |
| Feature | One input column |
| Lag | Past sales, for example `lag7` is sales a week ago |
| Baseline | A simple method the model must beat |
| MAE | Mean absolute error: the average miss in units |
| RMSE | Like MAE, but big misses count more |
| WAPE | Total error as a percentage of total sales |
| Bias | Average over- or under-prediction (negative means too low) |
| R2 | How much of the ups and downs the model explains |
| Overfitting | Memorising training data instead of learning general rules |
| Time-series split | Validation that always trains on the past and tests on the future |
| Safety stock | Extra units added on top of the forecast as a cushion |

---

## 13. References

- XGBoost parameters: <https://xgboost.readthedocs.io/en/stable/parameter.html>
- scikit-learn TimeSeriesSplit: <https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html>
- scikit-learn RandomizedSearchCV: <https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.RandomizedSearchCV.html>
- Pongal festival: <https://en.wikipedia.org/wiki/Pongal_(festival)>
- Pongal dates by year: <https://timeanddate.com/holidays/india/pongal>
