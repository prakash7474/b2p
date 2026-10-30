import { API_BASE } from "./config";

export type StringMap = Record<string, unknown>;

/** The backend stores UTC without a zone ("2026-10-18T05:48:05"); read it as UTC, not local time. */
export function parseServerDate(value: unknown): Date {
  const text = String(value);
  return new Date(/T[\d:.]+$/.test(text) ? `${text}Z` : text);
}

/** "made 28 Oct, 5:10 AM": how a shop tells its batches apart (no batch codes on screen). */
export function madeLabel(value: unknown): string {
  if (!value) return "";
  const date = parseServerDate(value);
  if (Number.isNaN(date.getTime())) return "";
  return `made ${date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`;
}

export type VendorProfile = StringMap & {
  _id?: string;
  vendor_id?: string | null;
  shop_name?: string;
  email?: string;
  phone?: string;
  status?: string;
  locality_tier?: string;
  location?: {
    latitude?: number | null;
    longitude?: number | null;
    address?: string;
  };
};

export type CustomerProfile = StringMap & {
  _id?: string;
  customer_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  location?: {
    latitude?: number | null;
    longitude?: number | null;
    address?: string;
  };
};

/** A vendor returned by the nearby-stock search (has location + stock). */
export type NearbyVendor = StringMap & {
  _id?: string;
  vendor_id?: string | null;
  shop_name?: string;
  owner_name?: string;
  rating?: number;
  distance_km?: number;
  status?: string;
  location?: {
    latitude?: number | null;
    longitude?: number | null;
    address?: string;
  };
  available_inventory?: StockItem[];
};

/** One product a nearby shop has free to order (held pickup kg already taken off). */
export type StockItem = StringMap & {
  product_id?: string;
  product_name?: string;
  quantity?: number;
  price?: number | null;
  made_at?: string | null;
};

export type PickupOrder = StringMap & {
  order_id: string;
  vendor_id: string;
  shop_name?: string;
  customer_name?: string | null;
  items: { product_name: string; quantity_kg: number; price_per_kg?: number | null; line_total?: number | null }[];
  total: number;
  status: "to_collect" | "collecting" | "collected" | "expired";
  pickup_code: string;
  created_at: string;
  hold_until: string;
};

export type CustomerLocation = {
  latitude: number;
  longitude: number;
  address?: string;
};

export type BatchChip = {
  batch_id?: string;
  remaining_kg?: number;
  status?: string;
  received_at?: string | null;
  expired?: boolean;
  hours_to_expiry?: number;
};

export type ForecastItem = {
  product_name?: string;
  model_product?: string;
  predicted_demand?: number;
  safety_stock?: number;
  recommended_stock?: number;
  current_stock?: number;
  deficit?: number;
  refill_quantity?: number;
  restock_needed?: boolean;
  status?: string;
  has_sales_history?: boolean;
  /** Where the history inputs came from: real sales, a pipeline snapshot, or the new-shop baseline. */
  history_source?: "sales" | "snapshot" | "baseline";
  /** kg in this shop's pending batch requests. */
  requested_kg?: number;
  /** Available batches that would cover the refill, freshest first. */
  suggested_batches?: BatchChip[];
  suggested_kg?: number;
  /** Refill kg no available batch can cover yet. */
  uncovered_kg?: number;
};

export type ForecastSummary = {
  predicted_demand: number;
  recommended_stock: number;
  current_stock: number;
  requested_kg: number;
  refill_quantity: number;
  products_to_restock: number;
};

/** A batch held by the vendor, with its stock state and model spoilage risk. */
export type VendorBatch = StringMap & {
  batch_id?: string;
  product_name?: string;
  status?: string;
  volume_kg?: number;
  remaining_kg?: number;
  threshold_kg?: number;
  low_stock?: boolean;
  received_at?: string | null;
  manufactured_at?: string | null;
  expires_at?: string | null;
  risk_score?: number;
  risk_label?: "Low" | "Medium" | "High";
  probabilities?: Record<string, number>;
  action?: string;
  hours_to_expiry?: number;
  expired?: boolean;
};

export type ShopAlert = {
  kind: "expired" | "expiring" | "low" | "below_forecast" | "awaiting";
  level: "danger" | "warning" | "info";
  text: string;
};

export type AvailableBatch = StringMap & {
  batch_id?: string;
  product_name?: string;
  remaining_kg?: number;
  manufactured_at?: string | null;
};

