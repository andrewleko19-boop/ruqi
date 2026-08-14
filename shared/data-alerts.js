// ─────────────────────────────────────────────────────────────────────────────
//  كشف الأرقام غير المنطقية في إحصاءات المدارس.
//
//  البيانات تُدخَل يدوياً في آلاف المدارس، فتقع أخطاءٌ لا يكشفها التحقّق عند
//  الإدخال لأن كل حقلٍ وحده صحيح: مدرسةٌ فيها ٤٠٠ طالب وصفرُ مدرّسين ليست
//  حقلاً خاطئاً بل تناقضاً بين حقلين. ولا يظهر التناقض إلا حين تُقرأ الأرقام
//  معاً — وهذا ما تفعله هذه الوحدة.
//
//  مبدأٌ حاكم: التنبيه الذي يُطلَق كثيراً يُتجاهَل، ومعه يضيع التنبيه الحقيقيّ.
//  فالعتبات هنا متحفّظة عمداً — نسبة أربعين طالباً لمدرّسٍ واحد تُنبَّه، لا
//  خمسةٌ وعشرون وهي مزدحمةٌ لكنها واقعُ كثيرٍ من المدارس. وكلّ تنبيهٍ يذكر
//  المدارس المعنيّة بالاسم كي يُراجَع لا كي يُخاف منه.
//
//  والوحدة نقيّة بلا DOM ولا شبكة: تأخذ صفوف الإحصاء وتُرجع نتائج، فتُختبَر
//  بالحالات الحدّية التي يصعب اصطناعها في قاعدةٍ حقيقية.
// ─────────────────────────────────────────────────────────────────────────────

/** نسبةُ طلابٍ لمدرّسٍ تُعدّ مرتفعة. ما دونها ازدحامٌ معتاد لا خلل. */
export const RATIO_HIGH = 40;
/** ونسبةٌ منخفضة جداً تعني غالباً كادراً مسجَّلاً وطلاباً لم يُدخَلوا. */
export const RATIO_LOW = 4;

const n = (v) => Number(v) || 0;
const staffTotal = (s) =>
  n(s.staff_teaching) + n(s.staff_admin) + n(s.staff_professional) +
  n(s.staff_worker) + n(s.staff_guard);

/**
 * يفحص صفوف إحصاء المدارس ويُرجع ما شذّ منها.
 * الصفّ من get_directorate_school_stats أو get_ministry_school_stats — الشكلان
 * متطابقان في الحقول التي تُقرأ هنا.
 *
 * @returns [{ key, tone, label, hint, schools: [{ name, detail }] }]
 *          مرتّبةً بالخطورة ثم بعدد المدارس. الفارغة تُحذف — تنبيهٌ بصفرٍ ضجيج.
 */
export function detectAnomalies(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const name = (s) => s.school_name ?? '—';

  const checks = [
    {
      key: 'students_no_teachers', tone: 'bad',
      label: 'طلابٌ بلا مدرّسين',
      hint: 'مدارس مسجَّلٌ فيها طلاب ولا مدرّس واحد — خطأُ إدخالٍ أو نقصٌ حادّ في الكادر.',
      test: (s) => n(s.students_total) > 0 && n(s.staff_teaching) === 0,
      detail: (s) => `${n(s.students_total)} طالباً · بلا مدرّسين`,
    },
    {
      key: 'staff_no_students', tone: 'warn',
      label: 'كادرٌ بلا طلاب',
      hint: 'مدارس فيها كادر ولا طالب مسجَّل — مدرسةٌ أُغلقت ولم تُؤرشَف، أو طلابٌ لم يُدخَلوا بعد.',
      test: (s) => n(s.students_total) === 0 && staffTotal(s) > 0,
      detail: (s) => `${staffTotal(s)} موظفاً · بلا طلاب`,
    },
    {
      key: 'ratio_high', tone: 'bad',
      label: `أكثر من ${RATIO_HIGH} طالباً لمدرّس`,
      hint: 'كثافةٌ تفوق المعقول — تستدعي مراجعة التوزيع أو تدقيق الأرقام.',
      test: (s) => n(s.staff_teaching) > 0 &&
                   n(s.students_total) / n(s.staff_teaching) > RATIO_HIGH,
      detail: (s) => `${Math.round(n(s.students_total) / n(s.staff_teaching))} طالباً لكل مدرّس`,
    },
    {
      key: 'ratio_low', tone: 'warn',
      label: `أقلّ من ${RATIO_LOW} طلاب لمدرّس`,
      hint: 'نسبةٌ منخفضة جداً — غالباً كادرٌ مسجَّل وطلابٌ لم تُستكمل بياناتهم.',
      test: (s) => n(s.students_total) > 0 && n(s.staff_teaching) > 0 &&
                   n(s.students_total) / n(s.staff_teaching) < RATIO_LOW,
      detail: (s) => `${(n(s.students_total) / n(s.staff_teaching)).toFixed(1)} طالباً لكل مدرّس`,
    },
    {
      key: 'gender_gap', tone: 'warn',
      label: 'طلابٌ بلا جنسٍ مسجَّل',
      hint: 'مجموع الذكور والإناث أقلّ من المجموع الكلّي — حقلٌ ناقص يُخلّ بالإحصاء المفصَّل.',
      test: (s) => n(s.students_total) - n(s.students_male) - n(s.students_female) > 0,
      detail: (s) => `${n(s.students_total) - n(s.students_male) - n(s.students_female)} طالباً`,
    },
    {
      key: 'no_type', tone: 'warn',
      label: 'مدارس بلا نوعٍ محدَّد',
      hint: 'لا تدخل في تصنيف ابتدائي/إعدادي/ثانوي، فتنقص كلَّ تقريرٍ مبنيٍّ عليه.',
      test: (s) => !['primary', 'preparatory', 'secondary'].includes(s.school_type),
      detail: () => 'النوع غير محدَّد',
    },
    {
      key: 'over_quota', tone: 'bad',
      label: 'تجاوزٌ لنصاب التدريس',
      hint: 'معلّمون أُسنِد إليهم أكثر من نصابهم القانوني.',
      test: (s) => n(s.teachers_over_quota) > 0,
      detail: (s) => `${n(s.teachers_over_quota)} معلّماً متجاوزاً`,
    },
  ];

  return checks
    .map(c => ({
      key: c.key, tone: c.tone, label: c.label, hint: c.hint,
      schools: list.filter(c.test).map(s => ({ name: name(s), detail: c.detail(s) })),
    }))
    .filter(a => a.schools.length > 0)
    // الأخطر أوّلاً، ثمّ الأوسع انتشاراً: ما يستحقّ الفتح يظهر في الصدارة.
    .sort((a, b) => (a.tone === b.tone ? b.schools.length - a.schools.length
                                       : a.tone === 'bad' ? -1 : 1));
}
