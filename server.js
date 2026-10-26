const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const XLSX = require('xlsx');

const {
  db,
  initDatabase,
  logAudit,
  createBill,
  cancelBill,
  updateMainSoftwareStatus,
  importProducts,
  getDashboardMetrics,
  getOversoldReport,
  adjustStock,
  getDatabaseInfo,
  getTableData,
  executeCustomQuery,
  generateBillNo
} = require('./db.js');

const PDFInvoice = require('./public/js/pdf-generator.js');

// Initialize Database Schema
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Multer upload config
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

// Helper: Get Local LAN IPv4 Addresses
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const k in interfaces) {
    for (const addr of interfaces[k]) {
      if (addr.family === 'IPv4' && !addr.internal) {
        addresses.push(addr.address);
      }
    }
  }
  return addresses;
}

// ==========================================
// 1. SYSTEM & NETWORK INFO
// ==========================================
app.get('/api/system-info', (req, res) => {
  const ips = getLocalIPs();
  const primaryIP = ips[0] || '127.0.0.1';

  const settingsRows = db.prepare('SELECT key, value FROM app_settings').all();
  const settings = {};
  for (const row of settingsRows) {
    settings[row.key] = row.value;
  }

  res.json({
    status: 'ONLINE',
    server_time: new Date().toISOString(),
    primary_ip: primaryIP,
    all_ips: ips,
    port: PORT,
    cashier_url: `http://${primaryIP}:${PORT}`,
    manager_url: `http://${primaryIP}:${PORT}/manager.html`,
    settings
  });
});

// Update Store Settings
app.post('/api/settings', (req, res) => {
  const { store_name, store_tagline, store_address, store_phone, store_gstin, currency_symbol, receipt_footer } = req.body;
  const insertSetting = db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
  
  if (store_name !== undefined) insertSetting.run('store_name', store_name);
  if (store_tagline !== undefined) insertSetting.run('store_tagline', store_tagline);
  if (store_address !== undefined) insertSetting.run('store_address', store_address);
  if (store_phone !== undefined) insertSetting.run('store_phone', store_phone);
  if (store_gstin !== undefined) insertSetting.run('store_gstin', store_gstin);
  if (currency_symbol !== undefined) insertSetting.run('currency_symbol', currency_symbol);
  if (receipt_footer !== undefined) insertSetting.run('receipt_footer', receipt_footer);

  logAudit('SETTINGS_UPDATED', 'MANAGER', 'Store Manager', 'SERVER', 'APP_SETTINGS', 'Store settings updated');
  res.json({ success: true, message: 'Settings saved successfully' });
});

// ==========================================
// 2. AUTHENTICATION & CASHIERS
// ==========================================
app.post('/api/auth/login', (req, res) => {
  const { username, pin, device_id } = req.body;
  if (!username || !pin) {
    return res.status(400).json({ error: 'Username and PIN are required' });
  }

  const user = db.prepare('SELECT id, username, role, name, pin FROM users WHERE username = ?').get(username.trim());
  if (!user || user.pin !== String(pin).trim()) {
    return res.status(401).json({ error: 'Invalid User ID or PIN' });
  }

  logAudit(
    'LOGIN',
    user.username,
    user.name,
    device_id || 'UNKNOWN',
    user.username,
    `${user.name} logged in from device ${device_id || 'N/A'}`
  );

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role
    }
  });
});

app.get('/api/users', (req, res) => {
  const users = db.prepare('SELECT id, username, role, name, created_at FROM users ORDER BY id ASC').all();
  res.json(users);
});

app.post('/api/users', (req, res) => {
  const { username, pin, role, name } = req.body;
  if (!username || !pin || !name) {
    return res.status(400).json({ error: 'Username, PIN, and Name are required' });
  }

  try {
    const now = new Date().toISOString();
    const stmt = db.prepare('INSERT INTO users (username, pin, role, name, created_at) VALUES (?, ?, ?, ?, ?)');
    stmt.run(username.trim(), String(pin).trim(), role || 'cashier', name.trim(), now);

    logAudit('USER_CREATED', 'MANAGER', 'Store Manager', 'SERVER', username, `New user ${username} created (${role})`);
    res.json({ success: true, message: 'User created successfully' });
  } catch (err) {
    res.status(400).json({ error: 'Username already exists or invalid data' });
  }
});

