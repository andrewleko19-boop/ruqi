// ════════════════════════════════════════════════════════════════════════════
//  NSAMS — لوحة تحكم الوزارة (script.js)
//  مصدر الحضور: daily_student_attendance (سجل فردي لكل طالب) — المصدر الحقيقي.
//
//  المقاييس:
//   • الحاضر  = present + late + excused   (الغائب الحقيقي = absent فقط)
//   • النسبة  = الحاضرون ÷ المسجّلين فعلاً اليوم
//   • "مدارس لم تُسجّل" = إجمالي المدارس − المدارس المُسجّلة اليوم
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from '../shared/db.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const loginScreen    = document.getElementById('login-screen');
const dashboard      = document.getElementById('dashboard');
const loginBtn       = document.getElementById('login-btn');
const logoutBtn      = document.getElementById('logout-btn');
const refreshBtn     = document.getElementById('refresh-btn');
const exportBtn      = document.getElementById('export-btn');
const emailInput     = document.getElementById('email');
const passwordInput  = document.getElementById('password');
const loginError     = document.getElementById('login-error');
const userEmailEl    = document.getElementById('user-email');
const todayLabel     = document.getElementById('today-label');
const lastUpdated    = document.getElementById('last-updated');
const countdownEl    = document.getElementById('countdown-val');

const statGov     = document.getElementById('stat-governorates');
const statTotal   = document.getElementById('stat-total');
const statPresent = document.getElementById('stat-present');
const statAbsent  = document.getElementById('stat-absent');
const statSilent  = document.getElementById('stat-silent');
const statRate    = document.getElementById('stat-rate');
const statAdmins  = document.getElementById('stat-admins');
const statWorkers = document.getElementById('stat-workers');

const tableLoading = document.getElementById('table-loading');
const tableWrapper = document.getElementById('table-wrapper');
const tableEmpty   = document.getElementById('table-empty');
const govTbody     = document.getElementById('gov-tbody');
const govTfoot     = document.getElementById('gov-tfoot');

// ── State ─────────────────────────────────────────────────────────────────────
let tableData     = [];
let autoRefreshId = null;
let countdownId   = null;
let countdown     = 60;
let lastData      = null;   // {directorates, schools, dirAgg, perSchool} للتعمق
let trendDays     = 14;
const charts      = {};
let drill         = { level: 'national', gov: null, dirId: null };

// ── Helpers ───────────────────────────────────────────────────────────────────
const esc = (str) => String(str ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmt  = (n) => (n === null || n === undefined) ? '—' : Number(n).toLocaleString();
const pct  = (part, total) => total > 0 ? ((part / total) * 100).toFixed(1) + '%' : '—';
const today = () => new Date().toISOString().split('T')[0];

const presentOf  = (agg) => agg.present + agg.late + agg.excused;
const enrolledOf = (agg) => agg.present + agg.late + agg.excused + agg.absent;

// Animated count-up (300 ms, linear steps)
function animateValue(el, target) {
  if (!el) return;
  const numTarget = typeof target === 'number' ? target : parseInt(String(target).replace(/,/g, ''), 10);
  if (isNaN(numTarget)) { el.textContent = target; return; }
  const start = parseInt(el.textContent.replace(/[^0-9]/g, ''), 10) || 0;
  if (start === numTarget) return;
  const steps  = 20;
  const delay  = 300 / steps;
  let step     = 0;
  clearInterval(el._animId);
  el._animId = setInterval(() => {
    step++;
    const value = Math.round(start + (numTarget - start) * (step / steps));
    el.textContent = value.toLocaleString();
    if (step >= steps) {
      clearInterval(el._animId);
      el.textContent = numTarget.toLocaleString();
    }
  }, delay);
}

function showError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}
function hideError() {
  loginError.classList.add('hidden');
}
function setLastUpdated() {
  lastUpdated.textContent = 'آخر تحديث: ' + new Date().toLocaleTimeString('ar-SY');
}
function setTodayLabel() {
  todayLabel.textContent = new Date().toLocaleDateString('ar-SY', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function rateBadge(rate) {
  if (rate === null) return '<span class="badge badge-none">لا بيانات</span>';
  const n = parseFloat(rate);
  if (n >= 90) return '<span class="badge badge-good">ممتاز</span>';
  if (n >= 75) return '<span class="badge badge-warning">مقبول</span>';
  return '<span class="badge badge-poor">ضعيف</span>';
}
function rateBarClass(rate) {
  if (rate === null) return '';
  const n = parseFloat(rate);
  if (n >= 90) return 'green';
  if (n >= 75) return 'yellow';
  return 'red';
}

// ── Auto-refresh (60 s countdown) ────────────────────────────────────────────
function startAutoRefresh() {
  stopAutoRefresh();
  countdown = 60;
  if (countdownEl) countdownEl.textContent = countdown;

  countdownId = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    countdown--;
    if (countdownEl) countdownEl.textContent = countdown;
    if (countdown <= 0) {
      countdown = 60;
      if (countdownEl) countdownEl.textContent = countdown;
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) loadAllData();
      });
    }
  }, 1000);
}

