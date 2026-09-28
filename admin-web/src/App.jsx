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
  Clock3,
  XCircle,
  Menu,
  X,
  ChevronRight
} from "lucide-react";
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
    ["active", "approved", "confirmed", "synchronized", "success", "completed"].includes(
      value
    )
  )
    return "status status-success";

  if (["pending", "requested", "processing", "normal"].includes(value))
    return "status status-warning";

  if (["rejected", "cancelled", "failed", "inactive"].includes(value))
    return "status status-danger";

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
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json();
}

function Sidebar({ page, setPage, open, setOpen, demands }) {
  const items = [
    {
      title: "Overview",
      links: [
        ["dashboard", "Dashboard", LayoutDashboard]
      ]
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
      title: "System",
      links: [
        ["activity", "Activity", FileText]
      ]
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
    const quantity = Number(getValue(item, ["quantity", "stock", "available_quantity"], 0));
    const threshold = Number(
      getValue(item, ["reorder_level", "minimum_stock", "threshold"], 10)
    );
    return quantity <= threshold;
  }).length;

  const pendingDemands = demands.filter((d) => {
    const status = String(getValue(d, ["status"])).toLowerCase();
    return !["synchronized", "completed", "cancelled"].includes(status);
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

                  const status = getValue(demand, ["status"], "pending");

                  return (
                    <div className="queue-item" key={demand._id || demand.id || index}>
                      <div className="queue-main">
                        <div className="queue-title">
                          Vendor {vendor}
                        </div>
                        <div className="queue-subtitle">
                          {getValue(demand, ["priority"], "normal")} priority
                        </div>
                      </div>

                      <div className="queue-right">
                        <span className={statusClass(status)}>
                          {formatStatus(status)}
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
            <div className="snapshot-row">
              <div className="snapshot-left">
                <Store />
                Vendors
              </div>
              <span className="snapshot-count">{vendors.length}</span>
            </div>

            <div className="snapshot-row">
              <div className="snapshot-left">
                <Package />
                Products
              </div>
              <span className="snapshot-count">{products.length}</span>
            </div>

            <div className="snapshot-row">
              <div className="snapshot-left">
                <Warehouse />
                Inventory
              </div>
              <span className="snapshot-count">{inventory.length}</span>
            </div>

            <div className="snapshot-row">
              <div className="snapshot-left">
                <RefreshCw />
                Restocking
              </div>
              <span className="snapshot-count">{restocks.length}</span>
            </div>

            <div className="snapshot-row">
              <div className="snapshot-left">
                <FileText />
                Activity
              </div>
              <span className="snapshot-count">{logs.length}</span>
            </div>
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
                <div className="activity-item" key={log._id || log.id || index}>
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
                      {getValue(log, ["created_at", "timestamp", "time"], "")}
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
                      {getValue(vendor, ["name", "vendor_name", "business_name"], "-")}
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
                  getValue(item, ["reorder_level", "minimum_stock", "threshold"], 10)
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
      refresh();
    } catch (error) {
      setMessage("Unable to create demand. Check backend endpoints.");
    }
  };

  const confirmDemand = async (demand) => {
    const id = getValue(demand, ["_id", "id", "demand_id"], "");

    if (!id) return;

    try {
      await request(`/vendors/${vendorId || getValue(demand, ["vendor_id", "vendorId"])}/demands/${id}/confirm`, {
        method: "POST"
      });

      refresh();
    } catch {
      setMessage("Unable to confirm demand.");
    }
  };

  const syncInventory = async (demand) => {
    const vendor =
      vendorId || getValue(demand, ["vendor_id", "vendorId", "vendor"], "");

    try {
      await request(`/vendors/${vendor}/inventory/sync`, {
        method: "POST"
      });

      refresh();
    } catch {
      setMessage("Unable to synchronize inventory.");
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
          <div>
            <h3>Create Demand</h3>
            <p>Raise a new requirement for a vendor</p>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-group">
            <label>Vendor</label>
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
                    {id} - {getValue(vendor, ["name", "vendor_name"], "Vendor")}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="form-group">
            <label>Product</label>
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
          </div>

          <div className="form-group">
            <label>Quantity</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
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

                const status = getValue(demand, ["status"], "pending");

                const vendor = getValue(
                  demand,
                  ["vendor_id", "vendorId", "vendor"],
                  "-"
                );

                return (
                  <tr key={id || index}>
                    <td>{id}</td>
                    <td>{vendor}</td>
                    <td>
                      {formatStatus(
                        getValue(demand, ["priority"], "normal")
                      )}
                    </td>
                    <td>
                      <span className={statusClass(status)}>
                        {formatStatus(status)}
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
                const status = getValue(item, ["status"], "pending");

                return (
                  <tr key={item._id || item.id || index}>
                    <td>{getValue(item, ["_id", "id", "request_id"], "-")}</td>
                    <td>{getValue(item, ["vendor_id", "vendorId"], "-")}</td>
                    <td>{getValue(item, ["product_id", "productId"], "-")}</td>
                    <td>{getValue(item, ["quantity"], "-")}</td>
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
            <div className="activity-item" key={log._id || log.id || index}>
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
        setRestocks(Array.isArray(data) ? data : data.requests || []);
      } catch {
        setRestocks([]);
      }

      try {
        const data = await request("/logs");
        setLogs(Array.isArray(data) ? data : data.logs || []);
      } catch {
        setLogs([]);
      }

      const demandResults = await Promise.all(
        vendorList.map(async (vendor) => {
          const id = getValue(
            vendor,
            ["vendor_id", "vendorId", "id", "_id"],
            ""
          );

          if (!id) return [];

          try {
            const data = await request(`/vendors/${id}/demands`);
            return Array.isArray(data) ? data : data.demands || [];
          } catch {
            return [];
          }
        })
      );

      setDemands(demandResults.flat());
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