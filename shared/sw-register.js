/* NSAMS — تسجيل عامل الخدمة، مشترك بين صفحة الدخول الرئيسية والبوّابات.
 *
 * ⚠️ لماذا وُجد هذا الملفّ: كان التسجيل داخل shared/db.js وحده — وهو ملفّ
 * **لا تُحمّله الصفحة الرئيسية إطلاقاً** (كانت بلا أي <script>). فمن كانت
 * زيارته الأولى للتطبيق هي الصفحة الرئيسية لا يُثبَّت عنده عامل خدمة ولا
 * يُخبَّأ شيء، ودون اتصال يرى صفحة المتصفّح «لا يوجد اتصال» بدل التطبيق —
 * في تطبيق مبنيّ كلّه على العمل دون اتصال.
 *
 * سكربت كلاسيكي لا وحدة ES: الصفحة الرئيسية صفحة ثابتة بلا نظام وحدات،
 * وتحميله بـ<script defer> أبسط وأسرع من إدخالها في سلسلة الوحدات.
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  if (window.__nsamsSwRegistered) return;      // db.js والصفحة قد يستدعيانه معاً
  window.__nsamsSwRegistered = true;

  // المسار نسبيّ لجذر النشر لا لأصل النطاق: التطبيق يُنشَر على GitHub Pages
  // تحت مسار فرعي (‎/nsams/‎)، فمسار مطلق يُخطئ الملفّ ويُخطئ النطاق معاً.
  var here  = document.currentScript && document.currentScript.src;
  var swUrl = here ? new URL('../sw.js', here).href : '/sw.js';

  var lastCheck = 0;
  navigator.serviceWorker.register(swUrl).then(function (reg) {
    // تطبيق مثبَّت يُستأنف من قائمة التطبيقات الأخيرة لا يُنقَل فيه شيء، فلا
    // يفحص المتصفّح التحديث من تلقائه وقد يبقى إصلاح منشور غير مرئي. نطلبه
    // صراحةً: عند الإقلاع، وكلّما عاد التطبيق للمقدّمة (مع خنق لأن الحدث كثير).
    function checkForUpdate() {
      if (Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now();
      reg.update().catch(function () {});
    }
    checkForUpdate();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
  }).catch(function (err) {
    console.warn('[NSAMS] SW registration failed', err);
  });

  // sw.js يستدعي skipWaiting() وclients.claim()، فيتولّى عاملٌ جديد صفحةً حيّة.
  // نُعيد التحميل مرّة واحدة كي تعمل الصفحة بالـHTML/JS الجديدين لا بقشرة
  // قديمة مقرونة بعامل جديد.
  var hadController = !!navigator.serviceWorker.controller;
  var reloading     = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController || reloading) return;   // أوّل تثبيت: لا شيء قديم
    // لا يُهدَر عمل جارٍ (كشف حضور نصف مُدخَل، علامات غير محفوظة).
    if (typeof window.nsamsHasUnsavedWork === 'function' && window.nsamsHasUnsavedWork()) return;
    reloading = true;
    location.reload();
  });
})();
