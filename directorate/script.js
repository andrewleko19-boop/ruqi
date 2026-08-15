// directorate/script.js
// ── DB من window.RUQI_DB (يُحمَّل عبر shared/db.js قبل هذا الملف) ──────────
import { CustomSelect }                      from '../shared/csel.js';
import { setupPwToggle }                     from '../shared/pw-toggle.js';
import { StatDrill }                         from '../shared/stat-drill.js';
import { detectAnomalies }                   from '../shared/data-alerts.js';
import { fmtDateShort, fmtDateLong, fmtDateTime } from '../shared/date-format.js';
import { restoreTab, syncTabHash }            from '../shared/tab-restore.js';
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
  purgeTenantCaches,
  getSchoolClassesForDirectorate,
  directorateBulkImportStudents,
  directorateBulkImportStaff,
  getLeavesRegister,
  getLeavesSummary,
  getDirectorateDepartures,
  localDateISO,
  errMessage,
} = window.RUQI_DB;

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
    await RUQI_PERMISSIONS.init();
    RUQI_PERMISSIONS.applyToDom();
    // إن كانت الوحدة الافتراضية (نظرة عامة) مخفية، فعِّل أوّل تبويب ظاهر بدلاً
    // من ترك اللوحة بلا تبويب نشط.
    if (document.querySelector('.dir-tab-btn.is-active')?.hidden) {
      const firstVisible = document.querySelector('.dir-tab-btn:not([hidden])');
      if (firstVisible) _dirActivateTab(firstVisible.dataset.tab);
    }
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
  setupPwToggle(document.getElementById('login-password'));

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
      showLoginError(errMessage(err, 'فشل تسجيل الدخول، يرجى المحاولة مجدداً.'));
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
  setupRsBulk();
  setupAcademicTerm();
  setupImport();
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
    try { await logout(); } catch { /* لا يُوقف الخروج */ }
    try { await purgeTenantCaches(); } catch { /* ignore */ }
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
    markersLayer[school.id]._ruqiStatus = color;
    markersLayer[school.id]._ruqiName   = school.name || '';
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
    const statusOk = onStatuses.size === 0 || onStatuses.has(marker._ruqiStatus);
    const nameOk   = !q || (marker._ruqiName || '').includes(q);
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
    const rows = await RUQI_DB.getHolidays();
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

// الدالة تُرجع jsonb {sent, recipients, throttled}. الصيغة القديمة كانت عدداً
// مجرّداً، والصفر فيها يعني ثلاثة أشياء مختلفة: أُرسل مؤخراً، أو لا حساب مدير
// لهذه المدرسة أصلاً. كان المستخدم يرى «أُرسل مسبقاً» من أول ضغطة لمدرسة بلا مدير.
function _remindOutcome(res) {
  // الصيغة العددية القديمة (قبل تشغيل §21) لا تفرّق بين الحالتين، فلا ندّعي
  // معرفةً لا نملكها: نبقي السلوك القديم («أُرسل مسبقاً») بدل اتّهام المدرسة
  // بأنها بلا حساب مدير.
  if (typeof res === 'number') return { sent: res, recipients: 1, throttled: res ? 0 : 1 };
  return {
    sent: Number(res?.sent) || 0,
    recipients: Number(res?.recipients) || 0,
    throttled: Number(res?.throttled) || 0,
  };
}

async function handleRemind(schoolId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const r = _remindOutcome(await sendAttendanceReminder(schoolId));
    if (r.sent > 0) {
      showToast('تذكير مُرسَل', `أُرسل التذكير إلى ${r.sent} مدير.`, 'success');
      if (btn) { btn.textContent = 'تم ✓'; }
    } else if (r.recipients === 0) {
      showToast('لا حساب مدير', 'لا يوجد حساب مدير لهذه المدرسة — أنشئ الحساب من تبويب «المدارس والطاقم» أولاً.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'تذكير'; }
    } else {
      showToast('تذكير مسبق', 'أُرسل تذكير إلى هذه المدرسة خلال آخر 30 دقيقة.', 'info');
      if (btn) { btn.disabled = false; btn.textContent = 'تذكير'; }
    }
  } catch (err) {
    console.error('[Remind] Failed:', err);
    showToast('خطأ في التذكير', errMessage(err, 'تعذّر إرسال التذكير.'), 'error');
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
  let sent = 0, noAdmin = 0;
  for (const row of silent) {
    try {
      const r = _remindOutcome(await sendAttendanceReminder(row.id));
      if (r.sent > 0) sent++;
      else if (r.recipients === 0) noAdmin++;
    } catch (_) { /* تجاهل — التالية */ }
  }
  // «لا حساب مدير» ليس نجاحاً صامتاً — المديرية تحتاج أن تعرف أنها لم تصل أحداً.
  const tail = noAdmin ? ` — ${noAdmin} منها بلا حساب مدير.` : '';
  showToast('اكتمل التذكير', `أُرسل التذكير لـ ${sent} من ${silent.length} مدرسة${tail}`,
            sent ? 'success' : 'info');
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
    showToast('فشل التحديث', errMessage(err, 'تعذّر تحديث الحالة.'), 'error');
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
  CustomSelect.enhance('dir-sm-school-type');
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
    r.created_at ? fmtDateTime(r.created_at, '') : '',
    r.media_urls?.length ?? 0,
  ]);

  downloadCSV(`ruqi_reports_${todayLocalISO()}.csv`, [headers, ...dataRows]);
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

  downloadCSV(`ruqi_compliance_${todayLocalISO()}.csv`, [headers, ...dataRows]);
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
  line:   cssVar('--line',   '#2b3557'),
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
    const rows = await RUQI_DB.getDirectorateDropoutSummary();
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
  await Promise.allSettled([loadStats(), loadMapAndCompliance(), loadReports(), loadTrend(), loadRequests(), loadStatements(), loadResultSheets(), loadDropoutSummary(), loadPeriodicReports(), loadStructure()]);
  // After every list has settled. loadReports renders the queue too, but it
  // runs in parallel with the three approval loaders, so at that point their
  // arrays may still be empty — this pass is the one that sees all four.
  renderPendingList();
  refreshRailCounts();
}

// ══════════════════════════════════════════════
//  بنية المديرية — المدارس والطلاب والكادر
//
//  أوّل سؤالٍ يسأله مسؤولٌ حقيقيّ ليس «كم حضر اليوم» بل «كم مدرسةً ابتدائية
//  عندي وكم طالبةً فيها». وكل رقمٍ هنا بابٌ: ضغطُه يُظهر ما وراءه بالأسماء،
//  فيُراجَع الرقم بدل أن يُصدَّق على علّاته.
// ══════════════════════════════════════════════
const SCHOOL_TYPE_AR = { primary: 'ابتدائي', preparatory: 'إعدادي', secondary: 'ثانوي' };
const fmtNum = (n) => (Number(n) || 0).toLocaleString('en-US');
const STAFF_CAT = [
  ['staff_teaching',     'تدريسي'],
  ['staff_admin',        'إداري'],
  ['staff_professional', 'مهني'],
  ['staff_worker',       'مستخدَم'],
  ['staff_guard',        'حارس'],
];

let structStats = [];

async function loadStructure() {
  const loading = document.getElementById('struct-loading');
  const errEl   = document.getElementById('struct-error');
  const gridEl  = document.getElementById('struct-grid');
  if (!gridEl) return;

  loading?.classList.remove('hidden');
  errEl?.setAttribute('hidden', '');
  try {
    structStats = await RUQI_DB.getDirectorateSchoolStats();
    renderStructure();
  } catch (e) {
    console.error('[dir] loadStructure', e);
    gridEl.innerHTML = '';
    errEl?.removeAttribute('hidden');
  } finally {
    loading?.classList.add('hidden');
  }
}

/** يبني صفوف التفصيل: مدرسةٌ في كل سطر مع الرقم الذي ساهمت به. */
const structRows = (filter, valueOf) => structStats
  .filter(filter)
  .map(s => ({
    label: s.school_name,
    sub:   SCHOOL_TYPE_AR[s.school_type] ?? 'بلا نوع محدَّد',
    value: valueOf ? fmtNum(valueOf(s)) : '',
  }))
  .sort((a, b) => a.label.localeCompare(b.label, 'ar'));

function renderStructure() {
  const gridEl = document.getElementById('struct-grid');
  if (!gridEl) return;

  const sum = (k) => structStats.reduce((t, s) => t + (Number(s[k]) || 0), 0);
  const typed = (t) => structStats.filter(s => s.school_type === t);
  const untypedCount = structStats.filter(s => !SCHOOL_TYPE_AR[s.school_type]).length;

  const schoolItems = Object.entries(SCHOOL_TYPE_AR).map(([key, ar]) => ({
    label: ar,
    value: fmtNum(typed(key).length),
    drill: typed(key).length ? {
      title: `المدارس — ${ar}`,
      subtitle: `${fmtNum(typed(key).length)} مدرسة`,
      rows: () => structRows(s => s.school_type === key, s => s.students_total),
    } : null,
  }));
  schoolItems.unshift({
    label: 'إجمالي المدارس',
    value: fmtNum(structStats.length),
    drill: structStats.length ? {
      title: 'كل مدارس المديرية',
      subtitle: `${fmtNum(structStats.length)} مدرسة`,
      rows: () => structRows(() => true, s => s.students_total),
    } : null,
  });
  // نوعٌ غير محدَّد يُعرض فقط إن وُجد: صفرٌ دائمُ الظهور ضجيجٌ، وغيرُ الصفر
  // بياناتٌ ناقصة يجب أن تُرى وتُصحَّح.
  if (untypedCount) schoolItems.push({
    label: 'بلا نوع محدَّد', value: fmtNum(untypedCount), tone: 'warn',
    drill: {
      title: 'مدارس بلا نوع محدَّد',
      subtitle: 'أكمِل نوع المدرسة من تبويب «المدارس» — تنقص الإحصاء الوطني',
      rows: () => structRows(s => !SCHOOL_TYPE_AR[s.school_type], s => s.students_total),
    },
  });

  const males = sum('students_male'), females = sum('students_female');
  const unknownGender = sum('students_unknown');
  const studentItems = [
    { label: 'إجمالي الطلاب', value: fmtNum(sum('students_total')),
      drill: { title: 'الطلاب حسب المدرسة', subtitle: `${fmtNum(sum('students_total'))} طالباً وطالبة`,
               rows: () => structRows(s => s.students_total > 0, s => s.students_total) } },
    { label: 'ذكور', value: fmtNum(males),
      drill: { title: 'الذكور حسب المدرسة', subtitle: `${fmtNum(males)} طالباً`,
               rows: () => structRows(s => s.students_male > 0, s => s.students_male) } },
    { label: 'إناث', value: fmtNum(females),
      drill: { title: 'الإناث حسب المدرسة', subtitle: `${fmtNum(females)} طالبة`,
               rows: () => structRows(s => s.students_female > 0, s => s.students_female) } },
  ];
  if (unknownGender) studentItems.push({
    label: 'جنسٌ غير مسجَّل', value: fmtNum(unknownGender), tone: 'warn',
    drill: { title: 'طلاب بلا جنسٍ مسجَّل',
             subtitle: 'حقلٌ ناقص في سجلّ الطلاب — يُخلّ بالإحصاء المفصَّل',
             rows: () => structRows(s => s.students_unknown > 0, s => s.students_unknown) },
  });

  const staffTotal = STAFF_CAT.reduce((t, [k]) => t + sum(k), 0);
  const staffItems = [
    { label: 'إجمالي الكادر', value: fmtNum(staffTotal),
      drill: { title: 'الكادر حسب المدرسة', subtitle: `${fmtNum(staffTotal)} موظفاً`,
               rows: () => structRows(
                 s => STAFF_CAT.some(([k]) => s[k] > 0),
                 s => STAFF_CAT.reduce((t, [k]) => t + (Number(s[k]) || 0), 0)) } },
    ...STAFF_CAT.map(([key, ar]) => ({
      label: ar, value: fmtNum(sum(key)),
      drill: sum(key) ? {
        title: `الكادر — ${ar}`, subtitle: `${fmtNum(sum(key))} موظفاً`,
        rows: () => structRows(s => s[key] > 0, s => s[key]),
      } : null,
    })),
  ];

  // نصاب التدريس: المدرسة هي من يُسنِد الدروس، والمديرية تراقب التجاوز.
  // «بلا نصابٍ محدَّد» ليست تجاوزاً بل حقلٌ ناقص — تُفصَل عنه صراحةً.
  const over    = sum('teachers_over_quota');
  const noQuota = sum('teachers_no_quota');
  const quotaItems = [];
  if (over) quotaItems.push({
    label: 'تجاوزوا النصاب', value: fmtNum(over), tone: 'bad',
    drill: { title: 'مدارس فيها تجاوزٌ للنصاب',
             subtitle: `${fmtNum(over)} معلّماً — الرقم عدد المتجاوزين في المدرسة`,
             rows: () => structRows(s => s.teachers_over_quota > 0, s => s.teachers_over_quota) },
  });
  if (noQuota) quotaItems.push({
    label: 'بلا نصابٍ محدَّد', value: fmtNum(noQuota), tone: 'warn',
    drill: { title: 'معلّمون بلا نصابٍ محدَّد',
             subtitle: 'حقل «ساعات التدريس» فارغ في سجلّ الكوادر — لا يُحتسب تجاوزهم',
             rows: () => structRows(s => s.teachers_no_quota > 0, s => s.teachers_no_quota) },
  });
  if (!quotaItems.length && structStats.length) quotaItems.push({
    label: 'لا تجاوزات', value: '✓', tone: 'good',
  });

  const groups = [
    { title: 'المدارس حسب النوع', items: schoolItems },
    { title: 'الطلاب حسب الجنس',  items: studentItems },
    { title: 'الكادر حسب الفئة',  items: staffItems },
    { title: 'نصاب التدريس',      items: quotaItems },
  ];

  /* تنبيهات الأرقام غير المنطقية. تناقضٌ بين حقلين لا يكشفه التحقّق عند
     الإدخال — كلّ حقلٍ وحده صحيح — ولا يظهر إلا حين تُقرأ الأرقام معاً. */
  const alerts = detectAnomalies(structStats);
  if (alerts.length) groups.push({
    title: 'تنبيهات البيانات',
    items: alerts.map(a => ({
      label: a.label, value: fmtNum(a.schools.length), tone: a.tone,
      drill: { title: a.label, subtitle: a.hint,
               rows: () => a.schools.map(s => ({ label: s.name, value: s.detail })) },
    })),
  });

  StatDrill.grid(gridEl, groups);
}

