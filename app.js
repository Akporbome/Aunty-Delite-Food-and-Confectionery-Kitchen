const page = document.body.dataset.page;
const previewMenu = [
  { id: 1, name: "Roasted tomato toast", description: "Sourdough, whipped ricotta, basil oil", category: "Brunch", price_cents: 1250 },
  { id: 2, name: "Wild mushroom omelette", description: "Herbs, aged cheddar, dressed greens", category: "Brunch", price_cents: 1650 },
  { id: 3, name: "Crispy chicken sandwich", description: "Pickled cabbage, house sauce, fries", category: "Mains", price_cents: 1850 },
  { id: 4, name: "Market grain bowl", description: "Seasonal vegetables, grains, lemon tahini", category: "Mains", price_cents: 1700 },
  { id: 5, name: "Olive oil cake", description: "Citrus cream, fresh berries", category: "Dessert", price_cents: 850 },
  { id: 6, name: "House lemonade", description: "Fresh lemon, a little mint", category: "Drinks", price_cents: 550 }
];
const money = cents => new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD"
}).format(cents / 100);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

async function request(url, options = {}) {
  if (window.location.protocol === "file:") {
    if (url === "/api/menu") return previewMenu;
    if (url === "/api/admin/session") return { authenticated: false };
    throw new Error("Preview only: start the local server to place orders, request reservations, or use staff tools.");
  }
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response.");
  }
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function showToast(message) {
  let toast = document.querySelector("#toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function readCart() {
  try {
    const saved = JSON.parse(localStorage.getItem("common-table-cart") || "[]");
    if (!Array.isArray(saved)) return new Map();
    return new Map(saved
      .filter(item => Number.isInteger(item.id) && Number.isInteger(item.quantity) && item.quantity > 0)
      .map(item => [item.id, Math.min(item.quantity, 20)]));
  } catch (error) {
    console.warn("Saved basket could not be restored.", error);
    return new Map();
  }
}

function writeCart(cart) {
  try {
    localStorage.setItem("common-table-cart", JSON.stringify(
      [...cart].map(([id, quantity]) => ({ id, quantity }))
    ));
  } catch (error) {
    console.warn("Basket changes could not be saved in this browser.", error);
  }
  updateCartBadges(cart);
}

function updateCartBadges(cart = readCart()) {
  const count = [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
  document.querySelectorAll("[data-cart-count]").forEach(badge => {
    badge.textContent = count;
  });
}

function setupSharedNavigation() {
  const activeLink = document.querySelector(`[data-nav="${page}"]`);
  if (activeLink) activeLink.setAttribute("aria-current", "page");

  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector("#main-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      toggle.setAttribute("aria-label", expanded ? "Open navigation" : "Close navigation");
      nav.classList.toggle("is-open", !expanded);
    });
    nav.addEventListener("click", event => {
      if (!event.target.closest("a")) return;
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation");
      nav.classList.remove("is-open");
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation");
      nav.classList.remove("is-open");
    });
  }
  document.querySelectorAll("[data-year]").forEach(element => {
    element.textContent = new Date().getFullYear();
  });
  if (window.location.protocol === "file:") {
    const notice = document.createElement("p");
    notice.className = "preview-notice";
    notice.textContent = "Preview mode: menu and basket are available. Start the local server to send orders, reservations, or staff updates.";
    document.querySelector(".site-header").after(notice);
  }
  updateCartBadges();
}

setupSharedNavigation();

if (page === "menu") {
  initializeMenuPage();
} else if (page === "order") {
  initializeOrderPage();
} else if (page === "reservations") {
  initializeReservationPage();
} else if (page === "staff") {
  initializeStaffPage();
}

