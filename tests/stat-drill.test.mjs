// ─────────────────────────────────────────────────────────────────────────────
//  StatDrill — شبكة الأرقام القابلة للضغط ونافذة التفصيل.
//
//  المخاطر الحقيقية هنا ثلاثة، وكلّها تُفسد الثقة بالرقم لا تُسقط الصفحة:
//   ١) رقمٌ بلا تفصيل يبدو زرّاً فيُضغط فلا شيء — يجب أن يُعرض معطّلاً.
//   ٢) اسمُ مدرسةٍ فيه < أو & يُحقن نصّاً خاماً — تشوّهٌ في أحسن الأحوال وحقنٌ
//      في أسوئها. الأسماء تأتي من إدخالٍ بشريّ في مئات المدارس.
//   ٣) rows دالةً لا مصفوفة: التفصيل يُبنى عند الضغط لا مسبقاً، فقوائم لن
//      يفتحها أحد لا تُحسب أصلاً. لو نُفِّذت مبكّراً ضاعت الفائدة كلّها.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = join(ROOT, 'shared/stat-drill.js');

// الوحدة تلمس document عند أوّل استعمال، فيُركَّب DOM صغير قبل الاستيراد.
let StatDrill, container;

before(async () => {
  const { JSDOM } = await import('jsdom').catch(() => ({ JSDOM: null }));
  if (!JSDOM) return;                       // بيئة بلا jsdom — تُتخطّى الحزمة
  const dom = new JSDOM('<!doctype html><body><div id="g"></div></body>');
  global.document = dom.window.document;
  global.window   = dom.window;
  ({ StatDrill } = await import(SRC));
  container = document.getElementById('g');
});

beforeEach(() => { if (container) container.innerHTML = ''; });

const hasDom = () => !!container;

describe('StatDrill.grid — الرسم', { skip: false }, () => {
  test('يرسم زرّاً لكل بند بقيمته وعنوانه', (t) => {
    if (!hasDom()) return t.skip('jsdom غير متاح');
    StatDrill.grid(container, [
      { title: 'المدارس', items: [
        { label: 'ابتدائي', value: '42', drill: { rows: [] } },
        { label: 'إعدادي',  value: '17', drill: { rows: [] } },
      ] },
    ]);
    const chips = container.querySelectorAll('.sd-chip');
    assert.equal(chips.length, 2);
    assert.match(chips[0].textContent, /42/);
    assert.match(chips[0].textContent, /ابتدائي/);
  });

  test('بندٌ بلا تفصيل يُعرض معطّلاً — لا يوهم بأنه زرّ يفتح شيئاً', (t) => {
    if (!hasDom()) return t.skip('jsdom غير متاح');
    StatDrill.grid(container, [
      { title: 'ت', items: [
        { label: 'بلا تفصيل', value: '0' },
        { label: 'بتفصيل',    value: '3', drill: { rows: [{ label: 'أ' }] } },
      ] },
    ]);
    const chips = container.querySelectorAll('.sd-chip');
    assert.equal(chips[0].disabled, true,  'البند بلا drill يجب أن يكون معطّلاً');
    assert.equal(chips[1].disabled, false, 'البند بـdrill يجب أن يكون فعّالاً');
  });

  test('مجموعةٌ بلا بنود تُحذف — عنوانٌ فوق فراغٍ ضجيج', (t) => {
    if (!hasDom()) return t.skip('jsdom غير متاح');
    StatDrill.grid(container, [
      { title: 'فارغة', items: [] },
      { title: 'عامرة', items: [{ label: 'أ', value: '1' }] },
    ]);
    assert.equal(container.querySelectorAll('.sd-group').length, 1);
  });

  test('حاويةٌ معدومة لا تُسقط الصفحة', (t) => {
    if (!hasDom()) return t.skip('jsdom غير متاح');
    assert.doesNotThrow(() => StatDrill.grid(null, [{ title: 'أ', items: [] }]));
  });
});

describe('StatDrill — الحقن النصّي', () => {
  test('اسمٌ فيه وسوم HTML يُهرَّب في الشبكة', (t) => {
    if (!hasDom()) return t.skip('jsdom غير متاح');
    StatDrill.grid(container, [
      { title: '<img src=x onerror=alert(1)>', items: [
        { label: '<b>غامق</b>', value: '<script>', drill: { rows: [] } }] },
    ]);
    assert.equal(container.querySelectorAll('img, script, b').length, 0,
      'وسمٌ من بيانات المستخدم نُفِّذ بدل أن يُهرَّب');
    assert.match(container.textContent, /<b>غامق<\/b>/);
  });

  test('اسمٌ فيه وسوم يُهرَّب في نافذة التفصيل', (t) => {
    if (!hasDom()) return t.skip('jsdom غير متاح');
    StatDrill.open('ع', '', [{ label: '<i>مدرسة</i>', sub: '<u>س</u>', value: '<b>1</b>' }]);
    const body = document.querySelector('.sd-body');
    assert.equal(body.querySelectorAll('i, u, b').length, 0);
    assert.match(body.textContent, /<i>مدرسة<\/i>/);
    StatDrill.close();
  });
});

describe('StatDrill.open — نافذة التفصيل', () => {
  test('تعرض صفّاً لكل عنصر ومجموعاً في الذيل', (t) => {
    if (!hasDom()) return t.skip('jsdom غير متاح');
    StatDrill.open('المدارس', 'اللاذقية', [
      { label: 'مدرسة أ', value: '120' },
      { label: 'مدرسة ب', value: '80' },
      { label: 'مدرسة ج', value: '0' },
    ]);
    assert.equal(document.querySelectorAll('.sd-row').length, 3);
    assert.match(document.querySelector('.sd-foot').textContent, /3/);
    StatDrill.close();
  });

  test('قائمةٌ فارغة تقول ذلك صراحةً ولا تعرض ذيلاً', (t) => {
    if (!hasDom()) return t.skip('jsdom غير متاح');
    StatDrill.open('ع', '', []);
    assert.equal(document.querySelectorAll('.sd-row').length, 0);
    assert.ok(document.querySelector('.sd-empty'));
    assert.equal(document.querySelector('.sd-foot').hidden, true);
    StatDrill.close();
  });

  test('الإغلاق يُخفي النافذة ويُرجع تمرير الصفحة', (t) => {
    if (!hasDom()) return t.skip('jsdom غير متاح');
    StatDrill.open('ع', '', [{ label: 'أ' }]);
    assert.equal(document.querySelector('.sd-overlay').hidden, false);
    assert.equal(document.body.style.overflow, 'hidden');
    StatDrill.close();
    assert.equal(document.querySelector('.sd-overlay').hidden, true);
    assert.equal(document.body.style.overflow, '');
  });
});

describe('StatDrill — التفصيل الكسول', () => {
  test('rows الدالة لا تُنفَّذ عند الرسم بل عند الضغط', (t) => {
    if (!hasDom()) return t.skip('jsdom غير متاح');
    let calls = 0;
    StatDrill.grid(container, [
      { title: 'ت', items: [{ label: 'أ', value: '1',
        drill: { title: 'ت', rows: () => { calls++; return [{ label: 'س' }]; } } }] },
    ]);
    assert.equal(calls, 0, 'التفصيل حُسب قبل أن يطلبه أحد');
    container.querySelector('.sd-chip').click();
    assert.equal(calls, 1);
    assert.equal(document.querySelectorAll('.sd-row').length, 1);
    StatDrill.close();
  });
});
