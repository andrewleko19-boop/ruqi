// ─────────────────────────────────────────────────────────────────────────────
//  تنسيق التواريخ — موضعٌ واحد يقرّر، لا ثمانية تتفرّق.
//
//  **لماذا الميلاديّ بالأسماء السريانية لا الهجريّ:**
//  «التقويم العربي» في سوريا ليس الهجريّ بل الميلاديُّ بأسماء الشهور
//  السريانية — كانون الثاني، آذار، آب، أيلول، تشرين — وهي التي تُكتب في
//  الوثائق الحكومية والبيان الشهريّ وشهادات الدراسة. وar-SY يُعطيها تلقائياً،
//  بخلاف ar-SA التي تُعرّب الأسماء اللاتينية (أغسطس، سبتمبر).
//
//  والهجريّ مستبعَدٌ عن قصد: العام الدراسيّ ٢٠٢٥-٢٠٢٦، والبيان الشهريّ يُرفع
//  بشهرٍ ميلاديّ، وأعمدة القاعدة كلّها date ميلاديّ، والمقارنة بسجلّات
//  الوزارة الورقية ميلادية. فتحويلُ العرض إلى الهجريّ يجعل «٢ ربيع الأول»
//  رقماً لا يُطابق أيّ ورقةٍ رسمية، ويكسر حساب العام الدراسيّ.
//
//  **الأرقام:** عربية-هندية (١٥ آب ٢٠٢٦) في التواريخ لأنّها صورة الوثيقة
//  الرسمية. أمّا الإحصاءات فتبقى لاتينية (31,480) — فاصلةُ الألوف تُقرأ أسرع،
//  وهي عرف الجداول الإحصائية. والخلطُ المذموم هو ما يقع داخل السطر الواحد،
//  لا التمييزُ بين تاريخٍ ورقم.
// ─────────────────────────────────────────────────────────────────────────────

/** لغةُ العرض. تُغيَّر هنا وحدها إن قُرِّر غير ذلك يوماً. */
export const DATE_LOCALE = 'ar-SY';

/** يحوّل مُدخَلاً (ISO أو Date أو طابعاً زمنياً) إلى Date صالح، أو null. */
function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v);
  // تاريخٌ صِرف (YYYY-MM-DD) يُقرأ UTC فيُزحزح يوماً في المناطق السالبة.
  // الظهيرة تُحيّده: أيُّ إزاحةٍ تبقى داخل اليوم نفسه.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s);
  return isNaN(d.getTime()) ? null : d;
}

/** ١٥ آب ٢٠٢٦ */
export function fmtDate(v, fallback = '—') {
  const d = toDate(v);
  return d ? d.toLocaleDateString(DATE_LOCALE,
    { year: 'numeric', month: 'long', day: 'numeric' }) : fallback;
}

/** ١٥ آب — للمحاور والرسوم حيث السنة معروفة من السياق. */
export function fmtDateShort(v, fallback = '—') {
  const d = toDate(v);
  return d ? d.toLocaleDateString(DATE_LOCALE, { day: 'numeric', month: 'short' }) : fallback;
}

/** الجمعة، ١٥ آب ٢٠٢٦ */
export function fmtDateLong(v, fallback = '—') {
  const d = toDate(v);
  return d ? d.toLocaleDateString(DATE_LOCALE,
    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : fallback;
}

/** ١٥ آب ٢٠٢٦، ٩:٤٠ ص */
export function fmtDateTime(v, fallback = '—') {
  const d = toDate(v);
  if (!d) return fallback;
  return d.toLocaleDateString(DATE_LOCALE, { year: 'numeric', month: 'long', day: 'numeric' })
       + '، ' + d.toLocaleTimeString(DATE_LOCALE, { hour: '2-digit', minute: '2-digit' });
}

/** ٩:٤٠ ص */
export function fmtTime(v, fallback = '—') {
  const d = toDate(v);
  return d ? d.toLocaleTimeString(DATE_LOCALE, { hour: '2-digit', minute: '2-digit' }) : fallback;
}