function stopAutoRefresh() {
  clearInterval(countdownId);
  clearInterval(autoRefreshId);
  countdownId = autoRefreshId = null;
}

function resetCountdown() {
  countdown = 60;
  if (countdownEl) countdownEl.textContent = countdown;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const ok = await verifyRole(session.user.id);
    if (ok) showDashboard(session.user.email);
    else await supabase.auth.signOut();
  }
}

async function verifyRole(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();
  if (error || !data) return false;
  return data.role === 'ministry_user';
}

loginBtn.addEventListener('click', async () => {
  hideError();
  const email    = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) { showError('الرجاء إدخال البريد وكلمة المرور.'); return; }

  loginBtn.disabled    = true;
  loginBtn.textContent = 'جارٍ تسجيل الدخول…';

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    showError(error.message);
    loginBtn.disabled    = false;
    loginBtn.textContent = 'تسجيل الدخول';
    return;
  }

  const ok = await verifyRole(data.user.id);
  if (!ok) {
    showError('الوصول مرفوض. هذه البوابة لمستخدمي الوزارة فقط.');
    await supabase.auth.signOut();
    loginBtn.disabled    = false;
    loginBtn.textContent = 'تسجيل الدخول';
    return;
  }
  showDashboard(data.user.email);
});

const modalConfirmLogout = document.getElementById('modal-confirm-logout');
const btnLogoutCancel    = document.getElementById('btn-logout-cancel');
const btnLogoutOk        = document.getElementById('btn-logout-ok');

logoutBtn.addEventListener('click', () => { modalConfirmLogout.hidden = false; });
btnLogoutCancel.addEventListener('click', () => { modalConfirmLogout.hidden = true; });
modalConfirmLogout.addEventListener('click', e => {
  if (e.target === modalConfirmLogout) modalConfirmLogout.hidden = true;
});
btnLogoutOk.addEventListener('click', async () => {
  modalConfirmLogout.hidden = true;
  stopAutoRefresh();
  await supabase.auth.signOut();
  dashboard.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  loginBtn.disabled    = false;
  loginBtn.textContent = 'تسجيل الدخول';
  emailInput.value    = '';
  passwordInput.value = '';
  tableData = [];
  lastData  = null;
  drill     = { level: 'national', gov: null, dirId: null };
  document.getElementById('drill-card')?.classList.add('hidden');
});

function showDashboard(email) {
  loginScreen.classList.add('hidden');
  dashboard.classList.remove('hidden');
  userEmailEl.textContent = email;
  setTodayLabel();
  loadAllData();
  startAutoRefresh();
}

