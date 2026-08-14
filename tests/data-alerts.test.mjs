// ─────────────────────────────────────────────────────────────────────────────
//  كشف الأرقام غير المنطقية.
//
//  الخطر هنا ليس الفشل بل الضجيج: تنبيهٌ يُطلَق على مدرسةٍ سليمة يُفقد الثقة
//  باللوحة كلّها، فيُتجاهَل معه التنبيهُ الصادق حين يقع. لذا يُختبَر الطرفان:
//  أنّ الشاذّ يُلتقط، وأنّ السليم لا يُتّهم — والثاني أهمّ.
//
//  والقسمة على صفر مصيدةٌ قائمة في كل نسبة: مدرسةٌ بلا مدرّسين تُعطي لانهاية
//  فتقع في «نسبة مرتفعة» وفي «طلاب بلا مدرّسين» معاً، فيُعدّ خطأٌ واحد مرّتين.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectAnomalies, RATIO_HIGH, RATIO_LOW } from '../shared/data-alerts.js';

/** مدرسةٌ سليمة تماماً؛ تُعدَّل حقولها في كل اختبار. */
const school = (over = {}) => ({
  school_name: 'مدرسة سليمة', school_type: 'primary',
  students_total: 300, students_male: 150, students_female: 150,
  staff_teaching: 20, staff_admin: 3, staff_professional: 1,
  staff_worker: 2, staff_guard: 1,
  teachers_over_quota: 0, teachers_no_quota: 0,
  ...over,
});
const keys = (rows) => detectAnomalies(rows).map(a => a.key);
const find = (rows, key) => detectAnomalies(rows).find(a => a.key === key);

describe('السليم لا يُتّهم', () => {
  test('مدرسةٌ متّسقة لا تُطلق تنبيهاً واحداً', () => {
    assert.deepEqual(detectAnomalies([school()]), []);
  });

  test('نسبة ١٥:١ مزدحمةٌ لكنها واقعٌ لا خلل', () => {
    assert.deepEqual(keys([school({ students_total: 300, staff_teaching: 20 })]), []);
  });

  test('نسبةٌ عند الحدّ تماماً لا تُنبَّه — الحدّ مسموح', () => {
    const rows = [school({ students_total: RATIO_HIGH * 10, staff_teaching: 10,
                           students_male: RATIO_HIGH * 5, students_female: RATIO_HIGH * 5 })];
    assert.ok(!keys(rows).includes('ratio_high'));
  });

  test('قائمةٌ فارغة تعطي لا شيء ولا ترمي', () => {
    assert.deepEqual(detectAnomalies([]), []);
  });

  test('مُدخَلٌ ليس مصفوفةً لا يُسقط الحساب', () => {
    for (const bad of [null, undefined, 'نصّ', 42, {}]) {
      assert.doesNotThrow(() => detectAnomalies(bad));
      assert.deepEqual(detectAnomalies(bad), []);
    }
  });
});

describe('التناقضات الصريحة', () => {
  test('طلابٌ وصفرُ مدرّسين يُلتقط', () => {
    const a = find([school({ staff_teaching: 0 })], 'students_no_teachers');
    assert.ok(a, 'لم يُلتقط التناقض');
    assert.equal(a.tone, 'bad');
    assert.match(a.schools[0].detail, /300/);
  });

  test('صفرُ مدرّسين لا يُعدّ «نسبةً مرتفعة» أيضاً — لا قسمةَ على صفر', () => {
    const k = keys([school({ staff_teaching: 0 })]);
    assert.ok(!k.includes('ratio_high'), 'خطأٌ واحد عُدّ مرّتين');
  });

  test('كادرٌ بلا طلاب يُلتقط', () => {
    const a = find([school({ students_total: 0, students_male: 0, students_female: 0 })],
                   'staff_no_students');
    assert.ok(a);
    assert.equal(a.tone, 'warn');
  });

  test('مدرسةٌ خاوية تماماً لا تُنبَّه — لا طلاب ولا كادر ليس تناقضاً', () => {
    const rows = [school({
      students_total: 0, students_male: 0, students_female: 0,
      staff_teaching: 0, staff_admin: 0, staff_professional: 0,
      staff_worker: 0, staff_guard: 0,
    })];
    assert.ok(!keys(rows).includes('staff_no_students'));
    assert.ok(!keys(rows).includes('students_no_teachers'));
  });
});

