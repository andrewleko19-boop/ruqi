// ─────────────────────────────────────────────────────────────────────────────
//  فحصٌ دخانيّ: تُفتَح كلّ بوّابة في متصفّحٍ حقيقيّ ويُشترَط ألّا تُخطئ.
//
//  لماذا وُجد: ثلاث عللٍ في هذه الجلسة وحدها شُحنت خضراءَ في CI ثمّ انكسرت
//  عند المستخدم، وكلّها من عائلةٍ واحدة لا يراها فحصٌ نصّيّ ولا اختبارُ وحدة:
//
//    • STAFF_TYPE_AR is not defined — نُسخت كتلةٌ من بوّابة إلى أخرى وتُرك
//      تعريفُ ثابتٍ خلفها. الملفّ يُحلَّل نحوياً بلا شكوى، والاختبارات تستخرج
//      التوابع نصّياً فتحقنه بنفسها، فلا يظهر النقص إلا حين يُنفَّذ الملفّ كلّه.
//    • جدولٌ بلا class فيرث سلوك المتصفّح الافتراضي — لا خطأ، فقط قبحٌ صامت.
//    • toLocaleString بلا لغة — سليمٌ في عقدة CI (لغة C) وخاطئٌ عند العربيّ.
//
//  المشترك بينها أنّها لا تُكتشف إلا بتحميل الصفحة فعلاً. فهذا ما يفعله هذا
//  الملفّ: يفتح كلّ بوّابة، ويرصد أخطاء الـconsole وأخطاء الصفحة، ويتحقّق أنّ
//  عناصر المفاتيح موجودة — ثمّ يفشل بصوتٍ عالٍ إن أخطأت واحدة.
//
//  ما لا يفعله: لا يسجّل الدخول ولا يلمس القاعدة. أخطاء الشبكة إلى Supabase
//  متوقَّعةٌ بلا جلسة، فتُستثنى صراحةً — وإلّا صار الفحص ضجيجاً يُعطَّل.
// ─────────────────────────────────────────────────────────────────────────────
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT || 8791);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** خادمٌ ساكن بسيط — أخفّ من إحضار حزمةٍ لأجل فحص. */
function serve() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      try {
        // normalize يمنع الخروج من الجذر عبر ../ في مسارٍ ملفّق.
        let p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
        if (p.endsWith('/')) p += 'index.html';
        const full = join(ROOT, p);
        if (!full.startsWith(ROOT)) { res.writeHead(403).end(); return; }
        const s = await stat(full);
        if (s.isDirectory()) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[extname(full)] ?? 'application/octet-stream' });
        res.end(await readFile(full));
      } catch { res.writeHead(404).end('not found'); }
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

/* أخطاءٌ متوقَّعة بلا جلسةٍ ولا شبكةٍ خارجية. تُستثنى بدقّة: استثناءٌ فضفاض
   يبتلع العلّة التي جاء الفحص لأجلها. */
const EXPECTED = [
  /Failed to load resource/i, /net::/i, /ERR_(INTERNET|NAME|CONNECTION|NETWORK)/i,
  /supabase/i, /Failed to fetch/i, /NetworkError/i,
  /manifest/i, /favicon/i, /service ?worker/i,
  /Leaflet|chart\.js/i,
];
const isExpected = (m) => EXPECTED.some((re) => re.test(m));

/** البوّابات وعناصرُ المفاتيح التي يجب أن توجد في كلٍّ منها. */
const PORTALS = [
  ['الجذر',      '/',             []],
  ['المدرسة',    '/school/',      ['screen-login', 'view-attendance', 'asn-start-d', 'sr-seniority-d']],
  ['المعلّم',     '/teacher/',     ['screen-login']],
  ['المديرية',   '/directorate/', ['login-screen', 'dir-tab-overview', 'struct-grid', 'sdir-tbody']],
  ['الوزارة',    '/ministry/',    ['login-screen', 'dashboard', 'struct-grid', 'msdir-tbody', 'govcmp-tbody']],
  ['المشرف',     '/admin/',       ['login-screen']],
  ['وليّ الأمر',  '/parent/',      []],
  ['التحقّق',     '/verify.html',  []],
];

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m';

async function main() {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch {
    try { ({ chromium } = (await import('/opt/node22/lib/node_modules/playwright/index.js')).default
                       ?? await import('/opt/node22/lib/node_modules/playwright/index.js')); }
    catch {
      console.error(`${RED}✗ playwright غير متاح — لا يمكن تشغيل الفحص الدخانيّ${RESET}`);
      process.exit(1);
    }
  }

  const srv = await serve();
  const launch = { args: ['--no-sandbox'] };
  if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
  const browser = await chromium.launch(launch);

  let failures = 0;
  // العربية عمداً: العلّة التي أفلتت (أرقام عربية-هندية) لا تظهر بلغة C.
  const ctx = await browser.newContext({ locale: 'ar-SY', viewport: { width: 1280, height: 900 } });

  /* كلُّ ما هو خارج الخادم المحلّيّ يُقطع فوراً. الفحصُ يسأل «هل تُحمَّل شيفرتُنا
     بلا خطأ؟» لا «هل unpkg يعمل الآن؟». وقبل هذا القطع كان جوابُه يتبدّل بحال
     الشبكة: حين يتأخّر الردُّ من الـCDN لا يبلغ networkidle فتسقط بوّابتا
     الخرائط بمهلةٍ منتهية — سقوطٌ لا علاقةَ له بشيفرة المستودع. */
  await ctx.route('**/*', (route) =>
    route.request().url().startsWith(`http://127.0.0.1:${PORT}`)
      ? route.continue()
      : route.abort());

  for (const [name, path, mustExist] of PORTALS) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });

    try {
      await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: 'networkidle', timeout: 20000 });
      // مهلةٌ قصيرة: الوحدات تُحمَّل بعد networkidle أحياناً، وخطأُ وحدةٍ
      // يظهر عند تنفيذها لا عند جلبها.
      await page.waitForTimeout(700);

      const missing = mustExist.length
        ? await page.evaluate((ids) => ids.filter((id) => !document.getElementById(id)), mustExist)
        : [];

      const real = errs.filter((e) => !isExpected(e));
      if (real.length || missing.length) {
        failures++;
        console.log(`${RED}✗ ${name}${RESET} ${DIM}(${path})${RESET}`);
        for (const e of real.slice(0, 5))  console.log(`   ${RED}خطأ:${RESET} ${e.slice(0, 160)}`);
        if (missing.length) console.log(`   ${RED}عناصر مفقودة:${RESET} ${missing.join(', ')}`);
      } else {
        console.log(`${GREEN}✓ ${name}${RESET} ${DIM}(${path})${RESET}`);
      }
    } catch (e) {
      failures++;
      console.log(`${RED}✗ ${name} — تعذّر التحميل:${RESET} ${String(e.message).slice(0, 140)}`);
    }
    await page.close();
  }

  await browser.close();
  srv.close();

  console.log(failures
    ? `\n${RED}${failures} بوّابة أخطأت${RESET}`
    : `\n${GREEN}كل البوّابات تُحمَّل بلا أخطاء${RESET}`);
  process.exit(failures ? 1 : 0);
}

main();
