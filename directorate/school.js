// directorate/school.js — صفحة ملف المدرسة (drill-down من لوحة المديرية)
// الجلسة مشتركة مع اللوحة (LAYER يُكتشف من مقطع المسار /directorate/)
import { StatDrill } from '../shared/stat-drill.js';
import { fmtDateShort, fmtDateLong, fmtDateTime } from '../shared/date-format.js';

if (!window.RUQI_DB) {
  document.body.innerHTML =
    '<p style="padding:24px;color:#e2685a;font-family:sans-serif;direction:rtl">' +
    'خطأ: تعذّر تحميل طبقة البيانات. تأكد من تضمين shared/db.js قبل هذا الملف.</p>';
  throw new Error('window.RUQI_DB is not defined');
}
const {
  logout,
  getCurrentUser,
  getSchoolById,
  getSchoolTrend,
  getDirectorateCompliance,
  getReportsForDirectorate,
  resolveReportPhotos,
  localDateISO,
} = window.RUQI_DB;

function todayLocalISO() {
  if (typeof localDateISO === 'function') return localDateISO();
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ══════════════════════════════════════════════
//  State
// ══════════════════════════════════════════════
const schoolId = new URLSearchParams(location.search).get('id');
let currentUser   = null;
let school        = null;
let trendDays     = 30;
let lightboxState = { urls: [], idx: 0 };
let refreshTimer;
let countdownInterval;
const charts = {};
const REFRESH_INTERVAL = 60;

const SEV = {
  1: { label: 'منخفض', cls: 'sev-1' },
  2: { label: 'متوسط', cls: 'sev-2' },
  3: { label: 'مرتفع', cls: 'sev-3' },
  4: { label: 'شديد',  cls: 'sev-4' },
  5: { label: 'حرج',   cls: 'sev-5' },
};

// ══════════════════════════════════════════════
//  Bootstrap
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  setNavDate();

  if (!schoolId) { showGuard('معرّف المدرسة مفقود في الرابط.'); return; }

  let session;
  try { session = await getCurrentUser(); } catch { session = null; }
  if (!session || session.role !== 'directorate_user') {
    showGuard('هذه الصفحة لموظفي المديرية فقط — يرجى تسجيل الدخول من اللوحة.');
    return;
  }
  currentUser = session;

  try {
    school = await getSchoolById(schoolId);
  } catch {
    showGuard('المدرسة غير موجودة أو خارج نطاق مديريتك.');
    return;
  }
  if (!school || school.directorate_id !== currentUser.directorateId) {
    showGuard('المدرسة خارج نطاق مديريتك.');
    return;
  }

  showApp();
  await loadAll();
  startAutoRefresh();
});

function showGuard(msg) {
  const msgEl  = document.getElementById('guard-msg');
  const linkEl = document.getElementById('guard-link');
  if (msgEl)  msgEl.textContent = msg;
  if (linkEl) linkEl.hidden = false;
}

function showApp() {
  document.getElementById('guard-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('nav-user').textContent =
    currentUser.user?.fullName || currentUser.user?.email || '';

  renderIdentity();
  renderMiniMap();
  setupLogout();
  setupManualRefresh();
  setupTrendPeriod();
  setupLightbox();
  setupReportPhotoDelegation();
}

function setupLogout() {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    clearAutoRefresh();
    try { await logout(); } finally { window.location.href = 'index.html'; }
  });
}

// ══════════════════════════════════════════════
//  Identity
// ══════════════════════════════════════════════
// المفتاح القديم middle_high مُبقًى عمداً: لو لم تُشغَّل §25 بعد على قاعدة ما،
// تظهر التسمية الصحيحة بدل السلسلة الإنكليزية الخام.
const SCHOOL_TYPE_AR = {
  primary:     'ابتدائي',
  preparatory: 'إعدادي',
  secondary:   'ثانوي',
  middle_high: 'إعدادي / ثانوي',
};
const SHIFT_AR       = { morning: 'صباحي', evening: 'مسائي' };

