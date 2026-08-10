// tests/import-parser.test.mjs
//
// Tests for shared/import-parser.js — the module that turns a school's CSV/Excel
// roster into mapped rows.
//
// Why this module is tested first: it is pure input→output with no network, no
// DOM and no Supabase, and a bug here corrupts student records at the moment
// they enter the system — the hardest kind of damage to notice and to undo.
//
// The assertions below encode decisions that are easy to "fix" into a
// regression later: day-first date order, tolerant matching that still refuses
// to auto-accept a fuzzy header, and normalisation that is for MATCHING ONLY
// and must never be written to the database.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadImportParser } from './helpers/load-classic.mjs';

const P = loadImportParser();

// A schema shaped like the real student import.
const STUDENT_SCHEMA = [
  { key: 'name',   required: true,  aliases: ['اسم الطالب', 'الاسم', 'الاسم الكامل'] },
  { key: 'gender', required: false, aliases: ['الجنس', 'النوع'] },
  { key: 'dob',    required: false, aliases: ['تاريخ الميلاد', 'المواليد'] },
  { key: 'nid',    required: true,  aliases: ['الرقم الوطني'] },
];

describe('normalizeArabicDigits', () => {
  test('converts Arabic-Indic digits to ASCII', () => {
    assert.equal(P.normalizeArabicDigits('٢٠١٠-٠٥-٢١'), '2010-05-21');
  });

  test('converts Extended (Persian) digits to ASCII', () => {
    assert.equal(P.normalizeArabicDigits('۱۲۳۴۵۶۷۸۹۰'), '1234567890');
  });

  test('leaves ASCII digits and surrounding text untouched', () => {
    assert.equal(P.normalizeArabicDigits('رقم 12 ب'), 'رقم 12 ب');
  });

  test('null and undefined become an empty string rather than "null"', () => {
    assert.equal(P.normalizeArabicDigits(null), '');
    assert.equal(P.normalizeArabicDigits(undefined), '');
  });

  test('accepts non-string input (Excel hands back numbers)', () => {
    assert.equal(P.normalizeArabicDigits(2010), '2010');
  });
});

describe('normalizeArabicText', () => {
  test('unifies the alef forms', () => {
    for (const v of ['أحمد', 'إحمد', 'آحمد', 'ٱحمد']) {
      assert.equal(P.normalizeArabicText(v), 'احمد');
    }
  });

  test('folds ta-marbuta to ha and alef-maqsura to ya', () => {
    assert.equal(P.normalizeArabicText('هبة'), 'هبه');
    assert.equal(P.normalizeArabicText('مصطفى'), 'مصطفي');
  });

  test('strips diacritics and tatweel', () => {
    assert.equal(P.normalizeArabicText('مُحَمَّد'), 'محمد');
    assert.equal(P.normalizeArabicText('ســـلام'), 'سلام');
  });

  test('turns punctuation into spaces and collapses runs of whitespace', () => {
    assert.equal(P.normalizeArabicText('اسم-الطالب'), 'اسم الطالب');
    assert.equal(P.normalizeArabicText('تاريخ  الميلاد'), 'تاريخ الميلاد');
    assert.equal(P.normalizeArabicText('  (الاسم)  '), 'الاسم');
  });

  test('lowercases Latin text so English headers match too', () => {
    assert.equal(P.normalizeArabicText('Student Name'), 'student name');
  });

  // Guards the module's own warning: this transform is lossy, so it is a
  // matching key only. If it were ever applied to a value on its way into the
  // database, two different people would be stored under one spelling.
  test('is lossy — distinct names collide, so it must never be persisted', () => {
    assert.equal(P.normalizeArabicText('هبة'), P.normalizeArabicText('هبه'));
  });
});

