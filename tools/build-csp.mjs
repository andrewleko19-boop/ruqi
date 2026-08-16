// ─────────────────────────────────────────────────────────────────────────────
//  سياسةُ أمن المحتوى (CSP): آخرُ خطٍّ حين يعبر نصٌّ خبيثٌ كلَّ ما قبله.
//
//  التطبيق يُنشر على GitHub Pages، ولا سبيل هناك إلى ترويسات HTTP — فالوسيلة
//  الوحيدة وسمُ <meta http-equiv>. وله حدّان معروفان: frame-ancestors و
//  report-to يُهمَلان فيه، فلا نكتبهما كي لا نوهم أنفسنا بحمايةٍ غير قائمة.
//
//  ما تشتريه هذه السياسة فعلاً:
//   · script-src بلا 'unsafe-inline' — نصٌّ حُقن في DOM لا يُنفَّذ. ولهذا نُقلت
//     شيفرةُ index.html السطرية إلى shared/home.js: بقاؤها كان يُلزمنا
//     'unsafe-inline' فيُبطل الحماية كلَّها.
//   · connect-src محصورةٌ بخادمنا — تسريبُ بياناتٍ إلى خادم المهاجم يُرَدّ.
//   · object-src 'none' و base-uri 'self' — يسدّان تصعيدين كلاسيكيين
//     (<object> ووسمُ <base> الذي يُعيد توجيه كلّ مسارٍ نسبيّ).
//   · form-action 'self' — استمارةٌ محقونة لا تُرسل كلمةَ المرور إلى الخارج.
//
//  style-src يحتفظ بـ'unsafe-inline': في الصفحات ٤٤٩ سمةَ style سطرية، ونزعُها
//  تغييرٌ تجميليٌّ واسعُ الخطر بلا مكسبٍ أمنيّ يُذكر (حقنُ نمطٍ ليس تنفيذَ
//  شيفرة). صُرِّح به هنا لا سهواً.
//
//  المصادر الخارجية مسمّاةٌ واحداً واحداً لكلّ صفحة بحسب حاجتها الفعلية، ولا
//  يُسمح بأصلٍ في صفحةٍ لا تستعمله. وكلُّ ملفٍّ من CDN موسومٌ ببصمة SRI، فحتى
//  الأصلُ المسموح لا يُنفَّذ محتوىً مبدَّلاً.
//
//  الاستعمال: node tools/build-csp.mjs [--check]
//   بلا معامل: يكتب/يحدّث الوسم في كلّ صفحة.
//   --check  : يتحقّق أنّ المكتوب مطابقٌ لِما يولّده هذا الملفّ (يُنادى في CI).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SUPABASE = 'https://xocrzpjfvizgnsybegwr.supabase.co';
const WS       = 'wss://xocrzpjfvizgnsybegwr.supabase.co';
const JSDELIVR = 'https://cdn.jsdelivr.net';
const UNPKG    = 'https://unpkg.com';
const TILES    = 'https://*.tile.openstreetmap.org';

