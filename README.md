# B2P (Batter to Platter)

A batter manufacturer and its partner shops, in three parts:

- **Backend** (`backend/`): FastAPI + MongoDB. Batches, shop stock, batch requests, customer pickup orders, the demand forecast (XGBoost) and spoilage risk (RandomForest).
- **Admin panel** (`admin-web/`): React + Vite, for the manufacturer.
- **Phone app** (`App/`): Expo (SDK 54). One app with a vendor (shop) side and a customer side.

## Setup

You need Python 3.12+, Node.js 20+ and a MongoDB Atlas database.

### 1. Backend

```bash
python -m venv venv
./venv/bin/pip install -r requirements.txt
```

Create `.env` in the project root:

```
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>
AUTH_SECRET=<a long random string>
```

Generate a secret with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Changing it signs everyone out.

In Atlas → Network Access, allow your current IP address, or the backend cannot reach the database.

```bash
./venv/bin/python backend/main.py
```

The backend runs on port 5000 (`http://localhost:5000/` answers `{"status": "ok"}`).

### 2. Admin panel

```bash
cd admin-web
npm install
npm run dev
```

Opens on `http://localhost:5173`. Sign in with a `users` row whose `role` is `admin`.

### 3. Phone app

```bash
cd App
npm install
npx expo start -c
```

Run `npm install` again after every pull: the app's packages (fonts included) change with the code.

Open it in Expo Go (SDK 54) by scanning the QR code.

- **Same network (simplest):** put the phone and the laptop on the same Wi-Fi or hotspot. The app finds the backend on the laptop it loaded from, so no setting is needed.
- **Firewall:** on Linux with `ufw`, let the phone reach the backend and Metro (one-time rule):

  ```bash
  sudo ufw allow 5000/tcp
  sudo ufw allow 8081/tcp
  ```

- **Different networks:** `npx expo start --tunnel` only tunnels the app's code, not the backend. Give the backend a public address (for example a Cloudflare or ngrok tunnel) and set it in `App/.env` as `EXPO_PUBLIC_API_URL`.

If the app says it cannot reach the backend, check that the backend is running, that both devices are on the same network, and the firewall rule above.

### 4. Tests

```bash
./venv/bin/python -m pytest
```

The tests use a throwaway `b2p_test` database on the same cluster and drop it afterwards.

## Configuration

| Setting | Where | Purpose |
|---------|-------|---------|
| `MONGODB_URI` | root `.env` | MongoDB connection string (required). |
| `AUTH_SECRET` | root `.env` | Key that signs login tokens (required for any shared setup). |
| `WEATHER_LAT`, `WEATHER_LON`, `WEATHER_GRID_KEY` | root `.env` | Area for the hourly Open-Meteo forecast (default: Chennai). |
| `VITE_API_URL` | `admin-web/.env` | Backend URL for the admin panel (default `http://localhost:5000`). |
| `EXPO_PUBLIC_API_URL` | `App/.env` | Optional backend URL for the phone app, e.g. a public tunnel. |

Every route except `/`, `/login`, `/customers/login`, `/customers/register` and vendor sign-up (`POST /vendors`) needs `Authorization: Bearer <token>` from a login. Five wrong passwords in 15 minutes lock that login for the rest of the 15 minutes.

`requirements.txt` is pinned: the saved models in `models/` were trained with these library versions and may not load under others. Retrain them with `model_code_and_data/train_*.py` before upgrading scikit-learn or xgboost.

## How stock flows

1. The admin makes a **batch** (product, kg, time made); it is listed for shops to request.
2. A shop **requests** a batch; the admin **assigns** it; the shop **confirms** it arrived.
3. The shop sells it over the counter, or a **customer orders** it for pickup: the kg is held for 2 hours and sold when the shop enters the customer's 4-digit code.
4. Batches **expire** by shelf life (fridge vs room); a background job stamps them every 15 minutes and refreshes every shop's demand forecast.

## Database collections

| Collection | Purpose |
|------------|---------|
| `users`, `customers`, `vendors` | Logins, customer accounts and partner shops |
| `products` | Catalog: name, price, fridge and room shelf life |
| `batches` | Every batch and where it is (factory, assigned, at a shop, sold out, returned, expired) |
| `restock_requests` | Shops' batch requests and the admin's decisions |
| `orders` | Sales, and customer pickup orders (`kind: "pickup"`) |
| `inventory_movement` | Ledger of every sale, used as the forecast's sales history |
| `predictions` | Demand forecasts per shop, product and sales window (also the forecast cache) |
| `logs` | Activity and alerts shown on the admin's Activity page |
| `weather_forecast`, `festival_calendar`, `feature_snapshots` | Forecast inputs |

## Tools

`tools/demo_batches.py` adds sample batches for testing (`--apply`) and removes them again (`--remove`); every demo batch id starts with `DEMO-`.
