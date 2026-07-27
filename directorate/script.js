// directorate/script.js
// ── DB من window.NSAMS_DB (يُحمَّل عبر shared/db.js قبل هذا الملف) ──────────
import { CustomSelect }                      from '../shared/csel.js';
import { supabase as _sb, supabaseUrl as _sbUrl } from '../shared/db.js';
const {
  login,
  logout,
  getCurrentUser,
  getTodaySummary,
  getSchoolsAttendanceStatus,
  getReportsForDirectorate,
  updateReportStatus,
  getSchools,
  getDirectorateCompliance,
  sendAttendanceReminder,
  getDirectorateTrend,
  getDirectorateRequests,
  reviewSchoolRequest,
  getDirectorateStatements,
  reviewMonthlyStatement,
  getDirectorateResultSheets,
  reviewResultSheet,
  resolveReportPhotos,
  localDateISO,
} = window.NSAMS_DB;

// Local calendar date (not UTC) with a safe fallback.
function todayLocalISO() {
  if (typeof localDateISO === 'function') return localDateISO();
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ══════════════════════════════════════════════
//  State
// ══════════════════════════════════════════════
let map;
let markersLayer      = {};
let mapFitted         = false;  // frame the directorate's own schools once
let lastSchools       = [];     // cached for re-rendering after a refresh
let lastStatusMap     = {};
let allReports        = [];
// Cached alongside allReports so the unified action queue can merge all four
// sources; the panels themselves render straight from their loaders.
let allRequests       = [];
let allStatements     = [];
let allResultSheets   = [];
let knownReportIds    = null;   // null = first load, no flash
let flashIds          = new Set();
let complianceRows    = [];     // للتصدير CSV
let lightboxState     = { urls: [], idx: 0 };
let refreshTimer;
let countdownInterval;
let currentUser = null;
let trendDays   = 14;
const charts    = {};
const REFRESH_INTERVAL = 30;

// Arabic labels for map status colours
const MAP_STATUS_LABELS = {
  green:   'طبيعي',
  amber:   'تغطية ناقصة',
  red:     'حضور منخفض / طارئ',
  no_data: 'لم تُسجّل اليوم',
};

// Severity labels (same scale as school portal sev-btn 1–5)
const SEV = {
  1: { label: 'منخفض', cls: 'sev-1' },
  2: { label: 'متوسط', cls: 'sev-2' },
  3: { label: 'مرتفع', cls: 'sev-3' },
  4: { label: 'شديد',  cls: 'sev-4' },
  5: { label: 'حرج',   cls: 'sev-5' },
};

// SLA thresholds in hours: sev≥4 = high, sev3 = mid, sev≤2 = low
const SLA_HOURS = { high: 24, mid: 48, low: 72 };

// ══════════════════════════════════════════════
//  Bootstrap
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  setNavDate();
  setupLoginForm();

  const user = await getCurrentUser();
  if (user && user.role === 'directorate_user') {
    currentUser = user;
    showApp(user);
    await loadAll();
    startAutoRefresh();
    initNotificationsDir(user.user.id);
  } else if (user) {
    showLoginError('هذه البوابة مخصصة لموظفي المديرية فقط.');
    await logout();
  }
});

window.addEventListener('online', () => loadAll().catch(() => {}));

// ══════════════════════════════════════════════
//  Login
// ══════════════════════════════════════════════
function setupLoginForm() {
  const btn   = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');

  btn.addEventListener('click', async () => {
    errEl.classList.add('hidden');
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
      showLoginError('يرجى إدخال البريد الإلكتروني وكلمة المرور.');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'جارٍ تسجيل الدخول…';

    try {
      const session = await login(email, password);

      if (session.role !== 'directorate_user') {
        await logout();
        throw new Error('هذا الحساب لا يملك صلاحية الوصول للمديرية.');
      }

      currentUser = session;
      showApp(session);
      await loadAll();
      startAutoRefresh();
      initNotificationsDir(session.user.id);
    } catch (err) {
      showLoginError(err.message || 'فشل تسجيل الدخول، يرجى المحاولة مجدداً.');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'تسجيل الدخول';
    }
  });

  document.getElementById('login-password')
    .addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ══════════════════════════════════════════════
//  Show / hide screens
// ══════════════════════════════════════════════
function showApp(session) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  const displayName = session.user?.fullName || session.user?.email || '';
  document.getElementById('nav-user').textContent = displayName;
  const avatar = document.getElementById('nav-avatar');
  if (avatar && displayName) avatar.textContent = displayName.trim().charAt(0);

  initMap();
  setupMapControls();
  setupLogout();
  setupFilters();
  setupManualRefresh();
  setupReportActionDelegation();
  setupComplianceActions();
  setupCSVExports();
  setupLightbox();
  setupTrendPeriod();
  setupDirTabs();
  setupDirSeg();
  setupDirSchools();
  setupDirPrincipals();
}

// ══════════════════════════════════════════════
//  Logout
// ══════════════════════════════════════════════
function setupLogout() {
  const logoutBtn          = document.getElementById('logout-btn');
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
    clearAutoRefresh();
    await logout();
    location.reload();
  });
}

// ══════════════════════════════════════════════
//  Map
// ══════════════════════════════════════════════
function initMap() {
  if (map) return;

  map = L.map('map', {
    center: [35.2, 38.0],
    zoom: 7,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);
}

function makeMarkerIcon(color) {
  const palette = { green: '#3fbd80', amber: '#e0a83f', red: '#e2685a', no_data: '#7d8296', gray: '#7d8296' };
  const fill = palette[color] || palette.gray;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.917 14 22 14 22S28 23.917 28 14C28 6.268 21.732 0 14 0z"
        fill="${fill}" stroke="#11182b" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="6" fill="#11182b" fill-opacity="0.55"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize:    [28, 36],
    iconAnchor:  [14, 36],
    popupAnchor: [0, -36],
  });
}

function renderMap(schools, statusMap) {
  if (!schools || schools.length === 0) return;

  const currentIds = new Set(schools.map(s => s.id));
  for (const [id, marker] of Object.entries(markersLayer)) {
    if (!currentIds.has(id)) { map.removeLayer(marker); delete markersLayer[id]; }
  }

  for (const school of schools) {
    const info  = statusMap[school.id] || { color: 'no_data', reason: 'no_data', attendanceRate: null, coverageRate: null, enrolled: 0 };
    const color = info.color;
    const icon  = makeMarkerIcon(color);
    const lat   = school.lat;
    const lng   = school.lng;
    if (!lat || !lng) continue;

    const statusLabel = MAP_STATUS_LABELS[color] || color;

    let detailRow = '';
    if (info.reason === 'ok' || info.reason === 'low_coverage' || info.reason === 'low_attendance') {
      const attTxt = info.attendanceRate !== null ? `${info.attendanceRate}%` : '—';
      const covTxt = info.coverageRate   !== null ? `${info.coverageRate}%`   : '—';
      detailRow =
        `<div class="popup-row"><span>نسبة الحضور</span><span>${attTxt}</span></div>` +
        `<div class="popup-row"><span>نسبة التغطية</span><span>${covTxt}</span></div>` +
        `<div class="popup-row"><span>طلاب مُسجّلون اليوم</span><span>${esc(String(info.enrolled))}</span></div>`;
    }

    const popup = `
      <div class="popup-school-name">${esc(school.name)}</div>
      <div class="popup-row"><span>الحالة</span><span>${esc(statusLabel)}</span></div>
      ${detailRow}
      <div class="popup-row" style="margin-top:6px"><a class="popup-link" href="school.html?id=${esc(school.id)}">الملف الكامل ←</a></div>`;

    if (markersLayer[school.id]) {
      markersLayer[school.id].setIcon(icon);
      markersLayer[school.id].setPopupContent(popup);
    } else {
      markersLayer[school.id] = L.marker([lat, lng], { icon })
        .bindPopup(popup)
        .addTo(map);
    }
    // Metadata the legend/search filter reads to dim non-matching pins.
    markersLayer[school.id]._nsamsStatus = color;
    markersLayer[school.id]._nsamsName   = school.name || '';
  }

  const countEl = document.getElementById('map-school-count');
  if (countEl) countEl.textContent = `${schools.length} مدرسة`;
  applyMapFilter();

  renderSchoolRanking(schools, statusMap);

  // Frame the directorate's own schools instead of leaving the view on the
  // national default, which left most directorates staring at empty map.
  // Once only, so a 30s refresh never yanks the view back while panning.
  if (!mapFitted) {
    const pts = schools.filter(s => s.lat && s.lng).map(s => [s.lat, s.lng]);
    if (pts.length) {
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 13 });
      mapFitted = true;
    }
  }
}


// ══════════════════════════════════════════════
//  Map filtering — legend toggles + name search
// ══════════════════════════════════════════════
// Non-matching pins are dimmed rather than removed, so the geography stays
// readable while the matches stand out — same treatment as the design mockup.
function applyMapFilter() {
  const q = (document.getElementById('map-search-input')?.value || '').trim();
  const onStatuses = new Set(
    [...document.querySelectorAll('#map-legend .legend-btn.is-on[data-status]')]
      .map(b => b.dataset.status).filter(sv => sv !== 'all')
  );

  for (const marker of Object.values(markersLayer)) {
    const statusOk = onStatuses.size === 0 || onStatuses.has(marker._nsamsStatus);
    const nameOk   = !q || (marker._nsamsName || '').includes(q);
    const show     = statusOk && nameOk;
    marker.setOpacity(show ? 1 : 0.18);
    const el = marker.getElement();
    if (el) el.style.zIndex = show ? '' : '-1';
  }
}

function setupMapControls() {
  document.getElementById('map-search-input')?.addEventListener('input', applyMapFilter);

  const legend = document.getElementById('map-legend');
  legend?.addEventListener('click', (e) => {
    const btn = e.target.closest('.legend-btn');
    if (!btn) return;
    if (btn.dataset.status === 'all') {
      legend.querySelectorAll('.legend-btn').forEach(b => b.classList.add('is-on'));
    } else {
      btn.classList.toggle('is-on');
      legend.querySelector('.legend-btn[data-status="all"]')?.classList.remove('is-on');
      // Nothing selected = everything selected; a fully-empty map helps no one.
      if (!legend.querySelector('.legend-btn.is-on[data-status]:not([data-status="all"])')) {
        legend.querySelectorAll('.legend-btn').forEach(b => b.classList.add('is-on'));
      }
    }
    applyMapFilter();
  });
}

