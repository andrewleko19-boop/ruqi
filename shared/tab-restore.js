// shared/tab-restore.js
// ─────────────────────────────────────────────────────────────────────────────
//  تحديثُ الصفحة يُبقيك حيث كنت.
//
//  كلُّ بوّابةٍ كانت تُثبّت تبويبَها الأوّل عند الإقلاع: بوّابة المدرسة تكتب
//  replaceState('#attendance') فوق أيّ عنوانٍ في الشريط، وبقيّةُ البوّابات لا
//  تكتب في العنوان شيئاً أصلاً. فمن يضغط «تحديث» — وهو أوّلُ ما يفعله مستخدمٌ
//  ظنَّ الشاشةَ متجمّدة، أو من يعود إلى لسانٍ تركه مفتوحاً — يجد نفسه في أوّل
//  تبويب، ويُعيد الطريق كلَّه من أوّله.
//
//  والعنوان (hash) هو الموضع الصحيح لهذا لا التخزين المحلّي: هو ما ينجو من
//  التحديث بحكم تعريفه، وهو ما يُشارَك ويُحفَظ في المفضّلة، وهو ما يقرؤه زرّ
//  الرجوع أصلاً. وتخزينٌ محلّيّ يعني لسانَين على تبويبين يتنازعان مفتاحاً واحداً.
//
//  الاستعمال:
//    import { restoreTab, syncTabHash } from '../shared/tab-restore.js';
//    const start = restoreTab(VALID_TABS, 'overview');   // قبل أوّل رسم
//    switchTab(start);
//  ومن لا يملك تاريخَ تبويبات (لا pushState) يستدعي syncTabHash(tab) عند كلّ
//  تبديل ليبقى العنوان مطابقاً لما يُرى.
// ─────────────────────────────────────────────────────────────────────────────

/** اسمُ التبويب المكتوب في عنوان الصفحة، أو null. */
export function tabFromHash() {
  const raw = (location.hash || '').replace(/^#/, '').trim();
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/**
 * التبويبُ الذي يجب فتحه الآن.
 * valid: مصفوفة أو Set بأسماء التبويبات المقبولة — وهي الحارس: عنوانٌ ملفَّق
 *        أو تبويبٌ حُذف من نسخةٍ سابقة يجب ألّا يُفتح ولا يُسقط البوّابة.
 * fallback: التبويب الافتراضيّ حين لا عنوان أو لا يُطابق.
 */
export function restoreTab(valid, fallback) {
  const set = valid instanceof Set ? valid : new Set(valid || []);
  const want = tabFromHash();
  return (want && set.has(want)) ? want : fallback;
}

/**
 * يجعل العنوان يطابق التبويب المعروض بلا إضافة خطوةٍ إلى تاريخ التصفّح.
 * replaceState لا pushState: التبويبات ليست صفحاتٍ متتابعة في هذه البوّابات،
 * ودفعُ خطوةٍ لكلّ تبديل يجعل زرَّ الرجوع يمشي في التبويبات خطوةً خطوة بدل أن
 * يخرج — وهو سلوكٌ يُربك من ينتظر أن يعود من حيث أتى.
 */
export function syncTabHash(tab) {
  if (!tab) return;
  const next = '#' + encodeURIComponent(tab);
  if (location.hash === next) return;
  history.replaceState(history.state, '', next);
}