async function initializeMenuPage() {
  const menuGrid = document.querySelector("#menu-grid");
  const categoryList = document.querySelector("#category-list");
  const cart = readCart();
  let menuItems = [];
  let currentCategory = "All";

  function renderCategories() {
    const categories = ["All", ...new Set(menuItems.map(item => item.category))];
    categoryList.innerHTML = categories.map(category => `
      <button class="category-button${category === currentCategory ? " active" : ""}"
        type="button" data-category="${escapeHtml(category)}"
        aria-pressed="${category === currentCategory}">
        ${escapeHtml(category)}
      </button>
    `).join("");
  }

  function renderMenu() {
    const visible = menuItems.filter(item => currentCategory === "All" || item.category === currentCategory);
    if (!visible.length) {
      menuGrid.innerHTML = '<p class="empty-message">Nothing on the menu just yet. Please check back soon.</p>';
      return;
    }
    menuGrid.innerHTML = visible.map(item => {
      const index = menuItems.findIndex(menuItem => menuItem.id === item.id);
      return `
        <article class="menu-card">
          <div class="dish-art tone-${(index % 5) + 1}" aria-hidden="true"><span>${String(index + 1).padStart(2, "0")}</span></div>
          <div class="dish-meta">
            <h2>${escapeHtml(item.name)}</h2>
            <span class="dish-price">${money(item.price_cents)}</span>
          </div>
          <p class="dish-description">${escapeHtml(item.description)}</p>
          <div class="dish-bottom">
            <span class="dish-category">${escapeHtml(item.category)}</span>
            <button class="add-button" type="button" data-add="${item.id}" aria-label="Add ${escapeHtml(item.name)} to basket">+</button>
          </div>
        </article>
      `;
    }).join("");
  }

  categoryList.addEventListener("click", event => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    currentCategory = button.dataset.category;
    renderCategories();
    renderMenu();
  });

  menuGrid.addEventListener("click", event => {
    const button = event.target.closest("[data-add]");
    if (!button) return;
    const id = Number(button.dataset.add);
    const quantity = cart.get(id) || 0;
    if (quantity >= 20) return showToast("The maximum is 20 of each item.");
    cart.set(id, quantity + 1);
    writeCart(cart);
    showToast("Added to your basket.");
  });

  try {
    menuItems = await request("/api/menu");
    const availableIds = new Set(menuItems.map(item => item.id));
    for (const id of cart.keys()) {
      if (!availableIds.has(id)) cart.delete(id);
    }
    writeCart(cart);
    renderCategories();
    renderMenu();
  } catch (error) {
    menuGrid.innerHTML = `<p class="empty-message">${escapeHtml(error.message)} Refresh the page to try again.</p>`;
  }
}

async function initializeOrderPage() {
  const cartItems = document.querySelector("#cart-items");
  const totalElement = document.querySelector("#cart-total");
  const summary = document.querySelector("#checkout-summary");
  const form = document.querySelector("#checkout-form");
  const message = document.querySelector("#checkout-message");
  const submit = form.querySelector('button[type="submit"]');
  const cart = readCart();
  let menuItems = [];

  function renderCart() {
    const entries = [...cart].map(([id, quantity]) => ({
      item: menuItems.find(menuItem => menuItem.id === id),
      quantity
    })).filter(entry => entry.item);
    const count = entries.reduce((sum, entry) => sum + entry.quantity, 0);
    const total = entries.reduce((sum, entry) => sum + entry.item.price_cents * entry.quantity, 0);
    totalElement.textContent = money(total);
    summary.textContent = count ? `${count} ${count === 1 ? "item" : "items"} · ${money(total)} · Pay at the restaurant` : "Add something from the menu to get started.";
    submit.disabled = count === 0;
    if (!entries.length) {
      cartItems.innerHTML = '<p class="cart-empty">Your basket is taking a well-earned rest.<br><a href="/menu.html">Browse the menu</a> and add something delicious.</p>';
    } else {
      cartItems.innerHTML = entries.map(({ item, quantity }) => `
        <article class="cart-item">
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <span class="cart-item-price">${money(item.price_cents)} each</span>
          </div>
          <div class="quantity-control" aria-label="Quantity for ${escapeHtml(item.name)}">
            <button type="button" data-quantity="${item.id}" data-change="-1" aria-label="Remove one ${escapeHtml(item.name)}">−</button>
            <span>${quantity}</span>
            <button type="button" data-quantity="${item.id}" data-change="1" aria-label="Add one ${escapeHtml(item.name)}">+</button>
          </div>
        </article>
      `).join("");
    }
    writeCart(cart);
  }

  cartItems.addEventListener("click", event => {
    const button = event.target.closest("[data-quantity]");
    if (!button) return;
    const id = Number(button.dataset.quantity);
    const next = (cart.get(id) || 0) + Number(button.dataset.change);
    if (next <= 0) cart.delete(id);
    else cart.set(id, Math.min(next, 20));
    renderCart();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    setMessage(message, "");
    submit.disabled = true;
    try {
      const fields = Object.fromEntries(new FormData(form));
      const order = await request("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          ...fields,
          items: [...cart].map(([id, quantity]) => ({ id, quantity }))
        })
      });
      cart.clear();
      form.reset();
      renderCart();
      setMessage(message, `Thank you! Order #${order.id} is in. Please pay ${money(order.total_cents)} when you collect it.`);
    } catch (error) {
      setMessage(message, error.message, true);
      submit.disabled = cart.size === 0;
    }
  });

  cartItems.innerHTML = '<p class="loading-message">Gathering your basket…</p>';
  try {
    menuItems = await request("/api/menu");
    const availableIds = new Set(menuItems.map(item => item.id));
    for (const id of cart.keys()) {
      if (!availableIds.has(id)) cart.delete(id);
    }
    renderCart();
  } catch (error) {
    cartItems.innerHTML = `<p class="empty-message">${escapeHtml(error.message)} Refresh the page to try again.</p>`;
  }
}

