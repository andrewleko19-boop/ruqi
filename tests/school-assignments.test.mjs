// ─────────────────────────────────────────────────────────────────────────────
//  اسم صاحب التكليف: أيّ كادرٍ يظهر لأيّ جهاز.
//
//  التقسيم كما في البيان الشهريّ الرسميّ: الجهاز التعليميّ هو staff_type =
//  teaching وحده، والجهاز الإداريّ هو ما سواه — إداريّون ومهنيّون ومستخدَمون
//  وحرّاس. الخطأ المُكلف هنا ليس استثناءً يُرمى بل قائمةٌ تُظهر الشخص في
//  الجهاز الخطأ: مستخدَمٌ يُكلَّف تكليفاً فنّياً فيدخل نصاب التدريس، أو معلّمٌ
//  يُعدّ إدارياً فيسقط منه. كلاهما يُرحَّل إلى البيان المرفوع للمديرية.
//
//  التابع معرَّف داخل script.js لا كوحدة، فيُستخرَج نصّياً — فيُختبَر ما يُشحن
//  فعلاً لا نسخةٌ منه تتقادم بصمت.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'school/script.js'), 'utf8');
const m    = src.match(/const asnStaffFor = \(kind\) => [\s\S]*?;\n/);
assert.ok(m, 'لم يُعثر على تعريف asnStaffFor في school/script.js');

/** يبني التابع فوق سجلٍّ مُعطى. */
const withRoster = (roster) =>
  new Function('_asnStaff', `${m[0]}; return asnStaffFor;`)(roster);

/** كل الأنواع التي يقبلها staff_records.staff_type. */
const ALL_TYPES = ['admin', 'teaching', 'professional', 'worker', 'guard'];
const ROSTER = ALL_TYPES.map((t, i) => ({ id: `s${i}`, full_name: `فلان ${i}`, staff_type: t }));
const typesOf = (rows) => rows.map(r => r.staff_type).sort();

describe('asnStaffFor — الجهاز التعليميّ', () => {
  test('يعرض المعلّمين وحدهم', () => {
    const got = withRoster(ROSTER)('technical');
    assert.deepEqual(typesOf(got), ['teaching']);
  });

  test('لا يعرض مستخدَماً ولا حارساً — لا يدخلان نصاب التدريس', () => {
    const got = withRoster(ROSTER)('technical').map(r => r.staff_type);
    assert.ok(!got.includes('worker'));
    assert.ok(!got.includes('guard'));
  });
});

describe('asnStaffFor — الجهاز الإداريّ', () => {
  test('يعرض الإداريّ والمهنيّ والمستخدَم والحارس', () => {
    const got = withRoster(ROSTER)('administrative');
    assert.deepEqual(typesOf(got), ['admin', 'guard', 'professional', 'worker'].sort());
  });

  test('لا يعرض المعلّمين — تكليفهم فنّيّ', () => {
    const got = withRoster(ROSTER)('administrative').map(r => r.staff_type);
    assert.ok(!got.includes('teaching'));
  });
});

describe('asnStaffFor — سلامة التقسيم', () => {
  test('كل فردٍ يقع في جهازٍ واحدٍ لا غير — لا تكرار ولا سقوط', () => {
    const fn = withRoster(ROSTER);
    const tech  = fn('technical').map(r => r.id);
    const admin = fn('administrative').map(r => r.id);
    assert.equal(tech.length + admin.length, ROSTER.length, 'مجموع الجهازين لا يساوي السجلّ');
    assert.equal(tech.filter(id => admin.includes(id)).length, 0, 'فردٌ في الجهازين معاً');
  });

  test('سجلٌّ فارغ يعطي قائمتين فارغتين لا يرمي', () => {
    const fn = withRoster([]);
    assert.deepEqual(fn('technical'), []);
    assert.deepEqual(fn('administrative'), []);
  });

  test('نوعٌ مجهول من الخادم يُحسب إدارياً لا يُسقَط بصمت', () => {
    // سطرٌ بنوعٍ لم نعرفه بعد يجب أن يبقى مرئياً في مكانٍ ما — إخفاؤه من
    // الجهازين معاً يجعل موظّفاً موجوداً في القاعدة غيرَ قابلٍ للتكليف أبداً.
    const fn = withRoster([{ id: 'x', full_name: 'ن', staff_type: 'مجهول' }]);
    assert.equal(fn('technical').length, 0);
    assert.equal(fn('administrative').length, 1);
  });
});
