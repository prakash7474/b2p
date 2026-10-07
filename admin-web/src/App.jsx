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
  Users,
  UserPlus,
  LogIn,
  MapPin,
  Brain,
  BarChart3,
  Thermometer,
  ShoppingCart,
  Eye,
  EyeOff
} from "lucide-react";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from "recharts";

import "./App.css";

const API = "http://localhost:5000";

const getValue = (obj, keys, fallback = "") => {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  }
  return fallback;
};

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
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

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
        ["inventory", "Inventory", Warehouse]
      ]
    },
    {
      title: "Operations",
      links: [
        ["demands", "Demands", FileText],
        ["restocking", "Restocking", RefreshCw]
      ]
    },
    {
      title: "AI Intelligence",
      links: [
        ["forecast", "Demand Forecast", TrendingUp],
        ["spoilage", "Spoilage Risk", ShieldAlert]
      ]
    },
    {
      title: "Customers",
      links: [["customers", "Customer Accounts", Users]]
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

                {id === "demands" && demands.length > 0 && (
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
            <span>localhost:5000</span>
          </div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ title, setOpen }) {
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
  restocks,
  logs,
  setPage,
  refresh
}) {
  const pendingVendors = vendors.filter(
    (v) => String(getValue(v, ["status"])).toLowerCase() === "pending"
  ).length;

  const lowStock = inventory.filter((item) => {
    const quantity = Number(
      getValue(item, ["quantity", "stock", "available_quantity"], 0)
    );
    const threshold = Number(
      getValue(item, ["reorder_level", "minimum_stock", "threshold"], 10)
    );
    return quantity <= threshold;
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
          title="Pending Demands"
          value={pendingDemands}
          text={`${demands.length} total requests`}
        />
      </div>

      <div className="dashboard-main-grid">
        <section className="dashboard-section">
          <h2>Demand Queue</h2>
          <p>Latest vendor demand requests</p>

          <div className="dashboard-card">
            {demands.length === 0 ? (
              <div className="demand-empty">
                <FileText size={25} />
                <p>No demand requests found.</p>
                <button
                  className="open-demand-btn"
                  onClick={() => setPage("demands")}
                >
                  Open demand center <ChevronRight size={13} />
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
              label="Restocking"
              value={restocks.length}
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

function Vendors({ vendors, search, setSearch }) {
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((vendor, index) => {
                const status = getValue(vendor, ["status"], "active");

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

function Products({ products, search, setSearch }) {
  const filtered = products.filter((product) =>
    JSON.stringify(product).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageLayout
      title="Products"
      subtitle="Product catalog and details"
      search={search}
      setSearch={setSearch}
    >
      <div className="table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Product ID</th>
                <th>Product</th>
                <th>Category</th>
                <th>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product, index) => {
                const status = getValue(product, ["status"], "active");

                return (
                  <tr key={product._id || product.id || index}>
                    <td>
                      {getValue(
                        product,
                        ["product_id", "productId", "id", "_id"],
                        "-"
                      )}
                    </td>
                    <td>
                      {getValue(product, ["name", "product_name", "title"], "-")}
                    </td>
                    <td>{getValue(product, ["category", "type"], "-")}</td>
                    <td>₹{getValue(product, ["price", "unit_price"], "-")}</td>
                    <td>
                      <span className={statusClass(status)}>
                        {formatStatus(status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="empty-state">No products found.</div>
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
                const reorder = Number(
                  getValue(
                    item,
                    ["reorder_level", "minimum_stock", "threshold"],
                    10
                  )
                );
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
                        ["product_id", "productId", "product"],
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

function Demands({ demands, vendors, inventory, refresh }) {
  const [vendorId, setVendorId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [priority, setPriority] = useState("normal");
  const [message, setMessage] = useState("");

  const vendorInventory = inventory.filter(
    (item) =>
      String(getValue(item, ["vendor_id", "vendorId", "vendor"], "")) ===
      String(vendorId)
  );

  const createDemand = async () => {
    if (!vendorId || !productId || !quantity) {
      setMessage("Please fill all demand fields.");
      return;
    }

    try {
      await request(`/vendors/${vendorId}/demands`, {
        method: "POST",
        body: JSON.stringify({
          items: [
            {
              product_id: productId,
              quantity: Number(quantity)
            }
          ],
          priority
        })
      });

      setMessage("Demand created successfully.");
      setQuantity("");
      await refresh();
    } catch (error) {
      setMessage(error.message || "Unable to create demand.");
    }
  };

  const confirmDemand = async (demand) => {
    const id = getValue(demand, ["_id", "id", "demand_id"], "");
    const vendor =
      vendorId || getValue(demand, ["vendor_id", "vendorId", "vendor"], "");

    if (!id || !vendor) return;

    try {
      await request(`/vendors/${vendor}/demands/${id}/confirm`, {
        method: "POST"
      });
      await refresh();
    } catch (error) {
      setMessage(error.message || "Unable to confirm demand.");
    }
  };

  const syncInventory = async (demand) => {
    const vendor =
      vendorId || getValue(demand, ["vendor_id", "vendorId", "vendor"], "");

    if (!vendor) return;

    try {
      await request(`/vendors/${vendor}/inventory/sync`, {
        method: "POST"
      });
      await refresh();
    } catch (error) {
      setMessage(error.message || "Unable to synchronize inventory.");
    }
  };

  return (
    <div>
      <div className="page-heading-large">
        <h1>Demand Center</h1>
        <p>Create, confirm and synchronize vendor demands</p>
      </div>

      {message && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          {message}
        </div>
      )}

      <div className="form-card">
        <div className="form-card-title">
          <h3>Create Demand</h3>
          <p>Raise a new requirement for a vendor</p>
        </div>

        <div className="form-grid">
          <FormField label="Vendor">
            <select
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                setProductId("");
              }}
            >
              <option value="">Select vendor</option>
              {vendors.map((vendor, index) => {
                const id = getValue(
                  vendor,
                  ["vendor_id", "vendorId", "id", "_id"],
                  ""
                );

                return (
                  <option key={id || index} value={id}>
                    {id} - {getValue(vendor, ["shop_name", "name"], "Vendor")}
                  </option>
                );
              })}
            </select>
          </FormField>

          <FormField label="Product">
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">Select product</option>
              {vendorInventory.map((item, index) => {
                const id = getValue(
                  item,
                  ["product_id", "productId", "product"],
                  ""
                );

                return (
                  <option key={id || index} value={id}>
                    {id}
                  </option>
                );
              })}
            </select>
          </FormField>

          <FormField label="Quantity">
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </FormField>

          <FormField label="Priority">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </FormField>
        </div>

        <div className="form-actions">
          <button className="primary-btn" onClick={createDemand}>
            <FileText size={15} />
            Create Demand
          </button>
        </div>
      </div>

      <div className="page-heading-small">
        <h2>Demand Requests</h2>
        <p>Manage current vendor demand requests</p>
      </div>

      <div className="table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Demand ID</th>
                <th>Vendor</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {demands.map((demand, index) => {
                const id = getValue(
                  demand,
                  ["_id", "id", "demand_id"],
                  "-"
                );
                const value = getValue(demand, ["status"], "pending");
                const vendor = getValue(
                  demand,
                  ["vendor_id", "vendorId", "vendor"],
                  "-"
                );

                return (
                  <tr key={id || index}>
                    <td>{id}</td>
                    <td>{vendor}</td>
                    <td>{formatStatus(getValue(demand, ["priority"], "normal"))}</td>
                    <td>
                      <span className={statusClass(value)}>
                        {formatStatus(value)}
                      </span>
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button
                          className="secondary-btn small-btn"
                          onClick={() => confirmDemand(demand)}
                        >
                          <CheckCircle2 size={13} />
                          Confirm
                        </button>

                        <button
                          className="primary-btn small-btn"
                          onClick={() => syncInventory(demand)}
                        >
                          <RefreshCw size={13} />
                          Sync
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {demands.length === 0 && (
            <div className="empty-state">
              <FileText size={28} />
              <h3>No demand requests</h3>
              <p>Create a demand request using the form above.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Restocking({ restocks, search, setSearch }) {
  const filtered = restocks.filter((item) =>
    JSON.stringify(item).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageLayout
      title="Restocking"
      subtitle="Monitor restock requests"
      search={search}
      setSearch={setSearch}
    >
      <div className="table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Request ID</th>
                <th>Vendor</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, index) => {
                const value = getValue(item, ["status"], "pending");

                return (
                  <tr key={item._id || item.id || index}>
                    <td>
                      {getValue(item, ["_id", "id", "request_id"], "-")}
                    </td>
                    <td>{getValue(item, ["vendor_id", "vendorId"], "-")}</td>
                    <td>{getValue(item, ["product_id", "productId"], "-")}</td>
                    <td>{getValue(item, ["quantity"], "-")}</td>
                    <td>
                      <span className={statusClass(value)}>
                        {formatStatus(value)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="empty-state">No restock requests found.</div>
          )}
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

function DemandForecast({ vendors }) {
  const [vendorId, setVendorId] = useState("");
  const [forecast, setForecast] = useState([]);
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
      setForecast(Array.isArray(data) ? data : data.forecast || []);
    } catch (error) {
      setForecast([]);
      setMessage(error.message || "Unable to load demand forecast.");
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => {
    return forecast.reduce(
      (acc, item) => {
        acc.predicted += Number(item.predicted_demand || 0);
        acc.order += Number(item.recommended_order || 0);
        if (Number(item.recommended_order || 0) > 0) acc.restock += 1;
        return acc;
      },
      { predicted: 0, order: 0, restock: 0 }
    );
  }, [forecast]);

  const chartData = forecast.map((item) => ({
    product: String(item.product_name || "Product").slice(0, 16),
    predicted: Number(item.predicted_demand || 0),
    stock: Number(item.current_stock || 0)
  }));

  return (
    <div className="ai-page">
      <div className="page-heading-large">
        <div className="ai-title-row">
          <div className="ai-page-icon">
            <Brain size={22} />
          </div>
          <div>
            <h1>Demand Forecast</h1>
            <p>AI-powered vendor demand prediction and recommended ordering</p>
          </div>
        </div>
      </div>

      <div className="ai-selector-card">
        <div>
          <div className="ai-selector-title">Select Vendor</div>
          <div className="ai-selector-description">
            Fetch the latest demand prediction for one vendor.
          </div>
        </div>

        <div className="ai-selector-controls">
          <select
            className="ai-vendor-select"
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              loadForecast(e.target.value);
            }}
          >
            <option value="">Select vendor</option>
            {vendors.map((vendor, index) => {
              const id = getValue(
                vendor,
                ["vendor_id", "vendorId", "id", "_id"],
                ""
              );

              return (
                <option key={id || index} value={id}>
                  {getValue(vendor, ["shop_name", "name"], "Vendor")} - {id}
                </option>
              );
            })}
          </select>

          <button
            className="primary-btn"
            onClick={() => loadForecast()}
            disabled={!vendorId || loading}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            Refresh Forecast
          </button>
        </div>
      </div>

      {message && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          {message}
        </div>
      )}

      <div className="ai-stats-grid">
        <AIStat
          icon={TrendingUp}
          title="Total Predicted Demand"
          value={totals.predicted}
          text="units"
        />
        <AIStat
          icon={ShoppingCart}
          title="Recommended Order"
          value={totals.order}
          text="units"
        />
        <AIStat
          icon={BarChart3}
          title="Products Analyzed"
          value={forecast.length}
          text="products"
        />
        <AIStat
          icon={AlertTriangle}
          title="Need Restocking"
          value={totals.restock}
          text="products"
        />
      </div>

      {!vendorId ? (
        <AIEmpty
          icon={TrendingUp}
          title="Select a vendor"
          text="Choose a vendor above to view the demand forecast."
        />
      ) : forecast.length === 0 && !loading ? (
        <AIEmpty
          icon={TrendingUp}
          title="No forecast data"
          text="The backend did not return forecast records for this vendor."
        />
      ) : (
        <>
          <div className="ai-chart-card">
            <div className="ai-card-header">
              <div>
                <h3>Predicted Demand vs Current Stock</h3>
                <p>Product-level forecast comparison</p>
              </div>
            </div>

            <div className="chart-container">
              <ResponsiveContainer width="100%" height={330}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="product" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="predicted" name="Predicted Demand" />
                  <Bar dataKey="stock" name="Current Stock" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="ai-table-card">
            <div className="ai-card-header">
              <div>
                <h3>Forecast Details</h3>
                <p>Recommended action for each product</p>
              </div>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Predicted Demand</th>
                    <th>Current Stock</th>
                    <th>Safety Stock</th>
                    <th>Recommended Order</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((item, index) => {
                    const order = Number(item.recommended_order || 0);
                    return (
                      <tr key={item.product_name || index}>
                        <td><strong>{item.product_name || "-"}</strong></td>
                        <td>{item.predicted_demand ?? 0}</td>
                        <td>{item.current_stock ?? 0}</td>
                        <td>{item.safety_stock ?? 0}</td>
                        <td>
                          <span className={order > 0 ? "order-highlight" : ""}>
                            {order}
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              order > 0
                                ? "status status-warning"
                                : "status status-success"
                            }
                          >
                            {order > 0 ? "Restock Needed" : "Stock Healthy"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SpoilageRisk({ vendors }) {
  const [vendorId, setVendorId] = useState("");
  const [evaluations, setEvaluations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadRisk = async (id = vendorId) => {
    if (!id) {
      setEvaluations([]);
      return;
    }

    try {
      setLoading(true);
      setMessage("");
      const data = await request(`/vendors/${id}/spoilage-risk`);
      setEvaluations(data.evaluations || []);
      if (data.message) setMessage(data.message);
    } catch (error) {
      setEvaluations([]);
      setMessage(error.message || "Unable to load spoilage risk.");
    } finally {
      setLoading(false);
    }
  };

  const counts = useMemo(() => {
    return evaluations.reduce(
      (acc, item) => {
        const risk = String(item.risk_label || "").toLowerCase();
        if (risk === "high") acc.high += 1;
        else if (risk === "medium") acc.medium += 1;
        else acc.normal += 1;
        return acc;
      },
      { high: 0, medium: 0, normal: 0 }
    );
  }, [evaluations]);

  return (
    <div className="ai-page">
      <div className="page-heading-large">
        <div className="ai-title-row">
          <div className="ai-page-icon danger-ai">
            <ShieldAlert size={22} />
          </div>
          <div>
            <h1>Spoilage Risk</h1>
            <p>AI-based batch risk evaluation and recommended actions</p>
          </div>
        </div>
      </div>

      <div className="ai-selector-card">
        <div>
          <div className="ai-selector-title">Select Vendor</div>
          <div className="ai-selector-description">
            Analyze active batches for spoilage risk.
          </div>
        </div>

        <div className="ai-selector-controls">
          <select
            className="ai-vendor-select"
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              loadRisk(e.target.value);
            }}
          >
            <option value="">Select vendor</option>
            {vendors.map((vendor, index) => {
              const id = getValue(
                vendor,
                ["vendor_id", "vendorId", "id", "_id"],
                ""
              );

              return (
                <option key={id || index} value={id}>
                  {getValue(vendor, ["shop_name", "name"], "Vendor")} - {id}
                </option>
              );
            })}
          </select>

          <button
            className="primary-btn"
            onClick={() => loadRisk()}
            disabled={!vendorId || loading}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            Refresh Risk
          </button>
        </div>
      </div>

      {message && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          {message}
        </div>
      )}

      <div className="ai-stats-grid">
        <AIStat
          icon={ShieldAlert}
          title="High Risk"
          value={counts.high}
          text="batches"
          danger
        />
        <AIStat
          icon={Thermometer}
          title="Medium Risk"
          value={counts.medium}
          text="batches"
        />
        <AIStat
          icon={CheckCircle2}
          title="Normal"
          value={counts.normal}
          text="batches"
        />
        <AIStat
          icon={Package}
          title="Total Batches"
          value={evaluations.length}
          text="evaluated"
        />
      </div>

      {!vendorId ? (
        <AIEmpty
          icon={ShieldAlert}
          title="Select a vendor"
          text="Choose a vendor above to evaluate spoilage risk."
          danger
        />
      ) : evaluations.length === 0 && !loading ? (
        <AIEmpty
          icon={ShieldAlert}
          title="No active batches"
          text="The backend did not return active batches for this vendor."
          danger
        />
      ) : (
        <div className="ai-table-card">
          <div className="ai-card-header">
            <div>
              <h3>Batch Risk Evaluation</h3>
              <p>Risk probabilities and recommended action</p>
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Batch ID</th>
                  <th>Product</th>
                  <th>Risk</th>
                  <th>Probabilities</th>
                  <th>Recommended Action</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.map((item, index) => {
                  const risk = String(item.risk_label || "Normal");
                  const probabilities = item.probabilities || {};

                  return (
                    <tr key={item.batch_id || index}>
                      <td>{item.batch_id || "-"}</td>
                      <td><strong>{item.product_name || "-"}</strong></td>
                      <td>
                        <span className={statusClass(risk)}>
                          {risk}
                        </span>
                      </td>
                      <td>
                        <div className="probability-list">
                          <span>High: {formatProbability(probabilities.High)}</span>
                          <span>Medium: {formatProbability(probabilities.Medium)}</span>
                          <span>Normal: {formatProbability(probabilities.Normal)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="risk-action">
                          {item.action || "No action specified"}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function formatProbability(value) {
  const number = Number(value || 0);
  return `${(number * 100).toFixed(1)}%`;
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

function Customers() {
  const [mode, setMode] = useState("register");
  const [showPassword, setShowPassword] = useState(false);

  const [registerForm, setRegisterForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    latitude: "",
    longitude: "",
    address: ""
  });

  const [loginForm, setLoginForm] = useState({
    login: "",
    password: "",
    latitude: "",
    longitude: "",
    address: ""
  });

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(false);

  const updateRegister = (field, value) => {
    setRegisterForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateLogin = (field, value) => {
    setLoginForm((prev) => ({ ...prev, [field]: value }));
  };

  const register = async () => {
    if (
      !registerForm.name.trim() ||
      !registerForm.email.trim() ||
      !registerForm.password
    ) {
      setMessageType("error");
      setMessage("Name, email, and password are required.");
      return;
    }

    try {
      setLoading(true);
      setMessage("");

      const payload = {
        name: registerForm.name,
        email: registerForm.email,
        password: registerForm.password,
        phone: registerForm.phone,
        location: {
          latitude: registerForm.latitude
            ? Number(registerForm.latitude)
            : null,
          longitude: registerForm.longitude
            ? Number(registerForm.longitude)
            : null,
          address: registerForm.address
        }
      };

      const data = await request("/customers/register", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setCustomer(data.customer || null);
      setMessageType("success");
      setMessage(data.message || "Customer registered successfully.");

      setRegisterForm({
        name: "",
        email: "",
        password: "",
        phone: "",
        latitude: "",
        longitude: "",
        address: ""
      });
    } catch (error) {
      setMessageType("error");
      setMessage(error.message || "Customer registration failed.");
    } finally {
      setLoading(false);
    }
  };

  const login = async () => {
    if (!loginForm.login.trim() || !loginForm.password) {
      setMessageType("error");
      setMessage("Login email/phone and password are required.");
      return;
    }

    try {
      setLoading(true);
      setMessage("");

      const locationProvided =
        loginForm.latitude || loginForm.longitude || loginForm.address;

      const payload = {
        login: loginForm.login,
        password: loginForm.password
      };

      if (locationProvided) {
        payload.location = {
          latitude: loginForm.latitude
            ? Number(loginForm.latitude)
            : null,
          longitude: loginForm.longitude
            ? Number(loginForm.longitude)
            : null,
          address: loginForm.address
        };
      }

      const data = await request("/customers/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setCustomer(data.customer || null);
      setMessageType("success");
      setMessage(data.message || "Customer login successful.");
    } catch (error) {
      setCustomer(null);
      setMessageType("error");
      setMessage(error.message || "Customer login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="customer-page">
      <div className="page-heading-large">
        <div className="customer-title-row">
          <div className="customer-page-icon">
            <Users size={22} />
          </div>
          <div>
            <h1>Customer Accounts</h1>
            <p>Register and test customer authentication using the new backend APIs</p>
          </div>
        </div>
      </div>

      <div className="customer-layout">
        <section className="customer-card">
          <div className="customer-tabs">
            <button
              className={mode === "register" ? "customer-tab active" : "customer-tab"}
              onClick={() => {
                setMode("register");
                setMessage("");
              }}
            >
              <UserPlus size={15} />
              Register
            </button>

            <button
              className={mode === "login" ? "customer-tab active" : "customer-tab"}
              onClick={() => {
                setMode("login");
                setMessage("");
              }}
            >
              <LogIn size={15} />
              Login
            </button>
          </div>

          {message && (
            <div
              className={`customer-message ${
                messageType === "success" ? "success" : "error"
              }`}
            >
              {message}
            </div>
          )}

          {mode === "register" ? (
            <div className="customer-form">
              <div className="customer-form-header">
                <h3>Create Customer Account</h3>
                <p>Uses POST /customers/register</p>
              </div>

              <div className="form-grid customer-grid">
                <FormField label="Name *">
                  <input
                    value={registerForm.name}
                    onChange={(e) => updateRegister("name", e.target.value)}
                    placeholder="Customer name"
                  />
                </FormField>

                <FormField label="Email *">
                  <input
                    type="email"
                    value={registerForm.email}
                    onChange={(e) => updateRegister("email", e.target.value)}
                    placeholder="customer@example.com"
                  />
                </FormField>

                <FormField label="Password *">
                  <PasswordInput
                    value={registerForm.password}
                    show={showPassword}
                    onChange={(value) => updateRegister("password", value)}
                    onToggle={() => setShowPassword((prev) => !prev)}
                  />
                </FormField>

                <FormField label="Phone">
                  <input
                    value={registerForm.phone}
                    onChange={(e) => updateRegister("phone", e.target.value)}
                    placeholder="Phone number"
                  />
                </FormField>

                <FormField label="Latitude">
                  <input
                    type="number"
                    value={registerForm.latitude}
                    onChange={(e) => updateRegister("latitude", e.target.value)}
                    placeholder="13.0827"
                  />
                </FormField>

                <FormField label="Longitude">
                  <input
                    type="number"
                    value={registerForm.longitude}
                    onChange={(e) => updateRegister("longitude", e.target.value)}
                    placeholder="80.2707"
                  />
                </FormField>

                <FormField label="Address" wide>
                  <input
                    value={registerForm.address}
                    onChange={(e) => updateRegister("address", e.target.value)}
                    placeholder="Customer address"
                  />
                </FormField>
              </div>

              <div className="customer-form-footer">
                <span>
                  <MapPin size={14} />
                  Location is stored with the customer account.
                </span>

                <button
                  className="primary-btn"
                  onClick={register}
                  disabled={loading}
                >
                  <UserPlus size={15} />
                  {loading ? "Registering..." : "Register Customer"}
                </button>
              </div>
            </div>
          ) : (
            <div className="customer-form">
              <div className="customer-form-header">
                <h3>Customer Login</h3>
                <p>Uses POST /customers/login</p>
              </div>

              <div className="form-grid customer-grid">
                <FormField label="Email or Phone *">
                  <input
                    value={loginForm.login}
                    onChange={(e) => updateLogin("login", e.target.value)}
                    placeholder="Email or phone"
                  />
                </FormField>

                <FormField label="Password *">
                  <PasswordInput
                    value={loginForm.password}
                    show={showPassword}
                    onChange={(value) => updateLogin("password", value)}
                    onToggle={() => setShowPassword((prev) => !prev)}
                  />
                </FormField>

                <FormField label="Latitude">
                  <input
                    type="number"
                    value={loginForm.latitude}
                    onChange={(e) => updateLogin("latitude", e.target.value)}
                    placeholder="Optional"
                  />
                </FormField>

                <FormField label="Longitude">
                  <input
                    type="number"
                    value={loginForm.longitude}
                    onChange={(e) => updateLogin("longitude", e.target.value)}
                    placeholder="Optional"
                  />
                </FormField>

                <FormField label="Address" wide>
                  <input
                    value={loginForm.address}
                    onChange={(e) => updateLogin("address", e.target.value)}
                    placeholder="Optional updated address"
                  />
                </FormField>
              </div>

              <div className="customer-form-footer">
                <span>
                  <MapPin size={14} />
                  Sending a location updates the customer's saved location.
                </span>

                <button
                  className="primary-btn"
                  onClick={login}
                  disabled={loading}
                >
                  <LogIn size={15} />
                  {loading ? "Logging in..." : "Login Customer"}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="customer-result-card">
          <div className="customer-result-header">
            <div className="customer-result-icon">
              <Users size={18} />
            </div>
            <div>
              <h3>Account Result</h3>
              <p>Latest API response</p>
            </div>
          </div>

          {customer ? (
            <div className="customer-result">
              <div className="result-status">
                <CheckCircle2 size={17} />
                Customer authenticated
              </div>

              <ResultRow label="Customer ID" value={customer.customer_id || customer._id} />
              <ResultRow label="Name" value={customer.name} />
              <ResultRow label="Email" value={customer.email} />
              <ResultRow label="Phone" value={customer.phone || "-"} />

              <div className="result-location">
                <div className="result-location-title">
                  <MapPin size={14} />
                  Location
                </div>
                <pre>{JSON.stringify(customer.location || {}, null, 2)}</pre>
              </div>
            </div>
          ) : (
            <div className="customer-result-empty">
              <Users size={25} />
              <h3>No customer response yet</h3>
              <p>Register or login to see the backend response here.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PasswordInput({ value, show, onChange, onToggle }) {
  return (
    <div className="password-field">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Password"
      />
      <button type="button" onClick={onToggle}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

function ResultRow({ label, value }) {
  return (
    <div className="result-row">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
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

function App() {
  const [page, setPage] = useState("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);

  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [demands, setDemands] = useState([]);
  const [restocks, setRestocks] = useState([]);
  const [logs, setLogs] = useState([]);

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);

      const vendorData = await request("/vendors");
      const vendorList = Array.isArray(vendorData)
        ? vendorData
        : vendorData.vendors || [];

      setVendors(vendorList);

      const productResults = await Promise.all(
        vendorList.map(async (vendor) => {
          const id = getValue(
            vendor,
            ["vendor_id", "vendorId", "id", "_id"],
            ""
          );

          if (!id) return [];

          try {
            const data = await request(`/vendors/${id}/products`);
            return Array.isArray(data) ? data : data.products || [];
          } catch {
            return [];
          }
        })
      );

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

      setProducts(productResults.flat());
      setInventory(inventoryResults.flat());

      try {
        const data = await request("/restock-requests");
        setRestocks(
          Array.isArray(data)
            ? data
            : data.restock_requests || data.requests || []
        );
      } catch {
        setRestocks([]);
      }

      try {
        const data = await request("/logs");
        setLogs(Array.isArray(data) ? data : data.logs || []);
      } catch {
        setLogs([]);
      }

      // The backend exposes restock requests for demands. The older
      // GET /vendors/{id}/demands route is not guaranteed to exist.
      const demandResults = await Promise.all(
        vendorList.map(async (vendor) => {
          const id = getValue(
            vendor,
            ["vendor_id", "vendorId", "id", "_id"],
            ""
          );

          if (!id) return [];

          try {
            const data = await request(`/restock-requests?vendor_id=${id}`);
            return Array.isArray(data)
              ? data
              : data.restock_requests || [];
          } catch {
            return [];
          }
        })
      );

      const uniqueDemands = [];
      const seen = new Set();

      demandResults.flat().forEach((demand) => {
        const id = getValue(
          demand,
          ["_id", "id", "demand_id", "request_id"],
          JSON.stringify(demand)
        );

        if (!seen.has(String(id))) {
          seen.add(String(id));
          uniqueDemands.push(demand);
        }
      });

      setDemands(uniqueDemands);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    setSearch("");
  }, [page]);

  const pageTitle = useMemo(() => {
    const titles = {
      dashboard: "Dashboard",
      vendors: "Vendors",
      products: "Products",
      inventory: "Inventory",
      demands: "Demands",
      restocking: "Restocking",
      forecast: "Demand Forecast",
      spoilage: "Spoilage Risk",
      customers: "Customer Accounts",
      activity: "Activity"
    };

    return titles[page] || "Dashboard";
  }, [page]);

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
        <Topbar title={pageTitle} setOpen={setMobileOpen} />

        <div className="content">
          {page === "dashboard" && (
            <Dashboard
              vendors={vendors}
              products={products}
              inventory={inventory}
              demands={demands}
              restocks={restocks}
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
            />
          )}

          {page === "products" && (
            <Products
              products={products}
              search={search}
              setSearch={setSearch}
            />
          )}

          {page === "inventory" && (
            <Inventory
              inventory={inventory}
              search={search}
              setSearch={setSearch}
            />
          )}

          {page === "demands" && (
            <Demands
              demands={demands}
              vendors={vendors}
              inventory={inventory}
              refresh={loadData}
            />
          )}

          {page === "restocking" && (
            <Restocking
              restocks={restocks}
              search={search}
              setSearch={setSearch}
            />
          )}

          {page === "forecast" && <DemandForecast vendors={vendors} />}

          {page === "spoilage" && <SpoilageRisk vendors={vendors} />}

          {page === "customers" && <Customers />}

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
