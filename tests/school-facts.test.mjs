// ─────────────────────────────────────────────────────────────────────────────
//  قائمة حقائق المدرسة والمبنى في صفحة الملفّ.
//
//  الفخّ نفسه الذي وقعت فيه بطاقةُ الكادر، وهو هنا أخطر: بيانات المبنى
//  أعدادٌ في معظمها — غرفُ الصفوف والمخابر والمستودعات — و«صفر مخبر» معلومةٌ
//  صريحة تُسأل عنها الوزارة، لا حقلٌ لم يُملأ. فلترةُ falsy تمحوها فتبدو
//  المدرسةُ كأنّ أحداً لم يسجّل مخابرها، وهي سجّلت أنّها بلا مخبر.
//
//  والفرق ليس بلاغياً: الأولى تعني «أكمِل البيانات»، والثانية تعني «ابنِ مخبراً».
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'directorate/school.js'), 'utf8');
const m    = src.match(/const factList = \(pairs\) => pairs[\s\S]*?\.join\(''\);/);
assert.ok(m, 'لم يُعثر على تعريف factList في directorate/school.js');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const factList = new Function('esc', `${m[0]}; return factList;`)(esc);

const has = (html, label) => html.includes(`<dt>${label}</dt>`);
const valueOf = (html, label) => {
  const m2 = html.match(new RegExp(`<dt>${label}</dt><dd>([^<]*)</dd>`));
  return m2 ? m2[1] : undefined;
};

describe('factList — الصفر معلومةٌ لا فراغ', () => {
  test('صفرُ مخبرٍ يُعرض — «لا مخبر» غير «لم يُسجَّل»', () => {
    const html = factList([['مخبر', 0]]);
    assert.ok(has(html, 'مخبر'), 'الصفر ابتُلع كأنّه فارغ');
    assert.equal(valueOf(html, 'مخبر'), '0');
  });

  test('صفرُ غرفٍ غير مستثمرة يُعرض', () => {
    assert.equal(valueOf(factList([['غرف غير مستثمرة', 0]]), 'غرف غير مستثمرة'), '0');
  });
});

describe('factList — حذف ما لم يُملأ', () => {
  test('null وundefined والنصّ الفارغ تُحذف', () => {
    const html = factList([['أ', null], ['ب', undefined], ['ج', ''], ['د', 'قيمة']]);
    assert.ok(!has(html, 'أ')); assert.ok(!has(html, 'ب')); assert.ok(!has(html, 'ج'));
    assert.ok(has(html, 'د'));
  });

  test('قائمةٌ كلّها فارغة تعطي نصّاً فارغاً لا هيكلاً معلّقاً', () => {
    assert.equal(factList([['أ', null], ['ب', '']]), '');
  });

  test('قائمةٌ فارغة أصلاً لا ترمي', () => {
    assert.equal(factList([]), '');
  });
});

describe('factList — السلامة والصياغة', () => {
  test('قيمةٌ فيها وسمٌ تُهرَّب', () => {
    const html = factList([['العنوان', '<img src=x onerror=alert(1)>']]);
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
  });

  test('مفتاحٌ فيه وسمٌ يُهرَّب أيضاً', () => {
    assert.ok(!factList([['<b>ك</b>', 'ق']]).includes('<b>'));
  });

  test('كل زوجٍ يُغلَّف في .sp-fact واحد', () => {
    const html = factList([['أ', 1], ['ب', 2], ['ج', 3]]);
    assert.equal((html.match(/class="sp-fact"/g) || []).length, 3);
  });

  test('الأرقام تُحوَّل نصّاً بلا فقدان', () => {
    assert.equal(valueOf(factList([['الطوابق', 3]]), 'الطوابق'), '3');
  });
});