describe('normGender', () => {
  test('recognises the Arabic spellings', () => {
    for (const v of ['ذكر', 'ولد', 'ذ']) assert.equal(P.normGender(v), 'male');
    for (const v of ['أنثى', 'انثى', 'أنثي', 'بنت']) assert.equal(P.normGender(v), 'female');
  });

  test('recognises English spellings regardless of case', () => {
    for (const v of ['male', 'M', 'm']) assert.equal(P.normGender(v), 'male');
    for (const v of ['female', 'F', 'f']) assert.equal(P.normGender(v), 'female');
  });

  test('returns empty string for blank or unrecognised values', () => {
    for (const v of ['', '   ', null, undefined, 'غير محدد', 'x']) {
      assert.equal(P.normGender(v), '');
    }
  });

  // An unreadable gender must stay empty rather than defaulting to a guess:
  // a silently wrong value is worse than a blank the school can fill in.
  test('never guesses — an unknown value does not fall back to male', () => {
    assert.notEqual(P.normGender('؟'), 'male');
  });
});

describe('ordinalWordToNumber', () => {
  test('maps Arabic ordinals to grade numbers', () => {
    assert.equal(P.ordinalWordToNumber('الأول'), 1);
    assert.equal(P.ordinalWordToNumber('ثاني'), 2);
    assert.equal(P.ordinalWordToNumber('العاشر'), 10);
    assert.equal(P.ordinalWordToNumber('الحادي عشر'), 11);
    assert.equal(P.ordinalWordToNumber('الثاني عشر'), 12);
  });

  test('tolerates the "الصف" prefix', () => {
    assert.equal(P.ordinalWordToNumber('الصف الأول'), 1);
    assert.equal(P.ordinalWordToNumber('الصف الثاني عشر'), 12);
  });

  test('returns null — not 0 — for an unknown word', () => {
    assert.equal(P.ordinalWordToNumber('غير معروف'), null);
    assert.equal(P.ordinalWordToNumber(''), null);
  });

  // Kindergarten is grade 0, which is falsy. A caller writing `if (!grade)`
  // would silently drop every KG student, so the 0/null distinction matters.
  test('kindergarten is 0, which must be distinguishable from null', () => {
    for (const v of ['تحضيري', 'روضة', 'رياض']) {
      assert.equal(P.ordinalWordToNumber(v), 0);
    }
    assert.notEqual(P.ordinalWordToNumber('تحضيري'), null);
  });
});

describe('parseTolerantDate', () => {
  test('empty input is not an error — the field is simply absent', () => {
    for (const v of [null, undefined, '', '   ']) {
      assert.deepEqual(P.parseTolerantDate(v), { value: null, error: null });
    }
  });

  test('parses ISO order with any of the three separators', () => {
    for (const v of ['2010-05-21', '2010/05/21', '2010.05.21']) {
      assert.deepEqual(P.parseTolerantDate(v), { value: '2010-05-21', error: null });
    }
  });

  // Syrian rosters are written day-first. Reading 05/06/2010 as 6 May would
  // shift a birth date by a month without anything looking wrong.
  test('reads the short form as DAY first, not month first', () => {
    assert.equal(P.parseTolerantDate('05/06/2010').value, '2010-06-05');
    assert.equal(P.parseTolerantDate('21-05-2010').value, '2010-05-21');
  });

  test('pads single-digit day and month', () => {
    assert.equal(P.parseTolerantDate('5/6/2010').value, '2010-06-05');
  });

  test('accepts Arabic-Indic digits', () => {
    assert.equal(P.parseTolerantDate('٢٠١٠-٠٥-٢١').value, '2010-05-21');
    assert.equal(P.parseTolerantDate('٢١/٠٥/٢٠١٠').value, '2010-05-21');
  });

  test('accepts a real Date object from a formatted Excel cell', () => {
    assert.equal(P.parseTolerantDate(new Date(2010, 4, 21)).value, '2010-05-21');
  });

  test('rejects an invalid Date object', () => {
    const out = P.parseTolerantDate(new Date('nonsense'));
    assert.equal(out.value, null);
    assert.ok(out.error, 'expected an error message');
  });

  test('rejects an out-of-range year', () => {
    assert.equal(P.parseTolerantDate('1899-05-21').value, null);
    const future = new Date().getFullYear() + 1;
    assert.equal(P.parseTolerantDate(`${future}-05-21`).value, null);
  });

  test('rejects an impossible month or day', () => {
    assert.equal(P.parseTolerantDate('2010-13-01').value, null);
    assert.equal(P.parseTolerantDate('2010-05-32').value, null);
    assert.equal(P.parseTolerantDate('2010-05-00').value, null);
  });

  // Range checks alone accept 31 February. Such a row reaches Postgres and
  // fails the whole batch with an opaque error instead of naming the bad line.
  test('rejects dates that pass the range check but are not on the calendar', () => {
    for (const v of ['2010-02-31', '2010-02-30', '2010-04-31', '2010-06-31', '2011-02-29']) {
      assert.equal(P.parseTolerantDate(v).value, null, `${v} should be rejected`);
    }
  });

  test('still accepts 29 February in a leap year', () => {
    assert.equal(P.parseTolerantDate('2012-02-29').value, '2012-02-29');
  });

  test('an unrecognised format returns a readable Arabic error, not a throw', () => {
    const out = P.parseTolerantDate('21 أيار 2010');
    assert.equal(out.value, null);
    assert.match(out.error, /صيغة التاريخ غير مفهومة/);
    assert.ok(out.error.includes('21 أيار 2010'), 'error should quote the offending value');
  });

  test('never throws, whatever it is handed', () => {
    for (const v of [{}, [], true, 0, NaN, 'x'.repeat(500)]) {
      assert.doesNotThrow(() => P.parseTolerantDate(v));
    }
  });
});

