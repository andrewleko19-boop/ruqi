// ─────────────────────────────────────────────────────────────────────────────
//  ما تكتبه المدرسة في اللقطة هو ما تقرؤه المديرية منها.
//
//  البيان الشهريّ يُرسَل كـ snapshot_data من بوّابة المدرسة، وتقرؤه بوّابة
//  المديرية لتعرضه على الموظّف قبل أن يعتمد أو يرفض. والطرفان لا يتشاركان نوعاً
//  ولا تعريفاً — مجرّد أسماء مفاتيح في JSON. فحين تغيّرت اللقطة إلى الصيغة
//  الثانية بقي القارئ على الأولى، ولا شيء انكسر ظاهرياً:
//
//    · snap.students صار كائناً لا مصفوفة → Array.isArray ترد false → أصفار.
//    · snap.staffCounts اختفى → أصفار.
//    · snap.leaveLines اختفى → كتلةٌ لم تُعرض قطّ.
//
//  فكانت شاشةُ الاعتماد تقول «إجمالي الطلاب ٠، إجمالي العاملين ٠» لكلّ بيان.
//  والصفرُ رقمٌ لا رسالةُ خطأ: يوقّع الموظّف على ما لم يره، أو يرفض مدرسةً
//  ملأت بيانها كاملاً. لا استثناء يُرمى، ولا سطر في أيّ سجلّ.
//
//  فحصان: أنّ القارئ يفهم لقطةً حقيقية، وأنّ كلّ مفتاحٍ يقرؤه موجودٌ عند الكاتب.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const dirSrc    = read('directorate/script.js');
const schoolSrc = read('school/script.js');

const fnText = dirSrc.match(/function buildStmtSummary\(snap\) \{[\s\S]*?\n\}/);
assert.ok(fnText, 'لم يُعثر على buildStmtSummary في directorate/script.js');

const buildStmtSummary = new Function('esc',
  `${fnText[0]}; return buildStmtSummary;`)(String);

/* لقطةٌ بصيغة الكاتب الحالية (schemaVersion 2)، بأرقامٍ مميّزة لا تتشابه —
   فلو قرأ القارئ مفتاحاً بموضع آخر ظهر الخطأ بدل أن يمرّ بالمصادفة. */
const V2 = {
  schemaVersion: 2,
  students: {
    rows: [],
    totals: { sections: 17, enM: 101, enF: 202, frM: 3, frF: 4, ruM: 5, ruF: 6, total: 321 },
    byCycle: { cycle1: 1, cycle2: 2, kinder: 3, secondary: 4 },
  },
  teachingStaff: { teachers: 9, masters: 2, assistants: 1, full: 12, unclassified: 3 },
  adminStaff:    { rows: [], total: 7, unmapped: [] },
  workforce: {
    teachers: 9, masters: 2, assist: 1, full: 12, unclassified: 3,
    admin: 7, professional: 4, worker: 5, guard: 2, grand: 30,
  },
  supportCounts: { professional: 4, worker: 5, guard: 2 },
  leaves: [
    { staffId: 'a', type: 'مرضية', days: 3 },
    { staffId: 'b', type: 'مرضية', days: 2 },
    { staffId: 'c', type: 'إدارية', days: 1 },
  ],
};

describe('المديرية تقرأ لقطة الصيغة الثانية', () => {
  const html = buildStmtSummary(V2);

  test('أعداد الطلاب ليست أصفاراً', () => {
    assert.match(html, /عدد الشعب<\/span><strong>17</,
      'عدد الشعب صفر — القارئ ما زال يتوقّع مصفوفة.');
    assert.match(html, /إجمالي الطلاب<\/span><strong>321</);
  });

  test('الذكور والإناث يُجمعان عبر لغات التدريس الثلاث', () => {
    assert.match(html, /إجمالي الذكور<\/span><strong>109</);   // 101+3+5
    assert.match(html, /إجمالي الإناث<\/span><strong>212</);   // 202+4+6
  });

  test('أعداد العاملين تُقرأ من workforce', () => {
    assert.match(html, /إجمالي العاملين<\/span><strong>30</,
      'إجمالي العاملين صفر — snap.staffCounts لم يعد موجوداً في اللقطة.');
    assert.match(html, /إداري \/ تدريسي<\/span><strong>7 \/ 12</);
    assert.match(html, /مهني \/ مستخدم \/ حارس<\/span><strong>4 \/ 5 \/ 2</);
  });

  test('الإجازات تُعرض مجمّعةً بالنوع — الكتلة لم تكن تظهر قطّ', () => {
    assert.match(html, /إجازات الشهر/, 'كتلة الإجازات غائبة.');
    assert.match(html, /مرضية: 2 \(5 يوماً\)/, 'لم تُجمَع الإجازات بالنوع.');
    assert.match(html, /إدارية: 1 \(1 يوماً\)/);
  });

  test('لا أسماء في الملخّص — الأسماء مقصودةٌ خارج اللقطة', () => {
    assert.ok(!/staffId|\ba\b<|null|undefined/.test(html),
      'تسرّب معرّفٌ أو قيمةٌ فارغة إلى الشاشة.');
  });
});

