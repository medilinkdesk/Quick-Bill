# ⚡ QuickBill - High-Speed Emergency POS & Central Monitoring System
**DAFTARI MEGA MART (Kishanganj) - बिजली जाने पर बिना इंटरनेट सुपरमार्केट में मोबाइल व लैपटॉप से इमरजेंसी बिलिंग का संपूर्ण सिस्टम**

---

## 📂 फ़ोल्डर संरचना (Clean Project Architecture)

```text
Quick Bill/
├── server.js                     # Express 5 Central Backend API Server
├── db.js                         # SQLite 3 Database Layer & Queries
├── package.json                  # Dependencies & NPM Scripts
├── package-lock.json             # NPM Lockfile
├── start-server.bat              # 1-Click Windows Server Launcher
├── .gitignore                    # Git Ignore (Excludes node_modules, temp files, db)
├── .gitattributes                # Git Line Ending Configurations
├── README.md                     # Documentation & Setup Guide
│
├── public/                       # Frontend Web Application (Mobile PWA & Desktop)
│   ├── index.html                # Cashier POS Billing Screen (Autofit Mobile UI)
│   ├── manager.html              # Central Manager Dashboard Screen
│   ├── manifest.json             # PWA Web App Manifest
│   ├── sw.js                     # Service Worker for Offline Caching
│   ├── css/
│   │   └── style.css             # Unified Mobile Autofit & Desktop Stylesheet
│   ├── js/
│   │   ├── pos.js                # Cashier POS Billing Logic & Sound FX
│   │   ├── manager.js            # Manager Dashboard Analytics & Reconciliation
│   │   ├── pdf-generator.js      # Pure JS Professional PDF Invoice Engine
│   │   ├── print.js              # Thermal Print & WhatsApp Sharing Helpers
│   │   ├── db-sync.js            # IndexedDB Offline Sync & Heartbeat Engine
│   │   └── html5-qrcode.min.js   # Barcode & Camera Scanner Library
│   └── icons/
│       └── icon.svg              # POS Web App Icon
│
├── scripts/                      # Utility & Maintenance Scripts
│   ├── import_daftari_stock.js   # Imports 5.2 Lakh products from Dash Soft CSV
│   └── finalize_dashsoft_live.js # Clears test bills & finalizes live catalog
│
├── sample_data/                  # Demo templates for testing & imports
│   ├── sample_inventory.csv
│   ├── sample_inventory.json
│   └── sample_inventory.xlsx
│
└── uploads/                      # Temporary Multer Upload Directory (.gitkeep)
```

---

## 🌟 सिस्टम की मुख्य विशेषताएं (Key Features)

1. **लोकल सर्वर + वाई-फाई (बिना इंटरनेट काम करता है):**
   - दुकान के एक सामान्य लैपटॉप या पीसी पर सर्वर चलता है।
   - सभी कैशियर अपने मोबाइल को दुकान के वाई-फाई राउटर से जोड़ते हैं।
   - **इंटरनेट बंद होने पर भी बिलिंग और सेंट्रल डेटाबेस में रिकॉर्डिंग 100% चालू रहती है।**

2. **मोबाइल ऑटो-फिट (100% Mobile Responsive):**
   - मोबाइल पर ऐप (Swiggy/Square POS) की तरह स्क्रीन में ऑटो-फिट होता है।
   - हर आइटम टच-कार्ड में दिखता है जिसमें बड़े `[ − ] 2 [ + ]` बटन और बड़ा डिलीट बटन होता है।
   - नीचे फिक्स `⚡ PAY / BILL →` बार रहता है जिसे दबाते ही नीचे से पेमेंट बॉटम शीट स्लाइड होकर खुलती है।

3. **📄 असली PDF इनवॉइस (WhatsApp पर PDF शेयरिंग):**
   - बिल पूरा होते ही ग्राहक को टेक्स्ट नहीं, बल्कि सुंदर **Tax Invoice PDF** फाइल भेजी जा सकती है।
   - 1-क्लिक में **"📲 Share PDF Invoice on WhatsApp"**, **"📄 Download PDF"** और **"🖨️ Thermal Print"** की सुविधा।

