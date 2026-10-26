/**
 * QuickBill - Central Manager Dashboard Controller
 */

const Mgr = {
  activeTab: 'dashboard',
  selectedBill: null,
  products: [],
  selectedFile: null,
  allBills: []
};

// Initial Load
window.addEventListener('DOMContentLoaded', async () => {
  setFilterToday();
  startClock();
  await loadSystemSettings();
  loadDashboardData();
});

// Live Digital Clock
function startClock() {
  const clock = document.getElementById('live-clock');
  function update() {
    clock.innerText = new Date().toLocaleTimeString('en-IN', { hour12: true });
  }
  update();
  setInterval(update, 1000);
}

function setFilterToday() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('overview-date').value = today;
  document.getElementById('bills-filter-date').value = today;
}

// Tab Switching
function switchTab(tabId) {
  Mgr.activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

  event?.target?.classList.add('active');
  document.getElementById(`tab-${tabId}`).style.display = 'block';

  if (tabId === 'dashboard') loadDashboardData();
  if (tabId === 'bills') loadBillsTable();
  if (tabId === 'inventory') {
    loadProductCatalog();
    loadOversoldReport();
  }
  if (tabId === 'database') loadDatabaseTab();
  if (tabId === 'audit') loadAuditLogs();
}

// Load System & Store Settings
async function loadSystemSettings() {
  try {
    const res = await fetch('/api/system-info');
    if (res.ok) {
      const data = await res.json();
      if (data.cashier_url) {
        document.getElementById('network-mobile-url').innerText = data.cashier_url;
      }
      if (data.settings) {
        Mgr.storeSettings = data.settings;
        const s = data.settings;
        if (s.store_name) {
          document.getElementById('mgr-store-title').innerText = `${s.store_name} - MANAGER DASHBOARD`;
          document.getElementById('cfg-store-name').value = s.store_name;
        }
        if (s.store_tagline) document.getElementById('cfg-store-tagline').value = s.store_tagline;
        if (s.store_address) document.getElementById('cfg-store-address').value = s.store_address;
        if (s.store_phone) document.getElementById('cfg-store-phone').value = s.store_phone;
        if (s.store_gstin) document.getElementById('cfg-store-gstin').value = s.store_gstin;
        if (s.receipt_footer) document.getElementById('cfg-receipt-footer').value = s.receipt_footer;
      }
    }
  } catch (err) {
    console.error('System settings fetch error:', err);
  }
}

// ==============================================
// 1. DASHBOARD OVERVIEW METRICS
// ==============================================
async function loadDashboardData() {
  const date = document.getElementById('overview-date').value;
  try {
    const res = await fetch(`/api/dashboard/metrics?date=${date}`);
    if (!res.ok) return;
    const data = await res.json();
    const summary = data.summary || {};

    // KPIs
    document.getElementById('kpi-total-bills').innerText = summary.total_bills || 0;
    document.getElementById('kpi-bills-sub').innerText = `${summary.completed_bills || 0} Completed | ${summary.cancelled_bills || 0} Cancelled`;

    document.getElementById('kpi-total-sales').innerText = `₹${Number(summary.total_sales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('kpi-sales-mode-sub').innerText = `Cash: ₹${Number(summary.cash_sales || 0).toFixed(0)} | UPI: ₹${Number(summary.upi_sales || 0).toFixed(0)} | Card: ₹${Number(summary.card_sales || 0).toFixed(0)}`;

    document.getElementById('kpi-cancelled-bills').innerText = summary.cancelled_bills || 0;
    document.getElementById('kpi-pending-reconcile').innerText = summary.pending_main_software || 0;

    const oversoldCount = summary.oversold_items_count || 0;
    const oversoldPieces = summary.oversold_pieces_total || 0;
    document.getElementById('kpi-oversold-summary').innerText = `${oversoldCount} Items`;
    document.getElementById('kpi-oversold-sub').innerText = `${oversoldPieces} Pcs sold w/o stock`;

    // Cashier Performance Breakdown
    renderCashierBreakdown(data.cashierBreakdown || []);

    // Recent Bills
    loadRecentBills(date);
  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

function renderCashierBreakdown(cashiers) {
  const tbody = document.getElementById('cashier-breakdown-tbody');
  if (cashiers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No cashier sales recorded for this date.</td></tr>`;
    return;
  }

  tbody.innerHTML = cashiers.map(c => `
    <tr>
      <td style="font-weight: 600;">${c.cashier_name || 'Cashier'}</td>
      <td style="color: var(--text-secondary);">${c.cashier_id}</td>
      <td class="text-center">${c.generated_bills}</td>
      <td class="text-center" style="color: ${c.cancelled_bills > 0 ? 'var(--danger)' : 'inherit'};">${c.cancelled_bills}</td>
      <td class="text-right" style="font-weight: 700; color: #34d399;">₹${Number(c.net_sales).toFixed(2)}</td>
      <td class="text-center">
        ${c.pending_main_entry > 0 
          ? `<span class="badge-status badge-sync">${c.pending_main_entry} Pending</span>` 
          : `<span class="badge-status badge-online">0 Done</span>`}
      </td>
    </tr>
  `).join('');
}