// ══════════════════════════════════════════════
//  دليل الكادر — السجل المهني الكامل
//
//  staff_records تحمل ثلاثين حقلاً مهنياً لا يقرؤها اليوم إلا مديرُ المدرسة
//  نفسها. فالمديرية التي تُسأل «من عندك من حملة الماجستير في الرياضيات» لا
//  تملك جواباً إلا بالاتصال بالمدارس واحدةً واحدة. هذا الدليل هو الجواب.
//
//  البحث والترقيم في الخادم لا هنا: تصفيةُ ستّة آلاف صفٍّ في المتصفّح تعني
//  سحبها أوّلاً، وهو ما لا يُحتمل على شبكةٍ ولا على هاتف.
// ══════════════════════════════════════════════
const STAFF_TYPE_AR = {
  teaching: 'تدريسي', admin: 'إداري', professional: 'مهني',
  worker: 'مستخدَم', guard: 'حارس',
};
const SDIR_PAGE = 100;

let _sdirInit = false, _sdirRows = [], _sdirTotal = 0, _sdirOffset = 0;
let _sdirSeq = 0, _sdirDebounce = null;

function initStaffDirectory() {
  if (_sdirInit) return;
  _sdirInit = true;

  CustomSelect.enhance('sdir-school');
  CustomSelect.enhance('sdir-type');
  void fillStaffSchoolFilter();

  const reload = () => { _sdirOffset = 0; loadStaffDirectory(); };
  document.getElementById('sdir-school')?.addEventListener('change', reload);
  document.getElementById('sdir-type')?.addEventListener('change', reload);
  // تأخيرٌ قصير على الكتابة: استعلامٌ لكل ضغطة مفتاح يُغرق الخادم ويُرجع
  // نتائجَ متسابقة تتقدّم أحدثُها على أقدمها.
  document.getElementById('sdir-search')?.addEventListener('input', () => {
    clearTimeout(_sdirDebounce);
    _sdirDebounce = setTimeout(reload, 300);
  });
  document.getElementById('sdir-prev')?.addEventListener('click', () => {
    _sdirOffset = Math.max(0, _sdirOffset - SDIR_PAGE); loadStaffDirectory();
  });
  document.getElementById('sdir-next')?.addEventListener('click', () => {
    if (_sdirOffset + SDIR_PAGE < _sdirTotal) { _sdirOffset += SDIR_PAGE; loadStaffDirectory(); }
  });
  document.getElementById('sdir-tbody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-sid]');
    if (tr) openStaffCard(tr.dataset.sid);
  });

  loadStaffDirectory();
  initLeavesRegister();
}

/* ── سجلّ الإجازات ───────────────────────────────────────────────────────────
   المدرسة تُدخل الإجازات شهراً بعد شهر، ولم تكن تصل المديرية: RLS تسمح
   لمستخدم المديرية بالقراءة نظريّاً، ولا واجهةَ تقرأ. فبيانٌ يُملأ بيدٍ كلَّ
   شهر لا يُبنى عليه قرار — وهو أوّلُ ما يُسأل عنه عند نقص الكادر. */
let _dlvInit = false;

function initLeavesRegister() {
  if (_dlvInit) return;
  _dlvInit = true;

  // <select> له قيمةٌ دائماً (أوّل خيار)، فشرطُ `!m.value` لا يتحقّق أبداً
  // ويبقى المرشِّح على «كانون الثاني» — فيُقرأ «لا إجازات» والسجلّ مملوء.
  const now = new Date();
  const m = document.getElementById('dlv-month');
  const y = document.getElementById('dlv-year');
  if (m) m.value = String(now.getMonth() + 1);
  if (y) y.value = String(now.getFullYear());

  CustomSelect.enhance('dlv-month');
  CustomSelect.enhance('dlv-school');
  void fillLeavesSchoolFilter();

  const reload = () => void loadLeavesRegisterView();
  ['dlv-month', 'dlv-year', 'dlv-school'].forEach(id =>
    document.getElementById(id)?.addEventListener('change', reload));

  void loadLeavesRegisterView();
}

async function fillLeavesSchoolFilter() {
  const sel = document.getElementById('dlv-school');
  if (!sel) return;
  let list = Array.isArray(_dirAllSchools) ? _dirAllSchools : [];
  if (!list.length && currentUser?.directorateId) {
    const { data } = await _sb.from('schools')
      .select('id, name').eq('directorate_id', currentUser.directorateId)
      .is('archived_at', null).order('name');
    list = data ?? [];
  }
  const keep = sel.value;
  sel.innerHTML = '<option value="">كل المدارس</option>' + list
    .map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  sel.value = keep;
  CustomSelect.refresh(sel);
}

