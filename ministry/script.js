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
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

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
    if (ok) showDashboard(session.user.email, session.user.id);
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
  showDashboard(data.user.email, data.user.id);
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
  stopLiveFeed();
  if (minUnsubNotif) { minUnsubNotif(); minUnsubNotif = null; }
  setNotifBadge(0);
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

function showDashboard(email, userId) {
  loginScreen.classList.add('hidden');
  dashboard.classList.remove('hidden');
  userEmailEl.textContent = email;
  setTodayLabel();
  loadAllData();
  startAutoRefresh();
  startLiveFeed();
  if (userId) initNotifications(userId);

  // Web Push registration (fire-and-forget) — ministry_user devices must
  // subscribe here or they never receive OS push notifications.
  if ('Notification' in window) {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') window.NSAMS_DB.registerPushSubscription().catch(() => {});
    });
  }
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
      .select('id, name, directorate_id, total_students, lat, lng');
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
    renderGovRanking(rows);
    renderNationalMap(schools || [], perSchool, directorates);
    loadNationalHeadline();       // بلاغات مفتوحة — استعلام عدّ خفيف
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
        <td style="color:var(--bad)">${silent > 0 ? fmt(silent) : '<span style="color:var(--good)">0</span>'}</td>
        <td>${fmt(enrolled)}</td>
        <td style="color:var(--good)">${fmt(attending)}</td>
        <td style="color:var(--bad)">${fmt(row.absent)}</td>
        <td>
          <div class="rate-cell">
            <div class="rate-bar-bg">
              <div class="rate-bar-fill ${barClass}" style="width:${barWidth}%"></div>
            </div>
            <span class="rate-text" style="color:${
              barClass === 'green'  ? '#3fbd80' :
              barClass === 'yellow' ? '#e0a83f' :
              barClass === 'red'    ? '#e2685a' : '#7d8296'
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
      <td style="color:var(--bad)">${totSilent > 0 ? fmt(totSilent) : '<span style="color:var(--good)">0</span>'}</td>
      <td>${fmt(totEnrolled)}</td>
      <td style="color:var(--good)">${fmt(totAttending)}</td>
      <td style="color:var(--bad)">${fmt(tAbsent)}</td>
      <td>${nationalRate !== null ? nationalRate + '%' : '—'}</td>
      <td>${rateBadge(nationalRate)}</td>
    </tr>`;

  tableWrapper.classList.remove('hidden');
}

// ── Charts (Chart.js — light/RTL) ─────────────────────────────────────────────
// Grid/tick/tooltip read the page tokens; the old values were a dark-canvas
// palette that sat nearly invisible on the light cards.
const CHART_FONT = "'Segoe UI', system-ui, sans-serif";
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
const CH = {
  grid:      cssVar('--line-soft', '#202a48'),
  tick:      cssVar('--text-muted', '#aab3c8'),
  tooltipBg: '#0b1120',
  line:      cssVar('--accent', '#35b3ac'),
  lineFill:  'rgba(53, 179, 172, 0.18)',
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
    if (s.rate === null) return '#7d8296';
    if (s.rate >= 90)    return '#3fbd80';
    if (s.rate >= 75)    return '#e0a83f';
    return '#e2685a';
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
      barClass === 'green'  ? '#3fbd80' :
      barClass === 'yellow' ? '#e0a83f' :
      barClass === 'red'    ? '#e2685a' : '#7d8296'
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
          <td style="color:var(--bad)">${silent > 0 ? fmt(silent) : '<span style="color:var(--good)">0</span>'}</td>
          <td>${fmt(enrolled)}</td>
          <td style="color:var(--good)">${fmt(attending)}</td>
          <td style="color:var(--bad)">${fmt(a.absent)}</td>
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
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:18px">لا توجد مدارس في هذه المديرية.</td></tr>';
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
        <td style="color:var(--good)">${s.silent ? '—' : fmt(s.attending)}</td>
        <td style="color:var(--bad)">${s.silent ? '—' : fmt(s.absent)}</td>
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
    renderNationalAcademic(sheets);        // same fetch, no extra query
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

// ════════════════════════════════════════════════════════════════════════════
//  الخريطة الوطنية
// ════════════════════════════════════════════════════════════════════════════
// Same status thresholds the directorate map uses, so a school reads identically
// in both portals. Built from data loadAllData() already fetched — the only
// change to any query was adding lat/lng to the existing schools select.
let natMap = null;
let natMarkers = [];
let natMapFitted = false;
const NAT_STATUS_LABELS = {
  green: 'طبيعي', amber: 'تغطية ناقصة', red: 'حضور منخفض', no_data: 'لم تُسجّل اليوم',
};
const NAT_STATUS_COLORS = {
  green: '#3fbd80', amber: '#e0a83f', red: '#e2685a', no_data: '#7d8296',
};

function natMarkerIcon(status) {
  const fill = NAT_STATUS_COLORS[status] || NAT_STATUS_COLORS.no_data;
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="31" viewBox="0 0 28 36">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.917 14 22 14 22S28 23.917 28 14C28 6.268 21.732 0 14 0z"
        fill="${fill}" stroke="#11182b" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="6" fill="#11182b" fill-opacity="0.55"/></svg>`,
    className: '', iconSize: [24, 31], iconAnchor: [12, 31], popupAnchor: [0, -31],
  });
}