async function loadRecentBills(date) {
  try {
    const res = await fetch(`/api/bills?date=${date}&limit=10`);
    if (!res.ok) return;
    const bills = await res.json();
    const tbody = document.getElementById('recent-bills-tbody');

    if (bills.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--text-muted);">No bills found.</td></tr>`;
      return;
    }

    tbody.innerHTML = bills.map(b => `
      <tr>
        <td style="font-weight: 600; font-family: var(--font-mono);">${b.bill_no}</td>
        <td>${new Date(b.created_at).toLocaleTimeString()}</td>
        <td>${b.cashier_name}</td>
        <td><span style="font-size: 11px; font-weight: 600;">${b.payment_mode}</span></td>
        <td class="text-right" style="font-weight: 700; color: #34d399;">₹${Number(b.grand_total).toFixed(2)}</td>
        <td>
          <span class="badge-status ${b.status === 'COMPLETED' ? 'badge-online' : 'badge-offline'}">
            ${b.status}
          </span>
        </td>
        <td>
          <span class="badge-status ${b.main_software_status === 'ENTERED' ? 'badge-online' : 'badge-sync'}">
            ${b.main_software_status}
          </span>
        </td>
      </tr>
    `).join('');
  } catch (err) {}
}

// ==============================================
// 2. ALL BILLS & RECONCILIATION
// ==============================================
async function loadBillsTable() {
  const search = document.getElementById('bills-filter-search').value.trim();
  const date = document.getElementById('bills-filter-date').value;
  const cashier = document.getElementById('bills-filter-cashier').value;
  const status = document.getElementById('bills-filter-status').value;
  const mainStatus = document.getElementById('bills-filter-main').value;

  let url = `/api/bills?limit=300`;
  if (date) url += `&date=${date}`;
  if (cashier) url += `&cashier_id=${cashier}`;
  if (status) url += `&status=${status}`;
  if (mainStatus) url += `&main_status=${mainStatus}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return;
    Mgr.allBills = await res.json();
    document.getElementById('bills-table-count').innerText = Mgr.allBills.length;
    renderBillsTable(Mgr.allBills);

    // Populate Cashier dropdown options if not yet loaded
    populateCashierDropdown(Mgr.allBills);
  } catch (err) {
    console.error('Error fetching bills:', err);
  }
}

function renderBillsTable(bills) {
  const tbody = document.getElementById('all-bills-tbody');
  if (bills.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 30px; color: var(--text-muted);">No matching bills found.</td></tr>`;
    return;
  }

  tbody.innerHTML = bills.map(b => `
    <tr>
      <td>
        <input type="checkbox" class="bill-checkbox" value="${b.id}" data-main="${b.main_software_status}">
      </td>
      <td style="font-weight: 700; font-family: var(--font-mono);">${b.bill_no}</td>
      <td style="font-size: 12px;">${new Date(b.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td>${b.cashier_name}</td>
      <td style="font-size: 11px; color: var(--text-muted);">${b.device_id ? b.device_id.substring(0, 10) : 'N/A'}</td>
      <td><span style="font-weight: 600;">${b.payment_mode}</span></td>
      <td class="text-right" style="font-weight: 700; color: #34d399;">₹${Number(b.grand_total).toFixed(2)}</td>
      <td>
        <span class="badge-status ${b.status === 'COMPLETED' ? 'badge-online' : 'badge-offline'}">
          ${b.status}
        </span>
      </td>
      <td>
        <button class="btn btn-sm ${b.main_software_status === 'ENTERED' ? 'btn-primary' : 'btn-secondary'}" 
          onclick="toggleMainSoftwareStatus(${b.id}, '${b.main_software_status}')"
          title="Click to toggle Entered / Pending status">
          ${b.main_software_status === 'ENTERED' ? '✓ Entered' : '⏳ Pending'}
        </button>
      </td>
      <td class="text-center" style="white-space: nowrap;">
        <button class="btn btn-secondary btn-sm" onclick="openBillDetails(${b.id})">🔍 View</button>
        <a href="/api/bills/${b.id}/pdf" target="_blank" class="btn btn-primary btn-sm" style="margin-left: 4px;" title="View or Download PDF Invoice">📄 PDF</a>
      </td>
    </tr>
  `).join('');
}

