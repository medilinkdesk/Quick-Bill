/**
 * QuickBill - Receipt Rendering & Thermal Printing Helper
 */

const ReceiptPrinter = {
  renderHTML(bill, items, settings = {}, isOffline = false) {
    const storeName = settings.store_name || 'QUICK SUPERMARKET';
    const storeTagline = settings.store_tagline || 'Emergency POS & Express Billing';
    const storeAddress = settings.store_address || 'Main Market, City Center';
    const storePhone = settings.store_phone || '+91 98765 43210';
    const storeGstin = settings.store_gstin || '';
    const footer = settings.receipt_footer || 'Thank You! Please Visit Again.';
    const currency = settings.currency_symbol || '₹';

    const billDate = new Date(bill.created_at || Date.now()).toLocaleString('en-IN', {
      dateStyle: 'short',
      timeStyle: 'medium'
    });

    const statusBadge = isOffline || (bill.sync_status === 'PENDING_SYNC')
      ? `<div class="offline-badge-receipt">⚠️ EMERGENCY OFFLINE BILL (PENDING SYNC)</div>`
      : `<div class="online-badge-receipt">✅ SERVER RECORDED</div>`;

    let itemRows = '';
    (items || bill.items || []).forEach((item, idx) => {
      const name = item.item_name || item.name || 'Item';
      const qty = item.qty || 1;
      const price = Number(item.price || 0).toFixed(2);
      const total = Number(item.total || (qty * price)).toFixed(2);

      itemRows += `
        <tr>
          <td class="col-item">${idx + 1}. ${name}</td>
          <td class="col-qty text-center">${qty}</td>
          <td class="col-price text-right">${price}</td>
          <td class="col-total text-right">${total}</td>
        </tr>
      `;
    });

    return `
      <div class="thermal-receipt">
        <div class="receipt-header text-center">
          <div class="store-name">${storeName}</div>
          <div class="store-tagline">${storeTagline}</div>
          <div class="store-details">${storeAddress}</div>
          <div class="store-details">Phone: ${storePhone}</div>
          ${storeGstin ? `<div class="store-details">GSTIN: ${storeGstin}</div>` : ''}
          ${statusBadge}
        </div>

        <div class="receipt-divider">================================</div>

        <div class="receipt-meta">
          <div><strong>Bill No:</strong> ${bill.bill_no || 'OFFLINE'}</div>
          <div><strong>Date:</strong> ${billDate}</div>
          <div><strong>Cashier:</strong> ${bill.cashier_name || bill.cashier_id || 'Cashier'}</div>
          <div><strong>Device:</strong> ${bill.device_id || 'N/A'}</div>
          ${bill.customer_phone ? `<div><strong>Customer:</strong> ${bill.customer_phone}</div>` : ''}
        </div>

        <div class="receipt-divider">--------------------------------</div>

        <table class="receipt-table">
          <thead>
            <tr>
              <th class="col-item">Item</th>
              <th class="col-qty text-center">Qty</th>
              <th class="col-price text-right">Rate</th>
              <th class="col-total text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>

        <div class="receipt-divider">--------------------------------</div>

        <div class="receipt-totals">
          <div class="total-row">
            <span>Subtotal:</span>
            <span>${currency}${Number(bill.subtotal || bill.grand_total).toFixed(2)}</span>
          </div>
          ${Number(bill.discount || 0) > 0 ? `
            <div class="total-row discount-text">
              <span>Discount:</span>
              <span>-${currency}${Number(bill.discount).toFixed(2)}</span>
            </div>
          ` : ''}
          ${Number(bill.tax_amount || 0) > 0 ? `
            <div class="total-row">
              <span>GST/Tax:</span>
              <span>${currency}${Number(bill.tax_amount).toFixed(2)}</span>
            </div>
          ` : ''}
          <div class="total-row grand-total-row">
            <span>NET TOTAL:</span>
            <span>${currency}${Number(bill.grand_total).toFixed(2)}</span>
          </div>
          <div class="total-row payment-info">
            <span>Payment Mode:</span>
            <span>${bill.payment_mode || 'CASH'}</span>
          </div>
          ${bill.payment_mode === 'CASH' && bill.cash_tendered ? `
            <div class="total-row">
              <span>Cash Tendered:</span>
              <span>${currency}${Number(bill.cash_tendered).toFixed(2)}</span>
            </div>
            <div class="total-row">
              <span>Change Returned:</span>
              <span>${currency}${Number(bill.change_returned || 0).toFixed(2)}</span>
            </div>
          ` : ''}
        </div>

        <div class="receipt-divider">================================</div>

        <div class="receipt-footer text-center">
          <div>${footer}</div>
          <div class="tech-note">QuickBill Emergency POS v1.0</div>
        </div>
      </div>
    `;
  },

  print(bill, items, settings = {}, isOffline = false) {
    const html = this.renderHTML(bill, items, settings, isOffline);
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) {
      alert('Please allow popups to print receipt');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt - ${bill.bill_no}</title>
        <style>
          @page {
            margin: 0;
            size: 80mm auto;
          }
          body {
            font-family: 'Courier New', Courier, monospace, monospace;
            font-size: 12px;
            color: #000;
            background: #fff;
            margin: 0;
            padding: 10px;
            width: 72mm;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .store-name { font-size: 16px; font-weight: bold; margin-bottom: 2px; }
          .store-tagline { font-size: 11px; margin-bottom: 4px; }
          .store-details { font-size: 10px; }
          .receipt-divider { margin: 6px 0; font-size: 10px; overflow: hidden; }
          .receipt-meta { font-size: 11px; line-height: 1.4; margin-bottom: 4px; }
          .receipt-table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 4px 0; }
          .receipt-table th { border-bottom: 1px dashed #000; padding: 4px 2px; font-size: 11px; }
          .receipt-table td { padding: 4px 2px; vertical-align: top; }
          .col-item { width: 45%; text-align: left; }
          .col-qty { width: 15%; }
          .col-price { width: 20%; }
          .col-total { width: 20%; }
          .receipt-totals { font-size: 11px; line-height: 1.5; margin: 4px 0; }
          .total-row { display: flex; justify-content: space-between; }
          .grand-total-row { font-size: 14px; font-weight: bold; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; margin: 4px 0; }
          .discount-text { color: #333; }
          .offline-badge-receipt { font-weight: bold; margin: 6px 0; border: 1px solid #000; padding: 3px; font-size: 10px; }
          .online-badge-receipt { font-size: 10px; margin: 4px 0; }
          .receipt-footer { font-size: 10px; margin-top: 8px; line-height: 1.4; }
          .tech-note { font-size: 8px; color: #555; margin-top: 4px; }
        </style>
      </head>
      <body>
        ${html}
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 500);
          };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  },

  generateWhatsAppText(bill, items, settings = {}) {
    const storeName = settings.store_name || 'DAFTARI MEGA MART';
    const storeAddress = settings.store_address || 'Neemchand Road, Kishanganj';
    const storePhone = settings.store_phone || '+91 79706 05281';
    const storeGstin = settings.store_gstin || '';
    const footer = settings.receipt_footer || 'Thank You for shopping with us! Visit Again.';
    const currency = settings.currency_symbol || '₹';

    const billDate = new Date(bill.created_at || Date.now()).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    let text = `🧾 *${storeName.toUpperCase()}*\n`;
    if (storeAddress) text += `📍 ${storeAddress}\n`;
    if (storePhone) text += `📞 ${storePhone}`;
    if (storeGstin) text += ` | GSTIN: ${storeGstin}`;
    text += `\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `*TAX INVOICE / CASH MEMO*\n`;
    text += `*Bill No:* ${bill.bill_no || 'OFFLINE'}\n`;
    text += `*Date & Time:* ${billDate}\n`;
    text += `*Cashier:* ${bill.cashier_name || bill.cashier_id || 'Cashier'}\n`;
    if (bill.customer_phone) {
      text += `*Customer Mobile:* ${bill.customer_phone}\n`;
    }
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `*ITEMS PURCHASED:*\n\n`;

    const itemList = items || bill.items || [];
    itemList.forEach((item, idx) => {
      const name = item.item_name || item.name || 'Item';
      const qty = item.qty || 1;
      const unit = item.unit || 'Pcs';
      const price = Number(item.price || 0).toFixed(2);
      const total = Number(item.total || (qty * price)).toFixed(2);

      text += `${idx + 1}. *${name}*\n`;
      text += `   ${qty} ${unit} × ${currency}${price} = *${currency}${total}*\n`;
      if (item.discount && Number(item.discount) > 0) {
        text += `   _(Discount: -${currency}${Number(item.discount).toFixed(2)})_\n`;
      }
      text += `\n`;
    });

    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `*Total Items:* ${itemList.length}\n`;
    text += `Subtotal: ${currency}${Number(bill.subtotal || bill.grand_total).toFixed(2)}\n`;

    if (Number(bill.discount || 0) > 0) {
      text += `Discount: -${currency}${Number(bill.discount).toFixed(2)}\n`;
    }
    if (Number(bill.tax_amount || 0) > 0) {
      text += `GST/Tax: ${currency}${Number(bill.tax_amount).toFixed(2)}\n`;
    }

    text += `*GRAND TOTAL: ${currency}${Number(bill.grand_total).toFixed(2)}*\n`;
    text += `*Payment Mode:* ${bill.payment_mode || 'CASH'}\n`;

    if (bill.payment_mode === 'CASH' && bill.cash_tendered) {
      text += `Cash Tendered: ${currency}${Number(bill.cash_tendered).toFixed(2)}\n`;
      if (Number(bill.change_returned || 0) > 0) {
        text += `Change Returned: ${currency}${Number(bill.change_returned).toFixed(2)}\n`;
      }
    }

    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `_${footer}_\n`;
    text += `_Powered by QuickBill Emergency POS_ 🙏`;

    return text;
  },

  shareWhatsApp(bill, items, settings = {}) {
    if (typeof window !== 'undefined' && window.PDFInvoice && window.PDFInvoice.shareWhatsAppPDF) {
      return window.PDFInvoice.shareWhatsAppPDF(bill, items, settings);
    }

    let phone = bill.customer_phone;
    if (!phone || !phone.trim()) {
      const inputPhone = prompt('Enter 10-digit customer mobile number for WhatsApp invoice:');
      if (!inputPhone || !inputPhone.trim()) return;
      phone = inputPhone.trim();
      bill.customer_phone = phone;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const fullPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const msg = this.generateWhatsAppText(bill, items, settings);
    const url = `https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  }
};

if (typeof window !== 'undefined') {
  window.ReceiptPrinter = ReceiptPrinter;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ReceiptPrinter };
}