4. **शून्य स्टॉक बिलिंग व ट्रैकिंग (Zero-Stock Billing with Memory):**
   - यदि किसी उत्पाद का स्टॉक 0 है, तो भी कैशियर का बिल **अटकेगा नहीं**।
   - सिस्टम हमेशा याद रखता है कि बिलिंग के समय कितना स्टॉक था (`stock_before_sale`) और बिना स्टॉक के **कितने पीस बेचे गए** (`oversold_qty`)।
   - मैनेजर डैशबोर्ड पर **"🚨 Sold Without Stock Tracker"** में बिना स्टॉक बिके सभी आइटम और उनकी मात्रा अलग से दिखती है।

5. **सेंट्रल मैनेजर डैशबोर्ड (Central Monitoring):**
   - कुल कितने बिल बने, कुल बिक्री (Cash / UPI / Card)।
   - **कैशियर-वाइज रिपोर्ट:** किस कैशियर ने कितने बिल बनाए, कितने कैंसिल हुए, कुल नेट सेल।
   - **मेन सॉफ्टवेयर रिकॉन्सिलिएशन (Main Software Entry):** कौन से बिल मुख्य सॉफ्टवेयर (Data Soft / Tally) में दर्ज हो चुके हैं और कौन से बाकी हैं।
   - दैनिक बिक्री रिपोर्ट को सीधे **Excel (.xlsx)** में डाउनलोड करके मुख्य बिलिंग सॉफ्टवेयर में इंपोर्ट करें।

6. **एंटी-टैम्परिंग व सुरक्षा:**
   - कैशियर को बिल डिलीट करने का कोई विकल्प नहीं है।
   - बिल कैंसिल करने पर अनिवार्य कारण (Reason) दर्ज होता है और स्टॉक अपने आप रीस्टोर हो जाता है।
   - **इम्यूटेबल ऑडिट लॉग (Immutable Audit Trail):** हर गतिविधि का सुरक्षित रिकॉर्ड।

---

## 🚀 क्विक स्टार्ट (Quick Start Guide)

### 1. पहली बार सेटअप (Clone करने के बाद):
टर्मिनल में पैकेज इंस्टॉल करें:
```bash
npm install
```

### 2. सर्वर चालू करना:
फ़ोल्डर में **`start-server.bat`** पर डबल-क्लिक करें, अथवा टर्मिनल में लिखें:
```bash
npm start
```
- **मैनेजर डैशबोर्ड:** `http://localhost:3000/manager.html`
- **कैशियर बिलिंग स्क्रीन:** `http://localhost:3000` (या लोकल वाई-फाई आईपी, जैसे `http://192.168.0.107:3000`)

### 3. उपयोगी NPM कमांड्स:
- `npm start` – पीओएस सर्वर चालू करें
- `npm run import-stock` – Dash Soft स्टॉक CSV को डेटाबेस में लोड करें
- `npm run reset-live` – सभी टेस्ट बिल साफ़ करके फ्रेश बिलिंग शुरू करें

---

## 📱 कैशियर मोबाइल कैसे जोड़ें

1. कैशियर के मोबाइल को दुकान के उसी वाई-फाई से जोड़ें जिससे सर्वर पीसी जुड़ा है।
2. कैशियर अपने मोबाइल के Chrome में सर्वर का पता खोलें (उदा: `http://192.168.0.107:3000`)।
3. कैशियर अपनी आईडी और पिन चुनें:
   - **कैशियर 1 (काउंटर 1):** PIN `1234`
   - **कैशियर 2 (काउंटर 2):** PIN `1234`
   - **कैशियर 3 (काउंटर 3):** PIN `1234`
   - **मैनेजर (Admin):** PIN `9999`
4. Chrome मेनू में जाकर **"Add to Home Screen"** दबाएं। यह मोबाइल पर ऐप की तरह इंस्टॉल हो जाएगा।

---

## 🛠️ GitHub रिपॉजिटरी नियम (Git Guidelines)

- **`node_modules/` को Git में पुश न करें:** यह `.gitignore` में है; नया यूजर केवल `npm install` चलाएगा।
- **`quickbill.db` (डेटाबेस):** 100MB से बड़ा डेटाबेस GitHub ब्लॉक कर देता है, इसलिए `.db` फाइलों को `.gitignore` में रखा गया है ताकि रिपॉजिटरी हल्की, सुपर-फास्ट और सुरक्षित रहे। बैकअप के लिए मैनेजर स्क्रीन पर **"💾 Backup DB"** बटन उपलब्ध है।