/** يبني السياسة لصفحةٍ بحسب ما تستعمله فعلاً. */
function policy({ jsdelivr = false, maps = false } = {}) {
  const script = ["'self'"];
  if (maps)     script.push(UNPKG);
  if (jsdelivr || maps) script.push(JSDELIVR);

  const style = ["'self'", "'unsafe-inline'"];
  if (maps) style.push(UNPKG);

  // data: للشعارات والمرفقات المخزّنة كـdata URI، وblob: للمعاينة المحلّية.
  const img = ["'self'", 'data:', 'blob:', SUPABASE];
  if (maps) img.push(UNPKG, TILES);

  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    `style-src ${style.join(' ')}`,
    `img-src ${img.join(' ')}`,
    "font-src 'self'",
    `connect-src 'self' ${SUPABASE} ${WS}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ') + ';';
}

export const PAGES = {
  'index.html':               policy(),
  'verify.html':              policy(),
  'admin/index.html':         policy(),
  'teacher/index.html':       policy(),
  'parent/index.html':        policy(),
  'school/index.html':        policy({ jsdelivr: true }),   // ExcelJS
  'ministry/index.html':      policy({ maps: true }),
  'directorate/index.html':   policy({ maps: true, jsdelivr: true }),
  'directorate/school.html':  policy({ maps: true }),
};

const MARK = '<meta http-equiv="Content-Security-Policy"';
// الصفحات تكتب الوسم بصيغتين (‎/>‎ و‎>‎) — نُطابق الاثنتين لا واحدة.
const ANCHOR = /<meta charset="UTF-8"\s*\/?>/i;

function tagFor(csp) {
  return `  <!-- سياسةُ أمن المحتوى — مولَّدةٌ بـtools/build-csp.mjs. لا تُحرَّر يدوياً. -->\n` +
         `  <meta http-equiv="Content-Security-Policy" content="${csp}" />`;
}

/** يُعيد نصَّ الصفحة بعد إدراج الوسم أو تحديثه. */
function applied(html, csp) {
  const tag = tagFor(csp);
  const at = html.indexOf(MARK);
  if (at !== -1) {
    // استبدالُ الوسم القائم مع سطر التعليق الذي يسبقه إن وُجد.
    const lineStart = html.lastIndexOf('\n', at) + 1;
    const end = html.indexOf('/>', at) + 2;
    const before = html.slice(0, lineStart);
    const commentAt = before.lastIndexOf('\n  <!-- سياسةُ أمن المحتوى');
    const cut = commentAt === -1 ? lineStart : commentAt + 1;
    return html.slice(0, cut) + tag + html.slice(end);
  }
  const m = ANCHOR.exec(html);
  if (!m) throw new Error('لا يوجد <meta charset> — تعذّر تحديد موضع الوسم');
  const after = m.index + m[0].length;
  return html.slice(0, after) + '\n' + tag + html.slice(after);
}

/* السياسةُ تُبطَل من داخلها لا من خارجها: <script> سطريٌّ واحدٌ يُضاف بعد سنة
   يُجبر مَن يصلحه على إضافة 'unsafe-inline' فيسقط الحرسُ كلُّه بسطر. وملفٌّ من
   CDN بلا بصمةٍ يُعيدنا إلى الثقة العمياء بطرفٍ ثالث. فيُفحص الأمران هنا. */
function invariants(rel, html) {
  const bad = [];

  const inline = html.match(/<script(?![^>]*\ssrc=)[^>]*>/gi) ?? [];
  const real = inline.filter((t) => !/\stype\s*=\s*["'](application\/(ld\+json)|text\/template)["']/i.test(t));
  if (real.length) {
    bad.push(`${real.length} وسمَ <script> سطريّاً — انقل الشيفرة إلى ملفّ` +
             ` (وإلّا لزم 'unsafe-inline' فبطلت السياسة)`);
  }

  for (const m of html.matchAll(/<(script|link)\b[^>]*\b(?:src|href)=["'](https?:\/\/[^"']+)["'][^>]*>/gi)) {
    if (!/\bintegrity=/i.test(m[0])) bad.push(`مصدرٌ خارجيّ بلا بصمة SRI: ${m[2]}`);
    else if (!/\bcrossorigin=/i.test(m[0])) bad.push(`بصمةٌ بلا crossorigin (تُهمَل): ${m[2]}`);
  }

  return bad.map((b) => `✗ ${rel} — ${b}`);
}

const check = process.argv.includes('--check');
let changed = 0, bad = 0;

for (const rel of Object.keys(PAGES)) {
  for (const line of invariants(rel, readFileSync(join(ROOT, rel), 'utf8'))) {
    console.error(line); bad++;
  }
}

for (const [rel, csp] of Object.entries(PAGES)) {
  const path = join(ROOT, rel);
  const html = readFileSync(path, 'utf8');
  const next = applied(html, csp);
  if (next === html) continue;
  if (check) { console.error(`✗ ${rel} — وسمُ السياسة غائبٌ أو مخالف`); bad++; }
  else { writeFileSync(path, next); console.log(`✔ ${rel}`); changed++; }
}

if (check) {
  if (bad) { console.error(`\n${bad} مخالفةً — شغّل: node tools/build-csp.mjs`); process.exit(1); }
  console.log(`✔ سياسةُ أمن المحتوى وبصماتُ SRI مطابقةٌ في ${Object.keys(PAGES).length} صفحات`);
} else {
  console.log(changed ? `\nحُدّثت ${changed} صفحة` : '\nلا تغيير — السياسة مطابقة');
}
