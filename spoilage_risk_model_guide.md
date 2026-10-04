# Spoilage Risk Model: Easy Guide

**File:** `spoilage_risk_model.pkl`  |  **Training script:** `train_spoilage_model.py`  |  **Last updated:** 4 October 2026

---

## 1. Explain it in 60 seconds

Idli and dosa batter keeps fermenting after it is made. In a hot place it goes bad in about two days. In a fridge it lasts about nine days.

This model looks at one batch of batter sitting in a vendor's shop and answers one question:

> **"How likely is this batch to spoil soon?"**

It answers with one of three labels:

| Label | Meaning | What the app does |
|---|---|---|
| **Low** | Fresh | Nothing. Normal tracking. |
| **Medium** | Selling at a moderate pace | Sends the vendor a "fresh batch" nudge |
| **High** | Close to spoiling or expired | Adds a priority-sale tag or a flash discount |

**Simple analogy:** it works like a panel of 200 food inspectors. Each inspector looks at the batch and votes. The label with the most votes wins. (In technical words this is a *Random Forest*: 200 decision trees voting together.)

---

## 2. Current state of the model

| Item | Value |
|---|---|
| Task | Classification into 3 classes (Low / Medium / High) |
| Algorithm | Random Forest Classifier (scikit-learn) |
| Training data | 4,000 batches (3,200 for training, 800 for testing) |
| Input features | 13 |
| Test accuracy | **98.6%** |
| Test macro F1 | **0.971** (1.0 is perfect) |
| Real "High" batches predicted as "Low" | **0 out of 648** |
| Status | Trained and tested, saved as `.pkl`, **not yet connected to the backend** |
| Data type | **Synthetic (dummy) data**, made for the demo |

---

## 3. The data

### 3.1 What the CSV contains

File: `b2p_spoilage_risk_data.csv`: **4,000 rows**, one row per batch. There are 25 vendors (V100 and up), 3 products (Idly Batter, Dosa Batter, Combo Pack) and 3 storage types (counter, backroom, fridge). No values are missing and no batch ID is repeated.

Sample rows (some columns hidden to fit):

| vendorId | productId | hoursSinceManufacture | storageType | hasRefrigerator | ambientTemperatureC | hoursOnShelf | sellThroughRate | hoursToExpiry | riskLabel |
|---|---|---|---|---|---|---|---|---|---|
| V100 | Idly_Batter | 20.5 | fridge | 1 | 25.6 | 4.7 | 0.75 | 195.5 | Medium |
| V103 | Dosa_Batter | 5.2 | backroom | 0 | 32.9 | 3.0 | 0.35 | 42.8 | High |
| V109 | Combo_Pack | 73.6 | counter | 0 | 34.4 | 15.4 | 0.27 | 0.0 | High |

### 3.2 Where the data comes from (be honest about this with your instructor)

**The CSV is synthetic.** A script generated it. It was not collected from real vendors. The project documentation says so: the labels come from a *simulated risk-score formula*, and the sell-through rates are a placeholder pattern.

Because no real vendor data exists yet, the generated numbers were made to behave like the real world. The rules below were **checked directly in the CSV**:

| Rule seen in the data | Details |
|---|---|
| **Shelf life depends on the fridge** | Batches with a fridge expire after exactly **216 hours (9 days)**. Batches without one expire after exactly **48 hours (2 days)**. |
| **Fridge temperature** | With a fridge: 2 to 10.8 °C, average 5.1 °C. Without a fridge the value is stored as **-1** (meaning "no fridge"). |
| **Room temperature** | 22 to 40 °C, average 31 °C |
| **Temperature exposure** | `effectiveTemperatureExposure = (fridge temp if fridge, else room temp) x hours since made`, with about 1% random noise |
| **Expired batches** | When the time left reaches zero, `hoursToExpiry` is stored as 0. All **887** such batches are labelled High. |
| **Fridge effect on labels** | Without a fridge: 96.6% High. With a fridge: 68.4% High, 17.7% Medium, 14.0% Low. |

### 3.3 Real-world reference for these rules

The made-up rules match what food-science research reports for fermented idli batter:

| What the data assumes | What the literature says | Source |
|---|---|---|
| 9 days in the fridge, 2 days at room temperature | A study found batter kept at 5 °C stays usable for about 9 days, while batter kept at 30 °C loses its properties after about 48 hours | Study of changes in functional properties of fermented Idli batter during storage (ScienceDirect), <https://www.sciencedirect.com/science/article/abs/pii/S2949824424001526> |
| Fridge extends life a lot | Health-authority guidance says batter lasts about 1 day at room temperature and 5 to 7 days refrigerated | BC Centre for Disease Control, Fermented Foods Guideline 3.4 Dosa & Idli, <https://www.bccdc.ca/resource-gallery/Documents/Educational%20Materials/EH/FPS/Food/Fermented/Fermented%20Foods%20Guideline%20-%203.4%20Dosa%20and%20Idli.pdf> |
| Batter pH about 4.4 to 4.55 | Papers report that stored ready-to-cook idli batter is considered spoiled once its pH drops below about 4.5 | Shelf-life estimation of packaged idli batter (ScienceDirect), <https://www.sciencedirect.com/science/article/abs/pii/S0260877422000760> |
| Vendors keep batter at about 4 to 8 °C | A survey of batter outlets found refrigeration at 4 to 8 °C is the common way to stretch shelf life to 5 to 7 days | PubMed Central article on idli batter shelf life, <https://pmc.ncbi.nlm.nih.gov/articles/PMC6098797> |

**How to say it:** "The data is synthetic, but its main rules (48 h without a fridge, 9 days with one) match published idli-batter research."

---

## 4. The inputs (13 features)

| # | Feature | Plain meaning | Typical range in the data |
|---|---|---|---|
| 1 | `initialPH` | Acidity of the batter when made | 4.36 to 4.55 |
| 2 | `hoursSinceManufacture` | Hours since the batter was made | 0 to 96 |
| 3 | `hasRefrigerator` | 1 if the vendor has a fridge, else 0 | 0 or 1 |
| 4 | `storageTypeEnc` | Where it is kept: backroom, counter or fridge (turned into a number) | 0, 1, 2 |
| 5 | `ambientTemperatureC` | Air temperature at the shop | 22 to 40 |
| 6 | `humidityPct` | Air humidity | 40 to 95 |
| 7 | `fridgeTemperatureC` | Fridge temperature, or -1 if no fridge | -1, or 2 to 10.8 |
| 8 | `hoursOnShelf` | Hours since the vendor received it | 0 to 92 |
| 9 | `sellThroughRate` | Share already sold (0 to 1) | 0.01 to 0.98 |
| 10 | `effectiveTemperatureExposure` | Temperature x hours since made (how much "heat" the batch has had) | 0 to 3,524 |
| 11 | `hoursToExpiry` | Hours left before expiry | 0 to 216 |
| 12 | `volumeKg` | Batch size | 1, 2, 5 or 10 kg |
| 13 | `vendorRating` | Vendor's rating | 2.9 to 5.0 |

**Not used:** `vendorId`, `batchId` and `productId`. They are only names or IDs, and the model should learn from conditions, not from names.

---

## 5. How the model was trained (step by step)

1. **Load** the CSV and check it: no missing values, no duplicate batch IDs.
2. **Convert text to numbers.** `storageType` becomes 0, 1 or 2. The label becomes High = 0, Low = 1, Medium = 2 (alphabetical order).
3. **Split 80% / 20%** into training and test data. The split is *stratified*, so Low, Medium and High appear in the same proportions in both parts.
4. **Baseline.** A "model" that always says High scores 81% accuracy, but its macro F1 is only 0.298. Our model has to beat this.
5. **Tune settings.** Try 36 combinations of settings, and test each one 5 times on different slices of the training data (180 trainings in total).
6. **Pick the best** combination by macro F1.
7. **Test once** on the 800 batches the model has never seen.
8. **Save** the model and its helpers into `spoilage_risk_model.pkl`.

### 5.1 Settings used and why