export type RiskReport = {
  evaluations: VendorBatch[];
  aggregateScore: number | null;
  aggregateLabel: string | null;
  message?: string;
};

export type DemandRequest = StringMap & {
  _id?: string;
  vendor_id?: string;
  priority?: string;
  status?: string;
  admin_notes?: string;
  created_at?: string;
  items?: {
    batch_id?: string;
    product_id?: string;
    product_name?: string;
    quantity?: number;
  }[];
};

export type ActivityLog = StringMap & {
  _id?: string;
  message?: string;
  action?: string;
  created_at?: string;
  timestamp?: string;
};

let authToken = "";
let onUnauthorized: (() => void) | null = null;

/** Bearer token sent with every request (set on sign-in, cleared on sign-out). */
export function setAuthToken(token: string, onExpired: (() => void) | null = null) {
  authToken = token;
  onUnauthorized = onExpired;
}

/**
 * The backend is a plain FastAPI app that often answers 200 with an
 * `{ "error": ... }` body, so failures are normalized here into thrown
 * Errors that screens can render directly.
 */
async function request<T = StringMap>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new Error(
      `Cannot reach the backend at ${API_BASE}. Start it with: python backend/main.py`,
    );
  }

  let data: T | null = null;
  try {
    data = (await response.json()) as T;
  } catch {
    data = null;
  }

  if (!response.ok) {
    // Expired or missing token: drop the session so the app returns to login.
    if (response.status === 401 && authToken) onUnauthorized?.();
    const payload = data as StringMap | null;
    const message =
      (payload?.detail as string) ||
      (payload?.error as string) ||
      `Request failed: ${response.status}`;
    throw new Error(message);
  }

  if (data && typeof data === "object" && "error" in data) {
    const error = (data as StringMap).error;
    if (error) throw new Error(String(error));
  }

  return data as T;
}

