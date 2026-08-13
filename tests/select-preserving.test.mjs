// ─────────────────────────────────────────────────────────────────────────────
//  setSelectPreserving — حارس القيم المحفوظة عند تحويل حقلٍ نصّيّ إلى قائمة.
//
//  «المجمّع التربوي» و«نوع الطلاب» كانا حقلين نصّيّين حرّين، فامتلآ بصيغٍ لا
//  تطابق الخيارات الجديدة: «بنين» بدل «ذكور»، ومجمّعٌ لم يُدخِله المشرف بعد.
//
//  والمصيدة أنّ `select.value = x` حيث لا خيارَ قيمتُه x **لا يرمي**: يُرجع
//  الحقل فارغاً بصمت. فيفتح المديرُ الإعدادات ليعدّل خط العرض، ويحفظ، فيقرأ
//  المُرسِل '' في المجمّع فيمحو من القاعدة قيمةً ضبطتها المديرية — وهو لم يمسّ
//  الحقل أصلاً. لا رسالةَ خطأ ولا أثر.
//
//  لذا يُقلَّد هنا سلوك المتصفّح بدقّة: الضبطُ على قيمةٍ غائبة يُفرِغ الحقل.
//  الاختبار الذي يقبل أيّ قيمة لا يثبت شيئاً.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'school/script.js'), 'utf8');
const m    = src.match(/function setSelectPreserving\(sel, value\) \{[\s\S]*?\n\}/);
assert.ok(m, 'لم يُعثر على تعريف setSelectPreserving في school/script.js');

const fakeDocument   = { createElement: () => ({ value: '', textContent: '' }) };
const fakeCustomSel  = { refresh() {} };
const setSelectPreserving = new Function(
  'document', 'CustomSelect', `${m[0]}; return setSelectPreserving;`,
)(fakeDocument, fakeCustomSel);

/** قائمةٌ تحاكي <select>: الضبط على قيمةٍ بلا خيارٍ مطابق يُفرغها — كالمتصفّح. */
function makeSelect(values) {
  const options = [{ value: '', textContent: '— اختر —' },
                   ...values.map(v => ({ value: v, textContent: v }))];
  let current = '';
  return {
    options,
    get value() { return current; },
    set value(v) { current = options.some(o => o.value === v) ? v : ''; },
    insertBefore(node, ref) {
      const i = ref ? options.indexOf(ref) : -1;
      options.splice(i < 0 ? options.length : i, 0, node);
    },
  };
}
const valuesOf = (sel) => sel.options.map(o => o.value);

describe('setSelectPreserving — القيمة موجودة في الخيارات', () => {
  test('تُختار كما هي', () => {
    const sel = makeSelect(['ذكور', 'إناث', 'مختلط']);
    setSelectPreserving(sel, 'إناث');
    assert.equal(sel.value, 'إناث');
  });

  test('لا يُحقن خيارٌ زائد', () => {
    const sel = makeSelect(['ذكور', 'إناث', 'مختلط']);
    setSelectPreserving(sel, 'إناث');
    assert.equal(sel.options.length, 4);   // الفارغ + ثلاثة
  });
});

describe('setSelectPreserving — قيمةٌ قديمة خارج الخيارات', () => {
  test('تُحقن خياراً فتنجو من المحو', () => {
    const sel = makeSelect(['ذكور', 'إناث', 'مختلط']);
    setSelectPreserving(sel, 'بنين');          // صيغةٌ قديمة حرّة النص
    assert.equal(sel.value, 'بنين', 'ضاعت القيمة المحفوظة — هذا هو المحو الصامت');
    assert.ok(valuesOf(sel).includes('بنين'));
  });

  test('تُحقن بعد الخيار الفارغ لا قبله — «اختر» يبقى رأس القائمة', () => {
    const sel = makeSelect(['ذكور']);
    setSelectPreserving(sel, 'بنين');
    assert.equal(sel.options[0].value, '');
    assert.equal(sel.options[1].value, 'بنين');
  });

  test('قائمةٌ لم تصل بعد (خياراتها فارغة) لا تُسقط المحفوظ', () => {
    // حالة المجمّع أوفلاين: القائمة تعذّر جلبها، والمحفوظ يجب أن يبقى ظاهراً.
    const sel = makeSelect([]);
    setSelectPreserving(sel, 'المجمع التربوي في جبلة');
    assert.equal(sel.value, 'المجمع التربوي في جبلة');
  });

  test('نداءان متتاليان لا يُكرّران الخيار', () => {
    const sel = makeSelect(['ذكور']);
    setSelectPreserving(sel, 'بنين');
    setSelectPreserving(sel, 'بنين');
    assert.equal(valuesOf(sel).filter(v => v === 'بنين').length, 1);
  });
});

describe('setSelectPreserving — الحالات الحدّية', () => {
  test('قيمةٌ فارغة أو معدومة تترك الحقل فارغاً بلا حقن', () => {
    for (const v of ['', null, undefined, '   ']) {
      const sel = makeSelect(['ذكور']);
      setSelectPreserving(sel, v);
      assert.equal(sel.value, '', `القيمة ${JSON.stringify(v)}`);
      assert.equal(sel.options.length, 2, `حُقن خيارٌ لقيمةٍ فارغة: ${JSON.stringify(v)}`);
    }
  });

  test('المسافات الطرفية تُقلَّم فتُطابق خياراً موجوداً بدل حقن نسخةٍ ثانية', () => {
    const sel = makeSelect(['مختلط']);
    setSelectPreserving(sel, '  مختلط  ');
    assert.equal(sel.value, 'مختلط');
    assert.equal(sel.options.length, 2);
  });

  test('حقلٌ غير موجود في الصفحة لا يرمي', () => {
    assert.doesNotThrow(() => setSelectPreserving(null, 'ذكور'));
    assert.doesNotThrow(() => setSelectPreserving(undefined, 'ذكور'));
  });
});