// ══════════════════════════════════════════════
//  School ranking by attendance rate
// ══════════════════════════════════════════════
// Same data that colours the map (getSchoolsAttendanceStatus), shown as a
// ranked comparison — the map answers "where", this answers "who is worst".
// Ascending, because the point is chasing the schools that are struggling.
function renderSchoolRanking(schools, statusMap) {
  const container = document.getElementById('ranking-list');
  if (!container) return;

  if (!schools || schools.length === 0) {
    container.innerHTML = '<p class="empty-state">لا توجد مدارس بعد.</p>';
    return;
  }

  const rows = schools.map(s => {
    const info = statusMap[s.id] || {};
    return {
      id:   s.id,
      name: s.name,
      rate: typeof info.attendanceRate === 'number' ? info.attendanceRate : null,
    };
  });

  // Schools that never reported today sink to the bottom with an explicit
  // "no data" tag — showing them as 0% would claim nobody attended, which is
  // a different (and false) statement.
  rows.sort((a, b) => {
    if (a.rate === null && b.rate === null) return (a.name || '').localeCompare(b.name || '', 'ar');
    if (a.rate === null) return 1;
    if (b.rate === null) return -1;
    return a.rate - b.rate;
  });

  container.innerHTML = rows.map((r, i) => {
    const color = r.rate === null ? 'var(--text-muted)'
                : r.rate < 75 ? 'var(--red)'
                : r.rate < 90 ? 'var(--amber)'
                : 'var(--green)';
    const value = r.rate === null
      ? '<span class="rank-nodata">لا بيانات</span>'
      : `<span class="rank-val" style="color:${color}">${esc(String(r.rate))}٪</span>`;
    return `
      <div class="rank-row">
        <span class="rank-idx">${i + 1}</span>
        <a class="rank-name" href="school.html?id=${esc(r.id)}" title="${esc(r.name ?? '')}">${esc(r.name ?? '—')}</a>
        <span class="rank-bar-bg"><span class="rank-bar-fill" style="width:${r.rate ?? 0}%;background:${color}"></span></span>
        ${value}
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
//  Stats
// ══════════════════════════════════════════════
async function loadStats() {
  if (!currentUser?.directorateId) return;
  try {
    const summary = await getTodaySummary(currentUser.directorateId);
    if (!summary) return;

    animateStatEl('stat-teachers-val', summary.totalTeachersPresent);
    animateStatEl('stat-admins-val',   summary.totalAdminsPresent ?? 0);
    animateStatEl('stat-workers-val',  summary.totalWorkersPresent ?? 0);
    animateStatEl('stat-students-val', summary.totalStudentsPresent);
    animateStatEl('stat-schools-val',  summary.reportingSchoolsCount ?? 0);
    animateStatEl('stat-reports-val',  summary.topPendingReports?.length ?? 0);
    const subEl = document.getElementById('stat-reports-sub');
    if (subEl) subEl.textContent = '';
  } catch (err) {
    console.error('[Stats] Failed:', err);
    showToast('خطأ في الإحصائيات', 'تعذّر تحميل الملخص.', 'error');
  }
}

// ══════════════════════════════════════════════
//  Map + Compliance combined load
// ══════════════════════════════════════════════
async function loadMapAndCompliance() {
  if (!currentUser?.directorateId) return;

  try {
    const today = todayLocalISO();
    const [schools, statusMap] = await Promise.all([
      getSchools(currentUser.directorateId),
      getSchoolsAttendanceStatus(currentUser.directorateId, today),
    ]);
    lastSchools   = schools;
    lastStatusMap = statusMap;
    renderMap(schools, statusMap);

    // لوحة الالتزام — try/catch مستقل لئلا يُسقط فشل RPC الخريطةَ
    try {
      const compliance = await getDirectorateCompliance(30);
      await renderCompliance(schools, compliance);
    } catch (compErr) {
      console.warn('[Compliance] RPC unavailable:', compErr);
      const tbody = document.getElementById('compliance-tbody');
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="empty-state">شغّل القسم 6 من database-setup.sql لتفعيل لوحة الالتزام.</td></tr>';
      showToast('لوحة الالتزام', 'شغّل القسم 6 من database-setup.sql لتفعيل هذه الميزة.', 'warning');
    }
  } catch (err) {
    console.error('[Map] Failed:', err);
    showToast('خطأ في الخريطة', 'تعذّر تحميل مواقع المدارس.', 'error');
  }
}

// ══════════════════════════════════════════════
//  Compliance
// ══════════════════════════════════════════════
async function countWorkingDays(daysBack) {
  let count = 0;
  const d = new Date();
  let holidays = new Set();
  try {
    const rows = await NSAMS_DB.getHolidays();
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

async function renderCompliance(schools, compliance) {
  const byId = Object.fromEntries((compliance || []).map(c => [c.school_id, c]));
  const workingDays = (await countWorkingDays(30)) || 1;

  const total     = schools.length;
  const submitted = schools.filter(s => byId[s.id]?.reported_today === true).length;
  const pct       = total > 0 ? Math.round(submitted / total * 100) : 0;

  // شريط التقدم
  const countEl = document.getElementById('compliance-count');
  const totalEl = document.getElementById('compliance-total');
  const barEl   = document.getElementById('compliance-bar');
  const pctEl   = document.getElementById('compliance-pct');
  if (countEl) countEl.textContent = submitted;
  if (totalEl) totalEl.textContent = total;
  if (pctEl)   pctEl.textContent   = pct + '%';
  if (barEl) {
    barEl.style.width = pct + '%';
    barEl.className   = 'progress-fill' + (pct >= 90 ? '' : pct >= 60 ? ' yellow' : ' red');
  }

  // شارات المدارس الصامتة
  const silent  = schools.filter(s => !byId[s.id]?.reported_today);
  const silentEl = document.getElementById('silent-schools');
  if (silentEl) {
    if (silent.length === 0) {
      silentEl.innerHTML = '<p class="empty-state" style="padding:10px 18px">جميع المدارس أرسلت حضور اليوم ✓</p>';
    } else {
      silentEl.innerHTML = silent.map(s =>
        `<span class="silent-chip">
          ${esc(s.name)}
          <button class="btn btn-warning btn-sm" data-action="remind" data-school="${esc(s.id)}"
            style="margin-inline-start:4px">تذكير</button>
        </span>`
      ).join('');
    }
  }

  // جدول الالتزام
  const rows = schools.map(s => {
    const c   = byId[s.id];
    const dr  = c ? c.days_reported : 0;
    const mp  = Math.min(100, Math.round(dr / workingDays * 100));
    return { id: s.id, name: s.name, today: !!c?.reported_today, daysReported: dr, monthPct: mp };
  }).sort((a, b) => {
    if (a.today !== b.today) return a.today ? 1 : -1;
    return a.monthPct - b.monthPct;
  });

  complianceRows = rows;

  const tbody = document.getElementById('compliance-tbody');
  if (!tbody) return;
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">لا توجد مدارس.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="td-primary"><a class="school-link" href="school.html?id=${esc(r.id)}">${esc(r.name)}</a></td>
      <td>
        ${r.today
          ? '<span class="badge badge--green">أرسلت</span>'
          : '<span class="badge badge--amber">لم تُرسل</span>'}
      </td>
      <td>${r.daysReported} / ${workingDays}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="bar-mini"><span style="width:${r.monthPct}%;display:block;height:100%;background:var(--blue);border-radius:999px"></span></span>
          <span style="font-size:.82rem">${r.monthPct}%</span>
        </div>
      </td>
      <td>
        ${!r.today
          ? `<button class="btn btn-warning btn-sm" data-action="remind" data-school="${esc(r.id)}">تذكير</button>`
          : ''}
      </td>
    </tr>
  `).join('');
}

// ══════════════════════════════════════════════
//  Compliance actions (remind / remind-all)
// ══════════════════════════════════════════════
function setupComplianceActions() {
  const panel = document.getElementById('compliance-panel');
  if (!panel) return;

  panel.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action="remind"][data-school]');
    if (!btn) return;
    await handleRemind(btn.dataset.school, btn);
  });

  document.getElementById('remind-all-btn')?.addEventListener('click', remindAllSilent);
}

async function handleRemind(schoolId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const n = await sendAttendanceReminder(schoolId);
    if (n > 0) {
      showToast('تذكير مُرسَل', `أُرسل التذكير إلى ${n} مدير.`, 'success');
      if (btn) { btn.textContent = 'تم ✓'; }
    } else {
      showToast('تذكير مسبق', 'أُرسل تذكير إلى هذه المدرسة خلال آخر 30 دقيقة.', 'info');
      if (btn) { btn.disabled = false; btn.textContent = 'تذكير'; }
    }
  } catch (err) {
    console.error('[Remind] Failed:', err);
    showToast('خطأ في التذكير', err.message || 'تعذّر إرسال التذكير.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'تذكير'; }
  }
}

