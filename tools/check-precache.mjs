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
//  الفحص هنا يمنعه: أيُّ ملفٍّ تحت shared/ يُستورَد من بوّابةٍ ولا يرد في
//  CRITICAL ولا OPTIONAL يُسقط البناء.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const PORTALS = ['school', 'teacher', 'directorate', 'ministry', 'admin', 'parent'];

const sw = read('sw.js');
// كلُّ ما يرد في القائمتين، بلا تمييز: كلتاهما تُخزَّن مسبقاً — الفرق في أثر
// الفشل على التثبيت لا في وجود الملفّ.
const listed = new Set(
  [...sw.matchAll(/'\.\/(shared\/[^']+)'/g)].map(m => m[1])
);

const missing = [];
for (const p of PORTALS) {
  const file = `${p}/script.js`;
  if (!existsSync(join(ROOT, file))) continue;
  const src = read(file);
  for (const m of src.matchAll(/^\s*import\s[^'"]*['"]\.\.\/(shared\/[^'"]+)['"]/gm)) {
    const dep = m[1];
    if (!listed.has(dep)) missing.push(`${file} → ${dep}`);
  }
}

if (missing.length) {
  console.error('\x1b[31m✗ وحداتٌ تُستورَد استيراداً ساكناً ولا يُخزّنها عامل الخدمة:\x1b[0m');
  for (const m of [...new Set(missing)]) console.error(`  · ${m}`);
  console.error('\nفشلُ جلبها لا يُعطّل ميزةً — يمنع تنفيذ ملفّ البوّابة كلِّه، فلا تظهر اللوحة.');
  console.error('أضِفها إلى CRITICAL في sw.js (أو OPTIONAL إن احتمل النظام غيابها).');
  process.exit(1);
}

const shared = readdirSync(join(ROOT, 'shared')).filter(f => f.endsWith('.js'));
console.log(`\x1b[32m✓ كلُّ الاستيرادات الساكنة مخزَّنةٌ مسبقاً (${listed.size} مُدرَجاً، ${shared.length} ملفّاً في shared/)\x1b[0m`);
