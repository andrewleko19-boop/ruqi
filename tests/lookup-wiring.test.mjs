// ─────────────────────────────────────────────────────────────────────────────
//  كلُّ قائمةٍ منسدلة تقرأ من قائمةٍ يملكها المشرف — وقائمةٍ واحدة لا اثنتين.
//
//  علّةٌ لا تُرى في سجلّ ولا يبلّغ عنها أحد: يفتح المديرُ حقلاً فيجده فارغاً
//  أبداً، أو يجد فيه خياراً واحداً بينما الجارُ ممتلئ — فيكتب ما يراه صواباً،
//  أو يترك الحقل. ثمّ تُجمَّع الأسماء في لوحة المديرية فتتفرّق: «مدينة اللاذقية»
//  و«المدينة» و«اللاذقية» ثلاثةُ مجمّعات في التقرير وواحدٌ في الواقع.
//
//  وقعت مرّتين:
//   ١) «المجمّع التربوي» كان يقرأ school_complex، و«المنطقة التعليمية» تقرأ
//      educational_zone — وهما في التقسيم الإداريّ السوريّ الشيءُ نفسه. فملأ
//      المشرفُ واحدةً ونسي الأخرى، وهذا ما رآه المستخدم بعينه.
//   ٢) نافذةُ «إضافة تعديل يدوي» كانت نصّاً حرّاً في كلّ حقولها بينما نافذةُ
//      سجلّ الكوادر المجاورة تقرأ القوائم نفسها من لوحة المشرف — مصدران
//      للحقيقة في المدرسة الواحدة، وكلاهما يُرحَّل إلى البيان المرفوع.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const school = read('school/script.js');
const admin  = read('admin/script.js');

/** أنواعُ القوائم التي تعرضها لوحة المشرف فيستطيع ملأها. */
const managed = (() => {
  const block = admin.match(/const LIST_TYPE_LABELS = \{[\s\S]*?\n\};/);
  assert.ok(block, 'لم يُعثر على LIST_TYPE_LABELS في لوحة المشرف');
  return new Set([...block[0].matchAll(/^\s{2}([a-z_]+):/gm)].map(m => m[1]));
})();

describe('المجمّع التربوي والمنطقة التعليمية قائمةٌ واحدة', () => {
  test('كلاهما يقرأ educational_zone', () => {
    const fn = school.match(/async function fillComplexSelect\(\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'لم يُعثر على fillComplexSelect');
    assert.match(fn[0], /getLookup\('educational_zone'\)/,
      'المجمّع التربوي يقرأ قائمةً ثانية — يملأ المشرفُ واحدةً وينسى الأخرى.');
    assert.match(school, /getLookup\('educational_zone'\)/);
  });

  test('لا قراءةَ لـ school_complex بعد التوحيد', () => {
    assert.ok(!/getLookup\('school_complex'\)/.test(school),
      'بقيت القائمة المنفصلة مقروءةً — فتعود المشكلة كما كانت.');
  });
});

describe('كلُّ نوعٍ يُقرأ من التطبيق يستطيع المشرف ملأه', () => {
  const readTypes = [...school.matchAll(/getLookup\('([a-z_]+)'\)/g)].map(m => m[1]);

  test('عُثر على قراءاتٍ فعلية', () => {
    assert.ok(readTypes.length > 3, `قراءات قليلة جداً: ${readTypes.length}`);
  });

  test('لا نوعَ يُقرأ ولا تعرضه لوحة المشرف', () => {
    const orphans = [...new Set(readTypes)].filter(t => !managed.has(t));
    assert.deepEqual(orphans, [],
      `أنواعٌ تُقرأ ولا يستطيع المشرف ملأها: ${orphans.join('، ')} — قائمةٌ فارغة إلى الأبد.`);
  });
});

describe('حقول نافذة التعديل تقرأ أنواعاً مضبوطة', () => {
  const types = [...school.matchAll(/'lookup:([a-z_]+)'/g)].map(m => m[1]);

  test('عُثر على حقول lookup', () => {
    assert.ok(types.length >= 4, `عدد الحقول: ${types.length}`);
  });

  test('كلُّها معروضةٌ في لوحة المشرف', () => {
    const orphans = [...new Set(types)].filter(t => !managed.has(t));
    assert.deepEqual(orphans, [], `أنواعٌ لا يضبطها المشرف: ${orphans.join('، ')}`);
  });

  test('وكلُّها مجلوبةٌ قبل بناء الحقول', () => {
    const pre = school.match(/const STMT_CHG_LOOKUP_TYPES = \[[\s\S]*?\];/);
    assert.ok(pre, 'لا جلبَ مسبق — تُرسم القوائم فارغةً ثمّ تُبنى ثانيةً.');
    for (const t of new Set(types)) {
      assert.ok(pre[0].includes(`'${t}'`), `${t} غير مجلوبٍ قبل الرسم — يظهر الحقل فارغاً.`);
    }
  });
});