async function remindAllSilent() {
  const silent = complianceRows.filter(r => !r.today);
  if (silent.length === 0) {
    showToast('لا يوجد متأخر', 'جميع المدارس أرسلت حضور اليوم.', 'info');
    return;
  }
  const btn = document.getElementById('remind-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = '…جاري الإرسال'; }
  let sent = 0;
  for (const row of silent) {
    try {
      const n = await sendAttendanceReminder(row.id);
      if (n > 0) sent++;
    } catch (_) { /* تجاهل — التالية */ }
  }
  showToast('اكتمل التذكير', `أُرسل التذكير لـ ${sent} من ${silent.length} مدرسة.`, 'success');
  if (btn) { btn.disabled = false; btn.textContent = 'تذكير جميع المتأخرة'; }
}

// ══════════════════════════════════════════════
//  Reports
// ══════════════════════════════════════════════
async function loadReports() {
  if (!currentUser?.directorateId) return;
  try {
    const fresh = await getReportsForDirectorate(currentUser.directorateId) || [];

    // تتبع الصفوف الجديدة للوميض
    const freshIds = new Set(fresh.map(r => r.id));
    flashIds = knownReportIds
      ? new Set([...freshIds].filter(id => !knownReportIds.has(id)))
      : new Set();
    knownReportIds = freshIds;

    allReports = fresh;
    renderReportsTable();
    renderPendingList();
    refreshRailCounts();
  } catch (err) {
    console.error('[Reports] Failed:', err);
    showToast('خطأ في التقارير', 'تعذّر تحميل التقارير.', 'error');
    document.getElementById('reports-tbody').innerHTML =
      '<tr><td colspan="7" class="empty-state">تعذّر تحميل التقارير.</td></tr>';
  }
}

// مساعدات الخطورة والصور والـ SLA
function sevBadge(sev) {
  const s = SEV[sev];
  return s
    ? `<span class="sev-badge ${s.cls}">${sev} · ${s.label}</span>`
    : '<span class="sev-badge sev-none">—</span>';
}

function isOverdue(r) {
  if (r.status === 'resolved') return false;
  const h = (Date.now() - new Date(r.created_at).getTime()) / 3_600_000;
  const limit = (r.severity >= 4) ? SLA_HOURS.high
              : (r.severity === 3) ? SLA_HOURS.mid
              : SLA_HOURS.low;
  return h > limit;
}

function photoBtn(r) {
  const n = r.media_urls?.length || 0;
  if (!n) return '';
  return `<button class="btn btn-ghost btn-sm" data-action="photos" data-id="${esc(r.id)}" style="margin-inline-end:4px">📷 ${n}</button>`;
}

function getFilteredReports() {
  const statusFilter   = document.getElementById('filter-status')?.value   || '';
  const typeFilter     = document.getElementById('filter-type')?.value     || '';
  const severityFilter = document.getElementById('filter-severity')?.value || '';
  const search         = (document.getElementById('filter-search')?.value || '').trim().toLowerCase();
  const fromStr        = document.getElementById('filter-from')?.value || '';
  const toStr          = document.getElementById('filter-to')?.value   || '';

  // Compare on the local calendar date, not raw timestamps: a report filed at
  // 23:30 must still count as that day when the range ends on that day.
  const from = fromStr || null;
  const to   = toStr   || null;

  return allReports.filter(r => {
    if (statusFilter   && r.status          !== statusFilter)       return false;
    if (typeFilter     && r.type            !== typeFilter)         return false;
    if (severityFilter && String(r.severity ?? '') !== severityFilter) return false;

    if (search) {
      const haystack = `${r.description ?? ''} ${r.schoolName ?? ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    if (from || to) {
      const day = localDateISO(new Date(r.created_at));
      if (from && day < from) return false;
      if (to   && day > to)   return false;
    }
    return true;
  });
}

function renderReportsTable() {
  const filtered = getFilteredReports();
  const tbody    = document.getElementById('reports-tbody');

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty-state">لا توجد تقارير مطابقة للفلاتر الحالية.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const overdue    = isOverdue(r);
    const isNew      = flashIds.has(r.id);
    const rowClass   = [overdue ? 'row-overdue' : '', isNew ? 'row-flash' : ''].filter(Boolean).join(' ');
    const overdueTag = overdue ? '<span class="overdue-tag">متأخر</span>' : '';

    return `
    <tr data-id="${esc(r.id)}"${rowClass ? ` class="${rowClass}"` : ''}>
      <td class="td-primary">${r.school?.id
        ? `<a class="school-link" href="school.html?id=${esc(r.school.id)}">${esc(r.schoolName ?? '—')}</a>`
        : esc(r.schoolName ?? '—')}</td>
      <td><span class="type-badge type-${esc(r.type)}">${esc(formatType(r.type))}</span></td>
      <td>${sevBadge(r.severity)}</td>
      <td class="td-desc" title="${esc(r.description ?? '')}">${esc(r.description ?? '—')}</td>
      <td>${esc(formatDate(r.created_at))}</td>
      <td><span class="status-badge status-${esc(r.status)}">${esc(formatStatus(r.status))}</span>${overdueTag}</td>
      <td>
        <div class="table-actions">
          ${photoBtn(r)}
          ${r.status === 'open'
            ? `<button class="btn btn-warning btn-sm" data-action="acknowledged" data-id="${esc(r.id)}">مراجعة</button>`
            : ''}
          ${r.status !== 'resolved'
            ? `<button class="btn btn-success btn-sm" data-action="resolved" data-id="${esc(r.id)}">حل</button>`
            : `<button class="btn btn-ghost btn-sm" disabled>تم الحل</button>`}
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Unified action queue ─────────────────────────────────────────────────────
// Everything awaiting a decision — field reports, school requests, monthly
// statements and result sheets — merged into one urgency-sorted list, so the
// overview answers "what needs me right now?" without touching four sections.
// Approvals count as late after this many hours without a decision. Reports
// keep their own severity-based SLA (isOverdue).
const APPROVAL_SLA_HOURS = 48;

function hoursSince(ts) {
  if (!ts) return 0;
  return (Date.now() - new Date(ts).getTime()) / 3_600_000;
}

function buildActionQueue() {
  const items = [];

  for (const r of allReports) {
    if (r.status !== 'open' && r.status !== 'acknowledged') continue;
    items.push({
      kind: 'report', id: r.id, at: r.created_at, overdue: isOverdue(r),
      school: r.schoolName ?? '—', report: r,
    });
  }
  for (const r of allRequests) {
    if (r.status !== 'pending') continue;
    items.push({
      kind: 'request', id: r.id, at: r.created_at,
      overdue: hoursSince(r.created_at) > APPROVAL_SLA_HOURS,
      school: r.school?.name ?? '—',
      title: REQ_TYPE_AR[r.type] ?? r.type,
      selector: '.dir-req-review-btn',
    });
  }
  for (const s of allStatements) {
    if (s.status !== 'submitted') continue;
    items.push({
      kind: 'statement', id: s.id, at: s.submitted_at,
      overdue: hoursSince(s.submitted_at) > APPROVAL_SLA_HOURS,
      school: s.school?.name ?? '—',
      title: `بيان ${MONTH_AR[s.month] ?? s.month} ${s.year}`,
      selector: '.dir-stmt-review-btn',
    });
  }
  for (const s of allResultSheets) {
    if (s.status !== 'submitted' && s.status !== 'approved') continue;
    const cls = s.class ? `الصف ${s.class.grade} / ${s.class.section ?? ''}`.trim() : '';
    items.push({
      kind: 'result_sheet', id: s.id, at: s.submitted_at,
      overdue: hoursSince(s.submitted_at) > APPROVAL_SLA_HOURS,
      school: s.school?.name ?? '—',
      title: (s.status === 'approved' ? 'جلاء بانتظار الإصدار' : 'جلاء بانتظار الاعتماد')
             + (cls ? ` — ${cls}` : ''),
      selector: '.dir-rs-review-btn',
    });
  }

  // Late first, then oldest first — the longer something has waited, the
  // higher it climbs regardless of type.
  items.sort((a, b) => (b.overdue - a.overdue) || (new Date(a.at || 0) - new Date(b.at || 0)));
  return items;
}

const QUEUE_KIND_LABEL = {
  report:       'بلاغ',
  request:      'طلب مدرسة',
  statement:    'بيان شهري',
  result_sheet: 'جلاء',
};
const QUEUE_KIND_ICON = {
  report:       'icon-alert',
  request:      'icon-clipboard',
  statement:    'icon-clock',
  result_sheet: 'icon-check',
};

function renderPendingList() {
  const items = buildActionQueue();

  const countEl = document.getElementById('pending-count');
  countEl.textContent = items.length;
  countEl.className   = `badge ${items.length > 0 ? 'badge--amber' : 'badge--green'}`;

  const container = document.getElementById('pending-list');
  if (items.length === 0) {
    container.innerHTML = '<p class="empty-state">لا يوجد ما ينتظر إجراءك.</p>';
    return;
  }

  container.innerHTML = items.map(it => {
    const overdueTag = it.overdue ? '<span class="overdue-tag">متأخر</span>' : '';
    const kindTag    = `<span class="queue-kind queue-kind--${it.kind}">${esc(QUEUE_KIND_LABEL[it.kind])}</span>`;
    const kindIcon   = `<span class="queue-ic queue-ic--${it.kind}"><svg class="icon"><use href="#${QUEUE_KIND_ICON[it.kind]}"/></svg></span>`;

    if (it.kind === 'report') {
      const r = it.report;
      const isNew = flashIds.has(r.id);
      const cls = ['pending-card', it.overdue ? 'row-overdue' : '', isNew ? 'row-flash' : ''].filter(Boolean).join(' ');
      return `
      <div class="${cls}" data-id="${esc(r.id)}">
        ${kindIcon}
        <div class="queue-main">
          <div class="queue-head">
            <span class="pending-school">${esc(it.school)}</span>
            ${kindTag}${sevBadge(r.severity)}${overdueTag}
          </div>
          <div class="pending-desc">${esc(r.description ?? '—')}</div>
          <div class="pending-time">${esc(formatType(r.type))} · ${esc(formatDate(r.created_at))}</div>
          <div class="pending-actions">
            ${photoBtn(r)}
            ${r.status === 'open'
              ? `<button class="btn btn-warning btn-sm" data-action="acknowledged" data-id="${esc(r.id)}">تمت المراجعة</button>`
              : ''}
            <button class="btn btn-success btn-sm" data-action="resolved" data-id="${esc(r.id)}">حل</button>
          </div>
        </div>
      </div>`;
    }

    return `
    <div class="pending-card${it.overdue ? ' row-overdue' : ''}">
      ${kindIcon}
      <div class="queue-main">
        <div class="queue-head">
          <span class="pending-school">${esc(it.school)}</span>
          ${kindTag}${overdueTag}
        </div>
        <div class="pending-desc">${esc(it.title)}</div>
        <div class="pending-time">${esc(formatDate(it.at))}</div>
        <div class="pending-actions">
          <button class="btn btn-primary btn-sm queue-goto"
                  data-selector="${esc(it.selector)}" data-target="${esc(it.id)}">مراجعة</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// Jump from a queue item to the approvals section and open that row's existing
// review modal. loadAll renders every section regardless of visibility, so the
// matching button is already in the DOM — no separate modal logic needed here.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.queue-goto');
  if (!btn) return;
  const { selector, target } = btn.dataset;

  _dirNavDepth++;
  history.pushState({ tab: 'approvals', d: _dirNavDepth }, '', '#approvals');
  _dirActivateTab('approvals');

  const reviewBtn = document.querySelector(`${selector}[data-id="${CSS.escape(target)}"]`);
  if (reviewBtn) {
    reviewBtn.click();
  } else {
    showToast('تعذّر فتح العنصر', 'حدّث الصفحة ثم أعد المحاولة.', 'warning');
  }
});

async function handleStatusUpdate(reportId, newStatus) {
  const btns = document.querySelectorAll(`[data-id="${reportId}"] button`);
  btns.forEach(b => (b.disabled = true));
  try {
    await updateReportStatus(reportId, newStatus);
    const label = formatStatus(newStatus);
    showToast('تم تحديث الحالة', `تم تعيين التقرير كـ "${label}".`, 'success');
    await loadReports();
  } catch (err) {
    console.error('[Reports] Status update failed:', err);
    showToast('فشل التحديث', err.message || 'تعذّر تحديث الحالة.', 'error');
    btns.forEach(b => (b.disabled = false));
  }
}

function setupReportActionDelegation() {
  const handler = (e) => {
    const btn = e.target.closest('button[data-action][data-id]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'photos') {
      const r = allReports.find(x => x.id === id);
      if (r?.media_urls?.length) {
        resolveReportPhotos(r.media_urls).then(urls => { if (urls.length) openLightbox(urls, 0); });
      }
      return;
    }
    handleStatusUpdate(id, action);
  };
  document.getElementById('reports-tbody').addEventListener('click', handler);
  document.getElementById('pending-list').addEventListener('click', handler);
}

function setupFilters() {
  CustomSelect.enhance('filter-status');
  CustomSelect.enhance('filter-type');
  CustomSelect.enhance('filter-severity');
  CustomSelect.enhance('dir-sm-classification');
  CustomSelect.enhance('dir-sm-education-type');
  CustomSelect.enhance('dir-sm-shift');
  CustomSelect.enhance('dir-sm-student-type');
  CustomSelect.enhance('dir-pm-school');
  document.getElementById('filter-status')?.addEventListener('change', renderReportsTable);
  document.getElementById('filter-type')?.addEventListener('change', renderReportsTable);
  document.getElementById('filter-severity')?.addEventListener('change', renderReportsTable);
  document.getElementById('filter-search')?.addEventListener('input',  renderReportsTable);
  document.getElementById('filter-from')?.addEventListener('change',   renderReportsTable);
  document.getElementById('filter-to')?.addEventListener('change',     renderReportsTable);

  // Schools / principals search — both filter the already-loaded arrays.
  document.getElementById('dir-schools-search')?.addEventListener('input', (e) => {
    renderDirSchoolRows(filterSchools(e.target.value));
  });
  document.getElementById('dir-principals-search')?.addEventListener('input', (e) => {
    renderDirPrincipalRows(filterPrincipals(e.target.value));
  });
}

function filterSchools(q) {
  const s = (q || '').trim().toLowerCase();
  if (!s) return _dirAllSchools;
  return _dirAllSchools.filter(x =>
    `${x.name ?? ''} ${x.classification ?? ''} ${x.complex_name ?? ''}`.toLowerCase().includes(s));
}

function filterPrincipals(q) {
  const s = (q || '').trim().toLowerCase();
  if (!s) return _dirAllPrincipals;
  return _dirAllPrincipals.filter(u =>
    `${u.full_name ?? ''} ${u.schools?.name ?? ''}`.toLowerCase().includes(s));
}

// ══════════════════════════════════════════════
//  Lightbox
// ══════════════════════════════════════════════
function setupLightbox() {
  const lb      = document.getElementById('lightbox');
  const closeBtn = document.getElementById('lightbox-close');
  const prevBtn  = document.getElementById('lightbox-prev');
  const nextBtn  = document.getElementById('lightbox-next');
  if (!lb) return;

  closeBtn?.addEventListener('click', closeLightbox);
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });

  // RTL: ArrowRight = السابق، ArrowLeft = التالي
  const keyHandler = (e) => {
    if (lb.hidden) return;
    if (e.key === 'Escape')      { closeLightbox(); return; }
    if (e.key === 'ArrowRight')  { moveLightbox(-1); return; }
    if (e.key === 'ArrowLeft')   { moveLightbox(+1); return; }
  };
  lb.addEventListener('keydown', keyHandler, false);

  prevBtn?.addEventListener('click', () => moveLightbox(-1));
  nextBtn?.addEventListener('click', () => moveLightbox(+1));
}

function openLightbox(urls, idx) {
  lightboxState = { urls, idx };
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.hidden = false;
  lb.focus?.();
  updateLightboxFrame();
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb) lb.hidden = true;
}

function moveLightbox(delta) {
  const { urls, idx } = lightboxState;
  const newIdx = (idx + delta + urls.length) % urls.length;
  lightboxState.idx = newIdx;
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
//  CSV exports
// ══════════════════════════════════════════════
function downloadCSV(filename, rows) {
  const escCell = v => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const csv = rows.map(r => r.map(escCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportReportsCSV() {
  const filtered = getFilteredReports();
  if (!filtered.length) { showToast('تصدير', 'لا توجد تقارير لتصديرها.', 'info'); return; }

  const headers = ['المدرسة', 'النوع', 'الخطورة', 'الوصف', 'الحالة', 'رقم الإيصال', 'تاريخ الإرسال', 'عدد المرفقات'];
  const dataRows = filtered.map(r => [
    r.schoolName ?? '',
    formatType(r.type),
    r.severity != null ? `${r.severity} - ${SEV[r.severity]?.label ?? ''}` : '—',
    r.description ?? '',
    formatStatus(r.status),
    r.receipt_number ?? '',
    r.created_at ? new Date(r.created_at).toLocaleString('en-GB') : '',
    r.media_urls?.length ?? 0,
  ]);

  downloadCSV(`nsams_reports_${todayLocalISO()}.csv`, [headers, ...dataRows]);
}

async function exportComplianceCSV() {
  if (!complianceRows.length) { showToast('تصدير', 'بيانات الالتزام غير متوفرة.', 'info'); return; }

  const workingDays = (await countWorkingDays(30)) || 1;
  const headers     = ['المدرسة', 'أرسلت اليوم', 'أيام مُرسلة', 'أيام العمل (30ي)', 'نسبة الالتزام %'];
  const dataRows    = complianceRows.map(r => [
    r.name,
    r.today ? 'نعم' : 'لا',
    r.daysReported,
    workingDays,
    r.monthPct,
  ]);

  downloadCSV(`nsams_compliance_${todayLocalISO()}.csv`, [headers, ...dataRows]);
}

function setupCSVExports() {
  document.getElementById('export-reports-btn')?.addEventListener('click', exportReportsCSV);
  document.getElementById('export-compliance-btn')?.addEventListener('click', exportComplianceCSV);
}

// ══════════════════════════════════════════════
//  Trend charts (Chart.js — light/RTL)
// ══════════════════════════════════════════════
// Grid/tick/tooltip colours are read from the page's own design tokens: the
// previous values were a dark-canvas palette left over from an earlier theme,
// so gridlines and tick labels sat almost invisible on the light card.
const CHART_FONT = "'Segoe UI', system-ui, sans-serif";
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
const CH = {
  grid:      cssVar('--line-soft', '#202a48'),
  tick:      cssVar('--text-muted', '#75809c'),
  tooltipBg: cssVar('--blue-dark', '#0b1120'),
  green: cssVar('--good',   '#3fbd80'),
  blue:  cssVar('--accent', '#35b3ac'),
  amber: cssVar('--warn',   '#e0a83f'),
  red:   cssVar('--bad',    '#e2685a'),
  purple: cssVar('--purple', '#a78bfa'),
};
// Canvas fillStyle cannot parse color-mix(), so the area fill is derived here.
CH.blueFill = hexToRgba(CH.blue, 0.18);

function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return `rgba(53,179,172,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

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
        titleColor: cssVar('--ink', '#eef1f8'), bodyColor: cssVar('--ink-soft', '#aab3c8'), padding: 10,
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
        backgroundColor: CH.blueFill,
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

async function loadTrend() {
  const emptyEl = document.getElementById('trend-empty');
  try {
    const rows = await getDirectorateTrend(trendDays);
    const hasData = rows.some(r => (r.present + r.late + r.absent + r.excused) > 0);
    if (emptyEl) {
      // الـ RPC يعمل — الفراغ هنا يعني فترة بلا تسجيل، لا قسماً ناقصاً
      emptyEl.textContent = 'لا يوجد حضور مسجّل خلال هذه الفترة — تظهر المنحنيات فور تسجيل المدارس للحضور.';
      emptyEl.hidden = hasData;
    }

    const labels = rows.map(r => trendLabel(r.day));
    const rates  = rows.map(r => {
      const en = r.present + r.late + r.absent + r.excused;
      return en ? +(((r.present + r.late + r.excused) / en) * 100).toFixed(1) : null;
    });

    upsertChart(charts, 'rate', 'trend-rate-chart', rateLineConfig, labels, [rates]);
    upsertChart(charts, 'stack', 'trend-stack-chart', stackBarConfig, labels, [
      rows.map(r => r.present),
      rows.map(r => r.late),
      rows.map(r => r.excused),
      rows.map(r => r.absent),
    ]);
  } catch (err) {
    console.warn('[Trend] RPC unavailable:', err);
    if (emptyEl) {
      emptyEl.textContent = 'تعذّر جلب الاتجاه — تأكد من تشغيل القسم 7 من database-setup.sql.';
      emptyEl.hidden = false;
    }
  }
}

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
    loadTrend();
  });
}

// ══════════════════════════════════════════════
//  Orchestrator
// ══════════════════════════════════════════════
async function loadDropoutSummary() {
  const loadingEl   = document.getElementById('dropout-loading');
  const tableWrap   = document.getElementById('dropout-table-wrap');
  const emptyEl     = document.getElementById('dropout-empty');
  const tbody       = document.getElementById('dropout-tbody');
  if (!loadingEl) return;

  loadingEl.hidden = false;
  if (tableWrap) tableWrap.hidden = true;
  if (emptyEl)   emptyEl.hidden   = true;

  try {
    const rows = await NSAMS_DB.getDirectorateDropoutSummary();
    loadingEl.hidden = true;
    if (!rows || rows.length === 0) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${esc(r.school_name)}</td>
        <td style="color:${(r.at_risk_count || 0) > 0 ? 'var(--red)' : 'inherit'};font-weight:600">
          ${r.at_risk_count ?? 0}
        </td>
        <td>${r.flagged_count ?? 0}</td>
      </tr>`).join('');
    if (tableWrap) tableWrap.hidden = false;
  } catch (err) {
    loadingEl.hidden = true;
    if (emptyEl) { emptyEl.textContent = 'تعذّر تحميل بيانات التسرب.'; emptyEl.hidden = false; }
    console.warn('[Dropout]', err);
  }
}

document.getElementById('reload-dropout-btn')?.addEventListener('click', loadDropoutSummary);
document.getElementById('reload-periodic-btn')?.addEventListener('click', loadPeriodicReports);

async function loadAll() {
  await Promise.allSettled([loadStats(), loadMapAndCompliance(), loadReports(), loadTrend(), loadRequests(), loadStatements(), loadResultSheets(), loadDropoutSummary(), loadPeriodicReports()]);
  // After every list has settled. loadReports renders the queue too, but it
  // runs in parallel with the three approval loaders, so at that point their
  // arrays may still be empty — this pass is the one that sees all four.
  renderPendingList();
  refreshRailCounts();
}

// ══════════════════════════════════════════════
//  التقارير الشهرية
// ══════════════════════════════════════════════
async function loadPeriodicReports() {
  const loadingEl = document.getElementById('periodic-loading');
  const tableWrap = document.getElementById('periodic-table-wrap');
  const emptyEl   = document.getElementById('periodic-empty');
  const tbody     = document.getElementById('periodic-tbody');
  if (!tbody) return;

  loadingEl?.classList.remove('hidden');
  tableWrap?.setAttribute('hidden', '');
  emptyEl?.setAttribute('hidden', '');
  tbody.innerHTML = '';

  try {
    const reports = await NSAMS_DB.getPeriodicReports('directorate');
    loadingEl?.classList.add('hidden');
    if (!reports.length) { emptyEl?.removeAttribute('hidden'); return; }

    reports.forEach(r => {
      const d = r.data || {};
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(r.period)}</td>
        <td>${d.schools_count ?? '—'}</td>
        <td>${d.attendance_rate != null ? d.attendance_rate + '٪' : '—'}</td>
        <td>${d.dropout_flagged ?? '—'}</td>
        <td>${d.emergency_reports ?? '—'}</td>
        <td><button class="btn btn-ghost btn-sm" data-rep-id="${r.id}" data-period="${esc(r.period)}">
          طباعة
        </button></td>`;
      tbody.appendChild(tr);
    });

    tableWrap?.removeAttribute('hidden');

    tbody.querySelectorAll('[data-rep-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rep = reports.find(x => x.id === btn.dataset.repId);
        if (rep) printMonthlyReport(rep);
      });
    });
  } catch (err) {
    loadingEl?.classList.add('hidden');
    console.error('[NSAMS] loadPeriodicReports', err);
    if (emptyEl) { emptyEl.textContent = 'تعذّر تحميل التقارير الشهرية.'; emptyEl.removeAttribute('hidden'); }
  }
}

function printMonthlyReport(rep) {
  const d = rep.data || {};
  const dirName = d.directorate_name || '';
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl">
<head><meta charset="utf-8">
<title>التقرير الشهري — ${rep.period}</title>
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
<h1>التقرير الشهري${dirName ? ' — ' + dirName : ''}</h1>
<p class="sub">الفترة: ${rep.period} &nbsp;|&nbsp; تاريخ التوليد: ${new Date(rep.created_at).toLocaleDateString('ar-SY')}</p>
<table>
  <thead><tr><th>المؤشر</th><th>القيمة</th></tr></thead>
  <tbody>
    <tr><td>عدد المدارس</td><td>${d.schools_count ?? '—'}</td></tr>
    <tr><td>نسبة الحضور</td><td>${d.attendance_rate != null ? d.attendance_rate + '٪' : '—'}</td></tr>
    <tr><td>عدد الحاضرين (الفترة)</td><td>${d.present_count ?? '—'}</td></tr>
    <tr><td>عدد الغائبين (الفترة)</td><td>${d.absent_count ?? '—'}</td></tr>
    <tr><td>أيام التسجيل</td><td>${d.reporting_days ?? '—'}</td></tr>
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

// ══════════════════════════════════════════════
//  Auto-refresh
// ══════════════════════════════════════════════
function startAutoRefresh() {
  clearAutoRefresh();
  let remaining = REFRESH_INTERVAL;

  countdownInterval = setInterval(() => {
    remaining -= 1;
    const el = document.getElementById('countdown-val');
    if (el) el.textContent = remaining;
    if (remaining <= 0) remaining = REFRESH_INTERVAL;
  }, 1000);

  refreshTimer = setInterval(async () => {
    remaining = REFRESH_INTERVAL;
    if (document.visibilityState !== 'visible') return;
    await loadAll();
  }, REFRESH_INTERVAL * 1000);
}

function clearAutoRefresh() {
  clearInterval(refreshTimer);
  clearInterval(countdownInterval);
}

function setupManualRefresh() {
  document.getElementById('manual-refresh-btn')?.addEventListener('click', async () => {
    clearAutoRefresh();
    await loadAll();
    const el = document.getElementById('countdown-val');
    if (el) el.textContent = REFRESH_INTERVAL;
    startAutoRefresh();
    showToast('تم التحديث', 'تم تحديث بيانات اللوحة.', 'info');
  });
}

// ══════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════
function setNavDate() {
  const el = document.getElementById('nav-date');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
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
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// عدّاد متحرك لقيمة رقمية (لا يُحرِّك النص أو القيم المتساوية)
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

function animateStatEl(id, value) {
  const el = document.getElementById(id);
  if (el) animateValue(el, value);
}

// ══════════════════════════════════════════════
//  Toast
// ══════════════════════════════════════════════
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
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

// ══════════════════════════════════════════════
//  Notifications
// ══════════════════════════════════════════════
let _dirUnreadCount = 0;
let _dirUnsubNotif  = null;

function updateDirNotifBadge(n) {
  _dirUnreadCount = n;
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  badge.textContent = n > 0 ? String(Math.min(n, 99)) : '';
  badge.style.display = n > 0 ? 'block' : 'none';
  badge.hidden = n <= 0;
}

async function loadDirNotifList() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  try {
    const items = await window.NSAMS_DB.getNotifications(30);
    if (!items.length) {
      list.innerHTML = '<li style="padding:32px 16px;text-align:center;color:var(--text-muted);font-size:.9rem">لا توجد إشعارات</li>';
      return;
    }
    list.innerHTML = items.map(n => {
      const diff = Date.now() - new Date(n.created_at).getTime();
      const m    = Math.floor(diff / 60000);
      const ago  = m < 1 ? 'الآن' : m < 60 ? `منذ ${m} دقيقة` : m < 1440 ? `منذ ${Math.floor(m/60)} ساعة` : `منذ ${Math.floor(m/1440)} يوم`;
      const bg   = !n.read_at ? 'background:var(--accent-tint);' : '';
      return `<li style="${bg}padding:12px 16px;border-bottom:1px solid var(--border-light);direction:rtl">
        <div style="font-weight:600;font-size:.9rem">${n.title}</div>
        ${n.body ? `<div style="font-size:.82rem;color:var(--text-secondary);margin-top:2px">${n.body}</div>` : ''}
        <div style="font-size:.75rem;color:var(--text-muted);margin-top:4px">${ago}</div>
      </li>`;
    }).join('');
  } catch (e) { console.warn('[NSAMS-D] loadDirNotifList', e); }
}

function initNotificationsDir(userId) {
  const modal    = document.getElementById('modal-notif');
  const btnOpen  = document.getElementById('btn-notif');

  btnOpen?.addEventListener('click', () => {
    if (modal) { modal.style.display = 'flex'; loadDirNotifList(); }
  });
  document.getElementById('btn-notif-close')?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
  });
  modal?.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  document.getElementById('btn-notif-read-all')?.addEventListener('click', async () => {
    await window.NSAMS_DB.markAllNotificationsRead().catch(() => {});
    updateDirNotifBadge(0);
    loadDirNotifList();
  });

  window.NSAMS_DB.getUnreadNotificationsCount().then(updateDirNotifBadge).catch(() => {});

  if (_dirUnsubNotif) _dirUnsubNotif();
  _dirUnsubNotif = window.NSAMS_DB.subscribeNotifications(userId, (notif) => {
    updateDirNotifBadge(_dirUnreadCount + 1);
    showToast(notif.title, notif.body ?? '', 'info');
    // OS notifications come from web push (the SW push handler). The page-context
    // `new Notification()` constructor throws on Android, so it is not used here.
    if (notif.type === 'report_new') loadReports().catch(() => {});
    if (notif.type === 'statement_submitted') loadStatements().catch(() => {});
    if (notif.type === 'result_sheet_submitted') loadResultSheets().catch(() => {});
  });

  Notification.requestPermission().then((perm) => {
    if (perm === 'granted') window.NSAMS_DB.registerPushSubscription().catch(() => {});
  });
}

