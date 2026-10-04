import joblib
import pandas as pd
import matplotlib.pyplot as plt

from sklearn.ensemble import RandomForestClassifier
from sklearn.dummy import DummyClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split, GridSearchCV, StratifiedKFold, cross_val_score
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    f1_score,
    classification_report,
    confusion_matrix,
    ConfusionMatrixDisplay
)

DATA_FILE = "b2p_spoilage_risk_data.csv"
MODEL_FILE = "spoilage_risk_model.pkl"
RANDOM_STATE = 42

df = pd.read_csv(DATA_FILE)

storage_encoder = LabelEncoder()
df["storageTypeEnc"] = storage_encoder.fit_transform(df["storageType"])

label_encoder = LabelEncoder()
y = label_encoder.fit_transform(df["riskLabel"])

features = [
    "initialPH",
    "hoursSinceManufacture",
    "hasRefrigerator",
    "storageTypeEnc",
    "ambientTemperatureC",
    "humidityPct",
    "fridgeTemperatureC",
    "hoursOnShelf",
    "sellThroughRate",
    "effectiveTemperatureExposure",
    "hoursToExpiry",
    "volumeKg",
    "vendorRating"
]
X = df[features]

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    stratify=y,
    random_state=RANDOM_STATE
)

# Baseline evaluation
baseline = DummyClassifier(strategy="most_frequent").fit(X_train, y_train)
baseline_pred = baseline.predict(X_test)
print(f"Baseline Accuracy: {accuracy_score(y_test, baseline_pred):.3f}")
print(f"Baseline Macro F1: {f1_score(y_test, baseline_pred, average='macro'):.3f}")

# Model tuning
rf = RandomForestClassifier(
    class_weight="balanced",
    random_state=RANDOM_STATE,
    n_jobs=-1
)

param_grid = {
    "n_estimators": [200, 400],
    "max_depth": [6, 10, None],
    "min_samples_leaf": [1, 3, 5],
    "max_features": ["sqrt", 0.5]
}

cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
search = GridSearchCV(
    estimator=rf,
    param_grid=param_grid,
    scoring="f1_macro",
    cv=cv,
    n_jobs=-1,
    verbose=1
)
search.fit(X_train, y_train)

best_params = search.best_params_
model = search.best_estimator_
print(f"Best Parameters: {best_params}")
print(f"Best CV Macro F1: {search.best_score_:.4f}")

# Test set evaluation
y_pred = model.predict(X_test)
class_names = list(label_encoder.classes_)

print(f"Accuracy: {accuracy_score(y_test, y_pred):.4f}")
print(f"Balanced Accuracy: {balanced_accuracy_score(y_test, y_pred):.4f}")
print(f"Macro F1: {f1_score(y_test, y_pred, average='macro'):.4f}")
print("\nClassification Report:\n", classification_report(y_test, y_pred, target_names=class_names, digits=3))

cm = confusion_matrix(y_test, y_pred)
print("Confusion Matrix:\n", pd.DataFrame(cm, index=class_names, columns=class_names))

ConfusionMatrixDisplay(cm, display_labels=class_names).plot(cmap="Blues")
plt.title("Spoilage Risk Confusion Matrix")
plt.savefig("spoilage_confusion_matrix.png", dpi=120, bbox_inches="tight")
plt.close()

# Feature importance
importance = pd.Series(model.feature_importances_, index=features).sort_values(ascending=False)
importance.sort_values().plot(kind="barh", title="Feature Importance")
plt.savefig("spoilage_feature_importance.png", dpi=120, bbox_inches="tight")
plt.close()

# Save model bundle
bundle = {
    "model": model,
    "features": features,
    "storage_encoder": storage_encoder,
    "label_encoder": label_encoder
}
joblib.dump(bundle, MODEL_FILE)
print(f"Saved model to {MODEL_FILE}")
