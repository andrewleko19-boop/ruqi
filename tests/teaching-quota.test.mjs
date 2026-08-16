// ─────────────────────────────────────────────────────────────────────────────
//  تنبيه نصاب التدريس في بوّابة المدرسة.
//
//  الخطأ المُكلف هنا تشهيرٌ بالبريء. وقد وقع بصيغتين:
//
//   ١) الأولى: معلّمٌ لم يُملأ حقلُ نصابه يظهر «متجاوزاً» لو عُومِل الفارغُ
//      صفراً. حُرست بأن صار الفارغ حالةً ثالثة لا مخالفة.
//
//   ٢) والثانية أدهى، وهي ما أبلغ عنه المستخدم: النصاب كان يُؤخَذ من
//      staff_records.weekly_lessons — خانةٍ في سجلّ الشخص نفسه. فقرأ المدير
//      «سناء — الحمل ١٦، النصاب ١٢، تجاوز ٤» بالأحمر، ولا يعرف مَن قرّر أنّ
//      نصابها ١٢: لا هو ولا الوزارة. حكمٌ بلا حاكم. وصار النصاب يُشتقّ من
//      سلطته: تجاوزُ المدرسة ← الحدُّ الوطنيّ ← لا شيء.
//
//  ومِن ذلك حالةٌ جديدة تُختبَر هنا: **لا جهةَ حدّدت نصاباً**. الصوابُ حينها
//  جملةٌ واحدة تقول ذلك، لا سطرٌ لكلّ موظّف يتّهمه بأنّه «بلا نصاب» — العيبُ
//  في الإعداد لا في الكادر.
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
  classList: { _s: new Set(),
               toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
               remove(c) { this._s.delete(c); },
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

/** صفٌّ كما تبنيه get_teaching_load: الحدّان الفعليّان، والحمل، وفرقاهما. */
const t = (name, { min = null, max = null, assigned = 0 } = {}) => ({
  full_name: name,
  quota:     max,
  quota_min: min,
  assigned,
  excess:    max == null ? null : Math.max(0, assigned - max),
  shortfall: min == null ? null : Math.max(0, min - assigned),
});

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  rows = []; expanded = false;
});

describe('نصاب التدريس — حين لا جهةَ حدّدته', () => {
  /* هذه هي علّة المستخدم بعينها بعد إزالة الرقم المزروع: لو بقيت الواجهة على
     منطقها القديم لعرضت سطراً لكلّ موظّف يقول «نصاب غير محدَّد» — قائمةٌ
     بكامل الكادر تتّهمهم بعيبٍ ليس فيهم. */
  test('رسالةٌ واحدة تشرح، لا سطرٌ لكلّ موظّف', () => {
    rows = [t('أحمد', { assigned: 16 }), t('سميرة', { assigned: 9 }),
            t('هالة', { assigned: 22 })];
    render();
    assert.match(store['quota-alert-title'].textContent, /لم يُحدَّد نصابُ التدريس/);
    assert.equal((store['quota-alert-list'].innerHTML.match(/<li/g) || []).length, 1);
    assert.equal(store['quota-alert'].hidden, false);
  });

  test('ليست حالةَ خطرٍ حمراء — العيب في الإعداد لا في الكادر', () => {
    rows = [t('أحمد', { assigned: 40 })];
    render();
    assert.equal(store['quota-alert'].classList.has('is-danger'), false);
  });

  test('تُرشد إلى موضع الضبط', () => {
    rows = [t('أحمد', { assigned: 16 })];
    render();
    assert.match(store['quota-alert-list'].innerHTML, /إعدادات المدرسة/);
  });

  test('لا اسمَ موظّفٍ في الرسالة — لا تشهيرَ بمن لا ذنبَ له', () => {
    rows = [t('سناء مصطفى وليو', { assigned: 16 })];
    render();
    assert.doesNotMatch(store['quota-alert-list'].innerHTML, /سناء/);
  });

  test('زرُّ التوسيع يختفي — لا قائمةَ تُوسَّع', () => {
    rows = [t('أ', { assigned: 1 }), t('ب', { assigned: 2 }),
            t('ج', { assigned: 3 }), t('د', { assigned: 4 })];
    render();
    assert.equal(store['btn-quota-detail'].hidden, true);
  });

  test('لا كادرَ أصلاً: تختفي البطاقة ولا تُلقى محاضرةُ إعداد', () => {
    rows = [];
    render();
    assert.equal(store['quota-alert'].hidden, true);
  });
});

