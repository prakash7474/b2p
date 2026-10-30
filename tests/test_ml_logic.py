"""
Offline checks for the ML glue in backend/ml.py (no MongoDB needed):
history features match the training CSV, sales are bucketed into the
model's morning/evening slots, and expired batches are detected.

Run with:  pytest tests/test_ml_logic.py
"""

import datetime
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import backend.main as main
import backend.ml as ml  # loaded by main; holds the ML helpers


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, *args, **kwargs):
        return list(self.docs)


def to_utc(local):
    """Naive local time -> naive UTC, the way the backend stores timestamps."""
    return local.astimezone(datetime.timezone.utc).replace(tzinfo=None)


def test_history_features_match_training_csv():
    df = pd.read_csv(ROOT / "model_code_and_data" / "b2p_demand_forecasting_data.csv")
    rows = df[(df.vendorId == "V100") & (df.productId == "Idly_Batter")].sort_values(["date", "window_order"])
    sales = list(rows.unitsSoldNextWindow)
    for i in (56, 80, 150, len(rows) - 1):
        expected = rows.iloc[i]
        got = ml._history_features(sales[:i])
        for name in ml.HISTORY_FEATURES:
            assert got[name] == pytest.approx(expected[name], rel=1e-6), (i, name)


def test_history_features_with_one_slot_of_history():
    got = ml._history_features([3.0])
    assert got == {"lag1": 3.0, "lag7": 0.0, "sameSlot4WeekMean": 0.0,
                   "rolling7DayMean": 3.0, "rolling7DayStd": 0.0, "recentTrend": 1.0}


def test_sales_series_buckets_slots_and_stops_before_current(monkeypatch):
    day = datetime.date(2026, 10, 1)
    at = lambda d, hour: to_utc(datetime.datetime.combine(day + datetime.timedelta(days=d), datetime.time(hour)))
    moves = [
        {"productId": "P1", "movementType": "sale", "quantity": 2, "occurredAt": at(0, 9)},
        {"productId": "P1", "movementType": "sale", "quantity": 3, "occurredAt": at(0, 11)},
        {"productId": "P1", "movementType": "sale", "quantity": 1, "occurredAt": at(0, 19)},
        {"productId": "P1", "movementType": "sale", "quantity": 4, "occurredAt": at(1, 18)},
        {"productId": "P1", "movementType": "sale", "quantity": 9, "occurredAt": at(2, 9)},  # current slot
        {"productId": "P9", "movementType": "sale", "quantity": 7, "occurredAt": at(0, 9)},  # not a model product
    ]
    monkeypatch.setitem(main.COLS, "inventory_movement", FakeCollection(moves))
    monkeypatch.setitem(main.COLS, "products", FakeCollection([{"product_id": "P1", "product_name": "Idli Batter"}]))

    series = ml._sales_series({"vendor_id": "V1"}, (day + datetime.timedelta(days=2), 0))

    # day0 morning, day0 evening, day1 morning (no sales), day1 evening
    assert series == {"Idly_Batter": [5.0, 1.0, 0.0, 4.0]}


def test_expiry_depends_on_fridge(monkeypatch):
    monkeypatch.setitem(main.COLS, "products", FakeCollection([]))  # default shelf life: 72h fridge / 24h room
    main._forget_catalog()
    batch = {"product_name": "Idli Batter",
             "manufactured_at": datetime.datetime.utcnow() - datetime.timedelta(hours=30)}

    assert ml._hours_to_expiry({"hasRefrigerator": False}, batch) <= 0
    assert ml._hours_to_expiry({"hasRefrigerator": True}, batch) == pytest.approx(42, abs=0.1)
