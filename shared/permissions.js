// shared/permissions.js
// طبقة عرض (UI rollout) فوق نظام الأدوار — تقرّر أي أزرار/تبويبات/شاشات تظهر
// للمستخدم الحالي حسب "الوحدات" المفعّلة لدوره، ولا شيء أكثر. هذا **ليس**
// تصريحاً أمنياً: التصريح الحقيقي يبقى JWT + RLS على الخادم (shared/db.js:482-490
// يشرح نفس الفلسفة لمخبّأ الدور). مستخدم يعبث بهذا المخبّأ ليظهر له تبويب مخفي
// سيرى شاشة فارغة أو خطأ صلاحية عند أول استعلام — لا بيانات فعلية.
//
// الاستخدام في كل بوّابة (بعد <script src="db.js"> وقبل script.js):
//   <script type="module" src="../shared/permissions.js"></script>
// وفي script.js بعد نجاح تسجيل الدخول:
//   await RUQI_PERMISSIONS.init();
//   RUQI_PERMISSIONS.applyToDom();
// كل عنصر يحمل data-module="<مفتاح الوحدة>" يُخفى (hidden) تلقائياً إن كانت
// الوحدة غير مفعّلة لدور المستخدم الحالي.

import { supabase, withTimeout, getOfflineUserId } from './db.js';

const LAYER = location.pathname.split('/').filter(Boolean).find(
  s => ['school', 'teacher', 'directorate', 'ministry', 'admin', 'parent'].includes(s)
) || 'root';

const CACHE_PFX = 'ruqi_modules_';

let _enabled = null; // Set<string> | null قبل أول init() ناجح

function _cacheKey(userId) {
  return CACHE_PFX + LAYER + '_' + userId;
}

function _cacheModules(userId, keys) {
  try { localStorage.setItem(_cacheKey(userId), JSON.stringify(keys)); }
  catch { /* حصة التخزين ممتلئة — غير قاتل، مجرّد تجربة عدم اتصال أفضل */ }
}