function renderIdentity() {
  document.getElementById('school-name').textContent = school.name ?? '—';
  document.title = `رُقِيّ – ${school.name ?? 'ملف المدرسة'}`;

  const chips = [];
  if (school.school_type)    chips.push(SCHOOL_TYPE_AR[school.school_type] ?? school.school_type);
  if (school.shift)          chips.push(`دوام ${SHIFT_AR[school.shift] ?? school.shift}`);
  if (school.education_type) chips.push(school.education_type);
  if (school.student_type)   chips.push(school.student_type);
  if (school.classification) chips.push(school.classification);
  if (school.complex_name)   chips.push(`مجمع ${school.complex_name}`);
  if (Number.isFinite(school.total_teachers)) chips.push(`المعلمون: ${school.total_teachers}`);
  if (Number.isFinite(school.total_students)) chips.push(`الطلاب: ${school.total_students}`);

  document.getElementById('school-chips').innerHTML =
    chips.map(c => `<span class="chip">${esc(String(c))}</span>`).join('');
}

function renderMiniMap() {
  const panel = document.getElementById('school-map-panel');
  if (!school.lat || !school.lng) { panel?.classList.add('hidden'); return; }
  if (typeof L === 'undefined') { panel?.classList.add('hidden'); return; }
  const miniMap = L.map('school-mini-map', { zoomControl: false, scrollWheelZoom: false })
    .setView([school.lat, school.lng], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
  }).addTo(miniMap);
  L.marker([school.lat, school.lng]).addTo(miniMap);
}

// ══════════════════════════════════════════════
//  Chart.js — dark/RTL (نفس اصطلاحات اللوحة)
// ══════════════════════════════════════════════
const CHART_FONT = "'Segoe UI', system-ui, sans-serif";
const CH = {
  grid:      '#202a48',
  tick:      '#75809c',
  tooltipBg: '#0b1120',
  green: '#3fbd80', blue: '#35b3ac', amber: '#e0a83f', red: '#e2685a', purple: '#a78bfa',
};

function chartBaseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        rtl: true,
        labels: { color: CH.tick, font: { family: CHART_FONT, size: 12 }, usePointStyle: true, boxWidth: 8 },
      },
      tooltip: {
        rtl: true, textDirection: 'rtl',
        backgroundColor: CH.tooltipBg, borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1,
        titleColor: '#eef1f8', bodyColor: '#aab3c8', padding: 10,
        titleFont: { family: CHART_FONT }, bodyFont: { family: CHART_FONT },
      },
    },
    scales: {
      x: { grid: { color: CH.grid, drawTicks: false }, ticks: { color: CH.tick, font: { family: CHART_FONT, size: 11 }, maxRotation: 0, autoSkip: true } },
      y: { beginAtZero: true, grid: { color: CH.grid, drawTicks: false }, ticks: { color: CH.tick, font: { family: CHART_FONT, size: 11 } } },
    },
  };
}

function upsertChart(holder, key, canvasId, configFactory, labels, datasetsData) {
  if (typeof Chart === 'undefined') return null;
  const existing = holder[key];
  if (existing) {
    existing.data.labels = labels;
    existing.data.datasets.forEach((ds, i) => { ds.data = datasetsData[i]; });
    existing.update();
    return existing;
  }
  const el = document.getElementById(canvasId);
  if (!el) return null;
  holder[key] = new Chart(el.getContext('2d'), configFactory(labels, datasetsData));
  return holder[key];
}

const trendLabel = (isoDay) => fmtDateShort(isoDay);

