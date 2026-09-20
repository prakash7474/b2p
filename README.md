# B2B - B2P (Business-to-Partner) Platform

A FastAPI backend for managing vendors, products, inventory, orders, and restocking for a partner shop network.

## Setup

1. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

2. Create a `.env` file in the project root with your MongoDB connection string:
   ```
   MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>
   ```

3. Run the server:
   ```
   python backend/test.py
   ```

   Server runs at `http://localhost:5000`.

## API Endpoints

| Method | Path   | Description              |
|--------|--------|--------------------------|
| GET    | `/`    | List all collections     |
| GET    | `/users` | Get all users from DB  |

## Database Collections

| Collection           | Purpose                                          |
|----------------------|--------------------------------------------------|
| `vendors`            | Partner shop profiles (owner, location, tier)    |
| `products`           | Products catalog (Idli Batter, Dosa Batter, etc.)|
| `batches`            | Manufactured batches with pH, volume, status     |
| `inventory`          | Current shop inventory records                   |
| `orders`             | Completed store orders and sales                 |
| `order_items`        | Individual line items in orders                  |
| `logs`               | Activity and alert logs (audit trail)            |
| `restock_requests`   | Pending restock requests from shops              |
| `predictions`        | ML prediction inference logs                     |
| `inventory_movement` | Ledger of every stock in/out movement            |
| `weather_forecast`   | Temperature and rain probability                 |
| `festival_calendar`  | Holiday calendar for demand spikes               |
| `feature_snapshots`  | Cached pre-computed ML feature rows              |

## Tech Stack

- **Backend:** FastAPI, Uvicorn
- **Database:** MongoDB (via PyMongo)
- **Config:** python-dotenv
