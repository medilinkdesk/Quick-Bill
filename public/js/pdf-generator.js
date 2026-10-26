/**
 * QuickBill - Pure JavaScript Professional PDF Invoice Generator
 * Universally compatible: Works in Node.js and any Web Browser (Zero dependencies)
 * DAFTARI MEGA MART (Kishanganj)
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PDFInvoice = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Helper: Number to Indian Rupees in words
  function numberToWords(num) {
    num = Math.round(Number(num) || 0);
    if (num === 0) return 'Zero Rupees Only';
    if (num < 0) return 'Minus ' + numberToWords(Math.abs(num));

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function convertGroup(n) {
      let str = '';
      if (n >= 100) {
        str += ones[Math.floor(n / 100)] + ' Hundred ';
        n %= 100;
      }
      if (n >= 20) {
        str += tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '') + ' ';
      } else if (n > 0) {
        str += ones[n] + ' ';
      }
      return str;
    }

    let words = '';
    const crore = Math.floor(num / 10000000);
    num %= 10000000;
    const lakh = Math.floor(num / 100000);
    num %= 100000;
    const thousand = Math.floor(num / 1000);
    num %= 1000;
    const hundredGroup = num;

    if (crore > 0) words += convertGroup(crore) + 'Crore ';
    if (lakh > 0) words += convertGroup(lakh) + 'Lakh ';
    if (thousand > 0) words += convertGroup(thousand) + 'Thousand ';
    if (hundredGroup > 0) words += convertGroup(hundredGroup);

    return words.trim() + ' Rupees Only';
  }

  // Clean and escape string for PDF syntax
  function cleanText(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/[^\x20-\x7E]/g, ' ') // restrict to printable ASCII for Helvetica
      .trim();
  }

  // Build Low-Level PDF Document
  function createPDF() {
    const objects = [];
    const pages = [];

    // Obj 1: Catalog (placeholder, will be finalized)
    // Obj 2: Pages (placeholder)
    // Fonts: F1 (Helvetica), F2 (Helvetica-Bold), F3 (Helvetica-Oblique)

    return {
      pages,
      addPage(width, height) {
        const page = {
          width: width || 595.28,  // A4 standard width (pt)
          height: height || 841.89, // A4 standard height (pt)
          stream: []
        };
        pages.push(page);
        return page;
      },
      compile() {
        let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
        const xrefOffsets = ['0000000000 65535 f '];
        let currentOffset = pdf.length;

        // Reserve obj indices
        // Obj 1: Catalog
        // Obj 2: Pages collection
        // Obj 3: Font F1 (Helvetica)
        // Obj 4: Font F2 (Helvetica-Bold)
        // Obj 5: Font F3 (Helvetica-Oblique)
        // Then for each page: PageObj, ContentsObj

        const fontObjStart = 3;
        const fontF1Obj = fontObjStart;
        const fontF2Obj = fontObjStart + 1;
        const fontF3Obj = fontObjStart + 2;

        let nextObjId = fontObjStart + 3;
        const pageObjIds = [];
        const contentObjIds = [];

        for (let i = 0; i < pages.length; i++) {
          pageObjIds.push(nextObjId++);
          contentObjIds.push(nextObjId++);
        }

        const allObjects = {};

        // 1. Catalog
        allObjects[1] = '<< /Type /Catalog /Pages 2 0 R >>';

        // 2. Pages
        const kidsStr = pageObjIds.map(id => `${id} 0 R`).join(' ');
        allObjects[2] = `<< /Type /Pages /Kids [${kidsStr}] /Count ${pages.length} >>`;

        // 3. Fonts
        allObjects[fontF1Obj] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        allObjects[fontF2Obj] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
        allObjects[fontF3Obj] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>';

        // 4. Pages & Content Streams
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i];
          const pageId = pageObjIds[i];
          const contentId = contentObjIds[i];
          const streamData = p.stream.join('\n');

          allObjects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width.toFixed(2)} ${p.height.toFixed(2)}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontF1Obj} 0 R /F2 ${fontF2Obj} 0 R /F3 ${fontF3Obj} 0 R >> /ProcSet [/PDF /Text] >> >>`;
          allObjects[contentId] = `<< /Length ${streamData.length} >>\nstream\n${streamData}\nendstream`;
        }

        const totalObjects = nextObjId - 1;

        // Write objects sequentially and record offsets
        for (let id = 1; id <= totalObjects; id++) {
          const body = allObjects[id];
          xrefOffsets[id] = String(currentOffset).padStart(10, '0') + ' 00000 n ';
          const chunk = `${id} 0 obj\n${body}\nendobj\n`;
          pdf += chunk;
          currentOffset += chunk.length;
        }

        // XRef & Trailer
        const xrefStart = currentOffset;
        pdf += `xref\n0 ${totalObjects + 1}\n`;
        pdf += xrefOffsets.join('\n') + '\n';
        pdf += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\n`;
        pdf += `startxref\n${xrefStart}\n%%EOF`;

        return pdf;
      }
    };
  }

  // Draw Helpers
  function setFillColor(stream, r, g, b) {
    stream.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
  }

  function setStrokeColor(stream, r, g, b) {
    stream.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`);
  }

  function drawRect(stream, x, y, w, h, fill = false, stroke = true, lineWidth = 0.5) {
    stream.push(`${lineWidth.toFixed(2)} w`);
    stream.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    if (fill && stroke) stream.push('B');
    else if (fill) stream.push('f');
    else if (stroke) stream.push('S');
  }

  function drawLine(stream, x1, y1, x2, y2, lineWidth = 0.5) {
    stream.push(`${lineWidth.toFixed(2)} w`);
    stream.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  function drawText(stream, text, x, y, font = 'F1', size = 10, align = 'left', maxWidth = 0) {
    const cleaned = cleanText(text);
    if (!cleaned) return;

    // Approximate width for alignment: average char width ~ 0.52 * size for Helvetica
    let approxWidth = cleaned.length * (size * 0.52);
    let drawX = x;
    if (align === 'right') {
      drawX = x - approxWidth;
    } else if (align === 'center') {
      drawX = x - (approxWidth / 2);
    }

    stream.push(`BT /${font} ${size.toFixed(2)} Tf ${drawX.toFixed(2)} ${y.toFixed(2)} Td (${cleaned}) Tj ET`);
  }

  // Generate Complete Tax Invoice PDF
  function generateInvoicePDF(bill, items, settings = {}) {
    const storeName = settings.store_name || 'DAFTARI MEGA MART';
    const storeTagline = settings.store_tagline || 'Complete Family Supermarket';
    const storeAddress = settings.store_address || 'Neemchand Road, Kishanganj - 855107';
    const storePhone = settings.store_phone || '+91 79706 05281';
    const storeGstin = settings.store_gstin || '10AAHCD2963P1ZG';
    const footerText = settings.receipt_footer || 'Thank You for shopping with us! Visit Again.';

    const billNo = bill.bill_no || 'OFFLINE-BILL';
    const billDate = new Date(bill.created_at || Date.now()).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    const cashierName = bill.cashier_name || bill.cashier_id || 'Cashier';
    const paymentMode = (bill.payment_mode || 'CASH').toUpperCase();
    const customerPhone = bill.customer_phone || 'Cash Customer';
    const deviceId = bill.device_id || 'POS-Counter-1';

    const itemList = items || bill.items || [];
    const pdfDoc = createPDF();

    // Pagination constants
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const leftMargin = 36;
    const rightMargin = 559.28;
    const contentWidth = rightMargin - leftMargin;

    const itemsPerPageFirst = 16;
    const itemsPerPageNext = 24;

    let currentIndex = 0;
    let pageNumber = 1;
    const totalPages = Math.max(1, Math.ceil(itemList.length <= itemsPerPageFirst ? 1 : 1 + ((itemList.length - itemsPerPageFirst) / itemsPerPageNext)));

    while (currentIndex < itemList.length || pageNumber === 1) {
      const page = pdfDoc.addPage(pageWidth, pageHeight);
      const s = page.stream;
      const isFirstPage = (pageNumber === 1);
      const isLastPage = (pageNumber === totalPages || currentIndex >= itemList.length);

      // Outer border
      setStrokeColor(s, 0.75, 0.8, 0.85);
      drawRect(s, leftMargin, 30, contentWidth, pageHeight - 60, false, true, 0.75);

      let curY = pageHeight - 45;

      if (isFirstPage) {
        // --- TOP BRAND HEADER BAR ---
        setFillColor(s, 0.08, 0.16, 0.28); // Deep Navy
        drawRect(s, leftMargin, curY - 55, contentWidth, 55, true, false);

        setFillColor(s, 1, 1, 1);
        drawText(s, storeName.toUpperCase(), leftMargin + (contentWidth / 2), curY - 20, 'F2', 17, 'center');
        setFillColor(s, 0.8, 0.9, 0.98);
        drawText(s, storeTagline, leftMargin + (contentWidth / 2), curY - 34, 'F3', 8.5, 'center');
        drawText(s, `${storeAddress} | Phone: ${storePhone} | GSTIN: ${storeGstin}`, leftMargin + (contentWidth / 2), curY - 47, 'F1', 7.5, 'center');

        curY -= 65;

        // --- INVOICE TITLE STRIP ---
        setFillColor(s, 0.94, 0.96, 0.98);
        setStrokeColor(s, 0.8, 0.85, 0.9);
        drawRect(s, leftMargin, curY - 18, contentWidth, 18, true, true, 0.5);
        setFillColor(s, 0.08, 0.16, 0.28);
        drawText(s, 'RETAIL TAX INVOICE / CASH MEMO', leftMargin + (contentWidth / 2), curY - 13, 'F2', 10, 'center');

        curY -= 24;

        // --- METADATA BOX (2 Columns) ---
        setStrokeColor(s, 0.82, 0.85, 0.88);
        drawRect(s, leftMargin, curY - 48, contentWidth, 48, false, true, 0.5);

        // Column 1
        setFillColor(s, 0.35, 0.4, 0.45);
        drawText(s, 'Invoice No:', leftMargin + 10, curY - 14, 'F2', 8.5);
        setFillColor(s, 0.05, 0.1, 0.2);
        drawText(s, billNo, leftMargin + 70, curY - 14, 'F2', 9);

        setFillColor(s, 0.35, 0.4, 0.45);
        drawText(s, 'Date & Time:', leftMargin + 10, curY - 28, 'F1', 8.5);
        setFillColor(s, 0.05, 0.1, 0.2);
        drawText(s, billDate, leftMargin + 70, curY - 28, 'F1', 8.5);

        setFillColor(s, 0.35, 0.4, 0.45);
        drawText(s, 'Cashier:', leftMargin + 10, curY - 42, 'F1', 8.5);
        setFillColor(s, 0.05, 0.1, 0.2);
        drawText(s, cashierName, leftMargin + 70, curY - 42, 'F1', 8.5);

        // Mid divider
        drawLine(s, leftMargin + 265, curY, leftMargin + 265, curY - 48, 0.5);

        // Column 2
        setFillColor(s, 0.35, 0.4, 0.45);
        drawText(s, 'Payment Mode:', leftMargin + 275, curY - 14, 'F2', 8.5);
        setFillColor(s, paymentMode === 'CASH' ? 0.06 : 0.15, 0.45, 0.25);
        drawText(s, paymentMode, leftMargin + 355, curY - 14, 'F2', 9);

        setFillColor(s, 0.35, 0.4, 0.45);
        drawText(s, 'Customer:', leftMargin + 275, curY - 28, 'F1', 8.5);
        setFillColor(s, 0.05, 0.1, 0.2);
        drawText(s, customerPhone, leftMargin + 355, curY - 28, 'F1', 8.5);

        setFillColor(s, 0.35, 0.4, 0.45);
        drawText(s, 'Counter / POS:', leftMargin + 275, curY - 42, 'F1', 8.5);
        setFillColor(s, 0.05, 0.1, 0.2);
        drawText(s, deviceId, leftMargin + 355, curY - 42, 'F1', 8.5);

        curY -= 56;
      } else {
        // Page 2+ header
        setFillColor(s, 0.08, 0.16, 0.28);
        drawText(s, `${storeName} - Invoice ${billNo} (Continued)`, leftMargin + 10, curY - 15, 'F2', 10);
        curY -= 25;
      }

      // --- TABLE HEADER ---
      setFillColor(s, 0.15, 0.22, 0.33); // Navy Table Header
      drawRect(s, leftMargin, curY - 18, contentWidth, 18, true, false);

      setFillColor(s, 1, 1, 1);
      drawText(s, '#', leftMargin + 12, curY - 13, 'F2', 8, 'center');
      drawText(s, 'ITEM DESCRIPTION', leftMargin + 35, curY - 13, 'F2', 8);
      drawText(s, 'CODE', leftMargin + 270, curY - 13, 'F2', 8);
      drawText(s, 'QTY', leftMargin + 355, curY - 13, 'F2', 8, 'center');
      drawText(s, 'RATE (Rs.)', leftMargin + 420, curY - 13, 'F2', 8, 'right');
      drawText(s, 'DISC', leftMargin + 460, curY - 13, 'F2', 8, 'right');
      drawText(s, 'TOTAL (Rs.)', rightMargin - 10, curY - 13, 'F2', 8, 'right');

      curY -= 20;

      // Table Rows
      const limit = isFirstPage ? itemsPerPageFirst : itemsPerPageNext;
      const pageItems = itemList.slice(currentIndex, currentIndex + limit);

      const rowHeight = 16;
      for (let i = 0; i < pageItems.length; i++) {
        const item = pageItems[i];
        const itemIdx = currentIndex + i + 1;

        // Zebra striping
        if (i % 2 === 1) {
          setFillColor(s, 0.97, 0.98, 0.99);
          drawRect(s, leftMargin, curY - rowHeight + 4, contentWidth, rowHeight, true, false);
        }

        const name = (item.item_name || item.name || 'Item').slice(0, 42);
        const code = (item.item_code || item.barcode || '').slice(0, 14);
        const qty = `${item.qty} ${item.unit || 'Pcs'}`;
        const price = Number(item.price || 0).toFixed(2);
        const disc = Number(item.discount || 0) > 0 ? `-${Number(item.discount).toFixed(2)}` : '0.00';
        const total = Number(item.total || (item.qty * item.price)).toFixed(2);

        setFillColor(s, 0.4, 0.45, 0.5);
        drawText(s, String(itemIdx), leftMargin + 12, curY - 8, 'F1', 7.5, 'center');

        setFillColor(s, 0.08, 0.12, 0.18);
        drawText(s, name, leftMargin + 35, curY - 8, 'F2', 8);

        setFillColor(s, 0.35, 0.4, 0.45);
        drawText(s, code, leftMargin + 270, curY - 8, 'F1', 7.5);

        setFillColor(s, 0.08, 0.12, 0.18);
        drawText(s, qty, leftMargin + 355, curY - 8, 'F1', 7.5, 'center');
        drawText(s, price, leftMargin + 420, curY - 8, 'F1', 8, 'right');

        setFillColor(s, 0.45, 0.5, 0.55);
        drawText(s, disc, leftMargin + 460, curY - 8, 'F1', 7.5, 'right');

        setFillColor(s, 0.05, 0.1, 0.2);
        drawText(s, total, rightMargin - 10, curY - 8, 'F2', 8, 'right');

        // Light row divider
        setStrokeColor(s, 0.9, 0.92, 0.94);
        drawLine(s, leftMargin, curY - rowHeight + 4, rightMargin, curY - rowHeight + 4, 0.4);

        curY -= rowHeight;
      }

      currentIndex += pageItems.length;

      // --- TOTALS & SUMMARY SECTION (Only on last page) ---
      if (isLastPage) {
        curY -= 8;

        const subtotal = Number(bill.subtotal || bill.grand_total || 0).toFixed(2);
        const discount = Number(bill.discount || 0).toFixed(2);
        const tax = Number(bill.tax_amount || 0).toFixed(2);
        const grandTotal = Number(bill.grand_total || 0).toFixed(2);

        // Left box: Summary & Words
        const leftBoxWidth = 260;
        setStrokeColor(s, 0.85, 0.88, 0.9);
        drawRect(s, leftMargin + 10, curY - 82, leftBoxWidth, 82, false, true, 0.5);

        setFillColor(s, 0.2, 0.25, 0.3);
        drawText(s, `Total Items: ${itemList.length}  |  Total Pcs: ${itemList.reduce((sum, it) => sum + (Number(it.qty) || 1), 0)}`, leftMargin + 20, curY - 16, 'F2', 8.5);

        setFillColor(s, 0.4, 0.45, 0.5);
        drawText(s, 'Amount in Words:', leftMargin + 20, curY - 32, 'F1', 7.5);
        setFillColor(s, 0.05, 0.15, 0.25);
        const words = numberToWords(bill.grand_total);
        drawText(s, words.slice(0, 48), leftMargin + 20, curY - 45, 'F2', 8);
        if (words.length > 48) {
          drawText(s, words.slice(48, 96), leftMargin + 20, curY - 56, 'F2', 8);
        }

        setFillColor(s, 0.5, 0.55, 0.6);
        drawText(s, '* Computer Generated Tax Invoice. No signature required.', leftMargin + 20, curY - 73, 'F3', 6.5);

        // Right box: Financial Totals
        const rightBoxX = leftMargin + 285;
        const rightBoxWidth = contentWidth - 295;

        setStrokeColor(s, 0.85, 0.88, 0.9);
        drawRect(s, rightBoxX, curY - 82, rightBoxWidth, 82, false, true, 0.5);

        let totY = curY - 14;
        setFillColor(s, 0.35, 0.4, 0.45);
        drawText(s, 'Subtotal:', rightBoxX + 10, totY, 'F1', 8.5);
        setFillColor(s, 0.05, 0.1, 0.2);
        drawText(s, `Rs. ${subtotal}`, rightMargin - 15, totY, 'F1', 8.5, 'right');

        if (Number(discount) > 0) {
          totY -= 13;
          setFillColor(s, 0.85, 0.2, 0.2);
          drawText(s, 'Discount:', rightBoxX + 10, totY, 'F1', 8.5);
          drawText(s, `-Rs. ${discount}`, rightMargin - 15, totY, 'F1', 8.5, 'right');
        }

        if (Number(tax) > 0) {
          totY -= 13;
          setFillColor(s, 0.35, 0.4, 0.45);
          drawText(s, 'GST / Taxes Included:', rightBoxX + 10, totY, 'F1', 8.5);
          setFillColor(s, 0.05, 0.1, 0.2);
          drawText(s, `Rs. ${tax}`, rightMargin - 15, totY, 'F1', 8.5, 'right');
        }

        // Grand Total Banner Box
        totY -= 22;
        setFillColor(s, 0.06, 0.45, 0.32); // Emerald Green
        drawRect(s, rightBoxX + 5, totY - 4, rightBoxWidth - 10, 20, true, false);

        setFillColor(s, 1, 1, 1);
        drawText(s, 'NET PAYABLE:', rightBoxX + 15, totY + 2, 'F2', 10);
        drawText(s, `Rs. ${grandTotal}`, rightMargin - 20, totY + 2, 'F2', 11, 'right');

        // Cash tendered & change
        if (paymentMode === 'CASH' && bill.cash_tendered) {
          totY -= 14;
          setFillColor(s, 0.4, 0.45, 0.5);
          drawText(s, `Tendered: Rs. ${Number(bill.cash_tendered).toFixed(2)}  |  Change: Rs. ${Number(bill.change_returned || 0).toFixed(2)}`, rightBoxX + 10, totY + 2, 'F1', 7.5);
        }

        curY -= 92;
      }

      // --- PAGE FOOTER ---
      const footY = 45;
      setStrokeColor(s, 0.85, 0.88, 0.9);
      drawLine(s, leftMargin + 10, footY + 12, rightMargin - 10, footY + 12, 0.5);

      setFillColor(s, 0.35, 0.4, 0.45);
      drawText(s, footerText, leftMargin + (contentWidth / 2), footY + 2, 'F2', 8, 'center');

      setFillColor(s, 0.6, 0.65, 0.7);
      drawText(s, `QuickBill Emergency POS  |  Page ${pageNumber} of ${totalPages}`, rightMargin - 15, footY - 8, 'F1', 7, 'right');
      drawText(s, 'Goods once sold can be exchanged within 7 days with original invoice.', leftMargin + 15, footY - 8, 'F3', 6.5);

      pageNumber++;
    }

    return pdfDoc.compile();
  }

  // Frontend Browser Helpers
  const BrowserAPI = {
    // Generate raw PDF string
    generate(bill, items, settings) {
      return generateInvoicePDF(bill, items, settings);
    },

    // Convert PDF string to Uint8Array/Blob
    getBlob(bill, items, settings) {
      const pdfString = generateInvoicePDF(bill, items, settings);
      const len = pdfString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = pdfString.charCodeAt(i) & 0xff;
      }
      return new Blob([bytes], { type: 'application/pdf' });
    },

    // Trigger instant browser download
    downloadPDF(bill, items, settings) {
      const blob = this.getBlob(bill, items, settings);
      const filename = `DAFTARI_MEGA_MART_Invoice_${bill.bill_no || 'BILL'}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
      return filename;
    },

    // Open PDF in new browser tab
    viewPDF(bill, items, settings) {
      const blob = this.getBlob(bill, items, settings);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    },

    // Share PDF to WhatsApp or Native System Share Sheet
    async shareWhatsAppPDF(bill, items, settings) {
      const blob = this.getBlob(bill, items, settings);
      const filename = `DAFTARI_MEGA_MART_Invoice_${bill.bill_no || 'BILL'}.pdf`;
      const storeName = settings.store_name || 'DAFTARI MEGA MART';
      const shareTitle = `${storeName} - Tax Invoice #${bill.bill_no}`;
      const shareText = `Tax Invoice from ${storeName} for Bill #${bill.bill_no} (Grand Total: Rs. ${Number(bill.grand_total).toFixed(2)})`;

      // 1. Check if Mobile Browser supports Web Share API with Files (Android Chrome, iPhone Safari)
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            files: [file]
          });
          return { success: true, method: 'web_share_api' };
        } catch (err) {
          if (err.name === 'AbortError') {
            return { success: false, aborted: true };
          }
          console.warn('Native share failed, falling back:', err);
        }
      }

      // 2. Fallback for Desktop or browsers without file share:
      // Download PDF automatically so customer/cashier has the file
      this.downloadPDF(bill, items, settings);

      let phone = bill.customer_phone;
      if (!phone || !phone.trim() || phone === 'Cash Customer') {
        const inputPhone = prompt('Enter 10-digit customer mobile number for WhatsApp:');
        if (inputPhone && inputPhone.trim()) {
          phone = inputPhone.trim();
          bill.customer_phone = phone;
        }
      }

      if (phone && phone.trim()) {
        const cleanPhone = phone.replace(/\D/g, '');
        const fullPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
        const waMsg = `🧾 *${storeName} - TAX INVOICE*\n` +
          `*Bill No:* ${bill.bill_no}\n` +
          `*Amount:* Rs. ${Number(bill.grand_total).toFixed(2)}\n\n` +
          `📎 *PDF Invoice has been downloaded to your device.* Please find the attached PDF invoice document.`;
        const waUrl = `https://wa.me/${fullPhone}?text=${encodeURIComponent(waMsg)}`;
        window.open(waUrl, '_blank');
      }

      return { success: true, method: 'download_and_whatsapp' };
    }
  };

  return {
    generateInvoicePDF,
    numberToWords,
    cleanText,
    ...BrowserAPI
  };
});