async function loadLeavesRegisterView() {
  const loading = document.getElementById('dlv-loading');
  const wrap    = document.getElementById('dlv-table-wrap');
  const tbody   = document.getElementById('dlv-tbody');
  const empty   = document.getElementById('dlv-empty');
  const errBox  = document.getElementById('dlv-error');
  const totals  = document.getElementById('dlv-totals');
  if (!tbody) return;

  const month = parseInt(document.getElementById('dlv-month')?.value || '1', 10);
  const year  = parseInt(document.getElementById('dlv-year')?.value  || '2026', 10);
  const school = document.getElementById('dlv-school')?.value || null;

  loading?.classList.remove('hidden');
  wrap?.classList.add('hidden'); empty?.classList.add('hidden');
  errBox?.classList.add('hidden'); totals?.classList.add('hidden');

  try {
    const [rows, summary] = await Promise.all([
      getLeavesRegister(month, year, school),
      getLeavesSummary(month, year).catch(() => []),
    ]);

    // المجاميع تشمل كلّ المديرية دائماً، والجدول يتبع المرشِّح — فيبقى للموظّف
    // مرجعٌ يقيس عليه المدرسةَ التي يفحصها بدل رقمٍ معلَّقٍ بلا سياق.
    if (totals && summary.length) {
      const days   = summary.reduce((a, s) => a + (Number(s.total_days)   || 0), 0);
      const leaves = summary.reduce((a, s) => a + (Number(s.leave_count)  || 0), 0);
      const staff  = summary.reduce((a, s) => a + (Number(s.staff_count)  || 0), 0);
      const top = [...summary].sort((a, b) => b.total_days - a.total_days).slice(0, 3);
      totals.innerHTML =
        `<span class="dlv-chip">مدارس <b>${summary.length}</b></span>` +
        `<span class="dlv-chip">موظّفون <b>${staff}</b></span>` +
        `<span class="dlv-chip">إجازات <b>${leaves}</b></span>` +
        `<span class="dlv-chip dlv-chip-days">أيام <b>${days}</b></span>` +
        top.map(s => `<span class="dlv-chip dlv-chip-top">${esc(s.scope_label)} <b>${s.total_days}</b></span>`).join('');
      totals.classList.remove('hidden');
    }

    if (!rows.length) { empty?.classList.remove('hidden'); return; }
    tbody.innerHTML = rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(r.full_name)}</td>
        <td>${esc(STAFF_TYPE_AR[r.staff_type] ?? r.staff_type ?? '—')}</td>
        <td>${esc(r.school_name)}</td>
        <td>${esc(r.leave_type)}</td>
        <td>${r.leave_days}</td>
      </tr>`).join('');
    wrap?.classList.remove('hidden');
  } catch (err) {
    console.error('[dir] loadLeavesRegister', err);
    errBox?.classList.remove('hidden');
  } finally {
    loading?.classList.add('hidden');
  }
}

/* مرشِّح المدارس. يُفضَّل ما حمّله تبويب المدارس، وإلا جُلبت الأسماء وحدها —
   فقد يفتح المستخدمُ هذا التبويب أوّلاً فلا يجد قائمةً بلا هذا الاحتياط. */
async function fillStaffSchoolFilter() {
  const sel = document.getElementById('sdir-school');
  if (!sel) return;
  let list = Array.isArray(_dirAllSchools) ? _dirAllSchools : [];
  if (!list.length && currentUser?.directorateId) {
    const { data } = await _sb.from('schools')
      .select('id, name').eq('directorate_id', currentUser.directorateId)
      .is('archived_at', null).order('name');
    list = data ?? [];
  }
  const keep = sel.value;
  sel.innerHTML = '<option value="">كل المدارس</option>' + list
    .map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  sel.value = keep;
  CustomSelect.refresh(sel);
}

async function loadStaffDirectory() {
  const loading = document.getElementById('sdir-loading');
  const wrap    = document.getElementById('sdir-table-wrap');
  const empty   = document.getElementById('sdir-empty');
  const errEl   = document.getElementById('sdir-error');
  const pager   = document.getElementById('sdir-pager');
  if (!wrap) return;

  const seq = ++_sdirSeq;
  loading?.classList.remove('hidden');
  wrap.classList.add('hidden');
  empty?.classList.add('hidden');
  errEl?.classList.add('hidden');
  pager?.setAttribute('hidden', '');

  try {
    const { rows, total } = await RUQI_DB.getStaffDirectory({
      schoolId:  document.getElementById('sdir-school')?.value || null,
      staffType: document.getElementById('sdir-type')?.value   || null,
      search:    document.getElementById('sdir-search')?.value?.trim() || null,
      limit: SDIR_PAGE, offset: _sdirOffset,
    });
    // ردٌّ متأخّر لبحثٍ هُجر: تجاهُله يمنع أن تحلّ نتائج «أح» محلّ «أحمد».
    if (seq !== _sdirSeq) return;
    _sdirRows = rows; _sdirTotal = total;
    renderStaffDirectory();
  } catch (e) {
    if (seq !== _sdirSeq) return;
    console.error('[dir] loadStaffDirectory', e);
    errEl?.classList.remove('hidden');
  } finally {
    if (seq === _sdirSeq) loading?.classList.add('hidden');
  }
}

function renderStaffDirectory() {
  const wrap  = document.getElementById('sdir-table-wrap');
  const tbody = document.getElementById('sdir-tbody');
  const empty = document.getElementById('sdir-empty');
  const pager = document.getElementById('sdir-pager');
  const count = document.getElementById('sdir-count');
  if (count) count.textContent = fmtNum(_sdirTotal);

  if (!_sdirRows.length) { empty?.classList.remove('hidden'); return; }

  tbody.innerHTML = _sdirRows.map((r, i) => `
    <tr data-sid="${esc(r.id)}" class="row-clickable">
      <td class="muted">${fmtNum(_sdirOffset + i + 1)}</td>
      <td><strong>${esc(r.full_name)}</strong></td>
      <td>${esc(STAFF_TYPE_AR[r.staff_type] ?? r.staff_type ?? '—')}</td>
      <td>${esc(r.school_name ?? '—')}</td>
      <td>${esc(r.specialization ?? '—')}</td>
      <td>${esc(r.certificate ?? '—')}</td>
      <td>${r.seniority_year ?? '—'}</td>
    </tr>`).join('');
  wrap.classList.remove('hidden');

  if (_sdirTotal > SDIR_PAGE) {
    const from = _sdirOffset + 1, to = _sdirOffset + _sdirRows.length;
    document.getElementById('sdir-range').textContent =
      `${fmtNum(from)}–${fmtNum(to)} من ${fmtNum(_sdirTotal)}`;
    document.getElementById('sdir-prev').disabled = _sdirOffset === 0;
    document.getElementById('sdir-next').disabled = to >= _sdirTotal;
    pager?.removeAttribute('hidden');
  }
}

/** البطاقة الشخصية: كل ما في السجلّ، والفارغ يُحذف لا يُعرض شُرَطاً. */
function openStaffCard(id) {
  const r = _sdirRows.find(x => x.id === id);
  if (!r) return;
  const F = [
    ['الفئة',            STAFF_TYPE_AR[r.staff_type] ?? r.staff_type],
    ['المدرسة',          r.school_name],
    ['المديرية',         r.directorate_name],
    ['الصفة / العمل',    r.job_title],
    ['الرقم الوطني',     r.national_id],
    ['الرقم الذاتي',     r.self_number],
    ['الرقم العام',      r.general_number],
    ['اسم الأم',         r.mother_name],
    ['الجنس',            r.gender === 'male' ? 'ذكر' : r.gender === 'female' ? 'أنثى' : null],
    ['تاريخ الميلاد',    r.birth_date],
    ['الشهادة',          r.certificate],
    ['الشهادة العليا',   r.higher_degree],
    ['الاختصاص',         r.specialization],
    ['المادة المُدرَّسة', r.subject_taught],
    ['الرتبة',           r.teaching_rank],
    ['النصاب (حصص)',    r.weekly_lessons],
    ['سنة الأقدمية',     r.seniority_year],
    ['تاريخ المباشرة',   r.start_date],
    ['الملاك',           r.roster_type === 'inside' ? 'داخل الملاك'
                        : r.roster_type === 'outside' ? 'خارج الملاك'
                        : r.roster_type === 'contract' ? 'متعاقد' : null],
    ['الوثيقة الوزارية', r.ministerial_doc],
    ['المنطقة التعليمية', r.educational_zone],
    ['منطقة السكن',      r.residential_zone],
    ['الهاتف',           r.phone],
    ['الهاتف الأرضي',    r.landline],
    ['الصف المسند',      r.assigned_grade],
    ['الشعبة',           r.assigned_section],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');

  StatDrill.open(
    r.full_name,
    [STAFF_TYPE_AR[r.staff_type], r.school_name].filter(Boolean).join(' · '),
    F.map(([label, value]) => ({ label, value: String(value) })),
  );
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
    const reports = await RUQI_DB.getPeriodicReports('directorate');
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
    console.error('[Ruqi] loadPeriodicReports', err);
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
  el.textContent = fmtDateLong(new Date());
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
  return fmtDateTime(iso);
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
    const items = await window.RUQI_DB.getNotifications(30);
    if (!items.length) {
      list.innerHTML = '<li style="padding:32px 16px;text-align:center;color:var(--text-muted);font-size:.9rem">لا توجد إشعارات</li>';
      return;
    }
    // esc() on every field: notification text is composed by DB triggers from
    // school-supplied strings (report descriptions, school names), so it is
    // untrusted input arriving in a directorate session.
    list.innerHTML = items.map(n => {
      const diff = Date.now() - new Date(n.created_at).getTime();
      const m    = Math.floor(diff / 60000);
      const ago  = m < 1 ? 'الآن' : m < 60 ? `منذ ${m} دقيقة` : m < 1440 ? `منذ ${Math.floor(m/60)} ساعة` : `منذ ${Math.floor(m/1440)} يوم`;
      const bg   = !n.read_at ? 'background:var(--accent-tint);' : '';
      return `<li style="${bg}padding:12px 16px;border-bottom:1px solid var(--border-light);direction:rtl">
        <div style="font-weight:600;font-size:.9rem">${esc(n.title)}</div>
        ${n.body ? `<div style="font-size:.82rem;color:var(--text-secondary);margin-top:2px">${esc(n.body)}</div>` : ''}
        <div style="font-size:.75rem;color:var(--text-muted);margin-top:4px">${ago}</div>
      </li>`;
    }).join('');
  } catch (e) { console.warn('[Ruqi-D] loadDirNotifList', e); }
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
    await window.RUQI_DB.markAllNotificationsRead().catch(() => {});
    updateDirNotifBadge(0);
    loadDirNotifList();
  });

  window.RUQI_DB.getUnreadNotificationsCount().then(updateDirNotifBadge).catch(() => {});

  if (_dirUnsubNotif) _dirUnsubNotif();
  _dirUnsubNotif = window.RUQI_DB.subscribeNotifications(userId, (notif) => {
    updateDirNotifBadge(_dirUnreadCount + 1);
    showToast(notif.title, notif.body ?? '', 'info');
    // OS notifications come from web push (the SW push handler). The page-context
    // `new Notification()` constructor throws on Android, so it is not used here.
    if (notif.type === 'report_new') loadReports().catch(() => {});
    if (notif.type === 'statement_submitted') loadStatements().catch(() => {});
    if (notif.type === 'result_sheet_submitted') loadResultSheets().catch(() => {});
  });

  // Web Push: طلب تفعيل ضمن إيماءة مستخدم (يشترك بصمت إن كان الإذن ممنوحاً)
  window.RUQI_DB.initPushPrompt();
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
    msgEl.textContent = errMessage(err, 'تعذّرت المراجعة');
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

  /* ⚠ كان زرُّ الفتح يظهر لحالة «مُرسَل» وحدها. فما إن يعتمد الموظّفُ البيانَ
     أو يرفضه حتى يصير محتواه غيرَ قابلٍ للفتح إلى الأبد — لا مراجعةَ لقرار،
     ولا رجوعَ إلى رقمٍ عند الخلاف، ولا نسخةَ تُحفظ. والبيانُ وثيقةٌ رسمية
     تُسلَّم للمديرية، فحجبُها بعد الاعتماد يُفرغ الاعتماد من معناه.
     الآن يُفتح دائماً؛ وأزرارُ القرار وحدها تُخفى لما بُتَّ فيه. */
  const actionHtml =
    `<button class="btn btn-sm ${s.status === 'submitted' ? 'btn-primary' : 'btn-ghost'} dir-stmt-review-btn"
       data-id="${esc(s.id)}" data-status="${esc(s.status)}"
       data-school="${esc(schoolName)}" data-period="${esc(period)}"
       data-snap='${esc(JSON.stringify(s.snapshot_data || {}))}'
       >${s.status === 'submitted' ? 'مراجعة' : 'عرض'}</button>` +
    (s.status !== 'submitted' && s.notes
      ? `<span class="dir-req-reason" style="display:block;margin-top:4px">${esc(s.notes)}</span>` : '');

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

  const status = btn.dataset.status || 'submitted';
  const decided = status !== 'submitted';
  _stmtViewCtx = { school, period, snap, status };

  const STATUS_AR = { approved: 'معتمد ✓', rejected: 'مرفوض ✗', issued: 'صادر', draft: 'مسودة' };
  document.getElementById('dir-stmt-title').textContent =
    `${decided ? 'بيان' : 'مراجعة بيان'}: ${school} — ${period}`
    + (decided ? ` (${STATUS_AR[status] ?? status})` : '');
  document.getElementById('dir-stmt-body').innerHTML = buildStmtDetail(snap);
  document.getElementById('dir-stmt-notes').value = '';
  document.getElementById('dir-stmt-msg').hidden = true;

  /* ما بُتَّ فيه يُعرَض ولا يُقرَّر فيه ثانيةً: إخفاءُ أزرار القرار (لا تعطيلُها)
     أوضحُ للموظّف، وحقلُ السبب بلا معنى بعد صدور القرار. */
  const noteWrap = document.getElementById('dir-stmt-notes')?.closest('.form-group');
  if (noteWrap) noteWrap.hidden = decided;
  document.getElementById('dir-stmt-approve').hidden = decided;
  document.getElementById('dir-stmt-reject').hidden  = decided;

  document.getElementById('dir-stmt-modal').classList.remove('hidden');
});

/* نسخةٌ تُحفَظ أو تُطبع. نافذةٌ مستقلّة بأنماطها الخاصّة: طباعةُ المودال نفسه
   تجرّ معها ترويسةَ اللوحة وشريطَ التبويبات وأزرارَ القرار. */
let _stmtViewCtx = null;

document.getElementById('dir-stmt-print')?.addEventListener('click', () => {
  if (!_stmtViewCtx) return;
  const { school, period, snap, status } = _stmtViewCtx;
  const STATUS_AR = { approved: 'معتمد', rejected: 'مرفوض', submitted: 'بانتظار المراجعة' };
  const win = window.open('', '_blank');
  if (!win) { showToast('امنع حاصر النوافذ المنبثقة لحفظ الورقة', '', 'error'); return; }
  win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
    <title>البيان الشهري — ${esc(school)} — ${esc(period)}</title>
    <style>
      body { font-family: system-ui, 'Segoe UI', Tahoma, sans-serif; direction: rtl;
             margin: 24px; color: #111; font-size: 13px; }
      h1 { font-size: 17px; margin: 0 0 2px; }
      .sub { color: #555; font-size: 12px; margin-bottom: 14px; }
      h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
      th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: center; }
      th { background: #f1f5f9; font-weight: 700; }
      td.k { text-align: right; background: #fafafa; width: 45%; }
      @media print { body { margin: 0; } }
    </style></head><body>
    <h1>البيان الشهري — ${esc(school)}</h1>
    <div class="sub">${esc(period)} · الحالة: ${esc(STATUS_AR[status] ?? status)}</div>
    ${buildStmtDetail(snap, true)}
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
});

/* ─── تفصيلُ البيان كاملاً ────────────────────────────────────────────────────
   الملخّصُ سبعةُ أرقام، والبيانُ عشرةُ أقسام. وموظّفُ المديرية يعتمد وثيقةً
   رسمية — فإن لم يرَ إلا مجاميعَها فهو يوقّع على ما لم يقرأ. اللقطةُ تحمل
   الأقسام كلَّها أصلاً؛ لم يكن ينقص إلا عرضُها.
   forPrint: بلا أصنافِ اللوحة، فالنافذةُ المطبوعة تحمل أنماطها بنفسها. */
function buildStmtDetail(snap, forPrint = false) {
  const num = (n) => Number(n) || 0;
  const t   = (v) => esc(String(v ?? '—') === '' ? '—' : String(v ?? '—'));
  const out = [];
  const h2  = (txt) => out.push(`<h2>${esc(txt)}</h2>`);
  const kv  = (pairs) => {
    const rows = pairs.filter(([, v]) => v !== undefined)
      .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${t(v)}</td></tr>`).join('');
    if (rows) out.push(`<table>${rows}</table>`);
  };

  // الصيغة الأولى لا تحمل الأقسام، فنكتفي لها بالملخّص كما كان.
  if (Number(snap.schemaVersion) < 2) {
    return `<div class="dir-stmt-detail">${buildStmtSummary(snap)}</div>`;
  }

  const sc = snap.school || {};
  h2('هوية المدرسة');
  kv([['الاسم', sc.name], ['الاسم سابقاً', sc.formerName], ['الحلقة', sc.cycle],
      ['الرقم الإحصائي', sc.statisticalNumber], ['المنطقة التعليمية', sc.educationalZone],
      ['القرية', sc.village], ['العنوان', sc.address], ['الهاتف', sc.phone],
      ['نوع الدوام', sc.dayType], ['مشترك مع', sc.sharedWith]]);

  const b = snap.building || {};
  if (Object.keys(b).length) {
    h2('البناء المدرسي');
    kv([['البناء', b.ownership], ['عدد الطوابق', b.floors],
        ['غرف صفية مستخدمة', b.class_rooms], ['غرف إدارية', b.admin_rooms],
        ['غرف غير مستخدمة', b.unused]]);
  }

  // جدول الطلاب بالصفوف كما في الورقة الرسمية — لا مجاميعَ وحدها.
  const stu = snap.students || {};
  if (Array.isArray(stu.rows) && stu.rows.length) {
    h2('أعداد الطلاب والشعب');
    const body = stu.rows.map(r => `<tr><td class="k">${t(r.label)}</td>
      <td>${num(r.sections)}</td><td>${num(r.enM)}</td><td>${num(r.enF)}</td>
      <td>${num(r.frM)}</td><td>${num(r.frF)}</td><td>${num(r.ruM)}</td>
      <td>${num(r.ruF)}</td><td>${num(r.total)}</td></tr>`).join('');
    const g = stu.totals || {};
    out.push(`<table>
      <thead><tr><th>الصف</th><th>الشعب</th><th>ذكور إنك.</th><th>إناث إنك.</th>
        <th>ذكور فر.</th><th>إناث فر.</th><th>ذكور رو.</th><th>إناث رو.</th><th>المجموع</th></tr></thead>
      <tbody>${body}<tr><th>المجموع</th><th>${num(g.sections)}</th><th>${num(g.enM)}</th>
        <th>${num(g.enF)}</th><th>${num(g.frM)}</th><th>${num(g.frF)}</th>
        <th>${num(g.ruM)}</th><th>${num(g.ruF)}</th><th>${num(g.total)}</th></tr></tbody></table>`);
  }

  const adm = snap.adminStaff || {};
  if (Array.isArray(adm.rows) && adm.rows.length) {
    h2('الجهاز الإداري');
    out.push(`<table><thead><tr><th>الوظيفة</th><th>العدد</th></tr></thead><tbody>` +
      adm.rows.map(r => `<tr><td class="k">${t(r.role)}</td><td>${num(r.count)}</td></tr>`).join('') +
      `<tr><th>مجموع الإداريين</th><th>${num(adm.total)}</th></tr></tbody></table>`);
  }

  const w = snap.workforce || {};
  if (Object.keys(w).length) {
    h2('ملخص العاملين');
    kv([['عدد المعلمين', w.teachers], ['عدد المدرسين', w.masters],
        ['المدرسون المساعدون', w.assist], ['الجهاز التدريسي بشكل كامل', w.full],
        ['غير المصنّف', w.unclassified], ['الجهاز الإداري', w.admin],
        ['العاملون المهنيون', w.professional], ['المستخدمون', w.worker],
        ['الحراس', w.guard], ['مجموع العاملين', w.grand]]);
  }

  // الإجازات مجمّعةً بالنوع: اللقطة تحمل معرّفات الكادر لا أسماءهم عمداً
  // (الأسماء تذهب إلى monthly_statement_rosters بصلاحياته).
  const lv = Array.isArray(snap.leaves) ? snap.leaves : [];
  if (lv.length) {
    h2('إجازات الشهر');
    const byType = new Map();
    for (const l of lv) {
      const k = String(l?.type ?? '').trim() || 'غير محدّد';
      const cur = byType.get(k) || { n: 0, days: 0 };
      cur.n += 1; cur.days += num(l?.days);
      byType.set(k, cur);
    }
    out.push(`<table><thead><tr><th>النوع</th><th>عدد الإجازات</th><th>مجموع الأيام</th></tr></thead><tbody>` +
      [...byType].map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${v.n}</td><td>${v.days}</td></tr>`).join('') +
      `</tbody></table>`);
  }

  h2('التعديلات الطارئة');
  const ch = snap.changes || {};
  const items = Array.isArray(ch.items) ? ch.items : [];
  if (ch.none && !items.length) {
    out.push('<p>لا يوجد تعديل هذا الشهر — موثَّق من المدرسة.</p>');
  } else if (!items.length) {
    out.push('<p>—</p>');
  } else {
    out.push(`<table><thead><tr><th>الاسم</th><th>الفئة</th><th>العمل المسند</th>
      <th>نوع الحدث</th><th>تاريخ النفاذ</th><th>السبب</th></tr></thead><tbody>` +
      items.map(c => {
        const d = c.data || {};
        const GRP = { admin: 'إداري', teaching: 'تدريسي', support: 'مهني/مستخدم/حارس' };
        return `<tr><td class="k">${t(d.full_name)}</td><td>${t(GRP[c.group] ?? c.group)}</td>
          <td>${t(d.job_title)}</td><td>${t(c.eventType)}</td>
          <td>${t(c.effectiveDate)}</td><td>${t(c.reason)}</td></tr>`;
      }).join('') + `</tbody></table>`);
  }

  const sig = snap.signatures || {};
  const per = snap.period || {};
  h2('التسليم والتواقيع');
  kv([['تاريخ التسليم', [per.deliveryDay, per.deliveryMonth, per.deliveryYear].filter(Boolean).join('/') || undefined],
      ['استلمه', per.receivedBy], ['أمين سر المدرسة', sig.secretary],
      ['مدير المدرسة', sig.principal]]);

  const html = out.join('');
  return forPrint ? html : `<div class="dir-stmt-detail">${html}</div>`;
}

/* ملخّصُ البيان الشهريّ الذي يقرؤه موظّف المديرية قبل أن يعتمد أو يرفض.
 *
 * ⚠ كان مكتوباً كلُّه على الصيغة الأولى للقطة، والمدرسةُ تُرسل الثانية منذ مدّة:
 *   · snap.students صار كائناً { rows, totals, byCycle } لا مصفوفة، و
 *     Array.isArray تردّ false فتبقى المجاميع أصفاراً.
 *   · snap.staffCounts لا وجود له في الثانية أصلاً (صار teachingStaff و
 *     adminStaff و workforce) فكلُّ أعداد العاملين أصفار.
 *   · snap.leaveLines لا وجود له كذلك (صار leaves كائناتٍ لا نصوصاً) فالكتلة
 *     لم تُعرَض لأيّ مدرسة قطّ.
 *
 * والنتيجة أخطر من كتلةٍ غائبة: شاشةُ الاعتماد كانت تعرض «عدد الشعب ٠، إجمالي
 * الطلاب ٠، إجمالي العاملين ٠» لكلّ بيانٍ يصل — والصفرُ رقمٌ لا رسالةُ خطأ،
 * فيوقّع الموظّف على اعتماد بيانٍ لم يرَ منه شيئاً، أو يرفض مدرسةً ملأته كاملاً.
 *
 * فالقراءة الآن من الصيغة الثانية، مع إبقاء الأولى للبيانات المحفوظة قبلها —
 * وبيانٌ قديمٌ لا يُعاد تفسيره بصيغةٍ جديدة فتظهر أرقامه مقلوبة.
 */
function buildStmtSummary(snap) {
  const v2   = Number(snap.schemaVersion) >= 2;
  const rows = [];
  const num  = (n) => Number(n) || 0;

  if (v2) {
    const t = snap.students?.totals || {};
    const m = num(t.enM) + num(t.frM) + num(t.ruM);
    const f = num(t.enF) + num(t.frF) + num(t.ruF);
    rows.push(['عدد الشعب',      num(t.sections)]);
    rows.push(['إجمالي الذكور',  m]);
    rows.push(['إجمالي الإناث',  f]);
    rows.push(['إجمالي الطلاب',  num(t.total) || (m + f)]);

    const w = snap.workforce || {};
    rows.push(['إجمالي العاملين', num(w.grand)]);
    rows.push(['إداري / تدريسي', `${num(w.admin)} / ${num(w.full)}`]);
    rows.push(['مهني / مستخدم / حارس',
      `${num(w.professional)} / ${num(w.worker)} / ${num(w.guard)}`]);
    // المعلّمون بلا اختصاصٍ مصنَّف: رقمٌ يقرّر الموظّفُ على أساسه، فلا يُطوى.
    if (num(w.unclassified)) rows.push(['معلّمون بلا اختصاص مصنَّف', num(w.unclassified)]);
  } else {
    const students = Array.isArray(snap.students) ? snap.students : [];
    let totSec = 0, totM = 0, totF = 0;
    for (const s of students) {
      totSec += num(s.sections);
      totM   += num(s.enM) + num(s.frM) + num(s.ruM);
      totF   += num(s.enF) + num(s.frF) + num(s.ruF);
    }
    rows.push(['عدد الشعب',     totSec]);
    rows.push(['إجمالي الذكور', totM]);
    rows.push(['إجمالي الإناث', totF]);
    rows.push(['إجمالي الطلاب', totM + totF]);

    const sc = snap.staffCounts || {};
    rows.push(['إجمالي العاملين',
      num(sc.admin) + num(sc.teaching) + num(sc.professional) + num(sc.worker) + num(sc.guard)]);
    rows.push(['إداري / تدريسي', `${num(sc.admin)} / ${num(sc.teaching)}`]);
    rows.push(['مهني / مستخدم / حارس',
      `${num(sc.professional)} / ${num(sc.worker)} / ${num(sc.guard)}`]);
  }

  let html = rows.map(([k, v]) =>
    `<div class="dir-req-detail"><span>${esc(k)}</span><strong>${esc(String(v ?? '—'))}</strong></div>`
  ).join('');

  // الإجازات: الصيغة الثانية تُرسل كائنات {type, days} بلا أسماء — والأسماء
  // مقصودةٌ خارج اللقطة (تذهب إلى monthly_statement_rosters بصلاحياته). فنجمع
  // حسب النوع: عددُ الإجازات ومجموعُ أيامها، وهو ما يحتاجه المُعتمِد فعلاً.
  const lines = v2
    ? (() => {
        const byType = new Map();
        for (const l of (Array.isArray(snap.leaves) ? snap.leaves : [])) {
          const k = String(l?.type ?? '').trim() || 'غير محدّد';
          const cur = byType.get(k) || { n: 0, days: 0 };
          cur.n += 1; cur.days += num(l?.days);
          byType.set(k, cur);
        }
        return [...byType].map(([k, v]) => `${k}: ${v.n} (${v.days} يوماً)`);
      })()
    : (Array.isArray(snap.leaveLines) ? snap.leaveLines.map(String) : []);

  if (lines.length) {
    html += `<div class="dir-req-detail" style="flex-direction:column;align-items:flex-start;gap:4px">
      <span>إجازات الشهر</span>
      <small style="color:var(--text-secondary)">${lines.map(l => esc(l)).join(' — ')}</small>
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
      msgEl.textContent = errMessage(err, 'تعذّرت المراجعة');
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
    renderAcademic();
    if (!sheets.length) { if (emptyEl) emptyEl.hidden = false; refreshBulkBar(); return; }
    sheets.forEach(s => listEl.appendChild(buildRsRow(s)));
    if (wrapEl) wrapEl.hidden = false;
    refreshBulkBar();
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

  /* ⚠ كان الزرّ يظهر لِـ submitted/approved فقط. فما إن يُصدر الجلاءُ (issued)
     أو يُرفَض حتى يصير محتواه غيرَ قابلٍ للفتح إلى الأبد — ولا مراجعةَ لقرار،
     ولا رجوعَ إلى نتيجةِ طالبٍ عند خلاف، ولا نسخةَ تُحفظ. الجلاءُ وثيقةٌ رسمية
     تُسلَّم للمديرية ثمّ لأولياء الأمور. الآن يُفتح دائماً بحسب حالته:
     مراجعة/إصدار للحالتين القابلتين للفعل، «عرض» للبقية. */
  const label = s.status === 'submitted' ? 'مراجعة'
              : s.status === 'approved'  ? 'إصدار'
              : 'عرض';
  const actionable = s.status === 'submitted' || s.status === 'approved';
  const actionHtml =
    `<button class="btn btn-sm ${actionable ? 'btn-primary' : 'btn-ghost'} dir-rs-review-btn"
       data-id="${esc(s.id)}" data-status="${esc(s.status)}"
       data-school="${esc(schoolName)}"
       data-label="${esc(clsLabel + ' — ' + termLabel)}"
       data-snap='${esc(JSON.stringify(s.snapshot_data || {}))}'>${label}</button>` +
    (!actionable && s.notes
      ? `<div class="dir-req-reason" style="margin-top:4px">${esc(s.notes)}</div>` : '');

  // Only sheets still awaiting a decision are selectable — there is nothing to
  // batch about one that is already issued or rejected.
  const checkHtml = actionable
    ? `<input type="checkbox" class="check dir-rs-check" data-id="${esc(s.id)}"
         data-status="${esc(s.status)}"
         aria-label="تحديد جلاء ${esc(schoolName)} — ${esc(clsLabel)}" />`
    : '';

  tr.innerHTML = `
    <td class="td-check">${checkHtml}</td>
    <td>${esc(schoolName)}</td>
    <td>${esc(clsLabel)} <small style="color:var(--text-secondary)">(${esc(termLabel)})</small></td>
    <td>${statusHtml}</td>
    <td>${actionHtml}</td>
  `;
  return tr;
}

// ══════════════════════════════════════════════
//  الاعتماد الجماعي للجلاءات
// ══════════════════════════════════════════════
// A batch carries exactly one decision, so a mixed selection is refused rather
// than silently split: "approve" and "issue" are different acts, and issuing is
// final (it publishes certificates). Homogeneous selections only.

function _rsChecked() {
  return Array.from(document.querySelectorAll('.dir-rs-check:checked'));
}

// The single status shared by the whole selection, or null when it is mixed.
function _rsSelectionStatus(boxes) {
  if (!boxes.length) return null;
  const first = boxes[0].dataset.status;
  return boxes.every(b => b.dataset.status === first) ? first : null;
}

function refreshBulkBar() {
  const bar     = document.getElementById('dir-bulk-bar');
  const mixed   = document.getElementById('dir-bulk-mixed');
  const countEl = document.getElementById('dir-bulk-count');
  const applyBtn = document.getElementById('dir-bulk-apply');
  const allBox  = document.getElementById('dir-rs-check-all');
  if (!bar) return;

  const boxes  = _rsChecked();
  const status = _rsSelectionStatus(boxes);
  bar.hidden   = boxes.length === 0;
  if (mixed) mixed.hidden = !(boxes.length > 0 && status === null);

  if (allBox) {
    const selectable = document.querySelectorAll('.dir-rs-check').length;
    allBox.checked = selectable > 0 && boxes.length === selectable;
    allBox.indeterminate = boxes.length > 0 && boxes.length < selectable;
  }

  if (!boxes.length) return;
  if (countEl) countEl.textContent = `${boxes.length} جلاء محدَّد`;
  if (applyBtn) {
    applyBtn.disabled = status === null;
    applyBtn.textContent = status === 'approved'
      ? `إصدار المحدَّد نهائياً (${boxes.length})`
      : `اعتماد المحدَّد (${boxes.length})`;
  }
}

function clearBulkSelection() {
  document.querySelectorAll('.dir-rs-check').forEach(b => { b.checked = false; });
  refreshBulkBar();
}

function setupRsBulk() {
  // Delegated: rows are re-rendered on every refresh, so per-row binding would
  // be lost each time loadResultSheets() runs.
  document.getElementById('dir-rs-list')?.addEventListener('change', (e) => {
    if (e.target.classList?.contains('dir-rs-check')) refreshBulkBar();
  });

  document.getElementById('dir-rs-check-all')?.addEventListener('change', (e) => {
    const boxes = Array.from(document.querySelectorAll('.dir-rs-check'));
    if (!e.target.checked) { clearBulkSelection(); return; }
    // "Select all" must stay within one decision. Pending review is the bulk
    // step that matters, so it wins whenever both groups are present.
    const target = boxes.some(b => b.dataset.status === 'submitted') ? 'submitted' : 'approved';
    boxes.forEach(b => { b.checked = b.dataset.status === target; });
    refreshBulkBar();
  });

  document.getElementById('dir-bulk-clear')?.addEventListener('click', clearBulkSelection);
  document.getElementById('dir-bulk-apply')?.addEventListener('click', runBulkReview);
}

async function runBulkReview() {
  const boxes  = _rsChecked();
  const status = _rsSelectionStatus(boxes);
  if (!boxes.length || status === null) return;

  const ids      = boxes.map(b => b.dataset.id);
  const decision = status === 'approved' ? 'issued' : 'approved';
  const ok = await dirConfirm(
    decision === 'issued' ? 'إصدار نهائي جماعي' : 'اعتماد جماعي',
    decision === 'issued'
      ? `سيصدر ${ids.length} جلاء نهائياً وتُنشَر شهاداتها. لا يمكن التراجع عن هذا الإجراء.`
      : `سيُعتمَد ${ids.length} جلاء وتنتقل لانتظار الإصدار النهائي.`
  );
  if (!ok) return;

  const applyBtn = document.getElementById('dir-bulk-apply');
  if (applyBtn) applyBtn.disabled = true;

  // Sequential, not Promise.all: each call is a separate RPC write and a
  // partial failure must be reportable per sheet rather than collapsing the
  // whole batch into one rejected promise.
  let done = 0;
  const failed = [];
  for (const id of ids) {
    try { await reviewResultSheet(id, decision, null); done++; }
    catch (err) { console.error('[DirResultSheets] bulk', id, err); failed.push(err?.message || id); }
  }

  if (applyBtn) applyBtn.disabled = false;
  const verb = decision === 'issued' ? 'صدر' : 'اعتُمد';
  if (failed.length) {
    showToast(`${verb} ${done} من ${ids.length}`, `تعذّر ${failed.length}: ${failed[0]}`, 'warning');
  } else {
    showToast(`${verb} ${done} جلاء ✓`, '', 'success');
  }
  clearBulkSelection();
  await loadResultSheets();
  refreshRailCounts();
}

// A promise-based confirm rendered in-app (never the browser's own dialog).
let _dirConfirmResolve = null;
function dirConfirm(title, message) {
  const overlay = document.getElementById('dir-confirm-modal');
  if (!overlay) return Promise.resolve(false);      // fail closed
  // A second open would orphan the first promise, leaving its caller awaiting
  // forever; settle it as a decline before taking over the dialog.
  if (_dirConfirmResolve) { _dirConfirmResolve(false); _dirConfirmResolve = null; }
  document.getElementById('dir-confirm-title').textContent = title;
  document.getElementById('dir-confirm-text').textContent  = message;
  overlay.hidden = false;
  return new Promise(resolve => { _dirConfirmResolve = resolve; });
}

function settleDirConfirm(value) {
  const overlay = document.getElementById('dir-confirm-modal');
  if (overlay) overlay.hidden = true;
  const r = _dirConfirmResolve;
  _dirConfirmResolve = null;
  if (r) r(value);
}

document.getElementById('dir-confirm-ok')?.addEventListener('click',     () => settleDirConfirm(true));
document.getElementById('dir-confirm-cancel')?.addEventListener('click', () => settleDirConfirm(false));
document.getElementById('dir-confirm-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'dir-confirm-modal') settleDirConfirm(false);
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.dir-rs-review-btn');
  if (!btn) return;
  _reviewingSheetId = btn.dataset.id;
  _reviewingSheetStatus = btn.dataset.status;
  let snap = {};
  try { snap = JSON.parse(btn.dataset.snap || '{}'); } catch { /* tolerate */ }

  const decided = _reviewingSheetStatus !== 'submitted' && _reviewingSheetStatus !== 'approved';
  const STATUS_AR = { issued: 'صادر ✓', rejected: 'مرفوض ✗', draft: 'مسودة' };
  const titleVerb = _reviewingSheetStatus === 'submitted' ? 'مراجعة جلاء'
                  : _reviewingSheetStatus === 'approved'  ? 'إصدار جلاء'
                  : 'عرض جلاء';
  document.getElementById('dir-rs-title').textContent =
    `${titleVerb}: ${btn.dataset.school} — ${btn.dataset.label}` +
    (decided ? ` (${STATUS_AR[_reviewingSheetStatus] ?? _reviewingSheetStatus})` : '');
  document.getElementById('dir-rs-body').innerHTML = buildRsSummary(snap);
  document.getElementById('dir-rs-notes').value = '';
  document.getElementById('dir-rs-msg').hidden = true;

  // Student roll — the whole list already travelled inside snapshot_data, so
  // opening the drill-down costs no extra query.
  _reviewingStudents = Array.isArray(snap.students) ? snap.students : [];
  const failedOnly = document.getElementById('dir-rs-failed-only');
  if (failedOnly) failedOnly.checked = false;
  renderRsStudents();

  /* أزرار القرار حسب الحالة، وتُخفى كاملةً لِما بُتَّ فيه: الجلاءُ الصادر
     وثيقةٌ نهائية، ورؤيةُ أزرار «موافقة/رفض» لصفٍّ لا يقبلها يُوهم أنّ ثمّ
     قراراً ينتظر. حقلُ السبب بلا معنى بعد صدور القرار كذلك. */
  const approveBtn = document.getElementById('dir-rs-approve');
  const rejectBtn  = document.getElementById('dir-rs-reject');
  const issueBtn   = document.getElementById('dir-rs-issue');
  if (approveBtn) approveBtn.hidden = _reviewingSheetStatus !== 'submitted';
  if (rejectBtn)  rejectBtn.hidden  = decided;
  if (issueBtn)   issueBtn.hidden   = _reviewingSheetStatus !== 'approved';
  const noteWrap = document.getElementById('dir-rs-notes')?.closest('.form-group');
  if (noteWrap) noteWrap.hidden = decided;

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

// ── تفصيل الطلاب داخل نافذة الجلاء ──────────────────────────────────────────
let _reviewingStudents = [];

function renderRsStudents() {
  const wrap    = document.getElementById('dir-rs-students');
  const chipsEl = document.getElementById('dir-rs-chips');
  const listEl  = document.getElementById('dir-rs-student-list');
  if (!wrap || !listEl) return;

  const all = _reviewingStudents;
  wrap.hidden = all.length === 0;
  if (!all.length) return;

  const passed     = all.filter(s => s.result === 'ناجح').length;
  const failed     = all.filter(s => s.result === 'راسب').length;
  const incomplete = all.filter(s => !s.complete).length;
  if (chipsEl) {
    chipsEl.innerHTML =
      `<span class="rs-chip rs-chip--good">ناجح ${passed}</span>` +
      `<span class="rs-chip rs-chip--bad">راسب ${failed}</span>` +
      (incomplete ? `<span class="rs-chip rs-chip--warn">غير مكتمل ${incomplete}</span>` : '') +
      `<span class="rs-chip rs-chip--outline">الإجمالي ${all.length}</span>`;
  }

  const onlyFailed = document.getElementById('dir-rs-failed-only')?.checked;
  const shown = onlyFailed ? all.filter(s => s.result === 'راسب') : all;
  if (!shown.length) {
    listEl.innerHTML = '<div class="rs-student-empty">لا يوجد طلاب راسبون في هذا الصف ✓</div>';
    return;
  }

  listEl.innerHTML = shown.map(s => {
    const pct = Number.isFinite(Number(s.finalPercent))
      ? `${Number(s.finalPercent).toFixed(1)}٪` : '—';
    // Grace marks changed the outcome, so the reviewer is told rather than
    // shown a bare pass they cannot account for.
    const grace = Number(s.graceMarks) > 0
      ? `<span class="rs-chip rs-chip--warn">مساعدة ${Number(s.graceMarks)}</span>` : '';
    const cls = s.result === 'ناجح' ? 'rs-chip--good'
              : s.result === 'راسب' ? 'rs-chip--bad' : 'rs-chip--outline';
    const label = s.result ?? (s.complete ? '—' : 'غير مكتمل');
    return `<div class="rs-student-row">
      <span class="nm">${esc(s.name ?? '—')}</span>
      ${grace}
      <span class="pct">${esc(pct)}</span>
      <span class="rs-chip ${cls}">${esc(label)}</span>
    </div>`;
  }).join('');
}

document.getElementById('dir-rs-failed-only')?.addEventListener('change', renderRsStudents);

// ══════════════════════════════════════════════
//  المستوى الأكاديمي
// ══════════════════════════════════════════════
// Built entirely from allResultSheets, which loadResultSheets() already holds —
// no extra query, no new RLS surface. Only sheets the directorate has actually
// decided on count: a `submitted` sheet is a claim, not a result.
let _acadTerm = 'year';
let acadCompareChart = null;

const ACAD_DECIDED = new Set(['approved', 'issued']);

function setupAcademicTerm() {
  document.querySelectorAll('.acad-term-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.acad-term-btn').forEach(b => {
        b.classList.remove('is-active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      _acadTerm = btn.dataset.term === 's1' ? 's1' : 'year';
      renderAcademic();
    });
  });
}

// Roll a set of sheets up into { total, passed, failed } over their snapshots.
function _acadTally(sheets) {
  let total = 0, passed = 0, failed = 0;
  for (const sh of sheets) {
    const students = Array.isArray(sh.snapshot_data?.students) ? sh.snapshot_data.students : [];
    total += students.length;
    for (const st of students) {
      if (st.result === 'ناجح') passed++;
      else if (st.result === 'راسب') failed++;
    }
  }
  return { total, passed, failed };
}

function renderAcademic() {
  const rankEl = document.getElementById('acad-rank');
  if (!rankEl) return;

  const decided = allResultSheets.filter(s => ACAD_DECIDED.has(s.status));
  const forTerm = decided.filter(s => s.term === _acadTerm);
  const { total, passed, failed } = _acadTally(forTerm);

  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('acad-total',  total ? total.toLocaleString('en-US') : '—');
  // Percent is over graded students only; an ungraded student is not a failure.
  const graded = passed + failed;
  setTxt('acad-rate',   graded ? `${((passed / graded) * 100).toFixed(1)}٪` : '—');
  setTxt('acad-failed', graded ? failed.toLocaleString('en-US') : '—');
  setTxt('acad-sheets', `${forTerm.length} / ${allResultSheets.filter(s => s.term === _acadTerm).length}`);

  // ── ترتيب المدارس بنسبة النجاح ──
  const bySchool = new Map();
  for (const sh of forTerm) {
    const name = sh.school?.name ?? '—';
    if (!bySchool.has(name)) bySchool.set(name, []);
    bySchool.get(name).push(sh);
  }
  const ranked = Array.from(bySchool, ([name, sheets]) => {
    const t = _acadTally(sheets);
    const g = t.passed + t.failed;
    return { name, rate: g ? (t.passed / g) * 100 : null, students: t.total };
  })
    .filter(r => r.rate !== null)
    .sort((a, b) => a.rate - b.rate);   // الأسوأ أولاً — الغرض متابعة المتعثّر

  const emptyEl = document.getElementById('acad-rank-empty');
  if (emptyEl) emptyEl.hidden = ranked.length > 0;
  rankEl.innerHTML = ranked.map((r, i) => {
    const color = r.rate >= 85 ? 'var(--good)' : r.rate >= 70 ? 'var(--warn)' : 'var(--bad)';
    return `<div class="rank-row">
      <span class="rank-idx">${i + 1}</span>
      <span class="rank-name" title="${esc(r.name)} — ${r.students} طالباً">${esc(r.name)}</span>
      <span class="rank-bar-bg"><span class="rank-bar-fill" style="width:${r.rate.toFixed(1)}%;background:${color}"></span></span>
      <span class="rank-val" style="color:${color}">${r.rate.toFixed(0)}٪</span>
    </div>`;
  }).join('');

  renderAcadCompare(decided);
}

// Term comparison: only schools that have BOTH a first-term and a full-year
// decided sheet can be compared — one bar alone would invite a false reading.
function renderAcadCompare(decided) {
  const canvas  = document.getElementById('acad-compare-chart');
  const emptyEl = document.getElementById('acad-compare-empty');
  if (!canvas || typeof Chart === 'undefined') return;

  const rateFor = (name, term) => {
    const t = _acadTally(decided.filter(s => (s.school?.name ?? '—') === name && s.term === term));
    const g = t.passed + t.failed;
    return g ? (t.passed / g) * 100 : null;
  };

  const names = Array.from(new Set(decided.map(s => s.school?.name ?? '—')));
  const rows = names
    .map(name => ({ name, s1: rateFor(name, 's1'), year: rateFor(name, 'year') }))
    .filter(r => r.s1 !== null && r.year !== null)
    .sort((a, b) => a.year - b.year)
    .slice(0, 10);

  if (emptyEl) emptyEl.hidden = rows.length > 0;
  canvas.hidden = rows.length === 0;
  if (acadCompareChart) { acadCompareChart.destroy(); acadCompareChart = null; }
  if (!rows.length) return;

  const opts = chartBaseOptions();
  opts.scales.y.max = 100;
  opts.scales.y.ticks.callback = (v) => `${v}٪`;
  acadCompareChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map(r => r.name),
      datasets: [
        { label: 'الفصل الأول',   data: rows.map(r => +r.s1.toFixed(1)),   backgroundColor: CH.line,  borderRadius: 3 },
        { label: 'السنة الكاملة', data: rows.map(r => +r.year.toFixed(1)), backgroundColor: CH.blue,  borderRadius: 3 },
      ],
    },
    options: opts,
  });
}

