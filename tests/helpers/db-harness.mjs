// tests/helpers/db-harness.mjs
//
// Loads shared/db.js in Node with just enough browser surface to exercise the
// offline paths for real (outbox, sync, cached identity) instead of matching
// source text. Each call returns a FRESH module instance (cache-busted URL), so
// module-level state — the IDB handle, the sync lock — never leaks between tests.
//
// What is faked:
//   - localStorage  : Map-backed, enumerable keys (purgeTenantCaches iterates them)
//   - indexedDB     : a minimal in-memory implementation of the calls db.js makes
//                     (open/upgrade, put/get/getAll/delete/clear, oncomplete)
//   - navigator     : { onLine } — flip `env.online` to go offline
//   - the Supabase client itself is real; tests replace `supabase.from`,
//     `supabase.rpc`, `supabase.auth.*` with recording stubs.

import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DB_URL = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'db.js')).href;

export function makeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  const api = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
  };
  return new Proxy(api, {
    get: (t, p) => (p === 'length' ? m.size : (p in t ? t[p] : m.get(p))),
    ownKeys: () => [...m.keys()],
    getOwnPropertyDescriptor: (_t, p) =>
      (m.has(p) ? { value: m.get(p), enumerable: true, configurable: true } : undefined),
  });
}

// ── Minimal IndexedDB ─────────────────────────────────────────────────────────
function makeIndexedDB() {
  const dbs = new Map();   // name → { version, stores: Map<name, {keyPath, rows: Map}> }
  const later = (fn) => setTimeout(fn, 0);

  function storeApi(store, tx) {
    const req = (fn) => {
      const r = {};
      later(() => {
        try { r.result = fn(); r.onsuccess?.({ target: r }); }
        catch (e) { r.error = e; r.onerror?.({ target: r }); }
        tx._settle();
      });
      tx._pending++;
      return r;
    };
    const clone = (v) => structuredClone(v);
    return {
      put:    (rec) => req(() => { const k = rec[store.keyPath]; store.rows.set(k, clone(rec)); return k; }),
      get:    (k)   => req(() => (store.rows.has(k) ? clone(store.rows.get(k)) : undefined)),
      getAll: ()    => req(() => [...store.rows.entries()]
                                    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                                    .map(([, v]) => clone(v))),
      delete: (k)   => req(() => { store.rows.delete(k); }),
      clear:  ()    => req(() => { store.rows.clear(); }),
      createIndex: () => {},
    };
  }

  function dbApi(entry) {
    return {
      objectStoreNames: { contains: (n) => entry.stores.has(n) },
      createObjectStore: (n, { keyPath }) => {
        const s = { keyPath, rows: new Map() };
        entry.stores.set(n, s);
        return storeApi(s, { _pending: 0, _settle() {} });
      },
      transaction: (names) => {
        const tx = {
          _pending: 0,
          _settle() { if (--this._pending === 0) later(() => this.oncomplete?.()); },
          objectStore: (n) => storeApi(entry.stores.get(n), tx),
        };
        return tx;
      },
    };
  }

  return {
    open(name, version) {
      const r = {};
      later(() => {
        let entry = dbs.get(name);
        const upgrade = !entry || entry.version < version;
        if (!entry) { entry = { version, stores: new Map() }; dbs.set(name, entry); }
        const api = dbApi(entry);
        if (upgrade) { entry.version = version; r.onupgradeneeded?.({ target: { result: api } }); }
        r.result = api;
        r.onsuccess?.({ target: r });
      });
      return r;
    },
  };
}

/**
 * @param {object} [opts]
 * @param {string} [opts.layer='teacher']  portal folder (drives LAYER in db.js)
 * @param {boolean} [opts.online=true]
 * @param {object} [opts.storage]          initial localStorage entries
 * @param {boolean} [opts.idb=true]        false → no indexedDB (LS fallback path)
 */
