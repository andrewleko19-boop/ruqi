// ─────────────────────────────────────────────────────────────────────────────
//  اتّساق نظام الأرقام عبر البوّابات.
//
//  toLocaleString() بلا وسيط لغة يتبع لغة المتصفّح، فيُخرج على متصفّحٍ عربيّ
//  أرقاماً عربية-هندية (١٬٢٣٤). والمصيدة أنّه يعمل صحيحاً في كل اختبارٍ يجري
//  على عقدة بلغة C — فلا ينكشف إلا على شاشة مستخدمٍ حقيقيّ.
//
//  وقد وقع فعلاً: كانت لوحة الوزارة تكتب «٣١٢ مدرسة» بجوار «45.7 طالب/مدرّس»
//  في الصفّ الواحد، لأنّ fmt تتبع اللغة وtoFixed لا تتبعها. ثلاثةُ أنظمةِ
//  أرقامٍ اجتمعت في شاشة: fmt العربية، وtoFixed اللاتينية، وStatDrill التي
//  ثُبّتت لاتينيةً في إصلاحٍ سابق عالج المديرية ولم يفحص الوزارة.
//
//  فيُفحَص المصدرُ نصّياً: كلّ toLocaleString في شيفرة العرض يجب أن تُصرّح
//  بلغتها. اختبارُ السلوك وحده لا يكفي هنا لأن البيئة تُخفي العيب.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'ministry/script.js',
  'directorate/script.js',
  'directorate/school.js',
  'shared/stat-drill.js',
];

/** يلتقط كل نداء toLocaleString مع أوّل وسيطٍ له إن وُجد. */
function localeCalls(src) {
  const out = [];
  const re = /\.toLocaleString\(\s*([^)]*)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ line, arg: m[1].trim() });
  }
  return out;
}

describe('كل toLocaleString تُصرّح بلغتها', () => {
  for (const rel of FILES) {
    test(rel, () => {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      const bare = localeCalls(src).filter(c => c.arg === '');
      assert.deepEqual(bare, [],
        `${rel}: نداءٌ بلا لغة في السطر ${bare.map(b => b.line).join(', ')} — ` +
        'سيُخرج أرقاماً عربية-هندية على متصفّحٍ عربيّ ويخلط نظامَين.');
    });
  }
});

/* المنسِّقات العددية الثلاث — واحدةٌ لكل بوّابة. تُفحَص بأعيانها لا بمسحٍ
   عامّ على toLocaleString: التواريخ تُنسَّق بـen-GB عمداً (يوم/شهر/سنة)، ومسحٌ
   يطالب بلغةٍ واحدة يرفعها إنذاراً كاذباً ثم يُروَّض بتعطيله فيضيع الحارس. */
const NUM_FORMATTERS = [
  ['ministry/script.js',      /const fmt\s*=[^;]*?toLocaleString\('([^']+)'\)/],
  ['directorate/script.js',   /const fmtNum\s*=[^;]*?toLocaleString\('([^']+)'\)/],
  ['directorate/school.js',   /const num\s*=[^;]*?toLocaleString\('([^']+)'\)/],
  ['shared/stat-drill.js',    /const num\s*=[^;]*?toLocaleString\('([^']+)'\)/],
];

describe('المنسِّقات العددية تتّفق على لغةٍ واحدة', () => {
  for (const [rel, re] of NUM_FORMATTERS) {
    test(rel, () => {
      const m = readFileSync(join(ROOT, rel), 'utf8').match(re);
      assert.ok(m, `${rel}: لم يُعثر على المنسِّق العدديّ — رُبّما أُعيدت تسميته`);
      assert.equal(m[1], 'en-US',
        `${rel}: المنسِّق يستعمل ${m[1]} بينما البقيّة en-US — نظاما أرقامٍ في تطبيقٍ واحد.`);
    });
  }
});

describe('السلوك الفعليّ عبر اللغات', () => {
  test('en-US المُصرَّح بها لاتينيةٌ مهما كانت لغة البيئة', () => {
    // ما يفعله fmt وfmtNum وStatDrill بعد التصريح.
    assert.equal((1234).toLocaleString('en-US'), '1,234');
    assert.match((1234).toLocaleString('en-US'), /^[\d,]+$/);
  });

  test('ar-SY تُخرج أرقاماً عربية-هندية — وهذا ما نتجنّبه', () => {
    // يوثّق سبب المنع: لولاه لبدا الفحص أعلاه تعسّفاً.
    assert.doesNotMatch((1234).toLocaleString('ar-SY'), /^[\d,]+$/);
  });

  test('toFixed لاتينيةٌ دائماً فتتّسق مع en-US', () => {
    assert.equal((32.75).toFixed(1), '32.8');
  });
});
