/**
 * QuickBill - Cashier POS Controller
 */

// Audio Feedback (Barcode Beep & Success Sound via Web Audio API)
const SoundFx = {
  ctx: null,
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  },
  beep(freq = 1800, duration = 0.08) {
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {}
  },
  success() {
    try {
      this.beep(880, 0.06);
      setTimeout(() => this.beep(1320, 0.1), 70);
    } catch (e) {}
  }
};

// Application State
const POS = {
  currentUser: null,
  products: [],
  cart: [],
  heldCart: null,
  paymentMode: 'CASH',
  activeReceipt: null,
  storeSettings: {},
  selectedIndex: -1
};

// DOM Elements
const searchInput = document.getElementById('item-search');
const searchResults = document.getElementById('search-results');
const cartTbody = document.getElementById('cart-table-body');
const cartItemCount = document.getElementById('cart-item-count');
const displayGrandTotal = document.getElementById('display-grand-total');
const summarySubtotal = document.getElementById('summary-subtotal');
const billDiscountInput = document.getElementById('bill-discount');
const summaryTax = document.getElementById('summary-tax');
const customerPhoneInput = document.getElementById('customer-phone');
const cashTenderedInput = document.getElementById('cash-tendered-input');
const changeReturnedDisplay = document.getElementById('change-returned-display');
const cashTenderBox = document.getElementById('cash-tender-box');
const serverStatusBadge = document.getElementById('server-status');
const serverStatusText = document.getElementById('server-status-text');
const pendingBadge = document.getElementById('pending-badge');
const pendingCountSpan = document.getElementById('pending-count');

// Initialize POS Application
window.addEventListener('DOMContentLoaded', async () => {
  checkAuth();
  setupSyncListeners();
  await loadProducts();
  setupKeyboardShortcuts();
  setupSearchEvents();
  updatePendingBadge();
});

// Authentication Handling
function checkAuth() {
  const savedUser = sessionStorage.getItem('qb_user');
  if (savedUser) {
    POS.currentUser = JSON.parse(savedUser);
    document.getElementById('current-user-name').innerText = POS.currentUser.name || POS.currentUser.username;
  } else {
    document.getElementById('login-modal').style.display = 'flex';
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const username = document.getElementById('login-username').value;
  const pin = document.getElementById('login-pin').value;

  try {
    const res = await fetch(window.qbSync.getApiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pin, device_id: window.qbSync.deviceId })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      POS.currentUser = data.user;
      sessionStorage.setItem('qb_user', JSON.stringify(data.user));
      document.getElementById('current-user-name').innerText = data.user.name;
      document.getElementById('login-modal').style.display = 'none';
      showToast(`Welcome ${data.user.name}!`);
    } else {
      // Fallback offline login for default accounts
      if (pin === '1234' || (username === 'admin' && pin === '9999')) {
        const fallbackUser = {
          id: username,
          username,
          name: username === 'admin' ? 'Store Manager' : `Cashier (${username})`,
          role: username === 'admin' ? 'manager' : 'cashier'
        };
        POS.currentUser = fallbackUser;
        sessionStorage.setItem('qb_user', JSON.stringify(fallbackUser));
        document.getElementById('current-user-name').innerText = fallbackUser.name;
        document.getElementById('login-modal').style.display = 'none';
        showToast(`Offline Login: ${fallbackUser.name}`);
      } else {
        alert(data.error || 'Invalid PIN or credentials');
      }
    }
  } catch (err) {
    // Offline login with default PIN
    if (pin === '1234' || (username === 'admin' && pin === '9999')) {
      const fallbackUser = {
        id: username,
        username,
        name: username === 'admin' ? 'Store Manager' : `Cashier (${username})`,
        role: username === 'admin' ? 'manager' : 'cashier'
      };
      POS.currentUser = fallbackUser;
      sessionStorage.setItem('qb_user', JSON.stringify(fallbackUser));
      document.getElementById('current-user-name').innerText = fallbackUser.name;
      document.getElementById('login-modal').style.display = 'none';
      showToast(`Logged in Offline mode`);
    } else {
      alert('Cannot connect to server and PIN does not match default 1234');
    }
  }
}