// ==========================================
// 3. PRODUCTS & INVENTORY (UPLOAD / SEARCH)
// ==========================================
app.get('/api/products/count', (req, res) => {
  const row = db.prepare('SELECT COUNT(*) as count FROM products').get();
  res.json({ count: row ? row.count : 0 });
});

app.get('/api/products', (req, res) => {
  const { q, limit = 100 } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 100, 500);

  if (q && q.trim()) {
    const queryTerm = q.trim();
    // If exact barcode match, return immediately in 0.4ms
    const exactMatch = db.prepare('SELECT * FROM products WHERE item_code = ?').get(queryTerm);
    if (exactMatch) {
      return res.json([exactMatch]);
    }

    const searchTerm = `%${queryTerm}%`;
    const products = db.prepare(`
      SELECT * FROM products
      WHERE item_code LIKE ? OR name LIKE ? OR category LIKE ?
      ORDER BY (stock_qty > 0) DESC, name ASC LIMIT ?
    `).all(searchTerm, searchTerm, searchTerm, lim);
    return res.json(products);
  }

  const allProducts = db.prepare('SELECT * FROM products ORDER BY id DESC LIMIT ?').all(lim);
  res.json(allProducts);
});

app.get('/api/products/:code', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE item_code = ?').get(req.params.code);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

// Import products via Excel (.xlsx, .xls), CSV, or JSON
app.post('/api/products/import', upload.single('file'), (req, res) => {
  try {
    const mode = req.body.mode || 'upsert'; // 'upsert' or 'replace'
    let itemsToImport = [];

    if (req.file) {
      const filePath = req.file.path;
      const originalName = req.file.originalname.toLowerCase();

      if (originalName.endsWith('.json')) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        itemsToImport = JSON.parse(fileContent);
      } else {
        // Excel (.xlsx, .xls) or CSV
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        itemsToImport = XLSX.utils.sheet_to_json(sheet);
      }

      // Cleanup temp uploaded file
      try { fs.unlinkSync(filePath); } catch (e) {}
    } else if (req.body.products) {
      itemsToImport = Array.isArray(req.body.products) ? req.body.products : JSON.parse(req.body.products);
    } else {
      return res.status(400).json({ error: 'No file or products data provided' });
    }

    if (!Array.isArray(itemsToImport) || itemsToImport.length === 0) {
      return res.status(400).json({ error: 'Uploaded file contains no valid rows or products' });
    }

    const result = importProducts(itemsToImport, mode);
    res.json({
      success: true,
      message: `Successfully processed ${result.count} items into inventory`,
      count: result.count
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Failed to parse and import inventory: ' + err.message });
  }
});

// Download sample Excel template for stock upload
app.get('/api/products/sample-template', (req, res) => {
  const sampleData = [
    { item_code: '890103000001', name: 'Amul Milk 500ml', category: 'Dairy', price: 33, stock_qty: 50, unit: 'Pkt', tax_percent: 0 },
    { item_code: '890103000002', name: 'Tata Salt 1kg', category: 'Grocery', price: 28, stock_qty: 100, unit: 'Pkt', tax_percent: 0 },
    { item_code: '890103000003', name: 'Aashirvaad Atta 5kg', category: 'Staples', price: 245, stock_qty: 40, unit: 'Bag', tax_percent: 0 },
    { item_code: '890103000004', name: 'Fortune Oil 1L', category: 'Oils', price: 145, stock_qty: 60, unit: 'Pouch', tax_percent: 5 },
    { item_code: '890103000005', name: 'Parle-G 100g', category: 'Snacks', price: 10, stock_qty: 200, unit: 'Pkt', tax_percent: 0 }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'InventoryTemplate');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="QuickBill_Stock_Template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ==========================================
// 4. BILLING & SYNCHRONIZATION
// ==========================================
// Create single bill (Online or immediate sync)
app.post('/api/bills', (req, res) => {
  try {
    const billData = req.body;
    if (!billData.client_bill_id || !billData.cashier_id || !billData.grand_total) {
      return res.status(400).json({ error: 'Missing required bill fields (client_bill_id, cashier_id, grand_total)' });
    }

    const result = createBill(billData);
    res.status(201).json({
      success: true,
      bill: result.bill,
      items: result.items,
      alreadyExisted: result.alreadyExisted,
      bill_no: result.bill.bill_no
    });
  } catch (err) {
    console.error('Bill creation error:', err);
    res.status(500).json({ error: 'Failed to create bill: ' + err.message });
  }
});

// Batch sync endpoint for offline bills accumulated on mobile devices
app.post('/api/bills/batch-sync', (req, res) => {
  try {
    const { bills } = req.body;
    if (!Array.isArray(bills)) {
      return res.status(400).json({ error: 'Bills must be an array' });
    }

    const synced = [];
    const failed = [];

    for (const b of bills) {
      try {
        const result = createBill(b);
        synced.push({
          client_bill_id: b.client_bill_id,
          server_bill_no: result.bill.bill_no,
          alreadyExisted: result.alreadyExisted
        });
      } catch (err) {
        failed.push({
          client_bill_id: b.client_bill_id,
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      total_received: bills.length,
      synced_count: synced.length,
      failed_count: failed.length,
      synced,
      failed
    });
  } catch (err) {
    console.error('Batch sync error:', err);
    res.status(500).json({ error: 'Batch sync failed: ' + err.message });
  }
});

// Get Bills with filter
app.get('/api/bills', (req, res) => {
  const { date, cashier_id, status, main_status, search, limit = 100 } = req.query;
  let conditions = [];
  let params = [];

  if (date) {
    conditions.push("date(created_at) = date(?)");
    params.push(date);
  }
  if (cashier_id) {
    conditions.push("cashier_id = ?");
    params.push(cashier_id);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (main_status) {
    conditions.push("main_software_status = ?");
    params.push(main_status);
  }
  if (search) {
    conditions.push("(bill_no LIKE ? OR client_bill_id LIKE ? OR customer_phone LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `
    SELECT * FROM bills
    ${whereClause}
    ORDER BY id DESC
    LIMIT ?
  `;
  params.push(parseInt(limit, 10));

  const bills = db.prepare(query).all(...params);
  res.json(bills);
});

// Single bill with items
app.get('/api/bills/:id', (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ? OR bill_no = ?').get(req.params.id, req.params.id);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });

  const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(bill.id);
  res.json({ bill, items });
});

// Download / View Tax Invoice PDF
app.get('/api/bills/:id/pdf', (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ? OR bill_no = ?').get(req.params.id, req.params.id);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });

  const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(bill.id);

  const settingsRows = db.prepare('SELECT key, value FROM app_settings').all();
  const settings = {};
  for (const row of settingsRows) {
    settings[row.key] = row.value;
  }

  try {
    const pdfData = PDFInvoice.generateInvoicePDF(bill, items, settings);
    const filename = `DAFTARI_MEGA_MART_${bill.bill_no}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(Buffer.from(pdfData, 'binary'));
  } catch (err) {
    console.error('PDF Generation Error:', err);
    res.status(500).json({ error: 'Failed to generate PDF invoice: ' + err.message });
  }
});

// Clear All Bills for Live Launch (Manager Protected)
app.post('/api/bills/clear-all', (req, res) => {
  const { confirmation, user } = req.body;
  if (confirmation !== 'CLEAR_ALL_FOR_LIVE') {
    return res.status(400).json({ error: 'Confirmation string "CLEAR_ALL_FOR_LIVE" required' });
  }

  try {
    const count = db.prepare('SELECT count(*) as c FROM bills').get().c;
    db.exec('DELETE FROM bill_items;');
    db.exec('DELETE FROM bills;');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('bills', 'bill_items');");

    logAudit(
      'LIVE_INITIALIZATION',
      user?.username || 'MANAGER',
      user?.name || 'Store Manager',
      user?.device_id || 'SERVER',
      'BILLS',
      `Cleared all ${count} test bills to initialize clean live supermarket billing`
    );

    res.json({ success: true, message: `Cleared ${count} bills. System ready for live work!`, count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear bills: ' + err.message });
  }
});

// Cancel Bill (Mandatory reason, immutable audit log, stock restore)
app.post('/api/bills/:id/cancel', (req, res) => {
  const { user, reason } = req.body;
  if (!reason || reason.trim().length < 3) {
    return res.status(400).json({ error: 'A valid cancellation reason (minimum 3 characters) is required' });
  }

  try {
    const updatedBill = cancelBill(req.params.id, user || { username: 'cashier', name: 'Cashier' }, reason.trim());
    res.json({ success: true, message: 'Bill cancelled and stock restored', bill: updatedBill });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update Main Billing Software Reconciliation Status
app.post('/api/bills/:id/reconcile', (req, res) => {
  const { status, ref_no, user } = req.body; // status: 'ENTERED' or 'PENDING'
  if (!['ENTERED', 'PENDING'].includes(status)) {
    return res.status(400).json({ error: "Status must be 'ENTERED' or 'PENDING'" });
  }

  try {
    const updated = updateMainSoftwareStatus(Number(req.params.id), status, ref_no || '', user || {});
    res.json({ success: true, bill: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Bulk Reconcile (e.g. mark multiple bills as entered into main software)
app.post('/api/bills/bulk-reconcile', (req, res) => {
  const { bill_ids, status, ref_no, user } = req.body;
  if (!Array.isArray(bill_ids) || bill_ids.length === 0) {
    return res.status(400).json({ error: 'bill_ids must be a non-empty array' });
  }

  let updatedCount = 0;
  for (const id of bill_ids) {
    try {
      updateMainSoftwareStatus(Number(id), status || 'ENTERED', ref_no || '', user || {});
      updatedCount++;
    } catch (e) {}
  }

  res.json({ success: true, count: updatedCount });
});

// ==========================================
// 5. MANAGER DASHBOARD & EXPORTS
// ==========================================
app.get('/api/dashboard/metrics', (req, res) => {
  const { date } = req.query;
  const metrics = getDashboardMetrics(date || null);
  res.json(metrics);
});

// Export Daily Sales Report to Excel (.xlsx) for Tally / Busy / Marg / Vyapar entry
app.get('/api/reports/export-excel', (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  const bills = db.prepare(`
    SELECT * FROM bills
    WHERE date(created_at) = date(?)
    ORDER BY id ASC
  `).all(targetDate);

  const billRows = bills.map(b => ({
    'Bill No': b.bill_no,
    'Date & Time': b.created_at,
    'Cashier ID': b.cashier_id,
    'Cashier Name': b.cashier_name,
    'Device ID': b.device_id,
    'Status': b.status,
    'Payment Mode': b.payment_mode,
    'Subtotal (₹)': b.subtotal,
    'Discount (₹)': b.discount,
    'Tax Amount (₹)': b.tax_amount,
    'Grand Total (₹)': b.grand_total,
    'Cash Tendered': b.cash_tendered,
    'Change Returned': b.change_returned,
    'Customer Phone': b.customer_phone || '',
    'Customer Name': b.customer_name || '',
    'Main Software Status': b.main_software_status,
    'Cancellation Reason': b.cancellation_reason || ''
  }));

  const itemRows = db.prepare(`
    SELECT
      i.bill_no,
      b.created_at as 'Date',
      b.cashier_name,
      i.item_code,
      i.item_name,
      i.price as 'Rate (₹)',
      i.qty as 'Quantity',
      i.unit as 'Unit',
      i.discount as 'Discount (₹)',
      i.total as 'Total (₹)',
      i.stock_before_sale as 'Stock at Sale',
      i.oversold_qty as 'Sold Without Stock (Pcs)'
    FROM bill_items i
    JOIN bills b ON i.bill_id = b.id
    WHERE date(b.created_at) = date(?) AND b.status = 'COMPLETED'
    ORDER BY i.id ASC
  `).all(targetDate);

  const wb = XLSX.utils.book_new();
  const wsBills = XLSX.utils.json_to_sheet(billRows.length > 0 ? billRows : [{ Message: 'No bills found for this date' }]);
  const wsItems = XLSX.utils.json_to_sheet(itemRows.length > 0 ? itemRows : [{ Message: 'No items found for this date' }]);

  XLSX.utils.book_append_sheet(wb, wsBills, 'Bills Summary');
  XLSX.utils.book_append_sheet(wb, wsItems, 'Item-wise Details');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="QuickBill_Report_${targetDate}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// Report of items sold without stock or negative stock
app.get('/api/inventory/oversold', (req, res) => {
  try {
    const report = getOversoldReport();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Adjust product stock
app.post('/api/inventory/adjust-stock', (req, res) => {
  const { item_code, new_stock, reason, user } = req.body;
  if (!item_code || new_stock === undefined) {
    return res.status(400).json({ error: 'item_code and new_stock are required' });
  }
  try {
    const updated = adjustStock(item_code, new_stock, reason, user || { username: 'admin', name: 'Store Manager' });
    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 6. AUDIT LOGS (IMMUTABLE)
// ==========================================
app.get('/api/audit-logs', (req, res) => {
  const { event_type, user_id, limit = 200 } = req.query;
  let conditions = [];
  let params = [];

  if (event_type) {
    conditions.push("event_type = ?");
    params.push(event_type);
  }
  if (user_id) {
    conditions.push("user_id = ?");
    params.push(user_id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT * FROM audit_logs ${whereClause} ORDER BY id DESC LIMIT ?`;
  params.push(parseInt(limit, 10));

  const logs = db.prepare(query).all(...params);
  res.json(logs);
});

// ==========================================
// 7. OPEN DATABASE EXPLORER & QUERY API
// ==========================================
app.get('/api/database/info', (req, res) => {
  try {
    const info = getDatabaseInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/database/table/:name', (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  try {
    const data = getTableData(req.params.name, limit, offset);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/database/query', (req, res) => {
  const { sql } = req.body;
  if (!sql || !sql.trim()) {
    return res.status(400).json({ error: 'SQL query cannot be empty' });
  }
  try {
    const result = executeCustomQuery(sql);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 8. BACKUP & RESTORE
// ==========================================
app.get('/api/backup/download', (req, res) => {
  const dbFile = path.join(__dirname, 'quickbill.db');
  if (!fs.existsSync(dbFile)) return res.status(404).send('Database file not found');

  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  logAudit('DATABASE_BACKUP', 'MANAGER', 'Store Manager', 'SERVER', 'BACKUP', 'Full database backup downloaded');
  res.download(dbFile, `QuickBill_Backup_${dateStr}.db`);
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('=====================================================');
  console.log('🚀 QUICKBILL EMERGENCY POS SERVER STARTED');
  console.log('=====================================================');
  console.log(`📡 Local Host:       http://localhost:${PORT}`);
  if (ips.length > 0) {
    console.log(`📱 Cashier Mobile:   http://${ips[0]}:${PORT}`);
    console.log(`💻 Manager Screen:    http://${ips[0]}:${PORT}/manager.html`);
  }
  console.log('=====================================================');
  console.log('✅ Offline SQLite Central Database: quickbill.db');
  console.log('✅ Wi-Fi LAN Emergency Mode Ready (No Internet Required!)');
  console.log('=====================================================');
});