// ══════════════════════════════════════════════
//  Workflow requests (طلبات المدارس)
// ══════════════════════════════════════════════

const REQ_TYPE_AR = {
  add_class:       'إضافة شعبة',
  add_student:     'تسجيل طالب',
  correct_student: 'تصحيح بيانات',
};

let _reviewingReqId = null;

async function loadRequests() {
  if (!currentUser?.directorateId) return;
  const listEl    = document.getElementById('dir-req-list');
  const loadEl    = document.getElementById('dir-req-loading');
  const wrapEl    = document.getElementById('dir-req-table-wrap');
  const emptyEl   = document.getElementById('dir-req-empty');
  const countEl   = document.getElementById('dir-req-count');
  if (!listEl) return;

  if (loadEl) loadEl.hidden = false;
  if (wrapEl) wrapEl.hidden = true;
  listEl.innerHTML = '';
  if (emptyEl) emptyEl.hidden = true;

  try {
    const reqs = await getDirectorateRequests(currentUser.directorateId);
    allRequests = reqs;   // set before the empty-list early return below
    if (loadEl) loadEl.hidden = true;
    const pending = reqs.filter(r => r.status === 'pending').length;
    if (countEl) {
      countEl.textContent = pending ? `${pending} طلب معلّق` : '';
      countEl.hidden = !pending;
    }
    if (!reqs.length) { if (emptyEl) emptyEl.hidden = false; return; }
    reqs.forEach(r => listEl.appendChild(buildReqRow(r)));
    if (wrapEl) wrapEl.hidden = false;
  } catch (err) {
    console.error('[DirRequests] load', err);
    if (loadEl) loadEl.hidden = true;
  }
}