document.getElementById('dir-rs-approve')?.addEventListener('click', () => doRsReview('approved'));
document.getElementById('dir-rs-issue')?.addEventListener('click',   () => doRsReview('issued'));
document.getElementById('dir-rs-reject')?.addEventListener('click',  () => doRsReview('rejected'));

/* حفظ / طباعة: نسخةٌ رسمية بأنماطها في نافذةٍ مستقلّة — طباعةُ المودال نفسه
   تجرّ ترويسة اللوحة وأزرار القرار معها. */
document.getElementById('dir-rs-print')?.addEventListener('click', () => {
  const title = document.getElementById('dir-rs-title')?.textContent || 'جلاء';
  const summary = document.getElementById('dir-rs-body')?.innerHTML || '';
  const rows = _reviewingStudents.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(s.name || '—')}</td>
      <td>${esc(s.result || '—')}</td>
      <td>${s.finalPercent != null ? (Math.round(s.finalPercent * 10) / 10) + '٪' : '—'}</td>
      <td>${s.complete ? '✓' : ''}</td>
    </tr>`).join('');
  const win = window.open('', '_blank');
  if (!win) { showToast('امنع حاصر النوافذ المنبثقة لحفظ الورقة', '', 'error'); return; }
  win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
    <title>${esc(title)}</title>
    <style>
      body { font-family: system-ui, 'Segoe UI', Tahoma, sans-serif; direction: rtl;
             margin: 24px; color: #111; font-size: 13px; }
      h1 { font-size: 17px; margin: 0 0 12px; }
      h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
      .summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 12px; margin-bottom: 12px; }
      .summary > div { display: flex; justify-content: space-between; padding: 3px 8px; background: #f8fafc; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: center; }
      th { background: #f1f5f9; font-weight: 700; }
      @media print { body { margin: 0; } }
    </style></head><body>
    <h1>${esc(title)}</h1>
    <h2>الملخّص</h2>
    <div class="summary">${summary}</div>
    <h2>قائمة الطلاب</h2>
    <table>
      <thead><tr><th>#</th><th>الاسم</th><th>النتيجة</th><th>النسبة النهائية</th><th>مكتمل</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">لا سجلات</td></tr>'}</tbody>
    </table>
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
});

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
      msgEl.textContent = errMessage(err, 'تعذّرت المراجعة');
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
  if (tabName === 'schools') { loadDirSchools(); loadDirPrincipals(); loadDeparted(); }

  if (tabName === 'staff') initStaffDirectory();

  // Leaflet measures 0×0 while its panel is display:none, so it must be told to
  // re-measure whenever the overview becomes visible again.
  if (tabName === 'overview' && map) setTimeout(() => map.invalidateSize(), 0);

  // Chart.js sizes to its container, which is 0×0 while the panel is hidden —
  // the same reason the map needs invalidateSize above.
  if (tabName === 'academic') setTimeout(() => renderAcademic(), 0);
}

// Segmented control inside the "schools" section (schools ⇄ principals ⇄ import).
// Scoped to #dir-schools-seg: the academic panel reuses .dir-seg-btn for its own
// term switch, so an unscoped query would make a term click retoggle these panels.
function setupDirSeg() {
  const seg = document.getElementById('dir-schools-seg');
  if (!seg) return;
  const panels = {
    schools:    document.getElementById('dir-seg-schools'),
    principals: document.getElementById('dir-seg-principals'),
    import:     document.getElementById('dir-seg-import'),
  };
  seg.querySelectorAll('.dir-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      seg.querySelectorAll('.dir-seg-btn').forEach(b => {
        b.classList.remove('is-active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      const which = btn.dataset.seg;
      for (const [key, el] of Object.entries(panels)) {
        if (el) el.hidden = key !== which;
      }
      if (which === 'import') fillImportSchools();
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
  /* العنوان يُقرأ قبل أن يُكتب: كان الإقلاع يدوس عليه بـ '#overview' دائماً،
     فتحديثُ الصفحة يُخرج الموظّف من التبويب الذي يعمل فيه إلى أوّل تبويب. */
  const names = [...document.querySelectorAll('.dir-tab-btn')].map(b => b.dataset.tab);
  const start = restoreTab(names, 'overview');
  history.replaceState({ tab: start, d: 0 }, '', '#' + start);
  if (start !== 'overview') _dirActivateTab(start);

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
    .select('id, name, school_type, classification, education_type, shift, student_type, total_students, total_teachers, lat, lng, complex_name, directorate_id, archived_at')
    .eq('directorate_id', currentUser.directorateId)
    // المؤرشفة (§25) لا تظهر للمديرية — لوحة المشرف وحدها تراها وتسترجعها.
    .is('archived_at', null)
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
  // ونفس القائمة في قسم الاستيراد — يُملأ من هنا لا من نقرة المبدّل وحدها،
  // فالنقرة قد تسبق انتهاء هذا الجلب.
  fillImportSchools();

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
  // ابتدائي افتراضاً — نفس default القاعدة، فلا يمرّ خيار فارغ إلى قيد CHECK.
  const stAdd = document.getElementById('dir-sm-school-type');
  if (stAdd) stAdd.value = 'primary';
  ['dir-sm-school-type','dir-sm-classification','dir-sm-education-type','dir-sm-shift','dir-sm-student-type']
    .forEach(id => CustomSelect.refresh(id));
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
  set('dir-sm-school-type', s.school_type ?? 'primary');
  set('dir-sm-classification', s.classification);
  set('dir-sm-education-type', s.education_type);
  set('dir-sm-shift', s.shift);
  set('dir-sm-student-type', s.student_type);
  set('dir-sm-total-students', s.total_students);
  set('dir-sm-total-teachers', s.total_teachers);
  set('dir-sm-complex-name', s.complex_name);
  // كانت القوائم المخصّصة لا تُحدَّث بعد ضبط القيم برمجياً، فتبقى معروضة على
  // اختيار المدرسة السابقة رغم أنّ <select> الأصلي تغيّر.
  ['dir-sm-school-type','dir-sm-classification','dir-sm-education-type','dir-sm-shift','dir-sm-student-type']
    .forEach(id => CustomSelect.refresh(id));
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
    const complex = document.getElementById('dir-sm-complex-name')?.value.trim() ?? '';
    const stype   = document.getElementById('dir-sm-school-type')?.value ?? '';
    const fail = (m) => { if (errEl) { errEl.textContent = m; errEl.hidden = false; } };
    if (!name) { fail('اسم المدرسة مطلوب.'); return; }
    // المجمّع يُطبَع في ترويسة بطاقة العلامات وورقة «لا مانع» — غيابه يُخرِج
    // وثيقة رسمية ناقصة.
    if (!complex) { fail('اسم المجمع المدرسي مطلوب — يظهر في ترويسة الوثائق المطبوعة.'); return; }
    if (!stype)   { fail('يجب اختيار نوع المدرسة.'); return; }
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
      school_type:     getVal('dir-sm-school-type'),
      classification:  getVal('dir-sm-classification')   || null,
      education_type:  getVal('dir-sm-education-type')   || null,
      shift:           getVal('dir-sm-shift')            || null,
      student_type:    getVal('dir-sm-student-type')     || null,
      total_students:  getInt('dir-sm-total-students'),
      total_teachers:  getInt('dir-sm-total-teachers'),
      complex_name:    complex,
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
      if (errEl) { errEl.textContent = errMessage(e, 'تعذّرت العملية. أعد المحاولة.'); errEl.hidden = false; }
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

/* ── مغادرو المدارس (كشف مديرية) ────────────────────────────────────────────
   دالّةٌ SECURITY DEFINER تُصفّي بحسب `current_user_directorate_id()` — تمرير
   مدرسةٍ أجنبية يُفرغ النتيجة لا يوسّعها. الترتيب افتراضياً بالمجموع تنازلياً،
   فيرى الموظّف الظواهر (مدرسةٌ يرتفع عندها الترقين) فوراً. */
async function loadDeparted() {
  const loading = document.getElementById('dep-loading');
  const wrap    = document.getElementById('dep-table-wrap');
  const tbody   = document.getElementById('dep-tbody');
  const empty   = document.getElementById('dep-empty');
  const err     = document.getElementById('dep-error');
  if (!tbody) return;

  loading?.classList.remove('hidden');
  wrap?.classList.add('hidden'); empty?.classList.add('hidden'); err?.classList.add('hidden');

  try {
    const rows = await getDirectorateDepartures();
    const shown = rows.filter(r => r.total_departed > 0);
    if (!shown.length) { empty?.classList.remove('hidden'); return; }
    tbody.innerHTML = shown.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(r.school_name)}</td>
        <td>${r.transferred}</td>
        <td>${r.out_of_year}</td>
        <td>${r.graduated}</td>
        <td>${r.struck_off}</td>
        <td><b>${r.total_departed}</b></td>
      </tr>`).join('');
    wrap?.classList.remove('hidden');
  } catch (e) {
    console.error('[dir] loadDeparted', e);
    err?.classList.remove('hidden');
  } finally {
    loading?.classList.add('hidden');
  }
}

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

