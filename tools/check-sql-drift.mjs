#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  انحرافُ المرجع عن المنشور.
//
//  docs/database-setup.sql مكتوبٌ في رأسه أنّه «للمرجع فقط»، ومع ذلك بقي أعواماً
//  هو المكان الذي تُكتب فيه الدوالّ الجديدة أوّلاً — قبل أن يصير supabase/migrations
//  هو ما يُنشر فعلاً. والنتيجة صنفُ عللٍ لا يمسكه اختبارُ وحدةٍ ولا فحصٌ دخانيّ
//  ولا حتى نشرٌ ناجح: الدالّة موجودة في الملفّ الذي نقرؤه، غائبةٌ عن القاعدة التي
//  نُشغّلها. فيسقط الزرّ عند أوّل مستخدمٍ يضغطه بـ 42883 — وقد مضت أشهر.
//
//  وُجد منه فعلاً: upsert_year_results (زرّ الترفيع السنويّ) في المرجع وحده.
//
//  الفحص نصّيّ عمداً: لا يحتاج قاعدةً ولا شبكة، فيعمل في كلّ بناء.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs/database-setup.sql');
const MIGS = join(ROOT, 'supabase/migrations');

// دوالٌّ في المرجع لا يُنتظر وجودها في الهجرات، ولكلٍّ سببها المكتوب.
const ALLOWED = new Map([
  // أضف هنا عند وجود سببٍ حقيقيّ، مع شرحه — لا لإسكات الفحص.
]);

/** أسماء الدوالّ المعرَّفة في نصّ SQL. */
function functionsIn(sql) {
  const names = new Set();
  // الاقتباس يختلف بين الملفّين: المرجع مكتوبٌ بيدٍ (public.foo)، والأساس مُصدَّرٌ
  // من pg_dump ("public"."foo"). إغفالُ أحد الشكلين يجعل الفحص يبلّغ عن انحرافٍ
  // كلُّه وهم — وهو أسوأ من ألّا يوجد فحص، لأنّه يُعطَّل بعد أوّل إنذارٍ كاذب.
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) names.add(m[1].toLowerCase());
  return names;
}

/* ── تصادمُ أرقام النسخ: هجرةٌ تُنشر ثمّ تُحذف، فيُعاد استعمالُ رقمها ─────────
   القاعدةُ تسجّل رقمَ كلّ هجرةٍ طبّقتها في supabase_migrations.schema_migrations،
   والسجلُّ لا يُمحى بـ`git revert`. فملفٌّ جديدٌ برقمٍ سبق أن نُشر يراه
   `supabase db push` **مطبَّقاً سلفاً فيتخطّاه صامتاً** — لا تحذير، ولا رمز
   خروجٍ غير صفر، و«✅ طُبّقت الهجرات بنجاح» تُطبع كالعادة.

   وقع فعلاً: 20260819000800_remove_school_complex نُشرت، ثمّ رُوجعت بـrevert،
   ثمّ أُعيد استعمالُ الرقم لـ..._restore_school_stats_columns — فلم تصل القاعدةَ
   قطّ، وبقيت لوحتا المديرية والوزارة تعرضان أصفاراً بينما الشيفرة صحيحة.

   الفحصُ يقرأ تاريخ git كلَّه لا شجرةَ العمل: الملفُّ المحذوف هو بيتُ الداء. */
function assertNoVersionReuse() {
  let everSeen;
  try {
    everSeen = execFileSync(
      'git', ['log', '--all', '--pretty=format:', '--name-only', '--diff-filter=A',
              '--', 'supabase/migrations'],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } catch {
    return; // خارج مستودع git (تحميلُ أرشيف مثلاً) — لا يُعطَّل البناء لأجل ذلك
  }
  const historyByVersion = new Map();   // رقمُ النسخة → أسماءُ ملفّاتٍ حملته يوماً
  for (const line of everSeen.split('\n')) {
    const f = line.trim();
    if (!f.endsWith('.sql')) continue;
    const base = f.slice(f.lastIndexOf('/') + 1);
    const ver  = base.match(/^(\d{14})_/)?.[1];
    if (!ver) continue;
    if (!historyByVersion.has(ver)) historyByVersion.set(ver, new Set());
    historyByVersion.get(ver).add(base);
  }

  /* يُقاس الحاضرُ على التاريخ، لا التاريخُ على نفسه: الخطأُ هو أن يحمل ملفٌّ
     **قائمٌ الآن** رقماً سبق أن حمله ملفٌّ آخر. وبهذا يشتكي الفحصُ لحظةَ ارتكاب
     الغلطة، ويسكت فورَ إصلاحها بإعادة الترقيم — ولا يبقى ينبح على تاريخٍ مضى. */
  const clashes = [];
  for (const base of readdirSync(MIGS).filter(f => f.endsWith('.sql'))) {
    const ver = base.match(/^(\d{14})_/)?.[1];
    if (!ver) continue;
    const others = [...(historyByVersion.get(ver) ?? [])].filter(n => n !== base);
    if (others.length) clashes.push([ver, base, others]);
  }
  if (clashes.length) {
    console.error('\x1b[31m✗ ملفُّ هجرةٍ يحمل رقمَ نسخةٍ استُعمل قبله:\x1b[0m');
    for (const [ver, base, others] of clashes) {
      console.error(`  · ${ver}: ${base}`);
      console.error(`      حمَله سابقاً: ${others.join('، ')}`);
    }
    console.error('\nالقاعدةُ تسجّل الرقم لا الاسم، فالثاني يُتخطّى صامتاً ولا يصل الإنتاج.');
    console.error('أعطِ الملفَّ الجديد رقماً أعلى من أعلى نسخةٍ نُشرت.');
    process.exit(1);
  }
}
assertNoVersionReuse();

const docsSql = readFileSync(DOCS, 'utf8');
const migSql  = readdirSync(MIGS)
  .filter(f => f.endsWith('.sql'))
  .map(f => readFileSync(join(MIGS, f), 'utf8'))
  .join('\n');

const inDocs = functionsIn(docsSql);
const inMigs = functionsIn(migSql);

const missing = [...inDocs].filter(n => !inMigs.has(n) && !ALLOWED.has(n)).sort();

if (missing.length) {
  console.error('\x1b[31m✗ دوالّ في docs/database-setup.sql وليست في supabase/migrations:\x1b[0m');
  for (const n of missing) console.error(`  · ${n}()`);
  console.error('\nالمنشور هو الهجرات. دالّةٌ هنا وحدها تسقط عند أوّل استعمالٍ حقيقيّ بـ 42883.');
  console.error('انقلها إلى هجرةٍ جديدة، أو أضفها إلى ALLOWED في هذا الملفّ مع سببها.');
  process.exit(1);
}

console.log(`\x1b[32m✓ لا انحراف: ${inDocs.size} دالّة في المرجع، كلّها في الهجرات (${inMigs.size} دالّة)\x1b[0m`);