function buildReqRow(r) {
  const tr   = document.createElement('tr');
  const date = r.created_at
    ? new Date(r.created_at).toLocaleDateString('ar-SY', { day: 'numeric', month: 'short' })
    : '—';
  const schoolName = r.school?.name ?? '—';
  const typeLabel  = REQ_TYPE_AR[r.type] ?? r.type;
  const statusHtml = r.status === 'pending'
    ? `<span class="dir-req-badge dir-req-badge--pending">بانتظار المراجعة</span>`
    : r.status === 'approved'
      ? `<span class="dir-req-badge dir-req-badge--approved">مقبول ✓</span>`
      : `<span class="dir-req-badge dir-req-badge--rejected">مرفوض ✗</span>`;

  const reviewBtn = r.status === 'pending'
    ? `<button class="btn btn-sm btn-primary dir-req-review-btn" data-id="${esc(r.id)}"
         data-type="${esc(r.type)}" data-school="${esc(schoolName)}"
         data-payload='${esc(JSON.stringify(r.payload))}'>مراجعة</button>`
    : `<span class="dir-req-reason">${r.review_reason ? esc(r.review_reason) : '—'}</span>`;

  tr.innerHTML = `
    <td>${esc(schoolName)}</td>
    <td>${esc(typeLabel)}</td>
    <td>${esc(date)}</td>
    <td>${statusHtml}</td>
    <td>${reviewBtn}</td>
  `;
  return tr;
}

// Open review modal
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.dir-req-review-btn');
  if (!btn) return;
  _reviewingReqId = btn.dataset.id;
  const type     = btn.dataset.type;
  const school   = btn.dataset.school;
  const payload  = JSON.parse(btn.dataset.payload || '{}');

  document.getElementById('dir-review-title').textContent =
    `مراجعة طلب: ${REQ_TYPE_AR[type] ?? type} — ${school}`;
  document.getElementById('dir-review-body').innerHTML = buildPayloadSummary(type, payload);
  document.getElementById('dir-review-reason').value   = '';
  document.getElementById('dir-review-msg').hidden     = true;
  document.getElementById('dir-review-modal').classList.remove('hidden');
});

function buildPayloadSummary(type, p) {
  const rows = [];
  if (type === 'add_class') {
    rows.push(['الصف', p.grade ? `الصف ${p.grade}` : '—']);
    rows.push(['الشعبة', p.section ?? '—']);
    if (p.note) rows.push(['ملاحظة', p.note]);
  } else if (type === 'add_student') {
    rows.push(['الاسم', [p.first_name, p.father_name, p.family_name].filter(Boolean).join(' ')]);
    if (p.national_id) rows.push(['الرقم الوطني', p.national_id]);
    if (p.gender)      rows.push(['الجنس', p.gender === 'male' ? 'ذكر' : 'أنثى']);
    if (p.birth_date)  rows.push(['تاريخ الميلاد', p.birth_date]);
  } else if (type === 'correct_student') {
    const FIELD_AR = { first_name:'الاسم', father_name:'اسم الأب', family_name:'الكنية',
                       national_id:'الرقم الوطني', birth_date:'تاريخ الميلاد' };
    const field = Object.keys(FIELD_AR).find(k => p[k] !== undefined && k !== 'student_id' && k !== 'reason');
    if (field) rows.push([`تصحيح ${FIELD_AR[field] ?? field}`, p[field]]);
    if (p.reason) rows.push(['السبب', p.reason]);
  }
  return rows.map(([k,v]) =>
    `<div class="dir-req-detail"><span>${esc(k)}</span><strong>${esc(String(v ?? '—'))}</strong></div>`
  ).join('');
}

// Approve / reject buttons
document.getElementById('dir-btn-approve')?.addEventListener('click', () => doReview('approved'));
document.getElementById('dir-btn-reject')?.addEventListener('click',  () => doReview('rejected'));