describe('levenshtein', () => {
  test('identical strings have distance 0', () => {
    assert.equal(P.levenshtein('الاسم', 'الاسم'), 0);
  });

  test('an empty string costs the length of the other', () => {
    assert.equal(P.levenshtein('', 'اسم'), 3);
    assert.equal(P.levenshtein('اسم', ''), 3);
  });

  test('counts single edits', () => {
    assert.equal(P.levenshtein('kitten', 'sitting'), 3);
    assert.equal(P.levenshtein('اسم', 'اسمم'), 1);
  });

  test('is symmetric', () => {
    assert.equal(P.levenshtein('الجنس', 'الجن'), P.levenshtein('الجن', 'الجنس'));
  });
});

describe('matchHeaders', () => {
  test('maps exact headers with exact confidence and no complaints', () => {
    const r = P.matchHeaders(['اسم الطالب', 'الجنس', 'تاريخ الميلاد', 'الرقم الوطني'], STUDENT_SCHEMA);
    assert.deepEqual(r.mapping, { name: 0, gender: 1, dob: 2, nid: 3 });
    assert.deepEqual(r.missingRequired, []);
    assert.deepEqual(r.ambiguous, []);
    assert.equal(r.confidence.name, 'exact');
  });

  test('matches despite spacing, punctuation and hamza differences', () => {
    const r = P.matchHeaders(['اسم-الطالب', 'الجنس ', 'تاريخ  الميلاد', 'الرقم الوطني'], STUDENT_SCHEMA);
    assert.deepEqual(r.mapping, { name: 0, gender: 1, dob: 2, nid: 3 });
    assert.deepEqual(r.missingRequired, []);
  });

  test('matches an alias other than the canonical header', () => {
    const r = P.matchHeaders(['الاسم الكامل', 'النوع', 'المواليد', 'الرقم الوطني'], STUDENT_SCHEMA);
    assert.deepEqual(r.mapping, { name: 0, gender: 1, dob: 2, nid: 3 });
  });

  test('reports a required field that has no column', () => {
    const r = P.matchHeaders(['اسم الطالب', 'الجنس'], STUDENT_SCHEMA);
    assert.equal(r.mapping.nid, null);
    assert.deepEqual(r.missingRequired, ['nid']);
  });

  test('an optional field with no column is null but not an error', () => {
    const r = P.matchHeaders(['اسم الطالب', 'الرقم الوطني'], STUDENT_SCHEMA);
    assert.equal(r.mapping.dob, null);
    assert.equal(r.confidence.dob, null);
    assert.deepEqual(r.missingRequired, []);
  });

  test('flags ambiguity when two columns match one field', () => {
    const r = P.matchHeaders(['الاسم', 'اسم الطالب', 'الرقم الوطني'], STUDENT_SCHEMA);
    assert.ok(r.ambiguous.includes('name'), 'name should be flagged ambiguous');
    assert.equal(r.mapping.nid, 2, 'the unambiguous field still maps');
  });

  // One spreadsheet column cannot populate two fields: the weaker claim is
  // dropped so a human resolves it, instead of the same value silently landing
  // in both the name and the national-ID column.
  test('one column never feeds two fields — the weaker match is released', () => {
    const schema = [
      { key: 'a', required: false, aliases: ['الرقم الوطني'] },
      { key: 'b', required: false, aliases: ['الرقم'] },
    ];
    const r = P.matchHeaders(['الرقم الوطني'], schema);
    const used = Object.values(r.mapping).filter((v) => v != null);
    assert.equal(used.length, 1, 'only one field may keep the column');
    assert.equal(r.mapping.a, 0, 'the exact match keeps it');
    assert.equal(r.mapping.b, null);
    assert.ok(r.ambiguous.includes('b'));
  });

  test('a field released by the collision rule is reported missing when required', () => {
    const schema = [
      { key: 'a', required: false, aliases: ['الرقم الوطني'] },
      { key: 'b', required: true,  aliases: ['الرقم'] },
    ];
    const r = P.matchHeaders(['الرقم الوطني'], schema);
    assert.equal(r.mapping.b, null);
    assert.ok(r.missingRequired.includes('b'), 'a released required field must be reported');
  });

  test('a fuzzy hit is recorded but always flagged for human confirmation', () => {
    const r = P.matchHeaders(['الرقم الوطنى'], [
      { key: 'nid', required: true, aliases: ['الرقم الوطني'] },
    ]);
    if (r.mapping.nid != null && r.confidence.nid === 'fuzzy') {
      assert.ok(r.ambiguous.includes('nid'), 'a fuzzy match must never be accepted silently');
    }
  });

  test('ignores blank header cells', () => {
    const r = P.matchHeaders(['', 'اسم الطالب', '   ', 'الرقم الوطني'], STUDENT_SCHEMA);
    assert.equal(r.mapping.name, 1);
    assert.equal(r.mapping.nid, 3);
  });

  test('a completely unrelated sheet maps nothing and names every required field', () => {
    const r = P.matchHeaders(['العمود الأول', 'العمود الثاني'], STUDENT_SCHEMA);
    assert.deepEqual(r.missingRequired.sort(), ['name', 'nid']);
  });
});