export const api = {
  // ---- auth ----------------------------------------------------------
  async login(login: string, password: string) {
    const data = await request<{
      message?: string;
      user_id: string;
      role?: string;
      email?: string;
      vendor_id?: string | null;
      token: string;
    }>(
      "/login",
      { method: "POST", body: { login, password } },
    );

    if (!data?.user_id) {
      throw new Error("Login failed. No user was returned.");
    }

    return data;
  },

  createVendor(payload: StringMap) {
    return request<{ message?: string; vendor?: VendorProfile }>("/vendors", {
      method: "POST",
      body: payload,
    });
  },

  // ---- customer auth -------------------------------------------------
  /**
   * POST /customers/login — with a location the backend saves it on the
   * customer and returns `nearby_vendors` (vendors that have stock and
   * a geo location within `radius_meters`).
   */
  async customerLogin(login: string, password: string, location?: CustomerLocation) {
    const data = await request<{
      message?: string;
      customer?: CustomerProfile;
      nearby_vendors?: NearbyVendor[];
      token: string;
    }>("/customers/login", {
      method: "POST",
      body: { login, password, location },
    });

    if (!data?.customer && !data?.message) {
      throw new Error("Login failed. No customer was returned.");
    }

    return data;
  },

  customerRegister(payload: StringMap) {
    return request<{ message?: string; customer?: CustomerProfile }>("/customers/register", {
      method: "POST",
      body: payload,
    });
  },

  /** GET /vendors with coordinates = nearby-stock geo search. */
  async getNearbyVendors(latitude: number, longitude: number, radiusMeters: number) {
    const data = await request<{ vendors?: NearbyVendor[] }>(
      `/vendors?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(
        longitude,
      )}&radius_meters=${encodeURIComponent(radiusMeters)}`,
    );
    return data?.vendors ?? [];
  },

  // ---- profile -------------------------------------------------------
  async getVendor(vendorKey: string): Promise<VendorProfile | null> {
    try {
      const data = await request<{ vendor?: VendorProfile }>(
        `/vendors/${encodeURIComponent(vendorKey)}`,
      );
      return data?.vendor ?? null;
    } catch {
      return null;
    }
  },

  async getUser(vendorKey: string): Promise<VendorProfile | null> {
    try {
      const data = await request<{ user?: VendorProfile }>(
        `/users/${encodeURIComponent(vendorKey)}`,
      );
      return data?.user ?? null;
    } catch {
      return null;
    }
  },

  // ---- features ------------------------------------------------------
  async getBatches(vendorKey: string) {
    const data = await request<{ batches?: VendorBatch[] }>(
      `/vendors/${encodeURIComponent(vendorKey)}/batches`,
    );
    return data?.batches ?? [];
  },

  async getForecast(vendorKey: string) {
    const data = await request<{
      forecast?: ForecastItem[];
      summary?: ForecastSummary;
      window?: { date: string; label: string };
      message?: string;
    }>(`/vendors/${encodeURIComponent(vendorKey)}/demand-forecast`);
    return { forecast: data?.forecast ?? [], summary: data?.summary, window: data?.window, message: data?.message };
  },

  /** The shop's stock alerts, problems first (same rules as the admin's Inventory page). */
  async getAlerts(vendorKey: string): Promise<ShopAlert[]> {
    const data = await request<{ alerts?: ShopAlert[] }>(`/vendors/${encodeURIComponent(vendorKey)}/alerts`);
    return data.alerts ?? [];
  },

  async getRisk(vendorKey: string): Promise<RiskReport> {
    const data = await request<{
      evaluations?: VendorBatch[];
      aggregate_risk_score?: number | null;
      aggregate_risk_label?: string | null;
      message?: string;
    }>(`/vendors/${encodeURIComponent(vendorKey)}/spoilage-risk`);
    return {
      evaluations: data?.evaluations ?? [],
      aggregateScore: data?.aggregate_risk_score ?? null,
      aggregateLabel: data?.aggregate_risk_label ?? null,
      message: data?.message,
    };
  },

  /** Batches the admin has exposed for vendors to request. */
  async getAvailableBatches() {
    const data = await request<{ batches?: AvailableBatch[] }>(
      "/batches?status=available&exposed=true",
    );
    return data?.batches ?? [];
  },

  async getDemands(vendorKey: string) {
    const data = await request<{ restock_requests?: DemandRequest[] }>(
      `/restock-requests?vendor_id=${encodeURIComponent(vendorKey)}`,
    );
    return data?.restock_requests ?? [];
  },

  requestBatch(vendorKey: string, batchId: string) {
    return request<{ message?: string; demand_id?: string }>(
      `/vendors/${encodeURIComponent(vendorKey)}/demands`,
      { method: "POST", body: { items: [{ batch_id: batchId }] } },
    );
  },

  receiveBatch(vendorKey: string, batchId: string) {
    return request<{ message?: string }>(
      `/vendors/${encodeURIComponent(vendorKey)}/batches/${encodeURIComponent(batchId)}/receive`,
      { method: "POST" },
    );
  },

  /** Same endpoint a customer purchase uses; deducts kg from the batch. */
  recordSale(vendorKey: string, batchId: string, quantityKg: number) {
    return request<{ message?: string; alerts?: { alert_message?: string }[] }>("/orders", {
      method: "POST",
      body: { vendor_id: vendorKey, batch_id: batchId, quantity_kg: quantityKg },
    });
  },

  /** Send back (or write off) a held batch, e.g. expired or high risk. */
  returnBatch(vendorKey: string, batchId: string, reason: string) {
    return request<{ message?: string; returned_kg?: number }>(
      `/vendors/${encodeURIComponent(vendorKey)}/batches/${encodeURIComponent(batchId)}/return`,
      { method: "POST", body: { reason } },
    );
  },

  /** Customer: order from one shop to collect and pay there; the kg is held for a while. */
  async placeOrder(vendorKey: string, items: { product_name: string; quantity_kg: number }[]) {
    const data = await request<{ order: PickupOrder }>("/customer-orders", {
      method: "POST",
      body: { vendor_id: vendorKey, items },
    });
    return data.order;
  },

  async getMyOrders() {
    const data = await request<{ orders?: PickupOrder[] }>("/customer-orders");
    return data.orders ?? [];
  },

  /** Shop: customer orders waiting to be collected, oldest first. */
  async getPickups(vendorKey: string) {
    const data = await request<{ orders?: PickupOrder[] }>(`/vendors/${encodeURIComponent(vendorKey)}/pickups`);
    return data.orders ?? [];
  },

  collectPickup(vendorKey: string, orderId: string, code: string) {
    return request<{ message?: string }>(
      `/vendors/${encodeURIComponent(vendorKey)}/pickups/${encodeURIComponent(orderId)}/collect`,
      { method: "POST", body: { code } },
    );
  },

  async getLogs() {
    const data = await request<{ logs?: ActivityLog[] }>("/logs");
    return data?.logs ?? [];
  },
};
