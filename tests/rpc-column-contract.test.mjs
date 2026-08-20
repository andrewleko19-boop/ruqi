// ─────────────────────────────────────────────────────────────────────────────
//  عقدُ الأعمدة بين دالّة القاعدة والواجهة التي تقرؤها.
//
//  علّةٌ لا يمسكها شيءٌ ممّا نملك: هجرةٌ تُعيد تعريف دالّةً بتوقيعٍ أقصر، فتختفي
//  أعمدةٌ من الاستجابة. لا خطأَ SQL (الدالّة سليمة)، ولا خطأَ JS (قراءةُ مفتاحٍ
//  غائبٍ من كائنٍ تُرجع undefined)، ولا سطرَ في سجلّ. والواجهةُ تجمع بـ
//  `Number(s[k]) || 0` — فيصير الغيابُ **صفراً معروضاً بثقة**.
//
//  وقع فعلاً: `20260817000000_rename_teaching_hours_to_weekly_lessons` أرادت
//  تبديلَ اسم عمودٍ في جملة count، فأعادت كتابة الدالّتين من الذاكرة وأسقطت
//  عشرةَ أعمدة. فقرأت لوحتا المديرية والوزارة «إجمالي الطلاب ٠» و«إجمالي الكادر
//  ٠» بينما جداولُ الصفحة نفسها تعرض الأعداد الحقيقية.
//
//  الفحصُ نصّيّ عمداً — كبقية حرّاس هذا المستودع: لا يحتاج قاعدةً ولا شبكة،
//  فيعمل في كلّ بناء. يقرأ **آخر** تعريفٍ لكلّ دالّةٍ عبر الهجرات مرتَّبةً
//  بالاسم (وهو ما سيُنشر فعلاً)، ثمّ يؤكّد أنّ كلَّ مفتاحٍ تقرؤه الواجهة له
//  عمودٌ في ذلك التوقيع.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const MIGS = join(ROOT, 'supabase/migrations');
const migFiles = readdirSync(MIGS).filter(f => f.endsWith('.sql')).sort();

/** آخر توقيعٍ منشور لدالّة: أعمدة `returns table(...)` في أحدث هجرةٍ تعرّفها. */
function latestReturnColumns(fnName) {
  let cols = null;
  for (const f of migFiles) {
    const sql = readFileSync(join(MIGS, f), 'utf8');
    // pg_dump يقتبس الأسماء ("public"."foo")، والهجرات المكتوبة بيدٍ لا تقتبس.
    const re = new RegExp(
      String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\s*\.\s*)?"?${fnName}"?\s*\([^)]*\)\s*` +
      String.raw`returns\s+table\s*\(([\s\S]*?)\)\s*language`,
      'gi',
    );
    let m;
    while ((m = re.exec(sql))) {
      cols = new Set(
        m[1].split(',')
          .map(s => s.trim().split(/\s+/)[0])
          .filter(Boolean)
          .map(s => s.toLowerCase()),
      );
    }
  }
  return cols;
}

/** المفاتيح التي تقرؤها بطاقةُ البنية في بوّابةٍ ما. */
function keysReadBy(portalSrc) {
  const keys = new Set();
  // sum('students_total') — التجميع عبر كل المدارس
  for (const m of portalSrc.matchAll(/\bsum\(\s*'([a-z_]+)'\s*\)/g)) keys.add(m[1]);
  // ['staff_teaching', 'تدريسي'] — جدول فئات الكادر
  const cat = portalSrc.match(/const STAFF_CAT = \[[\s\S]*?\n\];/);
  if (cat) for (const m of cat[0].matchAll(/'([a-z_]+)'\s*,/g)) keys.add(m[1]);
  return keys;
}

const TARGETS = [
  {
    fn: 'get_directorate_school_stats',
    portal: 'directorate/script.js',
    // تُقرأ في الجدول التفصيليّ لا عبر sum() فلا يلتقطها الاستخراج الآليّ.
    extra: ['school_id', 'school_name', 'school_type'],
  },
  {
    fn: 'get_ministry_school_stats',
    portal: 'ministry/script.js',
    extra: ['school_id', 'school_name', 'school_type', 'directorate_name'],
  },
];

describe('توقيعُ دوالّ الإحصاء يغطّي ما تقرؤه اللوحات', () => {
  for (const { fn, portal, extra } of TARGETS) {
    describe(fn, () => {
      const cols = latestReturnColumns(fn);
      const src  = read(portal);

      test('الدالّة معرَّفةٌ في الهجرات بتوقيعِ جدول', () => {
        assert.ok(cols && cols.size > 0,
          `لم يُعثر على تعريفٍ لـ ${fn} في supabase/migrations — الزرُّ سيسقط بـ 42883.`);
      });

      test('عُثر على مفاتيحَ مقروءةٍ فعلاً في البوّابة', () => {
        const keys = keysReadBy(src);
        assert.ok(keys.size >= 5,
          `${portal}: مفاتيحُ قليلةٌ جداً (${keys.size}) — تغيّر شكلُ القراءة والفحصُ صار أعمى.`);
      });

      test('كلُّ مفتاحٍ تقرؤه البوّابة له عمودٌ في التوقيع', () => {
        const keys = new Set([...keysReadBy(src), ...extra]);
        const missing = [...keys].filter(k => !cols.has(k));
        assert.deepEqual(missing, [],
          `${portal} يقرأ أعمدةً لا تُرجعها ${fn}: ${missing.join('، ')} — ` +
          'تُقرأ undefined فتُعرَض أصفاراً بلا أيّ خطأ.');
      });
    });
  }
});
