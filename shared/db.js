// ⚠️ محلّية عمداً لا من CDN. كان الاستيراد من esm.sh يجلب ستّة ملفّات من
//    خادم خارجي، وعامل الخدمة يتخطّى كل ما هو cross-origin — فدون اتصال
//    يفشل الاستيراد ولا تُنفَّذ هذه الوحدة إطلاقاً: لا createClient ولا
//    RUQI_DB، فتُفتح القشرة من الكاش وخلفها لا شيء. الحزمة تُبنى بـ
//    tools/build-vendor.mjs وتُخزَّن مع القشرة في sw.js.
import { createClient } from "./vendor/supabase-js.mjs";

const SUPABASE_URL      = "https://xocrzpjfvizgnsybegwr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_HCVzNgEJmov38FWXRO1uFw_DG1d87Y4";

const LAYER = location.pathname.split('/').filter(Boolean).find(
  s => ['school', 'teacher', 'directorate', 'ministry', 'admin', 'parent'].includes(s)
) || 'root';

const AUTH_STORAGE_KEY = `nsams-auth-${LAYER}`;

/* ⚠️ حزامٌ أخير تحت كل المهل الفرديّة.
   withTimeout يحمي القراءات التي لها مخبأ فتسقط إليه، لكنّ عشرات الدوال
   الأخرى بلا أيّ مهلة. وعلى شبكة «متصلة لكن ميتة» — راوتر بلا خطّ، واي‑فاي
   أسير في مدرسة — لا يفشل fetch بل يبقى معلّقاً دقائقَ بمهلة المتصفّح
   الافتراضية، فتتجمّد كلّ شاشة تنتظره بلا رسالة ولا زرّ. هذا يُنهي ذلك صنفاً
   كاملاً بتعديلٍ واحد بدل تعديل خمسٍ وتسعين دالّة.
   AbortController لا Promise.race: يُلغي الطلبَ فعلاً فيصل الخطأ إلى مستدعٍ
   يعرض رسالةً مفهومة، بدل تحرير المنتظِر وترك الطلب يعمل في الخلفية.

   على GET وحدها عمداً. إلغاءُ قراءةٍ لا يترك أثراً على الخادم؛ أمّا إلغاء
   كتابةٍ (POST/PATCH/DELETE، وكلّ rpc) فيترك حالتَها ملتبسة: قد تكون تمّت على
   الخادم بينما يرى العميل فشلاً فيُعيدها — واستيرادٌ جماعيّ مكرّر أسوأ بكثير
   من انتظار. والكتابات محميّة أصلاً بطابور الـoutbox. */
const NETWORK_READ_TIMEOUT_MS = 25000;

function timedFetch(input, init) {
  const method = (init?.method
    ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  if (method !== 'GET') return fetch(input, init);

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NETWORK_READ_TIMEOUT_MS);

  // إشارةُ إلغاءٍ من المستدعي (abortSignal في postgrest) تُحترَم لا تُدهَس.
  const upstream = init?.signal;
  if (upstream?.aborted) { clearTimeout(timer); return fetch(input, init); }
  upstream?.addEventListener('abort', () => { clearTimeout(timer); ctrl.abort(); }, { once: true });

  return fetch(input, { ...init, signal: ctrl.signal })
    .then((res) => { if (res.ok) _stampServerRead(); return res; })
    .finally(() => clearTimeout(timer));
}

/* ⚠️ «متى آخر مرّة وصلنا فيها الخادم فعلاً» — وهو سؤالٌ لا يجيب عنه شريطُ
   الاتصال. الشريط يصف الشبكة لا ما تراه العين، والاثنان يفترقان في الحالة
   الأخطر بالضبط: على شبكة «متصلة لكن ميتة» يبقى الشريط «متصل» أخضرَ بينما كلّ
   رقمٍ معروض خرج من المخبأ — فيُقرَّر على بياناتٍ قديمة ويُرسَل إلى المديرية.
   والمخابئ كلّها تُكتب عند نجاح قراءةٍ حيّة، فزمنُ آخر قراءةٍ ناجحة هو عمرُ ما
   يُعرض. يُختم هنا لا في كل دالّة: نقطةٌ واحدة يمرّ بها كلّ طلب.
   يُحفظ في التخزين كي ينجو من إعادة التحميل — مديرٌ يفتح اللوحة دون اتصال
   يجب أن يعرف عمر ما يراه لا أن يظنّه لحظياً. */
const FRESH_STAMP_KEY = 'nsams_fresh_' + LAYER;
let _lastStampWrite = 0;

function _stampServerRead() {
  const now = Date.now();
  // خنقٌ بسيط: لوحةٌ واحدة تُطلق عشرات الطلبات، ولا معنى لكتابةٍ متزامنة لكلٍّ
  // منها حين تكفي دقّةُ عشر ثوانٍ لعرضٍ بالدقائق.
  if (now - _lastStampWrite < 10000) return;
  _lastStampWrite = now;
  try { localStorage.setItem(FRESH_STAMP_KEY, String(now)); } catch { /* غير قاتل */ }
}

function getLastServerReadAt() {
  try { return Number(localStorage.getItem(FRESH_STAMP_KEY)) || null; }
  catch { return null; }
}

/* نصّ عمر البيانات، مصدرٌ واحد للبوّابات الستّ (كما errMessage).
   يعيد '' حين تكون البيانات لحظيةً فعلاً، كي لا يصير المؤشّر ضجيجاً دائماً
   يتعلّم المستخدم تجاهله — فلا يراه إلّا حين يعني شيئاً. */
function formatDataAge() {
  const at = getLastServerReadAt();
  if (!at) return '';
  if (isOnline() && Date.now() - at < 90 * 1000) return '';

  const d    = new Date(at);
  const time = d.toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' });
  // تاريخٌ صريح حين لا تكون البيانات من اليوم: «١٠:٤٥» وحدها تُقرأ كأنّها اليوم.
  return localDateISO(d) === localDateISO()
    ? `آخر تحديث ${time}`
    : `آخر تحديث ${d.toLocaleDateString('ar-SY', { day: 'numeric', month: 'long' })} — ${time}`;
}

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey:       AUTH_STORAGE_KEY,
    persistSession:   true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: { fetch: timedFetch },
});
export { db as supabase };
export { SUPABASE_URL as supabaseUrl };
export { errMessage, isNetworkError };
export { withTimeout, getOfflineUserId };
export { getModuleCatalog, getRoleModulePermissions, setRoleModulePermission, updateUserPermissionRole };

/* تسجيل عامل الخدمة انتقل إلى shared/sw-register.js كي تستعمله الصفحة
   الرئيسية أيضاً — كانت بلا أي <script> فلا يُثبَّت عندها شيء ولا تعمل دون
   اتصال. الحقن هنا يُبقي البوّابات تعمل كما هي بلا تعديل ستّة ملفّات HTML. */
if ('serviceWorker' in navigator && !window.__ruqiSwRegistered) {
  const _reg = document.createElement('script');
  _reg.src = new URL('./sw-register.js', import.meta.url).href;
  _reg.defer = true;
  document.head.appendChild(_reg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue helpers (offline support)
// ─────────────────────────────────────────────────────────────────────────────
const QUEUE_ATTENDANCE = "nsams_pending_attendance";
const QUEUE_REPORTS    = "nsams_pending_reports";
const QUEUE_STU_ATT    = 'nsams_pending_stu_att';
const QUEUE_GRADES     = 'nsams_pending_grades';
const QUEUE_CONDUCT    = 'nsams_pending_conduct';
const QUEUE_STAFF_ATT  = 'nsams_pending_staff_att';
const QUEUE_STUDENTS   = 'nsams_pending_students';

// Default work-start time used for the lateness calculation when a school has
// not configured `schools.work_start_time`.
const DEFAULT_WORK_START = '07:30';

function readQueue(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
}

function writeQueue(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function generateLocalId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateReceiptNumber() {
  return `RPT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function isOnline() { return navigator.onLine; }

/* مهلة زمنية لأيّ وعد شبكي. على شبكة «متصلة لكن ميتة» (راوتر بلا خطّ، واي‑فاي
   أسير) يبقى fetch معلّقاً بلا سقف فتتجمّد الواجهة — وهذا ما يجعل الدخول يستغرق
   ~15ث أو لا يكتمل. نُسابق الوعد بمؤقّت يرمي TimeoutError، فيتحوّل التعلّق إلى
   فشلٍ سريع تلتقطه مساراتُ المخبأ (كأنّنا دون اتصال). لا يُلغى الطلب الأصلي —
   يُترَك يكتمل في الخلفية بلا ضرر — إنّما يُحرَّر المنتظِر فقط. */
class TimeoutError extends Error {
  constructor(ms) { super(`انتهت مهلة الشبكة (${ms}ms)`); this.name = 'TimeoutError'; }
}
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => clearTimeout(timer));
}

// سقفٌ زمنيّ موحّد لقراءات البيانات على شبكة «متصلة لكن ميتة» قبل السقوط للمخبأ.
const OFFLINE_READ_TIMEOUT_MS = 6000;

/* ─── ترجمة الأخطاء ──────────────────────────────────────────────────────────
   كانت البوّابات الستّ تعرض نصّ الخطأ التقني كما هو: `showError(el, e.message)`
   أو `textContent = err?.message ?? '…'` في نحو سبعين موضعاً. فيرى معاون مدير
   التربية «TypeError: Failed to fetch» أو «User is banned» — إنجليزية، ولا
   تقول له ما العمل.

   هذه الدالّة تحوّل الخطأ إلى جملة عربية **توجيهية**: ماذا حدث وما الخطوة
   التالية. الرمز التقني لا يُفقَد — يبقى في console.error عند موضع الالتقاط.

   الترتيب مقصود: الشبكة أوّلاً (أشيع سبب في مدارس ذات إنترنت متقطّع)، ثم
   المصادقة، ثم أكواد Postgres. وما لا يُعرَف يعود إلى fallback العربي الذي
   يمرّره الموضع نفسه — فالسياق عنده أدقّ ممّا يمكن لدالّة عامّة أن تخمّنه. */

const AUTH_ERRORS = [
  [/invalid login credentials/i,          'البريد الإلكتروني أو كلمة المرور غير صحيحة.'],
  [/user is banned|user_banned/i,         'هذا الحساب موقوف. راجع مشرف النظام لإعادة تفعيله.'],
  [/email not confirmed/i,                'لم يُفعَّل هذا البريد بعد. راجع مشرف النظام.'],
  [/user already registered/i,            'هذا البريد مسجَّل مسبقاً في النظام.'],
  [/password should be at least/i,        'كلمة المرور قصيرة — استعمل ٦ محارف على الأقلّ.'],
  [/same[_ ]password/i,                   'كلمة المرور الجديدة مطابقة للقديمة. اختر واحدة مختلفة.'],
  [/(over_email_send_rate_limit|too many requests|rate limit)/i,
                                          'حاولتَ مرّات كثيرة متتالية. انتظر دقيقة ثم أعد المحاولة.'],
  [/invalid refresh token|refresh[_ ]token[_ ]not[_ ]found|session[_ ]not[_ ]found/i,
                                          'انتهت صلاحية جلستك. سجّل الدخول من جديد.'],
  [/jwt expired/i,                        'انتهت صلاحية جلستك. سجّل الدخول من جديد.'],
  [/invalid api key/i,                    'إعدادات الاتصال بالنظام غير صحيحة. راجع مشرف النظام.'],
];

const PG_ERRORS = {
  '23505': 'هذه القيمة مسجَّلة مسبقاً — لا يمكن تكرارها.',
  '23503': 'لا يمكن إتمام العملية: سجلّ مرتبط بهذه البيانات غير موجود أو ما يزال مستعمَلاً.',
  '23502': 'حقل مطلوب تُرك فارغاً. أكمل الحقول ثم أعد المحاولة.',
  '23514': 'إحدى القيم المُدخَلة خارج المدى المسموح.',
  '22P02': 'إحدى القيم المُدخَلة بصيغة غير صحيحة.',
  '42501': 'لا تملك صلاحية لهذه العملية على هذه البيانات.',
  '42P01': 'هذه الميزة غير مكتملة التهيئة في قاعدة البيانات. راجع مشرف النظام.',
  'PGRST116': 'لا توجد بيانات مطابقة.',
  'PGRST301': 'انتهت صلاحية جلستك. سجّل الدخول من جديد.',
};

const NETWORK_MSG =
  'لا يوجد اتصال بالإنترنت. سيُحفَظ ما أدخلتَه ويُرسَل تلقائياً عند عودة الشبكة.';

function isNetworkError(err) {
  if (!err) return false;
  // navigator.onLine=false قاطع؛ أمّا النصّ فلأنّ الجهاز قد يكون «متّصلاً»
  // بشبكة محلّية بلا إنترنت فعلي، وهي حالة شائعة في المدارس.
  if (!navigator.onLine) return true;
  const s = `${err.name || ''} ${err.message || ''} ${err.details || ''}`;
  return /failed to fetch|networkerror|network request failed|load failed|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|ERR_CONNECTION|fetch failed|timeout|aborted/i.test(s);
}

/** يُرجع رسالة عربية موجِّهة للمستخدم. `fallback` نصّ السياق عند الاستدعاء. */
function errMessage(err, fallback = 'تعذّر إتمام العملية. أعد المحاولة.') {
  if (!err) return fallback;
  if (typeof err === 'string') return err.trim() || fallback;

  if (isNetworkError(err)) return NETWORK_MSG;

  const code = err.code ?? err.status ?? '';
  if (code && PG_ERRORS[code]) return PG_ERRORS[code];

  const text = `${err.message || ''} ${err.error_description || ''} ${err.details || ''}`;
  for (const [re, msg] of AUTH_ERRORS) if (re.test(text)) return msg;

  if (code === 401 || code === '401') return 'انتهت صلاحية جلستك. سجّل الدخول من جديد.';
  if (code === 403 || code === '403') return 'لا تملك صلاحية لهذه العملية.';
  if (code === 404 || code === '404') return 'لم يُعثر على البيانات المطلوبة.';
  if (code === 429 || code === '429') return 'حاولتَ مرّات كثيرة متتالية. انتظر قليلاً ثم أعد المحاولة.';
  if (Number(code) >= 500)            return 'الخادم لا يستجيب حالياً. أعد المحاولة بعد قليل.';

  // رسالة عربية كتبها الخادم أو RPC عمداً (RAISE EXCEPTION) — تُعرَض كما هي.
  if (/[؀-ۿ]/.test(err.message || '')) return err.message;

  return fallback;
}

// ─── Device identity ──────────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem('nsams_device_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('nsams_device_id', id); }
  return id;
}

// ─── IndexedDB layer (المرحلة 4ب) ────────────────────────────────────────────
// مخزنان: outbox (قائمة الانتظار الموحّدة) + delta_cache (ذاكرة السحب التدريجي)
const IDB_NAME    = 'nsams-idb';
const IDB_VERSION = 1;
let _idbPromise   = null;

function openIDB() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains('outbox')) {
        const os = idb.createObjectStore('outbox', { keyPath: 'localId' });
        os.createIndex('by_table', 'table', { unique: false });
        os.createIndex('by_ts',    'localTs', { unique: false });
      }
      if (!idb.objectStoreNames.contains('delta_cache')) {
        idb.createObjectStore('delta_cache', { keyPath: 'cacheKey' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => { _idbPromise = null; reject(new Error('IDB open failed')); };
    req.onblocked = () => { _idbPromise = null; reject(new Error('IDB blocked'));     };
  });
  return _idbPromise;
}

async function idbPut(storeName, record) {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = idb.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbGetAll(storeName) {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = idb.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbDelete(storeName, key) {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = idb.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// LS key → table name (لاستخدامهما في الهجرة والسقوط الآمن)
const _LS_QUEUE_TABLE = {
  [QUEUE_ATTENDANCE]: 'attendance_submissions',
  [QUEUE_REPORTS]:    'emergency_reports',
  [QUEUE_STU_ATT]:   'daily_student_attendance',
  [QUEUE_GRADES]:     'student_grades',
  [QUEUE_CONDUCT]:    'student_conduct',
  [QUEUE_STAFF_ATT]: 'staff_attendance',
  [QUEUE_STUDENTS]:   'students',
};

// table name → LS key (للسقوط الآمن عند تعذّر IDB)
const _TABLE_LS_QUEUE = Object.fromEntries(
  Object.entries(_LS_QUEUE_TABLE).map(([k, v]) => [v, k])
);

// هجرة لمرة واحدة: ينقل عناصر LS غير المُزامَنة إلى IDB outbox ثم يمسحها
async function migrateQueuesFromLS() {
  if (localStorage.getItem('nsams_idb_migrated')) return;
  try {
    for (const [lsKey, tableName] of Object.entries(_LS_QUEUE_TABLE)) {
      const items = readQueue(lsKey).filter(r => !r.synced);
      for (const item of items) {
        await idbPut('outbox', {
          ...item, table: tableName,
          localId:  item.localId  || generateLocalId(),
          localTs:  item.localTs  || Date.now(),
          deviceId: item.deviceId || getDeviceId(),
        });
      }
    }
    localStorage.setItem('nsams_idb_migrated', '1');
  } catch { /* IDB غير متاح — تبقى العناصر في LS وتُهاجَر في المرة القادمة */ }
}

// إضافة عنصر إلى IDB outbox (مع سقوط آمن إلى LS الخاصة بالجدول)
async function enqueueOutbox(record) {
  try {
    await idbPut('outbox', {
      ...record,
      localTs:  record.localTs  || Date.now(),
      deviceId: record.deviceId || getDeviceId(),
    });
  } catch {
    const lsKey = _TABLE_LS_QUEUE[record.table] || QUEUE_STUDENTS;
    const q = readQueue(lsKey); q.push(record); writeQueue(lsKey, q);
  }
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then(reg => reg.sync.register('nsams-sync'))
      .catch(() => {});
  }
}

async function readOutbox() {
  try { return await idbGetAll('outbox'); } catch { return []; }
}

async function deleteOutboxItem(localId) {
  try { await idbDelete('outbox', localId); } catch { /* non-fatal */ }
}

// ─── Delta pull (سحب تدريجي من الخادم — المرحلة 4ب) ─────────────────────────
const _DELTA_RPC = {
  students:                 'pull_students_delta',
  student_grades:           'pull_grades_delta',
  daily_student_attendance: 'pull_attendance_delta',
  student_conduct:          'pull_conduct_delta',
};

const _DELTA_PK = {
  students:                 r => r.id,
  student_grades:           r => `${r.student_id}:${r.component_id}:${r.semester}:${r.academic_year}`,
  daily_student_attendance: r => `${r.student_id}:${r.date}`,
  student_conduct:          r => `${r.student_id}:${r.academic_year}`,
};

async function getLastPulledAt(tableName, deviceId) {
  try {
    const { data, error } = await db.rpc('get_sync_state', {
      p_device_id: deviceId, p_table_name: tableName });
    if (error || !data) return '1970-01-01T00:00:00Z';
    return data;
  } catch { return '1970-01-01T00:00:00Z'; }
}

async function _applyDeltaRows(tableName, rows) {
  const getPk = _DELTA_PK[tableName] || (r => r.id);
  for (const row of rows) {
    const cacheKey = `${tableName}:${getPk(row)}`;
    if (row.deleted_at) {
      await idbDelete('delta_cache', cacheKey).catch(() => {});
    } else {
      await idbPut('delta_cache',
        { cacheKey, table: tableName, data: row, cachedAt: Date.now() }
      ).catch(() => {});
    }
  }
}

async function pullDelta(tableName, classId, deviceId) {
  const rpcName = _DELTA_RPC[tableName];
  if (!rpcName) return;
  const since = await getLastPulledAt(tableName, deviceId);
  const { data, error } = await db.rpc(rpcName, { p_class_id: classId, p_since: since });
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) return;
  await _applyDeltaRows(tableName, rows);
  await db.rpc('upsert_sync_state', {
    p_device_id: deviceId, p_table_name: tableName,
    p_pulled_at: rows[rows.length - 1].updated_at,
  }).catch(() => {});
}

// سحب دلتا كل الجداول لصف واحد — يُستدعى صراحةً من الواجهة بعد معرفة الصف
async function pullAllDelta(classId) {
  if (!classId || !isOnline()) return;
  const deviceId = getDeviceId();
  for (const table of Object.keys(_DELTA_RPC)) {
    await pullDelta(table, classId, deviceId).catch(() => {});
  }
}

// ── Report photo storage ──────────────────────────────────────────────────────
// The bucket 'report-photos' is PRIVATE. uploadDataUri() uploads the file and
// returns the storage PATH (e.g. "reports/1234_abc.jpg"), not a public URL.
// Call resolveReportPhotos() before displaying — it converts paths to 1-hour
// signed URLs. Data URIs (legacy inline photos) and legacy https:// URLs pass
// through unchanged so old records continue to work.
const REPORT_BUCKET = 'report-photos';
// Signed URL TTL in seconds (1 hour — long enough for a session, short enough
// to limit exposure if a link leaks).
const SIGNED_URL_TTL = 3600;

async function uploadDataUri(dataUri) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUri);
  if (!m) return dataUri; // not a data URI — leave untouched
  const mime = m[1];
  const b64  = m[2];
  const ext  = (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';

  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const path = `reports/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await db.storage
    .from(REPORT_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw error;

  // Return the storage path — caller must use resolveReportPhotos() to display.
  return path;
}

// Replace any inline data-URI photos with storage paths.
// Keeps the data URI on failure so the photo is never lost.
async function materialisePhotos(mediaUrls) {
  if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) return mediaUrls ?? [];
  const out = [];
  for (const u of mediaUrls) {
    if (typeof u === 'string' && u.startsWith('data:')) {
      try { out.push(await uploadDataUri(u)); }
      catch (e) { console.warn('[Ruqi] photo upload failed — keeping inline data URI', e); out.push(u); }
    } else {
      out.push(u);
    }
  }
  return out;
}

// Convert an array of storage paths / legacy public URLs / data URIs into
// displayable URLs. Storage paths get a short-lived signed URL; the other two
// types are returned as-is (backwards-compatible with old inline records).
async function resolveReportPhotos(mediaUrls) {
  if (!Array.isArray(mediaUrls) || !mediaUrls.length) return [];
  const out = [];
  for (const u of mediaUrls) {
    if (!u) continue;
    if (u.startsWith('data:') || u.startsWith('http')) {
      out.push(u); // data URI or legacy public URL — use directly
    } else {
      const { data, error } = await db.storage
        .from(REPORT_BUCKET)
        .createSignedUrl(u, SIGNED_URL_TTL);
      if (error) { console.warn('[Ruqi] signed URL failed for', u, error); }
      else out.push(data.signedUrl);
    }
  }
  return out;
}

// Local calendar date (YYYY-MM-DD) in the device timezone — NOT UTC.
// new Date().toISOString() returns UTC, which is the PREVIOUS day between
// local 00:00–03:00 in Syria (UTC+3). For a date-keyed attendance system that
// silently files records under the wrong day. Always build from local parts.
function localDateISO(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const da = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
// Teachers are provisioned centrally by the principal with a USERNAME (no email).
// A username (no '@') is mapped to a synthetic email so Supabase auth — which is
// email-based — can authenticate it. Admins/directorate keep using their email.
const STAFF_EMAIL_DOMAIN = 'staff.nsams.local';
function identifierToEmail(identifier) {
  const id = (identifier || '').trim();
  return id.includes('@') ? id : `${id.toLowerCase()}@${STAFF_EMAIL_DOMAIN}`;
}

async function login(identifier, password) {
  const email = identifierToEmail(identifier);
  const { data: authData, error: authError } =
    await db.auth.signInWithPassword({ email, password });

  if (authError) throw authError;

  const userId = authData.user.id;

  const { data: profile, error: profileError } = await db
    .from("users")
    .select("role, school_id, directorate_id, full_name")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) throw new Error("لا توجد صلاحية لقراءة بيانات المستخدم.");
  if (!profile) throw new Error("المستخدم غير مسجل في النظام.");

  /* ⚠️ التخزين هنا لا في getCurrentUser وحدها. كان مسار الدخول اليدوي يجلب
     الملفّ ثمّ يرميه، وكاتبُ المخبأ الوحيد هو getCurrentUser — وهي لا تُستدعى
     في هذا المسار إطلاقاً. فمن سجّل دخوله ثمّ أغلق التطبيق وقطع الاتصال وجد
     شاشةَ الدخول من جديد: الجلسة سليمة، لكن لا ملفَّ مخبّأ يسقط إليه الاستعلامُ
     الفاشل، ولا مؤشّرَ «آخر مستخدم» بعد انتهاء التوكن. عملياً لم يكن الدخول
     أوفلاين ينجح إلّا لمن أعاد تحميل التطبيق مرّةً وهو متصل — شرطٌ لا يعرفه أحد.
     التخزين لا يمنح صلاحية: RLS يبقى الحَكم عند أوّل استعلام. */
  _cacheProfile(userId, profile);
  _cacheLastUser(userId, authData.user.email);

  return {
    user: { id: userId, email: authData.user.email, fullName: profile.full_name },
    role: profile.role,
    schoolId: profile.school_id,
    directorateId: profile.directorate_id,
  };
}

/* ⚠️ الترتيب مقصود: الحذف المحلّي أوّلاً ثم الإبطال العام.
   signOut() الافتراضي (scope عام) يحذف الجلسة المحلّية **فقط بعد** نجاح نداء
   الشبكة. فإن كان الجهاز دون اتصال أو الخادم بعيد المنال، يعود بخطأ ويترك
   الجلسة في localStorage كما هي — وكل مستدعٍ يبتلع الخطأ ثم يُعيد التحميل،
   فيجد getCurrentUser الجلسة ويُدخِل «الخارج» من جديد. على أجهزة مشتركة في
   مدارس ذات إنترنت متقطّع هذا ليس افتراضياً.

   'local' يحذف الجلسة من الجهاز بلا شبكة إطلاقاً، فيصير الخروج مضموناً.
   ثم نحاول الإبطال العام (سحب رموز التحديث من كل الأجهزة) بلا حجب: نجاحه
   إضافة أمنية، وفشله لا يُبقي أحداً داخلاً على هذا الجهاز. */
async function logout() {
  try {
    await db.auth.signOut({ scope: 'local' });
  } catch { /* لا يُوقف الخروج */ }

  // إبطال عام بأفضل جهد — لا يُنتظَر ولا يُرمى خطؤه.
  db.auth.signOut({ scope: 'global' }).catch(() => {});

  // حزام أمان: لو تغيّرت آلية التخزين في supabase-js يوماً، لا تبقى الجلسة.
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(AUTH_STORAGE_KEY)) localStorage.removeItem(k);
    }
  } catch { /* غير قاتل */ }
}

/* ⚠️ ملفّ الدور مخبّأ ليعمل الدخول دون اتصال — لا ليمنح صلاحية.
   getSession() محلّي بالكامل، لكن استعلام الدور كان يضرب الشبكة دائماً؛ فدون
   اتصال يفشل ويعود null فتُسقط كلُّ بوابة المستخدمَ إلى شاشة الدخول — في
   تطبيق كامل بُني على العمل دون اتصال. المخبّأ يسدّ هذه الفجوة وحدها.

   التصريح الحقيقي يبقى JWT وسياسات RLS على الخادم: مستخدم يعبث بالمخبّأ ليرى
   لوحة الوزارة سيراها **فارغة**، لأن كل استعلام يُرفَض. المخبّأ يوجّه الواجهة
   لا أكثر، ومربوط بمعرّف المستخدم فلا يخدم حساباً آخر، ويُمحى عند الخروج مع
   بقيّة مخابئ المستأجِر (TENANT_CACHE_PREFIXES). */
const PROFILE_CACHE_PFX = 'nsams_profile_';
const LAST_USER_PFX     = 'nsams_lastuser_';   // مؤشّر «آخر مستخدم دخل» لهذه البوّابة

function _cacheProfile(userId, profile) {
  try { localStorage.setItem(PROFILE_CACHE_PFX + LAYER + '_' + userId, JSON.stringify(profile)); }
  catch { /* حصة التخزين ممتلئة — غير قاتل */ }
}

