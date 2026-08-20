// ─────────────────────────────────────────────────────────────────────────────
//  محرّكُ النجاح والرسوب مقابل اللائحة السورية — حالةً بحالة.
//
//  هذا أخطرُ منطقٍ في النظام كلِّه: رقمٌ خاطئ هنا يُرسِب طفلاً سنةً كاملة، ولا
//  يُكتشف الخطأ في سجلٍّ ولا في شاشة — بل في بيتٍ بعد شهور.
//
//  وكان بلا اختبارٍ واحد، لسببٍ بنيويّ: computeYearResult لم تكن مُصدَّرةً من
//  db.js فتعذّر بلوغُها. صُدّرت الآن لأجل هذا الملفّ.
//
//  الحالاتُ أدناه منقولةٌ عن نصّ اللائحة نفسه لا عن الشيفرة — فالاختبارُ يقيس
//  الشيفرةَ باللائحة، لا اللائحةَ بالشيفرة. وكلُّ حالةٍ تحمل مرجعها.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* db.js يستورد مكتبةَ Supabase ويلمس window، فلا يُستورَد في node مباشرةً.
   نستخرج الدوالَّ الخالصة (لا تلمس الشبكة ولا DOM) ونقيّمها معزولةً — وهو
   النمطُ الذي تتبعه بقيةُ اختبارات هذا المستودع. */
const SRC = readFileSync(join(ROOT, 'shared/db.js'), 'utf8');

function extract(name, kind = 'function') {
  const re = kind === 'const'
    ? new RegExp(String.raw`^const ${name} = [\s\S]*?^\];`, 'm')
    : new RegExp(String.raw`^function ${name}\([\s\S]*?^\}`, 'm');
  const m = SRC.match(re);
  assert.ok(m, `لم يُعثر على ${name} في shared/db.js`);
  return m[0];
}

const sandbox = [
  extract('FALLBACK_PASS_RULES', 'const'),
  extract('ruleForGrade'),
  extract('resolvePassMark'),
  extract('computeYearResult'),
  'return { FALLBACK_PASS_RULES, ruleForGrade, resolvePassMark, computeYearResult };',
].join('\n\n');

// eslint-disable-next-line no-new-func
const { ruleForGrade, resolvePassMark, computeYearResult } = new Function(sandbox)();

/** مادّةٌ بنهايةٍ عظمى ١٠٠ ودرجةٍ مئوية — الشكلُ الشائع. */
const sub = (percent, opts = {}) => ({
  percent,
  mark: percent,
  maxTotal: 100,
  passMark: opts.passMark ?? 40,
  isCoreArabic: !!opts.arabic,
  isCoreMath:   !!opts.math,
  isForeignLanguage: !!opts.lang,
});

const verdict = (grade, subjects, extra = {}) => computeYearResult({
  grade, rule: ruleForGrade(null, grade), subjects, ...extra,
});

