// ─────────────────────────────────────────────────────────────────────────────
//  تنبيه نصاب التدريس في بوّابة المدرسة.
//
//  الخطأ المُكلف هنا ليس استثناءً بل تشهيرٌ بالبريء: معلّمٌ لم يُملأ حقلُ
//  نصابه بعدُ (weekly_lessons = NULL) يظهر «متجاوزاً» لو عُومِل الفارغُ صفراً.
//  فالنصاب الغائب حالةٌ ثالثة قائمة بذاتها: بيانٌ ناقص يُستكمل، لا مخالفةٌ
//  تُساءل. الدالة SQL تُرجع excess = null لهذه الحالة، والواجهة تفصلها.
//
//  ويُختبَر كذلك أنّ البطاقة تختفي حين لا شيء يُنبَّه عليه — تنبيهٌ دائم
//  الظهور يُتجاهَل، فيضيع معه التنبيه الحقيقيّ حين يقع.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'school/script.js'), 'utf8');
const m    = src.match(/function renderQuotaAlert\(\) \{[\s\S]*?\n\}/);
assert.ok(m, 'لم يُعثر على تعريف renderQuotaAlert في school/script.js');

// عناصر DOM وهمية بما يكفي لما تلمسه الدالة.
const store = {};
const mk = (id) => (store[id] ??= {
  id, hidden: true, textContent: '', innerHTML: '',
  classList: { _s: new Set(), toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
               has(c) { return this._s.has(c); } },
});
const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const show = (n) => { if (n) n.hidden = false; };
const hide = (n) => { if (n) n.hidden = true; };

let rows = [];
let expanded = false;
const renderQuotaAlert = new Function(
  'el', 'escapeHtml', 'show', 'hide', 'getRows', 'getExpanded',
  `const _quotaRows = getRows(); const _quotaExpanded = getExpanded();
   ${m[0]}; return renderQuotaAlert;`,
);
const render = () => renderQuotaAlert(
  mk, escapeHtml, show, hide, () => rows, () => expanded)();

/** معلّم: نصابٌ (أو null) وحملٌ مسنَد. excess كما تحسبه الدالة SQL. */
const t = (name, quota, assigned) => ({
  full_name: name, quota, assigned,
  excess: quota == null ? null : Math.max(0, assigned - quota),
});

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  rows = []; expanded = false;
});

describe('نصاب التدريس — التمييز بين التجاوز والنقص', () => {
  test('نصابٌ فارغ ليس تجاوزاً — لا يُشهَّر بمن لم يُملأ حقلُه', () => {
    rows = [t('سميرة', null, 22)];
    render();
    assert.match(store['quota-alert-title'].textContent, /بلا نصابٍ محدَّد/);
    assert.doesNotMatch(store['quota-alert-title'].textContent, /تجاوزوا/);
    assert.equal(store['quota-alert'].classList.has('is-danger'), false);
  });

  test('حملٌ يفوق نصاباً محدَّداً تجاوزٌ يُعلَن بالأحمر', () => {
    rows = [t('أحمد', 15, 16)];
    render();
    assert.match(store['quota-alert-title'].textContent, /1 تجاوزوا النصاب/);
    assert.equal(store['quota-alert'].classList.has('is-danger'), true);
  });

  /* كان هذا الاختبار يشترط «16 / 15 +1» — وهو ما ثبّت العلّة بدل أن يمسكها.
     الرقمان مقطعان لاتينيّان والشرطةُ محايدة والفقرةُ عربية، فتعكس خوارزميةُ
     ثنائية الاتجاه ترتيبَهما بصريّاً: يبنيه الكود «15/16» ويقرؤه المديرُ
     «16/15». فمديرٌ أسند ١٥ درساً لمعلّمةٍ نصابُها ١٢ قرأ أنّها دون النصاب —
     عكسُ الحقيقة، وفوقه عنوانٌ أحمر يقول «تجاوزوا النصاب». وهو ما أبلغ عنه
     المستخدم حرفاً. والاختبار الآن يشترط النقيض: لا زوجَ أرقامٍ عارٍ ألبتّة. */
  test('كلُّ رقمٍ يسبقه اسمه — لا زوجَ أرقامٍ تعكسه ثنائيةُ الاتجاه', () => {
    rows = [t('أحمد', 15, 16)];
    render();
    const h = store['quota-alert-list'].innerHTML;
    assert.match(h, /الحمل <b>16<\/b>/);
    assert.match(h, /النصاب <b>15<\/b>/);
    assert.match(h, /تجاوز <b>1<\/b>/);
  });

  test('لا يتجاور رقمٌ برقمٍ في النصّ المعروض', () => {
    rows = [t('أحمد', 15, 16)];
    render();
    // النصّ المرئيّ وحده (بلا وسوم): زوجٌ متجاورٌ بفاصلٍ محايد هو ما يُعكَس.
    const text = store['quota-alert-list'].innerHTML.replace(/<[^>]+>/g, ' ');
    assert.ok(!/\d+\s*[/\-–]\s*\d+/.test(text),
      `زوجُ أرقامٍ عارٍ عاد إلى الشاشة: ${text.trim()}`);
  });

  test('الحالتان معاً تُعدّان منفصلتين في العنوان', () => {
    rows = [t('أحمد', 15, 18), t('سميرة', null, 9), t('هالة', null, 4)];
    render();
    assert.match(store['quota-alert-title'].textContent, /1 تجاوزوا النصاب/);
    assert.match(store['quota-alert-title'].textContent, /2 بلا نصابٍ محدَّد/);
  });

  test('حملٌ مساوٍ للنصاب ليس تجاوزاً — الحدّ مسموح', () => {
    rows = [t('أحمد', 15, 15)];
    render();
    assert.equal(store['quota-alert'].hidden, true);
  });
});