function rateLineConfig(labels, datasetsData) {
  const opts = chartBaseOptions();
  opts.scales.y.suggestedMax = 100;
  opts.scales.y.ticks.callback = (v) => v + '%';
  opts.plugins.tooltip.callbacks = {
    label: (ctx) => ` نسبة الحضور: ${ctx.parsed.y !== null ? ctx.parsed.y + '%' : '—'}`,
  };
  return {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'نسبة الحضور',
        data: datasetsData[0],
        borderColor: CH.blue,
        backgroundColor: 'rgba(53,179,172,0.18)',
        fill: true,
        tension: 0.35,
        spanGaps: false,
        pointRadius: 3,
        pointBackgroundColor: CH.blue,
      }],
    },
    options: opts,
  };
}

function stackBarConfig(labels, datasetsData) {
  const opts = chartBaseOptions();
  opts.scales.x.stacked = true;
  opts.scales.y.stacked = true;
  const mk = (label, color, data) => ({
    label, data, backgroundColor: color, borderRadius: 3, maxBarThickness: 26,
  });
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        mk('حاضر',  CH.green,  datasetsData[0]),
        mk('متأخر', CH.amber,  datasetsData[1]),
        mk('مُجاز', CH.purple, datasetsData[2]),
        mk('غائب',  CH.red,    datasetsData[3]),
      ],
    },
    options: opts,
  };
}

// ══════════════════════════════════════════════
//  Trend + today cards
// ══════════════════════════════════════════════
async function loadTrendAndToday() {
  const emptyEl = document.getElementById('trend-empty');
  try {
    const rows = await getSchoolTrend(schoolId, trendDays);
    const hasData = rows.some(r => (r.present + r.late + r.absent + r.excused) > 0);
    if (emptyEl) {
      // الـ RPC يعمل — الفراغ هنا يعني فترة بلا تسجيل، لا قسماً ناقصاً
      emptyEl.textContent = 'لا يوجد حضور مسجّل لهذه المدرسة خلال هذه الفترة.';
      emptyEl.hidden = hasData;
    }

    const labels = rows.map(r => trendLabel(r.day));
    const rates  = rows.map(r => {
      const en = r.present + r.late + r.absent + r.excused;
      return en ? +(((r.present + r.late + r.excused) / en) * 100).toFixed(1) : null;
    });

    upsertChart(charts, 'rate', 'school-rate-chart', rateLineConfig, labels, [rates]);
    upsertChart(charts, 'stack', 'school-stack-chart', stackBarConfig, labels, [
      rows.map(r => r.present),
      rows.map(r => r.late),
      rows.map(r => r.excused),
      rows.map(r => r.absent),
    ]);

    renderTodayCards(rows);
  } catch (err) {
    console.warn('[SchoolTrend] RPC unavailable:', err);
    if (emptyEl) {
      emptyEl.textContent = 'تعذّر جلب الاتجاه — تأكد من تشغيل القسم 7 من database-setup.sql.';
      emptyEl.hidden = false;
    }
  }
}

function renderTodayCards(rows) {
  const last    = rows[rows.length - 1];
  const isToday = last && last.day === todayLocalISO();
  const enrolled = isToday ? (last.present + last.late + last.absent + last.excused) : 0;
  const note     = document.getElementById('today-note');

  if (!isToday || enrolled === 0) {
    ['today-present-val', 'today-late-val', 'today-excused-val', 'today-absent-val', 'today-rate-val']
      .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
    if (note) note.textContent = 'لم تُسجّل المدرسة حضور اليوم';
    return;
  }

  animateValue(document.getElementById('today-present-val'), last.present);
  animateValue(document.getElementById('today-late-val'),    last.late);
  animateValue(document.getElementById('today-excused-val'), last.excused);
  animateValue(document.getElementById('today-absent-val'),  last.absent);
  const rate = ((last.present + last.late + last.excused) / enrolled * 100).toFixed(1);
  const rateEl = document.getElementById('today-rate-val');
  if (rateEl) rateEl.textContent = rate + '%';
  if (note) note.textContent = `من أصل ${enrolled} طالباً مسجلاً اليوم`;
}

