// ─────────────────────────────────────────────────────────────────────────────
//  escapeHtml — الحارس الذي أسقط تبويب «الكادر» بأكمله حين غاب.
//
//  ما حدث فعلاً: عمود staff_credentials.password يقبل NULL في القاعدة، وصفٌّ
//  واحد بكلمة مرور فارغة كان يُمرَّر إلى escapeHtml التي تستدعي .replace مباشرةً
//  على المُعامل — فترمي TypeError داخل Array.map، فيفشل renderCredentials كلّه،
//  فيظهر التبويب معطوباً بلا حسابات أصلاً بدل أن ينقصه حقلٌ واحد في صفٍّ واحد.
//
//  الدالة معرّفة داخل سكربتات البوّابات لا كوحدة، فتُستخرَج نصّياً وتُقيَّم — هكذا
//  يختبر الاختبارُ الشيفرةَ المشحونة فعلاً لا نسخةً منها تتقادم بصمت.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** يستخرج تعريف escapeHtml من ملف بوّابة ويعيده دالّةً قابلة للاستدعاء. */
function loadEscapeHtml(relPath) {
  const src = readFileSync(join(ROOT, relPath), 'utf8');
  const m = src.match(/function escapeHtml\s*\([\s\S]*?\n\}/);
  assert.ok(m, `لم يُعثر على تعريف escapeHtml في ${relPath}`);
  return new Function(`${m[0]}; return escapeHtml;`)();
}

const PORTALS = [
  ['school',  'school/script.js'],
  ['teacher', 'teacher/script.js'],
  ['shared',  'shared/db.js'],
];

for (const [name, path] of PORTALS) {
  describe(`escapeHtml — ${name}`, () => {
    const escapeHtml = loadEscapeHtml(path);

    test('لا ترمي على null — الانحدار الذي أسقط تبويب الكادر', () => {
      assert.equal(escapeHtml(null), '');
    });

    test('لا ترمي على undefined ولا تطبع "undefined"', () => {
      assert.equal(escapeHtml(undefined), '');
    });

    test('الفراغ يبقى فراغاً', () => {
      assert.equal(escapeHtml(''), '');
    });

    test('لا تطبع "null" نصّاً على الشاشة', () => {
      assert.ok(!escapeHtml(null).includes('null'));
    });

    test('تقبل الأرقام لا النصوص فقط', () => {
      assert.equal(escapeHtml(42), '42');
      assert.equal(escapeHtml(0), '0');
    });

    test('تُهرّب محارف HTML الخطرة', () => {
      assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
      assert.equal(escapeHtml('a & b'), 'a &amp; b');
      assert.equal(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
    });

    test('تُهرّب العلامة المفردة — وإلا خرجت القيمة من سمةٍ بعلامةٍ مفردة', () => {
      assert.equal(escapeHtml("it's"), 'it&#39;s');
    });

    test('& تُهرَّب أوّلاً فلا يُهرَّب التهريب مرّتين', () => {
      // لو جاء ترتيب < قبل & لصار &lt; ثمّ &amp;lt; فيُعرَض النصّ خاماً.
      assert.equal(escapeHtml('<'), '&lt;');
      assert.equal(escapeHtml('&lt;'), '&amp;lt;');
    });

    test('نصٌّ عربيّ يمرّ كما هو', () => {
      assert.equal(escapeHtml('مدرسة ألف'), 'مدرسة ألف');
    });
  });
}

describe('صفّ اعتماد بكلمة مرور فارغة — الحالة الواقعية', () => {
  const escapeHtml = loadEscapeHtml('school/script.js');

  test('كشف الحسابات يُبنى كاملاً رغم صفٍّ بكلمة مرور NULL', () => {
    const rows = [
      { userId: 'u1', username: 'teacher.a', password: 'Abc12345' },
      { userId: 'u2', username: 'teacher.b', password: null },      // الصفّ القاتل
      { userId: 'u3', username: 'teacher.c', password: 'Xyz98765' },
    ];
    const html = rows.map(c =>
      `<li data-uid="${escapeHtml(c.userId)}">${escapeHtml(c.username)}` +
      `<code data-pw="${escapeHtml(c.password)}"></code></li>`
    ).join('');

    // الثلاثة كلّها حاضرة: لا يسقط الكشف بسبب واحد.
    assert.equal((html.match(/<li /g) || []).length, 3);
    assert.ok(html.includes('teacher.a'));
    assert.ok(html.includes('teacher.b'));
    assert.ok(html.includes('teacher.c'));
    assert.ok(!html.includes('null'));
  });
});
