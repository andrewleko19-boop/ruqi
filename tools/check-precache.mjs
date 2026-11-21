#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  كلُّ وحدةٍ تُستورَد استيراداً ساكناً يجب أن يُخزّنها عامل الخدمة مسبقاً.
//
//  استيرادٌ ساكن (`import … from '../shared/x.js'`) في أوّل ملفّ البوّابة ليس
//  ميزةً تتعطّل إن غاب: فشلُه يُسقط الوحدة كلَّها **قبل أن يُنفَّذ منها سطر
//  واحد**، فلا تظهر اللوحة أصلاً. وهذا وقع فعلاً مع shared/permissions.js:
//  كان غيابه مستوراً بالتخزين اللحظيّ (يُخزَّن عند أوّل جلبٍ ناجح)، ثمّ رفعُ
//  CACHE يحذف الكاش القديم بلا شرط فذهب معه — وانكسر الدخول أوفلاين في ستّ
//  بوّابات دفعةً واحدة. والتعليقُ في sw.js يروي القصّة، ولم يمنع تكرارها شيء.
//
//  ── ثغرتان سدّهما هذا الإصدار ───────────────────────────────────────────────
//  ١) العمق: كان الفحصُ يقرأ script.js وحده. فـcorrespondence.js (CRITICAL)
//     يستورد csel.js (OPTIONAL) — وغيابُ csel.js يُسقط correspondence.js،
//     وهذا يُسقط بوّابة المدرسة كلَّها. الآن نتتبّع الاستيراد إلى آخره.
//  ٢) القائمة: كان «مُدرَجٌ في OPTIONAL» يُعدّ نجاحاً. لكنّ OPTIONAL تُثبَّت
//     بـallSettled — فشلُ ملفٍّ فيها صامت، ثمّ يحذف activate الكاشَ القديم.
//     فبوّابتا المعلّم والمدرسة (العمل اليوميّ دون اتصال) تشترطان CRITICAL
//     لقشرتهما وكلِّ ما تستورده وحداتُها. البقيّة تكفيها أيُّ القائمتين.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, posix } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const PORTALS         = ['school', 'teacher', 'directorate', 'ministry', 'admin', 'parent'];
// البوّابتان اللتان يُوعَد فيهما بالعمل الكامل دون اتصال.
const OFFLINE_PORTALS = new Set(['school', 'teacher']);

const sw = read('sw.js');
function listOf(name) {
  const m = sw.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!m) { console.error(`✗ لم أجد ${name} في sw.js`); process.exit(1); }
  return new Set([...m[1].matchAll(/'\.\/([^']*)'/g)].map(x => x[1]));
}
const CRITICAL = listOf('CRITICAL');
const OPTIONAL = listOf('OPTIONAL');

// مسارٌ نسبيّ لجذر المستودع، بفواصل posix.
const rel = (fromFile, spec) =>
  posix.normalize(posix.join(posix.dirname(fromFile), spec)).replace(/^\.\//, '');

const IMPORT_RE = /^\s*(?:import|export)\s[^'"]*?\sfrom\s*['"](\.{1,2}\/[^'"]+)['"]|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm;

// إغلاقُ الاستيرادات الساكنة لوحدةٍ (يشملها).
function closure(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  if (!existsSync(join(ROOT, entry))) return seen;
  if (!/\.m?js$/.test(entry)) return seen;
  for (const m of read(entry).matchAll(IMPORT_RE)) closure(rel(entry, m[1] || m[2]), seen);
  return seen;
}

const problems = [];
for (const p of PORTALS) {
  const html = `${p}/index.html`;
  if (!existsSync(join(ROOT, html))) continue;
  const src = read(html);
  const strict = OFFLINE_PORTALS.has(p);

  // ما يحتاجه الإقلاع: القشرة، والوحدات وإغلاقها، والسكربتات الكلاسيكية والأنماط.
  // عبرُ الأصل (CDN) خارج نطاق عامل الخدمة عمداً — sw.js لا يتدخّل فيه.
  const local = (u) => !/^(?:[a-z]+:)?\/\//i.test(u);
  const pick  = (re) => [...src.matchAll(re)].map(m => m[1]).filter(local).map(u => rel(html, u));
  const modules  = pick(/<script[^>]*type="module"[^>]*src="([^"]+)"/g);
  const classic  = pick(/<script(?![^>]*type="module")[^>]*src="([^"]+)"/g);
  const sheets   = pick(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g);

  const mustCritical = new Set();       // في البوّابتين: CRITICAL حصراً
  const mustListed   = new Set();       // في أيٍّ من القائمتين
  const boot = new Set();
  for (const m of modules) closure(m, boot);

  for (const f of boot) (strict ? mustCritical : mustListed).add(f);
  if (strict) {
    mustCritical.add(html);
    // ورقةُ أنماط البوّابة نفسها: بدونها تظهر الشاشة بلا تنسيق فلا تُستعمل.
    for (const s of sheets) (s === `${p}/style.css` ? mustCritical : mustListed).add(s);
  } else {
    mustListed.add(html);
    for (const s of sheets) mustListed.add(s);
  }
  for (const c of classic) mustListed.add(c);

  for (const f of mustCritical) {
    if (!CRITICAL.has(f)) {
      problems.push(`${p}: ${f} — ${OPTIONAL.has(f) ? 'في OPTIONAL، ويجب أن يكون في CRITICAL' : 'غير مُخزَّن إطلاقاً'}`);
    }
  }
  for (const f of mustListed) {
    if (!CRITICAL.has(f) && !OPTIONAL.has(f)) problems.push(`${p}: ${f} — غير مُخزَّن إطلاقاً`);
  }
}

// كلُّ ما في القائمتين موجودٌ فعلاً: addAll ذرّية، فملفٌّ مفقودٌ في CRITICAL يُفشل
// كلَّ تثبيتٍ إلى الأبد.
for (const f of CRITICAL) {
  if (f && !existsSync(join(ROOT, normalize(f)))) problems.push(`sw.js CRITICAL: ${f} — الملفّ غير موجود (التثبيت سيفشل دائماً)`);
}

if (problems.length) {
  console.error('\x1b[31m✗ ثغراتٌ في التخزين المسبق لعامل الخدمة:\x1b[0m');
  for (const m of [...new Set(problems)]) console.error(`  · ${m}`);
  console.error('\nفشلُ جلب وحدةٍ مستورَدة يمنع تنفيذ ملفّ البوّابة كلِّه، فلا تظهر اللوحة دون اتصال.');
  process.exit(1);
}
console.log(`\x1b[32m✓ التخزين المسبق يغطّي إقلاع البوّابات الستّ (CRITICAL ${CRITICAL.size} · OPTIONAL ${OPTIONAL.size})\x1b[0m`);