describe('النسب المتطرّفة', () => {
  test('نسبةٌ فوق الحدّ تُلتقط بعددها المقرَّب', () => {
    const a = find([school({ students_total: 900, staff_teaching: 10,
                             students_male: 450, students_female: 450 })], 'ratio_high');
    assert.ok(a);
    assert.match(a.schools[0].detail, /90/);
  });

  test('نسبةٌ دون الحدّ الأدنى تُلتقط كنقصِ إدخالٍ لا كخلل', () => {
    const a = find([school({ students_total: 10, staff_teaching: 20,
                             students_male: 5, students_female: 5 })], 'ratio_low');
    assert.ok(a);
    assert.equal(a.tone, 'warn');
  });

  test('حدّ الطرفين مضبوط: RATIO_LOW نفسها لا تُنبَّه', () => {
    const rows = [school({ students_total: RATIO_LOW * 10, staff_teaching: 10,
                           students_male: RATIO_LOW * 5, students_female: RATIO_LOW * 5 })];
    assert.ok(!keys(rows).includes('ratio_low'));
  });
});

describe('النقص في البيانات', () => {
  test('فجوةُ الجنس تُحسب من الفارق لا من حقلٍ منفصل', () => {
    const a = find([school({ students_total: 300, students_male: 140, students_female: 150 })],
                   'gender_gap');
    assert.ok(a);
    assert.match(a.schools[0].detail, /10/);
  });

  test('نوعٌ غير معروف يُعدّ غير محدَّد', () => {
    for (const t of [null, '', 'middle_high', 'شيء']) {
      assert.ok(keys([school({ school_type: t })]).includes('no_type'), `النوع: ${t}`);
    }
  });

  test('تجاوز النصاب يُنقل كتنبيهٍ خطِر', () => {
    const a = find([school({ teachers_over_quota: 3 })], 'over_quota');
    assert.equal(a.tone, 'bad');
    assert.match(a.schools[0].detail, /3/);
  });
});

describe('الترتيب والتجميع', () => {
  test('الخطِر يسبق التحذيريّ', () => {
    const rows = [school({ school_type: null }), school({ staff_teaching: 0 })];
    const tones = detectAnomalies(rows).map(a => a.tone);
    assert.equal(tones[0], 'bad', 'التحذيريّ تصدّر الخطِر');
  });

  test('الأوسع انتشاراً يسبق ضمن الخطورة نفسها', () => {
    const rows = [
      school({ staff_teaching: 0 }),                       // bad: تناقض
      school({ teachers_over_quota: 1 }),                  // bad: تجاوز
      school({ teachers_over_quota: 1, school_name: 'ب' }), // bad: تجاوز ثانٍ
    ];
    const bad = detectAnomalies(rows).filter(a => a.tone === 'bad');
    assert.ok(bad[0].schools.length >= bad[1].schools.length);
  });

  test('التنبيه الفارغ يُحذف — صفرٌ معروضٌ ضجيج', () => {
    assert.ok(!keys([school()]).includes('over_quota'));
  });

  test('كل مدرسةٍ مخالفة تُذكر بالاسم لتُراجَع', () => {
    const rows = [school({ school_name: 'أ', staff_teaching: 0 }),
                  school({ school_name: 'ب', staff_teaching: 0 })];
    const a = find(rows, 'students_no_teachers');
    assert.deepEqual(a.schools.map(s => s.name), ['أ', 'ب']);
  });

  test('اسمٌ مفقود لا يُنتج «undefined» في القائمة', () => {
    const rows = [{ students_total: 5, staff_teaching: 0, school_type: 'primary',
                    students_male: 5, students_female: 0 }];
    assert.equal(find(rows, 'students_no_teachers').schools[0].name, '—');
  });
});
