// ─────────────────────────────────────────────────────────────────────────────
//  حقل التاريخ ثلاثيّ الخانات.
//
//  ثلاثة أخطاء تُحفَظ بصمتٍ لو تُرك الأمر للسذاجة:
//   ١) الالتفاف: new Date(2026, 1, 31) لا يرمي — يعيد ٣ آذار. فمن كتب ٣١ شباط
//      يُحفظ له يومٌ لم يقصده، ولا يكتشفه حتى تُطبَع وثيقةٌ رسمية بعد أشهر.
//   ٢) المملوء جزئياً: يومٌ بلا سنةٍ ليس تاريخاً ولا فراغاً. قبولُه فراغاً
//      يمحو ما كتبه المستخدم بلا إخبار.
//   ٣) الأرقام العربية-الهندية: parseInt('٥') يعطي NaN. والحقل يمنعها بالتصفية،
//      لكن اللصق يتجاوز التصفية فيجب أن يُرفض لا أن يُحفظ NaN.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = join(ROOT, 'shared/date-fields.js');

let readDateFields, setDateFields, store;

// الوحدة تلمس document عند القراءة فقط، فيكفي مخزنٌ صغير بدل DOM كامل.
before_all();
function before_all() {
  store = {};
  globalThis.document = {
    getElementById: (id) => store[id] ?? null,
    createElement: () => ({ value: '', textContent: '' }),
  };
}

const mod = await import(SRC);
readDateFields = mod.readDateFields;
setDateFields  = mod.setDateFields;

/** يهيّئ خانات حقلٍ بقيمٍ نصّية. */
const put = (base, d, m, y) => {
  store[`${base}-d`] = { value: d };
  store[`${base}-m`] = { value: m };
  store[`${base}-y`] = { value: y };
};

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

describe('readDateFields — التواريخ الصحيحة', () => {
  test('تاريخٌ عاديّ يُصاغ ISO بأصفارٍ بادئة', () => {
    put('t', '5', '3', '2026');
    assert.deepEqual(readDateFields('t'), { ok: true, value: '2026-03-05' });
  });

  test('٢٩ شباط في سنةٍ كبيسة مقبول', () => {
    put('t', '29', '2', '2024');
    assert.deepEqual(readDateFields('t'), { ok: true, value: '2024-02-29' });
  });

  test('حدّا المدى مقبولان', () => {
    put('t', '1', '1', '1940');
    assert.equal(readDateFields('t').value, '1940-01-01');
    put('t', '31', '12', '2100');
    assert.equal(readDateFields('t').value, '2100-12-31');
  });
});

describe('readDateFields — الالتفاف الصامت', () => {
  test('٣١ شباط يُرفض ولا يصير ٣ آذار', () => {
    put('t', '31', '2', '2026');
    const r = readDateFields('t');
    assert.equal(r.ok, false, 'قُبل تاريخٌ لا وجود له — التفافُ Date مرّ');
    assert.match(r.error, /لا وجود لهذا اليوم/);
  });

  test('٣١ نيسان يُرفض — شهرٌ من ثلاثين', () => {
    put('t', '31', '4', '2026');
    assert.equal(readDateFields('t').ok, false);
  });

  test('٢٩ شباط في سنةٍ غير كبيسة يُرفض', () => {
    put('t', '29', '2', '2026');
    assert.equal(readDateFields('t').ok, false);
  });
});

describe('readDateFields — الفراغ والمملوء جزئياً', () => {
  test('الخانات الثلاث فارغة تعني «بلا تاريخ» لا خطأ', () => {
    put('t', '', '', '');
    assert.deepEqual(readDateFields('t'), { ok: true, value: null });
  });

  test('المسافات وحدها تُعدّ فراغاً', () => {
    put('t', '  ', '', ' ');
    assert.deepEqual(readDateFields('t'), { ok: true, value: null });
  });

  test('يومٌ بلا سنةٍ يُرفض — ليس تاريخاً ولا فراغاً', () => {
    put('t', '5', '3', '');
    const r = readDateFields('t');
    assert.equal(r.ok, false, 'قُبل تاريخٌ ناقص فمُحي ما كتبه المستخدم');
    assert.match(r.error, /أكمل/);
  });

  test('سنةٌ وحدها تُرفض كذلك', () => {
    put('t', '', '', '2026');
    assert.equal(readDateFields('t').ok, false);
  });

  test('حقلٌ غير موجود في الصفحة يُعدّ فارغاً لا خطأ', () => {
    assert.deepEqual(readDateFields('لا-يوجد'), { ok: true, value: null });
  });
});

describe('readDateFields — المدى والصياغة', () => {
  test('سنةٌ خارج المدى تُرفض برسالةٍ تذكر المدى', () => {
    put('t', '1', '1', '1800');
    const r = readDateFields('t');
    assert.equal(r.ok, false);
    assert.match(r.error, /1940/);
  });

  test('شهرٌ صفر أو ثلاثة عشر يُرفض', () => {
    for (const m of ['0', '13']) {
      put('t', '1', m, '2026');
      assert.equal(readDateFields('t').ok, false, `الشهر ${m}`);
    }
  });

  test('أرقامٌ عربية-هندية ملصوقة تُرفض ولا تُحفظ NaN', () => {
    put('t', '٥', '٣', '٢٠٢٦');
    const r = readDateFields('t');
    assert.equal(r.ok, false, 'مرّت أرقامٌ لا يفهمها parseInt');
    assert.ok(!String(r.error).includes('NaN'));
  });

  test('الرسالة تحمل اسم الحقل لتمييزه بين أربعة تواريخ', () => {
    put('t', '31', '2', '2026');
    assert.match(readDateFields('t', 'تاريخ المباشرة').error, /تاريخ المباشرة/);
  });
});

describe('setDateFields — التعبئة من ISO', () => {
  test('يملأ الخانات بلا أصفارٍ بادئة — أسهل قراءةً وتحريراً', () => {
    put('t', '', '', '');
    setDateFields('t', '2026-03-05');
    assert.equal(store['t-d'].value, '5');
    assert.equal(store['t-m'].value, '3');
    assert.equal(store['t-y'].value, '2026');
  });

  test('القيمة الفارغة أو المعدومة تُفرغ الخانات', () => {
    for (const v of ['', null, undefined]) {
      put('t', '9', '9', '1999');
      setDateFields('t', v);
      assert.equal(store['t-d'].value, '', `القيمة ${v}`);
    }
  });

  test('طابعٌ زمنيّ كامل يُقرأ منه التاريخ وحده', () => {
    put('t', '', '', '');
    setDateFields('t', '2026-03-05T10:22:00Z');
    assert.equal(store['t-y'].value, '2026');
  });

  test('ما يُكتب يُقرأ كما هو — الدورة مغلقة', () => {
    put('t', '', '', '');
    setDateFields('t', '2024-02-29');
    assert.deepEqual(readDateFields('t'), { ok: true, value: '2024-02-29' });
  });
});