export async function loadDb({ layer = 'teacher', online = true, storage = {}, idb = true, userId, sw = false } = {}) {
  const env = { online, swListeners: [] };
  // الجلسة المزيّفة: صاحبُ الطابور هو «آخر مستخدم» في هذه البوّابة، والمزامنة
  // لا تُرسل إلّا بجلسة صاحبه. userId: null ← بلا جلسة ولا مستخدمٍ أخير.
  const lastKey = `nsams_lastuser_${layer}`;
  if (userId === undefined) {
    userId = storage[lastKey] ? JSON.parse(storage[lastKey]).id : 'u1';
  }
  if (userId && !storage[lastKey]) {
    storage = { ...storage, [lastKey]: JSON.stringify({ id: userId, email: null }) };
  }
  globalThis.window = globalThis;
  globalThis.location = { pathname: `/ruqi/${layer}/`, href: `http://localhost/ruqi/${layer}/` };
  globalThis.localStorage = makeStorage(storage);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      get onLine() { return env.online; },
      // sw: true ← عامل خدمة مزيّف يلتقط مستمعي الرسائل (لاختبار BG_SYNC).
      ...(sw ? { serviceWorker: { addEventListener: (t, fn) => { if (t === 'message') env.swListeners.push(fn); } } } : {}),
    },
  });
  globalThis.document = {
    createElement: () => ({}), head: { appendChild() {} },
    addEventListener() {}, visibilityState: 'visible',
  };
  if (idb) globalThis.indexedDB = makeIndexedDB();
  else delete globalThis.indexedDB;
  delete globalThis.RUQI_DB;
  delete globalThis.RUQI_PERMISSIONS;
  // GoTrueClient يفتح BroadcastChannel في «المتصفّح» — ومقبضُه في Node يُبقي
  // العملية حيّةً فلا ينتهي ملفّ الاختبار.
  delete globalThis.BroadcastChannel;

  const mod = await import(`${DB_URL}?h=${Math.random().toString(36).slice(2)}`);
  // supabase-js يرى window+document فيبدأ مؤقّت تجديدٍ تلقائيّ يُبقي Node حيّاً
  // إلى الأبد. لا شبكة في الاختبار، فلا معنى له.
  try { await mod.supabase.auth.stopAutoRefresh(); } catch { /* غير قاتل */ }
  mod.supabase.auth.getSession = async () => ({
    data: { session: userId ? { user: { id: userId, email: null } } : null }, error: null,
  });
  return { mod, DB: globalThis.RUQI_DB, supabase: mod.supabase, env, ls: globalThis.localStorage };
}

/**
 * Recording stand-in for `supabase.from(table)`. Every terminal call resolves to
 * `respond(call)` (default: success). `calls` lists {table, op, values, opts, filters}.
 */
export function fakeFrom(respond = () => ({ data: null, error: null })) {
  const calls = [];
  const from = (table) => {
    const call = { table, op: 'select', values: null, opts: null, filters: [] };
    const builder = {
      select: (cols) => { if (call.op === 'select') call.cols = cols; return builder; },
      insert: (v, o) => { call.op = 'insert'; call.values = v; call.opts = o; return builder; },
      upsert: (v, o) => { call.op = 'upsert'; call.values = v; call.opts = o; return builder; },
      update: (v)    => { call.op = 'update'; call.values = v; return builder; },
      delete: ()     => { call.op = 'delete'; return builder; },
      eq:  (c, v) => { call.filters.push(['eq', c, v]); return builder; },
      in:  (c, v) => { call.filters.push(['in', c, v]); return builder; },
      is:  (c, v) => { call.filters.push(['is', c, v]); return builder; },
      neq: (c, v) => { call.filters.push(['neq', c, v]); return builder; },
      order: () => builder, limit: () => builder,
      single: () => builder, maybeSingle: () => builder,
      then: (res, rej) => { calls.push(call); return Promise.resolve(respond(call)).then(res, rej); },
    };
    return builder;
  };
  return { from, calls };
}