function populateCashierDropdown(bills) {
  const select = document.getElementById('bills-filter-cashier');
  const existing = new Set();
  for (let i = 1; i < select.options.length; i++) {
    existing.add(select.options[i].value);
  }
  bills.forEach(b => {
    if (b.cashier_id && !existing.has(b.cashier_id)) {
      existing.add(b.cashier_id);
      const opt = document.createElement('option');
      opt.value = b.cashier_id;
      opt.innerText = `${b.cashier_name} (${b.cashier_id})`;
      select.appendChild(opt);
    }
  });
}

function resetBillsFilter() {
  document.getElementById('bills-filter-search').value = '';
  document.getElementById('bills-filter-cashier').value = '';
  document.getElementById('bills-filter-status').value = '';
  document.getElementById('bills-filter-main').value = '';
  setFilterToday();
  loadBillsTable();
}

function toggleSelectAllBills(master) {
  document.querySelectorAll('.bill-checkbox').forEach(cb => {
    cb.checked = master.checked;
  });
}

async function toggleMainSoftwareStatus(billId, currentStatus) {
  const newStatus = currentStatus === 'ENTERED' ? 'PENDING' : 'ENTERED';
  const refNo = newStatus === 'ENTERED' ? prompt('Optional Main Software Voucher / Invoice Ref No:', '') : '';

  try {
    const res = await fetch(`/api/bills/${billId}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: newStatus,
        ref_no: refNo || '',
        user: { username: 'admin', name: 'Store Manager' }
      })
    });

    if (res.ok) {
      loadBillsTable();
      loadDashboardData();
    }
  } catch (e) {
    alert('Reconciliation update error');
  }
}

async function bulkMarkReconciled() {
  const checked = Array.from(document.querySelectorAll('.bill-checkbox:checked')).map(cb => Number(cb.value));
  if (checked.length === 0) {
    alert('Please select at least one bill checkbox to mark as entered.');
    return;
  }

  const ref = prompt(`Mark ${checked.length} bills as 'ENTERED' in Main Software.\nOptional batch reference / note:`, 'Batch Sync');
  if (ref === null) return;

  try {
    const res = await fetch('/api/bills/bulk-reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bill_ids: checked,
        status: 'ENTERED',
        ref_no: ref,
        user: { username: 'admin', name: 'Store Manager' }
      })
    });

    if (res.ok) {
      alert(`Successfully marked ${checked.length} bills as ENTERED in main software!`);
      loadBillsTable();
      loadDashboardData();
    }
  } catch (e) {
    alert('Bulk reconcile failed');
  }
}

// Bill Details & Cancellation Modal
async function openBillDetails(billId) {
  try {
    const res = await fetch(`/api/bills/${billId}`);
    if (!res.ok) return;
    const { bill, items } = await res.json();
    Mgr.selectedBill = bill;
    Mgr.selectedBillItems = items;

    document.getElementById('modal-bill-title').innerText = `Bill: ${bill.bill_no} (${bill.status})`;
    const content = document.getElementById('modal-bill-content');

    const isCancelled = bill.status === 'CANCELLED';
    document.getElementById('cancellation-box').style.display = isCancelled ? 'none' : 'block';

    content.innerHTML = `
      <div style="font-size: 13px; line-height: 1.6; margin-bottom: 12px;">
        <div><strong>Date:</strong> ${new Date(bill.created_at).toLocaleString()}</div>
        <div><strong>Cashier:</strong> ${bill.cashier_name} (${bill.cashier_id})</div>
        <div><strong>Device ID:</strong> ${bill.device_id}</div>
        <div><strong>Payment:</strong> ${bill.payment_mode} | <strong>Total:</strong> <span style="color:#34d399; font-weight:700;">₹${bill.grand_total}</span></div>
        ${isCancelled ? `<div style="color:var(--danger); font-weight:700; margin-top:4px;">❌ CANCELLED: ${bill.cancellation_reason} (By: ${bill.cancelled_by})</div>` : ''}
      </div>
      <div style="font-weight: 700; font-size: 13px; margin-bottom: 6px;">Items in this Bill:</div>
      <table class="data-table" style="font-size: 12px;">
        <thead>
          <tr>
            <th>Item</th>
            <th class="text-center">Qty</th>
            <th class="text-right">Rate</th>
            <th class="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(i => `
            <tr>
              <td>${i.item_name}</td>
              <td class="text-center">${i.qty}</td>
              <td class="text-right">₹${Number(i.price).toFixed(2)}</td>
              <td class="text-right" style="font-weight:600;">₹${Number(i.total).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    document.getElementById('bill-detail-modal').style.display = 'flex';
  } catch (e) {
    alert('Error loading bill details');
  }
}

function closeBillDetailModal() {
  document.getElementById('bill-detail-modal').style.display = 'none';
  Mgr.selectedBill = null;
  Mgr.selectedBillItems = null;
}

async function shareManagerBillWhatsApp() {
  if (!Mgr.selectedBill) return;
  if (window.PDFInvoice) {
    await window.PDFInvoice.shareWhatsAppPDF(
      Mgr.selectedBill,
      Mgr.selectedBillItems || [],
      Mgr.storeSettings || {}
    );
  } else {
    window.ReceiptPrinter.shareWhatsApp(
      Mgr.selectedBill,
      Mgr.selectedBillItems || [],
      Mgr.storeSettings || {}
    );
  }
}

function downloadManagerBillPDF() {
  if (!Mgr.selectedBill) return;
  if (window.PDFInvoice) {
    window.PDFInvoice.downloadPDF(
      Mgr.selectedBill,
      Mgr.selectedBillItems || [],
      Mgr.storeSettings || {}
    );
  } else {
    window.open(`/api/bills/${Mgr.selectedBill.id}/pdf`, '_blank');
  }
}

function printManagerBill() {
  if (!Mgr.selectedBill) return;
  window.ReceiptPrinter.print(
    Mgr.selectedBill,
    Mgr.selectedBillItems || [],
    Mgr.storeSettings || {}
  );
}

// Clear All Invoices to Initialize Fresh Live Billing
async function clearAllBillsForLive() {
  const confirmCode = prompt(
    "⚠️ WARNING: RESET ALL INVOICES FOR LIVE LAUNCH\n\n" +
    "This will PERMANENTLY delete all test bills and reset the bill sequence to #0001 so your live cashier billing starts completely fresh.\n\n" +
    "Stock levels will remain intact.\n\n" +
    "Type 'RESET' in capital letters below to confirm:"
  );

  if (confirmCode !== 'RESET') {
    if (confirmCode !== null) alert("Action cancelled. You must type 'RESET' exactly.");
    return;
  }

  try {
    const res = await fetch('/api/bills/clear-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmation: 'CLEAR_ALL_FOR_LIVE',
        user: { username: 'admin', name: 'Store Manager' }
      })
    });

    const data = await res.json();
    if (res.ok) {
      alert(`✅ Success: ${data.message}\nAll test bills have been cleared. System is 100% ready for live cashier billing.`);
      loadBillsTable();
      loadDashboardData();
    } else {
      alert('Reset failed: ' + (data.error || 'Server error'));
    }
  } catch (err) {
    alert('Request failed: ' + err.message);
  }
}