function initializeReservationPage() {
  const form = document.querySelector("#reservation-form");
  const message = document.querySelector("#reservation-message");
  const date = document.querySelector("#reservation-date");
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  date.min = today();

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    setMessage(message, "");
    submit.disabled = true;
    try {
      const fields = Object.fromEntries(new FormData(form));
      const reservation = await request("/api/reservations", {
        method: "POST",
        body: JSON.stringify({ ...fields, party_size: Number(fields.party_size) })
      });
      form.reset();
      date.min = today();
      setMessage(message, `Thanks! Your table request #${reservation.id} is received. We'll be in touch to confirm.`);
    } catch (error) {
      setMessage(message, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });
}

function initializeStaffPage() {
  const loginForm = document.querySelector("#staff-login-form");
  const dashboard = document.querySelector("#staff-dashboard");
  const loginMessage = document.querySelector("#staff-message");
  const menuForm = document.querySelector("#menu-item-form");
  const menuMessage = document.querySelector("#menu-message");
  const menuList = document.querySelector("#admin-menu-list");
  const orderStatuses = ["received", "preparing", "ready", "completed", "cancelled"];
  const reservationStatuses = ["requested", "confirmed", "seated", "completed", "cancelled"];

  function showDashboard() {
    loginForm.hidden = true;
    loginForm.reset();
    dashboard.hidden = false;
    loadMenu();
    loadOrders();
    loadReservations();
  }

  function showLogin() {
    dashboard.hidden = true;
    loginForm.hidden = false;
    loginForm.reset();
  }

  async function loadMenu() {
    try {
      const items = await request("/api/admin/menu");
      menuList.innerHTML = items.length ? items.map(item => `
        <div class="admin-row">
          <div class="admin-row-main">
            <strong>${escapeHtml(item.name)}${item.active ? "" : " (archived)"}</strong>
            <small>${escapeHtml(item.category)} · ${money(item.price_cents)}${item.description ? ` · ${escapeHtml(item.description)}` : ""}</small>
          </div>
          ${item.active ? `<div class="admin-row-actions">
            <button class="button button-outline" type="button" data-edit-menu="${item.id}">Edit</button>
            <button class="button button-outline" type="button" data-archive-menu="${item.id}">Archive</button>
          </div>` : ""}
        </div>
      `).join("") : '<p class="empty-message">No menu items yet.</p>';
    } catch (error) {
      menuList.innerHTML = `<p class="form-message error">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadOrders() {
    const list = document.querySelector("#admin-orders-list");
    try {
      const orders = await request("/api/admin/orders");
      list.innerHTML = orders.length ? orders.map(order => `
        <div class="admin-row">
          <div class="admin-row-main">
            <strong>Order #${order.id} · ${escapeHtml(order.customer_name)}</strong>
            <small>${order.items.map(item => `${item.quantity}× ${escapeHtml(item.name)}`).join(", ")} · ${money(order.total_cents)}<br>${escapeHtml(order.phone)} · ${escapeHtml(new Date(order.created_at).toLocaleString())}</small>
          </div>
          <div class="admin-row-actions"><select aria-label="Status for order ${order.id}" data-status-kind="orders" data-status-id="${order.id}">
            ${orderStatuses.map(status => `<option value="${status}"${status === order.status ? " selected" : ""}>${status}</option>`).join("")}
          </select></div>
        </div>
      `).join("") : '<p class="empty-message">No orders yet.</p>';
    } catch (error) {
      list.innerHTML = `<p class="form-message error">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadReservations() {
    const list = document.querySelector("#admin-reservations-list");
    try {
      const reservations = await request("/api/admin/reservations");
      list.innerHTML = reservations.length ? reservations.map(reservation => `
        <div class="admin-row">
          <div class="admin-row-main">
            <strong>${escapeHtml(reservation.customer_name)} · ${reservation.party_size} ${reservation.party_size === 1 ? "guest" : "guests"}</strong>
            <small>${escapeHtml(reservation.date)} at ${escapeHtml(reservation.time)} · ${escapeHtml(reservation.phone)}${reservation.email ? ` · ${escapeHtml(reservation.email)}` : ""}${reservation.note ? `<br>${escapeHtml(reservation.note)}` : ""}</small>
          </div>
          <div class="admin-row-actions"><select aria-label="Status for reservation ${reservation.id}" data-status-kind="reservations" data-status-id="${reservation.id}">
            ${reservationStatuses.map(status => `<option value="${status}"${status === reservation.status ? " selected" : ""}>${status}</option>`).join("")}
          </select></div>
        </div>
      `).join("") : '<p class="empty-message">No reservations yet.</p>';
    } catch (error) {
      list.innerHTML = `<p class="form-message error">${escapeHtml(error.message)}</p>`;
    }
  }

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = loginForm.querySelector('button[type="submit"]');
    setMessage(loginMessage, "");
    submit.disabled = true;
    try {
      const password = new FormData(loginForm).get("password");
      await request("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      showDashboard();
    } catch (error) {
      setMessage(loginMessage, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector("#staff-logout").addEventListener("click", async () => {
    try {
      await request("/api/admin/logout", { method: "POST", body: "{}" });
      showLogin();
      setMessage(loginMessage, "You have signed out.");
    } catch (error) {
      showToast(error.message);
    }
  });

  document.querySelectorAll("[data-admin-tab]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-admin-tab]").forEach(tab => {
        const selected = tab === button;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-selected", String(selected));
      });
      document.querySelectorAll(".admin-view").forEach(view => {
        view.hidden = view.id !== `admin-${button.dataset.adminTab}-view`;
      });
    });
  });

  document.querySelector("#menu-add").addEventListener("click", () => {
    menuForm.reset();
    menuForm.elements.id.value = "";
    setMessage(menuMessage, "");
    menuForm.hidden = false;
    menuForm.elements.name.focus();
  });

  document.querySelector("#menu-cancel").addEventListener("click", () => {
    menuForm.hidden = true;
    setMessage(menuMessage, "");
  });

  menuList.addEventListener("click", async event => {
    const edit = event.target.closest("[data-edit-menu]");
    const archive = event.target.closest("[data-archive-menu]");
    if (edit) {
      try {
        const item = await request("/api/admin/menu").then(items => items.find(entry => entry.id === Number(edit.dataset.editMenu)));
        if (!item) return showToast("That menu item could not be found.");
        menuForm.elements.id.value = item.id;
        menuForm.elements.name.value = item.name;
        menuForm.elements.description.value = item.description;
        menuForm.elements.category.value = item.category;
        menuForm.elements.price_cents.value = item.price_cents;
        setMessage(menuMessage, "");
        menuForm.hidden = false;
        menuForm.elements.name.focus();
      } catch (error) {
        showToast(error.message);
      }
    }
    if (archive && window.confirm("Archive this dish? It will disappear from the public menu.")) {
      try {
        await request(`/api/admin/menu/${archive.dataset.archiveMenu}`, { method: "DELETE" });
        await loadMenu();
        showToast("Menu item archived.");
      } catch (error) {
        showToast(error.message);
      }
    }
  });

  menuForm.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = menuForm.querySelector('button[type="submit"]');
    setMessage(menuMessage, "");
    submit.disabled = true;
    try {
      const fields = Object.fromEntries(new FormData(menuForm));
      const id = fields.id;
      delete fields.id;
      fields.price_cents = Number(fields.price_cents);
      await request(id ? `/api/admin/menu/${id}` : "/api/admin/menu", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(fields)
      });
      menuForm.hidden = true;
      await loadMenu();
      showToast(id ? "Menu item updated." : "Menu item added.");
    } catch (error) {
      setMessage(menuMessage, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelectorAll("[data-refresh]").forEach(button => {
    button.addEventListener("click", () => {
      if (button.dataset.refresh === "orders") loadOrders();
      if (button.dataset.refresh === "reservations") loadReservations();
    });
  });

  dashboard.addEventListener("change", async event => {
    const select = event.target.closest("[data-status-kind]");
    if (!select) return;
    try {
      await request(`/api/admin/${select.dataset.statusKind}/${select.dataset.statusId}`, {
        method: "PUT",
        body: JSON.stringify({ status: select.value })
      });
      showToast("Status updated.");
    } catch (error) {
      showToast(error.message);
      if (select.dataset.statusKind === "orders") loadOrders();
      else loadReservations();
    }
  });

  request("/api/admin/session").then(session => {
    if (session.authenticated) showDashboard();
    else showLogin();
  }).catch(error => {
    showLogin();
    setMessage(loginMessage, error.message, true);
  });
}