// ── Data Fetching ─────────────────────────────────────────────────────────────
async function loadAllData() {
  tableLoading.classList.remove('hidden');
  tableWrapper.classList.add('hidden');
  tableEmpty.classList.add('hidden');
  [statGov, statTotal, statPresent, statAbsent, statSilent, statRate, statAdmins, statWorkers]
    .forEach(el => { if (el) el.textContent = '—'; });

  try {
    const { data: directorates, error: dirErr } = await supabase
      .from('directorates')
      .select('id, name, governorate')
      .order('governorate');
    if (dirErr) throw dirErr;
    if (!directorates || directorates.length === 0) { showEmpty('لا توجد مديريات.'); return; }

    const { data: schools, error: schErr } = await supabase
      .from('schools')
      .select('id, name, directorate_id, total_students');
    if (schErr) throw schErr;

    const allSchoolIds = (schools || []).map(s => s.id);

    // No schools yet → skip attendance queries (an empty .in() placeholder
    // would send a non-uuid value and 400). Empty arrays flow through fine.
    let attendance = [];
    let staffAgg   = [];
    if (allSchoolIds.length > 0) {
      const { data: att, error: attErr } = await supabase
        .from('daily_student_attendance')
        .select('school_id, status')
        .eq('date', today())
        .in('school_id', allSchoolIds);
      if (attErr) throw attErr;
      attendance = att || [];

      const { data: staff, error: staffErr } = await supabase
        .from('daily_attendance')
        .select('admins_present, workers_present')
        .eq('date', today())
        .in('school_id', allSchoolIds);
      if (staffErr) throw staffErr;
      staffAgg = staff || [];
    }

    let adminsPresent = 0, workersPresent = 0;
    for (const r of staffAgg || []) {
      adminsPresent  += r.admins_present  || 0;
      workersPresent += r.workers_present || 0;
    }
    animateValue(statAdmins,  adminsPresent);
    animateValue(statWorkers, workersPresent);

    // school → directorate lookup; also count total schools per directorate
    const schoolToDir   = {};
    const dirTotalSchools = {};
    for (const s of schools || []) {
      schoolToDir[s.id] = s.directorate_id;
      dirTotalSchools[s.directorate_id] = (dirTotalSchools[s.directorate_id] || 0) + 1;
    }

    // تجميع الحضور حسب المديرية + لكل مدرسة (للتعمق)
    const dirAgg = {};
    for (const d of directorates) {
      dirAgg[d.id] = {
        name: d.name,
        governorate: d.governorate || 'غير محدد',
        present: 0, late: 0, absent: 0, excused: 0,
        reportingSchools: new Set(),
        totalSchools: dirTotalSchools[d.id] || 0,
      };
    }
    const perSchool = {};
    for (const rec of attendance || []) {
      const dirId = schoolToDir[rec.school_id];
      if (!dirId || !dirAgg[dirId]) continue;
      const a = dirAgg[dirId];
      const p = perSchool[rec.school_id] ||
        (perSchool[rec.school_id] = { present: 0, late: 0, absent: 0, excused: 0 });
      if      (rec.status === 'present')  { a.present++;  p.present++; }
      else if (rec.status === 'late')     { a.late++;     p.late++; }
      else if (rec.status === 'absent')   { a.absent++;   p.absent++; }
      else if (rec.status === 'excused')  { a.excused++;  p.excused++; }
      a.reportingSchools.add(rec.school_id);
    }

    // تجميع حسب المحافظة
    const govMap = {};
    for (const d of directorates) {
      const gov = d.governorate || 'غير محدد';
      if (!govMap[gov]) {
        govMap[gov] = {
          governorate: gov,
          present: 0, late: 0, absent: 0, excused: 0,
          reportingSchools: 0, totalSchools: 0,
        };
      }
      const a = dirAgg[d.id];
      govMap[gov].present          += a.present;
      govMap[gov].late             += a.late;
      govMap[gov].absent           += a.absent;
      govMap[gov].excused          += a.excused;
      govMap[gov].reportingSchools += a.reportingSchools.size;
      govMap[gov].totalSchools     += a.totalSchools;
    }

    const rows = Object.values(govMap).sort((a, b) => a.governorate.localeCompare(b.governorate, 'ar'));
    if (rows.length === 0) { showEmpty('لا تتوفر بيانات.'); return; }

    lastData = { directorates, schools: schools || [], dirAgg, perSchool };

    renderStats(rows);
    renderTable(rows);
    renderGovRankChart(rows);
    renderDrill();         // يعيد رسم مستوى التعمق الحالي ببيانات طازجة
    loadNationalTrend();          // try/catch داخلي — فشل RPC لا يمسّ اللوحة
    loadNationalPeriodicReports(); // نفس النمط
    loadNationalResultSheets();    // الجلاءات الصادرة (إشراف وطني)
    setLastUpdated();

  } catch (err) {
    console.error('NSAMS Ministry load error:', err);
    tableLoading.classList.add('hidden');
    tableEmpty.textContent = 'خطأ في تحميل البيانات: ' + (err.message || String(err));
    tableEmpty.classList.remove('hidden');
  }
}

function showEmpty(msg = 'لا تتوفر بيانات حضور لهذا اليوم.') {
  tableLoading.classList.add('hidden');
  tableEmpty.textContent = msg;
  tableEmpty.classList.remove('hidden');
}

// ── Render Stats ──────────────────────────────────────────────────────────────
function renderStats(rows) {
  let present = 0, late = 0, absent = 0, excused = 0;
  let totalSchools = 0, reportingSchools = 0;
  for (const r of rows) {
    present         += r.present;
    late            += r.late;
    absent          += r.absent;
    excused         += r.excused;
    totalSchools    += r.totalSchools;
    reportingSchools += r.reportingSchools;
  }
  const enrolled  = present + late + absent + excused;
  const attending = present + late + excused;
  const silent    = Math.max(0, totalSchools - reportingSchools);

  animateValue(statGov,     rows.length);
  animateValue(statTotal,   enrolled);
  animateValue(statPresent, attending);
  animateValue(statAbsent,  absent);
  animateValue(statSilent,  silent);
  // نسبة الحضور نصية — بلا تحريك
  if (statRate) statRate.textContent = pct(attending, enrolled);
}