// ═══════════════════════════════════════════════════════════════════════════
describe('عتبةُ المادة تُشتقّ من دورها لا من كونها «أساسية»', () => {
  test('الصفوف ١–٤: الرياضياتُ أساسيةٌ فتأخذ عتبةَ العربية', () => {
    assert.equal(resolvePassMark(null, 3, false, true), 41);
    assert.equal(resolvePassMark(null, 3, true,  false), 41);
    assert.equal(resolvePassMark(null, 3, false, false), 41);
  });

  test('من الصفّ الخامس: العربيةُ ٥٠٪ والرياضياتُ ٤٠٪ كسائر المواد', () => {
    assert.equal(resolvePassMark(null, 9, true,  false), 50, 'العربية');
    // ⚠️ حارسُ الانحدار الأصليّ: كانت تُرجع ٥٠ للرياضيات في كلّ الصفوف.
    assert.equal(resolvePassMark(null, 9, false, true),  40,
      'رياضياتُ التاسع حدُّها ٤٠٪ نظاماً (٢٤٠ من ٦٠٠) — لا ٥٠٪');
    assert.equal(resolvePassMark(null, 12, false, true), 40, 'رياضياتُ البكالوريا');
    assert.equal(resolvePassMark(null, 6,  false, false), 40, 'مادةٌ عادية');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('الحلقة الأولى (١–٤): أكثرُ من «ضعيف» واحدٍ في الأساسيات الثلاث', () => {
  const P = { passMark: 41 };
  const ok = (o) => sub(60, { ...P, ...o });   // فوق العتبة
  const weak = (o) => sub(30, { ...P, ...o }); // ضعيف

  test('«ضعيف في الرياضيات فقط» ⇒ ناجح', () => {
    assert.equal(verdict(3, [
      ok({ arabic: true }), ok({ arabic: true }), weak({ math: true }), ok(),
    ]), 'ناجح');
  });

  test('«ضعيف في الكتابة العربية فقط» ⇒ ناجح', () => {
    assert.equal(verdict(3, [
      ok({ arabic: true }), weak({ arabic: true }), ok({ math: true }), ok(),
    ]), 'ناجح');
  });

  test('«ضعيف في الرياضيات والقراءة معاً» ⇒ راسب', () => {
    assert.equal(verdict(3, [
      weak({ arabic: true }), ok({ arabic: true }), weak({ math: true }), ok(),
    ]), 'راسب');
  });

  test('ضعيفٌ في العلوم وحدها ⇒ ناجح (ليست من الأساسيات الثلاث)', () => {
    assert.equal(verdict(3, [
      ok({ arabic: true }), ok({ arabic: true }), ok({ math: true }), weak(),
    ]), 'ناجح');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('قاعدةُ التجاوز (٥ فأعلى): واحدةٌ حرّة، ثنتان بشرط الربع، ثلاثٌ رسوب', () => {
  const AR = { arabic: true, passMark: 50 };

  test('النجاحُ في كلّ المواد ⇒ ناجح', () => {
    assert.equal(verdict(8, [sub(70, AR), sub(60), sub(55), sub(80)]), 'ناجح');
  });

  test('الرسوبُ بمادّةٍ واحدةٍ غير العربية ⇒ ناجح بلا شرط', () => {
    assert.equal(verdict(8, [sub(70, AR), sub(30), sub(55), sub(80)]), 'ناجح');
  });

  test('الرسوبُ بمادّتين مع تحقّق الربع (٢٥٪) ⇒ ناجح', () => {
    // ٣٥ + ٣٠ = ٦٥ من ٢٠٠ = ٣٢٫٥٪ ≥ ٢٥٪
    assert.equal(verdict(8, [sub(70, AR), sub(35), sub(30), sub(80)]), 'ناجح');
  });

  test('الرسوبُ بمادّتين دون شرط الربع ⇒ راسب', () => {
    // ١٠ + ٥ = ١٥ من ٢٠٠ = ٧٫٥٪ < ٢٥٪
    assert.equal(verdict(8, [sub(70, AR), sub(10), sub(5), sub(80)]), 'راسب');
  });

  test('الرسوبُ في ٣ مواد ⇒ راسبٌ حتماً مهما كانت الدرجات', () => {
    assert.equal(verdict(8, [sub(70, AR), sub(39), sub(39), sub(39)]), 'راسب');
  });

  test('الرسوبُ في العربية وحدها ⇒ راسبٌ حتميّ (لا تُتجاوَز)', () => {
    assert.equal(verdict(8, [sub(45, AR), sub(90), sub(85), sub(80)]), 'راسب',
      'العربيةُ عتبتُها ٥٠٪ ولا تدخل قاعدةَ التجاوز');
  });

  test('شرطُ الربع يوازن بالدرجات الخام لا بالنسب', () => {
    // مادّةٌ نهايتُها ٦٠٠ ودرجتُها ٢٠٠، وأخرى نهايتُها ١٠٠ ودرجتُها ٥
    // المجموع ٢٠٥ من ٧٠٠ = ٢٩٫٣٪ ≥ ٢٥٪ ⇒ ناجح، رغم أنّ متوسّط النسب ١٩٪.
    const big   = { percent: 33.3, mark: 200, maxTotal: 600, passMark: 40 };
    const small = { percent: 5,    mark: 5,   maxTotal: 100, passMark: 40 };
    assert.equal(verdict(9, [sub(70, AR), big, small, sub(80)]), 'ناجح');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('شرطُ اللغة الأجنبية — العاشر فأعلى وحدها', () => {
  const AR = { arabic: true, passMark: 50 };

  test('عاشرٌ رسب في الإنكليزية والفرنسية معاً ⇒ راسب', () => {
    assert.equal(verdict(10, [
      sub(70, AR), sub(30, { lang: true }), sub(25, { lang: true }), sub(80),
    ]), 'راسب');
  });

  test('عاشرٌ نجح بلغةٍ أجنبيةٍ واحدة ⇒ ناجح', () => {
    assert.equal(verdict(10, [
      sub(70, AR), sub(30, { lang: true }), sub(75, { lang: true }), sub(80),
    ]), 'ناجح');
  });

  test('ثامنٌ رسب بلغتيه ⇒ يُحكم بقاعدة التجاوز وحدها (لا شرطَ لغةٍ دونه)', () => {
    // مادّتان راسبتان ٣٥+٣٠ = ٦٥ من ٢٠٠ ⇒ الربع متحقّق ⇒ ناجح
    assert.equal(verdict(8, [
      sub(70, AR), sub(35, { lang: true }), sub(30, { lang: true }), sub(80),
    ]), 'ناجح');
  });

  test('لا يُشترَط حين لا موادَّ لغةٍ مصنَّفة في الصف', () => {
    assert.equal(verdict(10, [sub(70, AR), sub(60), sub(55)]), 'ناجح');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('حرّاسُ الانحدار — شروطٌ كانت تُرسِب ناجحين', () => {
  const AR = { arabic: true, passMark: 50 };

  test('⚠️ نجح في كلّ مادّةٍ بـ٤٥٪ ⇒ ناجح (كان راسباً بشرط «المجموع ٥٠٪»)', () => {
    assert.equal(verdict(8, [sub(55, AR), sub(45), sub(45), sub(45)]), 'ناجح',
      'اللائحةُ لا تشترط مجموعاً — الحكمُ بالمواد لا بالمعدّل');
  });

  test('⚠️ سلوكٌ غيرُ مسجَّل لا يُرسِب صفَّ السابع (كان شرطاً لازماً ٦٠٪)', () => {
    assert.equal(verdict(7, [sub(70, AR), sub(60), sub(55)],
      { conductPercent: null }), 'ناجح');
  });

  test('⚠️ رياضياتُ التاسع بـ٤٥٪ ⇒ ناجح (كانت تُحسب راسبةً بعتبة ٥٠٪)', () => {
    const math = sub(45, { math: true, passMark: resolvePassMark(null, 9, false, true) });
    assert.equal(verdict(9, [sub(70, AR), math, sub(80)]), 'ناجح');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('شروطٌ تبقى فاعلةً حين يضبطها المشرف', () => {
  const AR = { arabic: true, passMark: 50 };

  test('شرطُ الحضور يُرسِب حين يقلّ عن حدّ المدرسة', () => {
    assert.equal(verdict(8, [sub(70, AR), sub(60)],
      { attendancePercent: 40, minAttendancePct: 75 }), 'راسب');
  });

  test('حضورٌ غيرُ مسجَّل لا يُرسِب', () => {
    assert.equal(verdict(8, [sub(70, AR), sub(60)],
      { attendancePercent: null, minAttendancePct: 75 }), 'ناجح');
  });

  test('total_min و conduct_min يُقيّدان متى ضُبطا', () => {
    const rule = { ...ruleForGrade(null, 8), total_min: 50, conduct_min: 60 };
    const base = { grade: 8, rule, subjects: [sub(70, AR), sub(45)] };
    assert.equal(computeYearResult({ ...base, totalPercent: 45, conductPercent: 90 }), 'راسب');
    assert.equal(computeYearResult({ ...base, totalPercent: 80, conductPercent: 50 }), 'راسب');
    assert.equal(computeYearResult({ ...base, totalPercent: 80, conductPercent: 90 }), 'ناجح');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('نطاقاتُ القواعد تغطّي الصفوف الاثني عشر بلا تداخل', () => {
  test('كلُّ صفٍّ ١–١٢ يجد قاعدةً واحدة', () => {
    for (let g = 1; g <= 12; g++) {
      const r = ruleForGrade(null, g);
      assert.ok(r, `الصفّ ${g} بلا قاعدة`);
      assert.ok(g >= r.grade_from && g <= r.grade_to,
        `الصفّ ${g} أُسنِد إلى نطاقٍ لا يشمله`);
    }
  });

  test('الرياضياتُ أساسيةٌ في نطاقٍ واحدٍ فقط، وهو ١–٤', () => {
    const coreGrades = [];
    for (let g = 1; g <= 12; g++) if (ruleForGrade(null, g).math_is_core) coreGrades.push(g);
    assert.deepEqual(coreGrades, [1, 2, 3, 4]);
  });

  test('شرطُ اللغة الأجنبية في الثانويّ وحده', () => {
    const langGrades = [];
    for (let g = 1; g <= 12; g++) {
      if (ruleForGrade(null, g).require_foreign_language) langGrades.push(g);
    }
    assert.deepEqual(langGrades, [10, 11, 12]);
  });
});