// ══════════════════════════════════════════════
//  Compliance (30 يوماً)
// ══════════════════════════════════════════════
async function countWorkingDays(daysBack) {
  let count = 0;
  const d = new Date();
  let holidays = new Set();
  try {
    const rows = await window.RUQI_DB.getHolidays();
    holidays = new Set(rows.map(h => h.date));
  } catch { /* fallback: no holidays */ }
  for (let i = 1; i <= daysBack; i++) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay(); // 0=Sun … 5=Fri 6=Sat
    const iso = localDateISO(d);
    if (dow !== 5 && dow !== 6 && !holidays.has(iso)) count++;
  }
  return count;
}

async function loadCompliance() {
  try {
    const compliance = await getDirectorateCompliance(30);
    const mine = (compliance || []).find(c => c.school_id === schoolId);
    const workingDays = await countWorkingDays(30);
    const days = mine?.days_reported ?? 0;
    const pct  = workingDays ? Math.min(100, Math.round((days / workingDays) * 100)) : 0;

    document.getElementById('comp-days').textContent  = days;
    document.getElementById('comp-total').textContent = workingDays;
    document.getElementById('comp-pct').textContent   = pct + '%';
    const bar = document.getElementById('comp-bar');
    if (bar) {
      bar.style.width = pct + '%';
      bar.classList.toggle('pct-warn', pct < 80 && pct >= 50);
      bar.classList.toggle('pct-low',  pct < 50);
    }
    const todayEl = document.getElementById('comp-today');
    if (todayEl) {
      todayEl.textContent = mine?.reported_today
        ? '✓ أرسلت حضور اليوم'
        : 'لم تُرسل حضور اليوم بعد';
    }
  } catch (err) {
    console.warn('[SchoolCompliance] RPC unavailable:', err);
  }
}

// ══════════════════════════════════════════════
//  Reports (قراءة فقط)
// ══════════════════════════════════════════════
let schoolReports = [];

async function loadReports() {
  const tbody = document.getElementById('school-reports-tbody');
  try {
    const all = await getReportsForDirectorate(currentUser.directorateId);
    schoolReports = (all || []).filter(r => r.school?.id === schoolId);
  } catch (err) {
    console.error('[SchoolReports]', err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty-state">تعذّر تحميل البلاغات.</td></tr>';
    return;
  }

  const countEl = document.getElementById('school-reports-count');
  if (countEl) countEl.textContent = schoolReports.length;

  if (!tbody) return;
  if (schoolReports.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">لا توجد بلاغات من هذه المدرسة.</td></tr>';
    return;
  }

  tbody.innerHTML = schoolReports.map(r => `
    <tr data-id="${esc(r.id)}">
      <td><span class="type-badge type-${esc(r.type)}">${esc(formatType(r.type))}</span></td>
      <td>${sevBadge(r.severity)}</td>
      <td class="td-desc" title="${esc(r.description ?? '')}">${esc(r.description ?? '—')}</td>
      <td>${esc(formatDate(r.created_at))}</td>
      <td><span class="status-badge status-${esc(r.status)}">${esc(formatStatus(r.status))}</span></td>
      <td>${photoBtn(r)}</td>
    </tr>`).join('');
}

function sevBadge(sev) {
  const s = SEV[sev];
  if (!s) return '<span class="sev-badge sev-none">—</span>';
  return `<span class="sev-badge ${s.cls}">${s.label}</span>`;
}

function photoBtn(r) {
  const urls = Array.isArray(r.media_urls) ? r.media_urls.filter(Boolean) : [];
  if (urls.length === 0) return '—';
  return `<button class="btn btn-ghost btn-sm" data-action="photos" data-id="${esc(r.id)}">📷 ${urls.length}</button>`;
}

function setupReportPhotoDelegation() {
  document.getElementById('school-reports-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="photos"]');
    if (!btn) return;
    const report = schoolReports.find(r => r.id === btn.dataset.id);
    const urls = Array.isArray(report?.media_urls) ? report.media_urls.filter(Boolean) : [];
    if (urls.length > 0) {
      resolveReportPhotos(urls).then(resolved => { if (resolved.length) openLightbox(resolved, 0); });
    }
  });
}