// ── Render Table ──────────────────────────────────────────────────────────────
function renderTable(rows) {
  tableLoading.classList.add('hidden');
  tableData = rows;

  let tPresent = 0, tLate = 0, tAbsent = 0, tExcused = 0;
  let tReporting = 0, tTotal = 0;

  govTbody.innerHTML = rows.map((row, i) => {
    const enrolled  = row.present + row.late + row.absent + row.excused;
    const attending = row.present + row.late + row.excused;
    const rate      = enrolled > 0 ? (attending / enrolled * 100) : null;
    const rateStr   = rate !== null ? rate.toFixed(1) : null;
    const barClass  = rateBarClass(rateStr);
    const barWidth  = rate !== null ? rate.toFixed(1) : 0;
    const silent    = Math.max(0, row.totalSchools - row.reportingSchools);

    tPresent   += row.present; tLate   += row.late;
    tAbsent    += row.absent;  tExcused += row.excused;
    tReporting += row.reportingSchools;
    tTotal     += row.totalSchools;

    return `
      <tr class="row-clickable" data-gov="${esc(row.governorate)}" title="عرض مديريات المحافظة">
        <td>${i + 1}</td>
        <td><strong>${esc(row.governorate)}</strong> <span class="drill-chevron">‹</span></td>
        <td>${fmt(row.reportingSchools)}</td>
        <td style="color:#f87171">${silent > 0 ? fmt(silent) : '<span style="color:#4ade80">0</span>'}</td>
        <td>${fmt(enrolled)}</td>
        <td style="color:#4ade80">${fmt(attending)}</td>
        <td style="color:#f87171">${fmt(row.absent)}</td>
        <td>
          <div class="rate-cell">
            <div class="rate-bar-bg">
              <div class="rate-bar-fill ${barClass}" style="width:${barWidth}%"></div>
            </div>
            <span class="rate-text" style="color:${
              barClass === 'green'  ? '#4ade80' :
              barClass === 'yellow' ? '#fde047' :
              barClass === 'red'    ? '#f87171' : '#64748b'
            }">
              ${rateStr !== null ? rateStr + '%' : '—'}
            </span>
          </div>
        </td>
        <td>${rateBadge(rateStr)}</td>
      </tr>`;
  }).join('');

  const totEnrolled  = tPresent + tLate + tAbsent + tExcused;
  const totAttending = tPresent + tLate + tExcused;
  const totSilent    = Math.max(0, tTotal - tReporting);
  const nationalRate = totEnrolled > 0 ? (totAttending / totEnrolled * 100).toFixed(1) : null;

  govTfoot.innerHTML = `
    <tr>
      <td></td>
      <td>الإجمالي الوطني</td>
      <td>${fmt(tReporting)}</td>
      <td style="color:#f87171">${totSilent > 0 ? fmt(totSilent) : '<span style="color:#4ade80">0</span>'}</td>
      <td>${fmt(totEnrolled)}</td>
      <td style="color:#4ade80">${fmt(totAttending)}</td>
      <td style="color:#f87171">${fmt(tAbsent)}</td>
      <td>${nationalRate !== null ? nationalRate + '%' : '—'}</td>
      <td>${rateBadge(nationalRate)}</td>
    </tr>`;

  tableWrapper.classList.remove('hidden');
}

// ── Charts (Chart.js — dark/RTL) ──────────────────────────────────────────────
const CHART_FONT = "'Segoe UI', system-ui, sans-serif";
const CH = {
  grid:      'rgba(30, 48, 88, 0.55)',
  tick:      '#94a3b8',
  tooltipBg: '#111d36',
  line:      '#60a5fa',
  lineFill:  'rgba(26, 86, 219, 0.18)',
};

function chartBaseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,          // الارتفاع من .chart-canvas-wrap
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
        titleColor: '#e2e8f0', bodyColor: '#94a3b8', padding: 10,
        titleFont: { family: CHART_FONT }, bodyFont: { family: CHART_FONT },
      },
    },
    scales: {
      x: { grid: { color: CH.grid, drawTicks: false }, ticks: { color: CH.tick, font: { family: CHART_FONT, size: 11 }, maxRotation: 0, autoSkip: true } },
      y: { beginAtZero: true, grid: { color: CH.grid, drawTicks: false }, ticks: { color: CH.tick, font: { family: CHART_FONT, size: 11 } } },
    },
  };
}

// إنشاء مرة واحدة ثم تحديث — لا destroy (انتقالات حية ناعمة عبر auto-refresh)
function upsertChart(holder, key, canvasId, configFactory, labels, datasetsData) {
  if (typeof Chart === 'undefined') return null;   // فشل CDN — تدهور صامت
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

// مرساة الظهيرة تمنع انزياح اليوم في UTC+3
const trendLabel = (isoDay) =>
  new Date(isoDay + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

function natRateConfig(labels, datasetsData) {
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
        label: 'نسبة الحضور الوطنية',
        data: datasetsData[0],
        borderColor: CH.line,
        backgroundColor: CH.lineFill,
        fill: true,
        tension: 0.35,
        spanGaps: false,
        pointRadius: 3,
        pointBackgroundColor: CH.line,
      }],
    },
    options: opts,
  };
}

