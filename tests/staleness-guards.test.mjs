// ─────────────────────────────────────────────────────────────────────────────
//  حراسةُ الطزاجة: بياناتٌ يضبطها المشرف يجب أن تصل المستخدم في جلسته.
//
//  عائلةُ عللٍ لا تُرى في أيّ سجلّ ولا يبلّغ عنها أحد، لأنّ الضحيّة لا يعرف
//  أنّ ما يراه قديم: يضيف المشرفُ مجمّعاً تربوياً أو يُفعّل وحدةً، فلا يظهر
//  ذلك عند المستخدم — لا خطأ، لا رسالة، فقط قائمةٌ ناقصة أو تبويبٌ غائب.
//  ويظنّ المشرف أنّه ضبطها ويظنّ المستخدم أنّ النظام هكذا.
//
//  السببان كانا:
//   ١) _lookupCache في بوّابة المدرسة يُمسح عند تسجيل الدخول **وحده**، وتطبيقُ
//      PWA يبقى مسجَّلاً أياماً.
//   ٢) RUQI_PERMISSIONS.init() تُستدعى مرّةً عند الإقلاع **وحدها**، بينما لوحة
//      المشرف تَعِد صراحةً أنّ «التبديل ينعكس فوراً على واجهة المستخدمين».
//
//  الفحص نصّيّ لأنّ السلوك زمنيّ: محاكاةُ مرور خمس دقائق أو تبديلِ تطبيقٍ في
//  اختبارِ وحدة تُثبت المحاكاةَ لا الشيفرة. المطلوب أن يبقى الحارسُ موجوداً.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('مخبأ القوائم المرجعية له صلاحية زمنية', () => {
  const src = read('school/script.js');

  test('عتبةُ صلاحيةٍ معرَّفة', () => {
    assert.match(src, /LOOKUP_TTL_MS\s*=/,
      'اختفت عتبة الصلاحية — يعود المخبأ أبدياً فلا يرى المدير ما يضيفه المشرف.');
  });

  test('العتبة بين دقيقة وساعة — لا لحظية تُثقل الشبكة ولا يوماً يُبقي القديم', () => {
    const m = src.match(/LOOKUP_TTL_MS\s*=\s*([^;]+);/);
    assert.ok(m, 'لم يُعثر على قيمة العتبة');
    const ms = Function(`"use strict"; return (${m[1]})`)();
    assert.ok(ms >= 60_000 && ms <= 3_600_000, `عتبة خارج المدى المعقول: ${ms}ms`);
  });

  test('getLookup تقارن الزمن ولا تكتفي بوجود المفتاح', () => {
    const fn = src.match(/async function getLookup\(type\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'لم يُعثر على getLookup');
    assert.match(fn[0], /Date\.now\(\)/,
      'المخبأ يُقرأ بلا فحص زمن — عاد أبدياً.');
  });

  test('الفشل يُبقي النسخة القديمة بدل قائمةٍ فارغة تمنع الحفظ', () => {
    const fn = src.match(/async function getLookup\(type\) \{[\s\S]*?\n\}/);
    assert.match(fn[0], /catch[\s\S]*?return hit\.vals/,
      'انقطاعُ الشبكة يُفرغ القائمة فيتعذّر الحفظ بلا سببٍ ظاهر.');
  });
});

describe('الصلاحيات تُعاد قراءتها بعد الإقلاع', () => {
  const src = read('shared/permissions.js');

  test('مستمعٌ لعودة الظهور موجود', () => {
    assert.match(src, /visibilitychange/,
      'لا إعادةَ فحص — وحدةٌ يُفعّلها المشرف لا تظهر حتى يُغلق المستخدم التطبيق.');
  });

  test('حدٌّ أدنى بين الفحصين — تبديلُ تبويبٍ سريع لا يُصيب الشبكة كلَّ مرّة', () => {
    assert.match(src, /RECHECK_MIN_MS/);
    const m = src.match(/RECHECK_MIN_MS\s*=\s*([^;]+);/);
    const ms = Function(`"use strict"; return (${m[1]})`)();
    assert.ok(ms >= 10_000, `حدٌّ أدنى صغير جداً: ${ms}ms`);
  });

  test('لا يُعاد الرسم إلا عند تغيّرٍ فعليّ — إعادةٌ بلا داعٍ وميضٌ يُقرأ خللاً', () => {
    assert.match(src, /if \(before !== after\) applyToDom\(\)/,
      'applyToDom تُنادى بلا شرط فتومض الشاشة في كل عودة.');
  });

  test('لا يُفحص وهو غير ظاهر ولا وهو بلا اتصال', () => {
    const blk = src.match(/visibilitychange'[\s\S]*?\n  \}\);/);
    assert.ok(blk);
    assert.match(blk[0], /visibilityState !== 'visible'/);
    assert.match(blk[0], /!navigator\.onLine/);
  });

  test('المستمع يُركَّب مرّةً واحدة', () => {
    assert.match(src, /if \(_watching[\s\S]*?\) return;/,
      'بلا حارسٍ يتراكم مستمعٌ لكلّ نداء init.');
  });
});