// ══════════════════════════════════════════════
//  Lightbox (نسخة اللوحة — RTL)
// ══════════════════════════════════════════════
function setupLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;

  document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });

  // RTL: ArrowRight = السابق، ArrowLeft = التالي
  document.addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'Escape')     { closeLightbox(); return; }
    if (e.key === 'ArrowRight') { moveLightbox(-1); return; }
    if (e.key === 'ArrowLeft')  { moveLightbox(+1); return; }
  });

  document.getElementById('lightbox-prev')?.addEventListener('click', () => moveLightbox(-1));
  document.getElementById('lightbox-next')?.addEventListener('click', () => moveLightbox(+1));
}

function openLightbox(urls, idx) {
  lightboxState = { urls, idx };
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.hidden = false;
  updateLightboxFrame();
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb) lb.hidden = true;
}

function moveLightbox(delta) {
  const { urls, idx } = lightboxState;
  if (!urls.length) return;
  lightboxState.idx = (idx + delta + urls.length) % urls.length;
  updateLightboxFrame();
}

function updateLightboxFrame() {
  const { urls, idx } = lightboxState;
  const img     = document.getElementById('lightbox-img');
  const counter = document.getElementById('lightbox-counter');
  const prev    = document.getElementById('lightbox-prev');
  const next    = document.getElementById('lightbox-next');
  if (img)     img.src = urls[idx];
  if (counter) counter.textContent = `${idx + 1} / ${urls.length}`;
  const single = urls.length <= 1;
  if (prev) prev.style.visibility = single ? 'hidden' : '';
  if (next) next.style.visibility = single ? 'hidden' : '';
}

// ══════════════════════════════════════════════
//  Period selector + orchestrator + auto-refresh
// ══════════════════════════════════════════════
function setupTrendPeriod() {
  const wrap = document.getElementById('trend-period');
  if (!wrap) return;
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.trend-period-btn');
    if (!btn) return;
    const days = parseInt(btn.dataset.days, 10);
    if (!days || days === trendDays) return;
    trendDays = days;
    wrap.querySelectorAll('.trend-period-btn').forEach(b => b.classList.toggle('is-active', b === btn));
    loadTrendAndToday();
  });
}

// ══════════════════════════════════════════════
//  ملف المدرسة: البنية والبيانات والمبنى
//
//  الصفحة كانت تعرض الحضور وحده. والمسؤول الذي يفتح ملفّ مدرسةٍ يسأل عن
//  تركيبها قبل حضورها: كم طالبة، كم مدرّساً، كم غرفةَ صفّ. البيانات كلّها
//  موجودة في القاعدة ولم تكن تُعرض في مكانٍ واحد.
// ══════════════════════════════════════════════
const STAFF_CAT_AR = [
  ['staff_teaching',     'تدريسي'],
  ['staff_admin',        'إداري'],
  ['staff_professional', 'مهني'],
  ['staff_worker',       'مستخدَم'],
  ['staff_guard',        'حارس'],
];
const num = (n) => (Number(n) || 0).toLocaleString('en-US');

/** صفوف بطاقة التفصيل: أسماء الكادر أو تعدادُ الطلاب بالصفوف. */
async function staffRowsFor(type) {
  const { rows } = await window.RUQI_DB.getStaffDirectory({
    schoolId: school.id, staffType: type || null, limit: 500,
  });
  return rows.map(r => ({
    label: r.full_name,
    sub: [r.job_title, r.specialization].filter(Boolean).join(' · '),
    value: r.certificate ?? '',
  }));
}