async function loadNationalTrend() {
  const emptyEl = document.getElementById('trend-empty');
  try {
    const { data, error } = await supabase.rpc('get_ministry_trend', { p_days: trendDays });
    if (error) throw error;
    const rows = data || [];
    const hasData = rows.some(r => (r.present + r.late + r.absent + r.excused) > 0);
    if (emptyEl) {
      // الـ RPC يعمل — الفراغ هنا يعني فترة بلا تسجيل، لا قسماً ناقصاً
      emptyEl.textContent = 'لا يوجد حضور مسجّل خلال هذه الفترة — تظهر المنحنيات فور تسجيل المدارس للحضور.';
      emptyEl.classList.toggle('hidden', hasData);
    }

    const labels = rows.map(r => trendLabel(r.day));
    const rates  = rows.map(r => {
      const en = r.present + r.late + r.absent + r.excused;
      return en ? +(((r.present + r.late + r.excused) / en) * 100).toFixed(1) : null;
    });
    upsertChart(charts, 'nat', 'nat-rate-chart', natRateConfig, labels, [rates]);
  } catch (err) {
    console.warn('[NatTrend] RPC unavailable:', err);
    if (emptyEl) {
      emptyEl.textContent = 'تعذّر جلب الاتجاه — تأكد من تشغيل القسم 7 من database-setup.sql.';
      emptyEl.classList.remove('hidden');
    }
  }
}

// ترتيب المحافظات اليوم — من بيانات الجدول القائمة، بلا جلب إضافي
function renderGovRankChart(rows) {
  if (typeof Chart === 'undefined') return;

  const ranked = rows.map(r => {
    const enrolled  = r.present + r.late + r.absent + r.excused;
    const attending = r.present + r.late + r.excused;
    return {
      gov:  r.governorate,
      rate: enrolled > 0 ? +((attending / enrolled) * 100).toFixed(1) : null,
    };
  }).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));

  const labels = ranked.map(s => s.gov);
  const data   = ranked.map(s => s.rate);
  const colors = ranked.map(s => {
    if (s.rate === null) return '#64748b';
    if (s.rate >= 90)    return '#4ade80';
    if (s.rate >= 75)    return '#fde047';
    return '#f87171';
  });

  const existing = charts.rank;
  if (existing) {
    existing.data.labels = labels;
    existing.data.datasets[0].data = data;
    existing.data.datasets[0].backgroundColor = colors;
    existing.update();
    return;
  }

  const el = document.getElementById('gov-rank-chart');
  if (!el) return;
  const opts = chartBaseOptions();
  opts.indexAxis = 'y';
  opts.plugins.legend.display = false;
  opts.scales.x.max = 100;
  opts.scales.x.ticks.callback = (v) => v + '%';
  opts.plugins.tooltip.callbacks = {
    label: (ctx) => ` ${ctx.parsed.x !== null ? ctx.parsed.x + '%' : '—'}`,
  };
  charts.rank = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, maxBarThickness: 18 }] },
    options: opts,
  });
}

// أزرار الفترة (٧/١٤/٣٠)
document.getElementById('trend-period')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.period-btn');
  if (!btn) return;
  const days = parseInt(btn.dataset.days, 10);
  if (!days || days === trendDays) return;
  trendDays = days;
  document.querySelectorAll('#trend-period .period-btn')
    .forEach(b => b.classList.toggle('is-active', b === btn));
  loadNationalTrend();
});

// ── Drill-down: محافظة ← مديرية ← مدرسة ──────────────────────────────────────
const rateCellHTML = (rateStr, barClass) => `
  <div class="rate-cell">
    <div class="rate-bar-bg">
      <div class="rate-bar-fill ${barClass}" style="width:${rateStr ?? 0}%"></div>
    </div>
    <span class="rate-text" style="color:${
      barClass === 'green'  ? '#4ade80' :
      barClass === 'yellow' ? '#fde047' :
      barClass === 'red'    ? '#f87171' : '#64748b'
    }">
      ${rateStr !== null ? rateStr + '%' : '—'}
    </span>
  </div>`;

