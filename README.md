# B2B - B2P (Batter 2 Platter) Platform

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
   python backend/main.py
   ```

   Server runs at `http://localhost:5000`.

## Configuration

| Setting | Where | Purpose |
|---------|-------|---------|
| `AUTH_SECRET` | root `.env` | Key that signs login tokens. Set a long random value before deploying (falls back to one derived from `MONGODB_URI`). |
| `WEATHER_LAT`, `WEATHER_LON`, `WEATHER_GRID_KEY` | root `.env` | Area for the hourly Open-Meteo forecast (default: Chennai, `chennai_central`). |
| `VITE_API_URL` | `admin-web/.env` | Backend URL for the admin panel (default `http://localhost:5000`). |
| `EXPO_PUBLIC_API_URL` | `App/.env` | Backend URL for the mobile app on a physical device. |

Every route except `/`, `/login`, `/customers/login`, `/customers/register` and vendor sign-up (`POST /vendors`) needs `Authorization: Bearer <token>` from a login. The admin panel signs in with a `users` row whose `role` is `admin`.

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