function _cachedModules(userId) {
  try {
    const raw = localStorage.getItem(_cacheKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/* استدعاء get_my_module_permissions() بعد نجاح الجلسة. عند فشل الشبكة (دون
   اتصال) نستعمل آخر نتيجة مخبّأة لهذا المستخدم على هذا الجهاز؛ وعند غيابها
   نُظهر كل شيء (fail-open) كي لا تُحرَم شاشة تشغيلية من الظهور بسبب عطل في
   نظام العرض هذا وحده — هذا سقف واجهة، لا حاجز أمان. */
// userId اختياري: تمرّره البوّابة (من الجلسة التي حسمتها أصلاً) لتخطّي getSession
// نهائياً؛ وإلّا نستنتجه من الجلسة المحلية ثم من مؤشّر «آخر مستخدم» (توكن منتهٍ).
// كل استدعاء شبكي مغلَّف بمهلة فلا يتعلّق initApp قبل إظهار اللوحة أوفلاين.
async function init(userId) {
  let uid = userId ?? null;
  if (!uid) {
    try {
      const res = await withTimeout(supabase.auth.getSession(), 3500);
      uid = res?.data?.session?.user?.id ?? null;
    } catch { /* تعلّق التوكن → نُعامله كأوفلاين */ }
  }
  if (!uid) uid = getOfflineUserId();
  if (!uid) { _enabled = null; return null; }

  // أوفلاين: استعمل آخر مصفوفة مخبّأة مباشرة بلا إهدار مهلة على شبكة غائبة.
  if (!navigator.onLine) {
    const cached = _cachedModules(uid);
    _enabled = cached ? new Set(cached) : null;
    return _enabled;
  }

  let data = null, error = null;
  try {
    ({ data, error } = await withTimeout(supabase.rpc('get_my_module_permissions'), 4000));
  } catch (e) { error = e; }

  if (error || !Array.isArray(data)) {
    const cached = _cachedModules(uid);
    if (cached) { _enabled = new Set(cached); return _enabled; }
    _enabled = null; // لا مخبّأ ولا شبكة: لا نخفي شيئاً
    return null;
  }

  const keys = data.map(r => (typeof r === 'string' ? r : r.get_my_module_permissions ?? r.module_key));

  /* مصفوفةٌ فارغة ليست «لا وحدة مفعّلة» بل «لا أعرف».
     الوحداتُ الأساسية (attendance-core، student-records، sysadmin-console)
     مزروعةٌ لكلّ مفتاح دورٍ في المصفوفة، وزنادُ enforce_core_module_enabled
     يمنع تعطيلها. فدورٌ معرَّفٌ فعلاً لا يمكن أن يُرجع صفراً؛ والصفرُ يعني
     مفتاحَ دورٍ لا صفوف له أصلاً — أي خللَ إعداد.
     وثمنُ الخطأ غير متكافئ: new Set([]) قيمةٌ صادقة، فيُخفي applyToDom كلَّ
     عنصرٍ يحمل data-module — لوحةٌ بيضاء لا تبويب فيها ولا زرّ، ولا يستطيع
     صاحبُها حتى الإبلاغ عمّا يراه. وهذه طبقةُ عرضٍ لا أمان: RLS هو الحارس. */
  if (keys.length === 0) { _enabled = null; return null; }

  _cacheModules(uid, keys);
  _enabled = new Set(keys);
  _lastCheck = Date.now();      // يُضبط عند كلّ جلبٍ ناجح لا عند تحميل الملفّ
  _watchVisibility(uid);
  return _enabled;
}

/* ── إعادة الفحص عند العودة إلى التطبيق ──────────────────────────────────────
   init() كانت تُستدعى مرّةً واحدة عند الإقلاع، ولوحة المشرف تَعِد صراحةً بأنّ
   «التبديل ينعكس فوراً على واجهة المستخدمين». وهذا لم يكن صحيحاً: تطبيقُ PWA
   يبقى مفتوحاً أياماً، فوحدةٌ يُفعّلها المشرف اليوم لا يراها المستخدم حتى
   يُغلق التطبيق ويفتحه — ووحدةٌ يُعطّلها تبقى مستعملةً بلا حدّ. وهذا يُبطل
   «الإظهار المرحلي» الذي بُني النظام لأجله.

   العودةُ إلى التطبيق هي اللحظة الطبيعية للفحص: المستخدم يبدّل التطبيقات
   عشرات المرّات يومياً على الجوّال، فيصل التغييرُ خلال دقائق عملياً. وحدٌّ
   أدنى بين الفحصين يمنع أن يُصيب تبديلُ تبويبٍ سريع الشبكةَ في كلّ مرّة.

   وهذه طبقة عرضٍ لا أمان: من يُبقي التطبيق مفتوحاً ليحتفظ بتبويبٍ عُطِّل لن
   يجد وراءه بيانات — RLS هو الحارس. */
const RECHECK_MIN_MS = 60 * 1000;
let _watching = false;
let _lastCheck = 0;

function _watchVisibility(uid) {
  if (_watching || typeof document === 'undefined') return;
  _watching = true;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (!navigator.onLine) return;
    if (Date.now() - _lastCheck < RECHECK_MIN_MS) return;
    _lastCheck = Date.now();
    const before = _enabled ? [..._enabled].sort().join(',') : null;
    try { await init(uid); } catch { return; }
    const after = _enabled ? [..._enabled].sort().join(',') : null;
    // لا تُعِد الرسم إلا إن تغيّر شيء فعلاً: applyToDom تمسح الشاشة وتُعيد
    // إظهارها، وفعلُها بلا داعٍ وميضٌ يراه المستخدم كخلل.
    if (before !== after) applyToDom();
  });
}

/* true افتراضياً إن لم يُستدعَ init() بعد أو تعذّر تحميل المصفوفة تماماً —
   حماية من إخفاء كل الواجهة بسبب استدعاء بترتيب خاطئ أو عطل مؤقت. */
function isEnabled(moduleKey) {
  if (!moduleKey) return true;
  if (!_enabled) return true;
  return _enabled.has(moduleKey);
}

// يُخفي كل [data-module] غير مفعّل ضمن root، ويُرجع مفاتيح الوحدات التي أخفاها
// (لتقرّر الصفحة المستدعية إن كان التبويب النشط حالياً من بينها وتُبدّله).
function applyToDom(root = document) {
  const hiddenKeys = new Set();
  if (!_enabled) return hiddenKeys;
  for (const el of root.querySelectorAll('[data-module]')) {
    const key = el.getAttribute('data-module');
    const on = isEnabled(key);
    el.hidden = !on;
    if (!on) hiddenKeys.add(key);
  }
  return hiddenKeys;
}

// أول عنصر من قائمة مرشّحين (بترتيب الأولوية) تكون وحدته مفعّلة أو بلا وحدة
// مرتبطة أصلاً — تُستخدم لاختيار تبويب افتراضي بديل حين يكون التبويب الحالي
// من ضمن ما أخفاه applyToDom.
function firstEnabled(candidates, moduleKeyOf) {
  for (const c of candidates) {
    if (isEnabled(moduleKeyOf(c))) return c;
  }
  return candidates[0] ?? null;
}

window.RUQI_PERMISSIONS = { init, isEnabled, applyToDom, firstEnabled };
export { init, isEnabled, applyToDom, firstEnabled };