// The stored password is never read back. Handing an operator an existing
// credential means the plaintext is only ever one screenshot away; instead they
// mint a fresh one, see it once, and pass it on.
let _dirCredUserId = null;
// صحيح أثناء انتظار نافذة تأكيد مفتوحة فوق نافذة كلمة المرور.
let _dirCredBusy   = false;

async function openDirCredModal(userId, name) {
  const modal    = document.getElementById('dir-cred-modal');
  const nameEl   = document.getElementById('dir-cred-name');
  const emailEl  = document.getElementById('dir-cred-email');
  const nfEl     = document.getElementById('dir-cred-not-found');
  if (!modal) return;

  _dirCredUserId = userId;
  if (nameEl)  nameEl.textContent  = name || '—';
  if (emailEl) emailEl.textContent = '…';
  if (nfEl)    nfEl.hidden = true;
  const resetBox = document.getElementById('dir-cred-reset-box');
  const msgBox   = document.getElementById('dir-cred-msg');
  const resetBtn = document.getElementById('dir-cred-reset');
  if (resetBox) resetBox.hidden = true;
  if (msgBox)   msgBox.hidden   = true;
  // Restore the regenerate button on every open — the reset handler hides it once
  // a password is minted (so an accidental second click can't replace it).
  if (resetBtn) { resetBtn.hidden = false; resetBtn.disabled = false; }
  modal.classList.remove('hidden');

  // Only the address is read — the password column is deliberately not selected.
  const { data, error } = await _sb.from('admin_credentials')
    .select('email').eq('user_id', userId).maybeSingle();

  if (error || !data) {
    if (emailEl) emailEl.textContent = '—';
    if (nfEl)    nfEl.hidden = false;
  } else if (emailEl) {
    emailEl.textContent = data.email;
  }
}