// A school with no record today is `no_data`, which is a different claim from
// "zero students attended" — it must never be rendered as 0%.
function natSchoolStatus(agg) {
  if (!agg) return { status: 'no_data', rate: null };
  const enrolled = agg.present + agg.late + agg.absent + agg.excused;
  if (enrolled === 0) return { status: 'no_data', rate: null };
  const rate = ((agg.present + agg.late + agg.excused) / enrolled) * 100;
  return { status: rate >= 90 ? 'green' : rate >= 75 ? 'amber' : 'red', rate };
}

function renderNationalMap(schools, perSchool, directorates) {
  const host = document.getElementById('nat-map');
  const emptyEl = document.getElementById('nat-map-empty');
  const countEl = document.getElementById('map-count');
  if (!host || typeof L === 'undefined') return;

  // Number(null) is 0, which is finite — a school with no coordinates would land
  // in the Gulf of Guinea. Require a real, non-zero pair.
  const hasCoords = (s) => {
    const lat = Number(s.lat), lng = Number(s.lng);
    return s.lat != null && s.lng != null
      && Number.isFinite(lat) && Number.isFinite(lng)
      && !(lat === 0 && lng === 0);
  };
  const located = schools.filter(hasCoords);
  if (emptyEl) emptyEl.hidden = located.length > 0;
  host.hidden = located.length === 0;
  if (countEl) countEl.textContent = located.length
    ? `${located.length} مدرسة على الخريطة من ${schools.length}` : '';
  if (!located.length) return;

  if (!natMap) {
    natMap = L.map(host, { zoomControl: true, attributionControl: true })
      .setView([34.8, 38.0], 7);                      // سوريا، حتى يصل fitBounds
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/">OpenStreetMap</a>', maxZoom: 18,
    }).addTo(natMap);
  }

  // Markers are rebuilt on every refresh, which would silently close a popup an
  // operator is reading. Remember which school was open and restore it.
  const openSchoolId = natMarkers.find(m => m.isPopupOpen?.())?._natSchoolId ?? null;
  natMarkers.forEach(m => natMap.removeLayer(m));
  natMarkers = [];

  const dirName = Object.fromEntries((directorates || []).map(d => [d.id, d.name]));
  const bounds = [];
  for (const s of located) {
    const { status, rate } = natSchoolStatus(perSchool?.[s.id]);
    const lat = Number(s.lat), lng = Number(s.lng);
    const marker = L.marker([lat, lng], { icon: natMarkerIcon(status) }).addTo(natMap);
    marker._natStatus = status;
    marker._natSchoolId = s.id;
    marker.bindPopup(
      `<div class="popup-school-name">${esc(s.name ?? '—')}</div>` +
      `<div class="popup-row"><span>المديرية</span><span>${esc(dirName[s.directorate_id] ?? '—')}</span></div>` +
      `<div class="popup-row"><span>الحالة</span><span>${esc(NAT_STATUS_LABELS[status])}</span></div>` +
      `<div class="popup-row"><span>نسبة الحضور</span><span>${rate === null ? '—' : rate.toFixed(1) + '٪'}</span></div>`
    );
    natMarkers.push(marker);
    bounds.push([lat, lng]);
  }

  // Fit once: refitting on every 60s refresh would yank the view out from under
  // anyone who had panned or zoomed in.
  if (!natMapFitted && bounds.length) {
    natMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    natMapFitted = true;
  }
  applyNatMapFilter();
  if (openSchoolId) natMarkers.find(m => m._natSchoolId === openSchoolId)?.openPopup();
  setTimeout(() => natMap.invalidateSize(), 0);
}