function _cachedProfile(userId) {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_PFX + LAYER + '_' + userId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/* مؤشّر «آخر مستخدم» يُمكِّن الدخول أوفلاين بعد انتهاء التوكن: getSession() لا
   يعيد جلسةً حينها، فبلا هذا المؤشّر لا نعرف مِن أيّ userId نقرأ الملفّ المخبّأ.
   يُمحى عند الخروج مع بقيّة مخابئ المستأجِر (TENANT_CACHE_PREFIXES). */
function _cacheLastUser(userId, email) {
  try { localStorage.setItem(LAST_USER_PFX + LAYER, JSON.stringify({ id: userId, email: email ?? null })); }
  catch { /* غير قاتل */ }
}
function _cachedLastUser() {
  try {
    const raw = localStorage.getItem(LAST_USER_PFX + LAYER);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/* دخول أوفلاين: يبني كائن المستخدم من المخبأ وحده (صفر شبكة) لتخطّي شاشة الدخول
   متى سبق الدخول على هذا الجهاز. لا يمنح صلاحية — كلّ قراءة لاحقة من المخابئ،
   وكلّ كتابة تدخل طابور الـoutbox، وRLS يبقى الحَكم عند المزامنة. يعيد null إن لم
   يسبق دخول (لا مؤشّر/لا ملفّ مخبّأ) فتظهر شاشة الدخول كالمعتاد. */
function getCurrentUserOffline() {
  const last = _cachedLastUser();
  if (!last?.id) return null;
  const row = _cachedProfile(last.id);
  if (!row) return null;
  return {
    user: { id: last.id, email: last.email ?? null, fullName: row.full_name },
    role: row.role,
    schoolId: row.school_id,
    directorateId: row.directorate_id,
    offline: true,
  };
}

// معرّف «آخر مستخدم دخل» على هذا الجهاز، لطبقة العرض (permissions) حين لا جلسة
// حيّة (توكن منتهٍ بعد طول انقطاع) كي تقرأ مصفوفة الوحدات المخبّأة له.
function getOfflineUserId() { return _cachedLastUser()?.id ?? null; }

async function getCurrentUser() {
  // getSession() محلّي، لكنّه قد يُطلق تحديث توكن شبكياً بلا سقف على شبكة ميتة →
  // نُسابقه بمهلة قصيرة. أيّ تعلّق يسقط لهوية أوفلاين مخبّأة بدل تجميد الواجهة.
  let session;
  try {
    const res = await withTimeout(db.auth.getSession(), 3500);
    session = res?.data?.session ?? null;
  } catch {
    return getCurrentUserOffline();
  }
  if (!session) {
    // لا جلسة: خروجٌ حقيقي (أونلاين → شاشة الدخول) أو توكنٌ انتهى بعد طول انقطاع
    // (أوفلاين → ادخل بالمخبأ). التمييز بحالة الاتصال؛ RLS يحمي الخادم أيّاً كان.
    return isOnline() ? null : getCurrentUserOffline();
  }

  let profile = null;
  try {
    const { data, error } = await withTimeout(
      db.from("users")
        .select("role, school_id, directorate_id, full_name")
        .eq("id", session.user.id)
        .maybeSingle(),
      3500,
    );
    if (error) throw error;
    profile = data;
  } catch { /* انقطاع/مهلة أثناء استعلام الملفّ → نسقط للمخبأ أدناه */ }

  let row = profile;
  if (!row) {
    // لا ملفّ حيّ: مخبّأ (انقطاع شبكة) أو مستخدمٌ حُذف فعلاً (لا مخبّأ → null).
    row = _cachedProfile(session.user.id);
    if (!row) return null;
  } else {
    _cacheProfile(session.user.id, profile);
  }

  _cacheLastUser(session.user.id, session.user.email);
  return {
    user: { id: session.user.id, email: session.user.email, fullName: row.full_name },
    role: row.role,
    schoolId: row.school_id,
    directorateId: row.directorate_id,
  };
}

// ─── Schools ──────────────────────────────────────────────────────────────────
async function getSchools(directorateId) {
  // المدارس المؤرشفة (§25) تُستثنى من كل قائمة تشغيلية — تبقى مرئية في
  // لوحة المشرف وحدها تحت مرشّح صريح.
  const query = db.from("schools").select("id, name, lat, lng").is("archived_at", null);
  if (directorateId) query.eq("directorate_id", directorateId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function getSchoolStatus(schoolId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;

  const [attendanceRes, reportRes] = await Promise.all([
    db.from("daily_attendance").select("id").eq("school_id", schoolId).eq("date", isoDate).limit(1),
    db.from("emergency_reports").select("id").eq("school_id", schoolId).in("status", ["open", "acknowledged"]).limit(1),
  ]);

  if (attendanceRes.error) throw attendanceRes.error;
  if (reportRes.error) throw reportRes.error;

  return {
    attendanceSubmitted: attendanceRes.data.length > 0,
    hasActiveReport: reportRes.data.length > 0,
  };
}

// School-admin: fetch today's submitted daily_attendance row (or null). Used to
// restore the "submitted" confirmation state on reload and show audit details.
// withTimeout: هذه على مسار الإقلاع — initApp ينتظرها بعد إظهار اللوحة، فتعلّقُها
// يترك المدير أمام لوحةٍ نصف مرسومة. مهلةٌ قصيرة تعني «اعتبره غير مُرسَل» (وهو
// ما يفعله المستدعي في catch أصلاً) بدل تجميدٍ صامت.
async function getDailyAttendance(schoolId, date) {
  const iso = date instanceof Date ? localDateISO(date) : date;
  const { data, error } = await withTimeout(
    db.from("daily_attendance")
      .select("teachers_present,teachers_absent,admins_present,admins_absent,workers_present,workers_absent,students_present,notes,submitted_at")
      .eq("school_id", schoolId)
      .eq("date", iso)
      .maybeSingle(),
    OFFLINE_READ_TIMEOUT_MS,
  );
  if (error) throw error;
  return data; // null when not yet submitted
}

async function getSchoolById(schoolId) {
  // select('*') so school_type is included once the migration runs, while
  // staying safe (no "column does not exist" error) if it hasn't yet.
  // withTimeout: على شبكة «متصلة لكن ميتة» يرمي بعد المهلة بدل التعلّق، فيسقط
  // loadSchoolData لمخبأ المدرسة (nsams_school2_) بدل تجميد تحميل اللوحة.
  const { data, error } = await withTimeout(
    db.from('schools')
      .select('*')
      .eq('id', schoolId)
      .single(),
    OFFLINE_READ_TIMEOUT_MS,
  );
  if (error) throw error;
  return data;
}

// School-admin: update editable school settings (currently the minimum
// attendance % used as a promotion gate). camelCase in → snake_case column.
async function updateSchool(schoolId, patch) {
  const row = {};
  if (patch.minAttendancePct !== undefined) row.min_attendance_pct = patch.minAttendancePct;
  if (patch.workStartTime    !== undefined) row.work_start_time     = patch.workStartTime || null;
  // School identity (هوية المدرسة) + GPS — reuses the existing lat/lng columns.
  if (patch.schoolType    !== undefined) row.school_type    = patch.schoolType;
  if (patch.classification!== undefined) row.classification = patch.classification|| null;
  if (patch.educationType !== undefined) row.education_type = patch.educationType || null;
  if (patch.shift         !== undefined) row.shift          = patch.shift         || null;
  if (patch.studentType   !== undefined) row.student_type   = patch.studentType   || null;
  if (patch.lat           !== undefined) row.lat            = patch.lat;
  if (patch.lng           !== undefined) row.lng            = patch.lng;
  // Staff & enrolment counts — school admin enters real figures in settings.
  if (patch.totalTeachers !== undefined) row.total_teachers = patch.totalTeachers === '' ? null : Number(patch.totalTeachers);
  if (patch.totalStudents !== undefined) row.total_students = patch.totalStudents === '' ? null : Number(patch.totalStudents);
  /* حدّا النصاب: الفارغ يعني «اتبع الوطنيّ» لا «بلا حدّ» — فيُخزَّن null لا صفر.
     وصفرٌ هنا سيمنع كلَّ إدخالٍ ويبدو للمدير عطلاً لا إعداداً. */
  if (patch.quotaMinLessons !== undefined) row.quota_min_lessons = patch.quotaMinLessons === '' || patch.quotaMinLessons == null ? null : Number(patch.quotaMinLessons);
  if (patch.quotaMaxLessons !== undefined) row.quota_max_lessons = patch.quotaMaxLessons === '' || patch.quotaMaxLessons == null ? null : Number(patch.quotaMaxLessons);
  if (Object.keys(row).length === 0) return true;
  const { data, error } = await db.from('schools').update(row).eq('id', schoolId).select('id');
  if (error) throw error;
  // RLS may silently update 0 rows (no UPDATE policy) without raising an error —
  // surface that as a clear failure instead of a false success.
  if (!data || data.length === 0)
    throw new Error('لم تُحفظ التعديلات — تحقق من صلاحيات قاعدة البيانات (RLS) لجدول المدرسة.');
  return true;
}

/* حدُّ النصاب الوطنيّ (صفٌّ واحدٌ تضبطه الوزارة). القراءة للجميع: كلُّ مدرسةٍ
   تحتاجه لتتحقّق من مدخلاتها قبل الحفظ. وعند تعذّر الجلب نُرجع null لا رقماً
   مخترَعاً — حدٌّ مخترَعٌ يرفض إدخالاً سليماً أسوأ من غياب الحدّ. */
async function getTeachingQuotaBounds() {
  const { data, error } = await db
    .from('teaching_quota_bounds')
    .select('min_lessons, max_lessons, updated_at')
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function setTeachingQuotaBounds({ minLessons, maxLessons }) {
  const { data, error } = await db
    .from('teaching_quota_bounds')
    .update({ min_lessons: Number(minLessons), max_lessons: Number(maxLessons),
              updated_at: new Date().toISOString() })
    .eq('id', true)
    .select('min_lessons, max_lessons');
  if (error) throw error;
  if (!data || !data.length)
    throw new Error('لم تُحفظ الحدود — الضبط مخصّص لمشرف الوزارة.');
  return data[0];
}

// ─── Workflow requests (school ↔ directorate) ────────────────────────────────

// School-admin: create a new request to the directorate.
async function createSchoolRequest(schoolId, directorateId, type, payload) {
  const { data: sess } = await db.auth.getSession();
  const uid = sess?.session?.user?.id;
  if (!uid) throw new Error('غير مسجّل الدخول');
  const { data, error } = await db
    .from('school_requests')
    .insert({ school_id: schoolId, directorate_id: directorateId, type, payload, created_by: uid })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// School-admin: list all requests for this school, newest first.
const SCHOOL_REQUESTS_CACHE_PFX = 'nsams_sreq_';

async function getSchoolRequests(schoolId) {
  const key = SCHOOL_REQUESTS_CACHE_PFX + schoolId;
  if (!isOnline()) {
    const hit = _readJSONCache(key);
    if (hit) return hit;
  }
  let rows;
  try {
    const res = await withTimeout(
      db.from('school_requests')
        .select('id, type, status, payload, review_reason, created_at, applied_at')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false })
        .limit(100),
      OFFLINE_READ_TIMEOUT_MS,
    );
    if (res.error) throw res.error;
    rows = res.data ?? [];
  } catch (err) {
    const hit = _readJSONCache(key);
    if (hit) { console.warn('[Ruqi] طلبات المدرسة من المخبأ', err); return hit; }
    throw err;
  }
  _writeJSONCache(key, rows);
  return rows;
}

// Directorate: list pending/recent requests for a directorate (raw RLS select).
async function getDirectorateRequests(directorateId) {
  const { data, error } = await db
    .from('school_requests')
    .select('id, type, status, payload, review_reason, created_at, applied_at, school:schools(name)')
    .eq('directorate_id', directorateId)
    .order('status')                        // pending first (alphabetically)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

// Directorate: approve or reject a request (calls SECURITY DEFINER RPC).
async function reviewSchoolRequest(requestId, decision, reason = null) {
  const { error } = await db.rpc('review_school_request', {
    p_request_id: requestId,
    p_decision:   decision,
    p_reason:     reason || null,
  });
  if (error) throw error;
  return true;
}

// ─── Attendance ───────────────────────────────────────────────────────────────
async function syncAttendanceRecord(record) {
  const { localId, synced: _synced, createdAt: _c, ...payload } = record;
  const { error } = await db.from("daily_attendance").upsert(payload, {
    onConflict: "school_id,date",
    ignoreDuplicates: false,
  });
  if (error) throw error;
  return true;
}

async function saveAttendance(record) {
  const localId  = generateLocalId();
  const enriched = { ...record, localId, synced: false, createdAt: new Date().toISOString() };

  if (!isOnline()) {
    await enqueueOutbox({ ...enriched, table: 'attendance_submissions' });
    return { success: true, localId, synced: false };
  }

  try {
    await syncAttendanceRecord(enriched);
    return { success: true, localId, synced: true };
  } catch {
    await enqueueOutbox({ ...enriched, table: 'attendance_submissions' });
    return { success: true, localId, synced: false };
  }
}

function getPendingAttendance() {
  return readQueue(QUEUE_ATTENDANCE).filter((r) => !r.synced);
}

function markAttendanceSynced(localId) {
  const queue = readQueue(QUEUE_ATTENDANCE).map((r) =>
    r.localId === localId ? { ...r, synced: true } : r
  );
  writeQueue(QUEUE_ATTENDANCE, queue);
}

// ─── Reports ──────────────────────────────────────────────────────────────────
async function syncReportRecord(report) {
  const { localId, synced: _synced, receiptNumber: _r, createdAt: _c, ...payload } = report;
  // Upload inline photos to Storage; the row stores only URLs (or data URIs on
  // failure). Runs on both the online path and on offline-queue sync.
  payload.media_urls = await materialisePhotos(payload.media_urls);
  const { data, error } = await db
    .from("emergency_reports")
    .insert(payload)
    .select("id, receipt_number, created_at, status")
    .single();
  if (error) throw error;
  return data;
}

async function submitReport(report) {
  const localId       = generateLocalId();
  const receiptNumber = generateReceiptNumber();
  const enriched = {
    ...report, localId, receiptNumber,
    synced: false, createdAt: new Date().toISOString(), status: "open",
  };

  if (!isOnline()) {
    await enqueueOutbox({ ...enriched, table: 'emergency_reports' });
    return { id: localId, receiptNumber, createdAt: enriched.createdAt, status: "open" };
  }

  try {
    const result = await syncReportRecord(enriched);
    return {
      id: result.id,
      receiptNumber: result.receipt_number,
      createdAt: result.created_at,
      status: result.status,
    };
  } catch {
    await enqueueOutbox({ ...enriched, table: 'emergency_reports' });
    return { id: localId, receiptNumber, createdAt: enriched.createdAt, status: "open" };
  }
}

function getPendingReports() {
  return readQueue(QUEUE_REPORTS).filter((r) => !r.synced);
}

function markReportSynced(localId) {
  const queue = readQueue(QUEUE_REPORTS).map((r) =>
    r.localId === localId ? { ...r, synced: true } : r
  );
  writeQueue(QUEUE_REPORTS, queue);
}

// ─── Directorate ──────────────────────────────────────────────────────────────
async function getReportsForDirectorate(directorateId) {
  const { data, error } = await db
    .from("emergency_reports")
    .select("id, type, description, severity, media_urls, status, receipt_number, created_at, school:schools!inner(id, name)")
    .eq("schools.directorate_id", directorateId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({ ...r, schoolName: r.school?.name ?? "Unknown" }));
}

/* بلاغات المدرسة نفسها ومصيرها.
   كانت المدرسة ترفع البلاغ فترى إيصالاً مرّةً واحدة ثمّ ينقطع الخبر: لا شاشةَ
   تعرض بلاغاتها ولا حالتَها. فإذا استلمت المديريةُ البلاغ أو عالجته، وصل ذلك
   إشعاراً عابراً في الجرس يسقط بعد ثلاثين إشعاراً ولا يُستعاد. RLS يسمح
   لمدير المدرسة بقراءة بلاغات مدرسته، والبيانات كانت متاحةً بلا قارئ. */
async function getReportsForSchool(schoolId, limit = 50) {
  const { data, error } = await db
    .from('emergency_reports')
    /* resolved_by: كان يُكتب ولا يُقرأ — فتعرف المدرسة أنّ بلاغها حُلّ ولا
       تعرف من حلّه، فلا تجد إلى من ترجع إن عاد. الانضمامُ يجلب الاسم لا
       المعرّف: uuid على الشاشة ليس معلومة. */
    .select('id, type, description, severity, status, receipt_number, media_urls, ' +
            'created_at, resolved_at, resolved_by, resolver:resolved_by(full_name), ' +
            'acknowledged_at, acknowledged_by, ack:acknowledged_by(full_name)')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function updateReportStatus(reportId, newStatus) {
  const allowed = ["open", "acknowledged", "resolved"];
  if (!allowed.includes(newStatus)) throw new Error(`Invalid status: ${newStatus}`);

  const patch = { status: newStatus, updated_at: new Date().toISOString() };
  if (newStatus === "resolved") {
    // Record who resolved it and when.
    const { data: auth } = await db.auth.getUser();
    patch.resolved_by = auth?.user?.id ?? null;
    patch.resolved_at = new Date().toISOString();
  } else {
    // Re-opening / acknowledging clears any prior resolution stamp.
    patch.resolved_by = null;
    patch.resolved_at = null;
  }
  /* ختمُ المراجعة (acknowledged_by/at) يضعه الزنادُ t_report_ack_stamp في
     القاعدة لا هنا: الحالة تُبدَّل من مسارين في هذه البوّابة (الجدول والبطاقة)،
     ونسيانُ الختم في أحدهما لا يُرى إلّا حين تسأل مدرسةٌ «مَن راجع بلاغي؟». */

  const { error } = await db
    .from("emergency_reports")
    .update(patch)
    .eq("id", reportId);
  if (error) throw error;
}

async function getTodaySummary(directorateId) {
  const today = localDateISO();

  // مدارس المديرية (نحتاج المعرّفات لفلترة الحضور الفردي)
  const schoolsRes = await db.from("schools")
    .select("id")
    .is("archived_at", null)
    .eq("directorate_id", directorateId);
  if (schoolsRes.error) throw schoolsRes.error;
  const schoolIds = (schoolsRes.data || []).map((s) => s.id);

  const [dsaRes, daRes, reportsRes] = await Promise.all([
    // حضور الطلاب الفردي (المصدر الحقيقي الموحّد مع الوزارة)
    db.from("daily_student_attendance")
      .select("school_id, status")
      .eq("date", today)
      .in("school_id", schoolIds.length ? schoolIds : ["00000000-0000-0000-0000-000000000000"]),
    // دوام الموظفين (معلمون/إداريون/عمال) — من المجمّع daily_attendance
    db.from("daily_attendance")
      .select("school_id, teachers_present, admins_present, workers_present")
      .eq("date", today)
      .in("school_id", schoolIds.length ? schoolIds : ["00000000-0000-0000-0000-000000000000"]),
    // البلاغات المعلّقة (دون تغيير)
    db.from("emergency_reports")
      .select("id, type, status, created_at, school:schools!inner(name, directorate_id)")
      .in("status", ["open", "acknowledged"])
      .eq("schools.directorate_id", directorateId)
      .order("created_at", { ascending: true })
      .limit(5),
  ]);

  if (dsaRes.error)     throw dsaRes.error;
  if (daRes.error)      throw daRes.error;
  if (reportsRes.error) throw reportsRes.error;

  // تجميع الحضور الفردي
  let present = 0, late = 0, absent = 0, excused = 0;
  const reportingSchools = new Set();
  for (const r of dsaRes.data || []) {
    if (r.status === "present")      present++;
    else if (r.status === "late")    late++;
    else if (r.status === "absent")  absent++;
    else if (r.status === "excused") excused++;
    if (r.school_id) reportingSchools.add(r.school_id);
  }
  const attendingStudents = present + late + excused;   // الحاضرون (قرار موحّد)

  return {
    totalTeachersPresent: (daRes.data || []).reduce((s, r) => s + (r.teachers_present || 0), 0),
    totalAdminsPresent:   (daRes.data || []).reduce((s, r) => s + (r.admins_present  || 0), 0),
    totalWorkersPresent:  (daRes.data || []).reduce((s, r) => s + (r.workers_present || 0), 0),
    totalStudentsPresent: attendingStudents,            // الآن حضور طلاب حقيقي
    topPendingReports: (reportsRes.data || []).map((r) => ({
      id: r.id, type: r.type, status: r.status,
      createdAt: r.created_at, schoolName: r.school?.name ?? "Unknown",
    })),
    reportingSchoolsCount: reportingSchools.size,
  };
}

async function getSchoolsAttendanceStatus(directorateId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;

  const schoolsRes = await db.from("schools")
    .select("id, total_students")
    .is("archived_at", null)
    .eq("directorate_id", directorateId);
  if (schoolsRes.error) throw schoolsRes.error;

  const ids = (schoolsRes.data || []).map((s) => s.id);
  const [attendanceRes, reportsRes] = await Promise.all([
    db.from("daily_student_attendance")
      .select("school_id, status")
      .eq("date", isoDate)
      .in("school_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    db.from("emergency_reports")
      .select("school_id")
      .in("status", ["open", "acknowledged"])
      .in("school_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  if (attendanceRes.error) throw attendanceRes.error;
  if (reportsRes.error)    throw reportsRes.error;

  // تجميع الحالات لكل مدرسة من السجل الفردي
  const aggBySchool = {};   // school_id → {present, late, absent, excused}
  for (const r of attendanceRes.data || []) {
    let a = aggBySchool[r.school_id];
    if (!a) a = aggBySchool[r.school_id] = { present: 0, late: 0, absent: 0, excused: 0 };
    if (r.status === "present")      a.present++;
    else if (r.status === "late")    a.late++;
    else if (r.status === "absent")  a.absent++;
    else if (r.status === "excused") a.excused++;
  }
  const activeReportSet = new Set((reportsRes.data || []).map((r) => r.school_id));

  // العتبتان (طريقة ٤)
  const LOW_ATTENDANCE_THRESHOLD = 0.75;  // أقل من 75% حضور = أحمر
  const LOW_COVERAGE_THRESHOLD   = 0.50;  // سُجّل أقل من 50% من الطلاب = تغطية ناقصة (أصفر)

  const result = {};
  for (const school of schoolsRes.data || []) {
    const a = aggBySchool[school.id];

    if (activeReportSet.has(school.id)) {
      result[school.id] = { color: "red", reason: "emergency", attendanceRate: null, coverageRate: null, enrolled: 0 };
      continue;
    }
    if (!a) {
      result[school.id] = { color: "no_data", reason: "no_data", attendanceRate: null, coverageRate: null, enrolled: 0 };
      continue;
    }

    const enrolled  = a.present + a.late + a.absent + a.excused;  // المسجّلون اليوم
    const attending = a.present + a.late + a.excused;             // الحاضرون
    const total     = school.total_students || 0;

    const attendanceRate = enrolled > 0 ? attending / enrolled : 0;
    const coverageRate   = total   > 0 ? enrolled  / total    : 0;

    let color;
    if (attendanceRate < LOW_ATTENDANCE_THRESHOLD) {
      color = "red";                      // حضور منخفض فعلي
    } else if (total > 0 && coverageRate < LOW_COVERAGE_THRESHOLD) {
      color = "amber";                    // حضور جيد لكن تغطية ناقصة
    } else {
      color = "green";                    // حضور جيد + تغطية كافية (أو total غير معروف)
    }

    result[school.id] = {
      color,
      reason: color === "red" ? "low_attendance" : (color === "amber" ? "low_coverage" : "ok"),
      attendanceRate: Math.round(attendanceRate * 100),
      coverageRate:   total > 0 ? Math.round(coverageRate * 100) : null,
      enrolled,
    };
  }
  return result;
}

// التزام آخر N يوم لكل مدرسة في مديرية المستخدم الحالي
// returns [{ school_id, days_reported, reported_today }]
async function getDirectorateCompliance(days = 30) {
  const { data, error } = await db.rpc('get_directorate_compliance', { p_days: days });
  if (error) throw error;
  return data || [];
}

// تذكير مدراء مدرسة لم تُرسل الحضور — يعيد عدد من أُرسل إليهم (0 = أُرسل مؤخراً)
async function sendAttendanceReminder(schoolId) {
  const { data, error } = await db.rpc('send_attendance_reminder', { p_school_id: schoolId });
  if (error) throw error;
  return data ?? 0;
}

// اتجاه حضور مديرية المستخدم الحالي — أيام العمل فقط (الجمعة/السبت مستثناة)
// returns [{ day, present, late, absent, excused, schools_reported }]
async function getDirectorateTrend(days = 14) {
  const { data, error } = await db.rpc('get_directorate_trend', { p_days: days });
  if (error) throw error;
  return data || [];
}

// ── إحصاءات مفصَّلة: الطلاب بالجنس والكادر بالفئة ────────────────────────────
// التجميع في القاعدة لا في المتصفّح: مديريةٌ بمئتَي مدرسة تعني عشرات آلاف
// الصفوف، وسحبُها لتُعدّ هنا يُثقل الشبكة ويُنهك أجهزةً متواضعة.

// صفٌّ لكل مدرسة في مديرية المستدعي.
// [{ school_id, school_name, school_type, students_total, students_male,
//    students_female, students_unknown, staff_teaching, staff_admin,
//    staff_professional, staff_worker, staff_guard }]
async function getDirectorateSchoolStats() {
  const { data, error } = await db.rpc('get_directorate_school_stats');
  if (error) throw error;
  return data || [];
}

// صفٌّ لكل محافظة، وطنياً. للوزارة وحدها.
async function getMinistryGovernorateStats() {
  const { data, error } = await db.rpc('get_ministry_governorate_stats');
  if (error) throw error;
  return data || [];
}

// دليل الكادر بسجلّه المهنيّ الكامل. النطاق يتبع دور المستدعي.
// مُرقَّم إلزاماً — الوزارة تغطّي مئات آلاف الموظّفين — وكل صفٍّ يحمل
// total_count فيُعرَف الإجمالي بلا استعلامٍ ثانٍ.
// → { rows, total }
async function getStaffDirectory({
  schoolId = null, staffType = null, search = null,
  limit = 100, offset = 0, governorate = null,
} = {}) {
  const { data, error } = await db.rpc('get_staff_directory', {
    p_school_id:   schoolId  || null,
    p_staff_type:  staffType || null,
    p_search:      search    || null,
    p_limit:       limit,
    p_offset:      offset,
    // للوزارة وحدها؛ الخادم يتجاهله لغيرها.
    p_governorate: governorate || null,
  });
  if (error) throw error;
  const rows = data || [];
  return { rows, total: rows.length ? Number(rows[0].total_count) : 0 };
}

// نصاب التدريس لكل معلّم: النصاب القانوني والدروس المسندة والفائض.
// النطاق يتبع دور المستدعي (مدرسة / مديرية / وزارة)؛ p_school_id يضيّقه.
// excess = null يعني «نصابٌ غير محدَّد» لا «بلا تجاوز» — والفرق جوهريّ.
async function getTeachingLoad(schoolId = null) {
  const { data, error } = await db.rpc('get_teaching_load', {
    p_school_id: schoolId || null,
  });
  if (error) throw error;
  return data || [];
}

// صفٌّ لكل مدرسة داخل محافظة (أو القُطر كلّه إن كان المعامل فارغاً).
async function getMinistrySchoolStats(governorate = null) {
  const { data, error } = await db.rpc('get_ministry_school_stats', {
    p_governorate: governorate || null,
  });
  if (error) throw error;
  return data || [];
}

// اتجاه حضور مدرسة واحدة (للمديرية المالكة أو الوزارة)
// returns [{ day, present, late, absent, excused }]
async function getSchoolTrend(schoolId, days = 30) {
  const { data, error } = await db.rpc('get_school_trend', { p_school_id: schoolId, p_days: days });
  if (error) throw error;
  return data || [];
}

// ─── Ministry ─────────────────────────────────────────────────────────────────
async function getMinistryAttendanceSummary(date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;

  const { data: directorates, error: dirErr } = await db
    .from("directorates")
    .select("id, name, governorate")
    .order("governorate");
  if (dirErr) throw dirErr;
  if (!directorates || directorates.length === 0) return [];

  const { data: schools, error: schErr } = await db
    .from("schools")
    .select("id, directorate_id")
    .is("archived_at", null);
  if (schErr) throw schErr;

  const allSchoolIds = (schools || []).map(s => s.id);

  const { data: attendance, error: attErr } = await db
    .from("daily_attendance")
    .select("school_id, students_present, teachers_present, admins_present, workers_present")
    .eq("date", isoDate)
    .in("school_id", allSchoolIds.length > 0 ? allSchoolIds : ["00000000-0000-0000-0000-000000000000"]);
  if (attErr) throw attErr;

  const schoolToDir  = {};
  const dirToSchools = {};
  for (const s of schools || []) {
    schoolToDir[s.id] = s.directorate_id;
    if (!dirToSchools[s.directorate_id]) dirToSchools[s.directorate_id] = new Set();
    dirToSchools[s.directorate_id].add(s.id);
  }

  const dirAgg = {};
  for (const d of directorates) {
    dirAgg[d.id] = {
      studentsPresent: 0,
      teachersPresent: 0,
      adminsPresent:   0,
      workersPresent:  0,
      schoolsReported: 0,
      totalSchools:    dirToSchools[d.id]?.size || 0,
    };
  }
  for (const rec of attendance || []) {
    const dirId = schoolToDir[rec.school_id];
    if (dirId && dirAgg[dirId]) {
      dirAgg[dirId].studentsPresent += rec.students_present || 0;
      dirAgg[dirId].teachersPresent += rec.teachers_present || 0;
      dirAgg[dirId].adminsPresent   += rec.admins_present   || 0;
      dirAgg[dirId].workersPresent  += rec.workers_present  || 0;
      dirAgg[dirId].schoolsReported++;
    }
  }

  const govMap = {};
  for (const d of directorates) {
    const gov = d.governorate || "Unknown";
    if (!govMap[gov]) {
      govMap[gov] = {
        governorate:     gov,
        studentsPresent: 0,
        teachersPresent: 0,
        adminsPresent:   0,
        workersPresent:  0,
        schoolsReported: 0,
        totalSchools:    0,
        dirCount:        0,
      };
    }
    const agg = dirAgg[d.id];
    govMap[gov].studentsPresent += agg.studentsPresent;
    govMap[gov].teachersPresent += agg.teachersPresent;
    govMap[gov].adminsPresent   += agg.adminsPresent;
    govMap[gov].workersPresent  += agg.workersPresent;
    govMap[gov].schoolsReported += agg.schoolsReported;
    govMap[gov].totalSchools    += agg.totalSchools;
    govMap[gov].dirCount++;
  }

  return Object.values(govMap).sort((a, b) => a.governorate.localeCompare(b.governorate));
}

async function getGovernoratesCount() {
  const { data, error } = await db
    .from("directorates")
    .select("governorate");
  if (error) throw error;
  const unique = new Set((data || []).map(d => d.governorate).filter(Boolean));
  return unique.size;
}

// ─── Academic year helper ─────────────────────────────────────────────────────
// Mirrors get_academic_year() SQL function.
// Rule: month >= 9 → current-next, else prev-current
function getAcademicYear(date = new Date()) {
  const month = date.getMonth() + 1;
  const year  = date.getFullYear();
  return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

// ─── Arabic grade name ────────────────────────────────────────────────────────
const GRADE_NAMES_AR = {
  1: 'الأول',    2: 'الثاني',    3: 'الثالث',
  4: 'الرابع',   5: 'الخامس',    6: 'السادس',
  7: 'السابع',   8: 'الثامن',    9: 'التاسع',
  10: 'العاشر',  11: 'الحادي عشر', 12: 'الثاني عشر',
};
function gradeNameAr(grade) {
  return GRADE_NAMES_AR[grade] ?? grade.toString();
}

// ─── Teacher: get assigned classes ───────────────────────────────────────────
/* مخبأ صفوف المعلّم — على نمط getCachedStudents الموجود أدناه.
   كان هذا الاستعلام يضرب الشبكة دائماً بلا مخبأ، بينما الطلاب مخبّؤون
   وبيانات المدرسة مخبّأة. فالمعلّم دون اتصال يفشل جلبُه فتُعرَض له «لا توجد
   صفوف مسندة إليك» — وهي كذبة على معلّم له صفوف.
   لا مهلة انتهاء (بخلاف الطلاب): إسناد الصفوف يتغيّر مرّة في الفصل لا يومياً،
   ومخبأ عمره أسبوع أصدق بكثير من قائمة فارغة. البادئة في TENANT_CACHE_PREFIXES
   فتُمحى عند الخروج ولا يرى معلّم صفوف زميله على جهاز مشترك. */
const CLASSES_CACHE_PFX = 'nsams_classes_';

function getCachedTeacherClasses(teacherId, year) {
  try {
    const raw = localStorage.getItem(`${CLASSES_CACHE_PFX}${teacherId}_${year}`);
    if (!raw) return null;
    const { data } = JSON.parse(raw);
    return Array.isArray(data) ? data : null;
  } catch { return null; }
}

function setCachedTeacherClasses(teacherId, year, data) {
  try {
    localStorage.setItem(`${CLASSES_CACHE_PFX}${teacherId}_${year}`,
                         JSON.stringify({ ts: Date.now(), data }));
  } catch { /* حصة التخزين ممتلئة — غير قاتل */ }
}

/* يرمي `NoCachedClassesError` حين يفشل الجلب ولا مخبأ — كي تميّز الواجهة
   «تعذّر التحميل» عن «صفر صفوف فعلاً» بدل خلطهما في رسالة واحدة. */
class NoCachedClassesError extends Error {
  // message اختيارية: يستعملها من يقرأ شيئاً غير «الصفوف» (كشوف اليوم مثلاً)
  // كي لا تُعرَض له رسالةٌ عن الصفوف. المستدعون القدامى يمرّرون cause وحدها.
  constructor(cause, message) {
    super(message || 'تعذّر تحميل الصفوف ولا توجد نسخة محفوظة على هذا الجهاز.');
    this.name = 'NoCachedClassesError';
    this.cause = cause;
  }
}

async function getTeacherClasses(teacherId) {
  const academicYear = getAcademicYear();

  // دون اتصال: لا تُهدَر ثوانٍ في مهلة شبكة محكومة بالفشل — اقرأ المخبأ فوراً.
  if (!navigator.onLine) {
    const hit = getCachedTeacherClasses(teacherId, academicYear);
    if (hit) return hit;
  }

  let data;
  try {
    // withTimeout: على شبكة «متصلة لكن ميتة» (navigator.onLine=true) لا يتعلّق
    // الجلب إلى ما لا نهاية — يسقط للمخبأ بعد المهلة كأنّنا دون اتصال.
    const res = await withTimeout(
      db.from('class_teacher')
        .select(`
          class_id, role, subject_ids,
          classes:class_id (
            id, grade, section, school_id,
            schools:school_id ( name, work_start_time )
          )
        `)
        .eq('teacher_id',    teacherId)
        .eq('academic_year', academicYear),
      OFFLINE_READ_TIMEOUT_MS,
    );
    if (res.error) throw res.error;
    data = res.data;
  } catch (err) {
    const hit = getCachedTeacherClasses(teacherId, academicYear);
    if (hit) { console.warn('[Ruqi] صفوف المعلّم من المخبأ', err); return hit; }
    throw new NoCachedClassesError(err);
  }

  const mapped = (data || []).map(row => {
    const c = row.classes;
    return {
      id:          c.id,
      grade:       c.grade,
      section:     c.section,
      schoolId:    c.school_id,
      schoolName:  c.schools?.name ?? '',
      workStartTime: c.schools?.work_start_time ?? null,
      role:        row.role ?? 'homeroom',
      subjectIds:  Array.isArray(row.subject_ids) ? row.subject_ids : [],
      academicYear,
      displayName: `الصف ${gradeNameAr(c.grade)} / شعبة ${c.section}`,
    };
  });

  setCachedTeacherClasses(teacherId, academicYear, mapped);
  return mapped;
}

// ─── Student cache (24-hour TTL) ─────────────────────────────────────────────
const STUDENTS_CACHE_PFX = 'nsams_stu_';
const STUDENTS_CACHE_TTL = 24 * 60 * 60 * 1000;

function getCachedStudents(classId) {
  try {
    const raw = localStorage.getItem(STUDENTS_CACHE_PFX + classId);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    return (Date.now() - ts < STUDENTS_CACHE_TTL) ? data : null;
  } catch { return null; }
}

function setCachedStudents(classId, data) {
  try {
    localStorage.setItem(
      STUDENTS_CACHE_PFX + classId,
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch { /* storage quota — non-fatal */ }
}

function clearCachedStudents(classId) {
  if (!classId) return;
  try { localStorage.removeItem(STUDENTS_CACHE_PFX + classId); } catch { /* non-fatal */ }
}

// ─── Teacher: get students for a class ───────────────────────────────────────
async function getClassStudents(classId, { status } = {}) {
  // Default (active roster) — the offline-cached hot path used by the teacher
  // app. status='active' ⇔ is_active=true (kept in sync by t_sync_student_is_active),
  // so the legacy is_active filter and the cache stay valid unchanged.
  if (!status || status === 'active') {
    if (!isOnline()) {
      const cached = getCachedStudents(classId);
      if (cached) return cached;
      throw new Error('لا يوجد اتصال ولا توجد بيانات محفوظة لهذا الصف');
    }
    // select('*') (not an explicit column list) so the new SIS columns are
    // included once the migration runs, while staying safe if it hasn't yet —
    // same rationale as getSchoolById. Existing consumers keep reading
    // full_name / national_id / gender / seat_number unchanged.
    try {
      // withTimeout + سقوط للمخبأ: على شبكة «متصلة لكن ميتة» (navigator.onLine=
      // true) لا يتعلّق الجلب، بل يعود للطلاب المخبّأين بعد المهلة.
      const { data, error } = await withTimeout(
        db.from('students')
          .select('*')
          .eq('class_id',  classId)
          .eq('is_active', true)
          .order('seat_number', { ascending: true,  nullsFirst: false })
          .order('full_name',   { ascending: true }),
        OFFLINE_READ_TIMEOUT_MS,
      );
      if (error) throw error;
      const students = data ?? [];
      setCachedStudents(classId, students);
      return students;
    } catch (err) {
      const cached = getCachedStudents(classId);
      if (cached) { console.warn('[Ruqi] طلاب الصفّ من المخبأ', err); return cached; }
      throw err;
    }
  }

  // Explicit lifecycle status (school-admin status tabs) — online, uncached.
  // status='all' returns every status; otherwise filter on the enum directly.
  if (!isOnline()) throw new Error('عرض حالات الطلاب يتطلّب اتصالاً بالإنترنت');
  let q = db.from('students').select('*').eq('class_id', classId);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q
    .order('seat_number', { ascending: true, nullsFirst: false })
    .order('full_name',   { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ─── Student records (SIS): create / edit / transfer / archive ───────────────
// Offline-first, mirroring saveStudentAttendance: every mutation is wrapped in
// a queue item synced by syncStudentRecord (online path + syncPendingV2). Each
// item carries an audit payload written (best-effort) to audit_log on sync.

// camelCase student object (from the form) → snake_case students row.
function studentRowFromInput(p) {
  const fullName = [p.firstName, p.fatherName, p.familyName]
    .map(s => (s ?? '').trim()).filter(Boolean).join(' ');
  return {
    id:               p.id,
    school_id:        p.schoolId,
    class_id:         p.classId ?? null,
    first_name:       (p.firstName  ?? '').trim() || null,
    father_name:      (p.fatherName ?? '').trim() || null,
    family_name:      (p.familyName ?? '').trim() || null,
    full_name:        fullName,
    gender:           p.gender || null,
    birth_date:       p.birthDate || null,
    national_id:      (p.nationalId ?? '').trim() || null,
    seat_number:      p.seatNumber === '' || p.seatNumber == null ? null : Number(p.seatNumber),
    mother_name:      (p.motherName     ?? '').trim() || null,
    mother_family:    (p.motherFamily   ?? '').trim() || null,
    grandfather_name: (p.grandfatherName?? '').trim() || null,
    card_number:      (p.cardNumber     ?? '').trim() || null,
    birth_place:      (p.birthPlace     ?? '').trim() || null,
    contact_phone:    (p.contactPhone   ?? '').trim() || null,
    // Mirror the contact phone into parent_phone (normalised to +9639…) so the
    // parent portal can link the student — parent-auth matches on parent_phone.
    parent_phone:     _normalizePhone(p.contactPhone) || null,
    res_governorate:  (p.resGovernorate ?? '').trim() || null,
    res_region:       (p.resRegion      ?? '').trim() || null,
    res_subdistrict:  (p.resSubdistrict ?? '').trim() || null,
    res_town:         (p.resTown        ?? '').trim() || null,
    res_sector:       (p.resSector      ?? '').trim() || null,
    res_block:        (p.resBlock       ?? '').trim() || null,
    res_record:       (p.resRecord      ?? '').trim() || null,
    is_active:        p.isActive !== false,
    recorded_by:      p.actorId ?? null,
    updated_at:       new Date().toISOString(),
  };
}

function newStudentId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID() : generateLocalId();
}

// Best-effort audit write (online direct path + sync path). Never throws —
// auditing must not block or fail a mutation the user already committed.
async function writeAudit({ schoolId, entity, entityId, action, changes = null, reason = null, actorId = null }) {
  try {
    if (!isOnline()) return false;
    const { error } = await db.from('audit_log').insert({
      school_id: schoolId, actor_id: actorId, entity,
      entity_id: entityId, action, changes, reason,
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('[Ruqi] writeAudit failed (non-fatal)', e);
    return false;
  }
}

// Core sync — runs the actual DB mutation for one queued student item, then
// records the audit row. Called on the online path and by syncPendingV2.
async function syncStudentRecord(item) {
  if (item.op === 'save') {
    const { error } = await db.from('students')
      .upsert(item.row, { onConflict: 'id', ignoreDuplicates: false });
    if (error) throw error;
  } else if (item.op === 'archive') {
    const { error } = await db.from('students')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (error) throw error;
  } else if (item.op === 'transfer') {
    const { error } = await db.from('students')
      .update({ class_id: item.classId, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (error) throw error;
  } else if (item.op === 'status') {
    // Lifecycle status change. is_active + status_changed_at are derived by the
    // t_sync_student_is_active trigger; we only write status + reason here.
    const { error } = await db.from('students')
      .update({ status: item.status, status_reason: item.reason ?? null,
                updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (error) throw error;
  }
  if (item.audit) await writeAudit(item.audit);
  return true;
}

function getPendingStudents() {
  return readQueue(QUEUE_STUDENTS).filter(r => !r.synced);
}

function markStudentSynced(localId) {
  writeQueue(QUEUE_STUDENTS, readQueue(QUEUE_STUDENTS).map(r =>
    r.localId === localId ? { ...r, synced: true } : r));
}

// Shared offline-or-sync path for a single student mutation item.
async function enqueueOrSyncStudent(item) {
  [item.classId, item.fromClassId].forEach(clearCachedStudents);

  if (!isOnline()) {
    await enqueueOutbox({ ...item, table: 'students' });
    return { success: true, id: item.id, synced: false };
  }
  try {
    await syncStudentRecord(item);
    return { success: true, id: item.id, synced: true };
  } catch (err) {
    /* ⚠ الطابور للانقطاع لا للرفض.
       كان كلُّ خطأٍ يُصفّ ويُقال للمستخدم «سيُحدَّث عند الاتصال» — وهو متّصل،
       والخادمُ رفض العملية رفضاً دائماً (قيدٌ أو صلاحية أو زنادٌ معطوب). فتُعاد
       المحاولة عند كل مزامنة وتفشل أبداً، والمستخدم يظنّها محفوظةً تنتظر شبكة.
       وقد حجب هذا انحداراً حقيقياً: زنادُ إشعار حالة الطالب كان يرفض كلَّ
       تحويلِ حالة، والشاشةُ تقول «سيُحدَّث عند الاتصال» بدل أن تُظهر الخطأ.

       فالطابورُ الآن لأخطاء الشبكة وحدها؛ ورفضُ الخادم يُرمى إلى المُنادي
       ليعرضه للمستخدم كما هو. */
    if (!isNetworkError(err)) {
      console.error('[Ruqi] student write rejected by server', err);
      throw err;
    }
    await enqueueOutbox({ ...item, table: 'students' });
    console.warn('[Ruqi] student write queued (network)', err);
    return { success: true, id: item.id, synced: false };
  }
}

// Create or update one student. `input.id` present ⇒ update, absent ⇒ create.
async function saveStudent(input) {
  const isCreate = !input.id;
  const id  = input.id || newStudentId();
  const row = studentRowFromInput({ ...input, id });
  const item = {
    localId: generateLocalId(), op: 'save', id, classId: row.class_id,
    row,
    audit: {
      schoolId: row.school_id, entity: 'student', entityId: id,
      action: isCreate ? 'create' : 'update', changes: row,
      reason: input.reason ?? null, actorId: input.actorId ?? null,
    },
    synced: false, createdAt: new Date().toISOString(),
  };
  return enqueueOrSyncStudent(item);
}

// Lifecycle status change (نشط/منقول/خارج السنة/متخرّج/مرقّن القيد). Offline-first,
// mirroring archive/transfer. The DB trigger derives is_active + status_changed_at;
// graduated→* is rejected server-side by t_validate_student_status.
async function setStudentStatus({ id, schoolId, classId, newStatus, reason, actorId }) {
  const item = {
    localId: generateLocalId(), op: 'status', id, classId,
    status: newStatus, reason: reason ?? null,
    audit: { schoolId, entity: 'student', entityId: id, action: 'status_change',
             changes: { status: newStatus }, reason: reason ?? null, actorId: actorId ?? null },
    synced: false, createdAt: new Date().toISOString(),
  };
  return enqueueOrSyncStudent(item);
}

// Soft-delete (never a hard DELETE) — keeps history & references intact.
// «أرشفة» now maps to the 'transferred' lifecycle status (left the school).
async function archiveStudent({ id, schoolId, classId, reason, actorId }) {
  return setStudentStatus({ id, schoolId, classId, newStatus: 'transferred', reason, actorId });
}

// Move a student to another class/section (the official «نقل طالب»).
async function transferStudent({ id, schoolId, fromClassId, toClassId, reason, actorId }) {
  const item = {
    localId: generateLocalId(), op: 'transfer', id,
    classId: toClassId, fromClassId,
    audit: { schoolId, entity: 'student', entityId: id, action: 'transfer',
             changes: { from: fromClassId, to: toClassId },
             reason: reason ?? null, actorId: actorId ?? null },
    synced: false, createdAt: new Date().toISOString(),
  };
  return enqueueOrSyncStudent(item);
}

// Duplicate guard: is there an active student with this national_id in the
// school? Backs the unique partial index; surfaced in the form & bulk import.
async function findDuplicateStudent(schoolId, nationalId, excludeId = null) {
  const nid = (nationalId ?? '').trim();
  if (!nid) return null;
  let q = db.from('students')
    .select('id, full_name, class_id')
    .eq('school_id', schoolId).eq('national_id', nid).eq('is_active', true);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q.limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

// Bulk import a parsed/validated batch of students into one class. Requires a
// connection (large op). Inserts row-by-row so one bad row can't drop the rest;
// returns a per-row summary for the preview UI.
async function bulkImportStudents({ schoolId, classId, rows, actorId }) {
  if (!isOnline()) throw new Error('الاستيراد الجماعي يتطلّب اتصالاً بالإنترنت.');
  const summary = { inserted: 0, duplicate: 0, failed: [] };
  for (let i = 0; i < rows.length; i++) {
    const input = rows[i];
    try {
      const dup = await findDuplicateStudent(schoolId, input.nationalId);
      if (dup) { summary.duplicate++; continue; }
      const id  = newStudentId();
      const row = studentRowFromInput({ ...input, id, schoolId, classId, actorId });
      const { error } = await db.from('students').insert(row);
      if (error) throw error;
      summary.inserted++;
    } catch (err) {
      summary.failed.push({ line: i + 1, name: input.firstName || input.fullName || '—',
                            error: err?.message || 'خطأ' });
    }
  }
  clearCachedStudents(classId);
  if (summary.inserted > 0) {
    await writeAudit({ schoolId, entity: 'student', entityId: null,
      action: 'bulk_import', changes: { class_id: classId, count: summary.inserted },
      reason: null, actorId });
  }
  return summary;
}

// ─── Teacher: check submission status for a class + date ─────────────────────
/* ⚠️ مخبأ مؤرَّخ لهاتين القراءتين، وهو إصلاح عطلين لا عطل واحد.
   كانتا بلا مهلة ولا مخبأ وترميان عند أوّل فشل، وتُقرآن في Promise.all واحد مع
   الطلاب — فرفضُ أيّهما دون اتصال كان يُسقط كشفَ الأسماء المخبّأ معهما، فلا
   يستطيع المعلّم فتح صفٍّ لأخذ الحضور أوفلاين إطلاقاً رغم أنّ كلّ بنية
   المسودّات والـoutbox مبنيّة لذلك.
   والأخطر: بلا مخبأٍ يُفتَح الصفُّ على «الكل حاضر» افتراضاً لمعلّمٍ سبق أن
   أرسل كشفه، فإن أعاد الإرسال محا غيابات اليوم — الكتابة upsert على
   (student_id,date) فتستبدل ولا تُضيف.
   ولأنّهما لم تعودا ترميان، صار الفشل الوحيد الممكن هو فشلُ الطلاب — وهو
   الوحيد الذي يستحقّ إسقاط الشاشة.
   التاريخ داخل القيمة لا في المفتاح: مدخلة واحدة لكل صفّ مهما طال الاستعمال. */
const CLASS_SUB_CACHE_PFX = 'nsams_csub_';   // حالة كشف الصفّ لليوم
const CLASS_ATT_CACHE_PFX = 'nsams_catt_';   // خريطة حضور الصفّ لليوم

async function getClassSubmissionStatus(classId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;
  const key     = CLASS_SUB_CACHE_PFX + classId;

  if (!isOnline()) return _readDatedCache(key, isoDate); // null = لم يُرسل بعد

  try {
    const { data, error } = await withTimeout(
      db.from('attendance_submissions')
        .select('id, status, submitted_at, confirmed_by, confirmed_at, notes')
        .eq('class_id', classId)
        .eq('date',     isoDate)
        .maybeSingle(),
      OFFLINE_READ_TIMEOUT_MS,
    );
    if (error) throw error;
    _writeDatedCache(key, isoDate, data ?? null);
    return data; // null = not yet submitted
  } catch (err) {
    console.warn('[Ruqi] حالة الكشف من المخبأ', err);
    return _readDatedCache(key, isoDate);
  }
}

// ─── Teacher: load existing attendance records for a class + date ─────────────
// Returns an object: { [student_id]: { status, reason } }
async function getClassAttendanceForDate(classId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;
  const key     = CLASS_ATT_CACHE_PFX + classId;

  if (!isOnline()) return _readDatedCache(key, isoDate) ?? {};

  try {
    const { data, error } = await withTimeout(
      db.from('daily_student_attendance')
        .select('student_id, status, reason')
        .eq('class_id', classId)
        .eq('date',     isoDate),
      OFFLINE_READ_TIMEOUT_MS,
    );
    if (error) throw error;

    const map = {};
    for (const row of data ?? []) {
      map[row.student_id] = { status: row.status, reason: row.reason ?? null };
    }
    _writeDatedCache(key, isoDate, map);
    return map;
  } catch (err) {
    console.warn('[Ruqi] حضور الصفّ من المخبأ', err);
    return _readDatedCache(key, isoDate) ?? {};
  }
}

// ─── Teacher: get attendance report for printing ──────────────────────────────
async function getClassAttendanceReport(classId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;

  const { data, error } = await db
    .from('daily_student_attendance')
    .select(`
      status, reason,
      students:student_id ( full_name, seat_number )
    `)
    .eq('class_id', classId)
    .eq('date',     isoDate);

  if (error) throw error;

  // Sort by seat number in JS (Postgrest can't order by an embedded column).
  return (data ?? []).sort(
    (a, b) => (a.students?.seat_number ?? 999) - (b.students?.seat_number ?? 999)
  );
}

// ─── Teacher: absence log (per class, current academic year) ─────────────────
// Calls the get_class_absence_log RPC. Returns one row per student who has at
// least one absent/excused day this academic year, with counts. 'late' excluded.
// The RPC enforces that the caller teaches the class.
async function getClassAbsenceLog(classId) {
  const { data, error } = await db.rpc('get_class_absence_log', { p_class_id: classId });
  if (error) throw error;
  return (data ?? []).map(r => ({
    studentId:     r.student_id,
    fullName:      r.full_name,
    seatNumber:    r.seat_number,
    absentCount:   Number(r.absent_count)  || 0,
    excusedCount:  Number(r.excused_count) || 0,
  }));
}

// ─── School admin: cumulative absence summary for a class (this academic year) ─
// Computed CLIENT-SIDE from daily_student_attendance instead of the teacher-only
// get_class_absence_log RPC, so it runs under the dsa_read policy for a
// school_admin. Returns a map: { [studentId]: { absent, excused } } (counts of
// absent / excused days this academic year; 'present' and 'late' are ignored).
async function getClassAbsenceSummary(classId) {
  const startYear = getAcademicYear().split('-')[0];   // "2025-2026" -> "2025"
  const startISO  = `${startYear}-09-01`;

  const { data, error } = await db
    .from('daily_student_attendance')
    .select('student_id, status, date')
    .eq('class_id', classId)
    .gte('date', startISO);

  if (error) throw error;

  const map = {};
  for (const row of data ?? []) {
    if (row.status !== 'absent' && row.status !== 'excused') continue;
    const e = map[row.student_id] || (map[row.student_id] = { absent: 0, excused: 0 });
    if (row.status === 'absent')  e.absent++;
    else                          e.excused++;
  }
  return map;
}

// ─── School admin: class ↔ teacher management ────────────────────────────────
// All of these rely on the existing RLS policy school_admin_all_class_teacher
// (FOR ALL, class_belongs_to_my_school) and the schools/classes read policies.

/* مخبأ أوفلاين للصفوف والكادر — نفس فلسفة getTeacherClasses: التوزيع يتغيّر مرّة
   كل فصل لا يومياً، فمخبأٌ بلا TTL أصدق بكثير من قائمة فارغة دون اتصال. كانت هذه
   الدوال تضرب الشبكة دائماً بلا مخبأ ولا مهلة، فبوّابة المدير أوفلاين تُظهر
   «صفوف/شعب» فارغة أو تتجمّد على شبكة ميتة. البادئات في TENANT_CACHE_PREFIXES
   لتُمحى عند الخروج (تحوي أسماء الكادر). */
const SCHOOL_CLASSES_CACHE_PFX  = 'nsams_sclasses_';
const SCHOOL_TEACHERS_CACHE_PFX = 'nsams_steachers_';
const CLASS_TEACHERS_CACHE_PFX  = 'nsams_cteachers_';
const SCHOOL_SUMMARY_CACHE_PFX  = 'nsams_ssum_';   // كشوف اليوم لكل صفّ

function _readJSONCache(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function _writeJSONCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* حصة التخزين ممتلئة */ }
}

/* مخبأ مؤرَّخ لبياناتٍ تخصّ يوماً بعينه. مفتاحٌ واحدٌ للمدرسة يحمل تاريخه معه،
   فيتحقّق أمران معاً: لا يقرأ يومٌ بياناتِ يومٍ آخر، ولا تتراكم المدخلات بعدد
   الأيام حتى تمتلئ حصّة التخزين. عدم التطابق يعني «لا نسخة» لا «نسخة قديمة». */
function _readDatedCache(key, isoDate) {
  const hit = _readJSONCache(key);
  return (hit && hit.date === isoDate) ? hit.data : null;
}
function _writeDatedCache(key, isoDate, data) {
  _writeJSONCache(key, { date: isoDate, data });
}

// All classes in a school (for the management dropdown).
async function getSchoolClasses(schoolId) {
  const key = SCHOOL_CLASSES_CACHE_PFX + schoolId;
  if (!isOnline()) {
    const hit = _readJSONCache(key);
    if (hit) return hit;
  }
  let data;
  try {
    const res = await withTimeout(
      db.from('classes')
        .select('id, name, grade, section')
        .eq('school_id', schoolId)
        .order('grade', { ascending: true })
        .order('section', { ascending: true }),
      OFFLINE_READ_TIMEOUT_MS,
    );
    if (res.error) throw res.error;
    data = res.data;
  } catch (err) {
    const hit = _readJSONCache(key);
    if (hit) { console.warn('[Ruqi] صفوف المدرسة من المخبأ', err); return hit; }
    throw new NoCachedClassesError(err);
  }
  const mapped = (data ?? []).map(c => ({
    id:      c.id,
    name:    c.name,
    grade:   c.grade,
    section: c.section,
  }));
  _writeJSONCache(key, mapped);
  return mapped;
}

// Teachers belonging to a school. If excludeClassId is given, teachers already
// assigned to that class (this academic year) are filtered OUT, so the "assign"
// dropdown only shows teachers not yet on the class.
async function getTeachersBySchool(schoolId, excludeClassId = null) {
  const key = SCHOOL_TEACHERS_CACHE_PFX + schoolId;
  let teachers = null;
  if (!isOnline()) {
    const hit = _readJSONCache(key);
    if (hit) teachers = hit;
  }
  if (!teachers) {
    try {
      const res = await withTimeout(
        db.from('users')
          .select('id, full_name')
          .eq('role', 'teacher')
          .eq('school_id', schoolId)
          .order('full_name', { ascending: true }),
        OFFLINE_READ_TIMEOUT_MS,
      );
      if (res.error) throw res.error;
      teachers = (res.data ?? []).map(t => ({ id: t.id, fullName: t.full_name }));
      _writeJSONCache(key, teachers);
    } catch (err) {
      const hit = _readJSONCache(key);
      if (hit) { console.warn('[Ruqi] كادر المدرسة من المخبأ', err); teachers = hit; }
      else throw err;
    }
  }

  if (excludeClassId) {
    const assigned = await getClassTeachers(excludeClassId);
    const assignedIds = new Set(assigned.map(a => a.teacherId));
    teachers = teachers.filter(t => !assignedIds.has(t.id));
  }
  return teachers;
}

// Teachers currently assigned to a class (this academic year), each with their
// role (homeroom/supervisor/subject) and the subjects they may grade.
async function getClassTeachers(classId) {
  const year = getAcademicYear();
  const key  = CLASS_TEACHERS_CACHE_PFX + classId + '_' + year;

  if (!isOnline()) {
    const hit = _readJSONCache(key);
    if (hit) return hit;
  }

  let data;
  try {
    const res = await withTimeout(
      db.from('class_teacher')
        .select('id, teacher_id, role, subject_ids, teacher:users!class_teacher_teacher_id_fkey(full_name)')
        .eq('class_id', classId)
        .eq('academic_year', year),
      OFFLINE_READ_TIMEOUT_MS,
    );
    if (res.error) throw res.error;
    data = res.data;
  } catch (err) {
    const hit = _readJSONCache(key);
    if (hit) { console.warn('[Ruqi] معلّمو الصفّ من المخبأ', err); return hit; }
    throw err;
  }

  // Resolve subject ids → names for display (subjects are per grade). Best-effort,
  // and skipped entirely offline so a dead network never stalls the assignment list.
  let nameById = {};
  if (isOnline()) {
    try {
      const { data: cls } = await withTimeout(
        db.from('classes').select('grade, school_id').eq('id', classId).single(),
        OFFLINE_READ_TIMEOUT_MS,
      );
      if (cls) {
        const subs = await getSchoolSubjects(cls.school_id, cls.grade);
        nameById = Object.fromEntries(subs.map(s => [s.id, s.name]));
      }
    } catch { /* names are best-effort */ }
  }

  const mapped = (data ?? []).map(r => {
    const subjectIds = Array.isArray(r.subject_ids) ? r.subject_ids : [];
    return {
      assignmentId: r.id,
      teacherId:    r.teacher_id,
      role:         r.role ?? 'homeroom',
      subjectIds,
      subjectNames: subjectIds.map(id => nameById[id]).filter(Boolean),
      fullName:     r.teacher?.full_name ?? '—',
    };
  });
  _writeJSONCache(key, mapped);
  return mapped;
}

// Assign a teacher to a class for the current academic year with a role and the
// subjects they may grade (supervisors carry no subjects).
async function assignTeacherToClass(classId, teacherId, { role = 'homeroom', subjectIds = [] } = {}) {
  const year = getAcademicYear();
  const { error } = await db
    .from('class_teacher')
    .insert({
      class_id:      classId,
      teacher_id:    teacherId,
      academic_year: year,
      role,
      subject_ids:   role === 'supervisor' ? [] : (subjectIds || []),
    });
  if (error) throw error;
  return true;
}

// Remove a teacher from a class (current academic year).
async function removeTeacherFromClass(classId, teacherId) {
  const year = getAcademicYear();
  const { error } = await db
    .from('class_teacher')
    .delete()
    .eq('class_id', classId)
    .eq('teacher_id', teacherId)
    .eq('academic_year', year);
  if (error) throw error;
  return true;
}

// Is there any student-attendance row for this class dated TODAY (local date)?
// Used to block removing a teacher from a class that already has today's records.
async function hasTodayAttendance(classId) {
  const today = localDateISO();
  const { count, error } = await db
    .from('daily_student_attendance')
    .select('id', { count: 'exact', head: true })
    .eq('class_id', classId)
    .eq('date', today);
  if (error) throw error;
  return (count ?? 0) > 0;
}

// ─── Student attendance offline queue ────────────────────────────────────────
function getPendingStudentAttendance() {
  return readQueue(QUEUE_STU_ATT).filter(r => !r.synced);
}

function markStudentAttSynced(localId) {
  const queue = readQueue(QUEUE_STU_ATT).map(r =>
    r.localId === localId ? { ...r, synced: true } : r
  );
  writeQueue(QUEUE_STU_ATT, queue);
}

// Core sync function – called both directly (online path) and by syncPendingV2.
async function syncStudentAttendanceRecord(payload) {
  const { records, classId, schoolId, date, teacherId } = payload;

  const rows = records.map(r => ({
    student_id:  r.studentId,
    class_id:    classId,
    school_id:   schoolId,
    date,
    status:      r.status,
    reason:      r.reason ?? null,
    recorded_by: teacherId,
  }));

  const { error: attErr } = await db
    .from('daily_student_attendance')
    .upsert(rows, { onConflict: 'student_id,date', ignoreDuplicates: false });

  if (attErr) throw attErr;

  const { error: subErr } = await db
    .from('attendance_submissions')
    .upsert(
      {
        class_id:     classId,
        school_id:    schoolId,
        date,
        submitted_by: teacherId,
        submitted_at: new Date().toISOString(),
        status:       'pending',
      },
      { onConflict: 'class_id,date', ignoreDuplicates: false }
    );

  if (subErr) throw subErr;
  return true;
}

async function saveStudentAttendance({ records, classId, schoolId, date, teacherId }) {
  const localId = generateLocalId();
  const payload = {
    localId, records, classId, schoolId, date, teacherId,
    synced: false, createdAt: new Date().toISOString(),
  };

  if (!isOnline()) {
    await enqueueOutbox({ ...payload, table: 'daily_student_attendance' });
    return { success: true, localId, synced: false };
  }

  try {
    await syncStudentAttendanceRecord(payload);
    return { success: true, localId, synced: true };
  } catch (err) {
    await enqueueOutbox({ ...payload, table: 'daily_student_attendance' });
    console.warn('[Ruqi] saveStudentAttendance: falling back to queue', err);
    return { success: true, localId, synced: false };
  }
}

// ─── Staff attendance (دوام الموظفين) ─────────────────────────────────────────
// Three categories roll up to the directorate/ministry: teachers (self check-in,
// "trust but verify"), admins and workers (no app login → recorded by the
// manager). The teacher's self-recorded time is kept as `check_in_original`; a
// manager correction lands in `check_in_adjusted`. Penalties are deliberately
// out of scope for now — the schema only measures (status + lateness).

function parseTimeToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Minutes a check-in is past the school's work-start time (0 if on time/early).
function computeLateMinutes(checkInISO, workStartTime) {
  if (!checkInISO) return null;
  const start = parseTimeToMinutes(workStartTime || DEFAULT_WORK_START);
  const d = new Date(checkInISO);
  const mins = d.getHours() * 60 + d.getMinutes();
  return Math.max(0, mins - start);
}

function staffStatusForLate(lateMinutes) {
  return lateMinutes && lateMinutes > 0 ? 'late' : 'present';
}

// ── Personnel roster (admins / workers — no app login) ──
/* ورقةٌ يعتمد عليها تبويبان (الكادر، وإعدادات المدرسة) عبر
   getStaffAttendanceForDate و getFullStaffRoster — فتخبئتُها تُفيد الثلاثة.
   نفس نمط getSchoolClasses المثبت: أوفلاين اقرأ فوراً، وأونلاين اجلب بمهلة
   واسقط للمخبأ عند الفشل. القائمة مستقرّة (كادر المدرسة لا يتغيّر يومياً)
   فلا تحتاج تأريخاً، بخلاف كشوف اليوم. */
const SCHOOL_PERSONNEL_CACHE_PFX = 'nsams_spers_';

async function getSchoolPersonnel(schoolId) {
  const key = SCHOOL_PERSONNEL_CACHE_PFX + schoolId;
  if (!isOnline()) {
    const hit = _readJSONCache(key);
    if (hit) return hit;
  }
  let data;
  try {
    const res = await withTimeout(
      db.from('school_personnel')
        .select('id, full_name, kind, national_id, is_active, staff_record_id')
        .eq('school_id', schoolId)
        .order('kind', { ascending: true })
        .order('full_name', { ascending: true }),
      OFFLINE_READ_TIMEOUT_MS,
    );
    if (res.error) throw res.error;
    data = res.data;
  } catch (err) {
    const hit = _readJSONCache(key);
    if (hit) { console.warn('[Ruqi] كادر المدرسة (سجلّ) من المخبأ', err); return hit; }
    throw err;
  }
  const mapped = (data ?? []).map(p => ({
    id: p.id, fullName: p.full_name, kind: p.kind,
    nationalId: p.national_id ?? null, isActive: p.is_active !== false,
    staffRecordId: p.staff_record_id ?? null,
  }));
  _writeJSONCache(key, mapped);
  return mapped;
}

async function addPersonnel({ schoolId, fullName, kind, nationalId = null }) {
  const { data, error } = await db
    .from('school_personnel')
    .insert({ school_id: schoolId, full_name: fullName, kind, national_id: nationalId })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function updatePersonnel(id, patch) {
  const row = {};
  if (patch.fullName   !== undefined) row.full_name   = patch.fullName;
  if (patch.kind       !== undefined) row.kind        = patch.kind;
  if (patch.nationalId !== undefined) row.national_id = patch.nationalId;
  if (patch.isActive   !== undefined) row.is_active   = patch.isActive;
  if (Object.keys(row).length === 0) return true;
  const { error } = await db.from('school_personnel').update(row).eq('id', id);
  if (error) throw error;
  return true;
}

function setPersonnelActive(id, active) {
  return updatePersonnel(id, { isActive: active });
}

// ── مرآة سجلّ الكوادر في كشف الدوام ──────────────────────────────────────────
// staff_records هو السجلّ الكامل (يقوم عليه البيان الشهري)، و school_personnel هو
// هويّة الدوام (staff_attendance.personnel_id يشير إليه). كانا منفصلين تماماً،
// فمن يُضاف في «الكوادر» لا يظهر في كشف الدوام إطلاقاً. هذه الدالة تُبقيهما
// متطابقَين في اتجاه واحد: الكوادر ← الكادر.
//
// قيد kind في القاعدة ('admin','worker') يبقى كما هو — المهني والحارس والمستخدم
// كلّهم 'worker' في الدوام، والتمييز بينهم يبقى في staff_records للبيان.
const STAFF_TYPE_TO_PERSONNEL_KIND = {
  admin: 'admin', professional: 'worker', worker: 'worker', guard: 'worker',
};

async function syncPersonnelFromStaffRecord({ staffRecordId, schoolId, fullName, staffType, nationalId = null }) {
  if (!staffRecordId || !schoolId) return null;

  // المعلّمون هويّتهم في users لا في school_personnel — فلا مرآة لهم. ولو تحوّل
  // سجلّ من فئة أخرى إلى «تدريسي» تُلغى مرآته بدل أن تبقى شبحاً في كشف الدوام.
  const kind = STAFF_TYPE_TO_PERSONNEL_KIND[staffType];
  if (!kind) return deactivatePersonnelForStaffRecord(staffRecordId);

  const { data: linked, error: findErr } = await db
    .from('school_personnel').select('id').eq('staff_record_id', staffRecordId).maybeSingle();
  if (findErr) throw findErr;
  if (linked) {
    await updatePersonnel(linked.id, { fullName, kind, nationalId, isActive: true });
    return linked.id;
  }

  // تبنّي صفّ أُضيف سابقاً بالإضافة السريعة بالاسم نفسه، بدل تكرار الشخص مرّتين
  // في كشف الدوام. الشرط: غير مربوط بعدُ، ونشط، ومطابق بالاسم في المدرسة نفسها.
  const { data: orphan, error: orphanErr } = await db
    .from('school_personnel').select('id')
    .eq('school_id', schoolId).eq('full_name', fullName)
    .is('staff_record_id', null).eq('is_active', true)
    .limit(2);
  if (orphanErr) throw orphanErr;
  if (orphan?.length === 1) {
    const { error } = await db.from('school_personnel')
      .update({ kind, national_id: nationalId, staff_record_id: staffRecordId })
      .eq('id', orphan[0].id);
    if (error) throw error;
    return orphan[0].id;
  }

  const { data, error } = await db.from('school_personnel')
    .insert({ school_id: schoolId, full_name: fullName, kind,
              national_id: nationalId, staff_record_id: staffRecordId })
    .select('id').single();
  if (error) throw error;
  return data.id;
}

async function deactivatePersonnelForStaffRecord(staffRecordId) {
  if (!staffRecordId) return null;
  const { error } = await db.from('school_personnel')
    .update({ is_active: false }).eq('staff_record_id', staffRecordId);
  if (error) throw error;
  return null;
}

// ── Teacher self check-in / out (offline-capable, mirrors student attendance) ──
function getPendingStaffAttendance() {
  return readQueue(QUEUE_STAFF_ATT).filter(r => !r.synced);
}

function markStaffAttSynced(localId) {
  const queue = readQueue(QUEUE_STAFF_ATT).map(r =>
    r.localId === localId ? { ...r, synced: true } : r
  );
  writeQueue(QUEUE_STAFF_ATT, queue);
}

// Core sync — replays a teacher self check-in/out by upserting the stored row.
async function syncStaffAttendanceRecord(payload) {
  const { error } = await db
    .from('staff_attendance')
    .upsert(payload.row, { onConflict: 'teacher_id,date', ignoreDuplicates: false });
  if (error) throw error;
  return true;
}

async function queueOrSyncStaff(payload) {
  const localId  = generateLocalId();
  const enriched = { ...payload, localId, synced: false, createdAt: new Date().toISOString() };
  if (!isOnline()) {
    await enqueueOutbox({ ...enriched, table: 'staff_attendance' });
    return { success: true, localId, synced: false };
  }
  try {
    await syncStaffAttendanceRecord(enriched);
    return { success: true, localId, synced: true };
  } catch (err) {
    await enqueueOutbox({ ...enriched, table: 'staff_attendance' });
    console.warn('[Ruqi] staff attendance: falling back to queue', err);
    return { success: true, localId, synced: false };
  }
}

async function teacherCheckIn(teacherId, schoolId, workStartTime = null) {
  const now  = new Date().toISOString();
  const date = localDateISO();
  const lateMinutes = computeLateMinutes(now, workStartTime);
  const row = {
    school_id: schoolId, date, kind: 'teacher', teacher_id: teacherId,
    status: staffStatusForLate(lateMinutes),
    check_in_original: now, late_minutes: lateMinutes,
    source: 'self', recorded_by: teacherId, updated_at: now,
  };
  return queueOrSyncStaff({ op: 'checkin', row });
}

async function teacherCheckOut(teacherId, schoolId) {
  const now  = new Date().toISOString();
  const date = localDateISO();
  // Only check_out is included → an upsert ON CONFLICT keeps check_in_original.
  const row = {
    school_id: schoolId, date, kind: 'teacher', teacher_id: teacherId,
    check_out: now, updated_at: now,
  };
  return queueOrSyncStaff({ op: 'checkout', row });
}

async function getMyStaffAttendanceToday(teacherId) {
  const date = localDateISO();
  const { data, error } = await db
    .from('staff_attendance')
    .select('date, status, check_in_original, check_in_adjusted, check_out, late_minutes, source')
    .eq('teacher_id', teacherId)
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;

  // Only accept the row if the DB echoes back today's date — guards against any
  // edge case where a stale cached response slips through.
  let result = (data && data.date === date) ? {
    date,
    status:          data.status,
    checkInOriginal: data.check_in_original,
    checkInAdjusted: data.check_in_adjusted,
    checkOut:        data.check_out,
    lateMinutes:     data.late_minutes,
    source:          data.source,
  } : null;

  // Merge any pending outbox items for today so that an offline/failed checkout
  // is immediately reflected without waiting for the next sync.  New items land
  // in the IDB outbox (via enqueueOutbox), so we read readOutbox() — not the
  // legacy LS queue read by getPendingStaffAttendance().
  try {
    const outbox = await readOutbox();
    for (const item of outbox) {
      if (item.table !== 'staff_attendance') continue;
      if (item.row?.teacher_id !== teacherId || item.row?.date !== date) continue;
      if (item.op === 'checkin' && !result) {
        result = {
          date,
          status:          item.row.status ?? null,
          checkInOriginal: item.row.check_in_original,
          checkInAdjusted: null,
          checkOut:        null,
          lateMinutes:     item.row.late_minutes ?? 0,
          source:          'self',
        };
      } else if (item.op === 'checkout' && result) {
        result = { ...result, checkOut: item.row.check_out };
      }
    }
  } catch { /* outbox read is best-effort; proceed with DB-only result */ }

  return result;
}

// ── Manager view: every staff member for a date, grouped by category ──
async function getStaffAttendanceForDate(schoolId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;
  /* allSettled لا all: الكادر والمعلّمون لهما مخبأ، فكان فشلُ استعلام الدوام
     وحده يُلغيهما معاً ويُفرِغ التبويب — نفس علّة Promise.all في بوّابة المعلّم.
     الآن يظهر الكادر بلا سجلّات دوام (فراغٌ صادق) بدل ألّا يظهر شيء. */
  const STAFF_ATT_CACHE_PFX = 'nsams_satt_';
  const attKey = STAFF_ATT_CACHE_PFX + schoolId;

  const [tRes, pRes, aRes] = await Promise.allSettled([
    getTeachersBySchool(schoolId),
    getSchoolPersonnel(schoolId),
    isOnline()
      ? withTimeout(
          db.from('staff_attendance')
            .select('id, kind, teacher_id, personnel_id, status, check_in_original, check_in_adjusted, check_out, late_minutes, source, adjust_reason, note')
            .eq('school_id', schoolId)
            .eq('date', isoDate),
          OFFLINE_READ_TIMEOUT_MS,
        )
      : Promise.reject(new Error('offline')),
  ]);

  const teachers  = tRes.status === 'fulfilled' ? tRes.value : [];
  const personnel = pRes.status === 'fulfilled' ? pRes.value : [];

  // سجلّات الدوام مؤرَّخة كسجلّات الحضور: نسخةُ الأمس رقمٌ خاطئ لا بيانٌ قديم.
  let attRows;
  if (aRes.status === 'fulfilled' && !aRes.value.error) {
    attRows = aRes.value.data ?? [];
    _writeDatedCache(attKey, isoDate, attRows);
  } else {
    attRows = _readDatedCache(attKey, isoDate) ?? [];
  }

  const byTeacher = {}, byPersonnel = {};
  for (const r of attRows) {
    if (r.teacher_id)        byTeacher[r.teacher_id]    = r;
    else if (r.personnel_id) byPersonnel[r.personnel_id] = r;
  }
  const mapRow = (rec) => rec ? {
    id: rec.id, status: rec.status,
    checkInOriginal: rec.check_in_original, checkInAdjusted: rec.check_in_adjusted,
    checkOut: rec.check_out, lateMinutes: rec.late_minutes, source: rec.source,
    adjustReason: rec.adjust_reason, note: rec.note,
  } : null;

  const teacherRows = teachers.map(t => ({
    kind: 'teacher', refId: t.id, name: t.fullName, record: mapRow(byTeacher[t.id]),
  }));
  const activePersonnel = personnel.filter(p => p.isActive);
  return {
    teachers: teacherRows,
    admins:   activePersonnel.filter(p => p.kind === 'admin')
                .map(p => ({ kind: 'admin', refId: p.id, name: p.fullName, record: mapRow(byPersonnel[p.id]) })),
    workers:  activePersonnel.filter(p => p.kind === 'worker')
                .map(p => ({ kind: 'worker', refId: p.id, name: p.fullName, record: mapRow(byPersonnel[p.id]) })),
  };
}

// Manager create/edit of a single staff row (online — like confirm/reject).
async function upsertStaffAttendance({
  schoolId, date, kind, teacherId = null, personnelId = null,
  status, checkInTime = null, checkOut = null,
  adjustReason = null, note = null, workStartTime = null, adjustedBy,
}) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;
  // Teachers keep their self-recorded original; a manager edit lands in the
  // adjusted column. Personnel have no self time → the manager value IS original.
  const timeCol = kind === 'teacher' ? 'check_in_adjusted' : 'check_in_original';
  const row = {
    school_id:    schoolId,
    date:         isoDate,
    kind,
    teacher_id:   kind === 'teacher' ? teacherId   : null,
    personnel_id: kind === 'teacher' ? null        : personnelId,
    status,
    [timeCol]:    checkInTime,
    check_out:    checkOut,
    source:       'manager',
    adjusted_by:  adjustedBy,
    adjust_reason: adjustReason,
    note,
    recorded_by:  adjustedBy,
    updated_at:   new Date().toISOString(),
  };
  // Lateness: cleared for absent/leave; recomputed when a time is given;
  // otherwise omitted so a teacher's self-computed value is preserved.
  if (status === 'absent' || status === 'leave') {
    row.late_minutes = null;
  } else if (checkInTime) {
    row.late_minutes = computeLateMinutes(checkInTime, workStartTime);
  } else if (kind !== 'teacher') {
    row.late_minutes = null;
  }

  const onConflict = kind === 'teacher' ? 'teacher_id,date' : 'personnel_id,date';
  const { error } = await db
    .from('staff_attendance')
    .upsert(row, { onConflict, ignoreDuplicates: false });
  if (error) throw error;
  return true;
}

// Present/absent tallies per category, to auto-fill the daily aggregate record.
async function computeStaffDailyCounts(schoolId, date) {
  const { teachers, admins, workers } = await getStaffAttendanceForDate(schoolId, date);
  const tally = (list) => {
    let present = 0, absent = 0;
    for (const p of list) {
      const st = p.record?.status;
      if (st === 'present' || st === 'late') present++;
      else if (st === 'absent')              absent++;
    }
    return { present, absent };
  };
  return { teachers: tally(teachers), admins: tally(admins), workers: tally(workers) };
}

// ─── School admin: daily summary per class ───────────────────────────────────
/* ⚠️ أهمّ قراءة في بوّابة المدير — بطاقة «كشوف الحضور من المعلمين» — وكانت
   الوحيدة بلا مهلة ولا مخبأ رغم أربع رحلات شبكية. دون اتصال ترمي فوراً فتبقى
   البطاقة بلا قائمة ولا رسالة (هذا هو «القسم لا يفتح»)؛ وعلى شبكة «متصلة لكن
   ميتة» تتعلّق بلا سقف فيدور هيكل التحميل إلى الأبد. وتسقط معها «الغياب»
   و«التقارير» لأنّهما يقرآن _summaryByClass نفسه لا الشبكة.

   المخبأ مؤرَّخ عمداً: هذه بيانات يومٍ بعينه، وعرضُ كشوف الأمس تحت تاريخ اليوم
   ليس عرضاً قديماً بل رقماً خاطئاً — تُملأ منه خانات الحضور المجمّع تلقائياً
   (school/script.js) ثمّ يُرسَل إلى المديرية. فإن لم توجد نسخةٌ لليوم نرمي
   NoCachedClassesError كي تعرض الواجهة فشلاً صريحاً بزرّ إعادة محاولة، لا
   قائمةً فارغة تُقرأ على أنّها «لم يُرسل أحدٌ كشفه». */
async function getSchoolDailySummary(schoolId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;
  const key     = SCHOOL_SUMMARY_CACHE_PFX + schoolId;

  const NO_CACHE_MSG =
    'تعذّر تحميل كشوف اليوم ولا توجد نسخة محفوظة لهذا اليوم على الجهاز.';

  // دون اتصال: لا تُهدَر مهلة على شبكة غائبة — اقرأ نسخة اليوم فوراً إن وُجدت،
  // وإلّا فالنداء الشبكي محكومٌ بالفشل ولا معنى لتجميد البطاقة ستّ ثوانٍ على
  // هيكل تحميل قبل رسالةٍ نعرفها سلفاً. (navigator.onLine=false موثوقٌ نفياً؛
  // إثباتُه وحده هو غير الموثوق، وذلك ما تتكفّل به withTimeout أدناه.)
  // نفس نمط getClassStudents المثبت في هذا الملفّ.
  if (!isOnline()) {
    const hit = _readDatedCache(key, isoDate);
    if (hit) return hit;
    throw new NoCachedClassesError(null, NO_CACHE_MSG);
  }

  let summary;
  try {
    const clsRes = await withTimeout(
      db.from('classes')
        .select(`
          id, grade, section, academic_year,
          class_teacher!left (
            role,
            teacher_id,
            users:teacher_id ( full_name )
          )
        `)
        .eq('school_id', schoolId),
      OFFLINE_READ_TIMEOUT_MS,
    );
    if (clsRes.error) throw clsRes.error;
    // كلُّ صفوف المدرسة تُعرَض — لا تصفيةَ بـ«أحدث عام». القيدُ
    // UNIQUE(school_id, grade, section) يجعل لكلّ صفٍّ/شعبةٍ صفاً واحداً دائماً،
    // فلا تراكمَ سنواتٍ يُخشى منه. وكانت تصفيةُ «أحدث عام» تُسقط صفاً حاليّاً
    // خُتم بعامٍ خاطئ (خللُ add_class المُصلَح في هجرة 20260819000700) فتظهر
    // الأعدادُ «—»؛ وهذا يطابق getSchoolClasses الذي تعتمده قائمةُ الطلاب.
    const classRows = clsRes.data ?? [];

    const classIds = classRows.map(c => c.id);
    // مدرسةٌ بلا صفوف: فراغٌ حقيقي لا فشل — يُخبَّأ كي تعرضه الواجهة دون اتصال
    // كرسالة «لا توجد صفوف» بدل شاشة تعذُّر تحميل.
    if (classIds.length === 0) {
      _writeDatedCache(key, isoDate, []);
      return [];
    }

    // مهلة واحدة تحكم الرحلات الثلاث المتوازية مجتمعةً.
    const [subRes, attRes, stuRes] = await withTimeout(Promise.all([
      db.from('attendance_submissions')
        .select('id, class_id, status, submitted_at, confirmed_at')
        .eq('school_id', schoolId)
        .eq('date',      isoDate)
        .in('class_id',  classIds),

      db.from('daily_student_attendance')
        .select('class_id, status')
        .eq('school_id', schoolId)
        .eq('date',      isoDate)
        .in('class_id',  classIds),

      db.from('students')
        .select('class_id')
        .eq('school_id', schoolId)
        .eq('is_active', true)
        .in('class_id',  classIds),
    ]), OFFLINE_READ_TIMEOUT_MS);

    if (subRes.error) throw subRes.error;
    if (attRes.error) throw attRes.error;
    if (stuRes.error) throw stuRes.error;

    const subMap = {};
    for (const s of subRes.data ?? []) subMap[s.class_id] = s;

    const attMap = {};
    for (const a of attRes.data ?? []) {
      if (!attMap[a.class_id]) {
        attMap[a.class_id] = { present: 0, absent: 0, late: 0, excused: 0 };
      }
      attMap[a.class_id][a.status]++;
    }

    const stuCount = {};
    for (const s of stuRes.data ?? []) {
      stuCount[s.class_id] = (stuCount[s.class_id] ?? 0) + 1;
    }

    summary = classRows.map(c => {
      // Only the homeroom teacher / supervisor is the attendance source — never a
      // subject teacher (أستاذ مادة), who has no attendance responsibility.
      const ct = (c.class_teacher ?? []).find(t => t.role === 'homeroom' || t.role === 'supervisor');
      return {
        classId:       c.id,
        displayName:   `الصف ${gradeNameAr(c.grade)} / شعبة ${c.section}`,
        grade:         c.grade,
        section:       c.section,
        teacherName:   ct?.users?.full_name ?? '—',
        teacherId:     ct?.teacher_id ?? null,
        submission:    subMap[c.id] ?? null,
        stats:         attMap[c.id] ?? { present: 0, absent: 0, late: 0, excused: 0 },
        totalStudents: stuCount[c.id] ?? 0,
      };
    }).sort((a, b) => a.grade - b.grade || a.section.localeCompare(b.section));
  } catch (err) {
    const hit = _readDatedCache(key, isoDate);
    if (hit) { console.warn('[Ruqi] كشوف اليوم من المخبأ', err); return hit; }
    throw new NoCachedClassesError(err, NO_CACHE_MSG);
  }

  _writeDatedCache(key, isoDate, summary);
  return summary;
}

// ─── School admin: confirm / reject a class submission ───────────────────────
async function confirmClassSubmission(submissionId, confirmedBy, notes = null) {
  const { error } = await db
    .from('attendance_submissions')
    .update({
      status:       'confirmed',
      confirmed_by: confirmedBy,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('status', 'pending');
  if (error) throw error;
}

async function rejectClassSubmission(submissionId, confirmedBy, notes) {
  if (!notes?.trim()) throw new Error('يجب إدخال سبب الإعادة');
  const { error } = await db
    .from('attendance_submissions')
    .update({
      status:       'rejected',
      confirmed_by: confirmedBy,
      confirmed_at: new Date().toISOString(),
      notes,
    })
    .eq('id', submissionId)
    .eq('status', 'pending');
  if (error) throw error;
}

// ═════════════════════════════════════════════════════════════════════════════
// Grades & report cards (الدرجات والشهادة)
// ═════════════════════════════════════════════════════════════════════════════
// Data model (tables created in Supabase, see project SQL):
//   subjects(id, school_id, grade, name, max_total, pass_mark, is_core_arabic,
//            sort_order, is_active)
//   subject_components(id, subject_id, name, max_mark, sort_order)
//   student_grades(id, student_id, class_id, school_id, subject_id, component_id,
//                  semester, academic_year, mark, recorded_by, recorded_at)
//     UNIQUE(student_id, component_id, semester, academic_year)
// A subject's semester mark = Σ component marks; the final % = average of the two
// semesters. Per-subject pass = pass_mark (Arabic parts use 50 via is_core_arabic).

// ─── School admin: subjects catalog ──────────────────────────────────────────
async function getSchoolSubjects(schoolId, grade = null) {
  let q = db
    .from('subjects')
    .select('id, school_id, grade, name, max_total, pass_mark, is_core_arabic, is_core_math, allow_full_marks, sort_order, is_active')
    .eq('school_id', schoolId);
  if (grade != null) q = q.eq('grade', grade);
  const { data, error } = await q
    .order('grade',      { ascending: true })
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name',       { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// catalogId: أصلُ المادّة في الفهرس المركزيّ حين تُنشأ منه. المزامنة تتبع هذا
// المعرّف لا الاسم، فإعادةُ تسمية المادّة في الفهرس لا تقطع نسخ المدارس عنه.
async function createSubject({ schoolId, grade, name, maxTotal = 100, passMark = 40, isCoreArabic = false, isCoreMath = false, allowFullMarks = false, sortOrder = null, catalogId = null }) {
  const { data, error } = await db
    .from('subjects')
    .insert({
      school_id:        schoolId,
      grade,
      name,
      max_total:        maxTotal,
      pass_mark:        passMark,
      is_core_arabic:   isCoreArabic,
      is_core_math:     isCoreMath,
      allow_full_marks: allowFullMarks,
      sort_order:       sortOrder,
      catalog_id:       catalogId,
      is_active:        true,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function updateSubject(id, patch) {
  const row = {};
  if (patch.name         !== undefined) row.name           = patch.name;
  if (patch.maxTotal     !== undefined) row.max_total       = patch.maxTotal;
  if (patch.passMark     !== undefined) row.pass_mark       = patch.passMark;
  if (patch.isCoreArabic !== undefined) row.is_core_arabic  = patch.isCoreArabic;
  if (patch.isCoreMath   !== undefined) row.is_core_math    = patch.isCoreMath;
  if (patch.allowFullMarks !== undefined) row.allow_full_marks = patch.allowFullMarks;
  if (patch.sortOrder    !== undefined) row.sort_order      = patch.sortOrder;
  if (patch.isActive     !== undefined) row.is_active       = patch.isActive;
  const { error } = await db.from('subjects').update(row).eq('id', id);
  if (error) throw error;
  return true;
}

async function deleteSubject(id) {
  const { error } = await db.from('subjects').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function getSubjectComponents(subjectId) {
  const { data, error } = await db
    .from('subject_components')
    .select('id, subject_id, name, max_mark, sort_order')
    .eq('subject_id', subjectId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name',       { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ⚠ هذه الدالة كانت تمسح مكوّنات المادة كلَّها ثم تُعيد إدراجها بمعرّفاتٍ جديدة.
// و student_grades.component_id مرتبطٌ بـ ON DELETE CASCADE (baseline.sql:5770).
// فمديرُ مدرسةٍ يفتح «تعديل مادة» ليصحّح حرفاً في الاسم ويضغط حفظ كان يمحو كلَّ
// علامات تلك المادة — لكلّ الطلاب، في الفصلين، بلا سؤالٍ ولا رسالة ولا رجعة.
//
// البديل: مطابقةٌ بالهوية لا مسحٌ شامل. المكوّن الذي بقي يُحدَّث في مكانه فيبقى
// معرّفه ومعه العلامات؛ الجديد يُدرَج؛ والمحذوف وحده يُحذف. تغييرُ اسم المكوّن
// نفسه صار تحديثاً لا استبدالاً — وهو الصواب: «مذاكرة» التي أُعيدت تسميتها
// «المذاكرة» هي المكوّن نفسه، ودرجاتُ الطلاب فيها لم تتغيّر.
//
// components: [{ id?, name, maxMark }] — id للصفوف القائمة. عند غيابه نُطابق
// بالاسم المطابق تماماً (لمناديَ لا يحمل معرّفات)، وإلّا فهو صفٌّ جديد.
// تُرجع مجموعة المكوّنات بعد الحفظ.
async function setSubjectComponents(subjectId, components) {
  const existing = await getSubjectComponents(subjectId);
  const byId     = new Map(existing.map(r => [r.id, r]));
  const unusedByName = new Map();
  for (const r of existing) {
    const k = (r.name || '').trim();
    if (!unusedByName.has(k)) unusedByName.set(k, []);
    unusedByName.get(k).push(r);
  }

  const wanted = (components ?? [])
    .filter(c => c && c.name && String(c.name).trim())
    .map((c, i) => ({
      id:         c.id && byId.has(c.id) ? c.id : null,
      name:       String(c.name).trim(),
      max_mark:   Number(c.maxMark) || 0,
      sort_order: i,
    }));

  // كلُّ معرّفٍ صريح يحجز صفَّه أوّلاً، ثمّ يلتقط الباقي أقرانَه بالاسم — حتى لا
  // يخطف صفٌّ بلا معرّف صفَّاً سُمّي إليه معرّفٌ صريح.
  for (const w of wanted) if (w.id) {
    const k = (byId.get(w.id).name || '').trim();
    const pool = unusedByName.get(k);
    if (pool) {
      const at = pool.findIndex(r => r.id === w.id);
      if (at >= 0) pool.splice(at, 1);
    }
  }
  for (const w of wanted) if (!w.id) {
    const pool = unusedByName.get(w.name);
    if (pool?.length) w.id = pool.shift().id;
  }

  const keep    = new Set(wanted.map(w => w.id).filter(Boolean));
  const removed = existing.filter(r => !keep.has(r.id)).map(r => r.id);

  // تحديثُ ما تغيّر فعلاً فقط: صفٌّ لم يمسّه المستخدم لا داعيَ لكتابته.
  for (const w of wanted) {
    if (!w.id) continue;
    const cur = byId.get(w.id);
    if (cur
      && (cur.name || '').trim() === w.name
      && Number(cur.max_mark) === w.max_mark
      && (cur.sort_order ?? null) === w.sort_order) continue;
    const { error } = await db
      .from('subject_components')
      .update({ name: w.name, max_mark: w.max_mark, sort_order: w.sort_order })
      .eq('id', w.id);
    if (error) throw error;
  }

  const fresh = wanted.filter(w => !w.id).map(w => ({
    subject_id: subjectId, name: w.name, max_mark: w.max_mark, sort_order: w.sort_order,
  }));
  if (fresh.length) {
    const { error } = await db.from('subject_components').insert(fresh);
    if (error) throw error;
  }

  // الحذف أخيراً: لو انقطع الاتصال في المنتصف تبقى المكوّنات القديمة ومعها
  // العلامات، والأسوأ الذي يقع تكرارٌ يراه المدير ويصلحه — لا فقدٌ لا رجعة فيه.
  if (removed.length) {
    const { error } = await db.from('subject_components').delete().in('id', removed);
    if (error) throw error;
  }

  return getSubjectComponents(subjectId);
}

// كم علامةً مسجَّلة معلَّقة بهذه المكوّنات؟ تُستدعى قبل حذف مكوّنٍ لنُنذر المدير
// بما سيضيع بالضبط بدل إنذارٍ عامّ لا يقرأه أحد.
async function countGradesForComponents(componentIds) {
  const ids = [...new Set((componentIds ?? []).filter(Boolean))];
  if (!ids.length) return 0;
  const { count, error } = await db
    .from('student_grades')
    .select('id', { count: 'exact', head: true })
    .in('component_id', ids)
    .is('deleted_at', null);
  if (error) throw error;
  return count ?? 0;
}

// ─── Global subject catalog (managed by the supervisor/ministry in admin) ─────
// A central list of subject names. School admins pick from it per grade; the
// per-grade `subjects` rows (with their components/max) are created from it.
// RLS: all authenticated read (active); only ministry_user may write.
async function getSubjectCatalog() {
  const { data, error } = await db
    .from('subject_catalog')
    .select('id, name, is_core_arabic, is_core_math, allow_full_marks, sort_order, active')
    .eq('active', true)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name',       { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function createCatalogSubject({ name, isCoreArabic = false, isCoreMath = false, allowFullMarks = false, sortOrder = null }) {
  const { data, error } = await db
    .from('subject_catalog')
    .insert({
      name: name.trim(), is_core_arabic: isCoreArabic, is_core_math: isCoreMath,
      allow_full_marks: allowFullMarks, sort_order: sortOrder,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function updateCatalogSubject(id, patch) {
  const row = {};
  if (patch.name         !== undefined) row.name           = String(patch.name).trim();
  if (patch.isCoreArabic !== undefined) row.is_core_arabic = patch.isCoreArabic;
  if (patch.isCoreMath   !== undefined) row.is_core_math   = patch.isCoreMath;
  if (patch.allowFullMarks !== undefined) row.allow_full_marks = patch.allowFullMarks;
  if (patch.sortOrder    !== undefined) row.sort_order     = patch.sortOrder;
  if (patch.active       !== undefined) row.active         = patch.active;
  const { error } = await db.from('subject_catalog').update(row).eq('id', id);
  if (error) throw error;
  return true;
}

async function deleteCatalogSubject(id) {
  const { error } = await db.from('subject_catalog').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// Retroactively push allow_full_marks from the catalog onto already-created
// per-grade `subjects` rows (matched by trimmed name). The catalog is only
// copied at creation time (applyCatalogSubjectsToGrades), so editing it later
// otherwise never reaches subjects that already exist. Returns rows updated.
// تُرجع { synced, unlinked }. الثاني عددُ نسخ المدارس التي لا أصل لها في
// الفهرس المركزيّ — أُنشئت محلّياً أو باسمٍ لا يُطابق أحداً، فلا تصلها مزامنة.
// كان العائد رقماً واحداً؛ نقبل الشكلين فلا تنكسر واجهةٌ على قاعدةٍ لم تُهاجَر.
async function syncFullMarksFromCatalog() {
  const { data, error } = await db.rpc('sync_full_marks_from_catalog');
  if (error) throw error;
  if (data && typeof data === 'object') {
    return { synced: Number(data.synced) || 0, unlinked: Number(data.unlinked) || 0 };
  }
  return { synced: Number(data) || 0, unlinked: 0 };
}

// Components of a catalog subject (defined by the supervisor). School subjects
// created from the catalog copy these. Same shape as subject_components.
async function getCatalogComponents(catalogId) {
  const { data, error } = await db
    .from('subject_catalog_components')
    .select('id, catalog_id, name, max_mark, sort_order')
    .eq('catalog_id', catalogId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name',       { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function setCatalogComponents(catalogId, components) {
  const { error: delErr } = await db
    .from('subject_catalog_components').delete().eq('catalog_id', catalogId);
  if (delErr) throw delErr;
  const rows = (components ?? [])
    .filter(c => c.name && c.name.trim())
    .map((c, i) => ({ catalog_id: catalogId, name: c.name.trim(), max_mark: Number(c.maxMark) || 0, sort_order: i }));
  if (rows.length === 0) return [];
  const { data, error } = await db
    .from('subject_catalog_components').insert(rows)
    .select('id, catalog_id, name, max_mark, sort_order');
  if (error) throw error;
  return data ?? [];
}

// درجة النجاح (٪) وفق اللائحة الرسمية — تُشتق من الصف ونوع المادة، لا تُدخل يدويّاً:
//   الصفوف ١–٤ → ٤١ ؛ الصفوف ٥ فأعلى → ٤٠، والعربي/الرياضيات الأساسية → ٥٠.
function passMarkFor(grade, isCoreArabic, isCoreMath) {
  const g = parseInt(grade, 10) || 0;
  if (g >= 1 && g <= 4) return 41;
  return (isCoreArabic || isCoreMath) ? 50 : 40;
}

// قواعد النجاح القابلة للتعديل من لوحة المشرف — درجة دنيا لكل مجموعة صفوف.
async function getGradePassRules() {
  const { data, error } = await db
    .from('grade_pass_rules')
    .select('id, grade_from, grade_to, default_pass, core_pass, sort_order')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('grade_from', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Overwrite all rules. rules: [{ gradeFrom, gradeTo, defaultPass, corePass }].
async function setGradePassRules(rules) {
  const { error: delErr } = await db
    .from('grade_pass_rules').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) throw delErr;
  const rows = (rules ?? [])
    .filter(r => r.gradeFrom && r.gradeTo)
    .map((r, i) => ({
      grade_from:   Number(r.gradeFrom),
      grade_to:     Number(r.gradeTo),
      default_pass: Number(r.defaultPass) || 0,
      core_pass:    Number(r.corePass)    || 0,
      sort_order:   i,
    }));
  if (rows.length === 0) return [];
  const { data, error } = await db
    .from('grade_pass_rules').insert(rows)
    .select('id, grade_from, grade_to, default_pass, core_pass, sort_order');
  if (error) throw error;
  return data ?? [];
}

// Resolve a subject's pass mark from the configured rules; falls back to the
// hardcoded regulation rule when no rule matches / none configured yet.
function resolvePassMark(rules, grade, isCoreArabic, isCoreMath) {
  const g = parseInt(grade, 10) || 0;
  const rule = (rules ?? []).find(r => g >= Number(r.grade_from) && g <= Number(r.grade_to));
  if (!rule) return passMarkFor(grade, isCoreArabic, isCoreMath);
  return (isCoreArabic || isCoreMath) ? Number(rule.core_pass) : Number(rule.default_pass);
}

// School admin: create the chosen catalog subjects in ALL the chosen grades at
// once. Per grade, skips names already present; copies the catalog components
// and derives the pass mark by rule. Returns how many subject rows were created.
async function applyCatalogSubjectsToGrades(schoolId, grades, catalogIds) {
  const gradeList = [...new Set((grades ?? []).map(g => Number(g)).filter(g => g >= 1 && g <= 12))];
  const idSet     = new Set(catalogIds ?? []);
  const catalog   = await getSubjectCatalog();
  const chosen    = catalog.filter(c => idSet.has(c.id));
  if (!chosen.length || !gradeList.length) return 0;

  const compsByCatalog = {};
  for (const c of chosen) compsByCatalog[c.id] = await getCatalogComponents(c.id);
  const passRules = await getGradePassRules().catch(() => []);

  let created = 0;
  for (const grade of gradeList) {
    const existing = await getSchoolSubjects(schoolId, grade);
    const have     = new Set(existing.map(s => (s.name || '').trim()));
    for (const c of chosen) {
      if (have.has((c.name || '').trim())) continue;
      const comps    = compsByCatalog[c.id] || [];
      const maxTotal = comps.reduce((a, x) => a + (Number(x.max_mark) || 0), 0) || 100;
      const passMark = resolvePassMark(passRules, grade, c.is_core_arabic, c.is_core_math);
      const subjectId = await createSubject({
        schoolId, grade, name: c.name, maxTotal, passMark,
        isCoreArabic: c.is_core_arabic, isCoreMath: c.is_core_math,
        allowFullMarks: c.allow_full_marks,
        catalogId: c.id,          // النسب يُسجَّل عند النسخ لا يُستنتج بالاسم لاحقاً
      });
      if (comps.length) {
        await setSubjectComponents(subjectId, comps.map(x => ({ name: x.name, maxMark: x.max_mark })));
      }
      created++;
    }
  }
  return created;
}

// ─── Teacher: subjects gradable in a class ───────────────────────────────────
// Returns ALL active subjects defined for the class's grade, each with its
// components — the teacher can VIEW any subject's marks. Editing is limited to
// the teacher's own subjects (class_teacher.subject_ids): the portal renders
// the rest read-only, and RLS rejects writes to subjects they aren't assigned.
async function getClassGradeSubjects(classId) {
  const { data: cls, error: clsErr } = await db
    .from('classes')
    .select('id, grade, section, name, school_id')
    .eq('id', classId)
    .single();
  if (clsErr) throw clsErr;

  const subjects = await getSchoolSubjects(cls.school_id, cls.grade);
  const active   = subjects.filter(s => s.is_active);

  const withComponents = await Promise.all(
    active.map(async (s) => ({ ...s, components: await getSubjectComponents(s.id) }))
  );
  return { class: cls, subjects: withComponents };
}

// ─── Teacher: load existing grades for a class + subject + semester ───────────
// Returns { [student_id]: { [component_id]: mark } }.
async function getClassGrades(classId, subjectId, semester) {
  const academicYear = getAcademicYear();
  const { data, error } = await db
    .from('student_grades')
    .select('student_id, component_id, mark')
    .eq('class_id',      classId)
    .eq('subject_id',    subjectId)
    .eq('semester',      semester)
    .eq('academic_year', academicYear);
  if (error) throw error;

  const map = {};
  for (const row of data ?? []) {
    (map[row.student_id] ||= {})[row.component_id] = row.mark;
  }
  return map;
}

// ─── Grades offline queue ────────────────────────────────────────────────────
function getPendingStudentGrades() {
  return readQueue(QUEUE_GRADES).filter(r => !r.synced);
}

function markStudentGradesSynced(localId) {
  const queue = readQueue(QUEUE_GRADES).map(r =>
    r.localId === localId ? { ...r, synced: true } : r
  );
  writeQueue(QUEUE_GRADES, queue);
}

// Core sync — used both online (direct) and by syncPendingV2.
async function syncStudentGradesRecord(payload) {
  const { records, classId, schoolId, subjectId, semester, academicYear, teacherId } = payload;

  const rows = records.map(r => ({
    student_id:    r.studentId,
    class_id:      classId,
    school_id:     schoolId,
    subject_id:    subjectId,
    component_id:  r.componentId,
    semester,
    academic_year: academicYear,
    mark:          r.mark,
    recorded_by:   teacherId,
    recorded_at:   new Date().toISOString(),
  }));
  if (rows.length === 0) return true;

  const { error } = await db
    .from('student_grades')
    .upsert(rows, {
      onConflict: 'student_id,component_id,semester,academic_year',
      ignoreDuplicates: false,
    });
  if (error) throw error;
  return true;
}

// Save a class+subject+semester's grades. records: [{ studentId, componentId, mark }].
async function saveStudentGrades({ records, classId, schoolId, subjectId, semester, teacherId }) {
  const localId      = generateLocalId();
  const academicYear = getAcademicYear();
  const payload = {
    localId, records, classId, schoolId, subjectId, semester, academicYear, teacherId,
    synced: false, createdAt: new Date().toISOString(),
  };

  if (!isOnline()) {
    await enqueueOutbox({ ...payload, table: 'student_grades' });
    return { success: true, localId, synced: false };
  }

  try {
    await syncStudentGradesRecord(payload);
    return { success: true, localId, synced: true };
  } catch (err) {
    await enqueueOutbox({ ...payload, table: 'student_grades' });
    console.warn('[Ruqi] saveStudentGrades: falling back to queue', err);
    return { success: true, localId, synced: false };
  }
}

// ─── Conduct (درجة السلوك) — gates promotion from grade 7 up ──────────────────
// One mark (0..100) per student per academic year, entered by the class's
// attendance teacher (homeroom/supervisor). Mirrors the grades offline queue.
async function getClassConduct(classId) {
  const academicYear = getAcademicYear();
  const { data, error } = await db
    .from('student_conduct')
    .select('student_id, mark')
    .eq('class_id',      classId)
    .eq('academic_year', academicYear);
  if (error) throw error;
  const map = {};
  for (const r of data ?? []) map[r.student_id] = r.mark;
  return map;
}

function getPendingStudentConduct() {
  return readQueue(QUEUE_CONDUCT).filter(r => !r.synced);
}
function markStudentConductSynced(localId) {
  writeQueue(QUEUE_CONDUCT, readQueue(QUEUE_CONDUCT).map(r =>
    r.localId === localId ? { ...r, synced: true } : r));
}

async function syncStudentConductRecord(payload) {
  const { records, classId, schoolId, academicYear, teacherId } = payload;
  const rows = records.map(r => ({
    student_id:    r.studentId,
    class_id:      classId,
    school_id:     schoolId,
    academic_year: academicYear,
    mark:          r.mark,
    recorded_by:   teacherId,
    recorded_at:   new Date().toISOString(),
  }));
  if (rows.length === 0) return true;
  const { error } = await db
    .from('student_conduct')
    .upsert(rows, { onConflict: 'student_id,academic_year', ignoreDuplicates: false });
  if (error) throw error;
  return true;
}

// Save a class's conduct marks. records: [{ studentId, mark }].
async function saveStudentConduct({ records, classId, schoolId, teacherId }) {
  const localId      = generateLocalId();
  const academicYear = getAcademicYear();
  const payload = {
    localId, records, classId, schoolId, academicYear, teacherId,
    synced: false, createdAt: new Date().toISOString(),
  };
  if (!isOnline()) {
    await enqueueOutbox({ ...payload, table: 'student_conduct' });
    return { success: true, localId, synced: false };
  }
  try {
    await syncStudentConductRecord(payload);
    return { success: true, localId, synced: true };
  } catch (err) {
    await enqueueOutbox({ ...payload, table: 'student_conduct' });
    console.warn('[Ruqi] saveStudentConduct: falling back to queue', err);
    return { success: true, localId, synced: false };
  }
}

// ─── Grace marks (درجات المساعدة) — school-admin remediation tool ─────────────
// Pushes a failing student over the line within the official caps (≤10 per
// subject, Arabic group counts once, ≤50 total). subjectId = null means the
// grace is added to the overall total only. Stored per (student, subject[,null]).
async function getClassGrace(classId) {
  const academicYear = getAcademicYear();
  const { data, error } = await db
    .from('student_grace')
    .select('student_id, subject_id, marks')
    .eq('class_id',      classId)
    .eq('academic_year', academicYear);
  if (error) throw error;
  // map[studentId] = { bySubject: { [subjectId]: marks }, total: marks }
  const map = {};
  for (const r of data ?? []) {
    const e = map[r.student_id] ||= { bySubject: {}, total: 0 };
    if (r.subject_id == null) e.total += Number(r.marks) || 0;
    else e.bySubject[r.subject_id] = Number(r.marks) || 0;
  }
  return map;
}

// Replace a student's grace for the year. items: [{ subjectId|null, marks }].
// Goes through the grant_grace RPC: it is the ONLY write path for student_grace
// so the official caps (≤10 per subject, Arabic group ≤10 combined, ≤50 total)
// are enforced on the server and the replacement is atomic. Online-only.
async function setStudentGrace({ studentId, classId, items }) {
  const academicYear = getAcademicYear();
  const payload = (items ?? [])
    .filter(it => Number(it.marks) > 0)
    .map(it => ({ subject_id: it.subjectId ?? null, marks: Number(it.marks) }));
  const { error } = await db.rpc('grant_grace', {
    p_student:       studentId,
    p_class:         classId,
    p_academic_year: academicYear,
    p_items:         payload,
  });
  if (error) throw error;
  return true;
}

// ─── Grace proposals (اقتراحات المعلّمين) ─────────────────────────────────────
// A subject teacher proposes grace for their own subject; the school admin
// approves (which folds it into student_grace via grant_grace) or rejects.
/* اقتراحات الرأفة التي قدّمها المعلّم الحالي — عبر صفوفه كلّها لا صفٍّ واحد.
   كان المعلّم يُرسل اقتراحه ثمّ لا يعرف مصيره أبداً: لا قائمةَ عنده ولا إشعار.
   RLS يسمح للمُقترِح بقراءة صفوفه (grace_prop_teacher_rw)، فالبيانات كانت
   متاحةً ولا شيء يقرؤها. */
async function getMyGraceProposals(limit = 40) {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return [];
  const { data, error } = await db
    .from('grace_proposals')
    .select('id, student_id, class_id, subject_id, marks, reason, status, ' +
            'decided_at, decide_note, created_at, academic_year')
    .eq('proposed_by', user.id)
    .eq('academic_year', getAcademicYear())
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function getGraceProposals(classId, status = null) {
  const academicYear = getAcademicYear();
  let q = db
    .from('grace_proposals')
    .select('id, student_id, class_id, subject_id, marks, reason, status, proposed_by, created_at')
    .eq('class_id',      classId)
    .eq('academic_year', academicYear);
  if (status) q = q.eq('status', status);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Resolve a single proposal by id — used by the school portal's notification
// deep link to find which class/student screen to open.
async function getGraceProposalById(id) {
  const { data, error } = await db
    .from('grace_proposals')
    .select('id, student_id, class_id, school_id, subject_id, marks, status, academic_year')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function proposeGrace({ studentId, classId, schoolId, subjectId, marks, reason }) {
  const academicYear = getAcademicYear();
  const { data: { session } } = await db.auth.getSession();
  const { error } = await db.from('grace_proposals').insert({
    student_id:    studentId,
    class_id:      classId,
    school_id:     schoolId,
    academic_year: academicYear,
    subject_id:    subjectId ?? null,
    marks:         Number(marks) || 0,
    reason:        (reason || '').trim() || null,
    proposed_by:   session?.user?.id ?? null,
    status:        'pending',
  });
  if (error) throw error;
  return true;
}

// decision: 'approved' | 'rejected'. Approving applies the grace (caps re-checked
// server-side) and notifies the parent.
// reason يصل المعلّمَ صاحبَ الاقتراح في إشعار الرفض — رفضٌ بلا سببٍ لا يُعلّمه.
async function decideGraceProposal(proposalId, decision, reason = null) {
  const { error } = await db.rpc('decide_grace_proposal', {
    p_id:       proposalId,
    p_decision: decision,
    p_reason:   reason || null,
  });
  if (error) throw error;
  return true;
}

// ─── Report-card result rule (شروط النجاح والرسوب — مديرية التربية) ───────────
// Three grade bands, result is ناجح/راسب only (no مكمّل for basic education):
//   • Band A (grades 1-4): fail if MORE THAN ONE of the core areas
//     (is_core_arabic ×2 + is_core_math) is "weak" (percent < 50).
//   • Band B (grades 5-6): pass needs ALL of — total ≥ 50%, the combined Arabic
//     unit ≥ 50%, at most TWO non-Arabic subjects below 40%, and attendance ≥
//     the school's minimum. Grace marks are applied before this check.
//   • Band C (grades 7+): same as B PLUS conduct ≥ 60%.
// ctx = { band, subjects:[{percent,isCoreArabic,isCoreMath}], totalPercent,
//         arabicPercent, conductPercent, attendancePercent, minAttendancePct }.
function promotionBand(grade) {
  if (grade <= 4) return 'A';
  if (grade <= 6) return 'B';
  return 'C'; // grades 7+ (certificate grades 9/12 treated the same for now)
}

function computeYearResult(ctx) {
  if (ctx.band === 'A') {
    const weak = ctx.subjects.filter(s =>
      (s.isCoreArabic || s.isCoreMath) && s.percent != null && s.percent < 50).length;
    return weak > 1 ? 'راسب' : 'ناجح';
  }
  // Bands B and C
  const totalOk    = ctx.totalPercent != null && ctx.totalPercent >= 50;
  const arabicOk   = ctx.arabicPercent == null || ctx.arabicPercent >= 50;
  const belowForty = ctx.subjects.filter(s =>
    !s.isCoreArabic && s.percent != null && s.percent < 40).length;
  const fortyOk    = belowForty <= 2;
  // Attendance only gates when we have both a recorded % and a configured min.
  const attOk      = ctx.attendancePercent == null || ctx.minAttendancePct == null
                     || ctx.attendancePercent >= ctx.minAttendancePct;
  let ok = totalOk && arabicOk && fortyOk && attOk;
  if (ctx.band === 'C') {
    ok = ok && (ctx.conductPercent != null && ctx.conductPercent >= 60);
  }
  return ok ? 'ناجح' : 'راسب';
}

// ⚠️ مرحلة مشتقّة من **رقم الصف** لبطاقات العلامات — ليست schools.school_type.
//    الكلمات الثلاث نفسها والدلالة مختلفة: مدرسة ثانوية ترقّم صفوفها ١/٢/٣
//    محلياً، فتُرجِع هذه الدالة 'primary' لصفوفها. لا تستبدل إحداهما بالأخرى.
function stageForGrade(grade) {
  if (grade <= 6)  return 'primary';     // ابتدائي
  if (grade <= 9)  return 'preparatory'; // إعدادي
  return 'secondary';                    // ثانوي
}

// ─── Report cards for a whole class ──────────────────────────────────────────
// Computes, per student, each subject's semester marks, final %, pass flag, plus
// the overall year result. Returns { class, students:[{ student, subjects:[…],
// finalPercent, result }] }. Computed client-side (like getClassAbsenceSummary)
// so it runs under the school_admin read policy.
async function getClassReportCards(classId, academicYear = getAcademicYear(), term = 'year') {
  const { data: cls, error: clsErr } = await db
    .from('classes')
    .select('id, grade, section, name, school_id')
    .eq('id', classId)
    .single();
  if (clsErr) throw clsErr;

  const stage = stageForGrade(cls.grade);
  const band  = promotionBand(cls.grade);

  const [students, subjectsRaw, gradesRes, attRes, conduct, grace, schoolRes] = await Promise.all([
    getClassStudents(classId),
    getSchoolSubjects(cls.school_id, cls.grade),
    db.from('student_grades')
      .select('student_id, subject_id, component_id, semester, mark, component:subject_components(name)')
      .eq('class_id',      classId)
      .eq('academic_year', academicYear),
    db.from('daily_student_attendance')
      .select('student_id, status')
      .eq('class_id', classId)
      .gte('date', `${academicYear.split('-')[0]}-09-01`),
    getClassConduct(classId).catch(() => ({})),
    getClassGrace(classId).catch(() => ({})),
    db.from('schools').select('min_attendance_pct, directorate:directorates(name)').eq('id', cls.school_id).single(),
  ]);
  if (gradesRes.error) throw gradesRes.error;
  if (attRes.error) throw attRes.error;

  const subjects = subjectsRaw.filter(s => s.is_active);
  const minAttendancePct = Number(schoolRes?.data?.min_attendance_pct ?? 75);

  // grades[studentId][subjectId][semester] = { total, exam, work }
  // total = Σ all component marks (the semester "المحصلة"); exam = Σ marks of
  // exam-type components (name contains امتحان/اختبار); work = the rest
  // (وظائف/شفهي/مذاكرة → "درجة الأعمال"). Matches the official الجلاء columns.
  const isExamComponent = (name) => /امتحان|اختبار/.test(name || '');
  const grades = {};
  for (const r of gradesRes.data ?? []) {
    const byStu = grades[r.student_id] ||= {};
    const bySub = byStu[r.subject_id]  ||= {};
    const cell  = bySub[r.semester]    ||= { total: 0, exam: 0, work: 0 };
    const m = Number(r.mark || 0);
    cell.total += m;
    if (isExamComponent(r.component?.name)) cell.exam += m; else cell.work += m;
  }

  // attendance[studentId] = { attended, total }  (present+late vs all recorded)
  const attendance = {};
  for (const r of attRes.data ?? []) {
    const e = attendance[r.student_id] ||= { attended: 0, total: 0 };
    e.total++;
    if (r.status === 'present' || r.status === 'late') e.attended++;
  }

  const isS1 = term === 's1';

  // Grace marks apply to bands B/C only (grades 5+). The regulation's grace
  // article covers الصفين الخامس والسادس فما فوق — grades 1-4 are judged on
  // their raw marks, so ignore any stray grace rows for band A.
  const graceApplies = band !== 'A';

  const cards = students.map(stu => {
    const stuGrades  = grades[stu.id] || {};
    const stuGrace   = (graceApplies ? grace[stu.id] : null) || { bySubject: {}, total: 0 };
    const subjResults = subjects.map(sub => {
      const sem  = stuGrades[sub.id] || {};
      const c1   = sem[1] || null;   // { total, exam, work } | null
      const c2   = sem[2] || null;
      const s1   = c1 ? c1.total : null;
      const s2   = c2 ? c2.total : null;
      const maxTotal  = Number(sub.max_total) || 100;

      // The displayed mark depends on the certificate term:
      //  • s1   → the first-semester mark alone.
      //  • year → the equal-weight average of BOTH semesters; null until both
      //           are entered, so a year card stays "incomplete" mid-year.
      let mark;
      if (isS1) {
        mark = s1;
      } else {
        mark = (s1 != null && s2 != null) ? (s1 + s2) / 2 : null;
      }
      const percent = mark == null ? null : (mark / maxTotal) * 100;
      const passed  = percent == null ? null : percent >= Number(sub.pass_mark);
      // Grace marks (درجات المساعدة) lift the subject for the promotion check.
      const graceMk = Number(stuGrace.bySubject[sub.id]) || 0;
      const markWithGrace    = mark == null ? null : mark + graceMk;
      const percentWithGrace = markWithGrace == null ? null : (markWithGrace / maxTotal) * 100;
      return {
        subjectId:    sub.id,
        name:         sub.name,
        isCoreArabic: !!sub.is_core_arabic,
        isCoreMath:   !!sub.is_core_math,
        maxTotal,
        passMark:     Number(sub.pass_mark),
        sem1:         s1,
        sem2:         s2,
        sem1Work:     c1 ? c1.work : null,
        sem1Exam:     c1 ? c1.exam : null,
        sem2Work:     c2 ? c2.work : null,
        sem2Exam:     c2 ? c2.exam : null,
        mark,
        percent,
        passed,
        grace:            graceMk,
        markWithGrace,
        percentWithGrace,
      };
    });

    const graded = subjResults.filter(s => s.mark != null);
    const complete = subjResults.length > 0 && subjResults.every(s => s.percent != null);

    // Totals (grace-applied) for the promotion gate + displayed final %.
    const sumMax   = graded.reduce((a, s) => a + s.maxTotal, 0);
    const sumMark  = graded.reduce((a, s) => a + s.markWithGrace, 0) + (Number(stuGrace.total) || 0);
    const totalPercent = sumMax ? (sumMark / sumMax) * 100 : null;
    // Grace-free total — the regulation excludes grace from ranking
    // («لا تدخل درجات المساعدة المضافة على المواد أو المجموع في حساب ترتيب النجاح»).
    const sumMarkNoGrace = graded.reduce((a, s) => a + s.mark, 0);
    const totalPercentNoGrace = sumMax ? (sumMarkNoGrace / sumMax) * 100 : null;
    const arSubs   = graded.filter(s => s.isCoreArabic);
    const arMax    = arSubs.reduce((a, s) => a + s.maxTotal, 0);
    const arabicPercent = arMax ? (arSubs.reduce((a, s) => a + s.markWithGrace, 0) / arMax) * 100 : null;

    const att = attendance[stu.id];
    const attendancePercent = att && att.total ? (att.attended / att.total) * 100 : null;
    const conductMark = conduct[stu.id] ?? null;

    // First-semester certificate shows marks + average only — no year verdict.
    const result = (!isS1 && complete)
      ? computeYearResult({
          band,
          subjects: subjResults.map(s => ({
            percent: s.percentWithGrace, isCoreArabic: s.isCoreArabic, isCoreMath: s.isCoreMath,
          })),
          totalPercent, arabicPercent,
          conductPercent: conductMark, attendancePercent, minAttendancePct,
        })
      : null;

    return {
      student: stu, subjects: subjResults,
      finalPercent: totalPercent, finalPercentNoGrace: totalPercentNoGrace,
      result, complete,
      attendancePercent, conductMark,
      graceTotal: Number(stuGrace.total) || 0,
      graceSubjects: subjResults.reduce((a, s) => a + (Number(s.grace) || 0), 0),
    };
  });

  return {
    class: cls, stage, band, term, academicYear, minAttendancePct,
    directorate: schoolRes?.data?.directorate?.name ?? '',
    students: cards,
  };
}

async function getStudentReportCard(classId, studentId, academicYear = getAcademicYear(), term = 'year') {
  const all = await getClassReportCards(classId, academicYear, term);
  const card = all.students.find(c => c.student.id === studentId) || null;
  return card
    ? { class: all.class, stage: all.stage, term: all.term, academicYear: all.academicYear, ...card }
    : null;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────
// يقبل opts.classId اختيارياً لتفعيل مرحلة السحب التدريجي (delta pull)
async function syncPendingV2({ classId } = {}) {
  const results = {
    attendance: { synced: 0, failed: 0 },
    reports:    { synced: 0, failed: 0 },
    studentAtt: { synced: 0, failed: 0 },
    grades:     { synced: 0, failed: 0 },
    conduct:    { synced: 0, failed: 0 },
    staffAtt:   { synced: 0, failed: 0 },
    students:   { synced: 0, failed: 0 },
  };

  // المرحلة 0: هجرة LS→IDB لمرة واحدة (idempotent بعد أول تشغيل)
  await migrateQueuesFromLS().catch(() => {});

  // المرحلة 1أ: تصريف IDB outbox (العناصر الجديدة)
  const _idbSyncFn = {
    attendance_submissions:   syncAttendanceRecord,
    emergency_reports:        syncReportRecord,
    daily_student_attendance: syncStudentAttendanceRecord,
    student_grades:           syncStudentGradesRecord,
    student_conduct:          syncStudentConductRecord,
    staff_attendance:         syncStaffAttendanceRecord,
    students:                 syncStudentRecord,
  };
  const _idbResultKey = {
    attendance_submissions:   'attendance',
    emergency_reports:        'reports',
    daily_student_attendance: 'studentAtt',
    student_grades:           'grades',
    student_conduct:          'conduct',
    staff_attendance:         'staffAtt',
    students:                 'students',
  };
  for (const item of await readOutbox()) {
    const syncFn  = _idbSyncFn[item.table];
    const rKey    = _idbResultKey[item.table];
    if (!syncFn || !rKey) continue;
    try {
      await syncFn(item);
      await deleteOutboxItem(item.localId);
      results[rKey].synced++;
    } catch { results[rKey].failed++; }
  }

  // المرحلة 1ب: تصريف قوائم LS القديمة (fallback + عناصر ما قبل الهجرة)
  for (const record of getPendingAttendance()) {
    try {
      await syncAttendanceRecord(record);
      markAttendanceSynced(record.localId);
      results.attendance.synced++;
    } catch { results.attendance.failed++; }
  }

  for (const report of getPendingReports()) {
    try {
      await syncReportRecord(report);
      markReportSynced(report.localId);
      results.reports.synced++;
    } catch { results.reports.failed++; }
  }

  for (const payload of getPendingStudentAttendance()) {
    try {
      await syncStudentAttendanceRecord(payload);
      markStudentAttSynced(payload.localId);
      results.studentAtt.synced++;
    } catch { results.studentAtt.failed++; }
  }

  for (const payload of getPendingStudentGrades()) {
    try {
      await syncStudentGradesRecord(payload);
      markStudentGradesSynced(payload.localId);
      results.grades.synced++;
    } catch { results.grades.failed++; }
  }

  for (const payload of getPendingStudentConduct()) {
    try {
      await syncStudentConductRecord(payload);
      markStudentConductSynced(payload.localId);
      results.conduct.synced++;
    } catch { results.conduct.failed++; }
  }

  for (const payload of getPendingStaffAttendance()) {
    try {
      await syncStaffAttendanceRecord(payload);
      markStaffAttSynced(payload.localId);
      results.staffAtt.synced++;
    } catch { results.staffAtt.failed++; }
  }

  for (const item of getPendingStudents()) {
    try {
      await syncStudentRecord(item);
      markStudentSynced(item.localId);
      results.students.synced++;
    } catch { results.students.failed++; }
  }

  // المرحلة 2: سحب تدريجي من الخادم (يتطلّب classId من الواجهة)
  if (classId && isOnline()) {
    await pullAllDelta(classId).catch(() => {});
  }

  return results;
}

// ─── Staff accounts (teacher provisioning by the principal) ──────────────────
// Account creation needs the service-role key → it runs in the admin-create-staff
// Edge Function. These wrappers invoke it (online-only) and surface its Arabic
// error messages. Credentials are read directly (RLS limits them to the school's
// own admin).
async function invokeAdminStaff(payload) {
  const { data, error } = await db.functions.invoke('admin-create-staff', { body: payload });
  if (error) {
    let msg = 'تعذّر تنفيذ العملية على الخادم.';
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function createTeacherAccount({ fullName, username, password }) {
  if (!isOnline()) throw new Error('إنشاء الحساب يتطلّب اتصالاً بالإنترنت.');
  return invokeAdminStaff({ action: 'create', fullName, username, password });
}

async function updateTeacherCredential({ userId, password, fullName }) {
  if (!isOnline()) throw new Error('التعديل يتطلّب اتصالاً بالإنترنت.');
  return invokeAdminStaff({ action: 'update', userId, password, fullName });
}

async function deactivateTeacherAccount(userId) {
  if (!isOnline()) throw new Error('التعطيل يتطلّب اتصالاً بالإنترنت.');
  return invokeAdminStaff({ action: 'deactivate', userId });
}

async function deleteTeacherAccount(userId) {
  if (!isOnline()) throw new Error('الحذف يتطلّب اتصالاً بالإنترنت.');
  return invokeAdminStaff({ action: 'delete', userId });
}

// Login info for the «معلومات تسجيل الكادر» section — RLS restricts the table to
// the school's own admin, so this only ever returns the caller's school.
async function getStaffCredentials(schoolId) {
  const { data, error } = await db
    .from('staff_credentials')
    .select('id, user_id, username, password, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id, userId: r.user_id, username: r.username,
    password: r.password, createdAt: r.created_at,
  }));
}

// ─── Notifications ───────────────────────────────────────────────────────────
// VAPID_PUBLIC_KEY: replace with the output of `npx web-push generate-vapid-keys`
// after generating your keys, also add them to Supabase Edge Function secrets.
const VAPID_PUBLIC_KEY = 'BJPKEruYPsOjR7X34522QTExr7FNilujlkD1SHgR7vWAGFswsWSnFrezgA5yQvP3gQdu_j54t20UFiR9IS4YnUw';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  const output  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function getNotifications(limit = 30) {
  const { data, error } = await db
    .from('notifications')
    .select('id, type, title, body, entity, entity_id, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function getUnreadNotificationsCount() {
  const { count, error } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

async function markNotificationRead(id) {
  const { error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);
  if (error) throw error;
}

async function markAllNotificationsRead() {
  const { error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw error;
}

function subscribeNotifications(userId, onNew) {
  const ch = db.channel('notif-' + userId)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications',
      filter: `recipient_id=eq.${userId}`,
    }, (payload) => onNew(payload.new))
    .subscribe();
  return () => db.removeChannel(ch);
}

function pushSupported() {
  return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
}

// يشترك في Web Push ويحفظ الاشتراك في Supabase. يفترض أن الإذن مُمنوح مسبقاً
// (permission === 'granted') — لا يطلب الإذن بنفسه لأنّ طلب الإذن يجب أن يقع
// ضمن إيماءة مستخدم (انظر initPushPrompt). يُعيد سلسلة حالة قابلة للفحص.
async function registerPushSubscription() {
  if (!pushSupported()) return 'unsupported';
  if (!VAPID_PUBLIC_KEY.startsWith('B') || VAPID_PUBLIC_KEY.includes('Replace')) return 'no-vapid';
  if (Notification.permission !== 'granted') return 'no-permission';
  try {
    const reg      = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub      = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const { error } = await db.functions.invoke('save-push-subscription', {
      body: { subscription: sub.toJSON() },
    });
    if (error) { console.warn('[Ruqi] push subscription save failed', error); return 'save-failed'; }
    return 'ok';
  } catch (e) {
    console.warn('[Ruqi] registerPushSubscription failed', e);
    return 'error';
  }
}

// ── نافذة/زر تفعيل الإشعارات (يُستدعى من كل بوابة بعد الدخول) ─────────────────
// لماذا هذا بدل النداء التلقائي القديم؟ لأنّ Notification.requestPermission()
// عند التحميل بلا إيماءة مستخدم: Firefox يرفضه، iOS Safari يتجاهله (ولا يعمل Push
// أصلاً إلا بعد تثبيت الـPWA)، وChrome يجعل رفض المستخدم دائماً — فلا يُنشَأ أي
// اشتراك. هنا الطلب يقع داخل نقرة زر (إيماءة صالحة على كل المتصفّحات).
const PUSH_SNOOZE_KEY = 'ruqi_push_prompt_snooze';

async function initPushPrompt({ force = false } = {}) {
  if (!pushSupported()) return;

  // إذا كان الإذن ممنوحاً: نضمن وجود اشتراك حيّ (يعالج اشتراكاً منتهياً أو جهازاً
  // جديداً) بلا أي واجهة — بصمت عند كل دخول.
  if (Notification.permission === 'granted') {
    registerPushSubscription().catch(() => {});
    return;
  }
  // مرفوض نهائياً: لا يمكن إعادة الطلب برمجياً — نصمت.
  if (Notification.permission === 'denied') return;

  // permission === 'default': نعرض زراً غير مزعج. نحترم «التأجيل» السابق.
  try {
    if (!force && localStorage.getItem(PUSH_SNOOZE_KEY)) {
      const until = Number(localStorage.getItem(PUSH_SNOOZE_KEY));
      if (Number.isFinite(until) && Date.now() < until) return;
    }
  } catch { /* localStorage محجوب → أكمل */ }

  if (document.getElementById('ruqi-push-prompt')) return; // idempotent

  if (!document.getElementById('ruqi-push-prompt-css')) {
    const st = document.createElement('style');
    st.id = 'ruqi-push-prompt-css';
    st.textContent = `
      #ruqi-push-prompt{position:fixed;inset-inline-end:16px;inset-block-end:16px;z-index:9999;
        max-width:340px;display:flex;gap:12px;align-items:flex-start;padding:14px 16px;
        border-radius:14px;background:var(--paper-2,#1a2236);color:var(--ink,#e8edf7);
        border:1px solid var(--line,#2a3550);box-shadow:0 10px 30px rgba(0,0,0,.35);
        font-family:inherit;animation:ruqiPushIn .25s ease}
      @keyframes ruqiPushIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      #ruqi-push-prompt .rpp-ico{flex:0 0 auto;font-size:22px;line-height:1.2}
      #ruqi-push-prompt .rpp-body{flex:1 1 auto;font-size:.86rem;line-height:1.6}
      #ruqi-push-prompt .rpp-body b{display:block;margin-bottom:2px;font-size:.92rem}
      #ruqi-push-prompt .rpp-actions{display:flex;gap:8px;margin-top:10px}
      #ruqi-push-prompt button{font-family:inherit;font-size:.82rem;font-weight:700;
        border-radius:9px;padding:7px 14px;cursor:pointer;border:1px solid transparent}
      #ruqi-push-prompt .rpp-yes{background:var(--accent,#35b3ac);color:#04211f}
      #ruqi-push-prompt .rpp-no{background:transparent;color:var(--ink-soft,#9fb0c9);
        border-color:var(--line,#2a3550)}
      @media (prefers-reduced-motion:reduce){#ruqi-push-prompt{animation:none}}`;
    document.head.appendChild(st);
  }

  const box = document.createElement('div');
  box.id = 'ruqi-push-prompt';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'تفعيل الإشعارات');
  box.innerHTML = `
    <div class="rpp-ico" aria-hidden="true">🔔</div>
    <div class="rpp-body">
      <b>فعّل الإشعارات الفورية</b>
      لتصلك التنبيهات المهمّة فور حدوثها حتى والتطبيق مغلق.
      <div class="rpp-actions">
        <button type="button" class="rpp-yes">تفعيل</button>
        <button type="button" class="rpp-no">لاحقاً</button>
      </div>
    </div>`;
  document.body.appendChild(box);

  box.querySelector('.rpp-no').addEventListener('click', () => {
    try { localStorage.setItem(PUSH_SNOOZE_KEY, String(Date.now() + 7 * 24 * 3600 * 1000)); } catch {}
    box.remove();
  });
  box.querySelector('.rpp-yes').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = '…';
    let perm = 'default';
    try {
      perm = await Notification.requestPermission(); // إيماءة صالحة → يعمل على كل المتصفّحات
    } catch (e) { console.warn('[Ruqi] push permission failed', e); }
    // أزِل النافذةَ فورَ بتِّ المستخدم في إذن المتصفّح — لا تُبقِها معلّقةً حتى
    // ينتهيَ التسجيلُ الشبكيّ (VAPID + حفظُ الاشتراك)، فذاك يستغرق ثوانيَ على
    // شبكةٍ بطيئة فتبدو النافذةُ عالقةً. التسجيلُ يُكمَل في الخلفية.
    try { localStorage.removeItem(PUSH_SNOOZE_KEY); } catch {}
    box.remove();
    if (perm === 'granted') {
      registerPushSubscription()
        .then(status => { if (status !== 'ok') console.warn('[Ruqi] push register status:', status); })
        .catch(e => console.warn('[Ruqi] push register failed', e));
    }
  });
}

// عندما يُدوّر الـSW الاشتراك (pushsubscriptionchange) يُرسل الاشتراك الجديد إلى
// الصفحة — نحفظه هنا لأنّ الـSW لا يملك جلسة auth. مستمع واحد لكل البوابات.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'PUSH_RESUBSCRIBED' && e.data.subscription) {
      db.functions.invoke('save-push-subscription', { body: { subscription: e.data.subscription } })
        .catch(() => {});
    }
  });
}

// Unified roster: all teachers (from users) + admins/workers (from school_personnel),
// merged with credential usernames for teachers.
const STAFF_ROSTER_CACHE_PFX = 'nsams_sroster_';

async function getFullStaffRoster(schoolId) {
  const key = STAFF_ROSTER_CACHE_PFX + schoolId;
  if (!isOnline()) {
    const hit = _readJSONCache(key);
    if (hit) return hit;
  }

  let roster;
  try {
    const [teachersRes, credRes, personnel] = await Promise.all([
      withTimeout(
        db.from('users')
          .select('id, full_name')
          .eq('role', 'teacher')
          .eq('school_id', schoolId)
          .order('full_name', { ascending: true }),
        OFFLINE_READ_TIMEOUT_MS,
      ),
      withTimeout(
        db.from('staff_credentials')
          .select('user_id, username')
          .eq('school_id', schoolId),
        OFFLINE_READ_TIMEOUT_MS,
      ),
      getSchoolPersonnel(schoolId),
    ]);
    if (teachersRes.error) throw teachersRes.error;
    if (credRes.error)     throw credRes.error;

    const credMap = Object.fromEntries((credRes.data ?? []).map(c => [c.user_id, c.username]));

    const teachers = (teachersRes.data ?? []).map(t => ({
      id: t.id, fullName: t.full_name, kind: 'teacher',
      username: credMap[t.id] ?? null,
    }));

    const others = personnel
      .filter(p => p.isActive)
      .map(p => ({ id: p.id, fullName: p.fullName, kind: p.kind, username: null }));

    roster = [...teachers, ...others];
  } catch (err) {
    const hit = _readJSONCache(key);
    if (hit) { console.warn('[Ruqi] سجلّ الكادر الكامل من المخبأ', err); return hit; }
    throw err;
  }

  _writeJSONCache(key, roster);
  return roster;
}

// ─── Holiday calendar ────────────────────────────────────────────────────────

async function getHolidays() {
  const { data, error } = await db
    .from('school_holidays').select('id, date, name, created_at').order('date');
  if (error) throw error;
  return data ?? [];
}

async function createHoliday({ date, name }) {
  const { data: { user } } = await db.auth.getUser();
  const { data, error } = await db
    .from('school_holidays')
    .insert({ date, name, created_by: user?.id ?? null })
    .select().single();
  if (error) throw error;
  return data;
}

async function deleteHoliday(id) {
  const { error } = await db.from('school_holidays').delete().eq('id', id);
  if (error) throw error;
}

/* ─── الفصل الحاليّ ───────────────────────────────────────────────────────────
   قراءةٌ مخبَّأة من `app_settings.current_term` (يضبطها المشرف). النتيجةُ
   محفوظةٌ في ذاكرة الصفحة لخمس دقائق: نافذة الجلسة تُحدَّث عند إعادة التحميل،
   والمدير لا يقلب الفصل مرّاتٍ في اليوم. عند تعذّر الجلب نسقط إلى الاشتقاق
   القديم (`month >= 9`) — أفضل من تجميدٍ أو خطأ. */
let _currentTermCache = null;
let _currentTermAt    = 0;
const CURRENT_TERM_TTL_MS = 5 * 60 * 1000;

async function getCurrentTerm() {
  if (_currentTermCache && Date.now() - _currentTermAt < CURRENT_TERM_TTL_MS) {
    return _currentTermCache;
  }
  try {
    const { data, error } = await db.rpc('current_term');
    if (error) throw error;
    const t = typeof data === 'string' ? data : (Array.isArray(data) ? data[0] : null);
    if (t) {
      _currentTermCache = t;
      _currentTermAt    = Date.now();
      return t;
    }
  } catch { /* أوفلاين أو تعذّر — نسقط إلى الاشتقاق */ }
  return (new Date().getMonth() + 1) >= 9 ? 's1' : 's2';
}

/** يُستدعى بعد أن يبدّل المشرفُ الفصل، فتُقرأ القيمة الجديدة فوراً لا بعد
 *  انقضاء المخبأ. */
function _clearCurrentTermCache() { _currentTermCache = null; }

/** تحويلٌ إلى '1'/'2' كما تُخزَّن في students.dropout_semester. */
async function getCurrentSemester() {
  const t = await getCurrentTerm();
  return t === 's1' ? '1' : '2';
}

// ─── Dropout warning ─────────────────────────────────────────────────────────

async function getDropoutRiskStudents(schoolId) {
  const { data, error } = await db
    .rpc('get_dropout_risk_students', { p_school_id: schoolId });
  if (error) throw error;
  return data ?? [];
}

async function getDirectorateDropoutSummary() {
  const { data, error } = await db.rpc('get_directorate_dropout_summary');
  if (error) throw error;
  return data ?? [];
}

async function flagStudentDropout(studentId, grade) {
  /* الفصل يُقرأ من الإعداد الوطنيّ لا من شهر الحاسوب: بدايةُ العام تتقدّم
     وتتأخّر بقرارٍ وزاريّ، ومديرٌ يرقّن قيداً في نهاية آب يُسجَّل خطأً على
     «الفصل الأول» لأنّ اليوم 30/8. current_term تُرجع 's1'/'s2'/'summer'. */
  const semester = await getCurrentSemester();
  const returnAt = grade <= 9
    ? localDateISO(new Date(Date.now() + 15 * 86400000))
    : null;
  const { error } = await db.from('students').update({
    dropout_flagged_at: new Date().toISOString(),
    dropout_semester:   semester,
    dropout_grade:      grade,
    dropout_return_at:  returnAt,
    status:             'struck_off',   // مرقّن القيد ⇒ يغادر القوائم النشطة (trigger يضبط is_active)
  }).eq('id', studentId).is('dropout_flagged_at', null);
  if (error) throw error;
}

async function getFlaggedDropoutStudents(schoolId) {
  const semester = await getCurrentSemester();
  const { data, error } = await db
    .from('students')
    .select('id, full_name, dropout_flagged_at, dropout_semester, dropout_grade, dropout_return_at, class_id, classes(name, grade)')
    .eq('school_id', schoolId)
    .not('dropout_flagged_at', 'is', null)
    .eq('dropout_semester', semester)
    .order('dropout_flagged_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─── Directorate grades coverage ─────────────────────────────────────────────

async function getDirectorateGradesCoverage() {
  const { data, error } = await db.rpc('get_directorate_grades_coverage');
  if (error) throw error;
  return data ?? [];
}

// ─── Annual promotion ────────────────────────────────────────────────────────

async function upsertYearResults(classId, results) {
  const { error } = await db.rpc('upsert_year_results', {
    p_class_id: classId,
    p_results:  results,
  });
  if (error) throw error;
}

async function executeAnnualPromotion(classId) {
  const { data, error } = await db.rpc('execute_annual_promotion', { p_class_id: classId });
  if (error) throw error;
  return data;
}

// ─── Periodic reports ─────────────────────────────────────────────────────────

async function getPeriodicReports(scope = 'directorate') {
  const { data, error } = await db.rpc('get_periodic_reports', { p_scope: scope });
  if (error) throw error;
  return data ?? [];
}

// ─── Admin (ministry_user) ────────────────────────────────────────────────────

async function getAdminDirectorates() {
  const { data, error } = await db
    .from('directorates').select('id, name, governorate').order('name');
  if (error) throw error;
  return data ?? [];
}

async function getAdminSchools() {
  const { data, error } = await db
    .from('schools')
    .select('id, name, directorate_id, directorates(name, governorate), school_type, classification, education_type, shift, student_type, total_students, total_teachers, lat, lng, complex_name, quota_min_lessons, quota_max_lessons, archived_at')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

async function createAdminSchool(data) {
  const { data: row, error } = await db.from('schools').insert(data).select().single();
  if (error) throw error;
  return row;
}

async function getAdminUsers() {
  const { data, error } = await db
    .from('users')
    .select('id, full_name, role, permission_role, school_id, directorate_id, schools(name), directorates(name)')
    .in('role', ['school_admin', 'directorate_user', 'ministry_user'])
    .order('role')
    .order('full_name');
  if (error) throw error;
  return data ?? [];
}

async function updateUserPermissionRole(userId, permissionRole) {
  const { error } = await db
    .from('users')
    .update({ permission_role: permissionRole })
    .eq('id', userId);
  if (error) throw error;
}

// ─── الوحدات والصلاحيات — لوحة التحكم المركزية (module permissions) ─────────

async function getModuleCatalog() {
  const { data, error } = await db
    .from('modules')
    .select('key, name_ar, description_ar, category, is_core, sort_order')
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

async function getRoleModulePermissions() {
  const { data, error } = await db
    .from('role_module_permissions')
    .select('role_key, module_key, is_enabled, updated_at');
  if (error) throw error;
  return data ?? [];
}

async function setRoleModulePermission(roleKey, moduleKey, isEnabled) {
  const { error } = await db
    .from('role_module_permissions')
    .upsert({ role_key: roleKey, module_key: moduleKey, is_enabled: isEnabled },
             { onConflict: 'role_key,module_key' });
  if (error) throw error;
}

async function getAuditLogAll({ schoolId, from, to, offset = 0, limit = 100 } = {}) {
  let q = db
    .from('audit_log')
    .select('id, school_id, actor_id, entity, action, changes, reason, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (schoolId) q = q.eq('school_id', schoolId);
  if (from)     q = q.gte('created_at', from);
  if (to)       q = q.lte('created_at', to);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  // audit_log.school_id has no FK constraint → manual join for school names.
  const ids = [...new Set(rows.map(r => r.school_id).filter(Boolean))];
  if (ids.length > 0) {
    const { data: schools, error: sErr } = await db
      .from('schools').select('id, name').in('id', ids);
    if (sErr) throw sErr;
    const nameMap = {};
    (schools ?? []).forEach(s => { nameMap[s.id] = s.name; });
    rows.forEach(r => { r.schools = r.school_id ? { name: nameMap[r.school_id] ?? null } : null; });
  } else {
    rows.forEach(r => { r.schools = null; });
  }
  return rows;
}

// ─── Export ───────────────────────────────────────────────────────────────────
// ── بوابة ولي الأمر — Parent Portal ──────────────────────────────────────────
// OTP مخصَّص (قابل للاستبدال بأي خلفية عبر Edge Function parent-auth)
// الجلسة: email مُركَّب {phone}@parent.nsams.local مع Supabase Auth
// الربط: parent_links (user_id ↔ student_id) يُنشأ تلقائياً في Edge Function

const PARENT_AUTH_URL = `${SUPABASE_URL}/functions/v1/parent-auth`;
const EXCUSE_BUCKET = 'excuse-photos';

function _normalizePhone(raw) {
  let p = String(raw ?? '').replace(/[\s\-\(\)]/g, '');
  if (!p) return '';
  if (p.startsWith('00963')) p = '+963' + p.slice(5);
  else if (p.startsWith('0963')) p = '+963' + p.slice(4);
  else if (p.startsWith('963')) p = '+' + p;
  else if (p.startsWith('09')) p = '+963' + p.slice(1);
  else if (p.startsWith('+9639')) { /* already normalized */ }
  return p;
}

async function parentRequestOtp(phone) {
  const normalized = _normalizePhone(phone);
  if (!normalized) throw new Error('رقم الهاتف غير صالح');
  const res = await fetch(PARENT_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               apikey: SUPABASE_ANON_KEY, },
    body: JSON.stringify({ action: 'request_otp', phone: normalized }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'تعذَّر إرسال رمز التحقق');
  return true;
}

async function parentVerifyOtp(phone, code) {
  const normalized = _normalizePhone(phone);
  const res = await fetch(PARENT_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               apikey: SUPABASE_ANON_KEY, },
    body: JSON.stringify({ action: 'verify_otp', phone: normalized, code: String(code).trim() }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'رمز التحقق غير صحيح');
  const { access_token, refresh_token } = body;
  if (!access_token) throw new Error('استجابة غير متوقعة من الخادم');
  const { error } = await db.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  return true;
}

async function parentLogout() {
  await db.auth.signOut();
}

async function parentGetMyStudents() {
  // Self-healing link: rebuild parent_links from the caller's phone every load,
  // so students added (or fixed) after the OTP-verify step still appear. Errors
  // are non-fatal — fall through to whatever links already exist.
  try {
    const { data, error } = await db.rpc('parent_sync_links');
    if (error) {
      // Most likely the function/migration hasn't been applied yet — make it loud
      // so setup gaps are diagnosable instead of silently showing "no students".
      console.error('[parent] parent_sync_links RPC failed — run tools/backfill-parent-phone.sql in Supabase:', error.message || error);
    } else {
      console.info('[parent] parent_sync_links linked', data, 'new student(s)');
    }
  } catch (e) {
    console.error('[parent] parent_sync_links threw:', e);
  }

  const { data, error } = await db
    .from('parent_links')
    /* status وstatus_reason لم تكونا تُقرآن، فكان الطالب يُرقَّن قيدُه أو
       يُنقَل وتظهر بوّابة أهله كما كانت بالضبط — لا تنبيه ولا أثر. وهي أخطر
       إجراءٍ في النظام: إخراجُ طفلٍ من السجلّ يجب ألّا يمرّ بلا علم أهله. */
    .select('student:student_id(id, full_name, gender, class_id, school_id, status, status_reason, school:school_id(id, name), class:class_id(id, name, grade, section))')
    .order('linked_at');
  if (error) throw error;
  return (data ?? []).map(r => r.student).filter(Boolean);
}

async function parentGetStudentAttendance(studentId, year, month) {
  // year: رقم 4 أرقام، month: 1-12
  const from = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  const { data, error } = await db
    .from('daily_student_attendance')
    .select('date, status, reason')
    .eq('student_id', studentId)
    .gte('date', from)
    .lte('date', to)
    .order('date');
  if (error) throw error;
  return data ?? [];
}

/* حضور الابن على مدى العام الدراسي كلّه (لا شهراً واحداً). تلزم لبطاقة الملخّص
   وعدّاد الغياب: نسبةُ حضورٍ شهريةٌ وحدها لا تقول للوليّ أين ابنُه من حدّ الإنذار.
   العام الدراسي السوري يبدأ في أيلول، فالمدى من 09-01 حتى 08-31 التالية. */
async function parentGetStudentAttendanceYear(studentId, academicYear) {
  const startYear = parseInt(String(academicYear).slice(0, 4), 10);
  if (!Number.isFinite(startYear)) return [];
  const from = `${startYear}-09-01`;
  const to   = `${startYear + 1}-08-31`;
  const { data, error } = await db
    .from('daily_student_attendance')
    .select('date, status, reason')
    .eq('student_id', studentId)
    .gte('date', from)
    .lte('date', to)
    .order('date');
  if (error) throw error;
  return data ?? [];
}

async function parentGetStudentGrades(studentId, academicYear) {
  const { data, error } = await db
    .from('student_grades')
    .select('subject_id, component_id, semester, mark, subject:subjects(name, max_total, sort_order), component:subject_components(name, max_mark, sort_order)')
    .eq('student_id', studentId)
    .eq('academic_year', academicYear)
    .order('semester');
  if (error) throw error;
  return data ?? [];
}

/* درجة السلوك (0..100) — صفٌّ واحد للطالب في العام الدراسيّ. سياسة
   parent_read_linked_conduct تحصرها بأبناء المستدعي. تعيد null إن لم تُدخَل
   بعد، فتعرض الواجهة «—» بدل صفرٍ يُقرأ حكماً على الطالب. */
async function parentGetStudentConduct(studentId, academicYear) {
  const { data, error } = await db
    .from('student_conduct')
    .select('mark')
    .eq('student_id',    studentId)
    .eq('academic_year', academicYear)
    .maybeSingle();
  if (error) throw error;
  return data?.mark ?? null;
}

async function parentRestoreSession() {
  const { data: { session } } = await db.auth.getSession();
  return session ?? null;
}

/* النطاق صريحٌ لا سنةٌ ميلادية: العام الدراسيّ السوريّ يمتدّ أيلول→آب فيعبر
   رأس السنة، والوزارة تُدخل عطل العام القادم مسبقاً. حصرُ الاستعلام في السنة
   الميلادية الجارية كان يُسقط عطلةَ كانون الثاني القادمة من القائمة والتقويم
   معاً — يراها المشرف مُدخَلة ولا يراها وليّ الأمر إطلاقاً. */
async function parentGetHolidays(from, to) {
  const { data, error } = await db
    .from('school_holidays')
    .select('date, name')
    .gte('date', from)
    .lte('date', to)
    .order('date');
  if (error) throw error;
  return data ?? [];
}

async function parentGetAbsenceExcuses(studentId) {
  const { data, error } = await db
    .from('absence_excuses')
    // review_note: ملاحظة المدرسة عند القبول/الرفض. كانت غير مُختارة إطلاقاً،
    // فيرى الوليّ «مرفوض» بلا أيّ سبب — والسبب مكتوبٌ في قاعدة البيانات.
    .select('id, date, reason, photo_url, status, review_note, created_at')
    .eq('student_id', studentId)
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function parentSubmitAbsenceExcuse(studentId, schoolId, date, reason, photoUrl) {
  const payload = {
    student_id: studentId,
    school_id:  schoolId,
    date,
    reason,
    photo_url:  photoUrl || null,
  };
  const { error } = await db.from('absence_excuses').insert(payload);
  if (error) {
    if (/unique|duplicate/i.test(error.message))
      throw new Error('تم تقديم عذر لهذا اليوم مسبقاً');
    throw error;
  }
  return true;
}

/* إعادة تقديم عذرٍ رُفِض. عبر RPC لا UPDATE مباشر: قيد unique(student_id,date)
   يمنع إدراج عذرٍ ثانٍ لليوم نفسه، وسياسةُ UPDATE لا تُثبّت الأعمدة فكان وليّ
   أمرٍ يملك ابنين يستطيع نقلَ عذرٍ إلى يومٍ أو ابنٍ آخر. الدالّة تعدّل السبب
   والصورة فقط وتعيد الحالة إلى 'pending'. photoUrl صريح: null يزيل الصورة. */
async function parentResubmitAbsenceExcuse(excuseId, reason, photoUrl) {
  const { error } = await db.rpc('parent_resubmit_excuse', {
    p_excuse_id: excuseId,
    p_reason:    reason,
    p_photo_url: photoUrl || null,
  });
  if (error) throw error;
  return true;
}

async function parentUploadExcusePhoto(dataUri) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUri);
  if (!m) return dataUri;
  const mime = m[1];
  const b64  = m[2];
  const ext  = (mime.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const path = `excuses/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await db.storage
    .from(EXCUSE_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw error;
  /* يُعاد المسار لا رابطٌ عامّ: الدلو صار خاصّاً (هجرة 20260809000200) لأنّ
     الرابط العامّ الدائم يكشف تقريراً طبّياً لقاصر لكلّ من يحصل عليه. القراءة
     تمرّ بـparentGetExcusePhotoUrl التي توقّع رابطاً موقّتاً. */
  return path;
}

/* رابطٌ موقَّتٌ لعرض صورة العذر. يقبل مسار التخزين، ويقبل أيضاً رابطاً عامّاً
   قديماً كاملاً احتياطاً (الهجرة وحّدت الصفوف، لكنّ مخبأ الجهاز قد يحمل الشكل
   القديم حتى أوّل تحديث). يعيد null عند تعذّر التوقيع فتُخفي الواجهة الصورة
   بدل أن تعرض إطاراً مكسوراً. */
async function parentGetExcusePhotoUrl(stored, ttlSeconds = 300) {
  if (!stored) return null;
  const m = /\/excuse-photos\/(.+)$/.exec(stored);
  const path = (m ? m[1] : stored).replace(/^\/+/, '');
  if (!path) return null;
  try {
    const { data, error } = await db.storage
      .from(EXCUSE_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    if (error) throw error;
    return data?.signedUrl ?? null;
  } catch (e) {
    console.warn('[Ruqi] تعذّر توقيع رابط صورة العذر', e);
    return null;
  }
}

/* ── جانب المدرسة من أعذار الغياب ──────────────────────────────────────────
   كان الوليّ يرفع العذر ولا يقرؤه أحد: لا استعلامَ ولا واجهةَ مراجعةٍ في أيّ
   بوّابة، فتبقى الأعذار 'pending' إلى الأبد. RLS تحصر الصفوف بمدرسة المستدعي
   (school_admin_read_excuses)، وeq('school_id') هنا حزامٌ ثانٍ لا بديل عنها. */
async function schoolListAbsenceExcuses(schoolId, { status = null, limit = 200 } = {}) {
  let q = db
    .from('absence_excuses')
    .select('id, student_id, date, reason, photo_url, status, review_note, created_at, ' +
            'student:student_id(id, full_name, class:class_id(grade, section))')
    .eq('school_id', schoolId)
    // المعلَّق أوّلاً ثمّ الأحدث: ما ينتظر قراراً يتصدّر بلا فرزٍ يدويّ.
    .order('status', { ascending: true })
    .order('date',   { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/* القرار عبر RPC لا UPDATE مباشر: السياسة تحكم أيَّ الصفوف تُحدَّث لا أيَّ
   الأعمدة، فمديرٌ يملك UPDATE على أعذار مدرسته يستطيع تغيير تاريخ العذر أو
   سببه — تزويرُ مستندٍ قدّمه وليّ الأمر. والدالّة تقلب سجلَّ الحضور إلى
   'excused' في المعاملة نفسها فلا يُحتسب اليوم غياباً بعد قبول عذره. */
async function schoolReviewAbsenceExcuse(excuseId, decision, note) {
  const { error } = await db.rpc('school_review_excuse', {
    p_excuse_id: excuseId,
    p_decision:  decision,
    p_note:      note || null,
  });
  if (error) throw error;
  return true;
}

// Canonical HTML escaper for safe interpolation of user/DB text into innerHTML.
// Escapes the five characters that can break out of element text or attribute
// contexts. Use this in every portal that builds markup from DB strings.
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─── حزام أمان لطبقة العرض (permissions) ────────────────────────────────────
   بديلٌ يُظهر كل شيء، يُنشَر قبل تحميل shared/permissions.js وتَدهسه النسخةُ
   الحقيقية فور تنفيذها. موضعه هنا لأنّ db.js هو الوحيد المضمون حضورُه: كل
   بوّابة تُحمّله، وهو ضمن CRITICAL في sw.js — أيّ فشل في تخزينه يرفض تثبيت
   العامل كلَّه فيبقى الكاش السليم السابق.

   لماذا أصلاً: البوّابات تنادي RUQI_PERMISSIONS.init/isEnabled/applyToDom
   مباشرةً بلا حارس، وأوّلها سطرٌ في initApp. فتعذّرُ تحميل ملفٍّ واحدٍ من طبقة
   عرض كان يُسقط اللوحة بأكملها إلى شاشة الدخول. طبقةُ عرضٍ لا يجوز أن تملك هذه
   السلطة؛ وfail-open هو بالضبط ما تفعله permissions.js نفسها عند تعذّر جلب
   المصفوفة (تُظهر كل شيء وتترك RLS يحكم)، فالبديل يطابق عقدها لا يخالفه. */
window.RUQI_PERMISSIONS ??= {
  init:         async () => null,
  isEnabled:    () => true,
  applyToDom:   () => new Set(),
  firstEnabled: (candidates) => candidates?.[0] ?? null,
};

window.RUQI_DB = {
  // Auth
  login,
  logout,
  getCurrentUser,
  changePassword,

  // رسائل المستخدم — مصدر واحد لترجمة الأخطاء في البوّابات الستّ
  errMessage,
  isNetworkError,

  // طزاجة البيانات — نفس المنطق للبوّابات الستّ بدل ستّ نسخ منه
  getLastServerReadAt,
  formatDataAge,

  // Schools
  getSchools,
  getSchoolStatus,
  getDailyAttendance,
  getSchoolById,
  updateSchool,

  // Workflow requests (school ↔ directorate)
  createSchoolRequest,
  getSchoolRequests,
  getDirectorateRequests,
  reviewSchoolRequest,

  // School-level attendance & reports
  saveAttendance,
  getPendingAttendance,
  markAttendanceSynced,
  submitReport,
  getPendingReports,
  markReportSynced,

  // Directorate
  getReportsForDirectorate,
  getReportsForSchool,
  updateReportStatus,
  getTodaySummary,
  getSchoolsAttendanceStatus,
  getDirectorateCompliance,
  sendAttendanceReminder,
  getDirectorateTrend,
  getSchoolTrend,

  // Ministry
  getMinistryAttendanceSummary,
  getGovernoratesCount,

  // Teacher layer
  getAcademicYear,
  localDateISO,
  gradeNameAr,
  stageForGrade,
  getTeacherClasses,
  getClassStudents,
  getClassSubmissionStatus,
  getClassAttendanceForDate,
  getClassAttendanceReport,
  getClassAbsenceLog,
  getClassAbsenceSummary,
  // School-admin class/teacher management
  getSchoolClasses,
  getTeachersBySchool,
  getClassTeachers,
  assignTeacherToClass,
  removeTeacherFromClass,
  hasTodayAttendance,
  saveStudentAttendance,
  getPendingStudentAttendance,

  // Student records (SIS) — create / edit / transfer / archive / import
  saveStudent,
  archiveStudent,
  transferStudent,
  setStudentStatus,
  findDuplicateStudent,
  bulkImportStudents,
  getPendingStudents,
  writeAudit,

  // Teacher account provisioning (principal-created logins)
  createTeacherAccount,
  updateTeacherCredential,
  deactivateTeacherAccount,
  deleteTeacherAccount,
  getStaffCredentials,
  getFullStaffRoster,

  // Staff attendance (دوام الموظفين)
  getSchoolPersonnel,
  addPersonnel,
  syncPersonnelFromStaffRecord,
  deactivatePersonnelForStaffRecord,
  updatePersonnel,
  setPersonnelActive,
  teacherCheckIn,
  teacherCheckOut,
  getMyStaffAttendanceToday,
  getStaffAttendanceForDate,
  upsertStaffAttendance,
  computeStaffDailyCounts,
  getPendingStaffAttendance,

  // School admin — class management
  getSchoolDailySummary,
  confirmClassSubmission,
  rejectClassSubmission,

  // Grades & report cards
  getSchoolSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  getSubjectComponents,
  setSubjectComponents,
  countGradesForComponents,
  getSubjectCatalog,
  createCatalogSubject,
  updateCatalogSubject,
  deleteCatalogSubject,
  syncFullMarksFromCatalog,
  getCatalogComponents,
  setCatalogComponents,
  passMarkFor,
  getGradePassRules,
  setGradePassRules,
  resolvePassMark,
  applyCatalogSubjectsToGrades,
  getClassGradeSubjects,
  getClassGrades,
  saveStudentGrades,
  getPendingStudentGrades,
  getClassConduct,
  saveStudentConduct,
  getPendingStudentConduct,
  getClassGrace,
  setStudentGrace,
  getGraceProposals,
  getMyGraceProposals,
  getGraceProposalById,
  proposeGrace,
  decideGraceProposal,
  getClassReportCards,
  getStudentReportCard,
  promotionBand,

  // Sync
  syncPending: syncPendingV2,

  // Notifications & Web Push
  getNotifications,
  getUnreadNotificationsCount,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeNotifications,
  registerPushSubscription,
  initPushPrompt,
  escapeHtml,

  // Holiday calendar
  getHolidays,
  createHoliday,
  deleteHoliday,

  // Dropout warning
  getDropoutRiskStudents,
  getDirectorateDropoutSummary,
  getDirectorateSchoolStats,
  getMinistryGovernorateStats,
  getMinistrySchoolStats,
  getTeachingLoad,
  getStaffDirectory,
  flagStudentDropout,
  getFlaggedDropoutStudents,

  // Directorate grades coverage
  getDirectorateGradesCoverage,

  // Annual promotion
  upsertYearResults,
  executeAnnualPromotion,

  // Periodic reports
  getPeriodicReports,

  // Admin (ministry_user) — system management
  getAdminDirectorates,
  getAdminSchools,
  createAdminSchool,
  getAdminUsers,
  updateUserPermissionRole,
  getAuditLogAll,

  // الوحدات والصلاحيات — لوحة التحكم المركزية
  getModuleCatalog,
  getRoleModulePermissions,
  setRoleModulePermission,

  // البيان الشهري — القوائم المرجعية وسجل الكوادر
  getLookupList,
  getStaffRecords,
  getCorrespondenceThreads,
  getCorrespondenceMessages,
  openCorrespondence,
  sendCorrespondence,
  markCorrespondenceRead,
  setCorrespondenceStatus,
  saveDailyAbsentStaff,
  getDailyAbsentStaff,
  getStaffAbsenceRegister,
  createStaffRecord,
  updateStaffRecord,
  softDeleteStaffRecord,
  getStaffLeaves,
  getMyStaffLeaves,
  getDepartedStudents,
  getDirectorateDepartures,
  getTeachingQuotaBounds,
  setTeachingQuotaBounds,
  getCurrentTerm,
  getCurrentSemester,
  _clearCurrentTermCache,
  getLeavesRegister,
  getLeavesSummary,
  upsertStaffLeave,
  deleteStaffLeave,
  getSchoolStudentStats,
  getMonthlyStatement,
  submitMonthlyStatement,
  getDirectorateStatements,
  getStatementSnapshot,
  reviewMonthlyStatement,

  // البيان الشهري — المسودة الحيّة والتعديلات الطارئة (§20)
  ensureDraftStatement,
  saveStatementDraft,
  getPreviousStatementSnapshot,
  getStatementChanges,
  upsertStatementChange,
  deleteStatementChange,
  getSchoolBuilding,
  saveSchoolBuilding,
  getSchoolProfile,
  saveSchoolProfile,
  saveStatementRosters,

  // Report photo resolution (signed URLs for private bucket)
  resolveReportPhotos,

  // Parent Portal (بوابة ولي الأمر)
  parentRequestOtp,
  parentVerifyOtp,
  parentLogout,
  parentRestoreSession,
  parentGetMyStudents,
  parentGetStudentAttendance,
  parentGetStudentAttendanceYear,
  parentGetStudentGrades,
  parentGetStudentConduct,
  parentGetHolidays,
  parentGetAbsenceExcuses,
  parentSubmitAbsenceExcuse,
  parentResubmitAbsenceExcuse,
  parentUploadExcusePhoto,
  parentGetExcusePhotoUrl,

  // مراجعة الأعذار من بوّابة المدرسة (توقيعُ رابط الصورة يمرّ بالدالّة نفسها —
  // السياسة school_admin_read_excuse_photos هي ما يسمح للمدير بالتوقيع).
  schoolListAbsenceExcuses,
  schoolReviewAbsenceExcuse,

  // السجل الوطني — المرحلة 2
  lookupNationalStudent,
  lookupNationalStaff,
  linkStudentToRegistry,
  linkStaffToRegistry,

  // التكاليف — المرحلة 3أ
  getStaffAssignments,
  upsertStaffAssignment,
  endStaffAssignment,
  getDirectorateSchoolAssignments,

  // الجلاءات — المرحلة 3ب
  getResultSheet,
  submitResultSheet,
  getDirectorateResultSheets,
  getResultSheetSnapshot,
  getResultSheetSnapshotsForDirectorate,
  reviewResultSheet,
  getMinistryResultSheets,

  // المزامنة التدريجية + IndexedDB — المرحلة 4ب
  getDeviceId,
  migrateQueuesFromLS,
  pullAllDelta,

  // تنظيف مخابئ المستأجِر عند الخروج
  purgeTenantCaches,

  // أدوات الصمود أوفلاين — تُستعمل في البوّابات التي تحمّل db.js عبر window
  // (لا عبر import) كي يبقى حارسُ «تعذّر تحميل db.js» فيها عاملاً.
  withTimeout,
  isOnline,

  // الاستيراد الجماعي من لوحة المديرية — §24
  getSchoolClassesForDirectorate,
  directorateBulkImportStudents,
  directorateBulkImportStaff,

  // وثائق «لا مانع» — §23
  lookupStudentForTransfer,
  issueTransferDocument,
  reviewTransferDocument,
  cancelTransferDocument,
  getTransferDocuments,
};

// ─────────────────────────────────────────────────────────────────────────────
// §14 — البيان الشهري: القوائم المرجعية وسجل الكوادر
// ─────────────────────────────────────────────────────────────────────────────

async function getLookupList(listType, directorateId = null) {
  let q = db.from('lookup_lists')
    .select('value, sort_order')
    .eq('list_type', listType)
    .eq('active', true)
    .order('sort_order')
    .order('value');
  q = directorateId
    ? q.or(`directorate_id.is.null,directorate_id.eq.${directorateId}`)
    : q.is('directorate_id', null);
  // withTimeout: قوائم البحث تُجلب عند فتح النوافذ؛ بلا مهلة تتعلّق القائمة على
  // شبكة «متصلة لكن ميتة». المستدعي (getLookup) يلتقط الرمي ويكتفي بقائمة فارغة.
  const { data, error } = await withTimeout(q, OFFLINE_READ_TIMEOUT_MS);
  if (error) throw error;
  return (data || []).map(r => r.value);
}

/* ── غيابُ الكادر اليوميّ ─────────────────────────────────────────────────────
   الأسماءُ كانت تُكتب في البيان ثمّ تُرمى: daily_attendance فيها عددُ الغائبين
   لا مَن هم. تُحفظ الآن سجلّاً مستقلاًّ فيُعرف «كم يوماً غاب فلان».

   الحفظُ استبدالٌ لليوم كلِّه لا إضافة: المدير قد يُرسل البيان مرّتين بعد
   تصحيح، فالإضافةُ تُضاعف الغياب على البريء. */
async function saveDailyAbsentStaff(schoolId, date, entries) {
  if (!schoolId || !date) return;
  const { data: auth } = await db.auth.getUser();
  const uid = auth?.user?.id ?? null;

  const { error: delErr } = await db.from('daily_absent_staff')
    .delete().eq('school_id', schoolId).eq('date', date);
  if (delErr) throw delErr;

  const rows = (entries || [])
    .filter(a => a && a.name)
    .map(a => ({
      school_id: schoolId, date,
      staff_id: a.staffId ?? null,
      staff_name: a.name,
      kind: a.kind ?? 'admin',
      created_by: uid,
    }));
  if (!rows.length) return;
  const { error } = await db.from('daily_absent_staff').insert(rows);
  if (error) throw error;
}

/** الغائبون المسجَّلون ليومٍ بعينه — لإعادة بناء الشاشة عند العودة إليها. */
async function getDailyAbsentStaff(schoolId, date) {
  const { data, error } = await db.from('daily_absent_staff')
    .select('staff_id, staff_name, kind')
    .eq('school_id', schoolId).eq('date', date)
    .order('staff_name');
  if (error) throw error;
  return (data || []).map(r => ({ staffId: r.staff_id, name: r.staff_name, kind: r.kind }));
}

/** سجلّ الغياب: صفٌّ لكلّ شخصٍ بعدد أيّامه. النطاق يُشتقّ من الدور. */
async function getStaffAbsenceRegister({ schoolId = null, month = null, year = null } = {}) {
  const { data, error } = await db.rpc('get_staff_absence_register', {
    p_school_id: schoolId, p_month: month, p_year: year,
  });
  if (error) throw error;
  return data ?? [];
}

/* ── المراسلات الإدارية: الوزارة ↔ المديرية ↔ المدرسة ────────────────────────
   قناةٌ نصّية حرّة لما لا يقع في نموذج: «متى يبدأ الدوام الصيفيّ؟»، «أرسلوا لنا
   معلّم رياضيات». كان يُقال هاتفياً فلا يبقى منه أثر. */
async function getCorrespondenceThreads() {
  const { data, error } = await db.rpc('get_correspondence_threads');
  if (error) throw error;
  return data ?? [];
}

async function getCorrespondenceMessages(threadId) {
  const { data, error } = await db.from('correspondence_messages')
    .select('id, body, sender_side, created_at, sender:sender_id(full_name)')
    .eq('thread_id', threadId)
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

/* الفتحُ ثمّ أوّلُ رسالةٍ عمليّةٌ واحدة في نظر المستخدم: خيطٌ بموضوعٍ بلا نصّ
   يصل الطرفَ الآخر فارغاً فلا يعرف ما المطلوب. */
async function openCorrespondence({ subject, directorateId, schoolId = null, side, body }) {
  const { data: auth } = await db.auth.getUser();
  const uid = auth?.user?.id ?? null;
  const { data, error } = await db.from('correspondence_threads')
    .insert({ subject, directorate_id: directorateId, school_id: schoolId,
              opened_by: uid, opened_side: side })
    .select('id').single();
  if (error) throw error;
  await sendCorrespondence(data.id, side, body);
  return data.id;
}

async function sendCorrespondence(threadId, side, body) {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from('correspondence_messages')
    .insert({ thread_id: threadId, body, sender_side: side,
              sender_id: auth?.user?.id ?? null });
  if (error) throw error;
}

/* ختمُ القراءة لجانبي أنا وحدي — الزنادُ في القاعدة يُثبّت ختمَي الآخرَين
   مهما أُرسل هنا، فلا يُخفي طرفٌ إشعارَ الآخر. */
async function markCorrespondenceRead(threadId, side) {
  const col = side === 'ministry' ? 'ministry_read_at'
            : side === 'directorate' ? 'directorate_read_at' : 'school_read_at';
  const { error } = await db.from('correspondence_threads')
    .update({ [col]: new Date().toISOString() }).eq('id', threadId);
  if (error) throw error;
}

async function setCorrespondenceStatus(threadId, status) {
  const { error } = await db.from('correspondence_threads')
    .update({ status }).eq('id', threadId);
  if (error) throw error;
}

async function getStaffRecords(schoolId) {
  const { data, error } = await db.from('staff_records')
    .select('*')
    .eq('school_id', schoolId)
    .eq('active', true)
    .order('staff_type')
    .order('full_name');
  if (error) throw error;
  return data || [];
}

async function createStaffRecord(payload) {
  const { data, error } = await db.from('staff_records')
    .insert({ ...payload, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateStaffRecord(id, payload) {
  const { data, error } = await db.from('staff_records')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function softDeleteStaffRecord(id) {
  const { error } = await db.from('staff_records')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/* «إجازاتي» للمعلّم: يقرأ ما سُجِّل عليه في مدرسته لهذه السنة.
   RLS الجديدة (staff_leaves_own_read) تسمح بالقراءة بمطابقة اسمٍ داخل مدرسة —
   لا رابطَ مباشر بين staff_records.id و users.id في المخطّط. */
async function getMyStaffLeaves(schoolId, { year } = {}) {
  if (!schoolId) return [];
  let q = db.from('staff_leaves')
    .select('id, leave_type, leave_days, month, year, note, created_at')
    .eq('school_id', schoolId)
    .order('year', { ascending: false })
    .order('month', { ascending: false });
  if (year) q = q.eq('year', year);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function getStaffLeaves(schoolId, month, year) {
  const { data, error } = await db.from('staff_leaves')
    .select('*')
    .eq('school_id', schoolId)
    .eq('month', month)
    .eq('year', year)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

/* الطلاب المغادرون: تبويبٌ عابر للصفوف في المدرسة، وكشفُ مدارس المديرية.
   RPC بنطاقٍ يُشتقّ من الدور — مديرُ مدرسةٍ يمرّر معرّف مدرسةٍ أجنبية يُفرغ
   نتيجته لا يوسّعه. */
async function getDepartedStudents({ schoolId = null, status = null } = {}) {
  const { data, error } = await db.rpc('get_departed_students', {
    p_school_id: schoolId, p_status: status,
  });
  if (error) throw error;
  return data ?? [];
}

async function getDirectorateDepartures() {
  const { data, error } = await db.rpc('get_directorate_departures');
  if (error) throw error;
  return data ?? [];
}

/* سجلّ الإجازات: سطرٌ لكلّ إجازة باسم صاحبها، بنطاقٍ يُشتقّ من الدور.
   الإجازة كانت تُدخَل في نافذةٍ تخصّ موظّفاً واحداً ولا تُقرأ إلا منها — فلا
   موضعَ في التطبيق كلِّه يقول «كم إجازةً في مدرستي هذا الشهر». */
async function getLeavesRegister(month, year, schoolId = null) {
  const { data, error } = await db.rpc('get_leaves_register', {
    p_month: month, p_year: year, p_school_id: schoolId || null,
  });
  if (error) throw error;
  return data ?? [];
}

// مجاميع: للمدرسة نفسها، وللمديرية بمدارسها، وللوزارة بمحافظاتها. الوزارة تقرأ
// هذه وحدها — لا سطورَ بأسماء الكادر على مستوى القطر.
async function getLeavesSummary(month, year) {
  const { data, error } = await db.rpc('get_leaves_summary', {
    p_month: month, p_year: year,
  });
  if (error) throw error;
  return data ?? [];
}

// onConflict يعتمد على الفهرس الفريد staff_leaves_unique_period (§20.5).
// قبل إضافته كان هذا الاستدعاء يفشل وقت التنفيذ لأن القيد لم يكن موجوداً.
async function upsertStaffLeave(payload) {
  const { data, error } = await db.from('staff_leaves')
    .upsert(payload, { onConflict: 'staff_id,leave_type,month,year' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteStaffLeave(id) {
  const { error } = await db.from('staff_leaves').delete().eq('id', id);
  if (error) throw error;
}

// إحصائية طلاب المدرسة للبيان.
// يعيد { 'grade': { sections, male, female, lang: { 'انكليزي': {m,f}, … } } }
// تقسيم اللغة يأتي من classes.foreign_language (§20.4) فتُؤتمت أعمدة اللغة
// الأجنبية الستّة في جدول البيان بدل إدخال أربعة منها يدوياً كل شهر.
async function getSchoolStudentStats(schoolId) {
  const [clsRes, stuRes] = await Promise.all([
    db.from('classes').select('id, grade, section, foreign_language').eq('school_id', schoolId),
    db.from('students').select('class_id, gender').eq('school_id', schoolId).eq('is_active', true),
  ]);
  if (clsRes.error) throw clsRes.error;
  if (stuRes.error) throw stuRes.error;
  const byClass = {};
  for (const c of clsRes.data || []) {
    byClass[c.id] = {
      grade: String(c.grade ?? ''),
      // العمود قد يكون null على صفوف أُنشئت قبل الهجرة — الافتراضي انكليزي.
      lang: c.foreign_language || 'انكليزي',
      male: 0, female: 0,
    };
  }
  for (const s of stuRes.data || []) {
    const e = byClass[s.class_id]; if (!e) continue;
    if (s.gender === 'female') e.female++; else e.male++;
  }
  const grades = {};
  for (const e of Object.values(byClass)) {
    const g = grades[e.grade] ??= { sections: 0, male: 0, female: 0, lang: {} };
    g.sections++; g.male += e.male; g.female += e.female;
    const L = g.lang[e.lang] ??= { m: 0, f: 0 };
    L.m += e.male; L.f += e.female;
  }
  return grades;
}

// ── سير موافقة البيان الشهري (مدرسة → مديرية) ────────────────────────────────

// البيان الحالي لفترة معيّنة (للمدرسة لمعرفة الحالة)
async function getMonthlyStatement(schoolId, month, year) {
  const { data, error } = await db.from('monthly_statements')
    .select('id, status, notes, submitted_at, reviewed_at')
    .eq('school_id', schoolId).eq('month', month).eq('year', year)
    .maybeSingle();
  if (error) throw error;
  return data;          // null إن لم يوجد
}

// إرسال/إعادة إرسال البيان (select-then-insert/update لاحترام RLS)
async function submitMonthlyStatement(schoolId, month, year, snapshot) {
  const existing = await getMonthlyStatement(schoolId, month, year);
  if (existing && existing.status === 'approved')
    throw new Error('البيان معتمد بالفعل ولا يمكن تعديله');
  if (existing && existing.status === 'submitted')
    throw new Error('البيان مُرسَل بالفعل وبانتظار المراجعة');
  const row = { school_id: schoolId, month, year, status: 'submitted',
                snapshot_data: snapshot, submitted_at: new Date().toISOString(),
                updated_at: new Date().toISOString() };
  if (existing) {       // draft|rejected → submitted (RLS يسمح)
    const { error } = await db.from('monthly_statements')
      .update(row).eq('id', existing.id);
    if (error) throw error;
  } else {              // insert جديد
    const { error } = await db.from('monthly_statements').insert(row);
    if (error) throw error;
  }
}

// المديرية: كل بيانات مدارسها (RLS يُرشِّح تلقائياً) + اسم المدرسة
/* ⚠ snapshot_data خارج قائمةِ العرض عمداً. كانت تُجلب مع ٣٠٠ صفّ، واللقطةُ
   الواحدة تحمل كشفَ المدرسة كاملاً — فتصل ميغاباتٌ لرسم جدولٍ أعمدتُه: اسمُ
   المدرسة والشهر والحالة. وهو سببُ ما رآه المستخدم: بطاقةُ «طلبات المدارس»
   تظهر فوراً (استعلامُها خفيف) بينما تبقى الجلاءات والبيانات تدور ثمّ تظهر
   وحدها بعد حين. تُجلب اللقطةُ الآن عند فتح النافذة وحدها — واحدةً لا ثلاثمئة. */
async function getDirectorateStatements() {
  const { data, error } = await db.from('monthly_statements')
    .select('id, school_id, month, year, status, notes, submitted_at, reviewed_at, school:schools(name)')
    .order('submitted_at', { ascending: false }).limit(300);
  if (error) throw error;
  return data ?? [];    // الترتيب «المُرسَل أولاً» يتم في الواجهة
}

async function reviewMonthlyStatement(statementId, decision, notes = null) {
  const { error } = await db.rpc('review_monthly_statement', {
    p_statement_id: statementId, p_decision: decision, p_notes: notes || null });
  if (error) throw error;
  return true;
}

// ── §20 — المسودة الحيّة، هوية المدرسة، البناء، التعديلات، السير الذاتية ─────

// صفّ البيان يجب أن يوجد قبل أي شيء آخر: سطور التعديلات الطارئة تحمل
// statement_id، والحفظ التلقائي لكل قسم يكتب في snapshot_data. يعيد الصفّ
// كاملاً (id + status + snapshot_data) لا الـ id وحده.
async function ensureDraftStatement(schoolId, month, year) {
  const { data: found, error: selErr } = await db.from('monthly_statements')
    .select('id, status, notes, snapshot_data, submitted_at, reviewed_at')
    .eq('school_id', schoolId).eq('month', month).eq('year', year)
    .maybeSingle();
  if (selErr) throw selErr;
  if (found) return found;

  const { data, error } = await db.from('monthly_statements')
    .insert({ school_id: schoolId, month, year, status: 'draft', snapshot_data: {} })
    .select('id, status, notes, snapshot_data, submitted_at, reviewed_at')
    .single();
  if (error) {
    // سباق: جلسة أخرى أنشأت الصفّ بين الـ select والـ insert — الفهرس الفريد
    // على (school_id, year, month) يرفض الثاني. أعِد القراءة بدل الفشل.
    const { data: again } = await db.from('monthly_statements')
      .select('id, status, notes, snapshot_data, submitted_at, reviewed_at')
      .eq('school_id', schoolId).eq('month', month).eq('year', year)
      .maybeSingle();
    if (again) return again;
    throw error;
  }
  return data;
}

// حفظ تلقائي للمسودة. لا يلمس الحالة — «إرسال» وحده يقلبها.
async function saveStatementDraft(statementId, snapshot) {
  const { error } = await db.from('monthly_statements')
    .update({ snapshot_data: snapshot, updated_at: new Date().toISOString() })
    .eq('id', statementId)
    .in('status', ['draft', 'rejected']);   // لا نكتب فوق بيان مُرسَل أو معتمد
  if (error) throw error;
}

// لقطة آخر بيان مُرسَل قبل هذه الفترة — أساس كشف التعديلات الطارئة.
// أوّل بيان لمدرسة لا سابق له: يعيد null، والواجهة تقول «لا توجد مقارنة»
// بدل أن تخترع تعديلات.
async function getPreviousStatementSnapshot(schoolId, month, year) {
  const key = year * 12 + month;            // ترتيب زمني قابل للمقارنة
  const { data, error } = await db.from('monthly_statements')
    .select('id, month, year, status, snapshot_data')
    .eq('school_id', schoolId)
    .in('status', ['submitted', 'approved'])
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(24);
  if (error) throw error;
  for (const r of data || []) {
    if (r.year * 12 + r.month < key) return r;
  }
  return null;
}

async function getStatementChanges(statementId) {
  const { data, error } = await db.from('monthly_statement_changes')
    .select('*')
    .eq('statement_id', statementId)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

async function upsertStatementChange(row) {
  if (row.id) {
    const { id, ...patch } = row;
    const { data, error } = await db.from('monthly_statement_changes')
      .update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await db.from('monthly_statement_changes')
    .insert(row).select().single();
  if (error) throw error;
  return data;
}

async function deleteStatementChange(id) {
  const { error } = await db.from('monthly_statement_changes').delete().eq('id', id);
  if (error) throw error;
}

async function getSchoolBuilding(schoolId) {
  const { data, error } = await db.from('school_building')
    .select('*').eq('school_id', schoolId).maybeSingle();
  if (error) throw error;
  return data;                              // null إن لم يُملأ بعد
}

async function saveSchoolBuilding(schoolId, patch) {
  const { data, error } = await db.from('school_building')
    .upsert({ ...patch, school_id: schoolId, updated_at: new Date().toISOString() },
            { onConflict: 'school_id' })
    .select().single();
  if (error) throw error;
  return data;
}

// هوية المدرسة كما تظهر في ترويسة الورقة الرسمية.
async function getSchoolProfile(schoolId) {
  const { data, error } = await db.from('schools')
    .select('id, name, former_name, cycle, statistical_number, rural_curriculum, ' +
            'village, address, phone, shared_with, educational_zone, day_type, shift')
    .eq('id', schoolId).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveSchoolProfile(schoolId, patch) {
  const { error } = await db.from('schools').update(patch).eq('id', schoolId);
  if (error) throw error;
}

// السير الذاتية الكاملة — جدول منفصل بصلاحياته (§20.7). الحقول الشخصية
// لا تدخل snapshot_data إطلاقاً.
async function saveStatementRosters(statementId, schoolId, rosters) {
  const { error } = await db.from('monthly_statement_rosters')
    .upsert({ statement_id: statementId, school_id: schoolId, rosters,
              updated_at: new Date().toISOString() },
            { onConflict: 'statement_id' });
  if (error) throw error;
}

// ═════════════════════════════════════════════════════════════════════════════
// §15 — السجل الوطني (المرحلة 2)
// ═════════════════════════════════════════════════════════════════════════════

async function _invokeRegistryLookup(kind, id) {
  const { data, error } = await db.functions.invoke('registry-lookup', {
    body: { kind, id },
  });
  if (error) {
    let msg = 'تعذّر الاستعلام عن السجل.';
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function lookupNationalStudent(nationalId) {
  if (!isOnline()) throw new Error('الاستعلام عن السجل يتطلّب اتصالاً بالإنترنت.');
  return _invokeRegistryLookup('student', nationalId);
}

async function lookupNationalStaff(selfNumber) {
  if (!isOnline()) throw new Error('الاستعلام عن السجل يتطلّب اتصالاً بالإنترنت.');
  return _invokeRegistryLookup('staff', selfNumber);
}

async function linkStudentToRegistry(studentId, nationalId) {
  if (!isOnline()) throw new Error('الربط بالسجل يتطلّب اتصالاً بالإنترنت.');
  const { data, error } = await db.rpc('link_student_to_registry', {
    p_student_id: studentId, p_national_id: nationalId,
  });
  if (error) throw error;
  return data;
}

async function linkStaffToRegistry(staffId, selfNumber) {
  if (!isOnline()) throw new Error('الربط بالسجل يتطلّب اتصالاً بالإنترنت.');
  const { data, error } = await db.rpc('link_staff_to_registry', {
    p_staff_id: staffId, p_self_number: selfNumber,
  });
  if (error) throw error;
  return data;
}

// ═════════════════════════════════════════════════════════════════════════════
// §16 — التكاليف (staff_assignments) — المرحلة 3أ
// ═════════════════════════════════════════════════════════════════════════════
// سجلّ HR للتكليف الإداري/الفني، منفصل عن class_teacher. التكليف الفني الصفّي
// التدريسي (بحساب دخول) يُزامَن آلياً إلى class_teacher عبر RPC upsert_staff_assignment.

async function getStaffAssignments(schoolId) {
  const { data, error } = await db.from('staff_assignments')
    .select('*')
    .eq('school_id', schoolId)
    .eq('active', true)
    .order('assignment_kind')
    .order('job_title');
  if (error) throw error;
  return data || [];
}

// إنشاء/تعديل تكليف. يُمرّر الحمولة كاملةً للـ RPC الذي يتكفّل بالمزامنة.
async function upsertStaffAssignment(payload) {
  if (!isOnline()) throw new Error('حفظ التكليف يتطلّب اتصالاً بالإنترنت.');
  const { data, error } = await db.rpc('upsert_staff_assignment', { p: payload });
  if (error) throw error;
  return data;   // معرّف التكليف
}

// إنهاء تكليف (وحذف جسر class_teacher المُزامَن إن وُجد).
async function endStaffAssignment(id) {
  if (!isOnline()) throw new Error('إنهاء التكليف يتطلّب اتصالاً بالإنترنت.');
  const { error } = await db.rpc('end_staff_assignment', { p_id: id });
  if (error) throw error;
  return true;
}

// المديرية: قراءة تكاليف مدرسة ضمن نطاقها (منقّحة، دون حقول حسّاسة).
async function getDirectorateSchoolAssignments(schoolId) {
  const { data, error } = await db.rpc('get_school_assignments_for_directorate', {
    p_school_id: schoolId,
  });
  if (error) throw error;
  return data || [];
}

// ═════════════════════════════════════════════════════════════════════════════
// §17 — الجلاءات (result_sheets) — المرحلة 3ب
// ═════════════════════════════════════════════════════════════════════════════
// خط اعتماد النتائج النهائية (مدرسة → مديرية → إصدار). يستنسخ نمط monthly_statements.

async function getResultSheet(classId, academicYear, term) {
  const { data, error } = await db.from('result_sheets')
    .select('id, status, notes, submitted_at, reviewed_at, issued_at')
    .eq('class_id', classId).eq('academic_year', academicYear).eq('term', term)
    .maybeSingle();
  if (error) throw error;
  return data;   // null إن لم يوجد
}

// إرسال/إعادة إرسال الجلاء (select-then-insert/update لاحترام RLS)
async function submitResultSheet(classId, schoolId, academicYear, term, snapshot) {
  const existing = await getResultSheet(classId, academicYear, term);
  if (existing && (existing.status === 'approved' || existing.status === 'issued'))
    throw new Error('الجلاء معتمد/صادر ولا يمكن تعديله');
  if (existing && existing.status === 'submitted')
    throw new Error('الجلاء مُرسَل بالفعل وبانتظار المراجعة');
  const row = { school_id: schoolId, class_id: classId, academic_year: academicYear,
                term, status: 'submitted', snapshot_data: snapshot,
                submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (existing) {       // draft|rejected → submitted (RLS يسمح)
    const { error } = await db.from('result_sheets').update(row).eq('id', existing.id);
    if (error) throw error;
  } else {              // insert جديد
    const { error } = await db.from('result_sheets').insert(row);
    if (error) throw error;
  }
}

// المديرية: كل جلاءات مدارسها (RLS يُرشِّح تلقائياً) + اسم المدرسة والصف
/* لقطةُ وثيقةٍ واحدة عند فتح نافذتها. الفارغُ حالةٌ مشروعة (وثيقةٌ قديمة بلا
   لقطة) فتُعاد {} لا استثناءً — النافذةُ تعرض «لا تفصيل» ولا تُغلق في وجه
   الموظّف. */
async function getStatementSnapshot(id) {
  const { data, error } = await db.from('monthly_statements')
    .select('snapshot_data').eq('id', id).maybeSingle();
  if (error) throw error;
  return data?.snapshot_data ?? {};
}

/* لقطاتُ جلاءات المديرية دفعةً واحدة — للوحة الأكاديمية وحدها، وتُجلب عند
   فتح تبويبها لا مع كلّ إقلاع. RLS تحصر النتيجة بمدارس المديرية كما تحصر
   getDirectorateResultSheets نفسها. */
async function getResultSheetSnapshotsForDirectorate() {
  const { data, error } = await db.from('result_sheets')
    .select('id, snapshot_data')
    .order('submitted_at', { ascending: false }).limit(300);
  if (error) throw error;
  return data || [];
}

async function getResultSheetSnapshot(id) {
  const { data, error } = await db.from('result_sheets')
    .select('snapshot_data').eq('id', id).maybeSingle();
  if (error) throw error;
  return data?.snapshot_data ?? {};
}

// snapshot_data خارج القائمة — انظر تعليق getDirectorateStatements.
async function getDirectorateResultSheets() {
  const { data, error } = await db.from('result_sheets')
    .select('id, school_id, class_id, academic_year, term, status, notes, submitted_at, reviewed_at, issued_at, school:schools(name), class:classes(grade, section)')
    .order('submitted_at', { ascending: false }).limit(300);
  if (error) throw error;
  return data ?? [];    // الترتيب «المُرسَل أولاً» يتم في الواجهة
}

// المديرية: اعتماد/رفض/إصدار جلاء (عبر RPC)
async function reviewResultSheet(sheetId, decision, notes = null) {
  const { error } = await db.rpc('review_result_sheet', {
    p_sheet_id: sheetId, p_decision: decision, p_notes: notes || null });
  if (error) throw error;
  return true;
}

// الوزارة: إشراف وطني — قراءة الجلاءات الصادرة فقط (RLS يحصر ministry_user بـ issued)
async function getMinistryResultSheets() {
  const { data, error } = await db.from('result_sheets')
    .select('id, school_id, class_id, academic_year, term, issued_at, snapshot_data, school:schools(name), class:classes(grade, section)')
    .eq('status', 'issued')
    .order('issued_at', { ascending: false }).limit(500);
  if (error) throw error;
  return data ?? [];
}
async function changePassword(email, currentPassword, newPassword) {
  const { error: reErr } = await db.auth.signInWithPassword({ email, password: currentPassword });
  if (reErr) return { error: 'كلمة المرور الحالية غير صحيحة' };
  const { error: upErr } = await db.auth.updateUser({ password: newPassword });
  if (upErr) return { error: upErr.message };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// §23 — وثائق «لا مانع»: نقل الطالب بين مدرستين
// ─────────────────────────────────────────────────────────────────────────────
// كل الكتابة عبر دوال security definer في القاعدة — لا كتابة مباشرة على
// transfer_documents (لا سياسة insert/update عليه أصلاً). وكلّها متّصلة حصراً
// كبقية العمليات العابرة للمدارس (upsertStaffAssignment، bulkImportStudents):
// طابور الـ offline مخصّص لكتابات المدرسة على بياناتها هي.

// «تحقّق من بيانات الطالب» — يُرجع صفّاً واحداً أو يرمي رسالة عربية من القاعدة.
async function lookupStudentForTransfer({ nationalId, firstName, fatherName, familyName }) {
  if (!isOnline()) throw new Error('التحقّق من بيانات الطالب يتطلّب اتصالاً بالإنترنت.');
  const { data, error } = await db.rpc('lookup_student_for_transfer', {
    p_national_id: (nationalId  ?? '').trim(),
    p_first_name:  (firstName   ?? '').trim(),
    p_father_name: (fatherName  ?? '').trim(),
    p_family_name: (familyName  ?? '').trim(),
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

// إصدار الوثيقة. payload: { docType, nationalId, firstName, fatherName,
// familyName, toClassId, transferReason, notes }
async function issueTransferDocument(payload) {
  if (!isOnline()) throw new Error('إصدار وثيقة لا مانع يتطلّب اتصالاً بالإنترنت.');
  const { data, error } = await db.rpc('issue_transfer_document', {
    p: {
      doc_type:        payload.docType === 'exceptional' ? 'exceptional' : 'regular',
      national_id:     (payload.nationalId ?? '').trim(),
      first_name:      (payload.firstName  ?? '').trim(),
      father_name:     (payload.fatherName ?? '').trim(),
      family_name:     (payload.familyName ?? '').trim(),
      to_class_id:     payload.toClassId,
      transfer_reason: payload.transferReason ?? null,
      notes:           payload.notes ?? null,
    },
  });
  if (error) throw error;
  return data;
}

// البتّ في وثيقة واردة (المدرسة الحالية وحدها). action: 'approve' | 'reject'
async function reviewTransferDocument(docId, action, reason = null) {
  if (!isOnline()) throw new Error('البتّ في وثيقة لا مانع يتطلّب اتصالاً بالإنترنت.');
  const { data, error } = await db.rpc('review_transfer_document', {
    p_doc_id: docId, p_action: action, p_reason: reason,
  });
  if (error) throw error;
  return data;
}

// سحب وثيقة معلّقة (المدرسة المُصدِرة وحدها). رقم الصادر يبقى محجوزاً.
async function cancelTransferDocument(docId) {
  if (!isOnline()) throw new Error('سحب وثيقة لا مانع يتطلّب اتصالاً بالإنترنت.');
  const { data, error } = await db.rpc('cancel_transfer_document', { p_doc_id: docId });
  if (error) throw error;
  return data;
}

// كل وثائق مدرستي بالاتجاهين — RLS يُرشِّح (tdoc_parties_select) فلا حاجة
// لتصفية بـ school_id هنا؛ الفرز بين «الوافدة» و«المغادرة» يتم في الواجهة
// بمقارنة to_school_id / from_school_id بمدرسة المستخدم.
async function getTransferDocuments() {
  const { data, error } = await db.from('transfer_documents')
    .select('*')
    .order('issued_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  return data ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// تنظيف مخابئ المستأجِر عند الخروج
// ─────────────────────────────────────────────────────────────────────────────
// الجهاز الواحد يتناوب عليه مديرو مدارس مختلفة، فما بقي من مخبأ المدرسة
// السابقة على القرص تسريبٌ لبياناتها. يُمسح ما يخصّ المدرسة (الطلاب، ملف
// المدرسة، مخبأ الدلتا) ويُترك ما لا يخصّها:
//   • outbox — كتابات لم تُزامَن بعد؛ مسحها فقدانُ عمل المستخدم لا حمايةٌ له.
//   • nsams_device_id — معرّف الجهاز، لا بيانات فيه.
/* ⚠️ البادئات هنا هي **المصدر الوحيد**. كانت مكرّرة نصّاً في ملفّين، فحين
   تغيّرت بادئة ملفّ المدرسة إلى nsams_school2_ (لإهمال نسخ ما قبل §25) بقي
   الترشيح هنا على nsams_school_ — و'nsams_school2_'.startsWith('nsams_school_')
   يساوي false. فصار التنظيف الموضوع أصلاً لمنع تسريب بيانات المدرسة بين
   الجلسات **بلا أثر** على أهمّ ما يُسرَّب. أي بادئة جديدة تُضاف هنا وتُستورَد
   من هنا، لا تُكتب نصّاً في مكان آخر. */
const TENANT_CACHE_PREFIXES = [
  'nsams_stu_',       // صفوف الطلاب كاملةً: الأسماء والأرقام الوطنية وهواتف الأهل
  'nsams_classes_',   // صفوف المعلّم المسندة — لئلّا يراها زميله على جهاز مشترك
  'nsams_sclasses_',  // صفوف المدرسة (بوّابة المدير)
  'nsams_steachers_', // كادر المدرسة (بوّابة المدير)
  'nsams_cteachers_', // معلّمو الصفّ المسندون
  'nsams_ssum_',      // كشوف اليوم: أسماء المعلّمين وأعداد الطلاب لكل شعبة
  'nsams_csub_',      // حالة كشف الصفّ لليوم
  'nsams_catt_',      // حضور طلاب الصفّ لليوم — بيانات طلاب باسمهم
  'nsams_spers_',     // سجلّ الكادر: أسماء وأرقام وطنية
  'nsams_satt_',      // دوام الكادر لليوم
  'nsams_sroster_',   // السجلّ الكامل مع أسماء المستخدمين
  'nsams_sreq_',      // طلبات المدرسة (قد تحمل بيانات طلاب/كادر في payload)
  'nsams_school2_',   // ملفّ المدرسة: الاسم والإحداثيات والأعداد والتصنيف
  'nsams_draft_',     // مسودّات الحضور لكل صفّ ويوم — لم يكن ينظّفها شيء
  'nsams_profile_',   // ملفّ الدور المخبّأ للدخول دون اتصال
  'nsams_lastuser_',  // مؤشّر «آخر مستخدم» — يُمسح كي لا يُحيي دخولاً أوفلاين بعد الخروج
  'nsams_setup_done_',
  // بوّابة ولي الأمر: أسماء الأبناء وصفوفهم وغياباتهم ودرجاتهم وأعذارهم.
  // الهاتف يتناوب عليه أهلٌ مختلفون فعلياً (جهاز العائلة)، فهذه بيانات مستأجِر.
  'nsams_pstu_',      // قائمة الأبناء المرتبطين بالوليّ
  'nsams_patt_',      // حضور الابن لشهرٍ بعينه
  'nsams_pgrades_',   // درجات الابن لسنةٍ دراسية
  'nsams_pcond_',     // درجة سلوك الابن — هاتف العائلة مشترَك، فتُمحى كالبقيّة
  'nsams_pexc_',      // أعذار الغياب المقدَّمة
  'nsams_phol_',      // العطل الرسمية (لا تخصّ طالباً بعينه لكنّها تتبع الجلسة)
];

async function purgeTenantCaches() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (TENANT_CACHE_PREFIXES.some(p => k.startsWith(p))) localStorage.removeItem(k);
    }
  } catch { /* غير قاتل */ }

  try {
    const idb = await openIDB();
    await new Promise((resolve) => {
      const tx = idb.transaction('delta_cache', 'readwrite');
      tx.objectStore('delta_cache').clear();
      tx.oncomplete = resolve;
      tx.onerror    = resolve;   // التنظيف أفضل جهد — لا يمنع الخروج
      tx.onabort    = resolve;
    });
  } catch { /* غير قاتل */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// §24 — الاستيراد الجماعي من لوحة المديرية
// ─────────────────────────────────────────────────────────────────────────────
// كل الكتابة عبر دوال security definer في القاعدة: المديرية لا تملك — ولا
// يجوز أن تُمنَح — صلاحية RLS مباشرة على students أو staff_records أو classes.
// ومتّصلة حصراً كبقية العمليات العابرة للمدارس؛ طابور الـ offline مخصّص
// لكتابات المدرسة على بياناتها هي.

// صفوف مدرسة داخل مديريتي — تلزم لمعاينة الاستيراد قبل الإرسال.
async function getSchoolClassesForDirectorate(schoolId) {
  const { data, error } = await db.rpc('get_school_classes_for_directorate', {
    p_school_id: schoolId,
  });
  if (error) throw error;
  return data ?? [];
}

// rows: [{ first_name, father_name, family_name, gender, birth_date, national_id }]
// تُستدعى مرّة لكل شعبة — الواجهة تُجمّع سطور الملفّ حسب الشعبة المُحلَّلة.
async function directorateBulkImportStudents({ schoolId, classId, rows }) {
  if (!isOnline()) throw new Error('الاستيراد الجماعي يتطلّب اتصالاً بالإنترنت.');
  const { data, error } = await db.rpc('directorate_bulk_import_students', {
    p_school_id: schoolId, p_class_id: classId, p_rows: rows,
  });
  if (error) throw error;
  return data;
}

// rows: [{ full_name, staff_type, gender, ...حقول اختيارية }]
// مزامنة school_personnel تجري داخل الدالة نفسها، لا بخطوة تالية هنا.
async function directorateBulkImportStaff({ schoolId, rows }) {
  if (!isOnline()) throw new Error('الاستيراد الجماعي يتطلّب اتصالاً بالإنترنت.');
  const { data, error } = await db.rpc('directorate_bulk_import_staff', {
    p_school_id: schoolId, p_rows: rows,
  });
  if (error) throw error;
  return data;
}
