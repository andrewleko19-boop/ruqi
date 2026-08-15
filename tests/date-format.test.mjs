// ─────────────────────────────────────────────────────────────────────────────
//  تنسيق التواريخ بالتقويم السوريّ.
//
//  ثلاثة أشياء تُحرَس هنا، وكلّها تُخطئ بصمتٍ لو تُركت:
//   ١) أسماء الشهور السريانية (آب، أيلول، كانون) لا المعرَّبة (أغسطس، سبتمبر).
//      ar-SA يُعطي الثانية، وهي غريبةٌ عن الوثيقة السورية الرسمية.
//   ٢) الميلاديّ لا الهجريّ: العام الدراسيّ والبيان الشهريّ وأعمدة القاعدة
//      كلّها ميلادية، فتاريخٌ هجريّ في العرض لا يُطابق أيّ ورقة.
//   ٣) انزياحُ اليوم: 'YYYY-MM-DD' يُقرأ UTC، فيصير ١٥ آب يومَ ١٤ في منطقةٍ
//      سالبة. الظهيرة تُحيّده — وبدون اختبارٍ يمرّ العيب على من يطوّر بتوقيت
//      دمشق ولا يظهر إلا عند غيره.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate, fmtDateShort, fmtDateLong, fmtDateTime, fmtTime, DATE_LOCALE }
  from '../shared/date-format.js';

describe('الشهور السريانية لا المعرَّبة', () => {
  const CASES = [
    ['2026-01-15', 'كانون الثاني'],
    ['2026-03-15', 'آذار'],
    ['2026-08-15', 'آب'],
    ['2026-09-15', 'أيلول'],
    ['2026-12-15', 'كانون الأول'],
  ];
  for (const [iso, month] of CASES) {
    test(`${iso} → ${month}`, () => {
      assert.match(fmtDate(iso), new RegExp(month),
        `صيغةٌ غير سورية: ${fmtDate(iso)}`);
    });
  }

  test('لا تظهر الأسماء المعرَّبة عن اللاتينية', () => {
    const bad = /يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر/;
    for (const m of Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-15`)) {
      assert.doesNotMatch(fmtDate(m), bad, `شهرٌ معرَّب في ${m}: ${fmtDate(m)}`);
    }
  });
});

describe('ميلاديٌّ لا هجريّ', () => {
  test('السنة ٢٠٢٦ لا ١٤٤٨', () => {
    const out = fmtDate('2026-08-15');
    assert.match(out, /٢٠٢٦/, `سنةٌ غير ميلادية: ${out}`);
    assert.doesNotMatch(out, /١٤٤[0-9]|هـ/, 'ظهر تاريخٌ هجريّ');
  });

  test('اللغة المضبوطة بلا لاحقة تقويمٍ بديل', () => {
    assert.equal(DATE_LOCALE, 'ar-SY');
    assert.doesNotMatch(DATE_LOCALE, /islamic|ca-/);
  });
});

describe('انزياح اليوم', () => {
  test('تاريخٌ صِرف يبقى على يومه', () => {
    assert.match(fmtDate('2026-08-15'), /١٥/, `انزاح اليوم: ${fmtDate('2026-08-15')}`);
  });

  test('أوّل الشهر لا يرتدّ إلى الشهر السابق', () => {
    const out = fmtDate('2026-08-01');
    assert.match(out, /آب/, `ارتدّ الشهر: ${out}`);
    assert.match(out, /١/);
  });

  test('رأس السنة لا يرتدّ إلى السنة السابقة', () => {
    const out = fmtDate('2026-01-01');
    assert.match(out, /٢٠٢٦/, `ارتدّت السنة: ${out}`);
  });
});

describe('الصيغ والحالات الحدّية', () => {
  test('الصيغة القصيرة بلا سنة', () => {
    const out = fmtDateShort('2026-08-15');
    assert.match(out, /آب/);
    assert.doesNotMatch(out, /٢٠٢٦/);
  });

  test('الصيغة الطويلة تحمل اسم اليوم', () => {
    assert.match(fmtDateLong('2026-08-15'), /السبت|الجمعة|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس/);
  });

  test('التاريخ والوقت يجمعان الاثنين', () => {
    const out = fmtDateTime('2026-08-15T09:40:00');
    assert.match(out, /آب/);
    assert.match(out, /٢٠٢٦/);
  });

  test('الوقت وحده', () => {
    assert.match(fmtTime('2026-08-15T09:40:00'), /[٠-٩]/);
  });

  test('القيم الفارغة تعطي الشرطة لا «Invalid Date»', () => {
    for (const v of [null, undefined, '', '   ', 'ليس تاريخاً', NaN]) {
      const out = fmtDate(v);
      assert.equal(out, '—', `القيمة ${JSON.stringify(v)} أعطت: ${out}`);
      assert.doesNotMatch(out, /Invalid|NaN/);
    }
  });

  test('بديلٌ مخصَّص يُحترَم', () => {
    assert.equal(fmtDate(null, 'بلا تاريخ'), 'بلا تاريخ');
  });

  test('كائن Date يُقبل كما تُقبل السلسلة', () => {
    assert.equal(fmtDate(new Date('2026-08-15T12:00:00')), fmtDate('2026-08-15'));
  });

  test('طابعٌ زمنيّ كامل يُقرأ', () => {
    assert.match(fmtDate('2026-08-15T09:40:00Z'), /آب/);
  });
});