async function loadSchoolStructure() {
  const loading = document.getElementById('sp-loading');
  const errEl   = document.getElementById('sp-error');
  const gridEl  = document.getElementById('sp-grid');
  if (!gridEl) return;
  try {
    const all  = await window.RUQI_DB.getDirectorateSchoolStats();
    const s    = all.find(r => r.school_id === school.id);
    if (!s) throw new Error('المدرسة خارج نطاق الإحصاء');

    const studentItems = [
      { label: 'إجمالي الطلاب', value: num(s.students_total) },
      { label: 'ذكور',          value: num(s.students_male) },
      { label: 'إناث',          value: num(s.students_female) },
    ];
    if (s.students_unknown) studentItems.push(
      { label: 'جنسٌ غير مسجَّل', value: num(s.students_unknown), tone: 'warn' });

    const staffTotal = STAFF_CAT_AR.reduce((t, [k]) => t + (Number(s[k]) || 0), 0);
    const staffItems = [
      { label: 'إجمالي الكادر', value: num(staffTotal),
        drill: { title: 'كادر المدرسة', subtitle: `${num(staffTotal)} موظفاً`,
                 rows: () => staffRowsFor(null) } },
      ...STAFF_CAT_AR.map(([key, ar]) => ({
        label: ar, value: num(s[key]),
        drill: s[key] ? { title: `الكادر — ${ar}`, subtitle: `${num(s[key])} موظفاً`,
                          rows: () => staffRowsFor(key.replace('staff_', '')) } : null,
      })),
    ];

    const groups = [
      { title: 'الطلاب حسب الجنس', items: studentItems },
      { title: 'الكادر حسب الفئة',  items: staffItems },
    ];
    const quotaItems = [];
    if (s.teachers_over_quota) quotaItems.push({
      label: 'تجاوزوا النصاب', value: num(s.teachers_over_quota), tone: 'bad' });
    if (s.teachers_no_quota) quotaItems.push({
      label: 'بلا نصابٍ محدَّد', value: num(s.teachers_no_quota), tone: 'warn' });
    if (quotaItems.length) groups.push({ title: 'نصاب التدريس', items: quotaItems });

    StatDrill.grid(gridEl, groups);
  } catch (e) {
    console.error('[school] loadSchoolStructure', e);
    gridEl.innerHTML = '';
    errEl?.removeAttribute('hidden');
  } finally {
    loading?.classList.add('hidden');
  }
}

/** قائمة وصفٍ من أزواج، والفارغ يُحذف لا يُعرض شُرَطاً. */
const factList = (pairs) => pairs
  .filter(([, v]) => v !== null && v !== undefined && v !== '')
  .map(([k, v]) => `<div class="sp-fact"><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`)
  .join('');

async function loadSchoolFacts() {
  const el = document.getElementById('sp-facts');
  if (el) el.innerHTML = factList([
    ['نوع المدرسة',      SCHOOL_TYPE_AR[school.school_type] ?? school.school_type],
    ['المجمّع التربوي',  school.complex_name],
    ['التصنيف',          school.classification],
    ['نوع التعليم',      school.education_type],
    ['نوع الطلاب',       school.student_type],
    ['فترة الدوام',      SHIFT_AR[school.shift] ?? school.shift],
    ['الرقم الإحصائي',   school.statistical_number],
    ['المنطقة التعليمية', school.educational_zone],
    ['القرية / البلدة',  school.village],
    ['العنوان',          school.address],
    ['الهاتف',           school.phone],
    ['بدء الدوام',       school.work_start_time],
    ['حدّ التسرّب (أيام)', school.dropout_threshold_days],
  ]);

  // بيانات المبنى اختيارية: تُملأ من بوّابة المدرسة وقد لا تكون أُدخلت بعد.
  const bEl     = document.getElementById('sp-building');
  const bTitle  = document.getElementById('sp-building-title');
  const bEmpty  = document.getElementById('sp-building-empty');
  try {
    const b = await window.RUQI_DB.getSchoolBuilding(school.id);
    const html = b ? factList([
      ['عدد الطوابق',     b.floors],
      ['الملكية',         b.ownership],
      ['غرف الصفوف',      b.class_rooms],
      ['الغرف الإدارية',  b.admin_rooms],
      ['غرف غير مستثمرة', b.unused_rooms],
      ['مخبر',            b.lab],
      ['مخبر حاسوب',      b.computer_lab],
      ['مكتبة',           b.library],
      ['صالة رياضية',     b.gym],
      ['مستودع',          b.storage],
      ['غرفة إرشاد',      b.guidance],
      ['غرفة صحّية',      b.health_room],
      ['مشغل',            b.workshop],
      ['مسرح',            b.theater],
      ['ساحة',            b.yard],
      ['قاعات أخرى',      b.other_halls],
    ]) : '';
    if (html) { bEl.innerHTML = html; bTitle?.removeAttribute('hidden'); }
    else bEmpty?.removeAttribute('hidden');
  } catch (e) {
    console.warn('[school] building', e);
    bEmpty?.removeAttribute('hidden');
  }
}

