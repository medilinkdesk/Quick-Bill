const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dbPath = path.join(__dirname, 'quickbill.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for high concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize Tables
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      pin TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      price REAL NOT NULL,
      stock_qty REAL DEFAULT 0,
      unit TEXT DEFAULT 'Pcs',
      tax_percent REAL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_no TEXT UNIQUE NOT NULL,
      client_bill_id TEXT UNIQUE NOT NULL,
      cashier_id TEXT NOT NULL,
      cashier_name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETED', -- 'COMPLETED', 'CANCELLED'
      cancellation_reason TEXT,
      cancelled_by TEXT,
      cancelled_at TEXT,
      subtotal REAL NOT NULL,
      discount REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      grand_total REAL NOT NULL,
      payment_mode TEXT NOT NULL DEFAULT 'CASH', -- 'CASH', 'UPI', 'CARD', 'SPLIT'
      cash_tendered REAL DEFAULT 0,
      change_returned REAL DEFAULT 0,
      customer_phone TEXT,
      customer_name TEXT,
      main_software_status TEXT DEFAULT 'PENDING', -- 'PENDING', 'ENTERED'
      main_software_ref TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bill_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      bill_no TEXT NOT NULL,
      item_code TEXT NOT NULL,
      item_name TEXT NOT NULL,
      price REAL NOT NULL,
      qty REAL NOT NULL,
      unit TEXT DEFAULT 'Pcs',
      discount REAL DEFAULT 0,
      tax_percent REAL DEFAULT 0,
      total REAL NOT NULL,
      stock_before_sale REAL DEFAULT 0,
      oversold_qty REAL DEFAULT 0,
      FOREIGN KEY (bill_id) REFERENCES bills(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      device_id TEXT,
      ref_id TEXT,
      description TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrations for existing databases
  try { db.exec('ALTER TABLE bill_items ADD COLUMN stock_before_sale REAL DEFAULT 0;'); } catch (e) {}
  try { db.exec('ALTER TABLE bill_items ADD COLUMN oversold_qty REAL DEFAULT 0;'); } catch (e) {}

  // Default Users
  const userCheck = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCheck.count === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, pin, role, name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    insertUser.run('admin', '9999', 'manager', 'Store Manager', now);
    insertUser.run('cashier1', '1234', 'cashier', 'Cashier A (Counter 1)', now);
    insertUser.run('cashier2', '1234', 'cashier', 'Cashier B (Counter 2)', now);
    insertUser.run('cashier3', '1234', 'cashier', 'Cashier C (Counter 3)', now);
  }

  // Default Store Settings
  const storeCheck = db.prepare("SELECT value FROM app_settings WHERE key = 'store_name'").get();
  if (!storeCheck) {
    const insertSetting = db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
    insertSetting.run('store_name', 'QUICK SUPERMARKET');
    insertSetting.run('store_tagline', 'Emergency POS & Express Billing');
    insertSetting.run('store_address', 'Main Market, City Center');
    insertSetting.run('store_phone', '+91 98765 43210');
    insertSetting.run('store_gstin', '07AAAAA0000A1Z5');
    insertSetting.run('currency_symbol', '₹');
    insertSetting.run('receipt_footer', 'Thank You! Please Visit Again.');
  }

  // Preload initial sample products if empty
  const prodCheck = db.prepare('SELECT COUNT(*) as count FROM products').get();
  if (prodCheck.count === 0) {
    const insertProd = db.prepare(`
      INSERT INTO products (item_code, name, category, price, stock_qty, unit, tax_percent, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    const sampleProducts = [
      ['890103000001', 'Amul Milk 500ml', 'Dairy', 33, 50, 'Pkt', 0],
      ['890103000002', 'Tata Salt 1kg', 'Grocery', 28, 100, 'Pkt', 0],
      ['890103000003', 'Aashirvaad Atta 5kg', 'Staples', 245, 40, 'Bag', 0],
      ['890103000004', 'Fortune Sunflower Oil 1L', 'Oils', 145, 60, 'Pouch', 5],
      ['890103000005', 'Parle-G Biscuit 100g', 'Snacks', 10, 200, 'Pkt', 0],
      ['890103000006', 'Maggi 2-Minute Noodles 70g', 'Instant Food', 14, 150, 'Pkt', 0],
      ['890103000007', 'Surf Excel Easy Wash 1kg', 'Cleaning', 135, 30, 'Pkt', 18],
      ['890103000008', 'Dettol Soap 125g (Pack of 3)', 'Personal Care', 120, 45, 'Pack', 18],
      ['890103000009', 'Brooke Bond Red Label Tea 250g', 'Beverages', 130, 50, 'Box', 5],
      ['890103000010', 'Basmati Rice Daily 1kg', 'Staples', 95, 80, 'Kg', 0],
      ['890103000011', 'Sugar 1kg (Loose)', 'Staples', 44, 200, 'Kg', 0],
      ['890103000012', 'Coca Cola 750ml', 'Beverages', 40, 75, 'Btl', 28],
    ];
    for (const p of sampleProducts) {
      insertProd.run(p[0], p[1], p[2], p[3], p[4], p[5], p[6], now);
    }
  }
}

// Audit Logger
function logAudit(eventType, userId, userName, deviceId, refId, description, metadata = null) {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (event_type, user_id, user_name, device_id, ref_id, description, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    eventType,
    userId || 'SYSTEM',
    userName || 'System',
    deviceId || 'N/A',
    refId || 'N/A',
    description,
    metadata ? (typeof metadata === 'object' ? JSON.stringify(metadata) : String(metadata)) : null,
    new Date().toISOString()
  );
}

// Next Sequential Bill Number
function generateBillNo() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const datePrefix = `QB-${yyyy}${mm}${dd}`;

  const row = db.prepare(`
    SELECT bill_no FROM bills
    WHERE bill_no LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(`${datePrefix}-%`);

  let nextSeq = 1;
  if (row && row.bill_no) {
    const parts = row.bill_no.split('-');
    if (parts.length >= 3) {
      nextSeq = parseInt(parts[2], 10) + 1;
    }
  }
  return `${datePrefix}-${String(nextSeq).padStart(4, '0')}`;
}

// Create Bill Transaction (Idempotent by client_bill_id)
function createBill(billData) {
  // Check if bill already exists by client_bill_id (prevents duplicate sync)
  const existing = db.prepare('SELECT * FROM bills WHERE client_bill_id = ?').get(billData.client_bill_id);
  if (existing) {
    const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(existing.id);
    return { bill: existing, items, alreadyExisted: true };
  }

  // Generate unique server bill number
  const billNo = generateBillNo();
  const now = new Date().toISOString();
  const syncedAt = now;
  const createdAt = billData.created_at || now;

  // Insert bill
  const insertBill = db.prepare(`
    INSERT INTO bills (
      bill_no, client_bill_id, cashier_id, cashier_name, device_id,
      status, subtotal, discount, tax_amount, grand_total,
      payment_mode, cash_tendered, change_returned, customer_phone, customer_name,
      main_software_status, created_at, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insertBill.run(
    billNo,
    billData.client_bill_id,
    billData.cashier_id,
    billData.cashier_name || 'Cashier',
    billData.device_id || 'unknown-device',
    'COMPLETED',
    billData.subtotal || billData.grand_total,
    billData.discount || 0,
    billData.tax_amount || 0,
    billData.grand_total,
    billData.payment_mode || 'CASH',
    billData.cash_tendered || 0,
    billData.change_returned || 0,
    billData.customer_phone || '',
    billData.customer_name || '',
    'PENDING',
    createdAt,
    syncedAt
  );

  const billId = Number(result.lastInsertRowid);

  // Insert bill items and decrement stock
  const insertItem = db.prepare(`
    INSERT INTO bill_items (bill_id, bill_no, item_code, item_name, price, qty, unit, discount, tax_percent, total, stock_before_sale, oversold_qty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStock = db.prepare(`
    UPDATE products SET stock_qty = stock_qty - ? WHERE item_code = ?
  `);

  const oversoldItemsInBill = [];

  if (Array.isArray(billData.items)) {
    for (const item of billData.items) {
      const code = item.item_code || '';
      let stockBefore = 0;
      let oversoldQty = 0;

      if (code) {
        const prod = db.prepare('SELECT stock_qty FROM products WHERE item_code = ?').get(code);
        if (prod) {
          stockBefore = Number(prod.stock_qty || 0);
        }
        if (stockBefore <= 0) {
          oversoldQty = item.qty;
        } else if (item.qty > stockBefore) {
          oversoldQty = item.qty - stockBefore;
        }
      }

      if (oversoldQty > 0) {
        oversoldItemsInBill.push({
          item_code: code,
          item_name: item.item_name || item.name || 'Item',
          qty_sold: item.qty,
          stock_before: stockBefore,
          oversold_qty: oversoldQty
        });
      }

      insertItem.run(
        billId,
        billNo,
        code,
        item.item_name || item.name || 'Item',
        item.price,
        item.qty,
        item.unit || 'Pcs',
        item.discount || 0,
        item.tax_percent || 0,
        item.total,
        stockBefore,
        oversoldQty
      );

      if (code) {
        try {
          updateStock.run(item.qty, code);
        } catch (e) {
          console.error(`Failed to update stock for item ${code}:`, e.message);
        }
      }
    }
  }

  // If items were sold without stock, record explicit audit event
  if (oversoldItemsInBill.length > 0) {
    const summaryText = oversoldItemsInBill
      .map(o => `${o.item_name} (Sold: ${o.qty_sold}, Stock: ${o.stock_before}, Sold w/o Stock: ${o.oversold_qty})`)
      .join('; ');

    logAudit(
      'ZERO_STOCK_SALE',
      billData.cashier_id,
      billData.cashier_name,
      billData.device_id,
      billNo,
      `⚠️ ${oversoldItemsInBill.length} item(s) sold without stock in Bill ${billNo}: ${summaryText}`,
      { bill_id: billId, bill_no: billNo, oversold_items: oversoldItemsInBill }
    );
  }

  // Audit Log
  logAudit(
    'BILL_CREATED',
    billData.cashier_id,
    billData.cashier_name,
    billData.device_id,
    billNo,
    `Bill ${billNo} generated for ₹${billData.grand_total} (${billData.payment_mode})`,
    {
      bill_id: billId,
      bill_no: billNo,
      client_bill_id: billData.client_bill_id,
      items_count: billData.items ? billData.items.length : 0,
      grand_total: billData.grand_total
    }
  );

  const createdBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
  const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(billId);

  return { bill: createdBill, items, alreadyExisted: false };
}

// Cancel Bill (Anti-Tampering: Never deletes bill, preserves record, logs reason and restores stock)
function cancelBill(billIdOrNo, user, reason) {
  let bill = null;
  if (typeof billIdOrNo === 'number' || !isNaN(Number(billIdOrNo))) {
    bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(Number(billIdOrNo));
  } else {
    bill = db.prepare('SELECT * FROM bills WHERE bill_no = ?').get(billIdOrNo);
  }

  if (!bill) {
    throw new Error('Bill not found');
  }

  if (bill.status === 'CANCELLED') {
    throw new Error('Bill is already cancelled');
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE bills SET
      status = 'CANCELLED',
      cancellation_reason = ?,
      cancelled_by = ?,
      cancelled_at = ?
    WHERE id = ?
  `).run(reason || 'No reason provided', user.name || user.username, now, bill.id);

  // Restore inventory stock
  const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(bill.id);
  const restoreStock = db.prepare('UPDATE products SET stock_qty = stock_qty + ? WHERE item_code = ?');
  for (const item of items) {
    if (item.item_code) {
      restoreStock.run(item.qty, item.item_code);
    }
  }

  // Audit event
  logAudit(
    'BILL_CANCELLED',
    user.username || user.id,
    user.name || user.username,
    user.device_id || 'SERVER',
    bill.bill_no,
    `Bill ${bill.bill_no} cancelled. Reason: ${reason}`,
    {
      bill_id: bill.id,
      bill_no: bill.bill_no,
      grand_total: bill.grand_total,
      reason
    }
  );

  return db.prepare('SELECT * FROM bills WHERE id = ?').get(bill.id);
}

// Mark Main Software Status (Reconciliation)
function updateMainSoftwareStatus(billId, status, refNo = '', user = {}) {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
  if (!bill) throw new Error('Bill not found');

  db.prepare(`
    UPDATE bills SET main_software_status = ?, main_software_ref = ? WHERE id = ?
  `).run(status, refNo, billId);

  logAudit(
    'RECONCILIATION_UPDATED',
    user.username || 'MANAGER',
    user.name || 'Store Manager',
    user.device_id || 'SERVER',
    bill.bill_no,
    `Bill ${bill.bill_no} marked as '${status}' in Main Software (Ref: ${refNo || 'N/A'})`
  );

  return db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
}

// Bulk Import Products (Excel, CSV, JSON)
function importProducts(productsList, mode = 'upsert') {
  const now = new Date().toISOString();

  if (mode === 'replace') {
    db.exec('DELETE FROM products;');
  }

  const upsertStmt = db.prepare(`
    INSERT INTO products (item_code, name, category, price, stock_qty, unit, tax_percent, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_code) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      price = excluded.price,
      stock_qty = excluded.stock_qty,
      unit = excluded.unit,
      tax_percent = excluded.tax_percent,
      updated_at = excluded.updated_at
  `);

  let addedCount = 0;
  for (const p of productsList) {
    const code = String(p.item_code || p.barcode || p.code || p.sku || '').trim();
    const name = String(p.name || p.item_name || p.title || '').trim();
    if (!code || !name) continue;

    const category = String(p.category || 'General').trim();
    const price = parseFloat(p.price || p.rate || p.mrp || 0) || 0;
    const stockQty = parseFloat(p.stock_qty || p.qty || p.stock || 0) || 0;
    const unit = String(p.unit || 'Pcs').trim();
    const taxPercent = parseFloat(p.tax_percent || p.tax || p.gst || 0) || 0;

    upsertStmt.run(code, name, category, price, stockQty, unit, taxPercent, now);
    addedCount++;
  }

  logAudit(
    'INVENTORY_UPLOAD',
    'MANAGER',
    'Store Manager',
    'SERVER',
    'PRODUCTS',
    `Imported ${addedCount} products into database (Mode: ${mode})`
  );

  return { success: true, count: addedCount };
}

// Dashboard Statistics & Reports
function getDashboardMetrics(dateStr = null) {
  let dateQuery = '';
  const params = [];

  if (dateStr) {
    dateQuery = "WHERE date(created_at) = date(?)";
    params.push(dateStr);
  }

  // Summary Metrics
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_bills,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed_bills,
      COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_bills,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN grand_total ELSE 0 END), 0) AS total_sales,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' AND payment_mode = 'CASH' THEN grand_total ELSE 0 END), 0) AS cash_sales,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' AND payment_mode = 'UPI' THEN grand_total ELSE 0 END), 0) AS upi_sales,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' AND payment_mode = 'CARD' THEN grand_total ELSE 0 END), 0) AS card_sales,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' AND main_software_status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_main_software
    FROM bills ${dateQuery}
  `).get(...params);

  // Metrics for items sold without stock (Oversold / Negative stock tracking)
  const oversoldSummary = db.prepare(`
    SELECT
      COUNT(DISTINCT bi.item_code) AS oversold_items_count,
      COALESCE(SUM(bi.oversold_qty), 0) AS oversold_pieces_total
    FROM bill_items bi
    JOIN bills b ON bi.bill_id = b.id
    WHERE bi.oversold_qty > 0 AND b.status = 'COMPLETED'
    ${dateStr ? "AND date(b.created_at) = date(?)" : ""}
  `).get(...params);

  summary.oversold_items_count = oversoldSummary.oversold_items_count || 0;
  summary.oversold_pieces_total = oversoldSummary.oversold_pieces_total || 0;

  // Cashier-wise Breakdown Table
  const cashierBreakdown = db.prepare(`
    SELECT
      cashier_id,
      cashier_name,
      COUNT(*) AS generated_bills,
      COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_bills,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN grand_total ELSE 0 END), 0) AS net_sales,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' AND main_software_status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_main_entry
    FROM bills ${dateQuery}
    GROUP BY cashier_id, cashier_name
    ORDER BY net_sales DESC
  `).all(...params);

  return { summary, cashierBreakdown };
}

// Detailed report of all items that were sold without stock or currently have negative stock
function getOversoldReport() {
  return db.prepare(`
    SELECT
      p.item_code,
      p.name,
      p.category,
      p.price,
      p.stock_qty as current_stock,
      p.unit,
      COALESCE(SUM(bi.oversold_qty), 0) as total_oversold_qty,
      COUNT(DISTINCT bi.bill_id) as bills_count
    FROM products p
    LEFT JOIN bill_items bi ON p.item_code = bi.item_code
    LEFT JOIN bills b ON bi.bill_id = b.id AND b.status = 'COMPLETED'
    WHERE p.stock_qty < 0 OR bi.oversold_qty > 0
    GROUP BY p.item_code, p.name, p.category, p.price, p.stock_qty, p.unit
    ORDER BY total_oversold_qty DESC, p.stock_qty ASC
  `).all();
}

// Adjust/Reconcile Product Stock
function adjustStock(itemCode, newStock, reason, user = {}) {
  const prod = db.prepare('SELECT * FROM products WHERE item_code = ?').get(itemCode);
  if (!prod) throw new Error('Product not found: ' + itemCode);

  const prevStock = prod.stock_qty;
  const now = new Date().toISOString();
  db.prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE item_code = ?')
    .run(Number(newStock), now, itemCode);

  logAudit(
    'STOCK_ADJUSTMENT',
    user.username || 'MANAGER',
    user.name || 'Store Manager',
    user.device_id || 'SERVER',
    itemCode,
    `Stock adjusted for '${prod.name}' from ${prevStock} to ${newStock} ${prod.unit}. Reason: ${reason || 'Physical Stock Verification'}`
  );

  return db.prepare('SELECT * FROM products WHERE item_code = ?').get(itemCode);
}

// Database Info & Schema Overview (Open Database Explorer)
function getDatabaseInfo() {
  const stat = fs.statSync(dbPath);
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC
  `).all();

  const tableStats = tables.map(t => {
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get();
    return {
      table_name: t.name,
      row_count: countRow ? countRow.count : 0
    };
  });

  return {
    engine: 'SQLite 3 (Built-in Open Database)',
    database_file: 'quickbill.db',
    file_path: dbPath,
    file_size_bytes: stat.size,
    file_size_mb: (stat.size / (1024 * 1024)).toFixed(2),
    connected: true,
    connection_mode: 'WAL (Write-Ahead Logging)',
    tables: tableStats
  };
}

// Browse records of any table
function getTableData(tableName, limit = 50, offset = 0) {
  const validTables = ['users', 'products', 'bills', 'bill_items', 'audit_logs', 'app_settings'];
  if (!validTables.includes(tableName)) {
    throw new Error('Invalid table name: ' + tableName);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM "${tableName}"`).get();
  const totalRows = countRow ? countRow.total : 0;

  const rows = db.prepare(`SELECT * FROM "${tableName}" ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(
    parseInt(limit, 10),
    parseInt(offset, 10)
  );

  return {
    table: tableName,
    total_rows: totalRows,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
    rows
  };
}

// Execute custom SQL query (Safe query runner)
function executeCustomQuery(sqlQuery) {
  const trimmed = sqlQuery.trim();
  if (trimmed.toUpperCase().startsWith('SELECT') || trimmed.toUpperCase().startsWith('PRAGMA')) {
    const rows = db.prepare(trimmed).all();
    return { success: true, isSelect: true, row_count: rows.length, rows };
  } else {
    db.exec(trimmed);
    return { success: true, isSelect: false, message: 'SQL Query executed successfully.' };
  }
}

module.exports = {
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
};
