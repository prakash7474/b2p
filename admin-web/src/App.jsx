import { createContext, useContext, useEffect, useMemo, useState } from "react";

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
  LogOut,
  Pencil,
  Plus,
  Trash2
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

// Logs come in two shapes (seed: type/event/related_to, app: action/message), so
// each entry is sorted into a category by its action, falling back to the seed fields.
const LOG_CATEGORIES = [
  ["all", "All"],
  ["vendor", "Vendors"],
  ["product", "Products"],
  ["batch", "Batches"],
  ["request", "Batch requests"],
  ["spoilage", "Spoilage & expiry alerts"],
  ["stock", "Stock alerts"],
  ["customer", "Customers"],
  ["system", "System"]
];

const LOG_ACTIONS = {
  create_vendor: "vendor",
  set_vendor_status: "vendor",
  approve_vendor: "vendor",
  create_product: "product",
  update_product: "product",
  delete_product: "product",
  create_batch: "batch",
  receive_batch: "batch",
  return_batch: "batch",
  batch_expired: "spoilage",
  create_demand: "request",
  create_restock_request: "request",
  assign_batch: "request",
  reject_request: "request",
  create_inventory: "stock",
  update_inventory: "stock",
  register_customer: "customer",
  login_customer: "customer"
};

// Entries saved without a message get a readable line instead of the raw action name.
const LOG_TEXT = { login_customer: "A customer signed in", create_demand: "A shop requested a batch" };
const logText = (log) =>
  getValue(log, ["message", "event", "description"], "") ||
  LOG_TEXT[log.action] ||
  formatStatus(log.action || "activity recorded");

const logCategory = (log) => {
  const action = log.action || log.metadata?.action;
  if (LOG_ACTIONS[action]) return LOG_ACTIONS[action];
  const text = String(getValue(log, ["message", "event"], "")).toLowerCase();
  if (log.type === "alert") return /spoil|risk|expir/.test(text) ? "spoilage" : "stock";
  if (/order|customer/.test(text)) return "customer";
  return { vendor: "vendor", batch: "batch", product: "product" }[log.related_to?.type] || "system";
};

// App logs written before timestamps were added still carry their time in the ObjectId.
const logTime = (log) => {
  const value = getValue(log, ["timestamp", "created_at", "time"], "");
  if (value) return parseServerDate(value);
  return /^[0-9a-f]{24}$/.test(log._id || "") ? new Date(parseInt(log._id.slice(0, 8), 16) * 1000) : null;
};

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

// Batches still in play: not expired, returned or sold out.
const ACTIVE_BATCH_STATUSES = ["available", "assigned", "received", "active"];
const isActiveBatch = (batch) =>
  ACTIVE_BATCH_STATUSES.includes(batch.status) && !batch.expired_at && Number(batch.remaining_kg) > 0;

const BATCH_STATUS_LABELS = {
  available: "Unassigned",
  assigned: "Awaiting receipt",
  received: "At shop",
  active: "At shop"
};

const vendorName = (vendors, vendorId) => {
  const vendor = vendors.find((v) => v.vendor_id === vendorId || v._id === vendorId);
  return getValue(vendor, ["shop_name", "name"], vendorId);
};

// Spoilage score bands, same as the backend: <=30 Low, 30-70 Medium, >70 High.
const riskColor = (label) =>
  label === "High" ? "#b3261e" : label === "Medium" ? "#8a5a00" : "#035542";

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
      title: "Vendors & Products",
      links: [
        ["vendors", "Vendors", Store],
        ["products", "Products", Package],
        ["inventory", "Inventory", Warehouse]
      ]
    },
    {
      title: "Batch Management",
      links: [
        ["batches", "Batches", Boxes],
        ["demands", "Batch Requests", FileText]
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

function Topbar({ title, setOpen, onRefresh, refreshing, onSignOut }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu size={20} />
        </button>

        <div>
          <div className="topbar-subtitle">Manufacturer portal</div>
          <div className="topbar-brand">{title}</div>
        </div>
      </div>

      <div className="topbar-right">
        <span className="topbar-pill">
          <span className="online-dot" />
          System online
        </span>
        <button className="topbar-btn" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? "spin" : ""} />
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
        <button className="signout-btn" onClick={onSignOut}>
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </header>
  );
}