async function doReview(decision) {
  if (!_reviewingReqId) return;
  const reason  = document.getElementById('dir-review-reason')?.value.trim() || null;
  const msgEl   = document.getElementById('dir-review-msg');
  const approveBtn = document.getElementById('dir-btn-approve');
  const rejectBtn  = document.getElementById('dir-btn-reject');
  if (approveBtn) approveBtn.disabled = true;
  if (rejectBtn)  rejectBtn.disabled  = true;
  msgEl.hidden = true;
  try {
    await reviewSchoolRequest(_reviewingReqId, decision, reason);
    closeReviewModal();
    showToast(
      decision === 'approved' ? 'تمت الموافقة وتطبيق الطلب ✓' : 'تم رفض الطلب',
      '', decision === 'approved' ? 'success' : 'info'
    );
    loadRequests();
  } catch (err) {
    console.error('[DirRequests] review', err);
    msgEl.className = 'msg msg-error';
    msgEl.textContent = err?.message ?? 'تعذّرت المراجعة';
    msgEl.hidden = false;
  } finally {
    if (approveBtn) approveBtn.disabled = false;
    if (rejectBtn)  rejectBtn.disabled  = false;
  }
}

document.getElementById('dir-btn-review-cancel')?.addEventListener('click', closeReviewModal);
document.getElementById('dir-review-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'dir-review-modal') closeReviewModal();
});

function closeReviewModal() {
  _reviewingReqId = null;
  document.getElementById('dir-review-modal')?.classList.add('hidden');
}

// ══════════════════════════════════════════════
//  البيانات الشهرية (مراجعة البيان الشهري)
// ══════════════════════════════════════════════

const MONTH_AR = ['', 'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];

let _reviewingStmtId = null;

async function loadStatements() {
  if (!currentUser?.directorateId) return;
  const listEl  = document.getElementById('dir-stmt-list');
  const loadEl  = document.getElementById('dir-stmt-loading');
  const wrapEl  = document.getElementById('dir-stmt-table-wrap');
  const emptyEl = document.getElementById('dir-stmt-empty');
  const countEl = document.getElementById('dir-stmt-count');
  if (!listEl) return;

  if (loadEl) loadEl.hidden = false;
  if (wrapEl) wrapEl.hidden = true;
  listEl.innerHTML = '';
  if (emptyEl) emptyEl.hidden = true;

  try {
    const stmts = await getDirectorateStatements();
    allStatements = stmts;   // set before the empty-list early return below
    if (loadEl) loadEl.hidden = true;
    // المُرسَل أولاً، ثم الأحدث إرسالاً
    stmts.sort((a, b) => {
      if (a.status === 'submitted' && b.status !== 'submitted') return -1;
      if (b.status === 'submitted' && a.status !== 'submitted') return 1;
      return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
    });
    const pending = stmts.filter(s => s.status === 'submitted').length;
    if (countEl) {
      countEl.textContent = pending ? `${pending} بانتظار المراجعة` : '';
      countEl.hidden = !pending;
    }
    if (!stmts.length) { if (emptyEl) emptyEl.hidden = false; return; }
    stmts.forEach(s => listEl.appendChild(buildStmtRow(s)));
    if (wrapEl) wrapEl.hidden = false;
  } catch (err) {
    console.error('[DirStatements] load', err);
    if (loadEl) loadEl.hidden = true;
  }
}

function buildStmtRow(s) {
  const tr = document.createElement('tr');
  const schoolName = s.school?.name ?? '—';
  const period = `${MONTH_AR[s.month] ?? s.month} ${s.year}`;
  const statusHtml = s.status === 'submitted'
    ? `<span class="dir-req-badge dir-req-badge--pending">بانتظار المراجعة</span>`
    : s.status === 'approved'
      ? `<span class="dir-req-badge dir-req-badge--approved">معتمد ✓</span>`
      : s.status === 'rejected'
        ? `<span class="dir-req-badge dir-req-badge--rejected">مرفوض ✗</span>`
        : `<span class="dir-req-badge">مسودة</span>`;

  const actionHtml = s.status === 'submitted'
    ? `<button class="btn btn-sm btn-primary dir-stmt-review-btn" data-id="${esc(s.id)}"
         data-school="${esc(schoolName)}" data-period="${esc(period)}"
         data-snap='${esc(JSON.stringify(s.snapshot_data || {}))}'>مراجعة</button>`
    : `<span class="dir-req-reason">${s.notes ? esc(s.notes) : '—'}</span>`;

  tr.innerHTML = `
    <td>${esc(schoolName)}</td>
    <td>${esc(period)}</td>
    <td>${statusHtml}</td>
    <td>${actionHtml}</td>
  `;
  return tr;
}

// فتح مودال مراجعة البيان
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.dir-stmt-review-btn');
  if (!btn) return;
  _reviewingStmtId = btn.dataset.id;
  const school = btn.dataset.school;
  const period = btn.dataset.period;
  let snap = {};
  try { snap = JSON.parse(btn.dataset.snap || '{}'); } catch { /* tolerate */ }

  document.getElementById('dir-stmt-title').textContent = `مراجعة بيان: ${school} — ${period}`;
  document.getElementById('dir-stmt-body').innerHTML = buildStmtSummary(snap);
  document.getElementById('dir-stmt-notes').value = '';
  document.getElementById('dir-stmt-msg').hidden = true;
  document.getElementById('dir-stmt-modal').classList.remove('hidden');
});

function buildStmtSummary(snap) {
  const rows = [];
  const students = Array.isArray(snap.students) ? snap.students : [];
  let totSec = 0, totM = 0, totF = 0;
  for (const s of students) {
    totSec += (+s.sections || 0);
    totM   += (+s.enM || 0) + (+s.frM || 0) + (+s.ruM || 0);
    totF   += (+s.enF || 0) + (+s.frF || 0) + (+s.ruF || 0);
  }
  rows.push(['عدد الشعب', totSec]);
  rows.push(['إجمالي الذكور', totM]);
  rows.push(['إجمالي الإناث', totF]);
  rows.push(['إجمالي الطلاب', totM + totF]);

  const sc = snap.staffCounts || {};
  const totalStaff = (sc.admin || 0) + (sc.teaching || 0) + (sc.professional || 0) + (sc.worker || 0) + (sc.guard || 0);
  rows.push(['إجمالي العاملين', totalStaff]);
  rows.push(['إداري / تدريسي', `${sc.admin || 0} / ${sc.teaching || 0}`]);
  rows.push(['مهني / مستخدم / حارس', `${sc.professional || 0} / ${sc.worker || 0} / ${sc.guard || 0}`]);

  let html = rows.map(([k, v]) =>
    `<div class="dir-req-detail"><span>${esc(k)}</span><strong>${esc(String(v ?? '—'))}</strong></div>`
  ).join('');

  const leaves = Array.isArray(snap.leaveLines) ? snap.leaveLines : [];
  if (leaves.length) {
    html += `<div class="dir-req-detail" style="flex-direction:column;align-items:flex-start;gap:4px">
      <span>إجازات الشهر</span>
      <small style="color:var(--text-secondary)">${leaves.map(l => esc(l)).join(' — ')}</small>
    </div>`;
  }
  return html;
}

// موافقة / رفض البيان
document.getElementById('dir-stmt-approve')?.addEventListener('click', () => doStmtReview('approved'));
document.getElementById('dir-stmt-reject')?.addEventListener('click',  () => doStmtReview('rejected'));

async function doStmtReview(decision) {
  if (!_reviewingStmtId) return;
  const notes      = document.getElementById('dir-stmt-notes')?.value.trim() || null;
  const msgEl      = document.getElementById('dir-stmt-msg');
  const approveBtn = document.getElementById('dir-stmt-approve');
  const rejectBtn  = document.getElementById('dir-stmt-reject');
  if (approveBtn) approveBtn.disabled = true;
  if (rejectBtn)  rejectBtn.disabled  = true;
  if (msgEl) msgEl.hidden = true;
  try {
    await reviewMonthlyStatement(_reviewingStmtId, decision, notes);
    closeStmtModal();
    showToast(
      decision === 'approved' ? 'تم اعتماد البيان ✓' : 'تم رفض البيان',
      '', decision === 'approved' ? 'success' : 'info'
    );
    loadStatements();
  } catch (err) {
    console.error('[DirStatements] review', err);
    if (msgEl) {
      msgEl.className = 'msg msg-error';
      msgEl.textContent = err?.message ?? 'تعذّرت المراجعة';
      msgEl.hidden = false;
    }
  } finally {
    if (approveBtn) approveBtn.disabled = false;
    if (rejectBtn)  rejectBtn.disabled  = false;
  }
}

document.getElementById('dir-stmt-cancel')?.addEventListener('click', closeStmtModal);
document.getElementById('dir-stmt-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'dir-stmt-modal') closeStmtModal();
});

function closeStmtModal() {
  _reviewingStmtId = null;
  document.getElementById('dir-stmt-modal')?.classList.add('hidden');
}

// ══════════════════════════════════════════════
//  الجلاءات (مراجعة/إصدار النتائج النهائية)
// ══════════════════════════════════════════════
let _reviewingSheetId = null;
let _reviewingSheetStatus = null;
const RS_TERM_AR = { s1: 'الفصل الأول', s2: 'الفصل الثاني', year: 'النتيجة السنوية' };

async function loadResultSheets() {
  if (!currentUser?.directorateId) return;
  const listEl  = document.getElementById('dir-rs-list');
  const loadEl  = document.getElementById('dir-rs-loading');
  const wrapEl  = document.getElementById('dir-rs-table-wrap');
  const emptyEl = document.getElementById('dir-rs-empty');
  const countEl = document.getElementById('dir-rs-count');
  if (!listEl) return;

  if (loadEl) loadEl.hidden = false;
  if (wrapEl) wrapEl.hidden = true;
  listEl.innerHTML = '';
  if (emptyEl) emptyEl.hidden = true;

  try {
    const sheets = await getDirectorateResultSheets();
    allResultSheets = sheets;   // set before the empty-list early return below
    if (loadEl) loadEl.hidden = true;
    // المُرسَل أولاً، ثم المعتمد (بانتظار الإصدار)، ثم الأحدث
    const rank = s => s.status === 'submitted' ? 0 : s.status === 'approved' ? 1 : 2;
    sheets.sort((a, b) => rank(a) - rank(b) ||
      (new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0)));
    const pending = sheets.filter(s => s.status === 'submitted' || s.status === 'approved').length;
    if (countEl) {
      countEl.textContent = pending ? `${pending} بانتظار الإجراء` : '';
      countEl.hidden = !pending;
    }
    if (!sheets.length) { if (emptyEl) emptyEl.hidden = false; return; }
    sheets.forEach(s => listEl.appendChild(buildRsRow(s)));
    if (wrapEl) wrapEl.hidden = false;
  } catch (err) {
    console.error('[DirResultSheets] load', err);
    if (loadEl) loadEl.hidden = true;
  }
}