function logoutCashier() {
  if (confirm('Logout from this cashier terminal?')) {
    sessionStorage.removeItem('qb_user');
    window.location.reload();
  }
}

// Sync & Server Heartbeat Listeners
function setupSyncListeners() {
  window.qbSync.onStatusChange((status) => {
    if (status.isOnline) {
      serverStatusBadge.className = 'badge-status badge-online';
      serverStatusText.innerText = '🟢 Server Online';
      if (status.data && status.data.settings) {
        POS.storeSettings = status.data.settings;
        if (POS.storeSettings.store_name) {
          document.getElementById('store-title').innerText = POS.storeSettings.store_name;
        }
      }
    } else {
      serverStatusBadge.className = 'badge-status badge-offline';
      serverStatusText.innerText = '🔴 Offline (Device Mode)';
    }
    updatePendingBadge();
  });

  window.addEventListener('qb-synced', (e) => {
    updatePendingBadge();
    showToast(`✅ Synced ${e.detail.synced_count} bills to Central Server!`);
  });
}

async function updatePendingBadge() {
  const count = await window.qbSync.getPendingBillsCount();
  if (count > 0) {
    pendingBadge.style.display = 'flex';
    pendingCountSpan.innerText = `⚡ ${count} Pending Sync`;
    document.getElementById('pending-modal-count').innerText = count;
  } else {
    pendingBadge.style.display = 'none';
  }
}

// Load Product Catalog (Online with Offline IndexedDB caching)
async function loadProducts() {
  try {
    const res = await fetch(window.qbSync.getApiUrl('/api/products?limit=100'));
    if (res.ok) {
      POS.products = await res.json();
      window.qbSync.cacheProducts(POS.products);
      return;
    }
  } catch (err) {}

  // Fallback to local offline catalog
  POS.products = await window.qbSync.searchOfflineProducts('');
}

// Search & Barcode Input
function setupSearchEvents() {
  searchInput.addEventListener('input', async (e) => {
    const val = e.target.value.trim();
    if (!val) {
      searchResults.style.display = 'none';
      return;
    }

    let matches = [];
    if (window.qbSync.isOnline) {
      try {
        const res = await fetch(window.qbSync.getApiUrl(`/api/products?q=${encodeURIComponent(val)}`));
        if (res.ok) matches = await res.json();
      } catch (err) {}
    }

    if (!matches || matches.length === 0) {
      matches = await window.qbSync.searchOfflineProducts(val);
    }

    renderSearchResults(matches);
  });

  searchInput.addEventListener('keydown', (e) => {
    const items = searchResults.querySelectorAll('.search-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) {
        POS.selectedIndex = (POS.selectedIndex + 1) % items.length;
        highlightSearchItem(items);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) {
        POS.selectedIndex = (POS.selectedIndex - 1 + items.length) % items.length;
        highlightSearchItem(items);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (POS.selectedIndex >= 0 && items[POS.selectedIndex]) {
        items[POS.selectedIndex].click();
      } else {
        // Direct barcode scan check
        handleDirectBarcode(searchInput.value.trim());
      }
    } else if (e.key === 'Escape') {
      searchResults.style.display = 'none';
      POS.selectedIndex = -1;
    }
  });

  // Hide dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.style.display = 'none';
    }
  });
}

