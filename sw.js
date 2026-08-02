/* NSAMS service worker — offline-first app shell.
 *
 * Strategy:
 *   - Precache the app shell. CRITICAL entries must all succeed or the whole
 *     install is rejected (see below); OPTIONAL entries are best-effort.
 *   - Navigations: network-first, fall back to cache, then to the root shell.
 *   - Other same-origin GETs: stale-while-revalidate (fast + self-updating).
 *   - Cross-origin (Supabase API only) is left to the network. The Supabase
 *     *library* and the fonts used to be cross-origin too — they are vendored
 *     under shared/vendor/ now precisely so this SW can cache them.
 *
 * Bump CACHE on every deploy so old caches are purged on activate.
 */
const CACHE = 'nsams-v126';

/* ⚠️ التقسيم مقصود ويعالج عطلاً حقيقياً.
   كان التثبيت كلّه على Promise.allSettled — يبتلع فشل أي ملفّ ويُعلن النجاح —
   ثمّ يحذف التفعيلُ الكاشات القديمة **بلا شرط**. فإذا ضعف الاتصال أثناء
   التثبيت فشلت بعض الملفّات صمتاً، ثمّ أُعدِم الكاش القديم السليم، فتبقى تلك
   الملفّات مفقودة نهائياً حتى زيارة متّصلة تالية — وهذا ما ولّد أيقونة النسر
   المكسورة عند المستخدم.
   الآن: CRITICAL عبر addAll (ذرّية) — أي فشل يرفض التثبيت، فيبقى العامل
   القديم وكاشه السليم يعملان، ولا يصل التفعيل أصلاً ليحذف شيئاً. */
const CRITICAL = [
  './',
  './index.html',
  './manifest.json',
  './shared/db.js',
  './shared/sw-register.js',
  // مكتبة Supabase محلّية: بدونها لا تُنفَّذ db.js إطلاقاً فلا تعمل أي لوحة.
  './shared/vendor/supabase-js.mjs',
  './shared/vendor/fonts/fonts.css',
  './icons/eagle-mark.png',
  './icons/icon-192.png',
];

const OPTIONAL = [
  './shared/csel.js',
  './shared/qr.js',
  './shared/import-parser.js',
  // قالب البيان الشهري — التصدير يجلبه بـ fetch، فبدون تخزينه
  // مسبقاً لا يعمل «تصدير Excel» دون اتصال.
  './shared/statement_template.xlsx',
  './shared/vendor/fonts/cairo-arabic-200-1000.woff2',
  './shared/vendor/fonts/cairo-latin-200-1000.woff2',
  './shared/vendor/fonts/dm-sans-latin-400-700.woff2',
  './shared/vendor/fonts/tajawal-arabic-400.woff2',
  './shared/vendor/fonts/tajawal-arabic-500.woff2',
  './shared/vendor/fonts/tajawal-arabic-700.woff2',
  './shared/vendor/fonts/tajawal-arabic-800.woff2',
  './shared/vendor/fonts/tajawal-latin-400.woff2',
  './shared/vendor/fonts/tajawal-latin-500.woff2',
  './shared/vendor/fonts/tajawal-latin-700.woff2',
  './shared/vendor/fonts/tajawal-latin-800.woff2',
  './verify.html',
  './verify.js',
  './school/index.html',
  './school/script.js',
  './school/style.css',
  './school/desktop.css',
  './teacher/index.html',
  './teacher/script.js',
  './teacher/style.css',
  './directorate/index.html',
  './directorate/script.js',
  './directorate/style.css',
  './directorate/school.html',
  './ministry/index.html',
  './ministry/script.js',
  './ministry/style.css',
  './admin/index.html',
  './admin/script.js',
  './admin/style.css',
  './parent/index.html',
  './parent/script.js',
  './parent/style.css',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll ذرّية: ترمي عند أوّل فشل → يفشل التثبيت → لا تفعيل ولا حذف
    // للكاش القديم. هذا هو الفرق بين «نسخة ناقصة» و«النسخة السابقة سليمة».
    await cache.addAll(CRITICAL);
    // البقيّة أفضل-جهد: 404 لملفّ ثانوي لا يجوز أن يمنع التحديث كلّه.
    await Promise.allSettled(OPTIONAL.map((url) => cache.add(url)));
    // skipWaiting **بعد** نجاح التخزين لا قبله: استعجال السيطرة قبل اكتمال
    // الكاش هو ما يجعل عامل خدمة نصف-جاهز يخدم صفحات ناقصة.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase / fonts → network

  // HTML navigations: prefer fresh, fall back to cache, then to shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('./index.html'))
        )
    );
    return;
  }

  // Static same-origin assets: serve cache immediately, refresh in background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        // ⚠️ كان `.catch(() => cached)` وحده: حين لا يوجد مخبّأ ولا شبكة
        //    يعود undefined، و respondWith(undefined) يرمي TypeError فيظهر
        //    عطل شبكة خام في الـ console بدل استجابة مفهومة. نُعيد استجابة
        //    صريحة دائماً.
        .catch(() => cached || new Response(
          'غير متوفّر دون اتصال',
          { status: 504, statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        ));
      return cached || network;
    })
  );
});

// Resolve a path against the SW registration scope so notification assets and
// click targets are correct under any deploy base — GitHub Pages serves the app
// under /nsams/, so self.location.origin alone (no /nsams/) would 404.
function appUrl(path) {
  return new URL(path || '', self.registration.scope).href;
}

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'رُقِيّ', {
      body:    data.body || '',
      icon:    appUrl('icons/icon-192.png'),   // colored app icon (large)
      badge:   appUrl('icons/eagle-mark.png'), // transparent silhouette → crisp white badge
      dir:     'rtl',
      lang:    'ar',
      // Alert hints: vibrate + silent:false raise interruptiveness so Android
      // shows a heads-up banner and plays the channel sound; tag + renotify make
      // a re-send about the same thing replace the old one yet still re-alert.
      vibrate: [200, 100, 200],
      silent:  false,
      renotify: true,
      tag:     data.tag || 'nsams',
      requireInteraction: false,
      timestamp: Date.now(),
      // send-push provides `path` (portal folder for the recipient's role); fall
      // back to the app root. `type` is kept for any future finer-grained routing.
      data:    { url: appUrl(data.path || ''), type: data.type || null },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const base   = appUrl('');
  const target = event.notification.data?.url || base;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse an already-open app window; otherwise open a fresh one at the target.
    for (const w of wins) {
      if (w.url.startsWith(base)) {
        await w.focus();
        if ('navigate' in w && w.url !== target) { try { await w.navigate(target); } catch (_) {} }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

// Background Sync — يوقظ الـ client النشط ليُشغّل syncPendingV2
// (الـ SW لا يملك auth session مباشرةً → postMessage → doSync في الواجهة)
self.addEventListener('sync', (event) => {
  if (event.tag === 'nsams-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: false })
        .then((windowClients) => {
          if (windowClients.length > 0) {
            windowClients[0].postMessage({ type: 'BG_SYNC' });
          }
        })
    );
  }
});
