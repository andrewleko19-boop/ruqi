// ─────────────────────────────────────────────────────────────────────────────
//  البطاقة الشخصية في دليل الكادر.
//
//  السجلّ ثلاثون حقلاً، وأكثرها فارغٌ في معظم الصفوف: الشهادة العليا والوثيقة
//  الوزارية والهاتف الأرضي تُملأ لقلّةٍ من الموظّفين. بطاقةٌ تعرض الثلاثين
//  دائماً تصير جداراً من الشُّرَط يُخفي الحقول الخمسة التي فيها معلومة.
//  فالفارغ يُحذف، والمملوء وحده يبقى.
//
//  والصفر ليس فارغاً: نصابُ صفرِ ساعةٍ معلومةٌ لا غياب معلومة. الفلترة
//  بـ`falsy` الساذجة تبتلعه — وتبتلع معه سنة أقدميةٍ لو كانت صفراً.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'directorate/script.js'), 'utf8');
const m    = src.match(/function openStaffCard\(id\) \{[\s\S]*?\n\}/);
assert.ok(m, 'لم يُعثر على تعريف openStaffCard في directorate/script.js');

const typeMap = {
  teaching: 'تدريسي', admin: 'إداري', professional: 'مهني',
  worker: 'مستخدَم', guard: 'حارس',
};

/** يشغّل البطاقة على صفٍّ ويلتقط ما مُرّر إلى نافذة العرض. */
function cardFor(row) {
  let captured = null;
  const StatDrill = { open: (t, s, f) => { captured = { title: t, sub: s, fields: f }; } };
  const fn = new Function(
    'STAFF_TYPE_AR', 'StatDrill', '_sdirRows',
    `${m[0]}; return openStaffCard;`,
  )(typeMap, StatDrill, [row]);
  fn(row.id);
  return captured;
}

const base = { id: 's1', full_name: 'أحمد العلي', staff_type: 'teaching', school_name: 'مدرسة أ' };
const labels = (c) => c.fields.map(f => f.label);
const valueOf = (c, label) => c.fields.find(f => f.label === label)?.value;

describe('البطاقة الشخصية — حذف الفارغ', () => {
  test('الحقول الفارغة والمعدومة لا تُعرض', () => {
    const c = cardFor({ ...base, higher_degree: null, ministerial_doc: '', landline: undefined });
    assert.ok(!labels(c).includes('الشهادة العليا'));
    assert.ok(!labels(c).includes('الوثيقة الوزارية'));
    assert.ok(!labels(c).includes('الهاتف الأرضي'));
  });

  test('الحقول المملوءة تُعرض بقيمها', () => {
    const c = cardFor({ ...base, specialization: 'رياضيات', certificate: 'إجازة' });
    assert.equal(valueOf(c, 'الاختصاص'), 'رياضيات');
    assert.equal(valueOf(c, 'الشهادة'), 'إجازة');
  });

  test('صفرٌ معلومةٌ لا فراغ — النصاب صفر يبقى معروضاً', () => {
    // بعد إعادة تسمية الحقل: teaching_hours → weekly_lessons، والوسم
    // «النصاب (ساعات)» → «النصاب (حصص)» — الوحدة صحّحت من ساعات إلى حصصٍ
    // أسبوعية، والحقل نفسه هو ما يقارَن بمجموع lesson_count.
    const c = cardFor({ ...base, weekly_lessons: 0 });
    assert.equal(valueOf(c, 'النصاب (حصص)'), '0',
      'الصفر ابتُلع كأنّه فارغ — فلترةُ falsy الساذجة');
  });

  test('سجلٌّ شبه فارغ لا يرمي ويُبقي ما عُرف', () => {
    const c = cardFor({ id: 's1', full_name: 'ن', staff_type: 'worker' });
    assert.equal(c.title, 'ن');
    assert.equal(valueOf(c, 'الفئة'), 'مستخدَم');
  });
});

describe('البطاقة الشخصية — الترجمة إلى العربية', () => {
  test('الفئة تُترجَم', () => {
    assert.equal(valueOf(cardFor({ ...base, staff_type: 'guard' }), 'الفئة'), 'حارس');
  });

  test('الجنس يُترجَم في الاتجاهين', () => {
    assert.equal(valueOf(cardFor({ ...base, gender: 'male' }),   'الجنس'), 'ذكر');
    assert.equal(valueOf(cardFor({ ...base, gender: 'female' }), 'الجنس'), 'أنثى');
  });

  test('جنسٌ غير مسجَّل يُحذف لا يُعرض «غير معروف»', () => {
    assert.ok(!labels(cardFor({ ...base, gender: null })).includes('الجنس'));
  });

  test('الملاك يُترجَم بحالاته الثلاث', () => {
    assert.equal(valueOf(cardFor({ ...base, roster_type: 'inside' }),   'الملاك'), 'داخل الملاك');
    assert.equal(valueOf(cardFor({ ...base, roster_type: 'outside' }),  'الملاك'), 'خارج الملاك');
    assert.equal(valueOf(cardFor({ ...base, roster_type: 'contract' }), 'الملاك'), 'متعاقد');
  });

  test('نوعٌ مجهول من الخادم يُعرض خاماً لا يختفي', () => {
    assert.equal(valueOf(cardFor({ ...base, staff_type: 'مجهول' }), 'الفئة'), 'مجهول');
  });
});

describe('البطاقة الشخصية — الترويسة', () => {
  test('العنوان هو الاسم، والسطر تحته الفئة والمدرسة', () => {
    const c = cardFor({ ...base });
    assert.equal(c.title, 'أحمد العلي');
    assert.match(c.sub, /تدريسي/);
    assert.match(c.sub, /مدرسة أ/);
  });

  test('مدرسةٌ غير معروفة لا تترك فاصلاً معلّقاً', () => {
    const c = cardFor({ id: 's1', full_name: 'ن', staff_type: 'admin' });
    assert.equal(c.sub, 'إداري');
  });

  test('معرّفٌ غير موجود لا يفتح بطاقةً ولا يرمي', () => {
    let opened = false;
    const StatDrill = { open: () => { opened = true; } };
    const fn = new Function('STAFF_TYPE_AR', 'StatDrill', '_sdirRows',
      `${m[0]}; return openStaffCard;`)(typeMap, StatDrill, [base]);
    assert.doesNotThrow(() => fn('لا-يوجد'));
    assert.equal(opened, false);
  });
});
