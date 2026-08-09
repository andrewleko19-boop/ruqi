/* Ruqi service worker — offline-first app shell.
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
const CACHE = 'ruqi-v139';

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
  /* ⚠️ حرِج رغم أنّه «طبقة عرض». كل بوّابة تُحمّله بـ<script type="module">، وأوّل
     سطر في initApp هو `await RUQI_PERMISSIONS.init(...)`. فإن لم يُحمَّل الملفّ
     بقي window.RUQI_PERMISSIONS معدوماً، فرمى ذلك السطرُ
     `ReferenceError: RUQI_PERMISSIONS is not defined` التقطه catch في bootstrap
     فأظهر **شاشة الدخول** لمستخدمٍ داخلٍ فعلاً. (فشلُ وحدةٍ لا يمنع تنفيذ
     التالية — لذلك يعمل script.js ويصل إلى السطر الرامي بدل أن يتوقّف قبله.)
     وكان غيابه عن هذه القائمة مستوراً بالتخزين اللحظي: يُخزَّن الملفّ عند أوّل
     جلب ناجح داخل الكاش الجاري، فيعمل أوفلاين صدفةً. لكنّ رفع CACHE يحذف الكاش
     القديم في activate بلا شرط — فذهب الملفّ معه ولم يُعوّضه التخزين المسبق،
     وانكسر الدخول أوفلاين في البوّابات الستّ دفعةً واحدة. */
  './shared/permissions.js',
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
  './icons/favicon-16.png',
  './icons/favicon.ico',
  /* شاشات إقلاع iOS. بدونها يفتح التطبيق المثبّت دون اتصال على بياضٍ صامت
     قبل ظهور القشرة — يبدو معطّلاً. أفضل-جهد عمداً (OPTIONAL لا CRITICAL):
     تجميلٌ لا وظيفة، فلا يجوز أن يمنع فشلُ تنزيل صورةٍ تحديثَ العامل كلَّه. */
  './icons/apple-touch-startup-image-828x1792.png',
  './icons/apple-touch-startup-image-1125x2436.png',
  './icons/apple-touch-startup-image-1170x2532.png',
  './icons/apple-touch-startup-image-1179x2556.png',
  './icons/apple-touch-startup-image-1206x2622.png',
  './icons/apple-touch-startup-image-1284x2778.png',
  './icons/apple-touch-startup-image-1290x2796.png',
  './icons/apple-touch-startup-image-1320x2868.png',
  './icons/apple-touch-startup-image-1536x2048.png',
  './icons/apple-touch-startup-image-1620x2160.png',
  './icons/apple-touch-startup-image-1668x2388.png',
  './icons/apple-touch-startup-image-2048x2732.png',
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

  // HTML navigations: serve the cached shell INSTANTLY, then refresh it in the
  // background (stale-while-revalidate).
  //
  // ⚠️ كان network-first: ينتظر الشبكة ثمّ يسقط للمخبأ. على شبكة «متصلة لكن
  //    ميتة» (راوتر بلا خطّ، واي‑فاي أسير) يتعلّق fetch ثوانيَ طويلة قبل السقوط
  //    فيفتح التطبيق بعد ~15ث أو لا يفتح. cache-first يُلغي هذا الانتظار تماماً؛
  //    ورفعُ CACHE مع مسح activate يمنع بقاء نسخة قديمة أكثر من تحميلة واحدة.
  if (req.mode === 'navigate') {
    const url = new URL(req.url);
    // أفضل قشرة مخبّأة لهذا التنقّل: index.html لمجلّد الطلب (كلّ بوّابة مخزّنة
    // مسبقاً) كي يعمل حتى رابطٌ عميق يُفتَح أوّل مرّة دون اتصال. نبنيه من
    // origin+pathname (بلا query) كي لا يُفسد رابطٌ عميق مثل school/?n=… المفتاحَ.
    const shellPath = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
    const shellUrl  = url.origin + shellPath;
    event.respondWith((async () => {
      const cache  = await caches.open(CACHE);
      const cached = (await cache.match(req))
                  || (await cache.match(shellUrl))
                  || (await cache.match('./index.html'));
      // تحديث في الخلفية لا يحجب الاستجابة إطلاقاً. يعيد دائماً استجابةً صريحة
      // (المخبأ إن وُجد وإلّا رسالة أوفلاين) كي لا يُمرَّر undefined لـrespondWith.
      const network = fetch(req)
        .then((res) => { cache.put(req, res.clone()); return res; })
        .catch(() => cached || new Response(
          'غير متوفّر دون اتصال',
          { status: 504, statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        ));
      return cached || network;
    })());
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
// under /ruqi/, so self.location.origin alone (no /ruqi/) would 404.
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
      tag:     data.tag || 'ruqi',
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

// pushsubscriptionchange — المتصفّح يُدوّر الاشتراك أحياناً (انتهاء صلاحية/تحديث).
// نُعيد الاشتراك بنفس مفتاح VAPID فوراً حتى لا يتوقّف الوصول، ثمّ نُبلّغ أي client
// مفتوح ليحفظ الاشتراك الجديد في Supabase (الحفظ يحتاج جلسة auth لا يملكها الـSW).
const VAPID_PUBLIC_KEY = 'BJPKEruYPsOjR7X34522QTExr7FNilujlkD1SHgR7vWAGFswsWSnFrezgA5yQvP3gQdu_j54t20UFiR9IS4YnUw';
function vapidKeyBytes(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyBytes(VAPID_PUBLIC_KEY),
      });
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) w.postMessage({ type: 'PUSH_RESUBSCRIBED', subscription: sub.toJSON() });
    } catch (e) { /* الجهاز سيُعيد الاشتراك عند فتح التطبيق تالياً عبر initPushPrompt */ }
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
