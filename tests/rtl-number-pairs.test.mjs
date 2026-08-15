// ─────────────────────────────────────────────────────────────────────────────
//  زوجُ أرقامٍ عارٍ في فقرةٍ عربية يُقرأ مقلوباً.
//
//  «${assigned} / ${quota}» كان يُبنى بالترتيب المنطقيّ الصحيح — الحمل ثمّ
//  النصاب — ثمّ تعكسه خوارزميةُ ثنائية الاتجاه بصريّاً: الرقمان مقطعان
//  لاتينيّان والشرطةُ محايدة، والفقرةُ عربية الاتجاه.
//
//  فمديرٌ أسند ١٥ درساً لمعلّمةٍ نصابُها ١٢ كان يقرأ «12 / 15»، أي أنّها **دون**
//  النصاب — عكسُ الحقيقة تماماً، وفوقه عنوانٌ أحمر يقول «تجاوزوا النصاب». فلا
//  يفهم، ويظنّ أنّ ١٥ حدٌّ يفرضه النظام. وهذا نصُّ ما أبلغ عنه المستخدم.
//
//  ولا يمسك هذا اختبارُ منطق: الحساب سليم، والقيم صحيحة، والعطلُ في العرض
//  وحده. فالحارس نصّيّ: لا يُبنى زوجُ أرقامٍ متجاورَين بلا اسمٍ يفصلهما.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('تنبيه النصاب يُقرأ كما هو', () => {
  const src = read('school/script.js');
  const fn  = src.match(/function renderQuotaAlert\(\) \{[\s\S]*?\n\}/);

  test('عُثر على المُصيِّر', () => {
    assert.ok(fn, 'لم يُعثر على renderQuotaAlert');
  });

  test('لا زوجَ أرقامٍ متجاورَين بشرطةٍ محايدة', () => {
    assert.ok(!/\$\{r\.assigned\}\s*\/\s*\$\{r\.quota\}/.test(fn[0]),
      '«${assigned} / ${quota}» تعكسها ثنائيةُ الاتجاه فيقرأ المديرُ النصاب حملاً والحملَ نصاباً.');
  });

  test('كلُّ رقمٍ يسبقه اسمه', () => {
    assert.match(fn[0], /الحمل/,  'الحمل بلا عنوان — يبقى الرقم مبهماً.');
    assert.match(fn[0], /النصاب/, 'النصاب بلا عنوان.');
    assert.match(fn[0], /تجاوز/,  'مقدار التجاوز بلا عنوان.');
  });

  test('الأرقام في عناصر مستقلّة فلا يتجاور رقمٌ برقم', () => {
    const parts = fn[0].match(/class="qa-part/g) || [];
    assert.ok(parts.length >= 3,
      `عناصر منفصلة: ${parts.length} — أقلّ من ثلاثة يعني رقمين في عنصرٍ واحد.`);
  });

  test('«نصاب غير محدَّد» تبقى حالةً مستقلّة لا صفراً', () => {
    assert.match(fn[0], /r\.quota == null/,
      'جعلُ الفارغ صفراً يُشهِّر بكلّ معلّمٍ لم يُملأ نصابه.');
  });
});

describe('شارات سجلّ الإجازات كذلك', () => {
  for (const [file, cls] of [['school/script.js', 'lv-chip'], ['directorate/script.js', 'dlv-chip']]) {
    test(`${file}: كلُّ رقمٍ في شارةٍ ومعه اسمه`, () => {
      const src = read(file);
      assert.match(src, new RegExp(`class="${cls}"`),
        'لا شارات — أُعيدت الأرقام عاريةً متجاورة.');
      // «أيام 8» لا «8 / 2»: الاسم يفصل، فلا يبقى للخوارزمية زوجٌ تعكسه.
      assert.match(src, /أيام <b>/);
      assert.match(src, /إجازات <b>/);
    });
  }
});

describe('الرقم الوطني أحد عشر رقماً', () => {
  const src = read('school/script.js');

  test('نوعُ حقلٍ خاصٌّ به لا نصٌّ حرّ', () => {
    assert.match(src, /_CHG_ID\s*=\s*\['national_id','الرقم الوطني','nid'\]/,
      'بقي نصّاً حرّاً يقبل عدداً بلا حدّ.');
  });

  test('الحدّ مكتوبٌ في الحقل نفسه', () => {
    assert.match(src, /maxlength="11" pattern="\[0-9\]\{11\}"/);
  });

  test('اللصق يُنقّى — نصٌّ فيه شرطاتٌ أو فراغات لا يصل البيان الرسميّ', () => {
    assert.match(src, /replace\(\/\\D\/g, ''\)\.slice\(0, 11\)/);
  });
});

describe('حقول النافذة مرتبطةٌ بالقوائم المرجعية', () => {
  const src = read('school/script.js');
  const cases = [
    ['certificate',   'الشهادة'],
    ['specialization','الاختصاص'],
    ['higher_degree', 'الشهادات العليا'],
  ];
  for (const [key, label] of cases) {
    test(`${label} قائمةٌ منسدلة`, () => {
      assert.match(src, new RegExp(`'${key}','[^']*','lookup:${key}'`),
        `${label} ما زال نصّاً حرّاً — فتتفرّق صيغُه ويتفتّت التجميع في اللوحات.`);
    });
  }

  // العمل المسند إليه يختلف بحسب الفئة: الإداريّ يقرأ «الأعمال الإدارية»
  // والمهنيّ يقرأ «الأعمال المساندة» — كما تفعل نافذةُ سجلّ الكوادر بالضبط.
  test('العمل المسند إليه يتبع فئة الكادر', () => {
    assert.match(src, /'job_title','العمل المسند إليه','lookup:admin_role'/);
    assert.match(src, /'job_title','العمل المسند إليه','lookup:support_job'/);
  });

  test('القيمةُ المحفوظة تبقى خياراً ولو حُذفت من القائمة', () => {
    assert.match(src, /cur && !vals\.includes\(cur\) \? \[cur\] : \[\]/,
      'يفتح المديرُ سطراً قديماً فيجده فارغاً، ويحفظ فيمحو ما كان.');
  });
});