document.getElementById('dir-cred-reset')?.addEventListener('click', async () => {
  if (!_dirCredUserId) return;
  const name = document.getElementById('dir-cred-name')?.textContent || 'هذا الحساب';
  // نمسك المعرّف قبل التأكيد: نافذة كلمة المرور قد تُغلق أثناء انتظار الجواب،
  // وإغلاقها يصفّر _dirCredUserId.
  const userId = _dirCredUserId;
  _dirCredBusy = true;
  let ok = false;
  try {
    ok = await dirConfirm(
      'إنشاء كلمة مرور جديدة',
      `ستتوقّف كلمة المرور الحالية لـ«${name}» عن العمل فوراً، وتُعرَض الجديدة مرة واحدة فقط.`
    );
  } finally {
    _dirCredBusy = false;
  }
  if (!ok) return;

  const btn    = document.getElementById('dir-cred-reset');
  const msgEl  = document.getElementById('dir-cred-msg');
  const box    = document.getElementById('dir-cred-reset-box');
  const passEl = document.getElementById('dir-cred-newpass');
  // كل وجهات العرض داخل #dir-cred-modal: إن كانت مغلقة كُتبت النتيجة — وكذلك
  // نصّ الخطأ — في شجرة مخفية، فيبدو الزرّ بلا أثر. نعيد فتحها قبل أي شيء.
  document.getElementById('dir-cred-modal')?.classList.remove('hidden');
  if (btn) btn.disabled = true;
  if (msgEl) msgEl.hidden = true;
  let minted = false;
  try {
    const res = await dirEdgeFetch('admin-create-user', { action: 'reset_password', userId });
    if (passEl) passEl.textContent = res.password;
    if (box) box.hidden = false;
    minted = true;
    // التحذير يعني أن كلمة المرور بُدِّلت لكن سجلّ الاعتماد لم يُحدَّث — إخفاؤه
    // يترك المديرية تظنّ كل شيء تمّ.
    if (res.warning && msgEl) {
      msgEl.className   = 'dir-review-msg';
      msgEl.textContent = res.warning;
      msgEl.hidden      = false;
    }
  } catch (e) {
    if (msgEl) {
      msgEl.className   = 'dir-review-msg';
      msgEl.textContent = errMessage(e, 'تعذّرت إعادة التعيين');
      msgEl.hidden      = false;
    }
  } finally {
    // Once a password is minted, HIDE the regenerate button: a second click would
    // mint a NEW password and silently invalidate the one the operator just copied
    // (the cause of the "بيانات الدخول غير صحيحة" lockout). Re-enable only on
    // failure so a genuine retry is still possible. Reopening restores the button.
    if (btn) { if (minted) { btn.hidden = true; } else { btn.disabled = false; } }
  }
});

document.getElementById('dir-cred-copy')?.addEventListener('click', async () => {
  const txt = document.getElementById('dir-cred-newpass')?.textContent ?? '';
  if (!txt || txt === '—') return;
  try {
    await navigator.clipboard.writeText(txt);
    showToast('نُسخت كلمة المرور', '', 'success');
    // Copied → close the modal so the flow ends cleanly. The operator now has the
    // password and there is nothing left to do; this also prevents lingering on a
    // screen whose only other action would mint a different password.
    document.getElementById('dir-cred-modal')?.classList.add('hidden');
    _dirCredUserId = null;
  } catch {
    showToast('تعذّر النسخ', 'حدّد النصّ وانسخه يدوياً.', 'info');
  }
});

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
      showErr(errMessage(e, 'تعذّرت العملية. أعد المحاولة.'));
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
      if (errEl) { errEl.textContent = errMessage(e, 'تعذّرت العملية. أعد المحاولة.'); errEl.hidden = false; }
    } finally {
      if (confirmBtn) confirmBtn.disabled = false;
    }
  });

  // مودال بيانات الحساب
  const closeCredModal = () => {
    document.getElementById('dir-cred-modal')?.classList.add('hidden');
    _dirCredUserId = null;
  };
  document.getElementById('dir-cred-modal-close')?.addEventListener('click', closeCredModal);
  document.getElementById('dir-cred-modal-ok')?.addEventListener('click',    closeCredModal);
  document.getElementById('dir-cred-modal')?.addEventListener('click', e => {
    // أثناء انتظار التأكيد لا تُغلق بالنقر على الخلفية: النقرة كانت تُقصَد
    // لنافذة التأكيد فوقها، وإغلاق هذه يخفي وجهة عرض النتيجة والخطأ معاً.
    if (e.target.id === 'dir-cred-modal' && !_dirCredBusy) closeCredModal();
  });
}

// ══════════════════════════════════════════════
//  استيراد بيانات مدرسة (§24)
// ══════════════════════════════════════════════
// كل الكتابة تمرّ بدالتَي security definer في القاعدة — لا تملك المديرية أي
// صلاحية RLS مباشرة على students أو staff_records، ولا يجوز أن تُمنَح.
// القراءة والتحقّق هنا تكرار مقصود لما تفعله الدالة في الخادم: المعاينة قبل
// الإرسال حاجة عملية (الموظّف يُصحّح ملفّه لا يكتشف الخطأ بعد الكتابة)،
// والخادم يبقى المرجع الأخير.

const IMP = window.RUQI_ImportParser;

const STUDENT_IMPORT_SCHEMA = [
  { key: 'firstName',  label: 'الاسم الأول',    required: true,
    aliases: ['الاسم الأول', 'الاسم', 'الإسم', 'اسم الطالب', 'الطالب', 'first name'] },
  { key: 'fatherName', label: 'اسم الأب',       required: true,
    aliases: ['اسم الأب', 'الأب', 'اسم الوالد', 'father name'] },
  { key: 'familyName', label: 'الكنية',          required: true,
    aliases: ['الكنية', 'النسبة', 'اسم العائلة', 'العائلة', 'last name', 'family name'] },
  { key: 'gender',     label: 'الجنس',           required: true,
    aliases: ['الجنس', 'النوع', 'gender', 'sex'] },
  // ⚠️ «الفصل» ليست مرادفاً للشعبة هنا — تصادم مع «الفصل الدراسي» في البيان.
  { key: 'grade',      label: 'الصف',            required: true,
    aliases: ['الصف', 'الصف الدراسي', 'المرحلة', 'grade'] },
  { key: 'section',    label: 'الشعبة',          required: true,
    aliases: ['الشعبة', 'شعبة', 'section'] },
  { key: 'birthDate',  label: 'تاريخ الميلاد',   required: false,
    aliases: ['تاريخ الميلاد', 'تاريخ الولادة', 'المواليد', 'مواليد', 'birth date', 'dob'] },
  { key: 'nationalId', label: 'الرقم الوطني',    required: false,
    aliases: ['الرقم الوطني', 'رقم وطني', 'رقم الهوية', 'الهوية', 'national id'] },
];

const STAFF_IMPORT_SCHEMA = [
  { key: 'fullName',        label: 'الاسم الكامل',      required: true,
    aliases: ['الاسم الكامل', 'الاسم', 'الإسم', 'الاسم الثلاثي', 'اسم الموظف', 'full name'] },
  // ⚠️ فئة الكادر عمود صريح في الملفّ — لا تُستنتَج من المسمّى الوظيفي كما في
  //    النموذج الفردي بلوحة المدرسة. الاستنتاج الصامت خطِر في استيراد جماعي.
  { key: 'staffType',       label: 'فئة الكادر',        required: true,
    aliases: ['فئة الكادر', 'الفئة', 'نوع الكادر', 'التصنيف', 'staff type'] },
  { key: 'gender',          label: 'الجنس',             required: true,
    aliases: ['الجنس', 'النوع', 'gender', 'sex'] },
  { key: 'nationalId',      label: 'الرقم الوطني',      required: false,
    aliases: ['الرقم الوطني', 'رقم وطني', 'رقم الهوية', 'الهوية', 'national id'] },
  { key: 'motherName',      label: 'اسم الأم',          required: false,
    aliases: ['اسم الأم', 'الأم', 'اسم الوالدة', 'mother name'] },
  { key: 'birthDate',       label: 'تاريخ الميلاد',     required: false,
    aliases: ['تاريخ الميلاد', 'تاريخ الولادة', 'المواليد', 'مواليد', 'birth date'] },
  { key: 'jobTitle',        label: 'المسمّى الوظيفي',   required: false,
    aliases: ['المسمى الوظيفي', 'الوظيفة', 'المهنة', 'job title'] },
  { key: 'specialization',  label: 'الاختصاص',          required: false,
    aliases: ['الاختصاص', 'التخصص', 'الإختصاص'] },
  { key: 'subjectTaught',   label: 'المادة المُدرَّسة',  required: false,
    aliases: ['المادة', 'مادة التدريس', 'المادة المدرسة', 'subject'] },
  { key: 'certificate',     label: 'الشهادة',           required: false,
    aliases: ['الشهادة', 'المؤهل', 'المؤهل العلمي'] },
  { key: 'higherDegree',    label: 'الدراسات العليا',   required: false,
    aliases: ['الدراسات العليا', 'شهادة عليا', 'الدرجة العلمية'] },
  { key: 'seniorityYear',   label: 'سنة القدم',         required: false,
    aliases: ['سنة القدم', 'القدم', 'سنة التعيين', 'التعيين'] },
  { key: 'phone',           label: 'الهاتف',            required: false,
    aliases: ['الهاتف', 'رقم الهاتف', 'الموبايل', 'الجوال', 'phone'] },
  { key: 'residentialZone', label: 'المنطقة السكنية',   required: false,
    aliases: ['المنطقة السكنية', 'منطقة السكن', 'السكن'] },
  { key: 'educationalZone', label: 'المنطقة التعليمية', required: false,
    aliases: ['المنطقة التعليمية', 'المنطقة التربوية'] },
  { key: 'rosterType',      label: 'نوع الملاك',        required: false,
    aliases: ['نوع الملاك', 'الملاك'] },
  { key: 'notes',           label: 'ملاحظات',           required: false,
    aliases: ['ملاحظات', 'ملاحظة', 'notes'] },
];