function openDrillGov(gov) {
  drill = { level: 'gov', gov, dirId: null };
  renderDrill();
  document.getElementById('drill-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeDrill() {
  drill = { level: 'national', gov: null, dirId: null };
  renderDrill();
}

function renderDrill() {
  const card = document.getElementById('drill-card');
  if (!card) return;
  if (drill.level === 'national' || !lastData) { card.classList.add('hidden'); return; }

  const dirs = lastData.directorates.filter(d => (d.governorate || 'غير محدد') === drill.gov);
  if (dirs.length === 0) { closeDrill(); return; }   // اختفت المحافظة بعد تحديث

  card.classList.remove('hidden');
  renderBreadcrumb();

  const thead = document.getElementById('drill-thead');
  const tbody = document.getElementById('drill-tbody');

  if (drill.level === 'gov') {
    thead.innerHTML = `
      <tr>
        <th>#</th><th>المديرية</th><th>المدارس المُسجّلة</th><th>لم تُسجّل</th>
        <th>إجمالي الطلاب</th><th>الحاضرون</th><th>الغائبون</th>
        <th>نسبة الحضور</th><th>الحالة</th>
      </tr>`;
    tbody.innerHTML = dirs.map((d, i) => {
      const a = lastData.dirAgg[d.id];
      const enrolled  = a.present + a.late + a.absent + a.excused;
      const attending = a.present + a.late + a.excused;
      const rate      = enrolled > 0 ? (attending / enrolled * 100) : null;
      const rateStr   = rate !== null ? rate.toFixed(1) : null;
      const barClass  = rateBarClass(rateStr);
      const silent    = Math.max(0, a.totalSchools - a.reportingSchools.size);
      return `
        <tr class="row-clickable" data-dir="${esc(d.id)}" title="عرض مدارس المديرية">
          <td>${i + 1}</td>
          <td><strong>${esc(a.name)}</strong> <span class="drill-chevron">‹</span></td>
          <td>${fmt(a.reportingSchools.size)}</td>
          <td style="color:#f87171">${silent > 0 ? fmt(silent) : '<span style="color:#4ade80">0</span>'}</td>
          <td>${fmt(enrolled)}</td>
          <td style="color:#4ade80">${fmt(attending)}</td>
          <td style="color:#f87171">${fmt(a.absent)}</td>
          <td>${rateCellHTML(rateStr, barClass)}</td>
          <td>${rateBadge(rateStr)}</td>
        </tr>`;
    }).join('');
    return;
  }

  // level === 'dir'
  const dirInfo = lastData.dirAgg[drill.dirId];
  if (!dirInfo) { drill = { level: 'gov', gov: drill.gov, dirId: null }; renderDrill(); return; }

  const dirSchools = lastData.schools
    .filter(s => s.directorate_id === drill.dirId)
    .map(s => {
      const p = lastData.perSchool[s.id] || null;   // null = لم تُسجّل اليوم
      const enrolled  = p ? p.present + p.late + p.absent + p.excused : 0;
      const attending = p ? p.present + p.late + p.excused : 0;
      const rate      = enrolled > 0 ? (attending / enrolled * 100) : null;
      return { name: s.name ?? '—', silent: !p, enrolled, attending, absent: p?.absent ?? 0, rate };
    })
    .sort((a, b) => {
      if (a.silent !== b.silent) return a.silent ? -1 : 1;   // الصامتة أولاً
      return (a.rate ?? 101) - (b.rate ?? 101);              // ثم النسبة تصاعدياً
    });

  thead.innerHTML = `
    <tr>
      <th>#</th><th>المدرسة</th><th>المسجّلون اليوم</th>
      <th>الحاضرون</th><th>الغائبون</th><th>نسبة الحضور</th><th>الحالة</th>
    </tr>`;

  if (dirSchools.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:18px">لا توجد مدارس في هذه المديرية.</td></tr>';
    return;
  }

  tbody.innerHTML = dirSchools.map((s, i) => {
    const rateStr  = s.rate !== null ? s.rate.toFixed(1) : null;
    const barClass = rateBarClass(rateStr);
    return `
      <tr${s.silent ? ' class="row-silent"' : ''}>
        <td>${i + 1}</td>
        <td><strong>${esc(s.name)}</strong></td>
        <td>${s.silent ? '—' : fmt(s.enrolled)}</td>
        <td style="color:#4ade80">${s.silent ? '—' : fmt(s.attending)}</td>
        <td style="color:#f87171">${s.silent ? '—' : fmt(s.absent)}</td>
        <td>${rateCellHTML(rateStr, barClass)}</td>
        <td>${s.silent ? '<span class="badge badge-none">لم تُسجّل</span>' : rateBadge(rateStr)}</td>
      </tr>`;
  }).join('');
}

function renderBreadcrumb() {
  const bc = document.getElementById('drill-breadcrumb');
  if (!bc) return;
  const parts = ['<button data-nav="national">الوطن</button>', '<span class="crumb-sep">›</span>'];
  if (drill.level === 'gov') {
    parts.push(`<span class="crumb-current">${esc(drill.gov)}</span>`);
  } else {
    parts.push(`<button data-nav="gov">${esc(drill.gov)}</button>`);
    parts.push('<span class="crumb-sep">›</span>');
    parts.push(`<span class="crumb-current">${esc(lastData?.dirAgg[drill.dirId]?.name ?? '—')}</span>`);
  }
  bc.innerHTML = parts.join('');
}

// تفويض النقر — يُسجَّل مرة واحدة عند الإقلاع
govTbody.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-gov]');
  if (tr) openDrillGov(tr.dataset.gov);
});