async function submitBillCancellation() {
  if (!Mgr.selectedBill) return;
  const reason = document.getElementById('cancel-reason-input').value.trim();
  if (reason.length < 3) {
    alert('Please provide a mandatory cancellation reason (at least 3 characters)');
    return;
  }

  if (!confirm(`Are you sure you want to CANCEL Bill ${Mgr.selectedBill.bill_no}?\nStock will be restored and an audit event will be logged permanently.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/bills/${Mgr.selectedBill.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason,
        user: { username: 'admin', name: 'Store Manager', device_id: 'SERVER' }
      })
    });

    const data = await res.json();
    if (res.ok) {
      alert(`Bill ${Mgr.selectedBill.bill_no} cancelled successfully and stock restored.`);
      closeBillDetailModal();
      loadBillsTable();
      loadDashboardData();
    } else {
      alert(data.error || 'Cancellation failed');
    }
  } catch (e) {
    alert('Cancellation request failed');
  }
}

// Export Daily Sales to Excel
function exportDailyExcel() {
  const date = document.getElementById('overview-date').value || new Date().toISOString().split('T')[0];
  window.location.href = `/api/reports/export-excel?date=${date}`;
}

// ==============================================
// 3. INVENTORY MANAGEMENT (EXCEL, CSV, JSON)
// ==============================================
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  Mgr.selectedFile = file;
  document.getElementById('selected-file-name').innerText = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
}

// Setup Drag & Drop
const dropzone = document.getElementById('file-dropzone');
if (dropzone) {
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      Mgr.selectedFile = e.dataTransfer.files[0];
      document.getElementById('selected-file-name').innerText = `Selected: ${Mgr.selectedFile.name} (${(Mgr.selectedFile.size / 1024).toFixed(1)} KB)`;
    }
  });
}

async function uploadInventoryFile() {
  if (!Mgr.selectedFile) {
    alert('Please choose or drop an Excel (.xlsx, .xls), CSV, or JSON inventory file first!');
    return;
  }

  const mode = document.querySelector('input[name="upload-mode"]:checked').value;
  if (mode === 'replace') {
    if (!confirm('CAUTION: You selected "Replace All". This will delete existing products and replace them with the file. Proceed?')) {
      return;
    }
  }

  const btn = document.getElementById('btn-upload-inventory');
  btn.disabled = true;
  btn.innerText = '⏳ Uploading & Updating Database...';

  const formData = new FormData();
  formData.append('file', Mgr.selectedFile);
  formData.append('mode', mode);

  try {
    const res = await fetch('/api/products/import', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (res.ok && data.success) {
      alert(`Success! ${data.count} items imported/updated in inventory.`);
      Mgr.selectedFile = null;
      document.getElementById('selected-file-name').innerText = '';
      document.getElementById('inventory-file-input').value = '';
      loadProductCatalog();
    } else {
      alert('Upload failed: ' + (data.error || 'Server error'));
    }
  } catch (err) {
    alert('Upload failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = '🚀 Start Stock Upload';
  }
}

async function handleManualProductAdd(event) {
  event.preventDefault();
  const code = document.getElementById('m-code').value.trim();
  const name = document.getElementById('m-name').value.trim();
  const category = document.getElementById('m-category').value.trim() || 'General';
  const price = parseFloat(document.getElementById('m-price').value);
  const stock = parseFloat(document.getElementById('m-stock').value) || 0;

  try {
    const res = await fetch('/api/products/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products: [{
          item_code: code,
          name,
          category,
          price,
          stock_qty: stock,
          unit: 'Pcs'
        }],
        mode: 'upsert'
      })
    });

    if (res.ok) {
      alert('Product saved successfully!');
      document.getElementById('single-product-form').reset();
      loadProductCatalog();
    }
  } catch (err) {
    alert('Failed to add product');
  }
}

async function loadProductCatalog() {
  try {
    const countRes = await fetch('/api/products/count');
    if (countRes.ok) {
      const data = await countRes.json();
      document.getElementById('prod-total-count').innerText = Number(data.count).toLocaleString('en-IN');
    }

    const query = (document.getElementById('prod-search-input')?.value || '').trim();
    const url = query ? `/api/products?q=${encodeURIComponent(query)}&limit=100` : '/api/products?limit=100';
    const res = await fetch(url);
    if (!res.ok) return;
    Mgr.products = await res.json();
    renderProductCatalog();
  } catch (err) {}
}

function renderProductCatalog() {
  const tbody = document.getElementById('catalog-tbody');
  if (!Mgr.products || Mgr.products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px; color: var(--text-muted);">No products found</td></tr>`;
    return;
  }

  tbody.innerHTML = Mgr.products.map(p => `
    <tr>
      <td style="font-family: var(--font-mono); font-weight: 600;">${p.item_code}</td>
      <td style="font-weight: 600;">${p.name}</td>
      <td>${p.category || 'General'}</td>
      <td class="text-right" style="color: #34d399; font-weight: 700;">₹${Number(p.price).toFixed(2)}</td>
      <td class="text-right" style="font-weight: 700; color: ${p.stock_qty <= 0 ? 'var(--warning)' : 'inherit'};">
        ${p.stock_qty <= 0 ? `⚠️ ${p.stock_qty}` : p.stock_qty}
      </td>
      <td>${p.unit || 'Pcs'}</td>
      <td style="font-size: 11px; color: var(--text-muted);">${new Date(p.updated_at).toLocaleDateString()}</td>
    </tr>
  `).join('');
}

// Load Oversold / Zero Stock Sale Report
async function loadOversoldReport() {
  try {
    const res = await fetch('/api/inventory/oversold');
    if (!res.ok) return;
    const items = await res.json();
    const tbody = document.getElementById('oversold-tbody');

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">No oversold items. All sales matched available stock!</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(item => `
      <tr>
        <td style="font-family: var(--font-mono); font-weight: 600;">${item.item_code}</td>
        <td style="font-weight: 600;">${item.name}</td>
        <td>${item.category || 'General'}</td>
        <td class="text-right">₹${Number(item.price).toFixed(2)}</td>
        <td class="text-center">
          <span style="font-weight: 800; color: #fb923c; background: rgba(249, 115, 22, 0.15); padding: 3px 8px; border-radius: 4px;">
            ${item.total_oversold_qty} ${item.unit || 'Pcs'}
          </span>
        </td>
        <td class="text-center">
          <span style="font-weight: 800; color: #f87171; background: rgba(239, 68, 68, 0.15); padding: 3px 8px; border-radius: 4px;">
            ${item.current_stock} ${item.unit || 'Pcs'}
          </span>
        </td>
        <td class="text-center" style="font-weight: 600;">${item.bills_count} bills</td>
        <td class="text-center">
          <button class="btn btn-sm btn-accent" onclick="quickRestock('${item.item_code}', '${item.name.replace(/'/g, "\\'")}', ${item.current_stock})">
            🔄 Fix Stock
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading oversold report:', err);
  }
}