const STAFF_TYPE_WORDS = {
  'اداري': 'admin', 'ادارة': 'admin', 'اداره': 'admin', 'admin': 'admin',
  'تدريسي': 'teaching', 'معلم': 'teaching', 'مدرس': 'teaching', 'تعليمي': 'teaching',
  'مدرسه': 'teaching', 'معلمه': 'teaching', 'teaching': 'teaching',
  'مهني': 'professional', 'فني': 'professional', 'professional': 'professional',
  'مستخدم': 'worker', 'عامل': 'worker', 'خدمات': 'worker', 'عامله': 'worker', 'worker': 'worker',
  'حارس': 'guard', 'حراسه': 'guard', 'ناطور': 'guard', 'guard': 'guard',
};
const STAFF_TYPE_LABELS = {
  admin: 'إداري', teaching: 'تدريسي', professional: 'مهني',
  worker: 'مستخدم', guard: 'حارس',
};
const ROSTER_TYPE_WORDS = {
  'داخل': 'inside', 'داخل الملاك': 'inside', 'inside': 'inside', 'مثبت': 'inside',
  'خارج': 'outside', 'خارج الملاك': 'outside', 'outside': 'outside',
  'عقد': 'contract', 'متعاقد': 'contract', 'contract': 'contract',
};

// أعمدة العيّنة المعروضة في المعاينة — لا كل الحقول، فالجدول يبقى مقروءاً.
const IMP_SAMPLE_COLS = {
  students: [
    { key: 'first_name',  label: 'الاسم' },
    { key: 'father_name', label: 'الأب' },
    { key: 'family_name', label: 'الكنية' },
    { key: 'gender',      label: 'الجنس', fmt: g => (g === 'male' ? 'ذكر' : g === 'female' ? 'أنثى' : '—') },
    { key: 'birth_date',  label: 'الميلاد' },
    { key: 'national_id', label: 'الرقم الوطني' },
  ],
  staff: [
    { key: 'full_name',   label: 'الاسم' },
    { key: 'staff_type',  label: 'الفئة', fmt: t => STAFF_TYPE_LABELS[t] || t || '—' },
    { key: 'gender',      label: 'الجنس', fmt: g => (g === 'male' ? 'ذكر' : g === 'female' ? 'أنثى' : '—') },
    { key: 'job_title',   label: 'المسمّى' },
    { key: 'national_id', label: 'الرقم الوطني' },
  ],
};

let _impKind     = 'students';
let _impHeaders  = [];
let _impRows     = [];
let _impMapping  = {};
let _impConf     = {};
let _impClasses  = [];   // صفوف المدرسة المختارة (للطلاب)
let _impPrepared = null; // { ok, issues, groups }
let _impBusy     = false;

function impSchema() {
  return _impKind === 'students' ? STUDENT_IMPORT_SCHEMA : STAFF_IMPORT_SCHEMA;
}
function impEl(id) { return document.getElementById(id); }

function impShowError(msg) {
  const el = impEl('imp-error');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
}

// تُصفَّر الخطوتان ٢ و٣ عند أي تغيير في المدخلات: معاينة مبنيّة على ملفّ سابق
// أو مدرسة سابقة أخطر من غياب معاينة.
function impResetFrom(step) {
  if (step <= 2) {
    _impHeaders = []; _impRows = []; _impMapping = {}; _impConf = {};
    impEl('imp-step-map').hidden = true;
    impEl('imp-map-msg').hidden = true;
  }
  if (step <= 3) {
    _impPrepared = null;
    impEl('imp-step-preview').hidden = true;
    impEl('imp-preview-msg').hidden = true;
  }
  impEl('imp-step-done').hidden = true;
  impShowError('');
}

function setupImport() {
  const fileEl = impEl('imp-file');
  if (!fileEl) return;

  impEl('imp-school')?.addEventListener('change', () => {
    impResetFrom(2);
    if (fileEl) fileEl.value = '';
    loadImportClasses();
  });

  document.querySelectorAll('.imp-kind-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-active')) return;
      document.querySelectorAll('.imp-kind-btn').forEach(b => {
        b.classList.remove('is-active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      _impKind = btn.dataset.kind;
      impResetFrom(2);
      fileEl.value = '';
      renderImportHint();
    });
  });

  fileEl.addEventListener('change', () => handleImportFile(fileEl.files?.[0]));
  impEl('imp-template-btn')?.addEventListener('click', downloadImportTemplate);
  impEl('imp-map-next')?.addEventListener('click', buildImportPreview);
  impEl('imp-back-map')?.addEventListener('click', () => {
    impResetFrom(3);
    impEl('imp-step-map').hidden = false;
  });
  impEl('imp-run-btn')?.addEventListener('click', runImport);
  impEl('imp-restart')?.addEventListener('click', () => {
    impResetFrom(2);
    fileEl.value = '';
  });

  CustomSelect.enhance('imp-school');
  renderImportHint();
}

function renderImportHint() {
  const el = impEl('imp-hint-fields');
  if (!el) return;
  const req = impSchema().filter(f => f.required).map(f => f.label).join('، ');
  const opt = impSchema().filter(f => !f.required).map(f => f.label).join('، ');
  el.innerHTML = `<b>أعمدة إلزامية:</b> ${dirEsc(req)}.<br><b>اختيارية:</b> ${dirEsc(opt)}.`;
}

function fillImportSchools() {
  const sel = impEl('imp-school');
  if (!sel) return;
  const keep = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  _dirAllSchools.forEach(s => sel.add(new Option(s.name, s.id)));
  if (keep && _dirAllSchools.some(s => s.id === keep)) sel.value = keep;
  CustomSelect.refresh('imp-school');
}

async function loadImportClasses() {
  _impClasses = [];
  const schoolId = impEl('imp-school')?.value;
  if (!schoolId || _impKind !== 'students') return;
  try {
    _impClasses = await getSchoolClassesForDirectorate(schoolId);
  } catch (e) {
    impShowError(errMessage(e, 'تعذّر جلب صفوف المدرسة.'));
  }
}

// ── الخطوة ١ → ٢: قراءة الملفّ ومطابقة الأعمدة ───────────────────────────
async function handleImportFile(file) {
  impResetFrom(2);
  if (!file) return;

  const schoolId = impEl('imp-school')?.value;
  if (!schoolId) {
    impShowError('اختر المدرسة أوّلاً ثم ارفع الملفّ.');
    impEl('imp-file').value = '';
    return;
  }

  try {
    const { headers, rows } = await IMP.readFile(file);
    _impHeaders = headers;
    _impRows    = rows;
    if (_impKind === 'students' && !_impClasses.length) await loadImportClasses();

    const m = IMP.matchHeaders(headers, impSchema());
    _impMapping = m.mapping;
    _impConf    = m.confidence;
    renderImportMapping(m);
    impEl('imp-step-map').hidden = false;
    impEl('imp-step-map').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    impShowError(errMessage(e, 'تعذّرت قراءة الملفّ.'));
  }
}

function impSampleFor(colIndex) {
  if (colIndex == null) return '';
  for (const r of _impRows.slice(0, 20)) {
    const v = String(r[colIndex] ?? '').trim();
    if (v) return v;
  }
  return '';
}

const IMP_CONF_LABEL = {
  exact:    'تطابق تام',
  contains: 'مُرجَّح',
  fuzzy:    'تقريبي — راجِعه',
};

function renderImportMapping(m) {
  const tbody = impEl('imp-map-tbody');
  if (!tbody) return;

  tbody.innerHTML = impSchema().map(f => {
    const col  = _impMapping[f.key];
    const conf = _impConf[f.key];
    const cls  = conf ? `imp-conf--${conf}` : 'imp-conf--none';
    const lbl  = conf ? IMP_CONF_LABEL[conf] : 'لم يُطابَق';
    // التقريبي معروض في القائمة ليراه المستخدم، ولا يُحتسَب مقبولاً إلا بتأشيرة
    // صريحة: مطابقة خاطئة صامتة أسوأ بكثير من نقرة تأكيد.
    const confirmBox = conf === 'fuzzy'
      ? `<label class="imp-confirm">
           <input type="checkbox" data-confirm="${f.key}" /> أُؤكّد هذا الاقتراح
         </label>`
      : '';
    return `
      <tr class="${f.required && col == null ? 'imp-map-row--missing' : ''}">
        <td>
          <span class="imp-map-field">
            ${dirEsc(f.label)}${f.required ? '<span class="imp-req">*</span>' : ''}
            <span class="imp-conf ${cls}">${lbl}</span>
          </span>
        </td>
        <td>
          <select data-field="${f.key}"></select>
          ${confirmBox}
        </td>
        <td class="imp-map-sample" data-sample="${f.key}">${dirEsc(impSampleFor(col))}</td>
      </tr>`;
  }).join('');

  // الخيارات والقيم تُضبط بعد الحقن لا داخل نصّ HTML: عناوين الملفّ نصّ خارجي،
  // وبناؤها كعُقَد يُغني عن أي هروب يدوي في سمة value.
  tbody.querySelectorAll('select[data-field]').forEach(sel => {
    const key = sel.dataset.field;
    sel.add(new Option('— لا يوجد —', ''));
    _impHeaders.forEach((h, i) => sel.add(new Option(h || `العمود ${i + 1}`, String(i))));
    sel.value = _impMapping[key] == null ? '' : String(_impMapping[key]);

    sel.addEventListener('change', () => {
      const v = sel.value === '' ? null : Number(sel.value);
      _impMapping[key] = v;
      _impConf[key]    = v == null ? null : 'manual';
      const cell = tbody.querySelector(`[data-sample="${key}"]`);
      if (cell) cell.textContent = impSampleFor(v);
      const badge = sel.closest('tr')?.querySelector('.imp-conf');
      if (badge) {
        badge.className = `imp-conf ${v == null ? 'imp-conf--none' : 'imp-conf--exact'}`;
        badge.textContent = v == null ? 'لم يُطابَق' : 'اختيار يدوي';
      }
      // اختيار يدوي يُلغي حاجة التأكيد: القرار صار للمستخدم أصلاً.
      sel.closest('tr')?.querySelector('.imp-confirm')?.remove();
      sel.closest('tr')?.classList.remove('imp-map-row--missing');
      impEl('imp-map-msg').hidden = true;
    });
  });

  tbody.querySelectorAll('input[data-confirm]').forEach(cb => {
    cb.addEventListener('change', () => { impEl('imp-map-msg').hidden = true; });
  });

  // ملاحظة مبكّرة قبل الضغط على «تابِع» — نفس الفحص يتكرّر عند الضغط.
  const msg = impEl('imp-map-msg');
  const missing = impSchema().filter(f => f.required && _impMapping[f.key] == null);
  if (missing.length) {
    msg.textContent = `حدِّد عمود ملفّك لهذه الحقول قبل المتابعة: ${
      missing.map(f => f.label).join('، ')}.`;
    msg.hidden = false;
  } else {
    // الحقول التقريبية مستثناة: شارتها ومربّع تأكيدها يقولان ذلك بوضوح أكبر،
    // وتكرار التحذير هنا يُغرِق التنبيه الحقيقي (عمودان صالحان لحقل واحد).
    const trulyAmbiguous = (m.ambiguous ?? []).filter(k => _impConf[k] !== 'fuzzy');
    if (trulyAmbiguous.length) {
      msg.textContent = 'بعض الحقول احتملت أكثر من عمود — تأكّد من الاختيارات أعلاه.';
      msg.hidden = false;
    }
  }
}

// الحقول التي طوبقت تقريبياً ولم يؤكّدها المستخدم بعد.
function impUnconfirmedFuzzy() {
  return impSchema().filter(f =>
    _impConf[f.key] === 'fuzzy' &&
    !document.querySelector(`input[data-confirm="${f.key}"]`)?.checked);
}

// ── الخطوة ٢ → ٣: التحقّق وبناء المعاينة ─────────────────────────────────
function impGradeNumber(raw) {
  const s = IMP.normalizeArabicDigits(String(raw ?? '')).trim();
  if (!s) return null;
  const digits = s.match(/\d{1,2}/);
  if (digits) {
    const n = Number(digits[0]);
    if (n >= 1 && n <= 12) return n;
  }
  const w = IMP.ordinalWordToNumber(s);
  return (w != null && w >= 1 && w <= 12) ? w : null;
}

