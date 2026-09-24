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

function getValue(obj, keys, fallback = "-") {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== "") {
      return obj[key];
    }
  }
  return fallback;
}

function formatStatus(value) {
  if (!value) return "Unknown";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function statusClass(value) {
  const s = String(value || "").toLowerCase();

  if (["active", "approved", "verified", "completed", "success"].includes(s)) {
    return "status active";
  }

  if (["pending", "processing", "requested"].includes(s)) {
    return "status pending";
  }

  if (["rejected", "cancelled", "failed", "inactive"].includes(s)) {
    return "status danger";
  }

  return "status neutral";
}

function Sidebar({ page, setPage, open, setOpen }) {
  const items = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "vendors", label: "Vendors", icon: Store },
    { key: "products", label: "Products", icon: Package },
    { key: "inventory", label: "Inventory", icon: Warehouse },
    { key: "restocking", label: "Restocking", icon: RefreshCw },
    { key: "logs", label: "Activity Logs", icon: FileText }
  ];

  return (
    <>
      <div
        className={`mobile-overlay ${open ? "show" : ""}`}
        onClick={() => setOpen(false)}
      />

      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">B2P</div>

          <div>
            <div className="brand-title">B2P</div>
            <div className="brand-subtitle">Manufacturer Portal</div>
          </div>

          <button
            className="mobile-close"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="nav-label">MAIN MENU</div>

        <nav>
          {items.map(item => {
            const Icon = item.icon;

            return (
              <button
                key={item.key}
                className={`nav-item ${page === item.key ? "selected" : ""}`}
                onClick={() => {
                  setPage(item.key);
                  setOpen(false);
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>

                {page === item.key && (
                  <ChevronRight size={16} className="nav-arrow" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection">
            <span className="connection-dot" />
            Backend Connected
          </div>

          <div className="backend-url">
            localhost:5000
          </div>
        </div>
      </aside>
    </>
  );
}

function PageHeader({
  title,
  subtitle,
  onRefresh,
  refreshing
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <button
        className="refresh-btn"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <RefreshCw
          size={17}
          className={refreshing ? "spin" : ""}
        />
        Refresh
      </button>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  note,
  danger
}) {
  return (
    <div className={`stat-card ${danger ? "danger-card" : ""}`}>
      <div className="stat-top">
        <div className="stat-title">{title}</div>

        <div className="stat-icon">
          <Icon size={19} />
        </div>
      </div>

      <div className="stat-value">{value}</div>

      {note && (
        <div className="stat-note">
          {note}
        </div>
      )}
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder = "Search..."
}) {
  return (
    <div className="search-box">
      <Search size={17} />

      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="empty-state">
      {message}
    </div>
  );
}

function ErrorBox({ message }) {
  if (!message) return null;

  return (
    <div className="error-box">
      {message}
    </div>
  );
}

function Dashboard({
  data,
  loading,
  error,
  refresh,
  setPage
}) {
  const {
    vendors,
    products,
    inventory,
    restocks,
    logs
  } = data;

  const pendingVendors = vendors.filter(v => {
    const status = String(
      getValue(v, ["status", "verificationStatus"], "")
    ).toLowerCase();

    return status === "pending";
  }).length;

  const lowStock = inventory.filter(item => {
    const qty = Number(
      getValue(
        item,
        [
          "quantity",
          "current_stock",
          "stock",
          "quantity_kg"
        ],
        NaN
      )
    );

    return Number.isFinite(qty) && qty <= 20;
  }).length;

  const pendingRestocks = restocks.filter(r =>
    String(
      getValue(r, ["status"], "")
    ).toLowerCase() === "pending"
  ).length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your manufacturer operations"
        onRefresh={refresh}
        refreshing={loading}
      />

      <ErrorBox message={error} />

      <div className="stats-grid">
        <StatCard
          title="Total Vendors"
          value={vendors.length}
          icon={Store}
          note={`${pendingVendors} pending approval`}
        />

        <StatCard
          title="Total Products"
          value={products.length}
          icon={Package}
          note="From vendor product catalog"
        />

        <StatCard
          title="Inventory Records"
          value={inventory.length}
          icon={Warehouse}
          note={`${lowStock} low-stock records`}
          danger={lowStock > 0}
        />

        <StatCard
          title="Pending Restocks"
          value={pendingRestocks}
          icon={RefreshCw}
          note={`${restocks.length} total requests`}
        />
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Recent Activity</h2>
              <p>Latest records from the backend logs</p>
            </div>

            <button
              className="text-btn"
              onClick={() => setPage("logs")}
            >
              View all
            </button>
          </div>

          {logs.length === 0 ? (
            <EmptyState message="No activity logs found." />
          ) : (
            <div className="activity-list">
              {logs.slice(0, 6).map((log, index) => (
                <div
                  className="activity-row"
                  key={log._id || index}
                >
                  <div className="activity-icon">
                    <FileText size={16} />
                  </div>

                  <div className="activity-content">
                    <strong>
                      {formatStatus(
                        getValue(
                          log,
                          ["action", "type"],
                          "Activity"
                        )
                      )}
                    </strong>

                    <span>
                      {getValue(
                        log,
                        ["message"],
                        "System activity recorded"
                      )}
                    </span>
                  </div>

                  <span className="activity-id">
                    {getValue(
                      log,
                      ["vendor_id", "request_id"],
                      ""
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>System Overview</h2>
              <p>Available backend modules</p>
            </div>
          </div>

          <div className="module-list">
            <button onClick={() => setPage("vendors")}>
              <span>
                <Store size={18} />
                Vendors
              </span>

              <strong>{vendors.length}</strong>
            </button>

            <button onClick={() => setPage("products")}>
              <span>
                <Package size={18} />
                Products
              </span>

              <strong>{products.length}</strong>
            </button>

            <button onClick={() => setPage("inventory")}>
              <span>
                <Warehouse size={18} />
                Inventory
              </span>

              <strong>{inventory.length}</strong>
            </button>

            <button onClick={() => setPage("restocking")}>
              <span>
                <RefreshCw size={18} />
                Restocking
              </span>

              <strong>{restocks.length}</strong>
            </button>

            <button onClick={() => setPage("logs")}>
              <span>
                <FileText size={18} />
                Activity Logs
              </span>

              <strong>{logs.length}</strong>
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

function Vendors({
  vendors,
  loading,
  error,
  refresh
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();

    return vendors.filter(v =>
      [
        getValue(v, ["shop_name", "vendor_name", "name"], ""),
        getValue(v, ["owner_name", "owner"], ""),
        getValue(
          v,
          ["phone", "contact", "contact_number"],
          ""
        ),
        getValue(v, ["vendor_id", "user_id"], ""),
        getValue(
          v,
          ["status", "verificationStatus"],
          ""
        )
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [vendors, search]);

  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle="Manage registered partner shops"
        onRefresh={refresh}
        refreshing={loading}
      />

      <ErrorBox message={error} />

      <div className="stats-grid compact">
        <StatCard
          title="Total Vendors"
          value={vendors.length}
          icon={Store}
        />

        <StatCard
          title="Pending"
          value={
            vendors.filter(v =>
              String(
                getValue(
                  v,
                  ["status", "verificationStatus"],
                  ""
                )
              ).toLowerCase() === "pending"
            ).length
          }
          icon={Clock3}
        />

        <StatCard
          title="Approved / Active"
          value={
            vendors.filter(v =>
              [
                "approved",
                "active",
                "verified"
              ].includes(
                String(
                  getValue(
                    v,
                    ["status", "verificationStatus"],
                    ""
                  )
                ).toLowerCase()
              )
            ).length
          }
          icon={CheckCircle2}
        />
      </div>

      <section className="panel">
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search vendors..."
          />

          <span className="result-count">
            {filtered.length} vendors
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState message="No vendors found." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Owner</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Vendor ID</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((vendor, index) => {
                  const status = getValue(
                    vendor,
                    ["status", "verificationStatus"],
                    "Unknown"
                  );

                  return (
                    <tr
                      key={
                        vendor._id ||
                        vendor.vendor_id ||
                        index
                      }
                    >
                      <td>
                        <div className="primary-cell">
                          {getValue(
                            vendor,
                            [
                              "shop_name",
                              "vendor_name",
                              "name"
                            ]
                          )}
                        </div>
                      </td>

                      <td>
                        {getValue(
                          vendor,
                          ["owner_name", "owner"]
                        )}
                      </td>

                      <td>
                        {getValue(
                          vendor,
                          [
                            "phone",
                            "contact",
                            "contact_number"
                          ]
                        )}
                      </td>

                      <td>
                        <span className={statusClass(status)}>
                          {formatStatus(status)}
                        </span>
                      </td>

                      <td className="mono">
                        {getValue(
                          vendor,
                          ["vendor_id", "user_id"]
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Products({
  products,
  loading,
  error,
  refresh
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();

    return products.filter(p =>
      [
        getValue(
          p,
          ["product_name", "name", "product"],
          ""
        ),
        getValue(p, ["category"], ""),
        getValue(
          p,
          ["unit_type", "unit"],
          ""
        ),
        getValue(p, ["product_id"], "")
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [products, search]);

  const batterCount = products.filter(p =>
    String(
      getValue(p, ["category"], "")
    )
      .toLowerCase()
      .includes("batter")
  ).length;

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Product catalog available through vendor inventory"
        onRefresh={refresh}
        refreshing={loading}
      />

      <ErrorBox message={error} />

      <div className="stats-grid compact">
        <StatCard
          title="Total Products"
          value={products.length}
          icon={Package}
        />

        <StatCard
          title="Batter Products"
          value={batterCount}
          icon={Package}
        />

        <StatCard
          title="Other Products"
          value={Math.max(
            products.length - batterCount,
            0
          )}
          icon={Package}
        />
      </div>

      <section className="panel">
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search products..."
          />

          <span className="result-count">
            {filtered.length} products
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState message="No products found." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Unit</th>
                  <th>Ambient Shelf Life</th>
                  <th>Fridge Shelf Life</th>
                  <th>Product ID</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((product, index) => (
                  <tr
                    key={
                      product._id ||
                      product.product_id ||
                      index
                    }
                  >
                    <td>
                      <div className="primary-cell">
                        {getValue(
                          product,
                          [
                            "product_name",
                            "name",
                            "product"
                          ]
                        )}
                      </div>
                    </td>

                    <td>
                      {formatStatus(
                        getValue(
                          product,
                          ["category"]
                        )
                      )}
                    </td>

                    <td>
                      {getValue(
                        product,
                        ["unit_type", "unit"]
                      )}
                    </td>

                    <td>
                      {getValue(
                        product,
                        [
                          "shelf_life_ambient_hrs",
                          "ambient_shelf_life_hrs"
                        ]
                      )}{" "}
                      hrs
                    </td>

                    <td>
                      {getValue(
                        product,
                        [
                          "shelf_life_fridge_hrs",
                          "fridge_shelf_life_hrs"
                        ]
                      )}{" "}
                      hrs
                    </td>

                    <td className="mono">
                      {getValue(
                        product,
                        ["product_id"]
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Inventory({
  inventory,
  loading,
  error,
  refresh
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();

    return inventory.filter(item =>
      [
        getValue(
          item,
          [
            "product_name",
            "product",
            "product_id"
          ],
          ""
        ),
        getValue(
          item,
          ["vendor_id", "vendor"],
          ""
        ),
        getValue(
          item,
          ["unit_type", "unit"],
          ""
        ),
        getValue(
          item,
          [
            "quantity",
            "current_stock",
            "stock",
            "quantity_kg"
          ],
          ""
        )
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [inventory, search]);

  const getQuantity = item =>
    Number(
      getValue(
        item,
        [
          "quantity",
          "current_stock",
          "stock",
          "quantity_kg"
        ],
        NaN
      )
    );

  const lowStock = inventory.filter(item => {
    const qty = getQuantity(item);

    return (
      Number.isFinite(qty) &&
      qty <= 20
    );
  }).length;

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Monitor inventory records across vendors"
        onRefresh={refresh}
        refreshing={loading}
      />

      <ErrorBox message={error} />

      <div className="stats-grid compact">
        <StatCard
          title="Inventory Records"
          value={inventory.length}
          icon={Warehouse}
        />

        <StatCard
          title="Low Stock"
          value={lowStock}
          icon={AlertTriangle}
          danger={lowStock > 0}
        />

        <StatCard
          title="Healthy Stock"
          value={Math.max(
            inventory.length - lowStock,
            0
          )}
          icon={CheckCircle2}
        />
      </div>

      <section className="panel">
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search inventory..."
          />

          <span className="result-count">
            {filtered.length} records
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState message="No inventory records found." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Vendor</th>
                  <th>Quantity</th>
                  <th>Unit</th>
                  <th>Stock Status</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((item, index) => {
                  const qty = getQuantity(item);

                  const low =
                    Number.isFinite(qty) &&
                    qty <= 20;

                  return (
                    <tr
                      key={
                        item._id ||
                        index
                      }
                    >
                      <td>
                        <div className="primary-cell">
                          {getValue(
                            item,
                            [
                              "product_name",
                              "product",
                              "product_id"
                            ]
                          )}
                        </div>
                      </td>

                      <td className="mono">
                        {getValue(
                          item,
                          [
                            "vendor_id",
                            "vendor"
                          ]
                        )}
                      </td>

                      <td>
                        {Number.isFinite(qty)
                          ? qty
                          : getValue(
                              item,
                              [
                                "quantity",
                                "current_stock",
                                "stock",
                                "quantity_kg"
                              ]
                            )}
                      </td>

                      <td>
                        {getValue(
                          item,
                          [
                            "unit_type",
                            "unit"
                          ],
                          "kg"
                        )}
                      </td>

                      <td>
                        <span
                          className={
                            low
                              ? "status danger"
                              : "status active"
                          }
                        >
                          {low
                            ? "Low Stock"
                            : "Healthy"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Restocking({
  restocks,
  loading,
  error,
  refresh
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();

    return restocks.filter(r => {
      const rStatus = String(
        getValue(r, ["status"], "")
      ).toLowerCase();

      const matchesStatus =
        status === "all" ||
        rStatus === status;

      const matchesSearch = [
        getValue(r, ["vendor_id"], ""),
        getValue(r, ["status"], ""),
        getValue(r, ["_id"], ""),
        JSON.stringify(r.items || "")
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);

      return (
        matchesStatus &&
        matchesSearch
      );
    });
  }, [restocks, search, status]);

  const pending = restocks.filter(r =>
    String(
      getValue(r, ["status"], "")
    ).toLowerCase() === "pending"
  ).length;

  const completed = restocks.filter(r =>
    ["completed", "approved"].includes(
      String(
        getValue(r, ["status"], "")
      ).toLowerCase()
    )
  ).length;

  const rejected = restocks.filter(r =>
    ["rejected", "cancelled"].includes(
      String(
        getValue(r, ["status"], "")
      ).toLowerCase()
    )
  ).length;

  return (
    <>
      <PageHeader
        title="Restocking"
        subtitle="Track restock requests created by vendors"
        onRefresh={refresh}
        refreshing={loading}
      />

      <ErrorBox message={error} />

      <div className="stats-grid compact">
        <StatCard
          title="Total Requests"
          value={restocks.length}
          icon={RefreshCw}
        />

        <StatCard
          title="Pending"
          value={pending}
          icon={Clock3}
        />

        <StatCard
          title="Completed / Approved"
          value={completed}
          icon={CheckCircle2}
        />

        <StatCard
          title="Rejected / Cancelled"
          value={rejected}
          icon={XCircle}
          danger={rejected > 0}
        />
      </div>

      <section className="panel">
        <div className="toolbar toolbar-wrap">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search requests..."
          />

          <div className="filter-buttons">
            {[
              "all",
              "pending",
              "approved",
              "completed",
              "rejected",
              "cancelled"
            ].map(value => (
              <button
                key={value}
                className={
                  status === value
                    ? "filter-btn selected"
                    : "filter-btn"
                }
                onClick={() =>
                  setStatus(value)
                }
              >
                {formatStatus(value)}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState message="No restock requests found." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request ID</th>
                  <th>Vendor ID</th>
                  <th>Items</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((request, index) => {
                  const requestStatus =
                    getValue(
                      request,
                      ["status"],
                      "Unknown"
                    );

                  const items =
                    Array.isArray(request.items)
                      ? request.items.length
                      : request.items
                        ? 1
                        : 0;

                  return (
                    <tr
                      key={
                        request._id ||
                        index
                      }
                    >
                      <td className="mono">
                        {getValue(
                          request,
                          ["_id"]
                        )}
                      </td>

                      <td className="mono">
                        {getValue(
                          request,
                          ["vendor_id"]
                        )}
                      </td>

                      <td>
                        {items} item
                        {items === 1
                          ? ""
                          : "s"}
                      </td>

                      <td>
                        <span
                          className={statusClass(
                            requestStatus
                          )}
                        >
                          {formatStatus(
                            requestStatus
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Logs({
  logs,
  loading,
  error,
  refresh
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();

    return logs.filter(log =>
      [
        getValue(
          log,
          ["action", "type"],
          ""
        ),
        getValue(
          log,
          ["message"],
          ""
        ),
        getValue(
          log,
          ["vendor_id"],
          ""
        ),
        getValue(
          log,
          ["request_id"],
          ""
        )
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [logs, search]);

  return (
    <>
      <PageHeader
        title="Activity Logs"
        subtitle="System activity and audit records"
        onRefresh={refresh}
        refreshing={loading}
      />

      <ErrorBox message={error} />

      <section className="panel">
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search activity..."
          />

          <span className="result-count">
            {filtered.length} logs
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState message="No activity logs found." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Message</th>
                  <th>Vendor ID</th>
                  <th>Request ID</th>
                  <th>Log ID</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((log, index) => (
                  <tr
                    key={
                      log._id ||
                      index
                    }
                  >
                    <td>
                      <span className="log-action">
                        {formatStatus(
                          getValue(
                            log,
                            ["action", "type"],
                            "Activity"
                          )
                        )}
                      </span>
                    </td>

                    <td>
                      {getValue(
                        log,
                        ["message"],
                        "-"
                      )}
                    </td>

                    <td className="mono">
                      {getValue(
                        log,
                        ["vendor_id"],
                        "-"
                      )}
                    </td>

                    <td className="mono">
                      {getValue(
                        log,
                        ["request_id"],
                        "-"
                      )}
                    </td>

                    <td className="mono">
                      {getValue(
                        log,
                        ["_id"],
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function App() {
  const [page, setPage] =
    useState("dashboard");

  const [sidebarOpen, setSidebarOpen] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [vendors, setVendors] =
    useState([]);

  const [products, setProducts] =
    useState([]);

  const [inventory, setInventory] =
    useState([]);

  const [restocks, setRestocks] =
    useState([]);

  const [logs, setLogs] =
    useState([]);

  const [errors, setErrors] =
    useState({
      vendors: "",
      products: "",
      inventory: "",
      restocks: "",
      logs: ""
    });

  async function getJson(path) {
    const response =
      await fetch(`${API}${path}`);

    if (!response.ok) {
      throw new Error(
        `${response.status} ${response.statusText}`
      );
    }

    return response.json();
  }

  async function loadVendors() {
    const data =
      await getJson("/vendors");

    return data.vendors || [];
  }

  async function loadProducts(vendorList) {
    const results =
      await Promise.all(
        vendorList.map(
          async vendor => {
            const vendorId =
              getValue(
                vendor,
                [
                  "vendor_id",
                  "user_id",
                  "_id"
                ],
                ""
              );

            if (!vendorId) {
              return [];
            }

            try {
              const data =
                await getJson(
                  `/vendors/${encodeURIComponent(
                    vendorId
                  )}/products`
                );

              return (
                data.products || []
              ).map(product => ({
                ...product,
                source_vendor_id:
                  vendorId
              }));
            } catch {
              return [];
            }
          }
        )
      );

    const map =
      new Map();

    results
      .flat()
      .forEach(product => {
        const key =
          product.product_id ||
          product._id ||
          product.product_name;

        if (
          key &&
          !map.has(key)
        ) {
          map.set(
            key,
            product
          );
        }
      });

    return Array.from(
      map.values()
    );
  }

  async function loadInventory(
    vendorList
  ) {
    const results =
      await Promise.all(
        vendorList.map(
          async vendor => {
            const vendorId =
              getValue(
                vendor,
                [
                  "vendor_id",
                  "user_id",
                  "_id"
                ],
                ""
              );

            if (!vendorId) {
              return [];
            }

            try {
              const data =
                await getJson(
                  `/vendors/${encodeURIComponent(
                    vendorId
                  )}/inventory`
                );

              return (
                data.inventory || []
              );
            } catch {
              return [];
            }
          }
        )
      );

    const map =
      new Map();

    results
      .flat()
      .forEach(item => {
        const key =
          item._id ||
          `${item.vendor_id}-${item.product_id}-${item.product_name}`;

        if (!map.has(key)) {
          map.set(
            key,
            item
          );
        }
      });

    return Array.from(
      map.values()
    );
  }

  async function refreshAll() {
    setLoading(true);

    setErrors({
      vendors: "",
      products: "",
      inventory: "",
      restocks: "",
      logs: ""
    });

    let vendorList = [];

    try {
      vendorList =
        await loadVendors();

      setVendors(
        vendorList
      );
    } catch (error) {
      setErrors(prev => ({
        ...prev,
        vendors:
          `Unable to load vendors: ${error.message}`
      }));
    }

    try {
      const productList =
        await loadProducts(
          vendorList
        );

      setProducts(
        productList
      );
    } catch (error) {
      setErrors(prev => ({
        ...prev,
        products:
          `Unable to load products: ${error.message}`
      }));
    }

    try {
      const inventoryList =
        await loadInventory(
          vendorList
        );

      setInventory(
        inventoryList
      );
    } catch (error) {
      setErrors(prev => ({
        ...prev,
        inventory:
          `Unable to load inventory: ${error.message}`
      }));
    }

    try {
      const data =
        await getJson(
          "/restock-requests"
        );

      setRestocks(
        data.restock_requests || []
      );
    } catch (error) {
      setErrors(prev => ({
        ...prev,
        restocks:
          `Unable to load restock requests: ${error.message}`
      }));
    }

    try {
      const data =
        await getJson(
          "/logs"
        );

      setLogs(
        data.logs || []
      );
    } catch (error) {
      setErrors(prev => ({
        ...prev,
        logs:
          `Unable to load logs: ${error.message}`
      }));
    }

    setLoading(false);
  }

  useEffect(() => {
    refreshAll();
  }, []);

  const pageError =
    errors[page] ||
    Object.values(errors).find(Boolean) ||
    "";

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        setPage={setPage}
        open={sidebarOpen}
        setOpen={setSidebarOpen}
      />

      <main className="main-content">
        <div className="mobile-topbar">
          <button
            onClick={() =>
              setSidebarOpen(true)
            }
          >
            <Menu size={21} />
          </button>

          <div className="mobile-brand">
            B2P
          </div>

          <div className="mobile-status">
            <span />
            Online
          </div>
        </div>

        {page === "dashboard" && (
          <Dashboard
            data={{
              vendors,
              products,
              inventory,
              restocks,
              logs
            }}
            loading={loading}
            error={pageError}
            refresh={refreshAll}
            setPage={setPage}
          />
        )}

        {page === "vendors" && (
          <Vendors
            vendors={vendors}
            loading={loading}
            error={errors.vendors}
            refresh={refreshAll}
          />
        )}

        {page === "products" && (
          <Products
            products={products}
            loading={loading}
            error={errors.products}
            refresh={refreshAll}
          />
        )}

        {page === "inventory" && (
          <Inventory
            inventory={inventory}
            loading={loading}
            error={errors.inventory}
            refresh={refreshAll}
          />
        )}

        {page === "restocking" && (
          <Restocking
            restocks={restocks}
            loading={loading}
            error={errors.restocks}
            refresh={refreshAll}
          />
        )}

        {page === "logs" && (
          <Logs
            logs={logs}
            loading={loading}
            error={errors.logs}
            refresh={refreshAll}
          />
        )}
      </main>
    </div>
  );
}

export default App;