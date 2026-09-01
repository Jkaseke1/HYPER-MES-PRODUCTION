import { supabase } from './supabase';

export interface OutboxItem {
  id: string;
  type: 'material_issue' | 'production_complete' | 'dispatch_create' | 'grn_confirm' | 'generic';
  payload: any;
  timestamp: string;
  status: 'pending' | 'processing' | 'failed';
  errorMessage?: string;
}

const DB_NAME = 'HYPER_MES_OFFLINE_DB';
const DB_VERSION = 1;
const STORE_OUTBOX = 'outbox';
const STORE_CACHE = 'cache';

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('[IndexedDB] Failed to open database:', (event.target as IDBOpenDBRequest).error);
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

// === OUTBOX QUEUE MANAGEMENT ===

export async function queueOfflineAction(type: OutboxItem['type'], payload: any): Promise<OutboxItem> {
  const db = await openDB();
  const item: OutboxItem = {
    id: `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type,
    payload,
    timestamp: new Date().toISOString(),
    status: 'pending',
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const req = store.add(item);
    req.onsuccess = () => resolve(item);
    req.onerror = () => reject(req.error);
  });
}

export async function getOutboxItems(): Promise<OutboxItem[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_OUTBOX, 'readonly');
      const store = tx.objectStore(STORE_OUTBOX);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function getOutboxCount(): Promise<number> {
  const items = await getOutboxItems();
  return items.length;
}

export async function removeOutboxItem(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// === READ DATA CACHING ===

export async function cacheData(key: string, value: any): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_CACHE, 'readwrite');
    const store = tx.objectStore(STORE_CACHE);
    store.put({ key, value, updated_at: new Date().toISOString() });
  } catch (e) {
    console.warn('[OfflineCache] Failed to cache data:', key, e);
  }
}

export async function getCachedData<T = any>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_CACHE, 'readonly');
      const store = tx.objectStore(STORE_CACHE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// === AUTO-SYNC OUTBOX REPLAY ENGINE ===

export async function processOfflineOutbox(): Promise<{ processed: number; errors: number }> {
  if (!navigator.onLine) {
    console.log('[AutoSync] Device is offline. Skipping outbox sync.');
    return { processed: 0, errors: 0 };
  }

  const items = await getOutboxItems();
  if (items.length === 0) return { processed: 0, errors: 0 };

  console.log(`[AutoSync] Replaying ${items.length} queued offline actions to Supabase...`);
  let processed = 0;
  let errors = 0;

  for (const item of items) {
    try {
      if (item.type === 'material_issue') {
        const { table, data } = item.payload;
        const { error } = await supabase.from(table || 'sync_log').insert(data);
        if (error) throw error;
      } else if (item.type === 'production_complete') {
        const { orderId, actualQty } = item.payload;
        const { error } = await supabase
          .from('production_orders')
          .update({ status: 'completed', actual_qty: actualQty, completed_at: new Date().toISOString() })
          .eq('id', orderId);
        if (error) throw error;
      } else if (item.type === 'dispatch_create') {
        const { dispatchData, itemsData } = item.payload;
        const { data: inserted, error: err1 } = await supabase.from('dispatch_orders').insert(dispatchData).select().single();
        if (err1) throw err1;
        if (itemsData && itemsData.length > 0 && inserted) {
          const formattedItems = itemsData.map((it: any) => ({ ...it, dispatch_order_id: inserted.id }));
          const { error: err2 } = await supabase.from('dispatch_items').insert(formattedItems);
          if (err2) throw err2;
        }
      } else if (item.type === 'generic') {
        const { table, action, data, match } = item.payload;
        if (action === 'insert') {
          const { error } = await supabase.from(table).insert(data);
          if (error) throw error;
        } else if (action === 'update') {
          const { error } = await supabase.from(table).update(data).match(match);
          if (error) throw error;
        }
      }

      await removeOutboxItem(item.id);
      processed++;
    } catch (err: any) {
      console.error(`[AutoSync] Failed to process outbox item ${item.id}:`, err);
      errors++;
    }
  }

  return { processed, errors };
}

// === NETWORK STATUS LISTENERS ===

export function setupNetworkListeners(onStatusChange: (isOnline: boolean, outboxCount: number) => void) {
  const checkAndNotify = async () => {
    const isOnline = navigator.onLine;
    const count = await getOutboxCount();
    onStatusChange(isOnline, count);

    if (isOnline && count > 0) {
      const res = await processOfflineOutbox();
      const newCount = await getOutboxCount();
      onStatusChange(true, newCount);
      console.log(`[AutoSync] Completed replay: ${res.processed} succeeded, ${res.errors} failed.`);
    }
  };

  window.addEventListener('online', checkAndNotify);
  window.addEventListener('offline', checkAndNotify);

  // Initial check
  checkAndNotify();

  return () => {
    window.removeEventListener('online', checkAndNotify);
    window.removeEventListener('offline', checkAndNotify);
  };
}