document.getElementById('drill-tbody')?.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-dir]');
  if (!tr) return;
  drill = { level: 'dir', gov: drill.gov, dirId: tr.dataset.dir };
  renderDrill();
});

document.getElementById('drill-breadcrumb')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-nav]');
  if (!btn) return;
  if (btn.dataset.nav === 'national') closeDrill();
  else { drill = { level: 'gov', gov: drill.gov, dirId: null }; renderDrill(); }
});

document.getElementById('drill-close')?.addEventListener('click', closeDrill);

// ── Refresh (manual) ──────────────────────────────────────────────────────────
refreshBtn.addEventListener('click', async () => {
  resetCountdown();
  const { data: { session } } = await supabase.auth.getSession();
  if (session) loadAllData();
});

// ── CSV Export ────────────────────────────────────────────────────────────────
exportBtn.addEventListener('click', () => {
  if (!tableData.length) return;

  const dateStr = today();
  const headers = [
    '"المحافظة"', '"المدارس المُسجّلة"', '"لم تُسجّل"',
    '"إجمالي الطلاب"', '"الحاضرون"', '"الغائبون"', '"نسبة الحضور (%)"',
  ];

  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;

  const dataLines = tableData.map(row => {
    const enrolled  = row.present + row.late + row.absent + row.excused;
    const attending = row.present + row.late + row.excused;
    const rate      = enrolled > 0 ? (attending / enrolled * 100).toFixed(1) : '';
    const silent    = Math.max(0, row.totalSchools - row.reportingSchools);
    return [
      q(row.governorate),
      q(row.reportingSchools),
      q(silent),
      q(enrolled),
      q(attending),
      q(row.absent),
      q(rate),
    ].join(',');
  });

  let tPresent = 0, tLate = 0, tAbsent = 0, tExcused = 0;
  let tReporting = 0, tTotal = 0;
  tableData.forEach(r => {
    tPresent += r.present; tLate += r.late; tAbsent += r.absent;
    tExcused += r.excused; tReporting += r.reportingSchools; tTotal += r.totalSchools;
  });
  const totEnrolled  = tPresent + tLate + tAbsent + tExcused;
  const totAttending = tPresent + tLate + tExcused;
  const totSilent    = Math.max(0, tTotal - tReporting);
  const totRate      = totEnrolled > 0 ? (totAttending / totEnrolled * 100).toFixed(1) : '';

  const csvRows = [
    `# تقرير الحضور الوطني رُقِيّ — ${dateStr}`,
    headers.join(','),
    ...dataLines,
    [
      q('الإجمالي الوطني'), q(tReporting), q(totSilent),
      q(totEnrolled), q(totAttending), q(tAbsent), q(totRate),
    ].join(','),
  ];

  const blob = new Blob(['﻿' + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `nsams_national_report_${dateStr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── التقارير الشهرية الوطنية ─────────────────────────────────────────────────
async function loadNationalPeriodicReports() {
  const loadingEl = document.getElementById('nat-periodic-loading');
  const tableWrap = document.getElementById('nat-periodic-table-wrap');
  const emptyEl   = document.getElementById('nat-periodic-empty');
  const tbody     = document.getElementById('nat-periodic-tbody');
  if (!tbody) return;

  loadingEl?.classList.remove('hidden');
  tableWrap?.setAttribute('hidden', '');
  emptyEl?.classList.add('hidden');
  tbody.innerHTML = '';

  try {
    const { data: reports, error } = await supabase.rpc('get_periodic_reports', { p_scope: 'national' });
    loadingEl?.classList.add('hidden');
    if (error) throw error;
    if (!reports || !reports.length) { emptyEl?.classList.remove('hidden'); return; }

    reports.forEach(r => {
      const d = r.data || {};
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.period}</td>
        <td>${d.schools_count ?? '—'}</td>
        <td>${d.attendance_rate != null ? d.attendance_rate + '٪' : '—'}</td>
        <td>${d.dropout_flagged ?? '—'}</td>
        <td>${d.emergency_reports ?? '—'}</td>
        <td><button class="btn btn-icon" data-rid="${r.id}" title="طباعة">🖨</button></td>`;
      tbody.appendChild(tr);
    });
    tableWrap?.removeAttribute('hidden');

    tbody.querySelectorAll('[data-rid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rep = reports.find(x => x.id === btn.dataset.rid);
        if (rep) printNationalReport(rep);
      });
    });
  } catch (err) {
    loadingEl?.classList.add('hidden');
    if (emptyEl) { emptyEl.textContent = 'تعذّر تحميل التقارير الشهرية.'; emptyEl.classList.remove('hidden'); }
  }
}

