import { useEffect, useMemo, useState } from "react";

import {
  LayoutDashboard,
  Store,
  Package,
  Warehouse,
  RefreshCw,
  FileText,
  Search,
  AlertTriangle,
  CheckCircle2,
  Menu,
  X,
  ChevronRight,
  TrendingUp,
  ShieldAlert,
  Brain,
  Thermometer,
  ShoppingCart,
  Eye,
  EyeOff,
  Boxes,
  CalendarDays,
  Bell,
  LogOut
} from "lucide-react";

import "./App.css";

// Set VITE_API_URL in admin-web/.env to reach a backend that is not on this machine.
const API = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");

// The admin token lives in this browser only; a missing or expired one shows the login screen.
const TOKEN_KEY = "b2p.admin.token";
const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
};
const saveToken = (value) => {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: the session lasts until the tab closes.
  }
};
let authToken = readToken();
let onSignedOut = () => {};

const getValue = (obj, keys, fallback = "") => {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  }
  return fallback;
};

// Seed vendors store verificationStatus, app-created ones store status.
const vendorStatus = (vendor) =>
  getValue(vendor, ["status", "verificationStatus"], "pending");

// Inventory rows use minimumStock (seed) or minimum_stock.
const reorderLevel = (item) =>
  Number(getValue(item, ["reorder_level", "minimumStock", "minimum_stock", "threshold"], 10));

