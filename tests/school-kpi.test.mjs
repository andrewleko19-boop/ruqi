// ─────────────────────────────────────────────────────────────────────────────
//  بطاقات المؤشّرات في رئيسية بوّابة المدرسة.
//
//  الخطر الحقيقي هنا ليس خطأً برمجياً بل رقمٌ صحيحُ الحساب مضلّلُ المعنى: في
//  السابعة صباحاً يكون كشفٌ واحد من ستّة قد وصل، فإن قُسِم الحاضرون على طلاب
//  المدرسة كلّهم ظهرت نسبةٌ حول ١٦٪ فيقرأ المديرُ كارثةً ليست موجودة. القسمة
//  على المرصود وحده هي الصواب، والمقام يُعلَن تحت الرقم كي لا يُقرأ ٩٥٪ على
//  أنّه حصيلة اليوم كلّه وهو حصيلة فصلٍ منه.
//
//  التابع معرَّف داخل script.js لا كوحدة، فيُستخرَج نصّياً ويُشغَّل على DOM وهمي —
//  فيُختبَر ما يُشحن فعلاً لا نسخةٌ منه تتقادم بصمت.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'school/script.js'), 'utf8');
const m    = src.match(/function renderKpis\(summaries\) \{[\s\S]*?\n\}/);
assert.ok(m, 'لم يُعثر على تعريف renderKpis في school/script.js');

const store = {};
const el = (id) => (store[id] ??= { textContent: '' });
const renderKpis = new Function('el', `${m[0]}; return renderKpis;`)(el);
const val = (id) => store[id]?.textContent;

/** فصلٌ بأرقامٍ مختصرة. */
const cls = (totalStudents, present = 0, absent = 0, late = 0, excused = 0) =>
  ({ totalStudents, stats: { present, absent, late, excused } });

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

describe('renderKpis — اليوم مكتمل الرصد', () => {
  test('المجاميع والنسبة صحيحة', () => {
    renderKpis([cls(20, 18, 2), cls(20, 19, 1)]);
    assert.equal(val('kpi-students'), 40);
    assert.equal(val('kpi-present'),  37);
    assert.equal(val('kpi-absent'),    3);
    assert.equal(val('kpi-rate'), '93٪');
  });

  test('لا ملاحظةَ مقامٍ حين رُصد الجميع', () => {
    renderKpis([cls(20, 18, 2), cls(20, 19, 1)]);
    assert.equal(val('kpi-rate-note'), '');
  });

  test('المتأخّر يُعدّ حاضراً — هو في المدرسة فعلاً', () => {
    renderKpis([cls(10, 7, 1, 2)]);
    assert.equal(val('kpi-present'), 9);
    assert.equal(val('kpi-rate'), '90٪');
  });

  test('المُعذَّر يُعدّ غائباً — عذرُه لا يجعله حاضراً', () => {
    renderKpis([cls(10, 8, 1, 0, 1)]);
    assert.equal(val('kpi-absent'), 2);
  });
});

describe('renderKpis — الرصد الجزئيّ، وهو حال الصباح', () => {
  test('النسبة تُقسم على المرصود لا على المدرسة كلّها', () => {
    // كشفٌ واحد من ستّة. القسمة على ١٢٠ طالباً تعطي ١٦٪ — إنذارٌ كاذب.
    renderKpis([cls(20, 19, 1), cls(20), cls(20), cls(20), cls(20), cls(20)]);
    assert.equal(val('kpi-rate'), '95٪');
  });

  test('المقام يُعلَن صراحةً كي لا يُقرأ الرقم أوسعَ ممّا هو', () => {
    renderKpis([cls(20, 19, 1), cls(20), cls(20)]);
    assert.match(String(val('kpi-rate-note')), /20/);
  });
});

describe('renderKpis — الحالات الحدّية', () => {
  test('لا كشوف بعدُ: شُرَطٌ لا «٠٪» توهم غياباً شاملاً', () => {
    renderKpis([cls(25)]);
    assert.equal(val('kpi-present'), '—');
    assert.equal(val('kpi-absent'),  '—');
    assert.equal(val('kpi-rate'),    '—');
  });

  test('عدد الطلاب يبقى معروفاً قبل وصول أيّ كشف', () => {
    renderKpis([cls(25)]);
    assert.equal(val('kpi-students'), 25);
  });

  test('مدرسة بلا صفوف لا تُسقط الحساب ولا تقسم على صفر', () => {
    renderKpis([]);
    assert.equal(val('kpi-students'), '—');
    assert.equal(val('kpi-rate'),     '—');
  });

  test('صفٌّ بحقولٍ ناقصة من الخادم لا يرمي', () => {
    renderKpis([{}, { totalStudents: 5 }]);
    assert.equal(val('kpi-students'), 5);
  });

  test('النسبة تبقى ضمن ٠–١٠٠', () => {
    for (const s of [[cls(10, 10)], [cls(10, 0, 10)], [cls(1, 1)]]) {
      renderKpis(s);
      const n = parseInt(String(val('kpi-rate')), 10);
      assert.ok(n >= 0 && n <= 100, `نسبة خارج المدى: ${val('kpi-rate')}`);
    }
  });
});