function buildRsRow(s) {
  const tr = document.createElement('tr');
  const schoolName = s.school?.name ?? '—';
  const clsLabel = s.class ? `الصف ${s.class.grade} / ${s.class.section ?? ''}`.trim() : '—';
  const termLabel = RS_TERM_AR[s.term] ?? s.term;
  const badge = {
    submitted: ['dir-req-badge--pending',  'بانتظار المراجعة'],
    approved:  ['dir-req-badge--pending',  'معتمد — بانتظار الإصدار'],
    issued:    ['dir-req-badge--approved', 'صادر ✓'],
    rejected:  ['dir-req-badge--rejected', 'مرفوض ✗'],
    draft:     ['', 'مسودة'],
  }[s.status] || ['', s.status];
  const statusHtml = `<span class="dir-req-badge ${badge[0]}">${esc(badge[1])}</span>`;

  const actionable = s.status === 'submitted' || s.status === 'approved';
  const actionHtml = actionable
    ? `<button class="btn btn-sm btn-primary dir-rs-review-btn" data-id="${esc(s.id)}"
         data-status="${esc(s.status)}" data-school="${esc(schoolName)}"
         data-label="${esc(clsLabel + ' — ' + termLabel)}"
         data-snap='${esc(JSON.stringify(s.snapshot_data || {}))}'>${s.status === 'approved' ? 'إصدار' : 'مراجعة'}</button>`
    : `<span class="dir-req-reason">${s.notes ? esc(s.notes) : '—'}</span>`;

  tr.innerHTML = `
    <td>${esc(schoolName)}</td>
    <td>${esc(clsLabel)} <small style="color:var(--text-secondary)">(${esc(termLabel)})</small></td>
    <td>${statusHtml}</td>
    <td>${actionHtml}</td>
  `;
  return tr;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.dir-rs-review-btn');
  if (!btn) return;
  _reviewingSheetId = btn.dataset.id;
  _reviewingSheetStatus = btn.dataset.status;
  let snap = {};
  try { snap = JSON.parse(btn.dataset.snap || '{}'); } catch { /* tolerate */ }

  document.getElementById('dir-rs-title').textContent =
    `${_reviewingSheetStatus === 'approved' ? 'إصدار جلاء' : 'مراجعة جلاء'}: ${btn.dataset.school} — ${btn.dataset.label}`;
  document.getElementById('dir-rs-body').innerHTML = buildRsSummary(snap);
  document.getElementById('dir-rs-notes').value = '';
  document.getElementById('dir-rs-msg').hidden = true;

  // أزرار حسب الحالة: submitted → موافقة/رفض · approved → إصدار/رفض
  const approveBtn = document.getElementById('dir-rs-approve');
  const issueBtn   = document.getElementById('dir-rs-issue');
  if (approveBtn) approveBtn.hidden = _reviewingSheetStatus !== 'submitted';
  if (issueBtn)   issueBtn.hidden   = _reviewingSheetStatus !== 'approved';

  document.getElementById('dir-rs-modal').classList.remove('hidden');
});

function buildRsSummary(snap) {
  const students = Array.isArray(snap.students) ? snap.students : [];
  const total = students.length;
  const passed = students.filter(s => s.result === 'ناجح').length;
  const failed = students.filter(s => s.result === 'راسب').length;
  const incomplete = students.filter(s => !s.complete).length;
  const rows = [
    ['الفصل', RS_TERM_AR[snap.term] ?? snap.term ?? '—'],
    ['إجمالي الطلاب', total],
    ['ناجح', passed],
    ['راسب', failed],
  ];
  if (incomplete) rows.push(['غير مكتمل', incomplete]);
  return rows.map(([k, v]) =>
    `<div class="dir-req-detail"><span>${esc(k)}</span><strong>${esc(String(v ?? '—'))}</strong></div>`
  ).join('');
}

document.getElementById('dir-rs-approve')?.addEventListener('click', () => doRsReview('approved'));
document.getElementById('dir-rs-issue')?.addEventListener('click',   () => doRsReview('issued'));
document.getElementById('dir-rs-reject')?.addEventListener('click',  () => doRsReview('rejected'));

async function doRsReview(decision) {
  if (!_reviewingSheetId) return;
  const notes      = document.getElementById('dir-rs-notes')?.value.trim() || null;
  const msgEl      = document.getElementById('dir-rs-msg');
  const buttons    = ['dir-rs-approve','dir-rs-issue','dir-rs-reject'].map(id => document.getElementById(id));
  buttons.forEach(b => { if (b) b.disabled = true; });
  if (msgEl) msgEl.hidden = true;
  try {
    await reviewResultSheet(_reviewingSheetId, decision, notes);
    closeRsModal();
    const msg = decision === 'issued' ? 'صدر الجلاء نهائياً ✓'
      : decision === 'approved' ? 'تم اعتماد الجلاء ✓' : 'تم رفض الجلاء';
    showToast(msg, '', decision === 'rejected' ? 'info' : 'success');
    loadResultSheets();
  } catch (err) {
    console.error('[DirResultSheets] review', err);
    if (msgEl) {
      msgEl.className = 'msg msg-error';
      msgEl.textContent = err?.message ?? 'تعذّرت المراجعة';
      msgEl.hidden = false;
    }
  } finally {
    buttons.forEach(b => { if (b) b.disabled = false; });
  }
}

document.getElementById('dir-rs-cancel')?.addEventListener('click', closeRsModal);
document.getElementById('dir-rs-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'dir-rs-modal') closeRsModal();
});

function closeRsModal() {
  _reviewingSheetId = null;
  _reviewingSheetStatus = null;
  document.getElementById('dir-rs-modal')?.classList.add('hidden');
}

// ══════════════════════════════════════════════
//  Helpers للتبويبات الجديدة
// ══════════════════════════════════════════════
function dirEsc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function dirEdgeFetch(path, body) {
  const { data: { session } } = await _sb.auth.getSession();
  const res = await fetch(`${_sbUrl}/functions/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// ══════════════════════════════════════════════
//  Tab switching + history
// ══════════════════════════════════════════════
let _dirNavDepth = 0;

function _dirActivateTab(tabName) {
  document.querySelectorAll('.dir-tab-btn').forEach(b => {
    b.classList.remove('is-active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.dir-tab-panel').forEach(p => p.classList.remove('is-active'));
  const btn = document.querySelector(`.dir-tab-btn[data-tab="${tabName}"]`);
  if (btn) { btn.classList.add('is-active'); btn.setAttribute('aria-selected', 'true'); }
  document.getElementById(`dir-tab-${tabName}`)?.classList.add('is-active');

  // Schools and principals now share one section, so both lists load together.
  if (tabName === 'schools') { loadDirSchools(); loadDirPrincipals(); }

  // Leaflet measures 0×0 while its panel is display:none, so it must be told to
  // re-measure whenever the overview becomes visible again.
  if (tabName === 'overview' && map) setTimeout(() => map.invalidateSize(), 0);
}

// Segmented control inside the "schools" section (schools ⇄ principals).
function setupDirSeg() {
  document.querySelectorAll('.dir-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dir-seg-btn').forEach(b => {
        b.classList.remove('is-active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      const showPrincipals = btn.dataset.seg === 'principals';
      const s = document.getElementById('dir-seg-schools');
      const p = document.getElementById('dir-seg-principals');
      if (s) s.hidden = showPrincipals;
      if (p) p.hidden = !showPrincipals;
    });
  });
}

// Pending-work counters on the rail, so the badge is visible from any section.
function refreshRailCounts() {
  const setCount = (id, n) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(n);
    el.hidden = n <= 0;
  };
  setCount('rail-count-reports', allReports.filter(r => r.status === 'open').length);

  // Each list renders a review button only for rows still awaiting a decision,
  // so counting those buttons is the same "pending" set the panels show.
  const pendingRs   = document.querySelectorAll('#dir-rs-list   .dir-rs-review-btn').length;
  const pendingStmt = document.querySelectorAll('#dir-stmt-list .dir-stmt-review-btn').length;
  const pendingReq  = document.querySelectorAll('#dir-req-list  .dir-req-review-btn').length;
  setCount('rail-count-approvals', pendingRs + pendingStmt + pendingReq);
}

function setupDirTabs() {
  history.replaceState({ tab: 'overview', d: 0 }, '', '#overview');

  document.querySelectorAll('.dir-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _dirNavDepth++;
      history.pushState({ tab: btn.dataset.tab, d: _dirNavDepth }, '', '#' + btn.dataset.tab);
      _dirActivateTab(btn.dataset.tab);
    });
  });

  // History still drives section changes, so the device/browser back button
  // walks back through sections — the old in-page back button was redundant.
  window.addEventListener('popstate', e => {
    _dirNavDepth = e.state?.d ?? 0;
    const tab = e.state?.tab;
    if (tab) _dirActivateTab(tab);
  });
}

// ══════════════════════════════════════════════
//  تبويب المدارس
// ══════════════════════════════════════════════
let _dirAllSchools     = [];
let _dirEditingSchoolId = null;

async function loadDirSchools() {
  if (!currentUser?.directorateId) return;
  const countEl   = document.getElementById('dir-schools-count');
  const loadingEl = document.getElementById('dir-schools-loading');
  const tableEl   = document.getElementById('dir-schools-table-wrap');
  const emptyEl   = document.getElementById('dir-schools-empty');
  loadingEl?.classList.remove('hidden');
  tableEl?.classList.add('hidden');
  emptyEl?.classList.add('hidden');

  const { data, error } = await _sb.from('schools')
    .select('id, name, classification, education_type, shift, student_type, total_students, total_teachers, lat, lng, complex_name, directorate_id')
    .eq('directorate_id', currentUser.directorateId)
    .order('name');

  loadingEl?.classList.add('hidden');
  if (error) { if (countEl) countEl.textContent = '!'; console.error(error); return; }
  _dirAllSchools = data ?? [];
  if (countEl) countEl.textContent = _dirAllSchools.length;

  // أعِد ملء قائمة المدارس في مودال المدير
  const pmSchoolEl = document.getElementById('dir-pm-school');
  if (pmSchoolEl) {
    while (pmSchoolEl.options.length > 1) pmSchoolEl.remove(1);
    _dirAllSchools.forEach(s => pmSchoolEl.add(new Option(s.name, s.id)));
    CustomSelect.refresh('dir-pm-school');
  }

  if (_dirAllSchools.length === 0) { emptyEl?.classList.remove('hidden'); return; }

  // Re-apply whatever the user had typed, so a background refresh doesn't
  // silently widen the list back to every school.
  const q = document.getElementById('dir-schools-search')?.value || '';
  renderDirSchoolRows(filterSchools(q));
  tableEl?.classList.remove('hidden');
}

function renderDirSchoolRows(list) {
  const tbody = document.getElementById('dir-schools-tbody');
  if (!tbody) return;

  const countEl = document.getElementById('dir-schools-count');
  if (countEl) countEl.textContent = list.length;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">لا توجد مدرسة مطابقة للبحث.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map((s, i) => `
    <tr>
      <td class="muted">${i + 1}</td>
      <td>${dirEsc(s.name)}</td>
      <td>${dirEsc(s.classification ?? '—')}</td>
      <td>${s.total_students ?? '—'}</td>
      <td>${s.total_teachers ?? '—'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" data-dir-edit-school="${dirEsc(s.id)}">
          <svg width="13" height="13"><use href="#icon-edit"/></svg>
          تعديل
        </button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-dir-edit-school]').forEach(btn => {
    btn.addEventListener('click', () => openEditDirSchool(btn.dataset.dirEditSchool));
  });
}