async function loadAll() {
  await Promise.allSettled([
    loadTrendAndToday(), loadCompliance(), loadReports(),
    loadSchoolStructure(), loadSchoolFacts(),
  ]);
}

function startAutoRefresh() {
  clearAutoRefresh();
  let remaining = REFRESH_INTERVAL;
  const countdownEl = document.getElementById('countdown-val');
  if (countdownEl) countdownEl.textContent = remaining;

  countdownInterval = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    remaining--;
    if (countdownEl) countdownEl.textContent = Math.max(0, remaining);
    if (remaining <= 0) {
      remaining = REFRESH_INTERVAL;
      if (countdownEl) countdownEl.textContent = remaining;
      loadAll();
    }
  }, 1000);
}

function clearAutoRefresh() {
  clearInterval(countdownInterval);
  clearInterval(refreshTimer);
}

function setupManualRefresh() {
  document.getElementById('manual-refresh-btn')?.addEventListener('click', async () => {
    startAutoRefresh();
    await loadAll();
    showToast('تم التحديث', 'حُدِّثت بيانات المدرسة.', 'success');
  });
}

// ══════════════════════════════════════════════
//  Utilities
// ══════════════════════════════════════════════
function setNavDate() {
  const el = document.getElementById('nav-date');
  if (el) {
    el.textContent = fmtDateLong(new Date());
  }
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function formatStatus(status) {
  const map = { open: 'مفتوح', acknowledged: 'تمت المراجعة', resolved: 'تم الحل' };
  return map[status] ?? capitalize(status ?? '');
}

function formatType(type) {
  const types = {
    security_threat:       'تهديد أمني',
    infrastructure_damage: 'أضرار في البنية التحتية',
    health_emergency:      'طارئ صحي',
    natural_disaster:      'كارثة طبيعية',
    teacher_shortage:      'نقص في الكوادر التدريسية',
    other:                 'أخرى',
  };
  return types[type] ?? capitalize(type ?? '');
}

function formatDate(iso) {
  if (!iso) return '—';
  return fmtDateTime(iso);
}

function animateValue(el, target, dur = 600) {
  if (!el) return;
  if (!Number.isFinite(target)) { el.textContent = target ?? '—'; return; }
  const from = parseInt(String(el.textContent).replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(from) || from === target) { el.textContent = target; return; }
  const t0 = performance.now();
  (function tick(t) {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (target - from) * e);
    if (k < 1) requestAnimationFrame(tick);
  })(t0);
}

function showToast(title, message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <div class="toast-dot"></div>
    <div class="toast-body">
      <div class="toast-title">${esc(title)}</div>
      <div class="toast-msg">${esc(message)}</div>
    </div>`;
  container.appendChild(toast);

  const duration = type === 'error' ? 6000 : 3500;
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity    = '0';
    toast.style.transform  = 'translateY(8px)';
    setTimeout(() => toast.remove(), 320);
  }, duration);
}