function DashCard({ icon: Icon, title, value, text, action, children }) {
  return (
    <div className="dashboard-stat">
      <div className="dashboard-stat-head">
        <div className="dashboard-stat-icon">
          <Icon size={19} />
        </div>
        <div className="dashboard-stat-label">{title}</div>
      </div>

      <div className="dashboard-stat-value">
        <strong>{value}</strong>
        <span>{text}</span>
      </div>

      {children}

      {action && (
        <button className="secondary-btn small-btn stat-action" onClick={action.onClick}>
          {action.label}
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}

const ATTENTION_LABELS = {
  expired: "expired stock",
  expiring: "expiring soon",
  low: "low stock",
  below_forecast: "below forecast"
};

// Only alerts and decisions belong on the dashboard; the rest stays on the Activity page.
const DASHBOARD_LOG_CATEGORIES = ["spoilage", "stock", "request", "vendor"];

function Dashboard({ vendors, demands, logs, setPage, openInventory }) {
  const { items: summary, loaded } = useList("/dashboard-summary", null);
  const ready = loaded && summary.demand;

  const pendingVendors = vendors.filter(
    (v) => String(vendorStatus(v)).toLowerCase() === "pending"
  ).length;
  // Only pending requests need the admin; the rest are history.
  const queued = demands.filter((d) => getValue(d, ["status"]) === "pending").length;
  const recent = logs.filter((log) => DASHBOARD_LOG_CATEGORIES.includes(logCategory(log))).slice(0, 6);
  const kg = (value) => `${Number(value || 0)} kg`;

  return (
    <div>
      <div className="dashboard-header">
        {/* The headline is today's job: how much batter to make for this sales window. */}
        <div>
          <h1>
            {ready ? (
              <>
                Make <span className="billboard-alt">{kg(Math.round(summary.demand.to_make_kg))}</span>
              </>
            ) : (
              "Today"
            )}
          </h1>
          <p>
            {ready
              ? `for the ${summary.window.label} window, ${parseServerDate(summary.window.date).toLocaleDateString(undefined, {
                  weekday: "long", day: "numeric", month: "short"
                })}: ${kg(summary.demand.total_kg)} demand across ${summary.demand.shops_forecast} shops, plus safety stock, minus stock on hand`
              : "Loading today's numbers..."}
          </p>
        </div>

        <div className="dashboard-header-actions">
          {queued > 0 && (
            <button className="header-cta" onClick={() => setPage("demands")}>
              {queued} batch request{queued === 1 ? "" : "s"} waiting
              <ChevronRight size={16} />
            </button>
          )}
          {pendingVendors > 0 && (
            <button className="header-cta" onClick={() => setPage("vendors")}>
              {pendingVendors} vendor{pendingVendors === 1 ? "" : "s"} to approve
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>

      {loaded && !ready && (
        <div className="alert alert-error">
          <AlertTriangle size={16} />
          Could not load the dashboard numbers. Is the backend running from this branch?
        </div>
      )}

      <div className="dashboard-stats">
        <DashCard
          icon={TrendingUp}
          title="Demand by product"
          value={ready ? kg(summary.demand.total_kg) : "..."}
          text={ready ? `expected across all shops this ${summary.window.label}` : ""}
          action={{ label: "Open forecast", onClick: () => setPage("forecast") }}
        >
          {ready && (
            <ul className="dash-lines">
              {summary.demand.products.map((p) => (
                <li key={p.product_name}>
                  <span>{p.product_name}</span>
                  <strong>make {kg(p.to_make_kg)}</strong>
                  <em>demand {kg(p.demand_kg)}{p.factory_kg ? `, ${kg(p.factory_kg)} at factory` : ""}</em>
                </li>
              ))}
            </ul>
          )}
          {ready && summary.demand.shops_forecast < summary.demand.shops_live && (
            <p className="dash-note">
              Forecast ready for {summary.demand.shops_forecast} of {summary.demand.shops_live} shops; the rest refresh within 15 minutes.
            </p>
          )}
        </DashCard>

        <DashCard
          icon={AlertTriangle}
          title="Shops needing attention"
          value={ready ? summary.attention.shops : "..."}
          text={ready ? (summary.attention.shops ? "with a stock problem" : "all shops are fine") : ""}
          action={{ label: "Open inventory", onClick: () => openInventory(true) }}
        >
          {ready && Object.keys(summary.attention.by_kind).length > 0 && (
            <div className="dash-chips">
              {Object.entries(summary.attention.by_kind).map(([kind, count]) => (
                <span key={kind} className={kind === "expired" ? "status status-danger" : "status status-warning"}>
                  {count} {ATTENTION_LABELS[kind] || formatStatus(kind)}
                </span>
              ))}
            </div>
          )}
        </DashCard>

        <DashCard
          icon={Warehouse}
          title="Stock in shops"
          value={ready ? kg(summary.stock.sellable_kg) : "..."}
          text="sellable now"
          action={{ label: "Open inventory", onClick: () => openInventory(false) }}
        >
          {ready && (
            <ul className="dash-lines">
              <li><span>On the way</span><strong>{kg(summary.stock.awaiting_kg)}</strong></li>
              <li><span>Expired, to collect</span><strong>{kg(summary.stock.expired_kg)}</strong></li>
            </ul>
          )}
        </DashCard>

        <DashCard
          icon={Boxes}
          title="Unassigned batches"
          value={ready ? summary.unassigned.batches : "..."}
          text={ready ? `${kg(summary.unassigned.kg)} at the factory` : ""}
          action={{ label: "View batches", onClick: () => setPage("batches") }}
        >
          {ready && summary.unassigned.oldest_hours !== null && (
            <p className="dash-note">Oldest made {summary.unassigned.oldest_hours} h ago; its shelf life is running.</p>
          )}
        </DashCard>
      </div>

      <section className="dashboard-section activity-section">
        <h2>Recent Alerts &amp; Decisions</h2>
        <p>Expiries, stock alerts, request decisions and vendor changes</p>

        <div className="activity-card">
          {recent.length === 0 ? (
            <div className="empty-state">Nothing to report.</div>
          ) : (
            <div className="activity-list">
              {recent.map((log, index) => (
                <div className="activity-item" key={log._id || log.id || index}>
                  <div className={`activity-icon ${log.type === "alert" ? "activity-icon-alert" : ""}`}>
                    {log.type === "alert" ? <AlertTriangle size={14} /> : <FileText size={14} />}
                  </div>
                  <div>
                    <div className="activity-text">{logText(log)}</div>
                    <div className="activity-time">{logTime(log)?.toLocaleString() || ""}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="secondary-btn small-btn stat-action" onClick={() => setPage("activity")}>
            View all activity
            <ChevronRight size={14} />
          </button>
        </div>
      </section>
    </div>
  );
}

// The shop surroundings the demand model was trained on.
const LOCALITY_OPTIONS = [
  ["commercial_offices", "Offices / commercial"],
  ["institutional", "Institutional"],
  ["mixed", "Mixed"],
  ["residential_budget", "Residential, budget"],
  ["residential_premium", "Residential, premium"]
];

function Vendors({ vendors, search, setSearch, refresh }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  const setLocality = async (vendor, locality) => {
    const id = getValue(vendor, ["vendor_id", "_id"], "");
    try {
      setBusy(id);
      const data = await request(`/vendors/${id}/locality`, {
        method: "POST",
        body: JSON.stringify({ locality_tier: locality })
      });
      setMessage(data.error || `${id}: locality set to ${locality}. Its demand forecast now uses this area.`);
      await refresh();
    } catch (error) {
      setMessage(error.message || "Unable to update locality.");
    } finally {
      setBusy("");
    }
  };

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
                <th>Locality</th>
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
                      <select
                        aria-label={`Locality of ${getValue(vendor, ["vendor_id", "_id"], "")}`}
                        value={(() => {
                          const tier = getValue(vendor, ["localityTier", "locality_tier"], "mixed");
                          return tier === "commercial" ? "commercial_offices" : tier;
                        })()}
                        disabled={busy === getValue(vendor, ["vendor_id", "_id"], "")}
                        onChange={(e) => setLocality(vendor, e.target.value)}
                      >
                        {LOCALITY_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </td>
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

const ALERT_CLASSES = { danger: "alert alert-error", warning: "alert alert-warning", info: "alert alert-info" };

function Inventory({ search, setSearch, initialAttention = false }) {
  const { items: shops, loaded, message } = useList("/shop-stock", "shops");
  const [attentionOnly, setAttentionOnly] = useState(initialAttention);

  const query = search.toLowerCase();
  const listed = shops.filter((shop) => {
    if (attentionOnly && !shop.alerts.some((a) => a.level !== "info")) return false;
    return [shop.shop_name, ...shop.products.map((p) => p.product_name)].join(" ").toLowerCase().includes(query);
  });
  const kg = (value) => `${Number(value || 0)} kg`;

  return (
    <PageLayout
      title="Inventory"
      subtitle="What each shop holds right now, built from its batches"
      search={search}
      setSearch={setSearch}
    >
      {message && (
        <div className="alert alert-error">
          <AlertTriangle size={16} />
          Could not load shop stock: {message}
        </div>
      )}

      <div className="inventory-toolbar">
        <button className={`secondary-btn small-btn ${attentionOnly ? "toggle-on" : ""}`}
          onClick={() => setAttentionOnly((v) => !v)}>
          <AlertTriangle size={13} />
          {attentionOnly ? "Showing shops that need attention" : "Needs attention only"}
        </button>
      </div>

      {listed.length === 0 && !message && (
        <div className="table-card">
          <div className="empty-state">
            {!loaded ? "Loading shop stock..." : attentionOnly ? "No shop needs attention right now." : "No shops found."}
          </div>
        </div>
      )}

      {listed.map((shop) => (
        <div className="table-card batch-group" key={shop.vendor_id}>
          <div className="batch-group-title">
            <h3>{shop.shop_name}</h3>
            <span>
              {[shop.locality && formatStatus(shop.locality), shop.has_fridge ? "Fridge" : "No fridge"]
                .filter(Boolean).join(" · ")}
              {" · "}holds {kg(shop.held_kg)}, {kg(shop.sellable_kg)} sellable
            </span>
          </div>

          {shop.alerts.length > 0 && (
            <div className="shop-alerts">
              {shop.alerts.map((alert, index) => (
                <div className={ALERT_CLASSES[alert.level]} key={index}>
                  <AlertTriangle size={15} />
                  {alert.text}
                </div>
              ))}
            </div>
          )}

          {shop.products.length === 0 ? (
            <div className="empty-state">Holds no stock.</div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Sellable</th>
                    <th>Awaiting receipt</th>
                    <th>Total held</th>
                    <th>Expired</th>
                    <th>Next expiry</th>
                    <th>Forecast</th>
                  </tr>
                </thead>
                <tbody>
                  {shop.products.map((row) => (
                    <tr key={row.product_name}>
                      <td><strong>{row.product_name}</strong></td>
                      <td>
                        <span className={row.low_stock ? "status status-danger" : ""}>{kg(row.sellable_kg)}</span>
                      </td>
                      <td>{row.awaiting_kg ? kg(row.awaiting_kg) : "-"}</td>
                      <td>{kg(row.held_kg)}</td>
                      <td>{row.expired_kg ? <span className="status status-danger">{kg(row.expired_kg)}</span> : "-"}</td>
                      <td>{row.next_expiry_hours === null ? "-" : `in ${row.next_expiry_hours} h`}</td>
                      <td>{row.forecast_kg === null ? "-" : kg(Number(row.forecast_kg.toFixed(1)))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
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

const PAST_REQUEST_DAYS = 3;

function Demands({ demands, vendors, refresh }) {
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
  const queued = sorted.filter((d) => getValue(d, ["status"]) === "pending");
  // Batter is past use after a few days, so older decisions are not worth listing.
  const since = Date.now() - PAST_REQUEST_DAYS * 86400000;
  const past = sorted.filter(
    (d) => getValue(d, ["status"]) !== "pending" && parseServerDate(d.created_at).getTime() >= since
  );

  const table = (rows, withActions) => (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Requested</th>
            <th>Vendor</th>
            <th>Product</th>
            <th>Quantity</th>
            <th>Status</th>
            {withActions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((demand, index) => {
            const id = getValue(demand, ["_id", "id", "demand_id"], "");
            const value = getValue(demand, ["status"], "pending");
            const item = demand.items?.[0] || {};
            return (
              <tr key={id || index}>
                <td>{formatDate(demand.created_at)}</td>
                <td><strong>{vendorName(vendors, getValue(demand, ["vendor_id", "vendorId"], "-"))}</strong></td>
                <td>{getValue(item, ["product_name", "product_id"], demand.product_name || "-")}</td>
                <td>{getValue(item, ["quantity"], demand.requested_quantity_kg ?? "-")} kg</td>
                <td>
                  <span className={statusClass(value)}>
                    {REQUEST_LABELS[value] || formatStatus(value)}
                  </span>
                </td>
                {withActions && (
                  <td>
                    <div className="action-buttons">
                      <button
                        className="primary-btn small-btn"
                        disabled={busy === id}
                        onClick={() => act(demand, "confirm")}
                      >
                        <CheckCircle2 size={13} />
                        {item.batch_id ? "Assign" : "Confirm"}
                      </button>
                      <button
                        className="secondary-btn small-btn danger-btn"
                        disabled={busy === id}
                        onClick={() => act(demand, "reject")}
                      >
                        <X size={13} />
                        Reject
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
        {queued.length === 0 ? (
          <div className="empty-state">
            <FileText size={28} />
            <h3>No batch requests right now</h3>
            <p>New requests from vendors appear here for you to assign or reject.</p>
          </div>
        ) : (
          table(queued, true)
        )}
      </div>

      <section className="dashboard-section past-requests">
        <h2>Past Batch Requests</h2>
        <p>Decisions from the last {PAST_REQUEST_DAYS} days</p>

        <div className="table-card">
          {past.length === 0 ? (
            <div className="empty-state">No requests in the last {PAST_REQUEST_DAYS} days.</div>
          ) : (
            table(past, false)
          )}
        </div>
      </section>
    </div>
  );
}

// "YYYY-MM-DDTHH:mm" in local time, the format a datetime-local input expects.
const localNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function Batches({ batches, products, vendors, search, setSearch, refresh }) {
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
      const productName = products.find((p) => p.product_id === form.product_id)?.product_name || "Batch";
      setMessage(data.error || `${productName} batch created and exposed to vendors.`);
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

  // Search by what people recognise: product, shop or status.
  const query = search.toLowerCase();
  const rows = batches
    .filter(isActiveBatch)
    .map((batch) => ({
      ...batch,
      productName: getValue(batch, ["product_name"], "") ||
        products.find((p) => p.product_id === batch.product_id)?.product_name || batch.product_id || "Other",
      shop: batch.vendor_id ? vendorName(vendors, batch.vendor_id) : "",
      statusLabel: batch.status === "available" && batch.exposed === false
        ? "Hidden"
        : BATCH_STATUS_LABELS[batch.status]
    }))
    .filter((b) => [b.productName, b.shop, b.statusLabel].join(" ").toLowerCase().includes(query))
    .sort((a, b) =>
      String(getValue(b, ["manufactured_at", "created_at"], "")).localeCompare(
        String(getValue(a, ["manufactured_at", "created_at"], ""))
      )
    );

  const groups = [...new Set(rows.map((b) => b.productName))].map((name) => {
    const list = rows.filter((b) => b.productName === name);
    return { name, list, remaining: list.reduce((sum, b) => sum + Number(b.remaining_kg), 0) };
  });

  return (
    <PageLayout
      title="Batches"
      subtitle="Active batches by product: unassigned, on the way, or at a shop"
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

      {groups.length === 0 && (
        <div className="table-card">
          <div className="empty-state">No active batches.</div>
        </div>
      )}

      {groups.map((group) => (
        <div className="table-card batch-group" key={group.name}>
          <div className="batch-group-title">
            <h3>{group.name}</h3>
            <span>
              {group.list.length} active batch{group.list.length === 1 ? "" : "es"}, {Number(group.remaining.toFixed(1))} kg left
            </span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Remaining / Assigned</th>
                  <th>Manufactured</th>
                  <th>Status</th>
                  <th>Visibility</th>
                </tr>
              </thead>
              <tbody>
                {group.list.map((batch) => {
                  const low = batch.vendor_id && batch.remaining_kg <= batch.threshold_kg;
                  return (
                    <tr key={batch._id}>
                      <td><strong>{batch.shop || "Not assigned"}</strong></td>
                      <td>
                        <span className={low ? "status status-danger" : ""}>
                          {batch.remaining_kg} / {batch.volume_kg} kg
                        </span>
                      </td>
                      <td>{formatDate(getValue(batch, ["manufactured_at", "mfgTimestamp", "created_at"], ""))}</td>
                      <td>
                        <span className={statusClass(batch.status === "available" ? "pending" : "active")}>
                          {batch.statusLabel}
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
          </div>
        </div>
      ))}
    </PageLayout>
  );
}

const LOG_RANGES = [["1", "Last 24 hours"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["all", "All time"]];

function Activity({ logs, search, setSearch }) {
  const [category, setCategory] = useState("all");
  const [range, setRange] = useState("7");

  const since = range === "all" ? 0 : Date.now() - Number(range) * 86400000;
  const entries = logs.map((log) => ({ log, category: logCategory(log), time: logTime(log) }));
  const inRange = entries.filter((e) => !since || (e.time && e.time.getTime() >= since));
  const counts = inRange.reduce((acc, e) => ({ ...acc, [e.category]: (acc[e.category] || 0) + 1 }), {});
  const listed = inRange.filter(
    (e) =>
      (category === "all" || e.category === category) &&
      logText(e.log).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageLayout
      title="Activity"
      subtitle="Everything the system recorded: who did what, and the alerts it raised"
      search={search}
      setSearch={setSearch}
    >
      <div className="log-filters">
        <div className="filter-pills" role="group" aria-label="Log type">
          {LOG_CATEGORIES.map(([id, label]) => (
            <button
              key={id}
              className={`filter-pill ${category === id ? "active" : ""}`}
              aria-pressed={category === id}
              onClick={() => setCategory(id)}
            >
              {label}
              <span>{id === "all" ? inRange.length : counts[id] || 0}</span>
            </button>
          ))}
        </div>
        <select className="ai-vendor-select log-range" value={range} onChange={(e) => setRange(e.target.value)}
          aria-label="Time range">
          {LOG_RANGES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="activity-card">
        <div className="activity-list">
          {listed.map(({ log, category: kind, time }, index) => (
            <div className="activity-item" key={log._id || index}>
              <div className={`activity-icon ${log.type === "alert" ? "activity-icon-alert" : ""}`}>
                {log.type === "alert" ? <AlertTriangle size={14} /> : <FileText size={14} />}
              </div>
              <div>
                <div className="activity-text">{logText(log)}</div>
                <div className="activity-time">
                  {LOG_CATEGORIES.find(([id]) => id === kind)?.[1]}
                  {time ? ` · ${time.toLocaleString()}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>

        {listed.length === 0 && <div className="empty-state">No activity for this filter.</div>}
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
const EMPTY_PRODUCT = {
  product_name: "",
  category: "",
  unit_type: "kg",
  shelf_life_fridge_hrs: "",
  shelf_life_ambient_hrs: "",
  price: ""
};

function Products({ products, search, setSearch, refresh }) {
  const [form, setForm] = useState(EMPTY_PRODUCT);
  // product_id of the product being edited; "" means the form adds a new one.
  const [editing, setEditing] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const startEdit = (product) => {
    setEditing(product.product_id);
    setForm({
      product_name: product.product_name || "",
      category: product.category || "",
      unit_type: getValue(product, ["unit_type", "unit"], "kg"),
      shelf_life_fridge_hrs: String(getValue(product, ["shelf_life_fridge_hrs", "shelf_life_hours"], "")),
      shelf_life_ambient_hrs: String(getValue(product, ["shelf_life_ambient_hrs"], "")),
      price: String(getValue(product, ["price"], ""))
    });
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditing("");
    setForm(EMPTY_PRODUCT);
  };

  const save = async () => {
    if (!form.product_name.trim() || !form.shelf_life_fridge_hrs || !form.shelf_life_ambient_hrs) {
      setMessage("Enter a name and both shelf lives.");
      return;
    }
    const body = { ...form };
    if (body.price === "") delete body.price;

    try {
      setBusy(true);
      const data = await request(editing ? `/products/${editing}` : "/products", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(body)
      });
      setMessage(data.error || `${form.product_name} ${editing ? "updated" : "added"}.`);
      cancelEdit();
      await refresh();
    } catch (error) {
      setMessage(error.message || "Unable to save product.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (product) => {
    if (!window.confirm(`Remove ${product.product_name}? Vendors will no longer see it.`)) return;
    try {
      setBusy(true);
      const data = await request(`/products/${product.product_id}`, { method: "DELETE" });
      setMessage(data.error || `${product.product_name} removed.`);
      if (editing === product.product_id) cancelEdit();
      await refresh();
    } catch (error) {
      setMessage(error.message || "Unable to remove product.");
    } finally {
      setBusy(false);
    }
  };

  const filtered = products.filter((product) =>
    [product.product_name, product.category].join(" ").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageLayout
      title="Products"
      subtitle="Everything you sell. Shelf life sets batch expiry; the price is what customers pay."
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
          <h3>{editing ? `Edit ${products.find((p) => p.product_id === editing)?.product_name || "product"}` : "Add Product"}</h3>
          <p>
            Batters, sides like chutney or sambar, combos. The demand forecast covers Idli, Dosa
            and Combo only; other products get spoilage tracking but no forecast yet.
          </p>
        </div>

        <div className="form-grid">
          <FormField label="Name">
            <input value={form.product_name} placeholder="Coconut Chutney"
              onChange={(e) => update("product_name", e.target.value)} />
          </FormField>
          <FormField label="Category">
            <input value={form.category} placeholder="batter, side, combo"
              onChange={(e) => update("category", e.target.value)} />
          </FormField>
          <FormField label="Unit">
            <select value={form.unit_type} onChange={(e) => update("unit_type", e.target.value)}>
              <option value="kg">kg</option>
              <option value="litre">litre</option>
              <option value="pack">pack</option>
            </select>
          </FormField>
          <FormField label="Price (₹ per unit)">
            <input type="number" min="0" value={form.price}
              onChange={(e) => update("price", e.target.value)} />
          </FormField>
          <FormField label="Fridge shelf life (hours)">
            <input type="number" min="1" value={form.shelf_life_fridge_hrs}
              onChange={(e) => update("shelf_life_fridge_hrs", e.target.value)} />
          </FormField>
          <FormField label="Room shelf life (hours)">
            <input type="number" min="1" value={form.shelf_life_ambient_hrs}
              onChange={(e) => update("shelf_life_ambient_hrs", e.target.value)} />
          </FormField>
        </div>

        <div className="form-actions">
          {editing && (
            <button className="secondary-btn" onClick={cancelEdit} disabled={busy}>
              <X size={15} />
              Cancel
            </button>
          )}
          <button className="primary-btn" onClick={save} disabled={busy}>
            {editing ? <CheckCircle2 size={15} /> : <Plus size={15} />}
            {editing ? "Save Changes" : "Add Product"}
          </button>
        </div>
      </div>

      <div className="table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Price</th>
                <th>Fridge shelf life</th>
                <th>Room shelf life</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product, index) => {
                const unit = getValue(product, ["unit_type", "unit"], "kg");
                const price = getValue(product, ["price"], "");
                return (
                  <tr key={product._id || index}>
                    <td><strong>{product.product_name}</strong></td>
                    <td>{product.category ? formatStatus(product.category) : "-"}</td>
                    <td>{price === "" ? "-" : `₹${price} / ${unit}`}</td>
                    <td>{getValue(product, ["shelf_life_fridge_hrs", "shelf_life_hours"], "-")} h</td>
                    <td>{getValue(product, ["shelf_life_ambient_hrs"], "-")} h</td>
                    <td>
                      <div className="action-buttons">
                        <button className="secondary-btn small-btn" disabled={busy} onClick={() => startEdit(product)}>
                          <Pencil size={13} />
                          Edit
                        </button>
                        <button className="secondary-btn small-btn danger-btn" disabled={busy} onClick={() => remove(product)}>
                          <Trash2 size={13} />
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="empty-state">No products found.</div>}
        </div>
      </div>
    </PageLayout>
  );
}

// Bumped by the top bar's Refresh; pages that load their own data reload on it.
const RefreshContext = createContext(0);

// Loads one admin list endpoint for a page that owns its data.
function useList(url, key) {
  const refreshTick = useContext(RefreshContext);
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    request(url)
      .then((data) => live && setItems(key ? data[key] || [] : data))
      .catch((error) => live && setMessage(error.message || "Unable to load."))
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [url, key, version, refreshTick]);
  return { items, loaded, reload: () => setVersion((v) => v + 1), message, setMessage };
}

const UPCOMING_DAYS = 60;

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

  const [showAll, setShowAll] = useState(false);

  // Dates are "YYYY-MM-DD..." strings, so plain string comparison orders them.
  const dayOf = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const today = dayOf(new Date());
  const horizon = dayOf(new Date(Date.now() + UPCOMING_DAYS * 86400000));
  const sorted = [...festivals].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const upcoming = sorted.filter((f) => {
    const day = String(f.date || "").slice(0, 10);
    return day >= today && day <= horizon;
  });
  // A search always looks through every festival.
  const listed = search
    ? sorted.filter((f) => [f.festivalName, f.festivalType, f.region].join(" ").toLowerCase().includes(search.toLowerCase()))
    : showAll ? sorted : upcoming;

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
        <div className="table-card-title">
          <h3>{search ? "Search results" : showAll ? "All festivals" : "Coming up in the next two months"}</h3>
          {!search && (
            <button className="secondary-btn small-btn" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show upcoming only" : `View all ${festivals.length}`}
            </button>
          )}
        </div>
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
              {listed.map((festival, index) => (
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
          {listed.length === 0 && (
            <div className="empty-state">
              {festivals.length === 0 ? "No festivals saved." : search ? "No festivals match." : "No festivals in the next two months."}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

function App() {
  const [signedIn, setSignedIn] = useState(Boolean(authToken));
  const [page, setPage] = useState("dashboard");
  // The dashboard can open Inventory already filtered to shops that need attention.
  const [inventoryAttention, setInventoryAttention] = useState(false);
  const goTo = (next) => {
    setInventoryAttention(false);
    setPage(next);
  };
  const [mobileOpen, setMobileOpen] = useState(false);

  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [demands, setDemands] = useState([]);
  const [batches, setBatches] = useState([]);
  const [logs, setLogs] = useState([]);

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // One Refresh for every page: shared lists reload here, page-owned lists via RefreshContext.
  const refreshAll = async () => {
    setRefreshing(true);
    setRefreshTick((tick) => tick + 1);
    await loadData();
    setRefreshing(false);
  };

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
        setPage={goTo}
        open={mobileOpen}
        setOpen={setMobileOpen}
        demands={demands}
      />

      <main className="main">
        <Topbar
          title={pageTitle}
          setOpen={setMobileOpen}
          onRefresh={refreshAll}
          refreshing={refreshing}
          onSignOut={signOut}
        />

        <RefreshContext.Provider value={refreshTick}>
        <div className="content">
          {page === "dashboard" && (
            <Dashboard
              vendors={vendors}
              demands={demands}
              logs={logs}
              setPage={goTo}
              openInventory={(attention) => {
                setInventoryAttention(attention);
                setPage("inventory");
              }}
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
              vendors={vendors}
              search={search}
              setSearch={setSearch}
              refresh={loadData}
            />
          )}

          {page === "products" && (
            <Products products={products} search={search} setSearch={setSearch} refresh={loadData} />
          )}

          {page === "festivals" && <Festivals search={search} setSearch={setSearch} />}

          {page === "inventory" && (
            <Inventory
              key={inventoryAttention ? "attention" : "all"}
              search={search}
              setSearch={setSearch}
              initialAttention={inventoryAttention}
            />
          )}

          {page === "demands" && (
            <Demands demands={demands} vendors={vendors} refresh={loadData} />
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
        </RefreshContext.Provider>
      </main>
    </div>
  );
}

export default App;
