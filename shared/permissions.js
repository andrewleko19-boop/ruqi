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

import { supabase } from './db.js';

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
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { _enabled = null; return null; }

  const { data, error } = await supabase.rpc('get_my_module_permissions');

  let keys;
  if (error || !Array.isArray(data)) {
    const cached = _cachedModules(session.user.id);
    if (cached) { _enabled = new Set(cached); return _enabled; }
    _enabled = null; // لا مخبّأ ولا شبكة: لا نخفي شيئاً
    return null;
  }

  keys = data.map(r => (typeof r === 'string' ? r : r.get_my_module_permissions ?? r.module_key));
  _cacheModules(session.user.id, keys);
  _enabled = new Set(keys);
  return _enabled;
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
