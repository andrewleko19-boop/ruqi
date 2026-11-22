// tests/home-design.test.mjs
//
// حرّاس تصميم الرئيسية (#view-attendance): الأخطاء هنا لا تُكتشف بالتحليل ولا
// بالـsmoke لأنّها بصريّة صامتة — فنثبّت ما لو انكسر لأبطل سلوكاً قائماً.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = read('school/index.html');
const js   = read('school/script.js');
const css  = read('school/style.css');
const dcss = read('school/desktop.css');

describe('الرئيسية — زرّ «إضافة» محذوف والاختيار وحده يُضيف', () => {
  test('لا أثر للزرّ في الوسم ولا في المعالج', () => {
    assert.ok(!/btn-add-absent|btnAddAbsent/.test(html + js));
  });
  test('القائمة ومعالج change باقيان', () => {
    assert.match(html, /id="in-absent"/);
    assert.match(js, /inAbsent\.addEventListener\('change'/);
  });
});

describe('الرئيسية — قواعد التصميم لا تكسر السلوك', () => {
  test('الصفّ المخفيّ بالفلتر يبقى مخفياً رغم display:grid', () => {
    assert.match(css, /#view-attendance #class-sub-list \.csub-row\[hidden\]\s*\{\s*display:\s*none/);
  });
  test('تخطيط الكمبيوتر لا يُظهر #view-attendance المخفيّ', () => {
    assert.match(dcss, /#view-attendance:not\(\[hidden\]\)\s*\{/);
    assert.ok(!/(^|\n)\s*#view-attendance\s*\{[^}]*display:\s*grid/.test(dcss));
  });
  test('إخفاء #att-done وزرّ البلاغ بـhidden يبقى', () => {
    assert.match(css, /#view-attendance #att-done\[hidden\]\s*\{\s*display:\s*none/);
    assert.match(css, /\.fab\[hidden\]\s*\{\s*display:\s*none !important/);
  });
  test('زرّ البلاغ: المعرّف والمعالج كما هما', () => {
    assert.match(html, /<button class="fab" id="btn-open-report"/);
    assert.match(js, /btn-open-report/);
  });
});