describe('applyMapping', () => {
  test('projects rows onto the mapped field names', () => {
    const rows = [['أحمد', 'ذكر', '2010-05-21', '01010101010']];
    const out = P.applyMapping(
      ['اسم الطالب', 'الجنس', 'تاريخ الميلاد', 'الرقم الوطني'],
      rows,
      { name: 0, gender: 1, dob: 2, nid: 3 },
    );
    assert.deepEqual(out, [{ name: 'أحمد', gender: 'ذكر', dob: '2010-05-21', nid: '01010101010' }]);
  });

  test('an unmapped field becomes an empty string, never undefined', () => {
    const out = P.applyMapping(['اسم الطالب'], [['أحمد']], { name: 0, dob: null });
    assert.equal(out[0].dob, '');
    assert.ok('dob' in out[0], 'the key must exist so downstream code sees a value');
  });

  test('a short row yields empty strings rather than undefined', () => {
    const out = P.applyMapping(['a', 'b'], [['أحمد']], { name: 0, gender: 1 });
    assert.deepEqual(out, [{ name: 'أحمد', gender: '' }]);
  });

  test('an empty row set yields an empty result', () => {
    assert.deepEqual(P.applyMapping(['a'], [], { name: 0 }), []);
  });
});

describe('parseCSV', () => {
  test('splits a plain sheet', () => {
    assert.deepEqual(P.parseCSV('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  });

  test('handles CRLF line endings from Windows Excel', () => {
    assert.deepEqual(P.parseCSV('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  });

  test('keeps commas inside quoted fields', () => {
    assert.deepEqual(P.parseCSV('"عابد, جواد",ذكر'), [['عابد, جواد', 'ذكر']]);
  });

  test('unescapes doubled quotes', () => {
    assert.deepEqual(P.parseCSV('"قال ""مرحباً""",x'), [['قال "مرحباً"', 'x']]);
  });

  test('keeps newlines inside quoted fields', () => {
    assert.deepEqual(P.parseCSV('"سطر\nآخر",b'), [['سطر\nآخر', 'b']]);
  });

  test('preserves empty cells in the middle of a row', () => {
    assert.deepEqual(P.parseCSV('a,,c'), [['a', '', 'c']]);
  });

  test('drops rows that are entirely blank', () => {
    assert.deepEqual(P.parseCSV('a,b\n\n,\n1,2\n'), [['a', 'b'], ['1', '2']]);
  });

  test('a trailing newline does not produce a phantom row', () => {
    assert.equal(P.parseCSV('a,b\n1,2\n').length, 2);
  });

  test('empty input yields no rows', () => {
    assert.deepEqual(P.parseCSV(''), []);
  });

  test('keeps Arabic text and Arabic-Indic digits verbatim', () => {
    // parseCSV must not normalise: normalisation is a later, explicit step.
    assert.deepEqual(P.parseCSV('اسم الطالب,٢٠١٠'), [['اسم الطالب', '٢٠١٠']]);
  });
});

describe('end-to-end: a realistic school file', () => {
  test('a messy but valid sheet imports cleanly', () => {
    const csv = [
      'اسم-الطالب,النوع,المواليد,الرقم الوطني',
      '"عابد, جواد",ذكر,٢١/٠٥/٢٠١٠,01010101010',
      'إلين عميرة,أنثى,2011.03.07,02020202020',
    ].join('\n');

    const rows = P.parseCSV(csv);
    const headers = rows[0];
    const { mapping, missingRequired } = P.matchHeaders(headers, STUDENT_SCHEMA);
    assert.deepEqual(missingRequired, [], 'every required column should be found');

    const mapped = P.applyMapping(headers, rows.slice(1), mapping);
    const parsed = mapped.map((r) => ({
      name: r.name,
      gender: P.normGender(r.gender),
      dob: P.parseTolerantDate(r.dob).value,
      nid: P.normalizeArabicDigits(r.nid),
    }));

    assert.deepEqual(parsed, [
      { name: 'عابد, جواد', gender: 'male',   dob: '2010-05-21', nid: '01010101010' },
      { name: 'إلين عميرة', gender: 'female', dob: '2011-03-07', nid: '02020202020' },
    ]);
  });

  test('one bad row is reported without stopping the others', () => {
    const csv = [
      'اسم الطالب,الرقم الوطني,تاريخ الميلاد',
      'أحمد,01010101010,2010-05-21',
      'سارة,02020202020,لا يوجد',
      'ليلى,03030303030,2011-02-30',
    ].join('\n');

    const rows = P.parseCSV(csv);
    const { mapping } = P.matchHeaders(rows[0], STUDENT_SCHEMA);
    const mapped = P.applyMapping(rows[0], rows.slice(1), mapping);
    const results = mapped.map((r) => P.parseTolerantDate(r.dob));

    assert.equal(results[0].value, '2010-05-21');
    assert.equal(results[0].error, null);
    assert.equal(results[1].value, null);
    assert.ok(results[1].error, 'unreadable date should carry an error');
    assert.equal(results[2].value, null);
    assert.ok(results[2].error, '30 February should carry an error');
  });

  test('the student name is stored as written, not normalised', () => {
    // Normalisation folds ة→ه; the roster must keep the family's spelling.
    const rows = P.parseCSV('اسم الطالب,الرقم الوطني\nهبة,01010101010');
    const { mapping } = P.matchHeaders(rows[0], STUDENT_SCHEMA);
    const mapped = P.applyMapping(rows[0], rows.slice(1), mapping);
    assert.equal(mapped[0].name, 'هبة');
  });
});
