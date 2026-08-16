// سلوكُ الصفحة الرئيسة: شارةُ الانقطاع وزرُّ تثبيت التطبيق.
// نُقل من <script> داخل index.html ليصحّ منعُ التنفيذ السطريّ في CSP:
// script-src بلا 'unsafe-inline' هو الفرق بين ثغرةِ حقنٍ تُنفَّذ وأخرى تُرَدّ.
(function () {
  'use strict';

  /* ── حالة الاتصال ────────────────────────────────────────────────────
     صامتة تماماً عند وجود اتصال — الشارة تظهر عند الانقطاع وحده. */
  var offlinePill = document.getElementById('pill-offline');
  function syncOnline() { offlinePill.hidden = navigator.onLine; }
  window.addEventListener('online',  syncOnline);
  window.addEventListener('offline', syncOnline);
  syncOnline();

  /* ── زرّ التثبيت ─────────────────────────────────────────────────────
     يظهر فقط حين يُعلن المتصفّح أنّ التثبيت متاح، ويختفي فور التثبيت.
     على iOS لا يوجد هذا الحدث إطلاقاً فيبقى الزرّ مخفيّاً — وهو الصواب:
     زرّ لا يفعل شيئاً أسوأ من غيابه. */
  var installEvt = null;
  var btnInstall = document.getElementById('btn-install');

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvt = e;
    btnInstall.hidden = false;
  });

  btnInstall.addEventListener('click', function () {
    if (!installEvt) return;
    installEvt.prompt();
    installEvt.userChoice.finally(function () {
      installEvt = null;
      btnInstall.hidden = true;
    });
  });

  window.addEventListener('appinstalled', function () {
    installEvt = null;
    btnInstall.hidden = true;
  });

  /* ── الخريطة ─────────────────────────────────────────────────────────
     حدود سورية مبسّطة ونقاط المحافظات الأربع عشرة. الإحداثيات جغرافية
     حقيقية (طول/عرض) وتُسقَط على اللوحة، فالمواقع النسبية صحيحة لا تزيينية.
     Canvas لا SVG: الرسم يُعاد عند تغيّر الأبعاد وكثافة البكسل، والنبض
     حلقة واحدة تنتهي — لا حركة دائمة تسرق الانتباه. */
  var cv = document.getElementById('syria-map');
  var ctx = cv && cv.getContext ? cv.getContext('2d') : null;
  if (!ctx) return;

  /* حدود سورية الحقيقية — لا رسم تقديري باليد.
     مصدرها Natural Earth (ne_10m_admin_0_countries، ISO_A3 = SYR): ٥٩١ نقطة
     بُسِّطت بخوارزمية Douglas–Peucker عند ε=٠٫٠٢٥ → ٩٨ نقطة. اختيرت هذه
     العتبة تحديداً لأنّها أدنى دقّة تبقى فيها المحافظات الأربع عشرة كلّها
     **داخل** الحدّ؛ عند ٠٫٠٣ يقصّ التبسيط الساحل والزاوية الجنوبية الغربية
     فتخرج اللاذقية والقنيطرة. النسختان السابقتان (١٨ ثم ٢٦ نقطة) كانتا
     مكتوبتين بالتقدير فلم تكن الحدود حدود سورية أصلاً. */
  var OUTLINE = [
    [35.758,32.744],[35.888,32.945],[35.849,33.099],[35.811,33.112],[35.83,33.19],[35.769,33.273],
    [35.802,33.312],[35.764,33.334],[35.919,33.462],[35.933,33.528],[36.035,33.568],[35.922,33.64],
    [35.948,33.709],[36.05,33.816],[36.138,33.851],[36.358,33.824],[36.368,33.858],[36.269,33.907],
    [36.289,33.947],[36.391,34.045],[36.475,34.054],[36.604,34.199],[36.563,34.263],[36.582,34.3],
    [36.519,34.354],[36.525,34.423],[36.433,34.494],[36.32,34.514],[36.44,34.629],[36.368,34.629],
    [36.309,34.688],[36.262,34.627],[35.97,34.65],[35.867,34.924],[35.888,35.109],[35.962,35.198],
    [35.915,35.288],[35.919,35.418],[35.818,35.509],[35.771,35.504],[35.778,35.541],[35.723,35.582],
    [35.778,35.613],[35.771,35.668],[35.84,35.747],[35.799,35.85],[35.871,35.852],[35.911,35.918],
    [35.98,35.927],[36.004,35.869],[36.158,35.823],[36.197,35.952],[36.358,35.994],[36.373,36.228],
    [36.451,36.2],[36.664,36.229],[36.649,36.306],[36.578,36.333],[36.593,36.373],[36.531,36.479],
    [36.64,36.828],[36.965,36.754],[37.053,36.62],[37.242,36.659],[37.446,36.634],[38.224,36.908],
    [38.48,36.856],[38.725,36.694],[39.032,36.701],[39.24,36.661],[39.765,36.742],[40.709,37.1],
    [40.896,37.123],[41.201,37.065],[41.48,37.076],[42.009,37.176],[42.211,37.325],[42.347,37.24],
    [42.377,37.062],[41.844,36.618],[41.385,36.516],[41.277,36.355],[41.237,36.06],[41.355,35.826],
    [41.364,35.655],[41.261,35.494],[41.201,35.243],[41.204,34.793],[40.965,34.402],[40.69,34.331],
    [38.775,33.372],[36.819,32.317],[36.388,32.379],[36.177,32.527],[36.066,32.517],[36.004,32.655],
    [35.944,32.691],[35.758,32.744]
  ];
  // مراكز المحافظات الأربع عشرة بإحداثياتها الفعلية. صُحِّح منها ما كان
  // منزاحاً: الرقّة (كانت 38.79,36.53) والحسكة (كانت 40.14,36.66) ودير الزور
  // والقنيطرة (كانت 36.10,33.25).
  var CITIES = [
    [36.292,33.513],  // دمشق
    [36.402,33.572],  // ريف دمشق
    [37.161,36.202],  // حلب
    [36.723,34.731],  // حمص
    [36.753,35.132],  // حماة
    [35.783,35.531],  // اللاذقية
    [35.886,34.889],  // طرطوس
    [36.634,35.931],  // إدلب
    [40.140,35.336],  // دير الزور
    [40.748,36.503],  // الحسكة
    [39.009,35.951],  // الرقّة
    [36.101,32.618],  // درعا
    [36.570,32.709],  // السويداء
    [35.824,33.126]   // القنيطرة
  ];

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* الحدود تُشتقّ من البيانات لا تُكتب يدوياً: قيمة مكتوبة تنفصل عن المصفوفة
     عند أي تعديل لاحق فتُقصّ نقاط عند الحافة — وهو العطل نفسه الذي ظهر سابقاً. */
  var lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  OUTLINE.forEach(function (p) {
    if (p[0] < lonMin) lonMin = p[0];
    if (p[0] > lonMax) lonMax = p[0];
    if (p[1] < latMin) latMin = p[1];
    if (p[1] > latMax) latMax = p[1];
  });
  // خط العرض الوسطي لتصحيح جيب-تمام تقارب خطوط الطول — بدونه يُمدَّد
  // العرض أفقياً فيبدو الشكل مسطّحاً لا كسورية الحقيقية.
  var latMid  = (latMin + latMax) / 2;
  var cosLat  = Math.cos(latMid * Math.PI / 180);
  var W = 0, H = 0, pad = 16;
  var scale = 1, offX = 0, offY = 0;

  function project(lon, lat) {
    // RTL لا يقلب الجغرافيا: الشرق يبقى يميناً.
    var x = offX + (lon - lonMin) * cosLat * scale;
    var y = offY + (latMax - lat) * scale;
    return [x, y];
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    if (!W || !H) return false;
    cv.width  = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // مقياس واحد لا اثنان منفصلان للعرض والارتفاع — هذا ما كان يُمدِّد
    // الشكل ليملأ صندوقاً بنسبة أبعاد مختلفة عن نسبة سورية الحقيقية.
    // الفائض من أيّ بُعد يُوزَّع هامشاً متساوياً فيبقى الشكل مُوسَّطاً.
    var availW = W - pad * 2, availH = H - pad * 2;
    var lonSpan = (lonMax - lonMin) * cosLat;
    var latSpan = latMax - latMin;
    scale = Math.min(availW / lonSpan, availH / latSpan);
    offX  = pad + (availW - lonSpan * scale) / 2;
    offY  = pad + (availH - latSpan * scale) / 2;
    return true;
  }

  var start = null;
  function draw(ts) {
    if (start === null) start = ts;
    var t = (ts - start) / 1000;
    ctx.clearRect(0, 0, W, H);

    // الحدود
    ctx.beginPath();
    OUTLINE.forEach(function (p, i) {
      var q = project(p[0], p[1]);
      if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
    });
    ctx.closePath();
    ctx.fillStyle   = 'rgba(53,179,172,0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(53,179,172,0.42)';
    ctx.lineWidth   = 1.1;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // المحافظات — تضيء بالتتابع مرّة واحدة ثم تستقرّ
    CITIES.forEach(function (c, i) {
      var q  = project(c[0], c[1]);
      var at = 0.35 + i * 0.13;                       // لحظة إضاءة هذه النقطة
      var k  = reduced ? 1 : Math.max(0, Math.min(1, (t - at) / 0.55));
      if (k <= 0) return;
      var ease = 1 - Math.pow(1 - k, 3);

      if (!reduced && k < 1) {                        // حلقة تتّسع وتتلاشى
        ctx.beginPath();
        ctx.arc(q[0], q[1], 2 + ease * 9, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(212,162,78,' + (0.5 * (1 - ease)) + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(q[0], q[1], 2.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(212,162,78,' + (0.9 * ease) + ')';
      ctx.fill();
    });

    // تنتهي الحلقة بعد آخر نقطة — لا رسم دائم في الخلفية.
    if (!reduced && t < 0.35 + CITIES.length * 0.13 + 0.7) requestAnimationFrame(draw);
  }

  function render() { if (resize()) { start = null; requestAnimationFrame(draw); } }
  render();

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(render, 160);
  });
})();
