// ─────────────────────────────────────────────────────────────────────────────
//  تعديلُ مادّةٍ لا يجوز أن يمحو درجاتها.
//
//  كانت setSubjectComponents تحذف مكوّنات المادّة كلَّها ثمّ تُعيد إدراجها
//  بمعرّفاتٍ جديدة. و student_grades.component_id مرتبطٌ بـ ON DELETE CASCADE،
//  فمديرُ مدرسةٍ يفتح «تعديل مادة» ليصحّح حرفاً في الاسم ويضغط حفظ كان يمحو كلَّ
//  علامات تلك المادّة — لكلّ الطلاب، في الفصلين، بلا سؤالٍ ولا رسالةٍ ولا رجعة.
//  ولا أثرَ يدلّ على ما جرى: الشاشة تقول «تم حفظ المادة».
//
//  والاختبار هنا يقيس ما يصل القاعدة لا ما تُرجعه الدالّة: أيُّ DELETE على صفٍّ
//  كان موجوداً هو علاماتٌ ضائعة، مهما بدت النتيجة النهائية صحيحة.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'shared/db.js'), 'utf8');
const m    = src.match(/async function setSubjectComponents\(subjectId, components\) \{[\s\S]*?\n\}/);
assert.ok(m, 'لم يُعثر على setSubjectComponents في shared/db.js');

/* قاعدةٌ وهمية تُسجّل ما جرى عليها. المهمّ هو ops لا العائد: صفٌّ حُذف = درجاتٌ
   ضاعت، مهما بدت القائمة النهائية سليمة. */
function makeDb(rows) {
  const state = rows.map(r => ({ ...r }));
  const ops = [];
  let nextId = 1000;
  const db = {
    from(table) {
      assert.equal(table, 'subject_components');
      return {
        update(patch) {
          return { eq(_col, id) {
            ops.push({ op: 'update', id, patch });
            const row = state.find(r => r.id === id);
            if (row) Object.assign(row, patch);
            return { error: null };
          } };
        },
        insert(newRows) {
          ops.push({ op: 'insert', rows: newRows });
          for (const r of newRows) state.push({ ...r, id: 'new-' + (++nextId) });
          return { error: null };
        },
        delete() {
          return { in(_col, ids) {
            ops.push({ op: 'delete', ids });
            for (const id of ids) {
              const at = state.findIndex(r => r.id === id);
              if (at >= 0) state.splice(at, 1);
            }
            return { error: null };
          } };
        },
      };
    },
  };
  const getSubjectComponents = async () =>
    state.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return { db, ops, state, getSubjectComponents };
}

function build(rows) {
  const ctx = makeDb(rows);
  const fn = new Function('db', 'getSubjectComponents',
    `${m[0]}; return setSubjectComponents;`)(ctx.db, ctx.getSubjectComponents);
  return { ...ctx, run: (comps) => fn('subj-1', comps) };
}

const EXISTING = [
  { id: 'c1', subject_id: 'subj-1', name: 'مذاكرة',      max_mark: 30, sort_order: 0 },
  { id: 'c2', subject_id: 'subj-1', name: 'شفهي',        max_mark: 20, sort_order: 1 },
  { id: 'c3', subject_id: 'subj-1', name: 'امتحان فصلي', max_mark: 50, sort_order: 2 },
];
const asSent = (rows) => rows.map(r => ({ id: r.id, name: r.name, maxMark: r.max_mark }));

describe('حفظٌ بلا تغييرٍ في المكوّنات', () => {
  let ctx;
  beforeEach(() => { ctx = build(EXISTING); });

  test('لا حذفَ ألبتّة — هذه هي العلّة بعينها: تصحيحُ اسم المادّة كان يمحو درجاتها', async () => {
    await ctx.run(asSent(EXISTING));
    assert.equal(ctx.ops.filter(o => o.op === 'delete').length, 0,
      'صدر DELETE على مكوّنٍ قائم — كلُّ درجات الطلاب فيه تسقط معه بـ CASCADE.');
  });

  test('ولا كتابةَ بلا داعٍ — صفٌّ لم يمسّه أحد لا يُحدَّث', async () => {
    await ctx.run(asSent(EXISTING));
    assert.equal(ctx.ops.length, 0, `عملياتٌ زائدة: ${JSON.stringify(ctx.ops)}`);
  });
});

describe('تغيير اسم مكوّنٍ تحديثٌ لا استبدال', () => {
  test('«مذاكرة» ← «المذاكرة» يبقى المكوّن نفسه ومعه درجاته', async () => {
    const ctx = build(EXISTING);
    const sent = asSent(EXISTING);
    sent[0].name = 'المذاكرة';
    await ctx.run(sent);

    assert.equal(ctx.ops.filter(o => o.op === 'delete').length, 0);
    assert.equal(ctx.ops.filter(o => o.op === 'insert').length, 0,
      'إدراجٌ جديد يعني معرّفاً جديداً — والدرجات معلّقة بالقديم.');
    const upd = ctx.ops.filter(o => o.op === 'update');
    assert.equal(upd.length, 1);
    assert.equal(upd[0].id, 'c1');
    assert.equal(upd[0].patch.name, 'المذاكرة');
  });

  test('تغيير العلامة العظمى للمكوّن تحديثٌ كذلك', async () => {
    const ctx = build(EXISTING);
    const sent = asSent(EXISTING);
    sent[0].maxMark = 40; sent[1].maxMark = 10;
    await ctx.run(sent);
    assert.equal(ctx.ops.filter(o => o.op === 'delete').length, 0);
    assert.deepEqual(ctx.ops.map(o => o.id), ['c1', 'c2']);
  });
});