// The backend stores UTC without a zone ("2026-10-18T05:48:05"); read it as UTC, not local time.
const parseServerDate = (value) => {
  const text = String(value);
  return new Date(/T[\d:.]+$/.test(text) ? `${text}Z` : text);
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = parseServerDate(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};

// Spoilage score bands, same as the backend: <=30 Low, 30-70 Medium, >70 High.
const riskColor = (label) =>
  label === "High" ? "#c94c4c" : label === "Medium" ? "#c47a18" : "#2f855a";

const formatStatus = (status) =>
  String(status || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const statusClass = (status) => {
  const value = String(status || "").toLowerCase();

  if (
    ["active", "approved", "confirmed", "synchronized", "success", "completed"].includes(value)
  ) {
    return "status status-success";
  }

  if (["pending", "requested", "processing", "normal"].includes(value)) {
    return "status status-warning";
  }

  if (["rejected", "cancelled", "failed", "inactive", "high"].includes(value)) {
    return "status status-danger";
  }

  if (["medium"].includes(value)) {
    return "status status-warning";
  }

  return "status status-neutral";
};

async function request(url, options = {}) {
  const response = await fetch(`${API}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
    }
  });

  if (response.status === 401 && authToken) {
    authToken = "";
    saveToken("");
    onSignedOut();
  }

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;

    try {
      const data = await response.json();
      message = data.detail || data.error || message;
    } catch {
      const text = await response.text();
      if (text) message = text;
    }

    throw new Error(message);
  }

  return response.json();
}

function Sidebar({ page, setPage, open, setOpen, demands }) {
  const items = [
    {
      title: "Overview",
      links: [["dashboard", "Dashboard", LayoutDashboard]]
    },
    {
      title: "Management",
      links: [
        ["vendors", "Vendors", Store],
        ["products", "Products", Package],
        ["batches", "Batches", Boxes],
        ["inventory", "Inventory", Warehouse]
      ]
    },
    {
      title: "Operations",
      links: [
        ["demands", "Batch Requests", FileText],
        ["orders", "Orders", ShoppingCart],
        ["alerts", "Stock Alerts", Bell]
      ]
    },
    {
      title: "AI Intelligence",
      links: [
        ["forecast", "Demand Forecast", TrendingUp],
        ["spoilage", "Spoilage Risk", ShieldAlert],
        ["festivals", "Festival Calendar", CalendarDays]
      ]
    },
    {
      title: "System",
      links: [["activity", "Activity", FileText]]
    }
  ];

  return (
    <>
      {open && <div className="mobile-overlay" onClick={() => setOpen(false)} />}

      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-logo">B2</div>
          <div className="brand-text">
            <h2>B2P</h2>
            <span>Manufacturer Portal</span>
          </div>

          <button className="mobile-close" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {items.map((section) => (
          <div className="nav-section" key={section.title}>
            <div className="nav-title">{section.title}</div>

            {section.links.map(([id, label, Icon]) => (
              <button
                key={id}
                className={`nav-item ${page === id ? "active" : ""}`}
                onClick={() => {
                  setPage(id);
                  setOpen(false);
                }}
              >
                <Icon size={17} />
                <span>{label}</span>

                {id === "demands" && demands.some((d) => d.status === "pending") && (
                  <span className="nav-badge">NEW</span>
                )}
              </button>
            ))}
          </div>
        ))}

        <div className="backend-status">
          <div className="backend-dot" />
          <div>
            <strong>Backend Connected</strong>
            <span>{API.replace(/^https?:\/\//, "")}</span>
          </div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ title, setOpen, onSignOut }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="menu-btn" onClick={() => setOpen(true)}>
          <Menu size={20} />
        </button>

        <div>
          <div className="topbar-brand">B2POnline</div>
          <div className="topbar-subtitle">MANUFACTURER PORTAL</div>
        </div>
      </div>

      <div className="topbar-right">
        <span className="online-dot" />
        <span>System Online</span>
        <strong>{title}</strong>
        <button className="secondary-btn small-btn" onClick={onSignOut}>
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </header>
  );
}

function StatCard({ icon: Icon, title, value, text }) {
  return (
    <div className="dashboard-stat">
      <div className="dashboard-stat-icon">
        <Icon size={19} />
      </div>

      <div className="dashboard-stat-label">{title}</div>

      <div className="dashboard-stat-value">
        <strong>{value}</strong>
        <span>{text}</span>
      </div>
    </div>
  );
}

function Dashboard({
  vendors,
  products,
  inventory,
  demands,
  logs,
  setPage,
  refresh
}) {
  const pendingVendors = vendors.filter(
    (v) => String(vendorStatus(v)).toLowerCase() === "pending"
  ).length;

  const lowStock = inventory.filter((item) => {
    const quantity = Number(
      getValue(item, ["quantity", "stock", "available_quantity"], 0)
    );
    return quantity <= reorderLevel(item);
  }).length;

  const pendingDemands = demands.filter((d) => {
    const value = String(getValue(d, ["status"])).toLowerCase();
    return !["synchronized", "completed", "cancelled"].includes(value);
  }).length;

  return (
    <div>
      <div className="dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p>A compact view of your manufacturing operations</p>
        </div>

        <button className="refresh-btn" onClick={refresh}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      <div className="dashboard-stats">
        <StatCard
          icon={Store}
          title="Vendors"
          value={vendors.length}
          text={`${pendingVendors} pending`}
        />
        <StatCard
          icon={Package}
          title="Products"
          value={products.length}
          text="Catalog items"
        />
        <StatCard
          icon={Warehouse}
          title="Inventory"
          value={inventory.length}
          text={`${lowStock} low stock`}
        />
        <StatCard
          icon={FileText}
          title="Open Requests"
          value={pendingDemands}
          text={`${demands.length} total requests`}
        />
      </div>

      <div className="dashboard-main-grid">
        <section className="dashboard-section">
          <h2>Batch Request Queue</h2>
          <p>Latest vendor batch requests</p>

          <div className="dashboard-card">
            {demands.length === 0 ? (
              <div className="demand-empty">
                <FileText size={25} />
                <p>No batch requests found.</p>
                <button
                  className="open-demand-btn"
                  onClick={() => setPage("demands")}
                >
                  Open batch requests <ChevronRight size={13} />
                </button>
              </div>
            ) : (
              <div className="queue-list">
                {demands.slice(0, 5).map((demand, index) => {
                  const vendor = getValue(
                    demand,
                    ["vendor_id", "vendorId", "vendor"],
                    "Unknown"
                  );
                  const value = getValue(demand, ["status"], "pending");

                  return (
                    <div
                      className="queue-item"
                      key={demand._id || demand.id || index}
                    >
                      <div className="queue-main">
                        <div className="queue-title">Vendor {vendor}</div>
                        <div className="queue-subtitle">
                          {getValue(demand, ["priority"], "normal")} priority
                        </div>
                      </div>

                      <div className="queue-right">
                        <span className={statusClass(value)}>
                          {formatStatus(value)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="dashboard-section">
          <h2>System Snapshot</h2>
          <p>Current module counts</p>

          <div className="dashboard-card">
            <SnapshotRow icon={Store} label="Vendors" value={vendors.length} />
            <SnapshotRow icon={Package} label="Products" value={products.length} />
            <SnapshotRow
              icon={Warehouse}
              label="Inventory"
              value={inventory.length}
            />
            <SnapshotRow
              icon={RefreshCw}
              label="Batch Requests"
              value={demands.length}
            />
            <SnapshotRow icon={FileText} label="Activity" value={logs.length} />
          </div>
        </section>
      </div>

      <section className="dashboard-section activity-section">
        <h2>Recent Activity</h2>
        <p>Latest events recorded by the backend</p>

        <div className="activity-card">
          {logs.length === 0 ? (
            <div className="empty-state">No activity found.</div>
          ) : (
            <div className="activity-list">
              {logs.slice(0, 6).map((log, index) => (
                <div
                  className="activity-item"
                  key={log._id || log.id || index}
                >
                  <div className="activity-icon">
                    <FileText size={14} />
                  </div>
                  <div>
                    <div className="activity-text">
                      {getValue(
                        log,
                        ["message", "action", "event", "description"],
                        "System activity recorded"
                      )}
                    </div>
                    <div className="activity-time">
                      {getValue(
                        log,
                        ["created_at", "timestamp", "time"],
                        ""
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SnapshotRow({ icon: Icon, label, value }) {
  return (
    <div className="snapshot-row">
      <div className="snapshot-left">
        <Icon size={16} />
        {label}
      </div>
      <span className="snapshot-count">{value}</span>
    </div>
  );
}

function Vendors({ vendors, search, setSearch, refresh }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  const setStatus = async (vendor, status) => {
    const id = getValue(vendor, ["vendor_id", "_id"], "");
    try {
      setBusy(id);
      const data = await request(`/vendors/${id}/status`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      setMessage(data.error || data.message);
      await refresh();
    } catch (error) {
      setMessage(error.message || "Unable to update vendor.");
    } finally {
      setBusy("");
    }
  };

  const filtered = vendors.filter((vendor) =>
    JSON.stringify(vendor).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageLayout
      title="Vendors"
      subtitle="Manage registered vendors"
      search={search}
      setSearch={setSearch}
    >
      {message && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          {message}
        </div>
      )}

      <div className="table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Vendor ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((vendor, index) => {
                const status = vendorStatus(vendor);

                return (
                  <tr key={vendor._id || vendor.id || index}>
                    <td>
                      {getValue(
                        vendor,
                        ["vendor_id", "vendorId", "id", "_id"],
                        "-"
                      )}
                    </td>
                    <td>
                      {getValue(
                        vendor,
                        ["shop_name", "name", "vendor_name", "business_name"],
                        "-"
                      )}
                    </td>
                    <td>{getValue(vendor, ["email"], "-")}</td>
                    <td>{getValue(vendor, ["phone", "mobile"], "-")}</td>
                    <td>
                      <span className={statusClass(status)}>
                        {formatStatus(status)}
                      </span>
                    </td>
                    <td>
                      <div className="action-buttons">
                        {status !== "active" && (
                          <button
                            className="primary-btn small-btn"
                            disabled={busy === getValue(vendor, ["vendor_id", "_id"], "")}
                            onClick={() => setStatus(vendor, "active")}
                          >
                            <CheckCircle2 size={13} />
                            Approve
                          </button>
                        )}
                        {status === "pending" && (
                          <button
                            className="secondary-btn small-btn"
                            disabled={busy === getValue(vendor, ["vendor_id", "_id"], "")}
                            onClick={() => setStatus(vendor, "rejected")}
                          >
                            <X size={13} />
                            Reject
                          </button>
                        )}
                        {status === "active" && (
                          <button
                            className="secondary-btn small-btn"
                            disabled={busy === getValue(vendor, ["vendor_id", "_id"], "")}
                            onClick={() => setStatus(vendor, "suspended")}
                          >
                            <X size={13} />
                            Suspend
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="empty-state">No vendors found.</div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

function Inventory({ inventory, search, setSearch }) {
  const filtered = inventory.filter((item) =>
    JSON.stringify(item).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageLayout
      title="Inventory"
      subtitle="Monitor current stock levels"
      search={search}
      setSearch={setSearch}
    >
      <div className="table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Reorder Level</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, index) => {
                const quantity = Number(
                  getValue(item, ["quantity", "stock", "available_quantity"], 0)
                );
                const reorder = reorderLevel(item);
                const low = quantity <= reorder;

                return (
                  <tr key={item._id || item.id || index}>
                    <td>
                      {getValue(
                        item,
                        ["vendor_id", "vendorId", "vendor"],
                        "-"
                      )}
                    </td>
                    <td>
                      {getValue(
                        item,
                        ["product_name", "product_id", "productId", "product"],
                        "-"
                      )}
                    </td>
                    <td>
                      <strong>{quantity}</strong>
                    </td>
                    <td>{reorder}</td>
                    <td>
                      <span
                        className={
                          low
                            ? "status status-danger"
                            : "status status-success"
                        }
                      >
                        {low ? "Low Stock" : "Healthy"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="empty-state">No inventory records found.</div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

// What each request status means on the admin side of the handshake.
const REQUEST_LABELS = {
  pending: "Awaiting your decision",
  confirmed: "Assigned · awaiting vendor confirmation",
  synchronized: "Confirmed by vendor",
  rejected: "Rejected"
};

function Demands({ demands, refresh }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  const act = async (demand, action) => {
    const id = getValue(demand, ["_id", "id", "demand_id"], "");
    const vendor = getValue(demand, ["vendor_id", "vendorId", "vendor"], "");
    if (!id || !vendor) return;

    try {
      setBusy(id);
      const data = await request(`/vendors/${vendor}/demands/${id}/${action}`, {
        method: "POST",
        body: action === "reject" ? JSON.stringify({ reason: "Rejected by admin" }) : undefined
      });
      setMessage(data.error || data.message || "Done.");
      await refresh();
    } catch (error) {
      setMessage(error.message || `Unable to ${action} request.`);
    } finally {
      setBusy("");
    }
  };

  const sorted = [...demands].sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || ""))
  );

  return (
    <div>
      <div className="page-heading-large">
        <h1>Batch Requests</h1>
        <p>Vendors request exposed batches; assign one and the vendor confirms delivery</p>
      </div>

      {message && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          {message}
        </div>
      )}

      <div className="table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Requested</th>
                <th>Vendor</th>
                <th>Batch</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {sorted.map((demand, index) => {
                const id = getValue(demand, ["_id", "id", "demand_id"], "");
                const value = getValue(demand, ["status"], "pending");
                const item = demand.items?.[0] || {};
                const isBatch = Boolean(item.batch_id);

                return (
                  <tr key={id || index}>
                    <td>{formatDate(demand.created_at)}</td>
                    <td>{getValue(demand, ["vendor_id", "vendorId"], "-")}</td>
                    <td>{item.batch_id || "-"}</td>
                    <td>{getValue(item, ["product_name", "product_id"], demand.product_name || "-")}</td>
                    <td>{getValue(item, ["quantity"], demand.requested_quantity_kg ?? "-")} kg</td>
                    <td>
                      <span className={statusClass(value)}>
                        {REQUEST_LABELS[value] || formatStatus(value)}
                      </span>
                    </td>
                    <td>
                      {value === "pending" ? (
                        <div className="action-buttons">
                          <button
                            className="primary-btn small-btn"
                            disabled={busy === id}
                            onClick={() => act(demand, "confirm")}
                          >
                            <CheckCircle2 size={13} />
                            {isBatch ? "Assign" : "Confirm"}
                          </button>
                          <button
                            className="secondary-btn small-btn"
                            disabled={busy === id}
                            onClick={() => act(demand, "reject")}
                          >
                            <X size={13} />
                            Reject
                          </button>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {demands.length === 0 && (
            <div className="empty-state">
              <FileText size={28} />
              <h3>No batch requests</h3>
              <p>Vendors request batches from their Forecast screen.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// "YYYY-MM-DDTHH:mm" in local time, the format a datetime-local input expects.
const localNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function Batches({ batches, products, search, setSearch, refresh }) {
  // Only what the manufacturer knows. Shelf life depends on the vendor's storage
  // and the low-stock alert defaults to 20% of volume, both set by the backend.
  const [form, setForm] = useState({ product_id: "", volume_kg: "", manufactured_at: localNow() });
  const [message, setMessage] = useState("");

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const createBatch = async () => {
    if (!form.product_id || !(Number(form.volume_kg) > 0) || !form.manufactured_at) {
      setMessage("Select a product, enter a volume greater than 0 and the manufacture time.");
      return;
    }

    try {
      const data = await request("/batches", {
        method: "POST",
        body: JSON.stringify({
          product_id: form.product_id,
          volume_kg: Number(form.volume_kg),
          manufactured_at: new Date(form.manufactured_at).toISOString()
        })
      });
      setMessage(data.error || `Batch ${data.batch?.batch_id} created and exposed to vendors.`);
      if (!data.error) setForm((prev) => ({ ...prev, volume_kg: "", manufactured_at: localNow() }));
      await refresh();
    } catch (error) {
      setMessage(error.message || "Unable to create batch.");
    }
  };

  const toggleExposed = async (batch) => {
    try {
      const data = await request(`/batches/${batch.batch_id}/visibility`, {
        method: "POST",
        body: JSON.stringify({ exposed: batch.exposed === false })
      });
      if (data.error) setMessage(data.error);
      await refresh();
    } catch (error) {
      setMessage(error.message || "Unable to change visibility.");
    }
  };

  const filtered = batches.filter((batch) =>
    JSON.stringify(batch).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageLayout
      title="Batches"
      subtitle="Create batches and expose them for vendors to request"
      search={search}
      setSearch={setSearch}
    >
      {message && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          {message}
        </div>
      )}

      <div className="form-card">
        <div className="form-card-title">
          <h3>New Batch</h3>
          <p>New batches are exposed to vendors right away; hide one from the table. Expiry and the low-stock alert (20% of volume) are set automatically.</p>
        </div>

        <div className="form-grid">
          <FormField label="Product">
            <select value={form.product_id} onChange={(e) => update("product_id", e.target.value)}>
              <option value="">Select product</option>
              {products.map((product) => (
                <option key={product.product_id} value={product.product_id}>
                  {product.product_name} ({product.product_id})
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Volume (kg)">
            <input type="number" min="0" value={form.volume_kg}
              onChange={(e) => update("volume_kg", e.target.value)} />
          </FormField>

          <FormField label="Manufactured at">
            <input type="datetime-local" max={localNow()} value={form.manufactured_at}
              onChange={(e) => update("manufactured_at", e.target.value)} />
          </FormField>
        </div>

        <div className="form-actions">
          <button className="primary-btn" onClick={createBatch}>
            <Boxes size={15} />
            Create Batch
          </button>
        </div>
      </div>

      <div className="table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Product</th>
                <th>Vendor</th>
                <th>Remaining</th>
                <th>Manufactured</th>
                <th>Status</th>
                <th>Visibility</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((batch, index) => {
                const low = batch.remaining_kg <= batch.threshold_kg;
                return (
                  <tr key={batch._id || index}>
                    <td><strong>{batch.batch_id}</strong></td>
                    <td>{getValue(batch, ["product_name", "product_id"], "-")}</td>
                    <td>{batch.vendor_id || "-"}</td>
                    <td>
                      <span className={low && batch.vendor_id ? "status status-danger" : ""}>
                        {batch.remaining_kg} / {batch.volume_kg} kg
                      </span>
                    </td>
                    <td>{formatDate(getValue(batch, ["manufactured_at", "mfgTimestamp", "created_at"], ""))}</td>
                    <td>
                      <span className={statusClass(batch.status === "available" ? "pending" : batch.status)}>
                        {formatStatus(batch.status)}
                      </span>
                    </td>
                    <td>
                      {batch.status === "available" ? (
                        <button className="secondary-btn small-btn" onClick={() => toggleExposed(batch)}>
                          {batch.exposed === false ? <EyeOff size={13} /> : <Eye size={13} />}
                          {batch.exposed === false ? "Hidden" : "Exposed"}
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filtered.length === 0 && <div className="empty-state">No batches found.</div>}
        </div>
      </div>
    </PageLayout>
  );
}

function Activity({ logs, search, setSearch }) {
  const filtered = logs.filter((log) =>
    JSON.stringify(log).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageLayout
      title="Activity"
      subtitle="Backend activity and system logs"
      search={search}
      setSearch={setSearch}
    >
      <div className="activity-card">
        <div className="activity-list">
          {filtered.map((log, index) => (
            <div
              className="activity-item"
              key={log._id || log.id || index}
            >
              <div className="activity-icon">
                <FileText size={14} />
              </div>
              <div>
                <div className="activity-text">
                  {getValue(
                    log,
                    ["message", "action", "event", "description"],
                    "Activity recorded"
                  )}
                </div>
                <div className="activity-time">
                  {getValue(log, ["created_at", "timestamp", "time"], "")}
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="empty-state">No activity found.</div>
        )}
      </div>
    </PageLayout>
  );
}

function VendorSelect({ vendors, vendorId, onChange, onRefresh, loading, label, description, refreshLabel }) {
  return (
    <div className="ai-selector-card">
      <div>
        <div className="ai-selector-title">{label}</div>
        <div className="ai-selector-description">{description}</div>
      </div>

      <div className="ai-selector-controls">
        <select className="ai-vendor-select" value={vendorId} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select vendor</option>
          {vendors.map((vendor, index) => {
            const id = getValue(vendor, ["vendor_id", "vendorId", "id", "_id"], "");
            return (
              <option key={id || index} value={id}>
                {getValue(vendor, ["shop_name", "name"], "Vendor")} - {id}
              </option>
            );
          })}
        </select>

        <button className="primary-btn" onClick={onRefresh} disabled={!vendorId || loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          {refreshLabel}
        </button>
      </div>
    </div>
  );
}

function DemandForecast({ vendors }) {
  const [vendorId, setVendorId] = useState("");
  const [forecast, setForecast] = useState([]);
  const [summary, setSummary] = useState(null);
  const [windowLabel, setWindowLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadForecast = async (id = vendorId) => {
    if (!id) {
      setForecast([]);
      return;
    }

    try {
      setLoading(true);
      setMessage("");
      const data = await request(`/vendors/${id}/demand-forecast`);
      setForecast(data.forecast || []);
      setSummary(data.summary || null);
      setWindowLabel(data.window ? `${data.window.label} of ${data.window.date}` : "");
      setMessage(data.error || data.message || "");
    } catch (error) {
      setForecast([]);
      setMessage(error.message || "Unable to load demand forecast.");
    } finally {
      setLoading(false);
    }
  };

  const totals = {
    predicted: Number(summary?.predicted_demand || 0),
    stock: Number(summary?.current_stock || 0),
    requested: Number(summary?.requested_kg || 0),
    refill: Number(summary?.refill_quantity || 0)
  };

  return (
    <div className="ai-page">
      <div className="page-heading-large">
        <div className="ai-title-row">
          <div className="ai-page-icon">
            <Brain size={22} />
          </div>
          <div>
            <h1>Demand Forecast</h1>
            <p>Expected sales per sales window for every product, and the restock each vendor needs</p>
          </div>
        </div>
      </div>

      <VendorSelect
        vendors={vendors}
        vendorId={vendorId}
        onChange={(id) => {
          setVendorId(id);
          loadForecast(id);
        }}
        onRefresh={() => loadForecast()}
        loading={loading}
        label="Select Vendor"
        description="Shops with no sales yet get a baseline from location, weather and festivals; it adapts after a week of sales."
        refreshLabel="Refresh Forecast"
      />

      {message && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          {message}
        </div>
      )}

      <div className="ai-stats-grid">
        <AIStat icon={TrendingUp} title="Total Demand" value={totals.predicted.toFixed(1)} text={`kg, ${windowLabel || "this window"}`} />
        <AIStat icon={Package} title="Sellable Stock" value={totals.stock.toFixed(1)} text="kg, unexpired" />
        <AIStat icon={ShoppingCart} title="Requested" value={totals.requested.toFixed(1)} text="kg in pending requests" />
        <AIStat
          icon={AlertTriangle}
          title="To Restock"
          value={totals.refill.toFixed(1)}
          text={`kg across ${summary?.products_to_restock || 0} product(s)`}
          danger={totals.refill > 0}
        />
      </div>

      {!vendorId ? (
        <AIEmpty icon={TrendingUp} title="Select a vendor" text="Choose a vendor above to view the demand forecast." />
      ) : forecast.length === 0 && !loading ? (
        <AIEmpty
          icon={TrendingUp}
          title="No forecast"
          text="The demand model is not available right now."
        />
      ) : (
        <>
          <div className="ai-table-card">
            <div className="ai-card-header">
              <div>
                <h3>Demand &amp; Refill</h3>
                <p>Restock = demand + safety stock − sellable stock − already requested.</p>
              </div>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Demand</th>
                    <th>Safety Stock</th>
                    <th>Rec. Stock</th>
                    <th>Stock</th>
                    <th>Requested</th>
                    <th>Restock</th>
                    <th>Status</th>
                    <th>Held Batches</th>
                    <th>Batches to Assign</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((item, index) => (
                    <tr key={item.product_name || index}>
                      <td>
                        <strong>{item.product_name || "-"}</strong>
                        {item.history_source === "baseline" && (
                          <div className="ai-selector-description">baseline (no sales yet)</div>
                        )}
                      </td>
                      <td>{Number(item.predicted_demand).toFixed(1)}</td>
                      <td>{Number(item.safety_stock).toFixed(1)}</td>
                      <td><strong>{Number(item.recommended_stock).toFixed(1)}</strong></td>
                      <td>{Number(item.current_stock).toFixed(1)}</td>
                      <td>{Number(item.requested_kg || 0).toFixed(1)}</td>
                      <td><strong>{Number(item.refill_quantity).toFixed(1)}</strong></td>
                      <td>
                        <span className={item.restock_needed ? "status status-danger" : "status status-success"}>
                          {item.status}
                        </span>
                      </td>
                      <td>
                        <div className="batch-chips">
                          {(item.batches || []).map((batch) => (
                            <span
                              key={batch.batch_id}
                              className="batch-chip"
                              title={`${batch.batch_id} · ${batch.remaining_kg} kg · ${formatStatus(batch.status)} · ${formatDate(batch.received_at)}`}
                            >
                              <strong>{batch.batch_id}</strong>
                              <span>{batch.remaining_kg} kg · {batch.expired ? "expired" : formatDate(batch.received_at)}</span>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="batch-chips">
                          {(item.suggested_batches || []).map((batch) => (
                            <span key={batch.batch_id} className="batch-chip">
                              <strong>{batch.batch_id}</strong>
                              <span>{batch.remaining_kg} kg</span>
                            </span>
                          ))}
                          {item.uncovered_kg > 0 && (
                            <span className="ai-selector-description">{item.uncovered_kg} kg not yet produced</span>
                          )}
                          {!item.restock_needed && "-"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RiskBar({ score, label }) {
  return (
    <div className="risk-bar" title={`${score}%`}>
      <div className="risk-bar-fill" style={{ width: `${Math.min(100, Math.max(0, score))}%`, background: riskColor(label) }} />
    </div>
  );
}

function SpoilageRisk({ vendors }) {
  const [vendorId, setVendorId] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadRisk = async (id = vendorId) => {
    if (!id) {
      setReport(null);
      return;
    }

    try {
      setLoading(true);
      setMessage("");
      const data = await request(`/vendors/${id}/spoilage-risk`);
      setReport(data);
      setMessage(data.error || data.message || "");
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Unable to load spoilage risk.");
    } finally {
      setLoading(false);
    }
  };

  const evaluations = report?.evaluations || [];
  const summary = report?.summary || { high: 0, medium: 0, low: 0 };
  const aggregate = report?.aggregate_risk_score;
  const aggregateLabel = report?.aggregate_risk_label;

  return (
    <div className="ai-page">
      <div className="page-heading-large">
        <div className="ai-title-row">
          <div className="ai-page-icon danger-ai">
            <ShieldAlert size={22} />
          </div>
          <div>
            <h1>Spoilage Risk</h1>
            <p>Model risk score (0–100) for every batch a vendor currently holds</p>
          </div>
        </div>
      </div>

      <VendorSelect
        vendors={vendors}
        vendorId={vendorId}
        onChange={(id) => {
          setVendorId(id);
          loadRisk(id);
        }}
        onRefresh={() => loadRisk()}
        loading={loading}
        label="Select Vendor"
        description="Archived, sold-out and expired-out batches are excluded."
        refreshLabel="Refresh Risk"
      />

      {message && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          {message}
        </div>
      )}

      <div className="ai-stats-grid risk-kpis">
        <div className="ai-stat-card aggregate-card" style={{ borderColor: riskColor(aggregateLabel) }}>
          <div className="dashboard-stat-label">Vendor Aggregate Risk</div>
          <div className="dashboard-stat-value">
            <strong style={{ color: riskColor(aggregateLabel) }}>
              {aggregate == null ? "-" : `${aggregate.toFixed(1)}%`}
            </strong>
            <span style={{ color: riskColor(aggregateLabel) }}>{aggregateLabel || "no batches"}</span>
          </div>
          <RiskBar score={aggregate || 0} label={aggregateLabel} />
        </div>
        <AIStat icon={ShieldAlert} title="High (>70%)" value={summary.high} text="batches" danger />
        <AIStat icon={Thermometer} title="Medium (30–70%)" value={summary.medium} text="batches" />
        <AIStat icon={CheckCircle2} title="Low (≤30%)" value={summary.low} text="batches" />
        <AIStat icon={Package} title="Total Batches" value={evaluations.length} text="held" />
      </div>

      {!vendorId ? (
        <AIEmpty icon={ShieldAlert} title="Select a vendor" text="Choose a vendor above to evaluate spoilage risk." danger />
      ) : evaluations.length === 0 && !loading ? (
        <AIEmpty icon={ShieldAlert} title="No batches assigned" text="This vendor holds no batches." danger />
      ) : (
        <div className="ai-table-card">
          <div className="ai-card-header">
            <div>
              <h3>Batch Risk Evaluation</h3>
              <p>Score = P(High)×100 + P(Medium)×50 · aggregate weighted by kg left</p>
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Batch ID</th>
                  <th>Product</th>
                  <th>Remaining</th>
                  <th>Risk Score</th>
                  <th>Risk Label</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.map((item, index) => (
                  <tr key={item.batch_id || index}>
                    <td>{item.batch_id}</td>
                    <td><strong>{item.product_name}</strong></td>
                    <td>{item.remaining_kg} kg</td>
                    <td>
                      <div className="risk-score-cell">
                        <strong>{Number(item.risk_score).toFixed(1)}%</strong>
                        <RiskBar score={item.risk_score} label={item.risk_label} />
                      </div>
                    </td>
                    <td>
                      <span className={statusClass(item.risk_label === "Low" ? "active" : item.risk_label)}>
                        {item.risk_label} Risk
                      </span>
                    </td>
                    <td>{item.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AIStat({ icon: Icon, title, value, text, danger = false }) {
  return (
    <div className={`ai-stat-card ${danger ? "risk-high-card" : ""}`}>
      <div className={`ai-stat-icon ${danger ? "risk-high-icon" : ""}`}>
        <Icon size={18} />
      </div>
      <div className="dashboard-stat-label">{title}</div>
      <div className="dashboard-stat-value">
        <strong>{value}</strong>
        <span>{text}</span>
      </div>
    </div>
  );
}

function AIEmpty({ icon: Icon, title, text, danger = false }) {
  return (
    <div className={`ai-empty ${danger ? "danger-empty" : ""}`}>
      <div className="ai-empty-icon">
        <Icon size={25} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function FormField({ label, children, wide = false }) {
  return (
    <div className={`form-group ${wide ? "form-group-wide" : ""}`}>
      <label>{label}</label>
      {children}
    </div>
  );
}

function PageLayout({ title, subtitle, search, setSearch, children }) {
  return (
    <div>
      <div className="page-toolbar">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>

        <div className="search-box">
          <Search size={15} />
          <input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {children}
    </div>
  );
}

function Login({ onLogin }) {
  const [form, setForm] = useState({ login: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    try {
      setBusy(true);
      setError("");
      const data = await request("/login", { method: "POST", body: JSON.stringify(form) });
      if (data.role !== "admin") throw new Error("This account is not an admin account.");
      onLogin(data.token);
    } catch (error) {
      setError(error.message || "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="loading-screen">
      <form className="form-card login-card" onSubmit={submit}>
        <div className="form-card-title">
          <h3>B2P Manufacturer Portal</h3>
          <p>Sign in with an admin account</p>
        </div>

        {error && (
          <div className="alert alert-warning">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        <FormField label="Email or phone" wide>
          <input autoComplete="username" value={form.login}
            onChange={(e) => setForm((prev) => ({ ...prev, login: e.target.value }))} />
        </FormField>
        <FormField label="Password" wide>
          <input type="password" autoComplete="current-password" value={form.password}
            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} />
        </FormField>

        <div className="form-actions">
          <button className="primary-btn" type="submit" disabled={busy || !form.login || !form.password}>
            Sign in
          </button>
        </div>
      </form>
    </div>
  );
}

// The catalog is fixed to the three products the demand model was trained on,
// so this page only shows them; batches are created from these on the Batches page.
function Products({ products, search, setSearch }) {
  const filtered = products.filter((product) =>
    JSON.stringify(product).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageLayout
      title="Products"
      subtitle="Idli, Dosa and Combo: the products the forecast model knows. Shelf life sets batch expiry."
      search={search}
      setSearch={setSearch}
    >

      <div className="table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Product ID</th>
                <th>Name</th>
                <th>Category</th>
                <th>Fridge shelf life</th>
                <th>Room shelf life</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product, index) => (
                <tr key={product._id || index}>
                  <td><strong>{product.product_id}</strong></td>
                  <td>{product.product_name}</td>
                  <td>{product.category || "-"}</td>
                  <td>{getValue(product, ["shelf_life_fridge_hrs", "shelf_life_hours"], "-")} h</td>
                  <td>{getValue(product, ["shelf_life_ambient_hrs"], "-")} h</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="empty-state">No products found.</div>}
        </div>
      </div>
    </PageLayout>
  );
}

// Loads one admin list endpoint for a page that owns its data.
function useList(url, key) {
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    request(url)
      .then((data) => live && setItems(data[key] || []))
      .catch((error) => live && setMessage(error.message || "Unable to load."));
    return () => {
      live = false;
    };
  }, [url, key, version]);
  return { items, reload: () => setVersion((v) => v + 1), message, setMessage };
}

function Orders({ search, setSearch }) {
  const { items: orders, message } = useList("/orders", "orders");
  const filtered = orders.filter((order) => JSON.stringify(order).toLowerCase().includes(search.toLowerCase()));

  return (
    <PageLayout title="Orders" subtitle="Customer purchases and recorded shop sales" search={search} setSearch={setSearch}>
      {message && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          {message}
        </div>
      )}
      <div className="table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Vendor</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Customer</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order, index) => {
                const status = getValue(order, ["order_status", "status"], "-");
                return (
                  <tr key={order._id || index}>
                    <td><strong>{getValue(order, ["order_id", "_id"], "-")}</strong></td>
                    <td>{formatDate(getValue(order, ["order_date", "created_at"], ""))}</td>
                    <td>{order.vendor_id || "-"}</td>
                    <td>{getValue(order, ["product_name"], order.order_type === "restock" ? "Restock request" : "-")}</td>
                    <td>{order.quantity_kg !== undefined ? `${order.quantity_kg} kg` : "-"}</td>
                    <td>{order.user_id || "-"}</td>
                    <td><span className={statusClass(status)}>{formatStatus(status)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="empty-state">No orders found.</div>}
        </div>
      </div>
    </PageLayout>
  );
}

function Alerts({ search, setSearch }) {
  const { items: alerts, message } = useList("/inventory-alerts", "alerts");
  const filtered = alerts.filter((alert) => JSON.stringify(alert).toLowerCase().includes(search.toLowerCase()));

  return (
    <PageLayout
      title="Stock Alerts"
      subtitle="Raised when a sale takes a batch below its low-stock level. Each clears itself once the shop receives a new batch of that product (assign one from Batch Requests) or returns the batch."
      search={search}
      setSearch={setSearch}
    >
      {message && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          {message}
        </div>
      )}
      <div className="table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Raised</th>
                <th>Vendor</th>
                <th>Batch</th>
                <th>Message</th>
                <th>Status</th>
                <th>Cleared by</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((alert, index) => (
                <tr key={alert._id || index}>
                  <td>{formatDate(alert.generated_time)}</td>
                  <td>{alert.vendor_id || "-"}</td>
                  <td>{alert.batch_id || "-"}</td>
                  <td>{alert.alert_message || formatStatus(alert.alert_type)}</td>
                  <td>
                    <span className={alert.alert_status === "active" ? "status status-danger" : statusClass(alert.alert_status)}>
                      {formatStatus(alert.alert_status)}
                    </span>
                  </td>
                  <td>{alert.alert_status === "active" ? "Waiting for new stock" : alert.resolved_by || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="empty-state">No stock alerts.</div>}
        </div>
      </div>
    </PageLayout>
  );
}

function Festivals({ search, setSearch }) {
  const { items: festivals, reload, message, setMessage } = useList("/festival-calendar", "festivals");
  const empty = { date: "", festivalType: "publicHoliday", windowDays: "1", festivalName: "", region: "Tamil Nadu" };
  const [form, setForm] = useState(empty);
  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const save = async () => {
    if (!form.date || !form.festivalName.trim()) {
      setMessage("Date and festival name are required.");
      return;
    }
    try {
      const data = await request("/festival-calendar", {
        method: "POST",
        body: JSON.stringify({ ...form, windowDays: Number(form.windowDays) })
      });
      setMessage(data.error || `${form.festivalName} saved.`);
      if (!data.error) setForm(empty);
      reload();
    } catch (error) {
      setMessage(error.message || "Unable to save festival.");
    }
  };

  const filtered = festivals.filter((festival) => JSON.stringify(festival).toLowerCase().includes(search.toLowerCase()));

  return (
    <PageLayout title="Festival Calendar" subtitle="Festival windows raise the demand forecast" search={search} setSearch={setSearch}>
      {message && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          {message}
        </div>
      )}

      <div className="form-card">
        <div className="form-card-title">
          <h3>Add Festival</h3>
          <p>Only the two festival types the demand model was trained on can be used.</p>
        </div>
        <div className="form-grid">
          <FormField label="Date">
            <input type="date" value={form.date} onChange={(e) => update("date", e.target.value)} />
          </FormField>
          <FormField label="Name">
            <input value={form.festivalName} placeholder="Pongal" onChange={(e) => update("festivalName", e.target.value)} />
          </FormField>
          <FormField label="Type">
            <select value={form.festivalType} onChange={(e) => update("festivalType", e.target.value)}>
              <option value="harvestFestival">Harvest festival</option>
              <option value="publicHoliday">Public holiday</option>
            </select>
          </FormField>
          <FormField label="Window (days)">
            <input type="number" min="1" max="31" value={form.windowDays} onChange={(e) => update("windowDays", e.target.value)} />
          </FormField>
          <FormField label="Region">
            <input value={form.region} onChange={(e) => update("region", e.target.value)} />
          </FormField>
        </div>
        <div className="form-actions">
          <button className="primary-btn" onClick={save}>
            <CalendarDays size={15} />
            Save Festival
          </button>
        </div>
      </div>

      <div className="table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Type</th>
                <th>Window</th>
                <th>Region</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((festival, index) => (
                <tr key={festival._id || index}>
                  <td>{festival.date ? parseServerDate(festival.date).toLocaleDateString() : "-"}</td>
                  <td><strong>{festival.festivalName || "-"}</strong></td>
                  <td>{formatStatus(festival.festivalType)}</td>
                  <td>{festival.windowDays} day(s)</td>
                  <td>{festival.region || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="empty-state">No festivals saved.</div>}
        </div>
      </div>
    </PageLayout>
  );
}

function App() {
  const [signedIn, setSignedIn] = useState(Boolean(authToken));
  const [page, setPage] = useState("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);

  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [demands, setDemands] = useState([]);
  const [batches, setBatches] = useState([]);
  const [logs, setLogs] = useState([]);

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Only the first load shows the full-screen loader; refreshes keep the page
  // (and its success/error message) mounted.
  const loadData = async () => {
    try {
      const vendorData = await request("/vendors");
      const vendorList = Array.isArray(vendorData)
        ? vendorData
        : vendorData.vendors || [];

      setVendors(vendorList);

      try {
        const data = await request("/products");
        setProducts(data.products || []);
      } catch {
        setProducts([]);
      }

      try {
        const data = await request("/batches");
        setBatches(data.batches || []);
      } catch {
        setBatches([]);
      }

      const inventoryResults = await Promise.all(
        vendorList.map(async (vendor) => {
          const id = getValue(
            vendor,
            ["vendor_id", "vendorId", "id", "_id"],
            ""
          );

          if (!id) return [];

          try {
            const data = await request(`/vendors/${id}/inventory`);
            return Array.isArray(data) ? data : data.inventory || [];
          } catch {
            return [];
          }
        })
      );

      setInventory(inventoryResults.flat());

      try {
        const data = await request("/restock-requests");
        const list = Array.isArray(data)
          ? data
          : data.restock_requests || data.requests || [];
        setDemands(list);
      } catch {
        setDemands([]);
      }

      try {
        const data = await request("/logs");
        setLogs(Array.isArray(data) ? data : data.logs || []);
      } catch {
        setLogs([]);
      }

    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    onSignedOut = () => setSignedIn(false);
    if (signedIn) loadData();
  }, [signedIn]);

  const signOut = () => {
    authToken = "";
    saveToken("");
    setSignedIn(false);
  };

  useEffect(() => {
    setSearch("");
  }, [page]);

  const pageTitle = useMemo(() => {
    const titles = {
      dashboard: "Dashboard",
      vendors: "Vendors",
      batches: "Batches",
      products: "Products",
      inventory: "Inventory",
      demands: "Batch Requests",
      orders: "Orders",
      alerts: "Stock Alerts",
      forecast: "Demand Forecast",
      spoilage: "Spoilage Risk",
      festivals: "Festival Calendar",
      activity: "Activity"
    };

    return titles[page] || "Dashboard";
  }, [page]);

  if (!signedIn) {
    return (
      <Login
        onLogin={(token) => {
          authToken = token;
          saveToken(token);
          setLoading(true);
          setSignedIn(true);
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-box">
          <div className="loading-logo">B2</div>
          <div>Loading manufacturer portal...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        page={page}
        setPage={setPage}
        open={mobileOpen}
        setOpen={setMobileOpen}
        demands={demands}
      />

      <main className="main">
        <Topbar title={pageTitle} setOpen={setMobileOpen} onSignOut={signOut} />

        <div className="content">
          {page === "dashboard" && (
            <Dashboard
              vendors={vendors}
              products={products}
              inventory={inventory}
              demands={demands}
              logs={logs}
              setPage={setPage}
              refresh={loadData}
            />
          )}

          {page === "vendors" && (
            <Vendors
              vendors={vendors}
              search={search}
              setSearch={setSearch}
              refresh={loadData}
            />
          )}

          {page === "batches" && (
            <Batches
              batches={batches}
              products={products}
              search={search}
              setSearch={setSearch}
              refresh={loadData}
            />
          )}

          {page === "products" && (
            <Products products={products} search={search} setSearch={setSearch} />
          )}

          {page === "orders" && <Orders search={search} setSearch={setSearch} />}

          {page === "alerts" && <Alerts search={search} setSearch={setSearch} />}

          {page === "festivals" && <Festivals search={search} setSearch={setSearch} />}

          {page === "inventory" && (
            <Inventory
              inventory={inventory}
              search={search}
              setSearch={setSearch}
            />
          )}

          {page === "demands" && (
            <Demands demands={demands} refresh={loadData} />
          )}

          {page === "forecast" && <DemandForecast vendors={vendors} />}

          {page === "spoilage" && <SpoilageRisk vendors={vendors} />}

          {page === "activity" && (
            <Activity
              logs={logs}
              search={search}
              setSearch={setSearch}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