document.getElementById('reload-nat-periodic-btn')
  ?.addEventListener('click', loadNationalPeriodicReports);

// ── الجلاءات الصادرة (إشراف وطني — قراءة فقط) ───────────────────────────────
const RS_TERM_AR = { s1: 'الفصل الأول', s2: 'الفصل الثاني', year: 'النتيجة السنوية' };

async function loadNationalResultSheets() {
  const loadingEl = document.getElementById('nat-rs-loading');
  const tableWrap = document.getElementById('nat-rs-table-wrap');
  const emptyEl   = document.getElementById('nat-rs-empty');
  const tbody     = document.getElementById('nat-rs-tbody');
  if (!tbody) return;

  loadingEl?.classList.remove('hidden');
  tableWrap?.setAttribute('hidden', '');
  emptyEl?.classList.add('hidden');
  tbody.innerHTML = '';

  try {
    const sheets = await window.NSAMS_DB.getMinistryResultSheets();
    loadingEl?.classList.add('hidden');
    if (!sheets.length) { emptyEl?.classList.remove('hidden'); return; }

    sheets.forEach(s => {
      const students = Array.isArray(s.snapshot_data?.students) ? s.snapshot_data.students : [];
      const passed = students.filter(x => x.result === 'ناجح').length;
      const failed = students.filter(x => x.result === 'راسب').length;
      const clsLabel = s.class ? `الصف ${s.class.grade} / ${s.class.section ?? ''}`.trim() : '—';
      const termLabel = RS_TERM_AR[s.term] ?? s.term;
      const issued = s.issued_at ? new Date(s.issued_at).toLocaleDateString('ar-SY') : '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(s.school?.name ?? '—')}</td>
        <td>${esc(clsLabel)} <small style="color:var(--text-secondary)">(${esc(termLabel)})</small></td>
        <td>${passed} / ${failed}</td>
        <td>${esc(issued)}</td>`;
      tbody.appendChild(tr);
    });
    tableWrap?.removeAttribute('hidden');
  } catch (err) {
    loadingEl?.classList.add('hidden');
    if (emptyEl) { emptyEl.textContent = 'تعذّر تحميل الجلاءات الصادرة.'; emptyEl.classList.remove('hidden'); }
  }
}

document.getElementById('reload-nat-rs-btn')
  ?.addEventListener('click', loadNationalResultSheets);

function printNationalReport(rep) {
  const d = rep.data || {};
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl">
<head><meta charset="utf-8">
<title>التقرير الشهري الوطني — ${rep.period}</title>
<style>
  body { font-family: Cairo, Arial, sans-serif; padding: 32px; color: #111; }
  h1 { font-size: 1.4rem; margin-bottom: 4px; }
  .sub { color: #555; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 10px 14px; text-align: right; }
  th { background: #f0f4f8; font-weight: 700; }
  @media print { body { padding: 14mm; } }
</style>
</head>
<body>
<h1>التقرير الشهري الوطني</h1>
<p class="sub">الفترة: ${rep.period} &nbsp;|&nbsp; تاريخ التوليد: ${new Date(rep.created_at).toLocaleDateString('ar-SY')}</p>
<table>
  <thead><tr><th>المؤشر</th><th>القيمة</th></tr></thead>
  <tbody>
    <tr><td>عدد المدارس</td><td>${d.schools_count ?? '—'}</td></tr>
    <tr><td>نسبة الحضور الوطنية</td><td>${d.attendance_rate != null ? d.attendance_rate + '٪' : '—'}</td></tr>
    <tr><td>عدد الحاضرين (الفترة)</td><td>${d.present_count ?? '—'}</td></tr>
    <tr><td>عدد الغائبين (الفترة)</td><td>${d.absent_count ?? '—'}</td></tr>
    <tr><td>حالات التسرب المُرقَّنة</td><td>${d.dropout_flagged ?? '—'}</td></tr>
    <tr><td>البلاغات الطارئة</td><td>${d.emergency_reports ?? '—'}</td></tr>
  </tbody>
</table>
</body></html>`;
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.onload = () => setTimeout(() => win.print(), 300);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
checkSession();
