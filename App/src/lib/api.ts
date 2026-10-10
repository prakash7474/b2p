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

export type InventoryItem = StringMap & {
  _id?: string;
  product_id?: string;
  product_name?: string;
  quantity?: number;
  reorder_level?: number;
  minimum_stock?: number;
  threshold?: number;
};

export type ForecastItem = {
  product_name?: string;
  predicted_demand?: number;
  safety_stock?: number;
  current_stock?: number;
  recommended_order?: number;
};

export type RiskEvaluation = StringMap & {
  batch_id?: string;
  product_name?: string;
  risk_label?: string;
  probabilities?: Record<string, number>;
  action?: string;
};

export type DemandRequest = StringMap & {
  _id?: string;
  vendor_id?: string;
  priority?: string;
  status?: string;
  items?: {
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
  async getInventory(vendorKey: string) {
    const data = await request<{ inventory?: InventoryItem[] }>(
      `/vendors/${encodeURIComponent(vendorKey)}/inventory`,
    );
    return data?.inventory ?? [];
  },

  async getForecast(vendorKey: string) {
    const data = await request<{ forecast?: ForecastItem[] }>(
      `/vendors/${encodeURIComponent(vendorKey)}/demand-forecast`,
    );
    return data?.forecast ?? [];
  },

  async getRisk(vendorKey: string) {
    const data = await request<{ evaluations?: RiskEvaluation[]; message?: string }>(
      `/vendors/${encodeURIComponent(vendorKey)}/spoilage-risk`,
    );
    return { evaluations: data?.evaluations ?? [], message: data?.message };
  },

  async getDemands(vendorKey: string) {
    const data = await request<{ restock_requests?: DemandRequest[] }>(
      `/restock-requests?vendor_id=${encodeURIComponent(vendorKey)}`,
    );
    return data?.restock_requests ?? [];
  },

  createDemand(vendorKey: string, payload: StringMap) {
    return request<{ message?: string; demand_id?: string }>(
      `/vendors/${encodeURIComponent(vendorKey)}/demands`,
      { method: "POST", body: payload },
    );
  },

  confirmDemand(vendorKey: string, demandId: string) {
    return request<{ message?: string }>(
      `/vendors/${encodeURIComponent(vendorKey)}/demands/${encodeURIComponent(demandId)}/confirm`,
      { method: "POST" },
    );
  },

  syncInventory(vendorKey: string) {
    return request<{ message?: string; synced_demands?: number }>(
      `/vendors/${encodeURIComponent(vendorKey)}/inventory/sync`,
      { method: "POST" },
    );
  },

  async getLogs() {
    const data = await request<{ logs?: ActivityLog[] }>("/logs");
    return data?.logs ?? [];
  },
};
