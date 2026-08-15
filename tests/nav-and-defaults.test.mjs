// ─────────────────────────────────────────────────────────────────────────────
//  علّتان صامتتان: مرشِّحٌ لا يُضبَط، وتبويبٌ يُدهَس.
//
//  ١) `if (sel && !sel.value) sel.value = X` لا يعمل أبداً على <select>: العنصر
//     يحمل قيمة أوّل خيارٍ دائماً، فالشرط لا يتحقّق. والنتيجة أنّ سجلّ الإجازات
//     يفتح على «كانون الثاني» أبداً — فيسجّل المديرُ إجازةً في آب ثمّ يقرأ «لا
//     إجازات مسجَّلة في هذا الشهر»، والسجلّ سليمٌ والإجازةُ محفوظة، والكذبةُ في
//     المرشِّح وحده. لا خطأ، ولا سطرٌ في سجلّ. وهذا ما أبلغ عنه المستخدم.
//     (الحقلُ الرقميّ للسنة كان يعمل بالمصادفة: قيمته الابتدائية '' فارغة فعلاً.)
//
//  ٢) كلُّ بوّابةٍ كانت تكتب replaceState بتبويبها الأوّل فوق العنوان القائم،
//     فتحديثُ الصفحة يُخرج المستخدم من حيث كان إلى أوّل تبويب.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { restoreTab, tabFromHash, syncTabHash } from '../shared/tab-restore.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('restoreTab — الحارس على ما يأتي من العنوان', () => {
  const g = globalThis;
  const withHash = (h, fn) => {
    const prev = g.location;
    g.location = { hash: h };
    try { return fn(); } finally { g.location = prev; }
  };

  test('عنوانٌ مطابق يُستعاد', () => {
    withHash('#statement', () =>
      assert.equal(restoreTab(['attendance', 'statement'], 'attendance'), 'statement'));
  });

  test('بلا عنوان يُفتح الافتراضيّ', () => {
    withHash('', () =>
      assert.equal(restoreTab(['attendance', 'statement'], 'attendance'), 'attendance'));
  });

  test('عنوانٌ ملفَّق لا يُفتح ولا يُسقط البوّابة', () => {
    withHash('#<img src=x onerror=alert(1)>', () =>
      assert.equal(restoreTab(['attendance'], 'attendance'), 'attendance'));
  });

  test('تبويبٌ حُذف من نسخةٍ سابقة يسقط إلى الافتراضيّ', () => {
    withHash('#legacy-tab', () =>
      assert.equal(restoreTab(['attendance', 'staff'], 'attendance'), 'attendance'));
  });

  test('الترميز يُفكّ — تبويبٌ باسمٍ عربيّ يُطابق', () => {
    withHash('#' + encodeURIComponent('الكوادر'), () =>
      assert.equal(restoreTab(['الكوادر'], 'x'), 'الكوادر'));
  });

  test('Set تُقبل كما تُقبل المصفوفة', () => {
    withHash('#b', () => assert.equal(restoreTab(new Set(['a', 'b']), 'a'), 'b'));
  });

  test('tabFromHash تُرجع null على الفراغ', () => {
    withHash('', () => assert.equal(tabFromHash(), null));
    withHash('#', () => assert.equal(tabFromHash(), null));
  });

  test('syncTabHash تستبدل ولا تدفع — زرُّ الرجوع يخرج لا يمشي في التبويبات', () => {
    let pushed = 0, replaced = 0;
    const prevLoc = g.location, prevHist = g.history;
    g.location = { hash: '#a' };
    g.history  = { state: null, pushState: () => pushed++, replaceState: () => replaced++ };
    try {
      syncTabHash('b');
      assert.equal(pushed, 0, 'دفعُ خطوةٍ لكلّ تبديل يجعل الرجوع يمشي في التبويبات.');
      assert.equal(replaced, 1);
      g.location = { hash: '#b' };
      syncTabHash('b');
      assert.equal(replaced, 1, 'كتابةٌ بلا تغيير — إهدارٌ بلا داعٍ.');
    } finally { g.location = prevLoc; g.history = prevHist; }
  });
});

describe('لا يُضبط <select> بشرط الفراغ', () => {
  const cases = [
    ['school/script.js',      'lv-month'],
    ['directorate/script.js', 'dlv-month'],
    ['ministry/script.js',    'mlv-month'],
  ];
  for (const [file, id] of cases) {
    test(`${file}: مرشِّح ${id} يُضبط فعلاً`, () => {
      const src = read(file);
      // النمطُ المعطوب: `!X.value` حارساً على ضبط قيمة <select>.
      const broken = new RegExp(`if \\((?:\\w+ && )?!\\w+\\.value\\)[^\\n]*getMonth`);
      assert.ok(!broken.test(src),
        `شرطُ الفراغ على <select> لا يتحقّق أبداً — يبقى ${id} على أوّل خيار (كانون الثاني).`);
      assert.match(src, /getMonth\(\) \+ 1/, 'لا ضبطَ للشهر الجاري ألبتّة.');
    });
  }
});

describe('كلُّ بوّابةٍ تقرأ العنوان قبل أن تكتبه', () => {
  const portals = ['school', 'directorate', 'admin', 'parent'];
  for (const p of portals) {
    test(`${p}: restoreTab مستورَدة ومستعملة`, () => {
      const src = read(`${p}/script.js`);
      assert.match(src, /from '\.\.\/shared\/tab-restore\.js'/,
        'لا استيراد — التبويب يُدهَس عند كلّ تحديث.');
      assert.match(src, /restoreTab\(/);
    });
  }

  test('بوّابة المعلّم تستعيد وضع الصفحة الرئيسية', () => {
    const src = read('teacher/script.js');
    assert.match(src, /restoreTab\(\['att', 'grades', 'conduct'\]/);
    // ولا تفتح وضعاً بلا صفوف: شاشةٌ فارغة لا يفهمها المعلّم.
    assert.match(src, /classesForMode\(wanted\)\.length/);
  });

  test('لا بوّابةَ تكتب تبويباً ثابتاً فوق العنوان', () => {
    for (const p of ['school', 'directorate', 'admin']) {
      const src = read(`${p}/script.js`);
      assert.ok(!/replaceState\(\{ tab: '(?:attendance|overview)'/.test(src),
        `${p}: ما زال يدوس على العنوان بتبويبٍ ثابت.`);
    }
  });
});

describe('حدّ النصاب يُفرَض حيث تُدخَل الساعات', () => {
  const src = read('school/script.js');

  test('الحدّان يُشتقّان: تجاوزُ المدرسة ثمّ الوطنيّ', () => {
    assert.match(src, /function effectiveQuotaBounds\(\)/);
    assert.match(src, /S\.school\?\.quota_min_hours \?\? _quotaBounds\?\.min_hours/);
  });

  test('الفارغ يعني «اتبع الوطنيّ» لا صفراً', () => {
    const db = read('shared/db.js');
    assert.match(db, /quotaMinHours === '' \|\| patch\.quotaMinHours == null \? null/,
      'صفرٌ هنا يمنع كلَّ إدخال ويبدو للمدير عطلاً لا إعداداً.');
  });

  test('نصابٌ لم يُملأ لا يمنع حفظ السجلّ', () => {
    assert.match(src, /if \(th != null && \(qb\.min != null \|\| qb\.max != null\)\)/,
      'رفضُ الفارغ يمنع حفظ سجلّ موظّفٍ لسببٍ لا علاقة له بهويّته.');
  });
});
