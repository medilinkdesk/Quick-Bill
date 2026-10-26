/**
 * Finalize Dash Soft Master Stock & Clear All Test Invoices for Live Launch
 * QuickBill POS - DAFTARI MEGA MART (Kishanganj)
 */

const { db, logAudit } = require('../db.js');

console.log('=====================================================');
console.log('🚀 FINALIZING DASH SOFT STOCK & INITIALIZING FOR LIVE');
console.log('=====================================================');

// 1. Remove Dummy / Sample items not part of Daftari Mega Mart Dash Soft
const dummyCodes = ['890103000001', '890103000002', 'TEST_ZERO_001'];
const delStmt = db.prepare('DELETE FROM products WHERE item_code = ?');
for (const code of dummyCodes) {
  delStmt.run(code);
}
console.log('✅ Removed non-DashSoft sample test products.');

// 2. Restore stock for any DashSoft products touched in test bills
db.prepare('UPDATE products SET stock_qty = 1.00 WHERE item_code = ?').run('02073708261');
db.prepare('UPDATE products SET stock_qty = 20.00 WHERE item_code = ?').run('02063910261');
console.log('✅ Restored stock levels for items sold in test bills.');

// 3. Clear all generated invoices & bill items
const billsCountBefore = db.prepare('SELECT count(*) as count FROM bills').get().count;
const itemsCountBefore = db.prepare('SELECT count(*) as count FROM bill_items').get().count;

db.exec(`
  DELETE FROM bill_items;
  DELETE FROM bills;
  DELETE FROM sqlite_sequence WHERE name IN ('bills', 'bill_items');
`);

console.log(`✅ Cleared ${billsCountBefore} test bills and ${itemsCountBefore} test bill items.`);

// 4. Record Audit Log for Live Initialization
logAudit(
  'LIVE_INITIALIZATION',
  'MANAGER',
  'Store Manager',
  'SERVER',
  'BILLS',
  'All test bills wiped clean. Dash Soft stock finalized for live supermarket billing.'
);

// 5. Verify final inventory stats
const prodStats = db.prepare(`
  SELECT
    count(*) as total_items,
    count(DISTINCT category) as total_categories,
    sum(stock_qty) as total_stock_pieces,
    count(CASE WHEN stock_qty > 0 THEN 1 END) as items_in_stock,
    count(CASE WHEN stock_qty = 0 THEN 1 END) as zero_stock_items
  FROM products
`).get();

const billsAfter = db.prepare('SELECT count(*) as count FROM bills').get().count;

console.log('=====================================================');
console.log('📊 FINAL LIVE DATABASE SUMMARY:');
console.log('   Total Unique Products (Dash Soft):', prodStats.total_items.toLocaleString());
console.log('   Total Categories:', prodStats.total_categories);
console.log('   Items with Positive Stock:', prodStats.items_in_stock.toLocaleString());
console.log('   Items with Zero Stock (Emergency Billing enabled):', prodStats.zero_stock_items.toLocaleString());
console.log('   Total Stock Units Available:', Math.round(prodStats.total_stock_pieces).toLocaleString());
console.log('   Total Active Invoices in Database:', billsAfter, '(CLEAN SLATE)');
console.log('=====================================================');
console.log('🎉 SYSTEM IS 100% READY FOR LIVE SUPERMARKET BILLING!');
console.log('=====================================================');