function openAddDirSchool() {
  _dirEditingSchoolId = null;
  const title = document.getElementById('dir-school-modal-title');
  if (title) title.textContent = 'إضافة مدرسة';
  ['dir-sm-name','dir-sm-lat','dir-sm-lng','dir-sm-total-students','dir-sm-total-teachers','dir-sm-complex-name'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  ['dir-sm-classification','dir-sm-education-type','dir-sm-shift','dir-sm-student-type'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const errEl = document.getElementById('dir-school-modal-error');
  if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
  document.getElementById('dir-school-modal')?.classList.remove('hidden');
  document.getElementById('dir-sm-name')?.focus();
}

function openEditDirSchool(schoolId) {
  const s = _dirAllSchools.find(x => x.id === schoolId);
  if (!s) return;
  _dirEditingSchoolId = schoolId;
  const title = document.getElementById('dir-school-modal-title');
  if (title) title.textContent = 'تعديل مدرسة';
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  set('dir-sm-name', s.name);
  set('dir-sm-lat', s.lat);
  set('dir-sm-lng', s.lng);
  set('dir-sm-classification', s.classification);
  set('dir-sm-education-type', s.education_type);
  set('dir-sm-shift', s.shift);
  set('dir-sm-student-type', s.student_type);
  set('dir-sm-total-students', s.total_students);
  set('dir-sm-total-teachers', s.total_teachers);
  set('dir-sm-complex-name', s.complex_name);
  const errEl = document.getElementById('dir-school-modal-error');
  if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
  document.getElementById('dir-school-modal')?.classList.remove('hidden');
  document.getElementById('dir-sm-name')?.focus();
}

function setupDirSchools() {
  document.getElementById('dir-add-school-btn')?.addEventListener('click', openAddDirSchool);
  document.getElementById('dir-school-modal-close')?.addEventListener('click', () => {
    document.getElementById('dir-school-modal')?.classList.add('hidden');
  });
  document.getElementById('dir-school-modal-cancel')?.addEventListener('click', () => {
    document.getElementById('dir-school-modal')?.classList.add('hidden');
  });

  document.getElementById('dir-school-modal-save')?.addEventListener('click', async () => {
    const name = document.getElementById('dir-sm-name')?.value.trim() ?? '';
    const errEl = document.getElementById('dir-school-modal-error');
    const saveBtn = document.getElementById('dir-school-modal-save');
    if (!name) {
      if (errEl) { errEl.textContent = 'اسم المدرسة مطلوب.'; errEl.hidden = false; }
      return;
    }
    if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
    if (saveBtn) saveBtn.disabled = true;

    const getVal = id => document.getElementById(id)?.value ?? '';
    const getNum = id => { const v = getVal(id); return v !== '' ? parseFloat(v) : null; };
    const getInt = id => { const v = getVal(id); return v !== '' ? parseInt(v, 10) : null; };

    const row = {
      name,
      directorate_id:  currentUser.directorateId,
      lat:             getNum('dir-sm-lat'),
      lng:             getNum('dir-sm-lng'),
      classification:  getVal('dir-sm-classification')   || null,
      education_type:  getVal('dir-sm-education-type')   || null,
      shift:           getVal('dir-sm-shift')            || null,
      student_type:    getVal('dir-sm-student-type')     || null,
      total_students:  getInt('dir-sm-total-students'),
      total_teachers:  getInt('dir-sm-total-teachers'),
      complex_name:    getVal('dir-sm-complex-name').trim() || null,
    };

    try {
      let err;
      if (_dirEditingSchoolId) {
        ({ error: err } = await _sb.from('schools').update(row).eq('id', _dirEditingSchoolId));
      } else {
        ({ error: err } = await _sb.from('schools').insert(row));
      }
      if (err) throw err;
      document.getElementById('dir-school-modal')?.classList.add('hidden');
      await loadDirSchools();
    } catch (e) {
      if (errEl) { errEl.textContent = e.message; errEl.hidden = false; }
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

// ══════════════════════════════════════════════
//  تبويب المدراء
// ══════════════════════════════════════════════
let _dirAllPrincipals    = [];
let _dirPendingDeactivate = null;

async function loadDirPrincipals() {
  if (!currentUser?.directorateId) return;
  const countEl   = document.getElementById('dir-principals-count');
  const loadingEl = document.getElementById('dir-principals-loading');
  const tableEl   = document.getElementById('dir-principals-table-wrap');
  const emptyEl   = document.getElementById('dir-principals-empty');
  loadingEl?.classList.remove('hidden');
  tableEl?.classList.add('hidden');
  emptyEl?.classList.add('hidden');

  const { data, error } = await _sb.from('users')
    .select('id, full_name, is_active, school_id, schools(name, directorate_id)')
    .eq('role', 'school_admin')
    .order('full_name');

  loadingEl?.classList.add('hidden');
  if (error) { if (countEl) countEl.textContent = '!'; console.error(error); return; }

  // فلترة من جانب العميل على مديريتهم
  _dirAllPrincipals = (data ?? []).filter(u => u.schools?.directorate_id === currentUser.directorateId);

  if (_dirAllPrincipals.length === 0) {
    if (countEl) countEl.textContent = 0;
    emptyEl?.classList.remove('hidden');
    return;
  }

  const q = document.getElementById('dir-principals-search')?.value || '';
  renderDirPrincipalRows(filterPrincipals(q));
  tableEl?.classList.remove('hidden');
}

function renderDirPrincipalRows(list) {
  const tbody = document.getElementById('dir-principals-tbody');
  if (!tbody) return;

  const countEl = document.getElementById('dir-principals-count');
  if (countEl) countEl.textContent = list.length;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">لا يوجد مدير مطابق للبحث.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map((u, i) => {
    const action = u.is_active === false
      ? `<span class="badge-inactive">مُعطَّل</span>`
      : `<button class="btn btn-danger btn-sm" data-dir-deactivate="${dirEsc(u.id)}" data-dir-deact-name="${dirEsc(u.full_name ?? '')}">تعطيل</button>`;
    return `
    <tr style="cursor:pointer" data-dir-view-cred="${dirEsc(u.id)}" data-dir-cred-name="${dirEsc(u.full_name ?? '')}">
      <td class="muted">${i + 1}</td>
      <td>${dirEsc(u.full_name ?? '—')}</td>
      <td>${dirEsc(u.schools?.name ?? '—')}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-dir-deactivate]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openDirDeactivate(btn.dataset.dirDeactivate, btn.dataset.dirDeactName);
    });
  });
  tbody.querySelectorAll('[data-dir-view-cred]').forEach(row => {
    row.addEventListener('click', () => openDirCredModal(row.dataset.dirViewCred, row.dataset.dirCredName));
  });
}

function openDirDeactivate(userId, name) {
  _dirPendingDeactivate = userId;
  const nameEl = document.getElementById('dir-deactivate-name');
  if (nameEl) nameEl.textContent = name;
  const errEl = document.getElementById('dir-deactivate-error');
  if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
  document.getElementById('dir-deactivate-modal')?.classList.remove('hidden');
}

async function openDirCredModal(userId, name) {
  const modal    = document.getElementById('dir-cred-modal');
  const nameEl   = document.getElementById('dir-cred-name');
  const emailEl  = document.getElementById('dir-cred-email');
  const passEl   = document.getElementById('dir-cred-password');
  const nfEl     = document.getElementById('dir-cred-not-found');
  if (!modal) return;
  if (nameEl)  nameEl.textContent  = name || '—';
  if (emailEl) emailEl.textContent = '…';
  if (passEl)  passEl.textContent  = '…';
  if (nfEl)    nfEl.hidden = true;
  modal.classList.remove('hidden');

  const { data, error } = await _sb.from('admin_credentials')
    .select('email, password').eq('user_id', userId).maybeSingle();

  if (error || !data) {
    if (emailEl) emailEl.textContent = '—';
    if (passEl)  passEl.textContent  = '—';
    if (nfEl)    nfEl.hidden = false;
  } else {
    if (emailEl) emailEl.textContent = data.email;
    if (passEl)  passEl.textContent  = data.password;
  }
}

function setupDirPrincipals() {
  document.getElementById('dir-add-principal-btn')?.addEventListener('click', () => {
    const errEl = document.getElementById('dir-principal-modal-error');
    if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
    ['dir-pm-email','dir-pm-password','dir-pm-fullname'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const pmSchoolEl = document.getElementById('dir-pm-school');
    if (pmSchoolEl) pmSchoolEl.value = '';
    document.getElementById('dir-principal-modal')?.classList.remove('hidden');
    document.getElementById('dir-pm-email')?.focus();
  });

  const closePrincipalModal = () => document.getElementById('dir-principal-modal')?.classList.add('hidden');
  document.getElementById('dir-principal-modal-close')?.addEventListener('click',  closePrincipalModal);
  document.getElementById('dir-principal-modal-cancel')?.addEventListener('click', closePrincipalModal);

  document.getElementById('dir-principal-modal-save')?.addEventListener('click', async () => {
    const errEl   = document.getElementById('dir-principal-modal-error');
    const saveBtn = document.getElementById('dir-principal-modal-save');
    const email    = document.getElementById('dir-pm-email')?.value.trim().toLowerCase() ?? '';
    const password = document.getElementById('dir-pm-password')?.value ?? '';
    const fullName = document.getElementById('dir-pm-fullname')?.value.trim() ?? '';
    const schoolId = document.getElementById('dir-pm-school')?.value ?? '';

    const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.hidden = false; } };
    if (!email || !email.includes('@'))  return showErr('أدخل بريداً إلكترونياً صالحاً.');
    if (password.length < 8)            return showErr('كلمة المرور ٨ أحرف على الأقل.');
    if (!fullName)                       return showErr('أدخل الاسم الكامل.');
    if (!schoolId)                       return showErr('اختر المدرسة.');
    if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
    if (saveBtn) saveBtn.disabled = true;

    try {
      await dirEdgeFetch('admin-create-user', { action: 'create_school_admin', email, fullName, password, schoolId });
      closePrincipalModal();
      await loadDirPrincipals();
    } catch (e) {
      showErr(e.message);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  // تعطيل
  document.getElementById('dir-deactivate-cancel')?.addEventListener('click', () => {
    _dirPendingDeactivate = null;
    document.getElementById('dir-deactivate-modal')?.classList.add('hidden');
  });

  document.getElementById('dir-deactivate-confirm')?.addEventListener('click', async () => {
    if (!_dirPendingDeactivate) return;
    const confirmBtn = document.getElementById('dir-deactivate-confirm');
    const errEl      = document.getElementById('dir-deactivate-error');
    if (confirmBtn) confirmBtn.disabled = true;
    if (errEl)      { errEl.textContent = ''; errEl.hidden = true; }
    try {
      await dirEdgeFetch('admin-create-user', { action: 'deactivate', userId: _dirPendingDeactivate });
      _dirPendingDeactivate = null;
      document.getElementById('dir-deactivate-modal')?.classList.add('hidden');
      await loadDirPrincipals();
    } catch (e) {
      if (errEl) { errEl.textContent = e.message; errEl.hidden = false; }
    } finally {
      if (confirmBtn) confirmBtn.disabled = false;
    }
  });

  // مودال بيانات الحساب
  const closeCredModal = () => document.getElementById('dir-cred-modal')?.classList.add('hidden');
  document.getElementById('dir-cred-modal-close')?.addEventListener('click', closeCredModal);
  document.getElementById('dir-cred-modal-ok')?.addEventListener('click',    closeCredModal);
  document.getElementById('dir-cred-modal')?.addEventListener('click', e => {
    if (e.target.id === 'dir-cred-modal') closeCredModal();
  });
}
