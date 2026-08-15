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