function applyNatMapFilter() {
  const on = new Set(
    Array.from(document.querySelectorAll('#nat-map-legend .legend-btn.is-on'))
      .map(b => b.dataset.status)
  );
  for (const m of natMarkers) {
    const el = m.getElement();
    if (!el) continue;
    const show = on.has(m._natStatus);
    el.style.display = show ? '' : 'none';
  }
}

document.getElementById('nat-map-legend')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.legend-btn');
  if (!btn) return;
  btn.classList.toggle('is-on');
  applyNatMapFilter();
});

// ════════════════════════════════════════════════════════════════════════════
//  ترتيب المحافظات حسب نسبة الحضور
// ════════════════════════════════════════════════════════════════════════════
function renderGovRanking(rows) {
  const host = document.getElementById('gov-rank');
  const emptyEl = document.getElementById('gov-rank-empty');
  if (!host) return;

  const ranked = rows
    .map(r => {
      const enrolled = r.present + r.late + r.absent + r.excused;
      return { name: r.governorate, rate: enrolled ? ((r.present + r.late + r.excused) / enrolled) * 100 : null };
    })
    .filter(r => r.rate !== null)
    .sort((a, b) => a.rate - b.rate);   // الأسوأ أولاً — الغرض متابعة المتعثّر

  if (emptyEl) emptyEl.hidden = ranked.length > 0;
  host.innerHTML = ranked.map((r, i) => {
    const color = r.rate >= 90 ? 'var(--good)' : r.rate >= 75 ? 'var(--warn)' : 'var(--bad)';
    return `<div class="rank-row">
      <span class="rank-idx">${i + 1}</span>
      <span class="rank-name" title="${esc(r.name)}">${esc(r.name)}</span>
      <span class="rank-bar-bg"><span class="rank-bar-fill" style="width:${r.rate.toFixed(1)}%;background:${color}"></span></span>
      <span class="rank-val" style="color:${color}">${r.rate.toFixed(0)}٪</span>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════════════════
//  مؤشّرات وطنية إضافية
// ════════════════════════════════════════════════════════════════════════════
// Open reports is a head-only count (no rows transferred). The academic figures
// are folded out of loadNationalResultSheets, which already fetches the sheets.
async function loadNationalHeadline() {
  const el = document.getElementById('stat-open-reports');
  if (!el) return;
  try {
    const { count, error } = await supabase
      .from('emergency_reports')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'acknowledged']);
    if (error) throw error;
    el.textContent = fmt(count ?? 0);
  } catch {
    el.textContent = '—';     // صلاحية أو شبكة — لا تُفشِل بقية اللوحة
  }
}

function renderNationalAcademic(sheets) {
  const issuedEl = document.getElementById('stat-issued');
  const rateEl   = document.getElementById('stat-pass-rate');
  if (issuedEl) issuedEl.textContent = fmt(sheets.length);
  if (!rateEl) return;

  let passed = 0, failed = 0;
  for (const sh of sheets) {
    const students = Array.isArray(sh.snapshot_data?.students) ? sh.snapshot_data.students : [];
    for (const st of students) {
      if (st.result === 'ناجح') passed++;
      else if (st.result === 'راسب') failed++;
    }
  }
  // Over graded students only — an ungraded student is not a failure.
  const graded = passed + failed;
  rateEl.textContent = graded ? `${((passed / graded) * 100).toFixed(1)}%` : '—';
}

// ════════════════════════════════════════════════════════════════════════════
//  البثّ الحيّ الحقيقي
// ════════════════════════════════════════════════════════════════════════════
// The "مباشر" pill used to be decoration: a 60-second timer with a pulsing dot.
// It now carries the real channel state, and a genuine postgres_changes
// subscription drives refreshes. The timer stays as the fallback — if the table
// is not in the `supabase_realtime` publication the portal still works, it just
// reports itself as polling instead of claiming to be live.
let liveChannel = null;
let liveBurstTimer = null;
let liveFeedDate = null;

function setLivePillState(isLive) {
  const pill  = document.getElementById('live-pill');
  const label = document.getElementById('live-label');
  if (!pill || !label) return;
  pill.classList.toggle('is-polling', !isLive);
  label.textContent = isLive ? 'مباشر' : 'تحديث دوري';
  pill.title = isLive
    ? 'متّصل بالبثّ المباشر — تصل التسجيلات فور حدوثها'
    : 'البثّ المباشر غير متاح — التحديث كل ٦٠ ثانية';
}

// A nationwide attendance table produces bursts of row events (a whole class at
// once), and loadAllData() pulls every attendance row in the country. Bursts are
// coalesced AND floored: during a busy morning the events never stop arriving,
// so a plain debounce would still fire a full national reload every few seconds.
// At most one live-driven reload per LIVE_MIN_GAP_MS; the 60s poll covers the
// rest, which caps the portal at roughly two reloads a minute either way.
const LIVE_BURST_MS   = 4000;
const LIVE_MIN_GAP_MS = 30000;
let lastLiveReload = 0;

function scheduleLiveRefresh() {
  if (liveBurstTimer) return;
  const sinceLast = Date.now() - lastLiveReload;
  const delay = Math.max(LIVE_BURST_MS, LIVE_MIN_GAP_MS - sinceLast);
  liveBurstTimer = setTimeout(async () => {
    liveBurstTimer = null;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    lastLiveReload = Date.now();
    // An ops screen left open overnight would keep filtering on yesterday's
    // date, so the channel is rebuilt when the day rolls over.
    if (liveFeedDate && liveFeedDate !== today()) { startLiveFeed(); return; }
    loadAllData();
    resetCountdown();
  }, delay);
}

function startLiveFeed() {
  stopLiveFeed();
  setLivePillState(false);                 // pessimistic until the channel says otherwise
  liveFeedDate = today();
  liveChannel = supabase
    .channel('ministry-live')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'daily_student_attendance', filter: `date=eq.${liveFeedDate}` },
        scheduleLiveRefresh)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'daily_attendance', filter: `date=eq.${liveFeedDate}` },
        scheduleLiveRefresh)
    .subscribe((status) => setLivePillState(status === 'SUBSCRIBED'));
}

function stopLiveFeed() {
  clearTimeout(liveBurstTimer);
  liveBurstTimer = null;
  liveFeedDate = null;
  if (liveChannel) { supabase.removeChannel(liveChannel); liveChannel = null; }
}

// ════════════════════════════════════════════════════════════════════════════
//  جرس الإشعارات
// ════════════════════════════════════════════════════════════════════════════
let minUnsubNotif = null;
let minUnreadCount = 0;

function setNotifBadge(n) {
  minUnreadCount = Math.max(0, n | 0);
  const el = document.getElementById('notif-badge');
  if (!el) return;
  el.textContent = minUnreadCount > 99 ? '99+' : String(minUnreadCount);
  el.hidden = minUnreadCount === 0;
}

function timeAgoAr(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)    return 'الآن';
  if (m < 60)   return `منذ ${m} دقيقة`;
  if (m < 1440) return `منذ ${Math.floor(m / 60)} ساعة`;
  return `منذ ${Math.floor(m / 1440)} يوم`;
}

async function loadNotifList() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  try {
    const items = await window.NSAMS_DB.getNotifications(30);
    if (!items.length) {
      list.innerHTML = '<li class="notif-empty">لا توجد إشعارات</li>';
      return;
    }
    // esc() on every field: notification bodies carry school-supplied text.
    list.innerHTML = items.map(n => `
      <li class="notif-item${n.read_at ? '' : ' is-unread'}">
        <div class="notif-item-title">${esc(n.title)}</div>
        ${n.body ? `<div class="notif-item-body">${esc(n.body)}</div>` : ''}
        <div class="notif-item-time">${esc(timeAgoAr(n.created_at))}</div>
      </li>`).join('');
  } catch (err) {
    console.warn('[NSAMS-M] loadNotifList', err);
    list.innerHTML = '<li class="notif-empty">تعذّر تحميل الإشعارات</li>';
  }
}

function initNotifications(userId) {
  const modal = document.getElementById('modal-notif');

  document.getElementById('btn-notif')?.addEventListener('click', () => {
    if (modal) { modal.hidden = false; loadNotifList(); }
  });
  document.getElementById('btn-notif-close')?.addEventListener('click', () => {
    if (modal) modal.hidden = true;
  });
  modal?.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  document.getElementById('btn-notif-read-all')?.addEventListener('click', async () => {
    await window.NSAMS_DB.markAllNotificationsRead().catch(() => {});
    setNotifBadge(0);
    loadNotifList();
  });

  window.NSAMS_DB.getUnreadNotificationsCount().then(setNotifBadge).catch(() => {});

  if (minUnsubNotif) minUnsubNotif();
  minUnsubNotif = window.NSAMS_DB.subscribeNotifications(userId, (notif) => {
    setNotifBadge(minUnreadCount + 1);
    if (modal && !modal.hidden) loadNotifList();
    // A national report is the one notification worth pulling fresh numbers for.
    if (notif.type === 'report_new') scheduleLiveRefresh();
  });
}