function impResolveClass(gradeRaw, sectionRaw) {
  const g = impGradeNumber(gradeRaw);
  if (g == null) return { classId: null, error: `الصف غير مفهوم: «${String(gradeRaw || '').trim() || '—'}»` };

  const secNorm = IMP.normalizeArabicText(IMP.normalizeArabicDigits(sectionRaw));
  if (!secNorm) return { classId: null, error: 'الشعبة مطلوبة' };

  const sameGrade = _impClasses.filter(c => Number(c.grade) === g);
  if (!sameGrade.length) return { classId: null, error: `لا يوجد صفّ ${g} في هذه المدرسة` };

  const hit = sameGrade.find(c => IMP.normalizeArabicText(IMP.normalizeArabicDigits(c.section)) === secNorm);
  if (hit) return { classId: hit.id, error: null };

  return { classId: null, error: `لا توجد شعبة «${String(sectionRaw).trim()}» في الصف ${g}` };
}

function buildImportPreview() {
  impShowError('');
  const msg = impEl('imp-map-msg');

  const missing = impSchema().filter(f => f.required && _impMapping[f.key] == null);
  if (missing.length) {
    msg.textContent = `حدِّد عمود ملفّك لهذه الحقول قبل المتابعة: ${missing.map(f => f.label).join('، ')}.`;
    msg.hidden = false;
    return;
  }

  const unconfirmed = impUnconfirmedFuzzy();
  if (unconfirmed.length) {
    msg.textContent = `طوبقت هذه الحقول تقريبياً — أكّدها أو اختر العمود بنفسك: ${
      unconfirmed.map(f => f.label).join('، ')}.`;
    msg.hidden = false;
    return;
  }

  const mapped = IMP.applyMapping(_impHeaders, _impRows, _impMapping);
  const ok = [], issues = [];

  mapped.forEach((r, i) => {
    const line = i + 2;   // +1 لصفّ العناوين و+1 لأنّ الترقيم يبدأ من واحد
    const built = _impKind === 'students' ? impBuildStudent(r) : impBuildStaff(r);
    if (built.error) issues.push({ line, name: built.name || '—', error: built.error });
    else ok.push({ line, ...built.row, __classId: built.classId, __rawClass: built.rawClass });
  });

  _impPrepared = { ok, issues };
  renderImportPreview();
  impEl('imp-step-map').hidden = true;
  impEl('imp-step-preview').hidden = false;
  impEl('imp-step-preview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function impBuildStudent(r) {
  const first  = String(r.firstName  ?? '').trim();
  const father = String(r.fatherName ?? '').trim();
  const family = String(r.familyName ?? '').trim();
  const name   = [first, father, family].filter(Boolean).join(' ');

  if (!first)  return { name, error: 'الاسم الأول مفقود' };
  if (!father) return { name, error: 'اسم الأب مفقود' };
  if (!family) return { name, error: 'الكنية مفقودة' };

  const gender = IMP.normGender(r.gender);
  if (!gender) return { name, error: `الجنس غير مفهوم: «${String(r.gender ?? '').trim() || '—'}»` };

  const { value: birth, error: birthErr } = IMP.parseTolerantDate(r.birthDate);
  if (birthErr) return { name, error: birthErr };

  const { classId, error: clsErr } = impResolveClass(r.grade, r.section);
  if (clsErr) return { name, error: clsErr };

  return {
    name, classId,
    rawClass: `${String(r.grade ?? '').trim()} / ${String(r.section ?? '').trim()}`,
    row: {
      first_name:  first,
      father_name: father,
      family_name: family,
      gender,
      birth_date:  birth || '',
      national_id: IMP.normalizeArabicDigits(String(r.nationalId ?? '')).trim(),
    },
  };
}

function impBuildStaff(r) {
  const name = String(r.fullName ?? '').trim();
  if (!name) return { name: '', error: 'الاسم مفقود' };

  const typeRaw  = String(r.staffType ?? '').trim();
  const typeNorm = IMP.normalizeArabicText(typeRaw);
  const staffType = STAFF_TYPE_WORDS[typeNorm];
  if (!staffType) {
    return { name, error: `فئة الكادر غير مفهومة: «${typeRaw || '—'}» — المقبول: ${
      Object.values(STAFF_TYPE_LABELS).join('، ')}` };
  }

  const gender = IMP.normGender(r.gender);
  if (!gender) return { name, error: `الجنس غير مفهوم: «${String(r.gender ?? '').trim() || '—'}»` };

  const { value: birth, error: birthErr } = IMP.parseTolerantDate(r.birthDate);
  if (birthErr) return { name, error: birthErr };

  let seniority = '';
  const senRaw = IMP.normalizeArabicDigits(String(r.seniorityYear ?? '')).trim();
  if (senRaw) {
    const m = senRaw.match(/\d{4}/);
    if (!m) return { name, error: `سنة القدم غير مفهومة: «${senRaw}»` };
    seniority = m[0];
  }

  const rosterRaw = IMP.normalizeArabicText(String(r.rosterType ?? '').trim());
  const roster = rosterRaw ? ROSTER_TYPE_WORDS[rosterRaw] : 'inside';
  if (rosterRaw && !roster) {
    return { name, error: `نوع الملاك غير مفهوم: «${String(r.rosterType).trim()}» — المقبول: داخل، خارج، عقد` };
  }

  const txt = v => String(v ?? '').trim();
  return {
    name, classId: null,
    row: {
      full_name:        name,
      staff_type:       staffType,
      gender,
      national_id:      IMP.normalizeArabicDigits(txt(r.nationalId)),
      mother_name:      txt(r.motherName),
      birth_date:       birth || '',
      job_title:        txt(r.jobTitle),
      specialization:   txt(r.specialization),
      // المادة المُدرَّسة تخصّ التدريسيين فقط؛ الدالة في الخادم تُفرغها لغيرهم
      // أيضاً، والتفريغ هنا يجعل المعاينة صادقة لا مضلِّلة.
      subject_taught:   staffType === 'teaching' ? txt(r.subjectTaught) : '',
      certificate:      txt(r.certificate),
      higher_degree:    txt(r.higherDegree),
      seniority_year:   seniority,
      phone:            IMP.normalizeArabicDigits(txt(r.phone)),
      residential_zone: txt(r.residentialZone),
      educational_zone: txt(r.educationalZone),
      roster_type:      roster,
      notes:            txt(r.notes),
    },
  };
}

function impStat(num, label, tone) {
  return `<div class="imp-stat${tone ? ` imp-stat--${tone}` : ''}">
    <span class="imp-stat-num">${num}</span>
    <span class="imp-stat-lbl">${dirEsc(label)}</span>
  </div>`;
}

function renderImportPreview() {
  const { ok, issues } = _impPrepared;
  const schoolName = impEl('imp-school')?.selectedOptions?.[0]?.textContent || '';

  impEl('imp-stats').innerHTML = [
    impStat(ok.length + issues.length, 'أسطر في الملفّ'),
    impStat(ok.length, 'جاهزة للاستيراد', ok.length ? 'good' : 'bad'),
    impStat(issues.length, 'بها مشكلة', issues.length ? 'bad' : ''),
    // اسم المدرسة نصّ لا رقم: خطّ الأرقام أحادي العرض يُشوّه العربية.
    `<div class="imp-stat"><span class="imp-stat-lbl">الوجهة</span>
       <span class="imp-stat-dest">${dirEsc(schoolName)}</span></div>`,
  ].join('');

  // توزيع الصفوف — للطلاب فقط. الأسطر التي لم يُحسَم صفّها انتقلت إلى قائمة
  // المشاكل أصلاً، فكل مجموعة هنا صفّ موجود فعلاً في المدرسة المختارة.
  const clsWrap = impEl('imp-classes-wrap');
  if (_impKind === 'students' && ok.length) {
    const groups = new Map();
    ok.forEach(r => {
      const key = `${r.__rawClass}→${r.__classId}`;
      const g = groups.get(key) || { n: 0, raw: r.__rawClass, cid: r.__classId };
      g.n += 1;
      groups.set(key, g);
    });
    impEl('imp-classes-tbody').innerHTML = [...groups.values()].map(g => {
      const c = _impClasses.find(x => x.id === g.cid);
      const label = c ? (c.name || `الصف ${c.grade} / ${c.section}`) : '—';
      return `<tr><td>${dirEsc(g.raw)}</td><td>${g.n}</td>
              <td class="imp-match">${dirEsc(label)}</td></tr>`;
    }).join('');
    clsWrap.hidden = false;
  } else {
    clsWrap.hidden = true;
  }

  impRenderIssues(issues, 'imp-issues-wrap', 'imp-issues-tbody', 'imp-issues-count');

  const cols = IMP_SAMPLE_COLS[_impKind];
  impEl('imp-sample-thead').innerHTML =
    `<tr><th>#</th>${cols.map(c => `<th>${dirEsc(c.label)}</th>`).join('')}</tr>`;
  impEl('imp-sample-tbody').innerHTML = ok.slice(0, 10).map(r =>
    `<tr><td class="muted">${r.line}</td>${
      cols.map(c => `<td>${dirEsc(c.fmt ? c.fmtNum(r[c.key]) : (r[c.key] || '—'))}</td>`).join('')
    }</tr>`).join('') || `<tr><td colspan="${cols.length + 1}" class="empty-state">لا سطر جاهز.</td></tr>`;

  const runBtn = impEl('imp-run-btn');
  if (runBtn) runBtn.disabled = ok.length === 0;
  const msg = impEl('imp-preview-msg');
  if (ok.length === 0) {
    msg.textContent = 'لا يوجد سطر صالح — صحّح الملفّ أو المطابقة ثم أعِد المحاولة.';
    msg.hidden = false;
  } else {
    msg.hidden = true;
  }
}

function impRenderIssues(list, wrapId, tbodyId, countId) {
  const wrap = impEl(wrapId);
  if (!wrap) return;
  if (!list.length) { wrap.hidden = true; return; }
  impEl(countId).textContent = list.length;
  // بلا قصّ: الحاوية تُمرَّر بالـCSS. قصّ القائمة يُخفي أخطاءً على المستخدم
  // أن يُصلحها في ملفّه.
  impEl(tbodyId).innerHTML = list.map(f =>
    `<tr><td class="muted">${f.line ?? '—'}</td><td>${dirEsc(f.name || '—')}</td>
     <td>${dirEsc(f.error || '—')}</td></tr>`).join('');
  wrap.hidden = false;
}

// ── الخطوة ٣: التنفيذ ────────────────────────────────────────────────────
async function runImport() {
  if (_impBusy || !_impPrepared?.ok.length) return;
  const schoolId = impEl('imp-school')?.value;
  if (!schoolId) { impShowError('اختر المدرسة أوّلاً.'); return; }

  _impBusy = true;
  const btn = impEl('imp-run-btn');
  btn.disabled = true;
  impEl('imp-run-label').textContent = 'جارٍ الاستيراد…';
  impEl('imp-run-spinner').hidden = false;
  impShowError('');

  try {
    const total = { inserted: 0, duplicate: 0, failed: [] };

    if (_impKind === 'students') {
      // استدعاء لكل شعبة: p_class_id وسيط للدالة كلّها لا حقل في السطر، وسجلّ
      // التدقيق يصير صفّاً لكل شعبة وهي الدقّة المطلوبة.
      const byClass = new Map();
      _impPrepared.ok.forEach(r => {
        const { line, __classId, __rawClass, ...row } = r;
        if (!byClass.has(__classId)) byClass.set(__classId, { lines: [], rows: [] });
        const b = byClass.get(__classId);
        b.lines.push(line);
        b.rows.push(row);
      });
      for (const [classId, b] of byClass) {
        const res = await directorateBulkImportStudents({ schoolId, classId, rows: b.rows });
        impMergeSummary(total, res, b.lines);
      }
    } else {
      const lines = _impPrepared.ok.map(r => r.line);
      const rows  = _impPrepared.ok.map(({ line, __classId, __rawClass, ...row }) => row);
      const res   = await directorateBulkImportStaff({ schoolId, rows });
      impMergeSummary(total, res, lines);
    }

    renderImportDone(total);
    impEl('imp-step-preview').hidden = true;
    impEl('imp-step-done').hidden = false;
    impEl('imp-step-done').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    loadDirSchools().catch(() => {});   // أعداد الطلاب/المعلمين في جدول المدارس
  } catch (e) {
    impShowError(errMessage(e, 'فشل الاستيراد.'));
  } finally {
    _impBusy = false;
    btn.disabled = false;
    impEl('imp-run-label').textContent = 'تنفيذ الاستيراد';
    impEl('imp-run-spinner').hidden = true;
  }
}

// الخادم يُرقّم الأسطر داخل دفعته هو (١، ٢، …) — تُترجَم إلى رقم السطر في
// الملفّ كي يجد المستخدم السطر الذي عليه إصلاحه.
function impMergeSummary(total, res, lines) {
  total.inserted  += res?.inserted  ?? 0;
  total.duplicate += res?.duplicate ?? 0;
  (res?.failed ?? []).forEach(f => {
    total.failed.push({ ...f, line: lines[(f.line ?? 0) - 1] ?? f.line });
  });
}

function renderImportDone(sum) {
  impEl('imp-done-stats').innerHTML = [
    impStat(sum.inserted, 'سجلّ أُضيف', sum.inserted ? 'good' : ''),
    impStat(sum.duplicate, 'مكرّر تُخطّي', sum.duplicate ? 'warn' : ''),
    impStat(sum.failed.length, 'فشل', sum.failed.length ? 'bad' : ''),
  ].join('');
  impRenderIssues(sum.failed, 'imp-done-issues-wrap', 'imp-done-issues-tbody', 'imp-done-issues-count');
}

// ── قالب فارغ ────────────────────────────────────────────────────────────
// CSV لا XLSX: يُفتَح في Excel كما في أي محرّر، ولا يحتاج تحميل مكتبة.
// BOM في المقدّمة كي لا يعرض Excel العربية محارف مشوّهة.
function downloadImportTemplate() {
  const header = impSchema().map(f => f.label).join(',');
  const sample = _impKind === 'students'
    ? 'محمد,أحمد,العلي,ذكر,7,أ,2011-03-14,01010101010'
    : `ليلى الحسن,${STAFF_TYPE_LABELS.teaching},أنثى,02020202020,سميرة,1985-06-01,مدرّسة,رياضيات,الرياضيات,إجازة,,2010,0999000000,,,داخل,`;
  const blob = new Blob(['﻿' + header + '\n' + sample + '\n'],
                        { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = _impKind === 'students' ? 'قالب-الطلاب.csv' : 'قالب-الكادر.csv';
  a.click();
  URL.revokeObjectURL(url);
}
