// حارسُ التكرار في applyCatalogSubjectsToGrades يقارن catalog_id لا الاسم.
//
// العَرَض: مادّةٌ في الفهرس «رياضيات» نُسخت إلى الصفّ الأول، ثمّ أُعيدت تسميتها في الفهرس
// «رياضيات متقدّمة». نسخةُ المدرسة تحتفظ باسمها القديم، فالحارسُ القديم (مقارنةُ الاسم)
// يمرّ وتُنشأ نسخةٌ ثانية. والآن: النسخةُ المرتبطة تُعرَف بمعرّف الفهرس مهما كان اسمُها،
// والاسمُ المُطبَّع احتياطٌ للنسخ القديمة التي لا catalog_id لها فقط.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'shared/db.js'), 'utf8');
const m    = src.match(/async function applyCatalogSubjectsToGrades\(schoolId, grades, catalogIds\) \{[\s\S]*?\n\}/);
assert.ok(m, 'لم يُعثر على applyCatalogSubjectsToGrades');

function run({ catalog, existingByGrade, grades, ids }) {
  const created = [];
  const deps = {
    getSubjectCatalog:   async () => catalog,
    getSchoolSubjects:   async (_s, g) => existingByGrade[g] ?? [],
    getCatalogComponents: async () => [],
    getGradePassRules:   async () => [],
    resolvePassMark:     () => 40,
    createSubject:       async (row) => { created.push(row); return 'new-' + created.length; },
    setSubjectComponents: async () => {},
  };
  const fn = new Function(...Object.keys(deps), `return (${m[0]});`)(...Object.values(deps));
  return fn('school-1', grades, ids).then(n => ({ n, created }));
}

const cat = (id, name) => ({ id, name, is_core_arabic: false, is_core_math: false, is_foreign_language: false, allow_full_marks: false });

describe('حارس التكرار بالمعرّف', () => {
  test('نسخةٌ مرتبطة باسمٍ قديم: لا نسخةَ ثانية بعد إعادة التسمية في الفهرس', async () => {
    const { n, created } = await run({
      catalog: [cat('c1', 'رياضيات متقدّمة')],
      existingByGrade: { 1: [{ id: 's1', name: 'رياضيات', catalog_id: 'c1' }] },
      grades: [1], ids: ['c1'],
    });
    assert.equal(n, 0); assert.equal(created.length, 0);
  });

  test('نسخةٌ قديمة بلا catalog_id وباسمٍ مطابق (بعد التطبيع العربيّ): لا تكرار', async () => {
    const { n } = await run({
      catalog: [cat('c1', 'اللغة العربية')],
      existingByGrade: { 1: [{ id: 's1', name: ' اللغة  العربيه ', catalog_id: null }] },
      grades: [1], ids: ['c1'],
    });
    assert.equal(n, 0);
  });

  test('الاحتياط بالاسم لا يُطبَّق على نسخةٍ مرتبطة بمادّةٍ أخرى', async () => {
    // نسخةٌ مرتبطة بـc2 اسمُها يطابق c1 صدفةً: لا تمنع إضافة c1.
    const { n, created } = await run({
      catalog: [cat('c1', 'علوم')],
      existingByGrade: { 1: [{ id: 's9', name: 'علوم', catalog_id: 'c2' }] },
      grades: [1], ids: ['c1'],
    });
    assert.equal(n, 1); assert.equal(created[0].catalogId, 'c1');
  });

  test('مادّةٌ غائبة تُنشأ، وتُسجَّل catalogId', async () => {
    const { n, created } = await run({
      catalog: [cat('c1', 'فيزياء')],
      existingByGrade: { 1: [] }, grades: [1], ids: ['c1'],
    });
    assert.equal(n, 1); assert.equal(created[0].catalogId, 'c1'); assert.equal(created[0].grade, 1);
  });

  test('لكلّ صفٍّ حسابُه: موجودةٌ في الأول، تُنشأ في الثاني فقط', async () => {
    const { n, created } = await run({
      catalog: [cat('c1', 'رياضيات')],
      existingByGrade: { 1: [{ id: 's1', name: 'اسمٌ قديم', catalog_id: 'c1' }], 2: [] },
      grades: [1, 2], ids: ['c1'],
    });
    assert.equal(n, 1); assert.equal(created[0].grade, 2);
  });

  test('getSchoolSubjects يجلب catalog_id (وإلا لا يعمل الحارس)', () => {
    assert.match(src, /\.select\('id, school_id, grade, name, [^']*is_active, catalog_id'\)/);
  });
});