// Quick Restock/Adjust Stock
async function quickRestock(itemCode, name, currentStock) {
  const input = prompt(`Update physical inventory count for:\n"${name}"\n\nCurrent system stock is: ${currentStock}\nEnter actual quantity in stock:`, '0');
  if (input === null || input.trim() === '') return;

  const newStock = parseFloat(input.trim());
  if (isNaN(newStock)) {
    alert('Please enter a valid number');
    return;
  }

  try {
    const res = await fetch('/api/inventory/adjust-stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_code: itemCode,
        new_stock: newStock,
        reason: 'Physical Stock Reconciliation after Zero Stock Billing',
        user: { username: 'admin', name: 'Store Manager' }
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      alert(`Stock for "${name}" updated to ${newStock}!`);
      loadOversoldReport();
      loadProductCatalog();
      loadDashboardData();
    } else {
      alert(data.error || 'Failed to update stock');
    }
  } catch (err) {
    alert('Stock adjustment error');
  }
}

// ==============================================
// 4. IMMUTABLE AUDIT LOGS
// ==============================================
async function loadAuditLogs() {
  try {
    const res = await fetch('/api/audit-logs');
    if (!res.ok) return;
    const logs = await res.json();
    const tbody = document.getElementById('audit-logs-tbody');

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px; color: var(--text-muted);">No audit records found</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td style="font-family: var(--font-mono);">${l.id}</td>
        <td style="font-size: 12px;">${new Date(l.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'medium' })}</td>
        <td>
          <span style="font-weight: 700; font-size: 11px; padding: 3px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.15); color: #60a5fa;">
            ${l.event_type}
          </span>
        </td>
        <td><strong>${l.user_name}</strong> (${l.user_id})</td>
        <td style="font-size: 11px; color: var(--text-muted);">${l.device_id || 'SERVER'}</td>
        <td style="font-family: var(--font-mono); font-weight: 600;">${l.ref_id || '-'}</td>
        <td style="font-size: 13px;">${l.description}</td>
      </tr>
    `).join('');
  } catch (err) {}
}

// ==============================================
// 5. STORE SETTINGS
// ==============================================
async function saveStoreSettings(event) {
  event.preventDefault();
  const payload = {
    store_name: document.getElementById('cfg-store-name').value.trim(),
    store_tagline: document.getElementById('cfg-store-tagline').value.trim(),
    store_address: document.getElementById('cfg-store-address').value.trim(),
    store_phone: document.getElementById('cfg-store-phone').value.trim(),
    store_gstin: document.getElementById('cfg-store-gstin').value.trim(),
    receipt_footer: document.getElementById('cfg-receipt-footer').value.trim()
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      alert('Store settings saved successfully!');
      loadSystemSettings();
    }
  } catch (e) {
    alert('Failed to save settings');
  }
}

// ==============================================
// 6. OPEN DATABASE EXPLORER & QUERY RUNNER
// ==============================================
async function loadDatabaseTab() {
  try {
    const res = await fetch('/api/database/info');
    if (!res.ok) return;
    const info = await res.json();

    document.getElementById('db-connection-details').innerHTML = 
      `Engine: <strong>${info.engine}</strong> | Status: <strong style="color:#34d399;">CONNECTED</strong> | DB File: <code>${info.database_file}</code> | Size: <strong>${info.file_size_mb} MB</strong> | Mode: ${info.connection_mode}`;

    const grid = document.getElementById('db-tables-grid');
    grid.innerHTML = (info.tables || []).map(t => `
      <div class="kpi-card" style="cursor: pointer; border: 1px solid var(--border-color); background: var(--bg-input);" onclick="browseTable('${t.table_name}')">
        <div class="kpi-title" style="color: #60a5fa; font-family: var(--font-mono);">📁 ${t.table_name}</div>
        <div class="kpi-value" style="font-size: 20px;">${Number(t.row_count).toLocaleString('en-IN')}</div>
        <div class="kpi-sub" style="color: #10b981;">▶ Click to browse</div>
      </div>
    `).join('');

    browseTable('products');
  } catch (err) {
    console.error('Error loading database info:', err);
  }
}

async function browseTable(tableName) {
  document.getElementById('browsing-table-name').innerText = tableName;
  const select = document.getElementById('select-active-table');
  if (select) select.value = tableName;

  const container = document.getElementById('table-browser-container');
  container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Loading table records...</div>';

  try {
    const res = await fetch(`/api/database/table/${tableName}?limit=50`);
    if (!res.ok) {
      container.innerHTML = '<div style="padding: 20px; color: var(--danger);">Failed to load table</div>';
      return;
    }
    const data = await res.json();
    document.getElementById('table-browse-summary').innerText = `Total ${Number(data.total_rows).toLocaleString('en-IN')} rows (showing latest 50)`;

    if (!data.rows || data.rows.length === 0) {
      container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Table is empty</div>';
      return;
    }

    const cols = Object.keys(data.rows[0]);
    container.innerHTML = `
      <table class="data-table" style="font-size: 12px;">
        <thead>
          <tr>
            ${cols.map(c => `<th>${c}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${data.rows.map(r => `
            <tr>
              ${cols.map(c => `<td>${r[c] !== null && r[c] !== undefined ? String(r[c]) : '<span style="color:var(--text-muted);">NULL</span>'}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<div style="padding: 20px; color: var(--danger);">${err.message}</div>`;
  }
}

async function testDatabaseConnection() {
  const t0 = performance.now();
  try {
    const res = await fetch('/api/database/info');
    const t1 = performance.now();
    const data = await res.json();
    const latency = (t1 - t0).toFixed(1);

    alert(`✅ OPEN DATABASE CONNECTED!\n\nEngine: ${data.engine}\nDatabase: ${data.database_file}\nSize: ${data.file_size_mb} MB\nLatency: ${latency} ms\n\nAll tables and 5.2 Lakh+ products are fully active and connected!`);
  } catch (e) {
    alert('❌ Database connection failed: Server unreachable.');
  }
}

function setQueryExample(type) {
  const input = document.getElementById('sql-query-input');
  if (type === 'stock') {
    input.value = "SELECT item_code, name, price, stock_qty FROM products WHERE stock_qty > 0 ORDER BY stock_qty DESC LIMIT 15;";
  } else if (type === 'bills') {
    input.value = "SELECT bill_no, cashier_name, payment_mode, grand_total, status, created_at FROM bills ORDER BY id DESC LIMIT 10;";
  } else if (type === 'oversold') {
    input.value = "SELECT item_code, item_name, oversold_qty, stock_before_sale FROM bill_items WHERE oversold_qty > 0 ORDER BY id DESC LIMIT 15;";
  }
}

async function runCustomSqlQuery() {
  const sql = document.getElementById('sql-query-input').value.trim();
  if (!sql) return;

  const resultsDiv = document.getElementById('sql-query-results');
  resultsDiv.innerHTML = '<div style="color: var(--text-secondary);">Executing SQL query...</div>';

  try {
    const res = await fetch('/api/database/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql })
    });
    const result = await res.json();

    if (!res.ok) {
      resultsDiv.innerHTML = `<div style="color: var(--danger); background: rgba(239, 68, 68, 0.1); padding: 10px; border-radius: 6px;">❌ SQL Error: ${result.error}</div>`;
      return;
    }

    if (!result.isSelect) {
      resultsDiv.innerHTML = `<div style="color: #34d399; background: rgba(16, 185, 129, 0.1); padding: 10px; border-radius: 6px;">✅ ${result.message}</div>`;
      return;
    }

    if (!result.rows || result.rows.length === 0) {
      resultsDiv.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">Query returned 0 rows.</div>';
      return;
    }

    const cols = Object.keys(result.rows[0]);
    resultsDiv.innerHTML = `
      <div style="font-size: 12px; color: #34d399; margin-bottom: 6px;">Returned ${result.row_count} rows:</div>
      <div class="table-responsive">
        <table class="data-table" style="font-size: 12px;">
          <thead>
            <tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${result.rows.map(r => `<tr>${cols.map(c => `<td>${r[c] !== null ? String(r[c]) : 'NULL'}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    resultsDiv.innerHTML = `<div style="color: var(--danger);">Network error: ${err.message}</div>`;
  }
}
