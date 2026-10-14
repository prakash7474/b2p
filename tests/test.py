
import os
import requests

BASE_URL = "http://localhost:5000"

VENDOR_ID = os.getenv("TEST_VENDOR_ID", "V100")


def test_inventory():
    url = f"{BASE_URL}/vendors/{VENDOR_ID}/inventory"

    response = requests.get(url)

    print("\nGET INVENTORY")
    print(response.status_code)
    print(response.json())

    return response.json()


def raise_demand(product_id, quantity):
    url = f"{BASE_URL}/vendors/{VENDOR_ID}/demands"

    data = {
        "items": [
            {
                "product_id": product_id,
                "quantity": quantity
            }
        ],
        "priority": "normal"
    }

    response = requests.post(url, json=data)

    print("\nRAISE DEMAND")
    print(response.status_code)
    print(response.json())

    return response.json()


def get_demands():
    url = f"{BASE_URL}/vendors/{VENDOR_ID}/demands"

    response = requests.get(url)

    print("\nGET DEMANDS")
    print(response.status_code)
    print(response.json())

    return response.json()


def confirm_demand(demand_id):
    url = (
        f"{BASE_URL}/vendors/{VENDOR_ID}"
        f"/demands/{demand_id}/confirm"
    )

    response = requests.post(url)

    print("\nCONFIRM DEMAND")
    print(response.status_code)
    print(response.json())

    return response.json()


def sync_inventory():
    url = f"{BASE_URL}/vendors/{VENDOR_ID}/inventory/sync"

    response = requests.post(url)

    print("\nSYNC INVENTORY")
    print(response.status_code)
    print(response.json())

    return response.json()


# ============================================================
# RUN TEST
# ============================================================

print("================================")
print("VENDOR API TEST")
print("================================")

# 1. Check existing inventory
inv_result = test_inventory()

# Auto-detect existing inventory product, or fallback to P001
inventory_list = inv_result.get("inventory", [])
PRODUCT_ID = inventory_list[0].get("product_id") if inventory_list else "P001"

# 2. Raise demand
demand_response = raise_demand(
    PRODUCT_ID,
    10
)

# 3. Get demand ID
if "demand_id" in demand_response:

    demand_id = demand_response["demand_id"]

    # 4. Get all demands
    get_demands()

    # 5. Confirm demand
    confirm_demand(demand_id)

    # 6. Synchronize inventory
    sync_inventory()

    # 7. Check inventory after sync
    test_inventory()

else:
    print("\nDemand was not created.")

