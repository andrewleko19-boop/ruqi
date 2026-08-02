// tools/build-fonts.mjs
//
// ينزّل خطوط التطبيق إلى shared/vendor/fonts/ ويولّد fonts.css يشير إليها.
//
// لماذا: كانت الصفحات تربط Google Fonts مباشرةً. وهو أصل خارجي، وعامل
// الخدمة يتخطّى cross-origin عمداً — فدون اتصال تفشل (ERR_NETWORK_CHANGED
// في تقرير المستخدم) ويُرسَم النصّ بخطّ النظام، فيقفز التخطيط ويبدو
// التطبيق دون اتصال مختلفاً عنه متّصلاً.
//
// النطاق: العائلات الثلاث المستعملة في التطبيق المشحون فقط. Poppins و
// Aref Ruqaa مستعملتان في brand-preview.html وحده — وهو نموذج تصميم لا
// يُشحن (ليس في PRECACHE ولا في check:html) — فلا تُنزَّلان.
//
// المقاطع: arabic + latin فقط. Google تقسّم كل عائلة إلى مقاطع
// (cyrillic، vietnamese، …) لا تُستعمل في واجهة عربية، وتنزيلها كلّها
// يضاعف الحجم بلا فائدة.
//
// التشغيل:  node tools/build-fonts.mjs
// (يحتاج شبكة — يُشغَّل عند تغيير العائلات أو الأوزان فقط.)

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';

const OUT_DIR = 'shared/vendor/fonts';

// وكيل متصفّح حقيقي مقصود: Google Fonts تُرجع صيغة قديمة (TTF) لوكيل لا
// تعرفه، وتُرجع woff2 الأصغر بكثير للمتصفّحات الحديثة.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Cairo و DM Sans متغيّران (variable): ملفّ واحد يغطّي كل الأوزان في المدى،
// وهو أصغر من عدّة ملفّات ثابتة. Tajawal ثابت فنطلب أوزانه المستعملة فقط.
const FAMILIES = [
  { name: 'Cairo',    spec: 'Cairo:wght@200..1000' },
  { name: 'Tajawal',  spec: 'Tajawal:wght@400;500;700;800' },
  { name: 'DM Sans',  spec: 'DM+Sans:wght@400..700' },
];

const KEEP_SUBSETS = new Set(['arabic', 'latin']);

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

let css = `/* خطوط رُقِيّ — محلّية لا من Google Fonts.
   مولَّدة آلياً بـ tools/build-fonts.mjs — لا تُحرَّر يدوياً.
   السبب: عامل الخدمة لا يخزّن ملفّات cross-origin، فخطوط CDN تفشل دون
   اتصال ويقفز التخطيط. راجع رأس build-fonts.mjs. */\n`;
let totalBytes = 0, fileCount = 0;

for (const fam of FAMILIES) {
  const src = await fetchText(
    `https://fonts.googleapis.com/css2?family=${fam.spec}&display=swap`);

  // كل كتلة @font-face يسبقها تعليق باسم المقطع: /* arabic */
  const blocks = [...src.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)];
  if (!blocks.length) throw new Error(`لا كتل @font-face لـ ${fam.name}`);

  let kept = 0;
  for (const [, subset, block] of blocks) {
    if (!KEEP_SUBSETS.has(subset)) continue;

    const url = block.match(/url\((https:\/\/[^)]+)\)/)?.[1];
    if (!url) continue;

    const weight = block.match(/font-weight:\s*([^;]+);/)?.[1].trim() ?? '400';
    const file   = `${slug(fam.name)}-${subset}-${slug(weight)}.woff2`;

    const buf = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer());
    writeFileSync(join(OUT_DIR, file), buf);
    totalBytes += buf.length; fileCount++; kept++;

    css += '\n' + block
      .replace(/url\(https:\/\/[^)]+\)/, `url(./${file})`)
      .replace(/\s+/g, ' ')
      .replace('@font-face {', '@font-face {\n ')
      .replace(/; /g, ';\n ')
      .replace(/ \}$/, '\n}') + '\n';
  }
  console.log(`${DIM}  ${fam.name}: ${kept} ملفّ${RESET}`);
  if (!kept) { console.error(`${RED}✗ لم يُحفَظ أي ملفّ لـ ${fam.name}${RESET}`); process.exit(1); }
}

writeFileSync(join(OUT_DIR, 'fonts.css'), css);
console.log(`${GREEN}✓ ${OUT_DIR} — ${fileCount} ملفّ خطّ، ${Math.round(totalBytes / 1024)} ك.ب${RESET}`);
