const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { db, initDatabase, logAudit } = require('../db.js');

initDatabase();

// Ensure fast indexes exist
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_products_item_code ON products(item_code);
  CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
  PRAGMA synchronous = NORMAL;
`);

// Update store settings for Daftari Mega Mart
const setSetting = db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
setSetting.run('store_name', 'DAFTARI MEGA MART');
setSetting.run('store_tagline', 'Complete Family Supermarket & Retail');
setSetting.run('store_address', 'Neemchand Road, Kishanganj - 855107');
setSetting.run('store_phone', '+91 79706 05281');
setSetting.run('store_gstin', '10AAHCD2963P1ZG');
setSetting.run('receipt_footer', 'Thank You for shopping at Daftari Mega Mart! Visit Again.');

const csvPath = path.join(__dirname, '..', '3030_Current_St_ock_Detail_39_2026_10_25_120815.csv');
console.log('Starting Daftari Mega Mart stock import from:', csvPath);

if (!fs.existsSync(csvPath)) {
  console.error('Error: CSV file not found at:', csvPath);
  process.exit(1);
}

const stream = fs.createReadStream(csvPath);
const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

let headers = [];
let barcodeIdx = -1, itemCodeIdx = -1, nameIdx = -1, shortNameIdx = -1, catIdx = -1, sectionIdx = -1;
let sellingIdx = -1, mrpIdx = -1, stockIdx = -1, taxIdx = -1, uomIdx = -1;

function parseCSVLine(text) {
  let p = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (c === '"') {
      if (inQuotes && text[i+1] === '"') { p += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      row.push(p); p = '';
    } else {
      p += c;
    }
  }
  row.push(p);
  return row;
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

let totalProcessed = 0;
let importedCount = 0;
let BATCH_SIZE = 10000;
let now = new Date().toISOString();

db.exec('BEGIN TRANSACTION;');

rl.on('line', (line) => {
  if (line.startsWith('CATEGORY,')) {
    headers = parseCSVLine(line).map(h => h.trim());
    barcodeIdx = headers.indexOf('Barcode value');
    itemCodeIdx = headers.indexOf('Item Code');
    nameIdx = headers.indexOf('Item Name');
    shortNameIdx = headers.indexOf('Short Name');
    catIdx = headers.indexOf('CATEGORY');
    sectionIdx = headers.indexOf('SECTION');
    sellingIdx = headers.indexOf('Selling');
    mrpIdx = headers.indexOf('MRP');
    stockIdx = headers.indexOf('Current Stock');
    taxIdx = headers.indexOf('Sales Tax %');
    uomIdx = headers.indexOf('UOM');
    return;
  }

  if (headers.length === 0) return;

  const row = parseCSVLine(line);
  let barcode = (row[barcodeIdx] || '').trim();
  const itemCode = (row[itemCodeIdx] || '').trim();
  if (!barcode || barcode === '-' || barcode === 'NA') {
    barcode = itemCode;
  }
  if (!barcode) return;

  const rawName = (row[shortNameIdx] || '').trim() || (row[nameIdx] || '').trim();
  if (!rawName) return;

  const cat = (row[catIdx] || '').trim() || (row[sectionIdx] || '').trim() || 'General';
  
  const sellingStr = (row[sellingIdx] || '0').replace(/,/g, '').trim();
  const mrpStr = (row[mrpIdx] || '0').replace(/,/g, '').trim();
  let price = parseFloat(sellingStr) || parseFloat(mrpStr) || 0;

  const stockStr = (row[stockIdx] || '0').replace(/,/g, '').trim();
  const stock = parseFloat(stockStr) || 0;

  const taxStr = (row[taxIdx] || '0').replace(/,/g, '').trim();
  const tax = parseFloat(taxStr) || 0;

  const unit = (row[uomIdx] || 'Pcs').trim() || 'Pcs';

  try {
    upsertStmt.run(barcode, rawName, cat, price, stock, unit, tax, now);
    importedCount++;
  } catch (err) {}

  totalProcessed++;
  if (totalProcessed % BATCH_SIZE === 0) {
    db.exec('COMMIT;');
    console.log(`Imported ${importedCount} items (${totalProcessed} rows parsed)...`);
    db.exec('BEGIN TRANSACTION;');
  }
});

rl.on('close', () => {
  try {
    db.exec('COMMIT;');
  } catch (e) {}

  logAudit(
    'INVENTORY_UPLOAD',
    'MANAGER',
    'Store Manager',
    'SERVER',
    'DAFTARI_STOCK_CSV',
    `Imported ${importedCount} items from Daftari Mega Mart master stock file`
  );

  console.log('====================================================');
  console.log(`✅ SUCCESS! Imported ${importedCount} products into SQLite database.`);
  console.log(`✅ Store configured for: DAFTARI MEGA MART (Kishanganj)`);
  console.log('====================================================');
});
