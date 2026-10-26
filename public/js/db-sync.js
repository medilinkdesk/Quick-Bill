/**
 * QuickBill - Client-side Synchronization & Offline Storage Engine
 * Handles IndexedDB, Device ID, Server Heartbeat & Auto-Sync
 */

class QuickBillSyncEngine {
  constructor() {
    this.db = null;
    this.isOnline = false;
    let savedUrl = localStorage.getItem('qb_server_url') || '';
    if (!savedUrl && (window.location.protocol === 'file:' || !window.location.host)) {
      savedUrl = 'http://localhost:3000';
    }
    this.serverUrl = savedUrl;
    this.deviceId = this.initDeviceId();
    this.listeners = [];
    this.initIndexedDB();
    this.startHeartbeat();
  }

  initDeviceId() {
    let id = localStorage.getItem('qb_device_id');
    if (!id) {
      id = 'DEV-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
      localStorage.setItem('qb_device_id', id);
    }
    return id;
  }

  setServerUrl(url) {
    if (url && !url.startsWith('http')) {
      url = 'http://' + url;
    }
    this.serverUrl = url ? url.replace(/\/$/, '') : '';
    localStorage.setItem('qb_server_url', this.serverUrl);
    this.checkConnection();
  }

  getApiUrl(endpoint) {
    const base = this.serverUrl || '';
    return `${base}${endpoint}`;
  }

  initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('QuickBillLocalDB', 2);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('products')) {
          const prodStore = db.createObjectStore('products', { keyPath: 'item_code' });
          prodStore.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('pending_bills')) {
          db.createObjectStore('pending_bills', { keyPath: 'client_bill_id' });
        }
        if (!db.objectStoreNames.contains('synced_bills')) {
          db.createObjectStore('synced_bills', { keyPath: 'client_bill_id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  onStatusChange(callback) {
    this.listeners.push(callback);
  }

  notifyStatus(statusInfo) {
    this.listeners.forEach(cb => {
      try { cb(statusInfo); } catch (e) { console.error(e); }
    });
  }

  async checkConnection() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(this.getApiUrl('/api/system-info'), {
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' }
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const prevStatus = this.isOnline;
        this.isOnline = true;
        this.notifyStatus({ isOnline: true, data });

        // Auto trigger sync if we just reconnected
        if (!prevStatus) {
          this.syncPendingBills();
        }
        return true;
      }
    } catch (err) {
      // Unreachable
    }

    this.isOnline = false;
    this.notifyStatus({ isOnline: false, data: null });
    return false;
  }

  startHeartbeat() {
    this.checkConnection();
    setInterval(() => this.checkConnection(), 4000);
  }

  // Cache products in IndexedDB
  async cacheProducts(products) {
    if (!this.db || !Array.isArray(products)) return;
    const tx = this.db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    for (const p of products) {
      if (p.item_code) {
        store.put(p);
      }
    }
  }

  // Search local products when offline
  async searchOfflineProducts(query) {
    if (!this.db) return [];
    return new Promise((resolve) => {
      const tx = this.db.transaction('products', 'readonly');
      const store = tx.objectStore('products');
      const req = store.getAll();

      req.onsuccess = () => {
        const all = req.result || [];
        if (!query || !query.trim()) {
          resolve(all.slice(0, 50));
          return;
        }
        const q = query.trim().toLowerCase();
        const matched = all.filter(item => 
          (item.name && item.name.toLowerCase().includes(q)) ||
          (item.item_code && item.item_code.toLowerCase().includes(q)) ||
          (item.category && item.category.toLowerCase().includes(q))
        );
        resolve(matched.slice(0, 50));
      };

      req.onerror = () => resolve([]);
    });
  }

  // Get count of pending offline bills
  async getPendingBillsCount() {
    if (!this.db) return 0;
    return new Promise((resolve) => {
      const tx = this.db.transaction('pending_bills', 'readonly');
      const store = tx.objectStore('pending_bills');
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  }

  // Save bill with automatic online / offline failover
  async submitBill(billData) {
    billData.device_id = this.deviceId;
    if (!billData.client_bill_id) {
      billData.client_bill_id = 'CBI-' + this.deviceId + '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
    }
    if (!billData.created_at) {
      billData.created_at = new Date().toISOString();
    }

    // Try online submission if connected
    if (this.isOnline) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(this.getApiUrl('/api/bills'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(billData),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          // Store in synced_bills
          this.storeSyncedBill(data.bill);
          return {
            success: true,
            isOffline: false,
            bill: data.bill,
            bill_no: data.bill.bill_no,
            message: 'Recorded Centrally on Server'
          };
        }
      } catch (err) {
        console.warn('Online bill submission failed, falling back to offline storage:', err);
      }
    }

    // Fallback: Offline Save into IndexedDB
    // Mark bill clearly with offline sequence
    const offlineBillNo = 'OFF-' + (billData.cashier_id || 'C') + '-' + Date.now().toString(36).toUpperCase();
    billData.bill_no = offlineBillNo;
    billData.sync_status = 'PENDING_SYNC';
    billData.offline_created_at = new Date().toISOString();

    await this.storePendingBill(billData);

    return {
      success: true,
      isOffline: true,
      bill: billData,
      bill_no: offlineBillNo,
      message: 'Saved on Device (Pending Central Sync)'
    };
  }

  // IndexedDB operations for pending bills
  storePendingBill(bill) {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve();
      const tx = this.db.transaction('pending_bills', 'readwrite');
      const store = tx.objectStore('pending_bills');
      store.put(bill);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  storeSyncedBill(bill) {
    return new Promise((resolve) => {
      if (!this.db) return resolve();
      const tx = this.db.transaction('synced_bills', 'readwrite');
      const store = tx.objectStore('synced_bills');
      store.put(bill);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  getAllPendingBills() {
    return new Promise((resolve) => {
      if (!this.db) return resolve([]);
      const tx = this.db.transaction('pending_bills', 'readonly');
      const store = tx.objectStore('pending_bills');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  // Batch Sync pending bills to Central Server
  async syncPendingBills() {
    const pending = await this.getAllPendingBills();
    if (pending.length === 0) return { count: 0 };

    try {
      const res = await fetch(this.getApiUrl('/api/bills/batch-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bills: pending })
      });

      if (res.ok) {
        const result = await res.json();
        if (result.synced && result.synced.length > 0) {
          // Remove synced from pending_bills
          const tx = this.db.transaction(['pending_bills', 'synced_bills'], 'readwrite');
          const pendingStore = tx.objectStore('pending_bills');
          const syncedStore = tx.objectStore('synced_bills');

          for (const s of result.synced) {
            pendingStore.delete(s.client_bill_id);
            // Optionally record synced bill
            syncedStore.put({ client_bill_id: s.client_bill_id, server_bill_no: s.server_bill_no, synced_at: new Date().toISOString() });
          }

          // Trigger UI update
          window.dispatchEvent(new CustomEvent('qb-synced', { detail: result }));
        }
        return result;
      }
    } catch (err) {
      console.error('Batch sync error:', err);
    }
    return { count: 0 };
  }

  // Clear all local pending and synced bills (Used on live reset)
  clearAllLocalBills() {
    return new Promise((resolve) => {
      if (!this.db) return resolve();
      try {
        const tx = this.db.transaction(['pending_bills', 'synced_bills'], 'readwrite');
        tx.objectStore('pending_bills').clear();
        tx.objectStore('synced_bills').clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }
}

// Global singleton instance
window.qbSync = new QuickBillSyncEngine();
