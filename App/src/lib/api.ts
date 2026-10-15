import { API_BASE } from "./config";

export type StringMap = Record<string, unknown>;

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

export type BatchChip = {
  batch_id?: string;
  remaining_kg?: number;
  status?: string;
  received_at?: string | null;
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
  batches?: BatchChip[];
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
  expires_at?: string | null;
  risk_score?: number;
  risk_label?: "Low" | "Medium" | "High";
  probabilities?: Record<string, number>;
  action?: string;
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
      headers: { "Content-Type": "application/json" },
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
    const data = await request<{ message?: string; user_id: string; role?: string; email?: string }>(
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
    const data = await request<{ forecast?: ForecastItem[]; message?: string }>(
      `/vendors/${encodeURIComponent(vendorKey)}/demand-forecast`,
    );
    return { forecast: data?.forecast ?? [], message: data?.message };
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

  async getLogs() {
    const data = await request<{ logs?: ActivityLog[] }>("/logs");
    return data?.logs ?? [];
  },
};
