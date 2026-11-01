import json
import joblib
import pandas as pd
import matplotlib.pyplot as plt

from sklearn.dummy import DummyClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    f1_score,
    classification_report,
    confusion_matrix,
    ConfusionMatrixDisplay
)

# Scores the deployed model on the same test split as train_spoilage_model.py, without
# retraining it, so the saved metrics and plots describe the model the backend serves.
DATA_FILE = "b2p_spoilage_risk_data.csv"
MODEL_FILE = "../models/spoilage_risk_model.pkl"
RANDOM_STATE = 42

bundle = joblib.load(MODEL_FILE)
model, features = bundle["model"], bundle["features"]
label_encoder = bundle["label_encoder"]

df = pd.read_csv(DATA_FILE)
df["storageTypeEnc"] = bundle["storage_encoder"].transform(df["storageType"])
y = label_encoder.transform(df["riskLabel"])
X_train, X_test, y_train, y_test = train_test_split(
    df[features], y, test_size=0.20, stratify=y, random_state=RANDOM_STATE
)

baseline_pred = DummyClassifier(strategy="most_frequent").fit(X_train, y_train).predict(X_test)
y_pred = model.predict(X_test)
class_names = list(label_encoder.classes_)
cm = confusion_matrix(y_test, y_pred)

print(f"Accuracy: {accuracy_score(y_test, y_pred):.4f}")
print(f"Balanced Accuracy: {balanced_accuracy_score(y_test, y_pred):.4f}")
print(f"Macro F1: {f1_score(y_test, y_pred, average='macro'):.4f}")
print("\nClassification Report:\n", classification_report(y_test, y_pred, target_names=class_names, digits=3))
print("Confusion Matrix:\n", pd.DataFrame(cm, index=class_names, columns=class_names))

ConfusionMatrixDisplay(cm, display_labels=class_names).plot(cmap="Greens")
plt.title(f"Spoilage risk: confusion matrix (test set, n={len(y_test)})")
plt.savefig("spoilage_confusion_matrix.png", dpi=120, bbox_inches="tight")
plt.close()

importance = pd.Series(model.feature_importances_, index=features).sort_values(ascending=False)
importance.sort_values().plot(kind="barh", title="Spoilage risk: feature importance")
plt.savefig("spoilage_feature_importance.png", dpi=120, bbox_inches="tight")
plt.close()

params = model.get_params()
with open("spoilage_metrics.json", "w") as f:
    json.dump({
        "model": {
            "Accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
            "Balanced_Accuracy": round(float(balanced_accuracy_score(y_test, y_pred)), 4),
            "Macro_F1": round(float(f1_score(y_test, y_pred, average="macro")), 4),
        },
        "baseline": {
            "Accuracy": round(float(accuracy_score(y_test, baseline_pred)), 4),
            "Macro_F1": round(float(f1_score(y_test, baseline_pred, average="macro")), 4),
        },
        "per_class": classification_report(y_test, y_pred, target_names=class_names, output_dict=True),
        "confusion_matrix": {"labels": class_names, "rows": cm.tolist()},
        "model_params": {k: params[k] for k in ["n_estimators", "max_depth", "min_samples_leaf", "max_features", "class_weight"]},
    }, f, indent=2)
print("Saved spoilage_metrics.json and plots")