describe('نصاب التدريس — ظهور البطاقة', () => {
  test('تختفي حين لا تجاوز ولا نقص — تنبيهٌ دائم يُتجاهَل', () => {
    rows = [t('أحمد', 15, 12), t('سميرة', 18, 18)];
    render();
    assert.equal(store['quota-alert'].hidden, true);
  });

  test('تختفي حين لا معلّمين أصلاً', () => {
    rows = [];
    render();
    assert.equal(store['quota-alert'].hidden, true);
  });

  test('تظهر ثلاثةً فقط وتُخفي الزرّ حين لا مزيد', () => {
    rows = [t('أ', 15, 16), t('ب', 15, 17)];
    render();
    assert.equal((store['quota-alert-list'].innerHTML.match(/<li>/g) || []).length, 2);
    assert.equal(store['btn-quota-detail'].hidden, true);
  });

  test('أكثر من ثلاثة: ثلاثةٌ وزرٌّ يُعلن العدد الكامل', () => {
    rows = [t('أ', 15, 16), t('ب', 15, 17), t('ج', 15, 18), t('د', 15, 19), t('هـ', null, 3)];
    render();
    assert.equal((store['quota-alert-list'].innerHTML.match(/<li>/g) || []).length, 3);
    assert.equal(store['btn-quota-detail'].hidden, false);
    assert.match(store['btn-quota-detail'].textContent, /5/);
  });

  test('التوسيع يعرض الجميع', () => {
    rows = [t('أ', 15, 16), t('ب', 15, 17), t('ج', 15, 18), t('د', 15, 19)];
    expanded = true;
    render();
    assert.equal((store['quota-alert-list'].innerHTML.match(/<li>/g) || []).length, 4);
    assert.match(store['btn-quota-detail'].textContent, /إخفاء/);
  });
});

describe('نصاب التدريس — السلامة', () => {
  test('اسمٌ فيه وسمٌ يُهرَّب', () => {
    rows = [t('<img src=x>', 15, 20)];
    render();
    assert.doesNotMatch(store['quota-alert-list'].innerHTML, /<img/);
    assert.match(store['quota-alert-list'].innerHTML, /&lt;img/);
  });

  test('المتجاوزون يسبقون ناقصي النصاب في العرض المختصر', () => {
    rows = [t('متجاوز', 15, 20), t('ناقص١', null, 5), t('ناقص٢', null, 6), t('ناقص٣', null, 7)];
    render();
    const h = store['quota-alert-list'].innerHTML;
    assert.ok(h.indexOf('متجاوز') < h.indexOf('ناقص١'), 'التجاوز يجب أن يتصدّر');
  });
});