function highlightSearchItem(items) {
  items.forEach((item, idx) => {
    if (idx === POS.selectedIndex) {
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });
}

function renderSearchResults(items) {
  if (items.length === 0) {
    searchResults.innerHTML = '<div style="padding: 12px; color: var(--text-muted); text-align: center;">No matching products found</div>';
    searchResults.style.display = 'block';
    return;
  }

  POS.selectedIndex = 0;
  searchResults.innerHTML = items.map((p, idx) => {
    const isZeroStock = Number(p.stock_qty || 0) <= 0;
    const stockBadge = isZeroStock
      ? `<span style="color:#f59e0b; font-weight:700;">⚠️ 0 Stock (Billing Allowed)</span>`
      : `<span style="color:var(--text-secondary);">Stock: ${p.stock_qty} ${p.unit || 'Pcs'}</span>`;

    return `
      <div class="search-item ${idx === 0 ? 'active' : ''}" onclick="addToCartByProduct(${JSON.stringify(p).replace(/"/g, '&quot;')})">
        <div>
          <div class="search-item-title">${p.name}</div>
          <div class="search-item-sub">Code: ${p.item_code} | Cat: ${p.category || 'General'} | ${stockBadge}</div>
        </div>
        <div class="search-item-price">₹${Number(p.price).toFixed(2)}</div>
      </div>
    `;
  }).join('');
  searchResults.style.display = 'block';
}

// Direct Barcode Lookup (Hardware scanner or manual enter)
async function handleDirectBarcode(code) {
  if (!code) return;
  
  let found = null;
  if (window.qbSync.isOnline) {
    try {
      const res = await fetch(window.qbSync.getApiUrl(`/api/products/${encodeURIComponent(code)}`));
      if (res.ok) found = await res.json();
    } catch (e) {}
  }

  if (!found) {
    found = POS.products.find(p => p.item_code === code || p.item_code.toLowerCase() === code.toLowerCase());
  }
  if (!found) {
    const localMatches = await window.qbSync.searchOfflineProducts(code);
    found = localMatches.find(p => p.item_code === code);
  }

  if (found) {
    addToCart(found);
    searchInput.value = '';
    searchResults.style.display = 'none';
  } else {
    showToast(`Item not found for barcode: ${code}`);
  }
}

// Add Item to Cart
function addToCart(product, qtyToAdd = 1) {
  SoundFx.beep(1600, 0.06);
  const existing = POS.cart.find(item => item.item_code === product.item_code);
  const availableStock = Number(product.stock_qty !== undefined ? product.stock_qty : 0);

  if (existing) {
    existing.qty += qtyToAdd;
    existing.total = existing.qty * existing.price;
  } else {
    POS.cart.push({
      item_code: product.item_code,
      item_name: product.name,
      price: Number(product.price),
      qty: qtyToAdd,
      unit: product.unit || 'Pcs',
      tax_percent: Number(product.tax_percent || 0),
      discount: 0,
      total: Number(product.price) * qtyToAdd,
      stock_qty: availableStock
    });
  }

  renderCart();
}

function addToCartByProduct(product) {
  addToCart(product);
  searchInput.value = '';
  searchResults.style.display = 'none';
  searchInput.focus();
}

// Category filter
async function filterCategory(cat) {
  document.querySelectorAll('.cat-pill').forEach(el => el.classList.remove('active'));
  event.target.classList.add('active');

  if (cat === 'ALL') {
    searchInput.value = '';
    searchInput.focus();
    return;
  }
  searchInput.value = cat;
  searchInput.dispatchEvent(new Event('input'));
}

// Render Cart Table (Autofit Mobile Cards & Desktop Rows)
function renderCart() {
  if (POS.cart.length === 0) {
    cartTbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 40px 10px;">
          Cart is empty. Scan barcode or search above to add items.
        </td>
      </tr>
    `;
    cartItemCount.innerText = '0';
    calculateTotals();
    return;
  }

  let totalItems = 0;
  cartTbody.innerHTML = POS.cart.map((item, idx) => {
    totalItems += item.qty;
    const isZeroStock = (item.stock_qty !== undefined && item.stock_qty <= 0);
    return `
      <tr class="cart-table-row">
        <td colspan="5" class="cart-item-card-td">
          <div class="cart-card-inner">
            <div class="cart-card-top">
              <div class="cart-item-name-group">
                <span class="cart-item-name">${item.item_name}</span>
                ${isZeroStock ? '<span class="zero-stock-badge">⚠️ 0-Stock</span>' : ''}
                <div class="cart-item-sku">${item.item_code}</div>
              </div>
              <button class="cart-item-del-btn" onclick="removeCartItem(${idx})" title="Remove item" aria-label="Remove item">✕</button>
            </div>
            
            <div class="cart-card-bottom">
              <div class="cart-price-box">
                <span class="cart-meta-lbl">Rate</span>
                <span class="cart-meta-val">₹${item.price.toFixed(2)}</span>
              </div>

              <div class="cart-qty-ctrl">
                <button class="cart-qty-btn" onclick="updateCartQty(${idx}, -1)" aria-label="Decrease">−</button>
                <input type="number" class="cart-qty-input" value="${item.qty}" min="1" inputmode="numeric" pattern="[0-9]*" onchange="setCartQty(${idx}, this.value)">
                <button class="cart-qty-btn" onclick="updateCartQty(${idx}, 1)" aria-label="Increase">+</button>
              </div>

              <div class="cart-total-box">
                <span class="cart-meta-lbl">Total</span>
                <span class="cart-total-val">₹${item.total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  cartItemCount.innerText = totalItems;
  calculateTotals();
}

function updateCartQty(idx, change) {
  if (!POS.cart[idx]) return;
  POS.cart[idx].qty += change;
  if (POS.cart[idx].qty <= 0) {
    POS.cart.splice(idx, 1);
  } else {
    POS.cart[idx].total = POS.cart[idx].qty * POS.cart[idx].price;
  }
  renderCart();
}

function setCartQty(idx, val) {
  const qty = parseFloat(val);
  if (!isNaN(qty) && qty > 0) {
    POS.cart[idx].qty = qty;
    POS.cart[idx].total = qty * POS.cart[idx].price;
  } else {
    POS.cart.splice(idx, 1);
  }
  renderCart();
}

function removeCartItem(idx) {
  POS.cart.splice(idx, 1);
  renderCart();
}

function clearCart() {
  if (POS.cart.length === 0) return;
  if (confirm('Are you sure you want to clear current cart?')) {
    POS.cart = [];
    renderCart();
    customerPhoneInput.value = '';
    cashTenderedInput.value = '';
  }
}

function holdCurrentCart() {
  if (POS.cart.length === 0) return;
  POS.heldCart = [...POS.cart];
  POS.cart = [];
  renderCart();
  showToast('Cart put on hold. Click to recall.');
}

// Financial Calculations
function calculateTotals() {
  const subtotal = POS.cart.reduce((sum, item) => sum + item.total, 0);
  const discount = Math.max(0, parseFloat(billDiscountInput.value) || 0);

  // Simple tax calculation if configured
  let taxAmount = 0;
  POS.cart.forEach(item => {
    if (item.tax_percent > 0) {
      taxAmount += (item.total * (item.tax_percent / 100));
    }
  });

  const grandTotal = Math.max(0, Math.round((subtotal - discount + taxAmount) * 100) / 100);

  summarySubtotal.innerText = `₹${subtotal.toFixed(2)}`;
  summaryTax.innerText = `₹${taxAmount.toFixed(2)}`;
  displayGrandTotal.innerText = `₹${grandTotal.toFixed(2)}`;
  document.getElementById('total-items-desc').innerText = `${POS.cart.length} distinct item(s)`;

  // Update mobile bottom bar
  const mobCount = document.getElementById('mobile-cart-count');
  const mobTotal = document.getElementById('mobile-grand-total');
  if (mobCount) mobCount.innerText = POS.cart.length;
  if (mobTotal) mobTotal.innerText = `₹${grandTotal.toFixed(2)}`;

  calculateChange();
  return { subtotal, discount, taxAmount, grandTotal };
}

function openMobileCheckout() {
  if (POS.cart.length === 0) {
    showToast('Cart is empty! Scan or search items first.');
    return;
  }
  const sidebar = document.querySelector('.pos-sidebar');
  const backdrop = document.getElementById('pos-backdrop');
  if (sidebar) {
    sidebar.classList.add('mobile-open');
    if (backdrop) backdrop.classList.add('active');
    document.body.classList.add('sidebar-open');
    const tenderInput = document.getElementById('cash-tendered-input');
    if (tenderInput && POS.paymentMode === 'CASH') {
      setTimeout(() => tenderInput.focus(), 300);
    }
  }
}

function closeMobileCheckout() {
  const sidebar = document.querySelector('.pos-sidebar');
  const backdrop = document.getElementById('pos-backdrop');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('active');
  document.body.classList.remove('sidebar-open');
}

// Payment Selection & Cash Tender
function setPaymentMode(mode) {
  POS.paymentMode = mode;
  document.querySelectorAll('.pay-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`pay-${mode.toLowerCase()}-btn`).classList.add('active');

  if (mode === 'CASH') {
    cashTenderBox.style.display = 'block';
  } else {
    cashTenderBox.style.display = 'none';
  }
}

function calculateChange() {
  const { grandTotal } = calculateTotalsQuick();
  const tendered = parseFloat(cashTenderedInput.value) || 0;
  const change = Math.max(0, tendered - grandTotal);
  changeReturnedDisplay.innerText = `₹${change.toFixed(2)}`;
}

function calculateTotalsQuick() {
  const subtotal = POS.cart.reduce((sum, item) => sum + item.total, 0);
  const discount = Math.max(0, parseFloat(billDiscountInput.value) || 0);
  const grandTotal = Math.max(0, subtotal - discount);
  return { subtotal, discount, grandTotal };
}

function tenderExact() {
  const { grandTotal } = calculateTotalsQuick();
  cashTenderedInput.value = grandTotal;
  calculateChange();
}

function tenderAdd(amount) {
  const curr = parseFloat(cashTenderedInput.value) || 0;
  cashTenderedInput.value = curr + amount;
  calculateChange();
}

// Complete Bill & Record Centrally / Offline Failover
async function completeBill() {
  if (POS.cart.length === 0) {
    alert('Cannot generate bill with empty cart!');
    searchInput.focus();
    return;
  }

  const { subtotal, discount, taxAmount, grandTotal } = calculateTotals();
  const tendered = parseFloat(cashTenderedInput.value) || grandTotal;
  const change = Math.max(0, tendered - grandTotal);

  if (POS.paymentMode === 'CASH' && tendered < grandTotal) {
    alert(`Received cash (₹${tendered}) is less than grand total (₹${grandTotal})`);
    return;
  }

  const btn = document.getElementById('btn-complete-bill');
  btn.disabled = true;
  btn.innerText = '⏳ Processing Bill...';

  const cashier = POS.currentUser || { id: 'C1', name: 'Cashier', username: 'cashier1' };

  const billPayload = {
    cashier_id: cashier.username || cashier.id,
    cashier_name: cashier.name,
    items: POS.cart,
    subtotal,
    discount,
    tax_amount: taxAmount,
    grand_total: grandTotal,
    payment_mode: POS.paymentMode,
    cash_tendered: tendered,
    change_returned: change,
    customer_phone: customerPhoneInput.value.trim()
  };

  try {
    const result = await window.qbSync.submitBill(billPayload);
    SoundFx.success();

    const billItemsSnapshot = [...POS.cart];

    POS.activeReceipt = {
      bill: result.bill,
      items: billItemsSnapshot,
      isOffline: result.isOffline
    };

    // Close mobile checkout sheet if open
    closeMobileCheckout();

    // Open receipt modal
    openReceiptModal(result.bill, billItemsSnapshot, result.isOffline);

    // Reset Cart
    POS.cart = [];
    billDiscountInput.value = '0';
    customerPhoneInput.value = '';
    cashTenderedInput.value = '';
    renderCart();

    updatePendingBadge();
    showToast(result.isOffline ? '⚠️ Bill saved on Device (Pending Sync)' : '✅ Bill recorded Centrally on Server!');
  } catch (err) {
    alert('Billing error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = '⚡ COMPLETE BILL (Enter)';
  }
}

// Receipt Rendering & Actions
function openReceiptModal(bill, items, isOffline) {
  const container = document.getElementById('receipt-preview-container');
  container.innerHTML = window.ReceiptPrinter.renderHTML(bill, items, POS.storeSettings, isOffline);
  document.getElementById('receipt-modal').style.display = 'flex';
}

function closeReceiptModal() {
  document.getElementById('receipt-modal').style.display = 'none';
  searchInput.focus();
}

function printActiveReceipt() {
  if (!POS.activeReceipt) return;
  window.ReceiptPrinter.print(
    POS.activeReceipt.bill,
    POS.activeReceipt.items,
    POS.storeSettings,
    POS.activeReceipt.isOffline
  );
}

// Share PDF Invoice directly on WhatsApp (Mobile Native Share or Download + WhatsApp)
async function shareReceiptWhatsAppPDF() {
  if (!POS.activeReceipt) return;
  if (window.PDFInvoice) {
    await window.PDFInvoice.shareWhatsAppPDF(
      POS.activeReceipt.bill,
      POS.activeReceipt.items,
      POS.storeSettings
    );
  } else {
    window.ReceiptPrinter.shareWhatsApp(
      POS.activeReceipt.bill,
      POS.activeReceipt.items,
      POS.storeSettings
    );
  }
}

function shareReceiptWhatsApp() {
  shareReceiptWhatsAppPDF();
}

function downloadActiveReceiptPDF() {
  if (!POS.activeReceipt) return;
  if (window.PDFInvoice) {
    const filename = window.PDFInvoice.downloadPDF(
      POS.activeReceipt.bill,
      POS.activeReceipt.items,
      POS.storeSettings
    );
    showToast(`Downloaded: ${filename}`);
  }
}

function viewActiveReceiptPDF() {
  if (!POS.activeReceipt) return;
  if (window.PDFInvoice) {
    window.PDFInvoice.viewPDF(
      POS.activeReceipt.bill,
      POS.activeReceipt.items,
      POS.storeSettings
    );
  }
}

// Pending Bills Modal
async function showPendingModal() {
  const pending = await window.qbSync.getAllPendingBills();
  const tbody = document.getElementById('pending-bills-tbody');
  document.getElementById('pending-modal-count').innerText = pending.length;

  if (pending.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">No pending bills! All records are in sync.</td></tr>';
  } else {
    tbody.innerHTML = pending.map(b => `
      <tr>
        <td style="font-weight:600;">${b.bill_no}</td>
        <td>${new Date(b.created_at).toLocaleTimeString()}</td>
        <td>${b.items ? b.items.length : 0} items</td>
        <td style="color:#34d399; font-weight:700;">₹${Number(b.grand_total).toFixed(2)}</td>
        <td><span class="badge-status badge-offline">Offline</span></td>
      </tr>
    `).join('');
  }

  document.getElementById('pending-modal').style.display = 'flex';
}

function closePendingModal() {
  document.getElementById('pending-modal').style.display = 'none';
}

async function syncPendingNow() {
  const res = await window.qbSync.syncPendingBills();
  if (res.synced_count > 0) {
    showToast(`Synced ${res.synced_count} bills to Central Server!`);
    showPendingModal();
    updatePendingBadge();
  } else {
    alert('Server is unreachable or no pending bills to sync.');
  }
}

// Server Config Modal
function openServerConfigModal() {
  document.getElementById('server-url-input').value = window.qbSync.serverUrl;
  document.getElementById('server-config-modal').style.display = 'flex';
}

function closeServerConfigModal() {
  document.getElementById('server-config-modal').style.display = 'none';
}

function saveServerConfig() {
  const url = document.getElementById('server-url-input').value.trim();
  window.qbSync.setServerUrl(url);
  closeServerConfigModal();
  showToast('Connecting to ' + (url || 'Local Host'));
}

// ==========================================
// CAMERA BARCODE SCANNER (DUAL-MODE: SNAP + LIVE)
// ==========================================
let html5QrCode = null;
let isScanningLive = false;

function initQrScanner() {
  if (!html5QrCode && window.Html5Qrcode) {
    try {
      html5QrCode = new window.Html5Qrcode("reader");
    } catch (e) {
      console.warn('Html5Qrcode init error:', e);
    }
  }
}

function openScannerModal() {
  document.getElementById('scanner-modal').style.display = 'flex';
  initQrScanner();
  document.getElementById('manual-barcode-input').focus();

  const isSecure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isSecure && navigator.mediaDevices) {
    startLiveCamera();
  } else {
    // Over HTTP on mobile phone LAN
    const loading = document.getElementById('camera-loading');
    if (loading) loading.style.display = 'none';
    const statusMsg = document.getElementById('camera-status-msg');
    if (statusMsg) {
      statusMsg.innerHTML = `💡 <strong>Mobile Phone:</strong> Tap <strong>"📸 Snap Photo"</strong> to scan barcode directly with your phone camera!`;
    }
  }
}

function startLiveCamera() {
  initQrScanner();
  if (!html5QrCode) {
    const statusMsg = document.getElementById('camera-status-msg');
    if (statusMsg) statusMsg.innerText = 'Scanner library loading...';
    return;
  }

  const loading = document.getElementById('camera-loading');
  if (loading) {
    loading.innerText = 'Starting camera stream...';
    loading.style.display = 'block';
  }

  html5QrCode.start(
    { facingMode: "environment" },
    {
      fps: 10,
      qrbox: { width: 250, height: 160 }
    },
    (decodedText) => {
      onBarcodeScannedSuccess(decodedText);
    },
    (error) => {
      // scanning frame
    }
  ).then(() => {
    isScanningLive = true;
    if (loading) loading.style.display = 'none';
    const statusMsg = document.getElementById('camera-status-msg');
    if (statusMsg) statusMsg.innerText = '🟢 Live Scanner Active. Align barcode inside box.';
    const btn = document.getElementById('btn-toggle-live');
    if (btn) btn.innerText = '⏹️ Stop Live';
  }).catch(err => {
    console.warn('Live stream not allowed:', err);
    isScanningLive = false;
    if (loading) loading.style.display = 'none';
    const statusMsg = document.getElementById('camera-status-msg');
    if (statusMsg) {
      statusMsg.innerHTML = `ℹ️ Live video requires HTTPS. Tap <strong>"📸 Snap Photo"</strong> to scan instantly on your phone!`;
    }
  });
}

function stopLiveCamera() {
  if (html5QrCode && isScanningLive) {
    html5QrCode.stop().then(() => {
      isScanningLive = false;
      const btn = document.getElementById('btn-toggle-live');
      if (btn) btn.innerText = '📹 Live Video';
    }).catch(e => {});
  }
}

function toggleLiveCamera() {
  if (isScanningLive) {
    stopLiveCamera();
  } else {
    startLiveCamera();
  }
}

function triggerCameraSnap() {
  document.getElementById('camera-snap-input').click();
}

async function handleCameraSnap(event) {
  const file = event.target.files[0];
  if (!file) return;

  initQrScanner();
  const statusMsg = document.getElementById('camera-status-msg');
  if (statusMsg) statusMsg.innerText = '⏳ Scanning barcode from photo...';

  try {
    const decodedText = await html5QrCode.scanFile(file, true);
    onBarcodeScannedSuccess(decodedText);
  } catch (err) {
    console.warn('Scan photo failed:', err);
    if (statusMsg) {
      statusMsg.innerHTML = `❌ Barcode not detected. Please hold closer, ensure good lighting, or try again.`;
    }
  } finally {
    event.target.value = '';
  }
}

function onBarcodeScannedSuccess(code) {
  SoundFx.beep(1800, 0.1);
  closeScannerModal();
  handleDirectBarcode(code.trim());
}

function closeScannerModal() {
  stopLiveCamera();
  document.getElementById('scanner-modal').style.display = 'none';
  searchInput.focus();
}

function submitManualBarcode() {
  const code = document.getElementById('manual-barcode-input').value.trim();
  if (code) {
    handleDirectBarcode(code);
    document.getElementById('manual-barcode-input').value = '';
    closeScannerModal();
  }
}

// Keyboard Shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Focus search on F2
    if (e.key === 'F2') {
      e.preventDefault();
      searchInput.focus();
    }
    // Enter key complete bill if outside inputs
    if (e.key === 'Enter' && e.target === document.body) {
      completeBill();
    }
  });
}

// Toast notification helper
function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3500);
}