describe('الإضافة والحذف يُصيبان المقصود وحده', () => {
  test('مكوّنٌ جديد يُدرَج ولا يُمَسّ القائم', async () => {
    const ctx = build(EXISTING);
    await ctx.run([...asSent(EXISTING), { id: null, name: 'أعمال', maxMark: 0 }]);
    assert.equal(ctx.ops.filter(o => o.op === 'delete').length, 0);
    const ins = ctx.ops.filter(o => o.op === 'insert');
    assert.equal(ins.length, 1);
    assert.equal(ins[0].rows.length, 1);
    assert.equal(ins[0].rows[0].name, 'أعمال');
  });

  test('حذفُ مكوّنٍ يحذفه وحده — لا الثلاثة', async () => {
    const ctx = build(EXISTING);
    await ctx.run(asSent(EXISTING.filter(r => r.id !== 'c2')));
    const del = ctx.ops.filter(o => o.op === 'delete');
    assert.equal(del.length, 1);
    assert.deepEqual(del[0].ids, ['c2']);
  });

  test('الحذف آخرُ الخطوات — انقطاعٌ في المنتصف يُبقي الدرجات', async () => {
    const ctx = build(EXISTING);
    await ctx.run([
      ...asSent(EXISTING.filter(r => r.id !== 'c2')),
      { id: null, name: 'أعمال', maxMark: 0 },
    ]);
    const lastDelete = ctx.ops.map(o => o.op).lastIndexOf('delete');
    assert.equal(lastDelete, ctx.ops.length - 1,
      'الحذف قبل الإدراج/التحديث: عطلُ شبكةٍ بعده يترك المادّة بلا مكوّنٍ وبلا درجاته.');
  });
});

describe('مناديان لا يحملان معرّفات', () => {
  test('المطابقة بالاسم تُبقي المكوّن القائم — نسخُ الكتالوج لا يعيد بناء الصفوف', async () => {
    const ctx = build(EXISTING);
    await ctx.run(EXISTING.map(r => ({ name: r.name, maxMark: r.max_mark })));
    assert.equal(ctx.ops.filter(o => o.op === 'delete').length, 0);
    assert.equal(ctx.ops.filter(o => o.op === 'insert').length, 0);
  });

  test('صفٌّ بلا معرّف لا يخطف صفّاً سُمّي إليه معرّفٌ صريح', async () => {
    // المدير حذف «شفهي» (c2) وأضاف صفّاً جديداً بالاسم نفسه، مع إبقاء c1 و c3.
    // الصحيح أن يرث الجديدُ c2 فلا تضيع درجاته — لا أن يخطف c1 أو c3.
    const ctx = build(EXISTING);
    await ctx.run([
      { id: 'c1', name: 'مذاكرة',      maxMark: 30 },
      { id: null, name: 'شفهي',        maxMark: 20 },
      { id: 'c3', name: 'امتحان فصلي', maxMark: 50 },
    ]);
    assert.equal(ctx.ops.filter(o => o.op === 'delete').length, 0,
      'الصفّ المُعاد بناؤه بالاسم نفسه ورث c2 فلا شيء يُحذف.');
    assert.equal(ctx.ops.filter(o => o.op === 'insert').length, 0);
  });

  test('معرّفٌ لا وجود له في القاعدة يُعامَل صفّاً جديداً لا يُسقط الحفظ', async () => {
    const ctx = build(EXISTING);
    await ctx.run([...asSent(EXISTING), { id: 'شبح', name: 'أعمال', maxMark: 0 }]);
    const ins = ctx.ops.filter(o => o.op === 'insert');
    assert.equal(ins.length, 1);
    assert.equal(ins[0].rows[0].name, 'أعمال');
    assert.ok(!('id' in ins[0].rows[0]), 'مرّر معرّفاً وهمياً إلى القاعدة.');
  });
});

describe('واجهة المدرسة تحمل معرّف المكوّن وتُنذر قبل الفقد', () => {
  const ui = readFileSync(join(ROOT, 'school/script.js'), 'utf8');

  test('صفّ المكوّن يحمل معرّفه في الـ DOM', () => {
    assert.match(ui, /function addCompRow\(name = '', max = '', id = ''\)/,
      'addCompRow لا تقبل معرّفاً — فالحفظ يعود استبدالاً شاملاً.');
    assert.match(ui, /li\.dataset\.compId = id/);
  });

  test('فتحُ المادّة يمرّر المعرّف، والحفظ يقرؤه', () => {
    assert.match(ui, /addCompRow\(c\.name, c\.max_mark, c\.id\)/);
    assert.match(ui, /id: row\.dataset\.compId \|\| null/);
  });

  test('حذفُ مكوّنٍ له درجات يُنذر برقمها قبل الحفظ', () => {
    assert.match(ui, /countGradesForComponents/,
      'لا عدَّ للدرجات — يُحذف المكوّن ولا يعرف المدير ما ضاع.');
    assert.match(ui, /askConfirm\(msg, 'حذف ومتابعة'\)/);
  });

  test('تعذُّرُ العدّ يُنذر ولا يمرّ صامتاً', () => {
    const blk = ui.match(/if \(dropped\.length\) \{[\s\S]*?\n  \}/);
    assert.ok(blk, 'لم يُعثر على كتلة الإنذار');
    assert.match(blk[0], /n === null[\s\S]*?سيُحذف المكوّن/,
      'فشلُ العدّ يمرّ بلا إنذار — أسوأ من إنذارٍ بلا رقم.');
  });
});
