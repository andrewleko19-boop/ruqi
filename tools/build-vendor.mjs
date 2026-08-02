// tools/build-vendor.mjs
//
// يبني نسخة محلّية مكتفية ذاتياً من مكتبة Supabase إلى shared/vendor/.
//
// لماذا: كان shared/db.js و verify.js يستوردان المكتبة من CDN خارجي:
//
//     import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
//
// وذاك الرابط لا يُرجع المكتبة بل ملفّاً من ٤٥٨ بايت يستورد بدوره خمسة
// ملفّات أخرى من esm.sh — أي ستّ طلبات لخادم خارجي لفتح أي لوحة. وعامل
// الخدمة (sw.js) يتخطّى كل ما هو cross-origin عمداً، فلا يخزّن منها شيئاً.
// النتيجة دون اتصال: الاستيراد يفشل → الوحدة كلّها لا تُنفَّذ → لا
// createClient ولا window.RUQI_DB، فتُفتح القشرة من الكاش وخلفها لا شيء.
// تطبيق «يعمل دون اتصال» كان يتعذّر الدخول إليه دون اتصال.
//
// الحلّ: حزمة ESM واحدة داخل المستودع تُخزّنها sw.js مع بقيّة القشرة.
//
// التشغيل:  node tools/build-vendor.mjs
// (يحتاج شبكة — يُشغَّل عند ترقية المكتبة فقط، لا في كل بناء.)

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m';

// ثبّت الإصدار: ترقية المكتبة قرار واعٍ يُراجَع، لا شيء يتغيّر تحت أقدامنا
// في بناء تالٍ. حدّثه يدوياً ثم أعد تشغيل هذا السكربت.
const SUPABASE_VERSION = '2.111.0';
const ESBUILD_VERSION  = '0.24.0';

const OUT_DIR  = 'shared/vendor';
const OUT_FILE = join(OUT_DIR, 'supabase-js.mjs');

const work = join(tmpdir(), 'ruqi-vendor-' + Date.now());

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

try {
  console.log(`${DIM}→ حزمة عمل مؤقّتة: ${work}${RESET}`);
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'v', private: true }, null, 2));

  console.log(`→ تنزيل @supabase/supabase-js@${SUPABASE_VERSION} …`);
  run('npm', ['install', '--no-audit', '--no-fund', '--silent',
              `@supabase/supabase-js@${SUPABASE_VERSION}`], work);

  // نُصدّر ما يستعمله التطبيق فعلاً فقط — لا الحزمة كاملةً بكل أسطحها.
  writeFileSync(join(work, 'entry.js'),
    'export { createClient } from "@supabase/supabase-js";\n');

  console.log(`→ تجميع بـ esbuild@${ESBUILD_VERSION} …`);
  run('npx', ['--yes', `esbuild@${ESBUILD_VERSION}`, 'entry.js',
              '--bundle', '--format=esm', '--platform=browser',
              '--target=es2020', '--minify',
              `--outfile=${join(work, 'bundle.mjs')}`], work);

  const bundle = readFileSync(join(work, 'bundle.mjs'), 'utf8');

  // بوّابة أمان: الغرض كلّه أن تكون الحزمة مكتفية ذاتياً. أي استيراد خارجي
  // متبقٍّ يعيدنا إلى العطل نفسه دون اتصال — فنفشل هنا لا في هاتف معلّم.
  const leftovers = [...bundle.matchAll(/\bfrom\s*["']([^"']+)["']/g)]
    .map(m => m[1])
    .filter(s => !s.startsWith('.'));
  if (leftovers.length) {
    console.error(`${RED}✗ الحزمة ليست مكتفية ذاتياً — استيرادات متبقّية:${RESET}`);
    console.error('  ' + [...new Set(leftovers)].join('\n  '));
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const header =
    `// @supabase/supabase-js@${SUPABASE_VERSION} — حزمة ESM مكتفية ذاتياً.\n` +
    `// مولَّدة آلياً بـ tools/build-vendor.mjs — لا تُحرَّر يدوياً.\n` +
    `// السبب: عامل الخدمة لا يخزّن ملفّات cross-origin، فاستيراد المكتبة من\n` +
    `// CDN كان يعطّل التطبيق كلّياً دون اتصال. راجع رأس build-vendor.mjs.\n`;
  writeFileSync(OUT_FILE, header + bundle);

  const kb = Math.round(Buffer.byteLength(header + bundle) / 1024);
  console.log(`${GREEN}✓ ${OUT_FILE} — ${kb} ك.ب، صفر استيرادات خارجية${RESET}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (!existsSync(OUT_FILE)) process.exit(1);