describe('اللقطة القديمة لا يُعاد تفسيرها بالصيغة الجديدة', () => {
  test('بيانٌ محفوظٌ بالصيغة الأولى يُقرأ كما كُتب', () => {
    const html = buildStmtSummary({
      students: [{ sections: 4, enM: 10, enF: 20 }, { sections: 3, frM: 5, ruF: 1 }],
      staffCounts: { admin: 2, teaching: 8, professional: 1, worker: 1, guard: 1 },
      leaveLines: ['مرضية 3', 'إدارية 1'],
    });
    assert.match(html, /عدد الشعب<\/span><strong>7</);
    assert.match(html, /إجمالي الذكور<\/span><strong>15</);
    assert.match(html, /إجمالي العاملين<\/span><strong>13</);
    assert.match(html, /مرضية 3 — إدارية 1/);
  });
});

describe('كلُّ مفتاحٍ تقرؤه المديرية موجودٌ عند الكاتب', () => {
  /** مفاتيح الكائن الذي تُرجعه _stmtSnapshot في بوّابة المدرسة. */
  const writerKeys = (() => {
    // البوّابات تختلف: بعضها وحدة (import) وبعضها نصٌّ كلاسيكيّ. نجرّب الأوسع.
    let ast;
    try { ast = acorn.parse(schoolSrc, { ecmaVersion: 'latest', sourceType: 'module' }); }
    catch { ast = acorn.parse(schoolSrc, { ecmaVersion: 'latest', sourceType: 'script' }); }
    let keys = null;
    walk.simple(ast, {
      FunctionDeclaration(node) {
        if (node.id?.name !== '_stmtSnapshot') return;
        walk.simple(node.body, {
          ReturnStatement(r) {
            if (r.argument?.type !== 'ObjectExpression' || keys) return;
            keys = new Set(r.argument.properties
              .filter(p => p.type === 'Property')
              .map(p => p.key.name ?? p.key.value));
          },
        });
      },
    });
    return keys;
  })();

  test('عُثر على _stmtSnapshot وعلى مفاتيحها', () => {
    assert.ok(writerKeys && writerKeys.size > 5,
      'تعذّر استخراج مفاتيح اللقطة — الفحص أدناه سيكون بلا معنى.');
  });

  // مفاتيحُ صيغةٍ قديمة تُقرأ عمداً لأجل بياناتٍ محفوظة، ولا يكتبها أحدٌ اليوم.
  const LEGACY = new Set(['staffCounts', 'leaveLines']);

  test('لا مفتاحَ يقرؤه القارئ ولا يكتبه الكاتب', () => {
    const readKeys = new Set();
    const ast = acorn.parse(fnText[0], { ecmaVersion: 'latest' });
    walk.simple(ast, {
      MemberExpression(node) {
        if (node.object?.type === 'Identifier' && node.object.name === 'snap'
            && !node.computed && node.property?.type === 'Identifier') {
          readKeys.add(node.property.name);
        }
      },
    });
    assert.ok(readKeys.size > 0, 'لم يُقرأ أيّ مفتاح — الفحص أعمى.');

    const orphans = [...readKeys].filter(k => !writerKeys.has(k) && !LEGACY.has(k));
    assert.deepEqual(orphans, [],
      `مفاتيح تُقرأ ولا تُكتب: ${orphans.join('، ')} — كتلةٌ لن تُعرض لأيّ مدرسة، `
      + 'بلا خطأٍ ولا سطرٍ في سجلّ. أضفها إلى الكاتب أو أزل قراءتها.');
  });
});