describe('نصاب التدريس — التمييز بين التجاوز والنقص', () => {
  test('حملٌ يفوق الحدّ الأعلى تجاوزٌ يُعلَن بالأحمر', () => {
    rows = [t('أحمد', { min: 12, max: 15, assigned: 16 })];
    render();
    assert.match(store['quota-alert-title'].textContent, /1 تجاوزوا النصاب/);
    assert.equal(store['quota-alert'].classList.has('is-danger'), true);
  });

  /* نصفُ الحدّ كان مهملاً: الدالّة تُرجع حدّاً أدنى ولا أحد يقرؤه، فمعلّمٌ
     بأربع حصصٍ ونصابُه اثنتا عشرة يمرّ بلا كلمة. */
  test('حملٌ دون الحدّ الأدنى نقصٌ يُعلَن — لا يمرّ صامتاً', () => {
    rows = [t('سميرة', { min: 12, max: 24, assigned: 4 })];
    render();
    assert.match(store['quota-alert-title'].textContent, /1 دون النصاب/);
    assert.doesNotMatch(store['quota-alert-title'].textContent, /تجاوزوا/);
  });

  test('النقص ليس حالةَ خطرٍ حمراء كالتجاوز', () => {
    rows = [t('سميرة', { min: 12, max: 24, assigned: 4 })];
    render();
    assert.equal(store['quota-alert'].classList.has('is-danger'), false);
  });

  test('الحالتان معاً تُعدّان منفصلتين في العنوان', () => {
    rows = [t('أحمد', { min: 12, max: 15, assigned: 18 }),
            t('سميرة', { min: 12, max: 24, assigned: 9 }),
            t('هالة',  { min: 12, max: 24, assigned: 4 })];
    render();
    assert.match(store['quota-alert-title'].textContent, /1 تجاوزوا النصاب/);
    assert.match(store['quota-alert-title'].textContent, /2 دون النصاب/);
  });

  test('حملٌ بين الحدَّين لا يُنبَّه عليه', () => {
    rows = [t('أحمد', { min: 12, max: 24, assigned: 15 })];
    render();
    assert.equal(store['quota-alert'].hidden, true);
  });

  test('حملٌ مساوٍ لحدٍّ ليس مخالفةً — الطرفان مسموحان', () => {
    rows = [t('أ', { min: 12, max: 24, assigned: 24 }),
            t('ب', { min: 12, max: 24, assigned: 12 })];
    render();
    assert.equal(store['quota-alert'].hidden, true);
  });

  /* كان اختبارٌ سابق يشترط «16 / 15 +1» — فثبّت العلّة بدل أن يمسكها. الرقمان
     مقطعان لاتينيّان والشرطةُ محايدة والفقرةُ عربية، فتعكس خوارزميةُ ثنائية
     الاتجاه ترتيبَهما بصريّاً: يبنيه الكود «15/16» ويقرؤه المديرُ «16/15».
     والاختبار الآن يشترط النقيض: لا زوجَ أرقامٍ عارٍ ألبتّة. */
  test('كلُّ رقمٍ يسبقه اسمه — لا زوجَ أرقامٍ تعكسه ثنائيةُ الاتجاه', () => {
    rows = [t('أحمد', { min: 12, max: 15, assigned: 16 })];
    render();
    const h = store['quota-alert-list'].innerHTML;
    assert.match(h, /الحمل <b>16<\/b>/);
    assert.match(h, /النصاب <b>15<\/b>/);
    assert.match(h, /تجاوز <b>1<\/b>/);
  });

  test('صفُّ النقص يعرض الحدَّ الأدنى لا الأعلى — وإلّا بدا الفرق مغلوطاً', () => {
    rows = [t('سميرة', { min: 12, max: 24, assigned: 4 })];
    render();
    const h = store['quota-alert-list'].innerHTML;
    assert.match(h, /الحمل <b>4<\/b>/);
    assert.match(h, /النصاب <b>12<\/b>/);   // لا 24
    assert.match(h, /نقص <b>8<\/b>/);
  });

  test('لا يتجاور رقمٌ برقمٍ في النصّ المعروض', () => {
    rows = [t('أحمد', { min: 12, max: 15, assigned: 16 }),
            t('سميرة', { min: 12, max: 24, assigned: 4 })];
    render();
    const text = store['quota-alert-list'].innerHTML.replace(/<[^>]+>/g, ' ');
    assert.ok(!/\d+\s*[/\-–]\s*\d+/.test(text),
      `زوجُ أرقامٍ عارٍ عاد إلى الشاشة: ${text.trim()}`);
  });
});

