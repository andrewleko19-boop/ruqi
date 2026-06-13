// directorate/script.js
// ── DB من window.NSAMS_DB (يُحمَّل عبر shared/db.js قبل هذا الملف) ──────────
import { CustomSelect } from '../shared/csel.js';
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
let allReports        = [];
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
  document.getElementById('nav-user').textContent =
    session.user?.fullName || session.user?.email || '';

  initMap();
  setupLogout();
  setupFilters();
  setupManualRefresh();
  setupReportActionDelegation();
  setupComplianceActions();
  setupCSVExports();
  setupLightbox();
  setupTrendPeriod();
}

// ══════════════════════════════════════════════
//  Logout
// ══════════════════════════════════════════════
function setupLogout() {
  document.getElementById('logout-btn').addEventListener('click', async () => {
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
  const palette = { green: '#22c55e', amber: '#f59e0b', red: '#7f1d1d', no_data: '#fca5a5', gray: '#4f5f80' };
  const fill = palette[color] || palette.gray;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.917 14 22 14 22S28 23.917 28 14C28 6.268 21.732 0 14 0z"
        fill="${fill}" stroke="#0b0f1a" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="6" fill="#0b0f1a" fill-opacity="0.45"/>
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
  }
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
    if (subEl) subEl.textContent = 'التقارير النشطة';
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
    const iso = d.toISOString().slice(0, 10);
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

  return allReports.filter(r => {
    if (statusFilter   && r.status          !== statusFilter)       return false;
    if (typeFilter     && r.type            !== typeFilter)         return false;
    if (severityFilter && String(r.severity ?? '') !== severityFilter) return false;
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

function renderPendingList() {
  const pending = allReports
    .filter(r => r.status === 'open' || r.status === 'acknowledged')
    .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0) || new Date(a.created_at) - new Date(b.created_at));

  const countEl = document.getElementById('pending-count');
  countEl.textContent = pending.length;
  countEl.className   = `badge ${pending.length > 0 ? 'badge--amber' : 'badge--green'}`;

  const container = document.getElementById('pending-list');
  if (pending.length === 0) {
    container.innerHTML = '<p class="empty-state">لا توجد تقارير معلقة.</p>';
    return;
  }

  container.innerHTML = pending.map(r => {
    const overdue   = isOverdue(r);
    const isNew     = flashIds.has(r.id);
    const cardClass = ['pending-card', overdue ? 'row-overdue' : '', isNew ? 'row-flash' : ''].filter(Boolean).join(' ');
    const overdueTag = overdue ? '<span class="overdue-tag">متأخر</span>' : '';

    return `
    <div class="${cardClass}" data-id="${esc(r.id)}">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="pending-school">${esc(r.schoolName ?? '—')}</span>
        ${sevBadge(r.severity)}
        ${overdueTag}
      </div>
      <span class="type-badge type-${esc(r.type)}">${esc(formatType(r.type))}</span>
      <div class="pending-desc">${esc(r.description ?? '—')}</div>
      <div class="pending-time">${esc(formatDate(r.created_at))}</div>
      <div class="pending-actions">
        ${photoBtn(r)}
        ${r.status === 'open'
          ? `<button class="btn btn-warning btn-sm" data-action="acknowledged" data-id="${esc(r.id)}">تمت المراجعة</button>`
          : ''}
        <button class="btn btn-success btn-sm" data-action="resolved" data-id="${esc(r.id)}">حل</button>
      </div>
    </div>`;
  }).join('');
}

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
      if (r?.media_urls?.length) openLightbox(r.media_urls, 0);
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
  document.getElementById('filter-status')?.addEventListener('change', renderReportsTable);
  document.getElementById('filter-type')?.addEventListener('change', renderReportsTable);
  document.getElementById('filter-severity')?.addEventListener('change', renderReportsTable);
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
//  Trend charts (Chart.js — dark/RTL)
// ══════════════════════════════════════════════
const CHART_FONT = "'Segoe UI', system-ui, sans-serif";
const CH = {
  grid:      'rgba(38, 48, 72, 0.55)',
  tick:      '#8a9bbf',
  tooltipBg: '#131929',
  green: '#22c55e', blue: '#4f8cff', amber: '#f59e0b', red: '#ef4444', purple: '#a855f7',
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
        titleColor: '#e8edf7', bodyColor: '#8a9bbf', padding: 10,
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
        backgroundColor: 'rgba(79,140,255,0.12)',
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
        <td style="color:${(r.at_risk_count || 0) > 0 ? 'var(--clr-danger,#EF4444)' : 'inherit'};font-weight:600">
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
  await Promise.allSettled([loadStats(), loadMapAndCompliance(), loadReports(), loadTrend(), loadRequests(), loadStatements(), loadDropoutSummary(), loadPeriodicReports()]);
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
      list.innerHTML = '<li style="padding:32px 16px;text-align:center;color:#94A3B8;font-size:.9rem">لا توجد إشعارات</li>';
      return;
    }
    list.innerHTML = items.map(n => {
      const diff = Date.now() - new Date(n.created_at).getTime();
      const m    = Math.floor(diff / 60000);
      const ago  = m < 1 ? 'الآن' : m < 60 ? `منذ ${m} دقيقة` : m < 1440 ? `منذ ${Math.floor(m/60)} ساعة` : `منذ ${Math.floor(m/1440)} يوم`;
      const bg   = !n.read_at ? 'background:rgba(11,43,94,.06);' : '';
      return `<li style="${bg}padding:12px 16px;border-bottom:1px solid #E2E8F0;direction:rtl">
        <div style="font-weight:600;font-size:.9rem">${n.title}</div>
        ${n.body ? `<div style="font-size:.82rem;color:#64748B;margin-top:2px">${n.body}</div>` : ''}
        <div style="font-size:.75rem;color:#94A3B8;margin-top:4px">${ago}</div>
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
    if (Notification.permission === 'granted') {
      new Notification(notif.title, { body: notif.body ?? '', dir: 'rtl', lang: 'ar' });
    }
    if (notif.type === 'report_new') loadReports().catch(() => {});
    if (notif.type === 'statement_submitted') loadStatements().catch(() => {});
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