| Setting | Value used | Why |
|---|---|---|
| `class_weight` | `"balanced"` | "High" is 81% of the data. This makes mistakes on the rarer Low and Medium count more, so the model does not ignore them. |
| `random_state` | 42 | Same random seed every time, so the results can be repeated. |
| `n_jobs` | -1 | Use all CPU cores, which is faster. |
| `n_estimators` (trees) | **200** (tried 200, 400) | More trees give steadier answers, but the gain is tiny after about 200. |
| `max_depth` | **10** (tried 6, 10, none) | Limits how detailed each tree gets, so it does not memorise the training data. |
| `min_samples_leaf` | **1** (tried 1, 3, 5) | The data is clean, so allowing small groups worked best. |
| `max_features` | **sqrt** (tried sqrt, 0.5) | Each split looks at only a few features. This makes the trees different from each other, which helps the voting. |
| Cross-validation | 5 folds, stratified | Tests each setting five times, so one lucky split cannot fool us. |
| Scoring | macro F1 | Gives Low, Medium and High equal importance. Plain accuracy would hide poor Low/Medium results because High dominates. |
| Test share | 20% | A standard split. 800 test rows is enough to judge the model. |

---

## 6. Results

### 6.1 Scores on the 800 unseen test batches

| Measure | Result | What it means |
|---|---|---|
| Accuracy | 98.62% | 789 of 800 batches got the right label |
| Balanced accuracy | 97.42% | Average success across the three classes |
| Macro F1 | 0.9713 | Combined score for all three classes. Always guessing High gives 0.298. |
| Wrong predictions | 11 of 800 | Mostly Medium confused with High |

### 6.2 Per-class scores

| Class | Precision | Recall | Batches |
|---|---|---|---|
| High | 0.994 | 0.992 | 648 |
| Low | 0.971 | 1.000 | 66 |
| Medium | 0.941 | 0.930 | 86 |

*Precision: when it says "High", how often is it right? Recall: out of all real "High" batches, how many did it find?*

### 6.3 Confusion matrix (rows are real, columns are predicted)

| Real \ Predicted | High | Low | Medium |
|---|---|---|---|
| **High** | 643 | 0 | 5 |
| **Low** | 0 | 66 | 0 |
| **Medium** | 4 | 2 | 80 |

**The most important result:** no batch that was really High was called Low. That is the worst mistake, because it could let spoiled food be sold as fresh.

### 6.4 Is the model memorising? (overfitting check)

| Check | Result |
|---|---|
| Score on training data (macro F1) | 0.9973 |
| Score on test data (macro F1) | 0.9713 |
| Gap | 0.026 (small, so it is fine) |
| 5-fold cross-validation scores | 0.978, 0.962, 0.972, 0.960, 0.969 (average 0.968, spread 0.007) |

The scores are steady across all five slices, so the result is not a lucky split.

### 6.5 What the model pays attention to

| Feature | Importance |
|---|---|
| effectiveTemperatureExposure | 40.8% |
| hoursToExpiry | 20.8% |
| hoursSinceManufacture | 16.1% |
| hoursOnShelf | 7.7% |
| fridgeTemperatureC | 7.2% |
| the other 8 features together | about 7.4% |

It makes sense: heat exposure and time matter most.

---

## 7. How to use the model

```python
import joblib
import pandas as pd

bundle = joblib.load("spoilage_risk_model.pkl")   # always use joblib, not pickle

# Turn the storage type text into a number first
storage_num = bundle["storage_encoder"].transform(["fridge"])[0]

batch = {
    "initialPH": 4.47, "hoursSinceManufacture": 20.5, "hasRefrigerator": 1,
    "storageTypeEnc": storage_num, "ambientTemperatureC": 25.6, "humidityPct": 73.7,
    "fridgeTemperatureC": 6.1, "hoursOnShelf": 4.7, "sellThroughRate": 0.75,
    "effectiveTemperatureExposure": 124.8, "hoursToExpiry": 195.5,
    "volumeKg": 1, "vendorRating": 4.67,
}

row = pd.DataFrame([batch])[bundle["features"]]          # keep the right column order
pred = bundle["model"].predict(row)[0]
print(bundle["label_encoder"].inverse_transform([pred])[0])   # prints: Medium
```

The `.pkl` file is a dictionary with four items:

| Key | What it holds |
|---|---|
| `model` | The trained Random Forest |
| `features` | The 13 feature names in the right order |
| `storage_encoder` | Converts storage text into numbers (backroom = 0, counter = 1, fridge = 2) |
| `label_encoder` | Converts model output back to High / Low / Medium |

**Warning:** open the file with `joblib.load`. `pickle.load` fails on it. Also use the same scikit-learn version in the backend as in Colab (check with `import sklearn; print(sklearn.__version__)`).

---

## 8. Limitations (be upfront about these)

1. **Synthetic data.** The very high score is partly because the labels were produced by a formula, and the model learned that formula. Real vendor data will give lower and more honest scores.
2. **Expired batches are easy.** 887 of the 4,000 batches (22%) have zero hours left, and all are High. They are very easy to predict and lift the score.
3. **Few Low and Medium examples.** Low is 8% and Medium is 11% of the data. The per-class scores for these two are less certain than for High.
4. **Weak features.** `vendorRating`, `sellThroughRate`, `volumeKg` and `storageTypeEnc` barely change the answer (each about 1% or less).
5. **Not connected yet.** The model is trained and saved, but no backend endpoint calls it.

**Improvements for later:** retrain on real spoilage reports or sensor readings, then check again.

---

## 9. How to retrain

1. Put `train_spoilage_model.py` and `b2p_spoilage_risk_data.csv` in the same folder (Colab or your computer).
2. Install the packages: `pip install pandas scikit-learn matplotlib joblib`
3. Run: `python train_spoilage_model.py`

It writes `spoilage_risk_model.pkl`, `spoilage_confusion_matrix.png` and `spoilage_feature_importance.png`.

---

## 10. Questions your instructor may ask

**Why a Random Forest?** It handles mixed data well, needs little tuning, copes with unbalanced classes through `class_weight`, and tells us which features matter.

**98.6% looks too good. Why?** The data is synthetic and its labels come from a formula. That is why the project plans to retrain on real data.

**Why not just use accuracy?** 81% of batches are High. A model that always says High gets 81% accuracy while being useless for Low and Medium. Macro F1 treats all three classes equally.

**What is overfitting, and how did you check it?** It means the model memorises the training data and fails on new data. We compared the training score (0.997) with the test score (0.971) and ran 5-fold cross-validation. The gap is small and the scores are steady.

**What is the worst mistake the model can make?** Calling a High batch Low. It did that 0 times on the test set.

**Why were ID columns left out?** A model that learns "vendor V104 is risky" would not work for a new vendor. We want it to learn from conditions like heat and time.

---

## 11. Glossary

| Term | Meaning |
|---|---|
| Feature | One input column the model looks at |
| Label | The answer we want to predict (Low, Medium, High) |
| Training / test data | Data the model learns from, and data kept hidden to test it |
| Stratified split | A split that keeps the class proportions equal in both parts |
| Overfitting | Memorising the training data instead of learning general rules |
| Cross-validation | Testing the model several times on different slices of the data |
| Precision / recall | Accuracy of a prediction / share of real cases found |
| F1 score | A single number combining precision and recall |
| Macro F1 | The average F1 across all classes, counting each class equally |

---

## 12. References

- scikit-learn, Random Forest: <https://scikit-learn.org/stable/modules/ensemble.html#forest>
- scikit-learn, classification metrics: <https://scikit-learn.org/stable/modules/model_evaluation.html#classification-metrics>
- Idli batter storage study (5 °C vs 30 °C): <https://www.sciencedirect.com/science/article/abs/pii/S2949824424001526>
- BC CDC Fermented Foods Guideline (Dosa & Idli): <https://www.bccdc.ca/resource-gallery/Documents/Educational%20Materials/EH/FPS/Food/Fermented/Fermented%20Foods%20Guideline%20-%203.4%20Dosa%20and%20Idli.pdf>
- Idli batter shelf-life estimation: <https://www.sciencedirect.com/science/article/abs/pii/S0260877422000760>
- Idli batter shelf life and refrigeration practice: <https://pmc.ncbi.nlm.nih.gov/articles/PMC6098797>