describe('نصاب التدريس — ظهور البطاقة', () => {
  test('تختفي حين لا تجاوز ولا نقص — تنبيهٌ دائم يُتجاهَل', () => {
    rows = [t('أحمد', { min: 12, max: 15, assigned: 13 }),
            t('سميرة', { min: 12, max: 18, assigned: 18 })];
    render();
    assert.equal(store['quota-alert'].hidden, true);
  });

  test('تظهر اثنين وتُخفي الزرّ حين لا مزيد', () => {
    rows = [t('أ', { min: 12, max: 15, assigned: 16 }),
            t('ب', { min: 12, max: 15, assigned: 17 })];
    render();
    assert.equal((store['quota-alert-list'].innerHTML.match(/<li>/g) || []).length, 2);
    assert.equal(store['btn-quota-detail'].hidden, true);
  });

  test('أكثر من ثلاثة: ثلاثةٌ وزرٌّ يُعلن العدد الكامل', () => {
    rows = [t('أ', { min: 12, max: 15, assigned: 16 }),
            t('ب', { min: 12, max: 15, assigned: 17 }),
            t('ج', { min: 12, max: 15, assigned: 18 }),
            t('د', { min: 12, max: 15, assigned: 19 }),
            t('هـ', { min: 12, max: 24, assigned: 3 })];
    render();
    assert.equal((store['quota-alert-list'].innerHTML.match(/<li>/g) || []).length, 3);
    assert.equal(store['btn-quota-detail'].hidden, false);
    assert.match(store['btn-quota-detail'].textContent, /5/);
  });

  test('التوسيع يعرض الجميع', () => {
    rows = [t('أ', { min: 12, max: 15, assigned: 16 }),
            t('ب', { min: 12, max: 15, assigned: 17 }),
            t('ج', { min: 12, max: 15, assigned: 18 }),
            t('د', { min: 12, max: 15, assigned: 19 })];
    expanded = true;
    render();
    assert.equal((store['quota-alert-list'].innerHTML.match(/<li>/g) || []).length, 4);
    assert.match(store['btn-quota-detail'].textContent, /إخفاء/);
  });
});

describe('نصاب التدريس — السلامة', () => {
  test('اسمٌ فيه وسمٌ يُهرَّب', () => {
    rows = [t('<img src=x>', { min: 12, max: 15, assigned: 20 })];
    render();
    assert.doesNotMatch(store['quota-alert-list'].innerHTML, /<img/);
    assert.match(store['quota-alert-list'].innerHTML, /&lt;img/);
  });

  test('المتجاوزون يسبقون ناقصي النصاب في العرض المختصر', () => {
    rows = [t('متجاوز', { min: 12, max: 15, assigned: 20 }),
            t('ناقص١', { min: 12, max: 24, assigned: 5 }),
            t('ناقص٢', { min: 12, max: 24, assigned: 6 }),
            t('ناقص٣', { min: 12, max: 24, assigned: 7 })];
    render();
    const h = store['quota-alert-list'].innerHTML;
    assert.ok(h.indexOf('متجاوز') < h.indexOf('ناقص١'), 'التجاوز يجب أن يتصدّر');
  });
});
