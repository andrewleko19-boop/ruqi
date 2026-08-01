// school/script.js
// Loaded as <script type="module"> after Supabase CDN and shared/db.js

// ── Guard ─────────────────────────────────────────────────────────────────────
if (!window.NSAMS_DB) {
  document.body.innerHTML =
    '<p style="padding:24px;color:#EF4444;font-family:sans-serif;direction:rtl">' +
    'خطأ: تعذّر تحميل طبقة البيانات. تأكد من تضمين shared/db.js.</p>';
  throw new Error('window.NSAMS_DB is not defined');
}

const {
  login,
  logout,
  getCurrentUser,
  getSchoolById,
  getDailyAttendance,
  saveAttendance,
  submitReport,
  syncPending,
  getPendingAttendance,
  getPendingReports,
  localDateISO,
  changePassword,
} = window.NSAMS_DB;

// ── App state ─────────────────────────────────────────────────────────────────
const S = {
  user:           null,   // { user, role, schoolId, directorateId }
  school:         null,   // populated by loadSchoolData() after login
  absentTeachers: [],     // string[]
  attSubmitted:   false,
  severity:       1,
  photoB64:       null,
  photoMime:      null,
};

// ── Role vocabulary (معلم ابتدائي ↔ موجه إعدادي/ثانوي) ─────────────────────────
// Switched automatically by school type. UI text only — DB role stays 'teacher'.
// Initialised to the primary-school variant; applyRoleLabels() swaps it after the
// school row loads. All dynamic strings (toasts, dropdowns) read from RW.
let RW = roleWords(false);

// ── School data cache helpers ─────────────────────────────────────────────────
// v2 بعد §25: النسخ المخبّأة قبلها تحمل type='middle_high' وهي قيمة لم تعد
// موجودة، فتُخدَم على المسار دون اتصال وتُظهر تسميات خاطئة. رفع البادئة يُهمل
// النسخ القديمة بلا حاجة إلى شيفرة ترحيل.
const SCHOOL_CACHE_PREFIX = 'nsams_school2_';

function cacheSchool(schoolId, data) {
  try {
    localStorage.setItem(SCHOOL_CACHE_PREFIX + schoolId, JSON.stringify(data));
  } catch { /* storage quota exceeded — non-fatal */ }
}

function getCachedSchool(schoolId) {
  try {
    const raw = localStorage.getItem(SCHOOL_CACHE_PREFIX + schoolId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Normalise a raw DB row into the shape the rest of the app uses:
 *   { id, name, totalTeachers, totalStudents }
 */
/**
 * Normalise a raw DB row into the shape the rest of the app uses:
 *   { id, name, totalTeachers, totalStudents, type }
 */
function normaliseSchool(row) {
  return {
    id:             row.id,
    name:           row.name,
    directorate_id: row.directorate_id ?? null,
    totalTeachers:  row.total_teachers ?? null,
    totalStudents:  row.total_students ?? null,
    // 'primary' (ابتدائي) | 'preparatory' (إعدادي) | 'secondary' (ثانوي) — §25.
    // الإعدادي والثانوي كلاهما موجّه؛ الفصل للتسمية والتقارير فقط.
    // Falls back to 'primary' if the column is missing (e.g. migration not run yet).
    type:          row.school_type ?? 'primary',
    // Minimum yearly attendance % required to pass (grades 5+). Editable.
    minAttendancePct: row.min_attendance_pct ?? 75,
    // Raw passthroughs needed by staff/identity settings (kept on S.school so
    // they survive caching). Safe when the columns are missing (⇒ undefined).
    work_start_time:    row.work_start_time    ?? null,
    complex_name:       row.complex_name       ?? null,
    classification:     row.classification     ?? null,
    education_type:     row.education_type     ?? null,
    shift:              row.shift              ?? null,
    student_type:       row.student_type       ?? null,
    statistical_number: row.statistical_number ?? null,
    cycle:              row.cycle              ?? null,
    rural_curriculum:   row.rural_curriculum   ?? false,
    lat:                row.lat ?? null,
    lng:                row.lng ?? null,
  };
}

/**
 * Role label dictionary. secondary=true → موجه (إعدادي/ثانوي), else معلم (ابتدائي).
 * Full inflected phrases (not composed) so each is unambiguously correct in Arabic.
 */
function roleWords(secondary) {
  return secondary ? {
    subsTitle:       'كشوف الحضور من الموجهين',
    autoNote:        'تُحتسب أعداد الطلاب تلقائياً من كشوف الموجهين المؤكدة.',
    manageTitle:     'إدارة الصفوف والموجهين',
    manageHint:      'اختر صفاً لعرض موجّهه وأساتذته وإدارة الإسناد. يمكن للموجّه متابعة أكثر من صف.',
    assignedLabel:   'المرتبطون بالصف',
    assignedEmpty:   'لا أحد مرتبط بهذا الصف بعد.',
    assignNew:       'إسناد موجه جديد',
    pickLabel:       'الموجه',
    pickPlaceholder: '— اختر موجهاً —',
    assignBtn:       'تعيين موجه للصف',
    rejectTitle:     'إعادة الكشف للموجه',
    noneAvailable:   'لا يوجد موجهون متاحون للإسناد',
    pickToAssign:    'اختر موجهاً للإسناد.',
    assignedToast:   'تم تعيين الموجه للصف',
    alreadyOnClass:  'هذا الموجه مرتبط بالفعل بهذا الصف.',
    assignFail:      'تعذّر تعيين الموجه.',
    cannotRemove:    'لا يمكن حذف موجه من صف له حضور مسجل اليوم.',
    removeConfirm:   (n) => `إزالة الموجه "${n}" من هذا الصف؟`,
    removedToast:    'تمت إزالة الموجه من الصف',
    removeFail:      'تعذّر إزالة الموجه.',
    noPermission:    'تعذّرت العملية: لا تملك صلاحية لتعديل إسناد الموجهين على قاعدة البيانات. راجع مسؤول النظام.',
    loadSubsErr:     'تعذّر تحميل كشوف الموجهين',
    loadAssignedErr: 'تعذّر تحميل موجهي الصف',
    loadListErr:     'تعذّر تحميل قائمة الموجهين',
    rejectedToast:   (c) => `تم إعادة كشف ${c} للموجه`,
  } : {
    subsTitle:       'كشوف الحضور من المعلمين',
    autoNote:        'تُحتسب أعداد الطلاب تلقائياً من كشوف المعلمين المؤكدة.',
    manageTitle:     'إدارة الصفوف والمعلمين',
    manageHint:      'اختر صفاً لعرض معلميه وإدارة الإسناد. يمكن لعدة معلمين تدريس صف واحد.',
    assignedLabel:   'المعلمون المرتبطون بالصف',
    assignedEmpty:   'لا يوجد معلمون مرتبطون بهذا الصف بعد.',
    assignNew:       'إسناد معلم جديد',
    pickLabel:       'المعلم',
    pickPlaceholder: '— اختر معلماً —',
    assignBtn:       'تعيين معلم للصف',
    rejectTitle:     'إعادة الكشف للمعلم',
    noneAvailable:   'لا يوجد معلمون متاحون للإسناد',
    pickToAssign:    'اختر معلماً للإسناد.',
    assignedToast:   'تم تعيين المعلم للصف',
    alreadyOnClass:  'هذا المعلم مرتبط بالفعل بهذا الصف.',
    assignFail:      'تعذّر تعيين المعلم.',
    cannotRemove:    'لا يمكن حذف معلم من صف له حضور مسجل اليوم.',
    removeConfirm:   (n) => `إزالة المعلم "${n}" من هذا الصف؟`,
    removedToast:    'تمت إزالة المعلم من الصف',
    removeFail:      'تعذّر إزالة المعلم.',
    noPermission:    'تعذّرت العملية: لا تملك صلاحية لتعديل إسناد المعلمين على قاعدة البيانات. راجع مسؤول النظام.',
    loadSubsErr:     'تعذّر تحميل كشوف المعلمين',
    loadAssignedErr: 'تعذّر تحميل معلمي الصف',
    loadListErr:     'تعذّر تحميل قائمة المعلمين',
    rejectedToast:   (c) => `تم إعادة كشف ${c} للمعلم`,
  };
}

/**
 * Apply role vocabulary to the static DOM + reset RW for dynamic strings.
 * Called once per app entry, right after the school row is loaded.
 */
function applyRoleLabels() {
  RW = roleWords(usesSupervisors());
  const set = (id, txt) => { const n = el(id); if (n) n.textContent = txt; };
  set('subs-card-title',   RW.subsTitle);
  set('auto-count-note',   RW.autoNote);
  set('manage-card-title', RW.manageTitle);
  set('manage-hint',       RW.manageHint);
  set('assigned-label',    RW.assignedLabel);
  set('mng-assigned-empty',RW.assignedEmpty);
  set('reject-title',      RW.rejectTitle);
  // The teacher-assignment section always uses معلم vocabulary (HTML defaults);
  // the موجه section is separate and only shown for إعدادي/ثانوي schools.
  const supSection = el('mng-sup-section');
  if (supSection) supSection.hidden = !usesSupervisors();
  // Role choices depend on the school type, not the grade number: إعدادي/ثانوي
  // classes are numbered ١/٢/٣ locally, which stageForGrade (db.js) reads as
  // 'primary'. Same three words, different meaning — never swap one for the other.
  populateRoleOptions();
}

/**
 * Fetch school from Supabase, fall back to localStorage cache when offline.
 * Sets S.school and updates the cache on success.
 * Throws only if both the network AND the cache fail.
 */
async function loadSchoolData() {
  const schoolId = S.user?.schoolId;
  if (!schoolId) throw new Error('No schoolId in session');

  // 1. Try live fetch first (works online and when Supabase is reachable)
  if (navigator.onLine) {
    try {
      const row    = await getSchoolById(schoolId);
      const school = normaliseSchool(row);
      S.school     = school;
      cacheSchool(schoolId, school);   // keep cache fresh
      return;
    } catch (err) {
      console.warn('[NSAMS] live school fetch failed, falling back to cache', err);
      // fall through to cache
    }
  }

  // 2. Offline (or live fetch failed) — use cached data
  const cached = getCachedSchool(schoolId);
  if (cached) {
    S.school = cached;
    toast('يعمل التطبيق بدون اتصال — يتم عرض البيانات المحفوظة', 'warning', 4000);
    return;
  }

  // 3. No cache at all — we genuinely can't show real data
  // Use a skeletal object so the UI doesn't crash, but make the name obvious
  S.school = { id: schoolId, name: 'لم يتم تحميل بيانات المدرسة', totalTeachers: 0, totalStudents: 0 };
  toast('تعذّر تحميل بيانات المدرسة. تحقق من الاتصال وأعد تسجيل الدخول.', 'error', 6000);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
const el   = (id) => document.getElementById(id);
const show = (elem) => { elem.hidden = false; };
const hide = (elem) => { elem.hidden = true;  };

// Elements – login
const screenLogin   = el('screen-login');
const screenApp     = el('screen-app');
const formLogin     = el('form-login');
const inEmail       = el('in-email');
const inPw          = el('in-password');
const btnTogglePw   = el('btn-toggle-pw');
const pwEyeUse      = el('pw-eye-use');
const loginError    = el('login-error');
const btnLogin      = el('btn-login');
const btnLoginLabel = el('btn-login-label');
const loginSpinner  = el('login-spinner');

// Elements – app header
const hdrSchool   = el('hdr-school');
const hdrDate     = el('hdr-date');
const connPill    = el('conn-pill');
const connIcon    = el('conn-icon');
const connLabel   = el('conn-label');
const pendingBar  = el('pending-bar');
const pendingText = el('pending-text');
const btnSync     = el('btn-sync');
const syncIcon    = el('sync-icon');
const btnLogout   = el('btn-logout');

// Elements – status
const statusCard  = el('status-card');
const statusIcon  = el('status-icon');
const statusTitle = el('status-title');
const statusSub   = el('status-sub');

// Elements – attendance
const tPresent      = el('t-present');
const tAbsent       = el('t-absent');
const tTotal        = el('t-total');
const absentList    = el('absent-list');
const inAbsent      = el('in-absent');
const btnAddAbsent  = el('btn-add-absent');
const inStuPresent  = el('in-stu-present');
const inStuAbsent   = el('in-stu-absent');
const inAdminPresent  = el('in-admin-present');
const inAdminAbsent   = el('in-admin-absent');
const inWorkerPresent = el('in-worker-present');
const inWorkerAbsent  = el('in-worker-absent');
const inNotes       = el('in-notes');
const btnSubmitAtt  = el('btn-submit-att');
const attCard       = el('att-card');
const attDone       = el('att-done');
const attDoneSub    = el('att-done-sub');
const attDoneDetails = el('att-done-details');

// Elements – report modal
const modalReport    = el('modal-report');
const btnOpenReport  = el('btn-open-report');
const btnCloseReport = el('btn-close-report');
const rType          = el('r-type');
const rDesc          = el('r-desc');
const rDescCount     = el('r-desc-count');
const sevBtns        = el('sev-btns');
const rPhoto         = el('r-photo');
const photoLabel     = el('photo-label');
const photoText      = el('photo-text');
const rError         = el('r-error');
const btnSubmitRep   = el('btn-submit-report');
const rSubmitLabel   = el('r-submit-label');
const rSpinner       = el('r-spinner');

// Elements – receipt modal
const modalReceipt    = el('modal-receipt');
const recNumber       = el('rec-number');
const recTime         = el('rec-time');
const recStatus       = el('rec-status');
const btnCloseReceipt = el('btn-close-receipt');

// Toast zone
const toastZone = el('toasts');

// ── Utilities ─────────────────────────────────────────────────────────────────
function todayISO() {
  if (typeof localDateISO === 'function') return localDateISO();
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateAr(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('ar-SY', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatDateTimeAr(iso) {
  return new Date(iso).toLocaleString('ar-SY', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function svgHref(useEl, href) {
  useEl.setAttribute('href', href);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
const TOAST_ICONS = {
  success: '#ic-check-circle',
  warning: '#ic-alert',
  error:   '#ic-x-circle',
  info:    '#ic-alert-circle',
};

function toast(msg, type = 'info', ms = 3800) {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML =
    `<svg class="icon icon-sm" style="flex-shrink:0"><use href="${TOAST_ICONS[type]}"/></svg>`;
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  toastZone.prepend(t);
  setTimeout(() => {
    t.classList.add('removing');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  }, ms);
}

// ── Screen switch ─────────────────────────────────────────────────────────────
function showScreen(name) {
  screenLogin.hidden = (name !== 'login');
  screenApp.hidden   = (name !== 'app');
}

// ── Online / Offline ──────────────────────────────────────────────────────────
function updateConnUI() {
  const online = navigator.onLine;
  connPill.classList.toggle('offline', !online);
  connLabel.textContent = online ? 'متصل' : 'غير متصل';
  svgHref(connIcon, online ? '#ic-wifi' : '#ic-wifi-off');
  refreshPendingBar();
}

function refreshPendingBar() {
  const n = getPendingAttendance().length + getPendingReports().length;
  if (n > 0) {
    pendingText.textContent = `${n} سجل في انتظار المزامنة`;
    show(pendingBar);
  } else {
    hide(pendingBar);
  }
}

window.addEventListener('online',  () => { updateConnUI(); doSync(); });
window.addEventListener('offline', updateConnUI);

// ── Sync ──────────────────────────────────────────────────────────────────────
let syncing = false;

async function doSync() {
  if (syncing) return;
  syncing = true;
  syncIcon.classList.add('syncing');
  toast('جاري المزامنة…', 'info', 1500);
  try {
    const { attendance, reports } = await syncPending();
    const total = attendance.synced + reports.synced;
    if (total > 0) {
      toast(`تمت مزامنة ${total} سجل بنجاح`, 'success');
    } else {
      toast('لا يوجد سجلات معلقة', 'info', 2000);
    }
    refreshPendingBar();
  } catch (err) {
    console.warn('[NSAMS] sync error', err);
    toast('تعذّرت المزامنة', 'error');
  } finally {
    syncIcon.classList.remove('syncing');
    syncing = false;
  }
}

btnSync.addEventListener('click', doSync);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'BG_SYNC') doSync();
  });
}

// ── Status Card ───────────────────────────────────────────────────────────────
function setStatusDone(synced) {
  statusCard.className = 'status-card status-done';
  svgHref(statusIcon, '#ic-check-circle');
  statusTitle.textContent = synced
    ? 'تم إرسال سجل الحضور بنجاح'
    : 'تم حفظ سجل الحضور (في انتظار المزامنة)';
  statusSub.textContent = formatDateAr(todayISO());
}

function setStatusPending() {
  statusCard.className = 'status-card status-pending';
  svgHref(statusIcon, '#ic-clock');
  statusTitle.textContent = 'لم يُرسل سجل الحضور بعد';
  statusSub.textContent   = 'يرجى تعبئة النموذج وإرساله قبل نهاية الدوام';
}

// Render a compact, read-only audit summary of the submitted record.
function renderAttDetails(rec) {
  const rows = [
    ['المعلمون',  `حاضرون ${rec.teachers_present ?? 0} · غائبون ${rec.teachers_absent ?? 0}`],
    ['الإداريون', `حاضرون ${rec.admins_present ?? 0} · غائبون ${rec.admins_absent ?? 0}`],
    ['المستخدمون', `حاضرون ${rec.workers_present ?? 0} · غائبون ${rec.workers_absent ?? 0}`],
    ['الطلاب الحاضرون', String(rec.students_present ?? 0)],
  ];
  if (rec.notes) rows.push(['ملاحظات', escapeHtml(rec.notes)]);
  if (rec.submitted_at) {
    const d = new Date(rec.submitted_at);
    const time = d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
    rows.push(['وقت الإرسال', `${formatDateAr(localDateISO(d))} — ${time}`]);
  }
  return rows
    .map(([k, v]) => `<div class="done-row"><span class="done-k">${k}</span><span class="done-v">${v}</span></div>`)
    .join('');
}

// Switch the attendance tab into its submitted (read-only) confirmation state.
// Reused by the submit handler and by initApp (restore on reload). DRY.
function markAttendanceSubmitted(synced, rec) {
  S.attSubmitted = true;
  hide(attCard);
  show(attDone);
  attDoneSub.textContent = `${formatDateAr(todayISO())} — ${synced ? 'تم الإرسال' : 'محفوظ محلياً'}`;
  attDoneDetails.innerHTML = rec ? renderAttDetails(rec) : '';
  setStatusDone(synced);
}

// ── Teacher counter ───────────────────────────────────────────────────────────
function animateBump(numEl) {
  numEl.classList.remove('bump');
  void numEl.offsetWidth;
  numEl.classList.add('bump');
  numEl.addEventListener('animationend', () => numEl.classList.remove('bump'), { once: true });
}

function refreshTeacherUI() {
  const total   = S.school?.totalTeachers;
  const absent  = S.absentTeachers.length;
  const present = total != null ? Math.max(0, total - absent) : null;

  const prevAbsent  = tAbsent.textContent;
  const prevPresent = tPresent.textContent;

  tTotal.textContent   = total   != null ? total   : '—';
  tAbsent.textContent  = absent;
  tPresent.textContent = present != null ? present : '—';

  if (String(absent)  !== prevAbsent)  animateBump(tAbsent);
  if (present != null && String(present) !== prevPresent) animateBump(tPresent);
}

// ── Absent teachers list ──────────────────────────────────────────────────────
function renderAbsentList() {
  absentList.innerHTML = '';
  S.absentTeachers.forEach((name, idx) => {
    const li = document.createElement('li');
    li.className = 'absent-item';
    li.innerHTML =
      `<span class="absent-name">${escapeHtml(name)}</span>` +
      `<button class="absent-del" data-i="${idx}" aria-label="حذف ${escapeHtml(name)}">` +
      `<svg class="icon icon-sm"><use href="#ic-x"/></svg></button>`;
    absentList.appendChild(li);
  });
  refreshTeacherUI();
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function addAbsentTeacher() {
  const name = inAbsent.value.trim();
  if (!name) return;
  if (S.absentTeachers.some((n) => n === name)) {
    toast('هذا المعلم مضاف بالفعل', 'warning', 2500);
    return;
  }
  S.absentTeachers.push(name);
  inAbsent.value = '';
  renderAbsentList();
}

btnAddAbsent.addEventListener('click', addAbsentTeacher);
inAbsent.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addAbsentTeacher(); }
});
absentList.addEventListener('click', (e) => {
  const btn = e.target.closest('.absent-del');
  if (!btn) return;
  S.absentTeachers.splice(Number(btn.dataset.i), 1);
  renderAbsentList();
});

// ── Submit Attendance ─────────────────────────────────────────────────────────
btnSubmitAtt.addEventListener('click', async () => {
  const studPresent = parseInt(inStuPresent.value, 10) || 0;
  const studAbsent  = parseInt(inStuAbsent.value,  10) || 0;
  const absentCount = S.absentTeachers.length;
  const total       = S.school?.totalTeachers ?? 0;

  const record = {
    school_id:        S.school.id,
    date:             todayISO(),
    teachers_present: Math.max(0, total - absentCount),
    teachers_absent:  absentCount,
    admins_present:   parseInt(inAdminPresent.value,  10) || 0,
    admins_absent:    parseInt(inAdminAbsent.value,   10) || 0,
    workers_present:  parseInt(inWorkerPresent.value, 10) || 0,
    workers_absent:   parseInt(inWorkerAbsent.value,  10) || 0,
    students_present: studPresent,
    // NOTE: daily_attendance has no students_absent column — do not send it,
    // or the upsert fails and silently falls back to the offline queue forever.
    // studAbsent stays UI-only (derived from teacher data).
    notes:            inNotes.value.trim() || null,
    submitted_by:     S.user?.user?.id ?? null,
    submitted_at:     new Date().toISOString(),
  };

  btnSubmitAtt.disabled = true;

  try {
    const result = await saveAttendance(record);

    markAttendanceSubmitted(result.synced, record);

    if (result.synced) {
      toast('تم إرسال سجل الحضور بنجاح', 'success', 4000);
    } else {
      toast('حُفظ السجل محلياً وسيُرسل عند توفر الاتصال', 'warning');
      refreshPendingBar();
    }
  } catch (err) {
    console.error('[NSAMS] saveAttendance error', err);
    toast('حدث خطأ أثناء الإرسال، يرجى المحاولة مجدداً', 'error');
    btnSubmitAtt.disabled = false;
  }
});

// ── Emergency Report Modal ────────────────────────────────────────────────────
function openReportModal() {
  show(modalReport);
  document.body.style.overflow = 'hidden';
  rType.focus();
}

function closeReportModal() {
  hide(modalReport);
  document.body.style.overflow = '';
}

btnOpenReport.addEventListener('click', openReportModal);
btnCloseReport.addEventListener('click', closeReportModal);
modalReport.addEventListener('click', (e) => {
  if (e.target === modalReport) closeReportModal();
});

// Character count
rDesc.addEventListener('input', () => {
  rDescCount.textContent = `${rDesc.value.length} / 1000`;
});

// Severity buttons
sevBtns.addEventListener('click', (e) => {
  const btn = e.target.closest('.sev-btn');
  if (!btn) return;
  S.severity = Number(btn.dataset.v);
  sevBtns.querySelectorAll('.sev-btn').forEach((b) => {
    b.classList.toggle('active', b === btn);
  });
});

// Photo attachment
rPhoto.addEventListener('change', async () => {
  const file = rPhoto.files[0];
  if (!file) return;
  const MAX_MB = 3;
  if (file.size > MAX_MB * 1024 * 1024) {
    toast(`الصورة أكبر من ${MAX_MB} MB`, 'error');
    rPhoto.value = '';
    return;
  }
  try {
    S.photoB64  = await fileToBase64(file);
    S.photoMime = file.type;
    photoLabel.classList.add('has-photo');
    photoText.textContent = `✓ ${file.name.length > 24 ? file.name.slice(0, 22) + '…' : file.name}`;
  } catch {
    toast('تعذّر قراءة الصورة', 'error');
    rPhoto.value = '';
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Submit report
btnSubmitRep.addEventListener('click', async () => {
  hide(rError);

  const type = rType.value;
  const desc = rDesc.value.trim();

  if (!type) { showReportError('يرجى اختيار نوع الحالة');   return; }
  if (!desc)  { showReportError('يرجى كتابة وصف للحالة');   return; }
  if (desc.length < 10) { showReportError('الوصف قصير جداً، يرجى الإسهاب أكثر'); return; }

  const report = {
    school_id:    S.school.id,
    submitted_by: S.user?.user?.id ?? null,
    type,
    description:  desc,
    severity:     S.severity,
    // NOTE: In production, upload to Supabase Storage and store the public URL.
    // For MVP, we store the data URI. Switch to storage.upload() + getPublicUrl()
    // before going live to avoid exceeding row size limits.
    media_urls: S.photoB64
      ? [`data:${S.photoMime};base64,${S.photoB64}`]
      : [],
  };

  setReportBusy(true);
  try {
    const result = await submitReport(report);
    closeReportModal();
    resetReportForm();
    showReceipt(result);
    if (!navigator.onLine) refreshPendingBar();
  } catch (err) {
    console.error('[NSAMS] submitReport error', err);
    showReportError('حدث خطأ أثناء الإرسال. تحقق من الاتصال وأعد المحاولة.');
  } finally {
    setReportBusy(false);
  }
});

function setReportBusy(busy) {
  btnSubmitRep.disabled      = busy;
  rSubmitLabel.hidden        = busy;
  rSpinner.hidden            = !busy;
}

function showReportError(msg) {
  rError.textContent = msg;
  show(rError);
  rError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function resetReportForm() {
  rType.value = '';
  CustomSelect.refresh(rType);
  rDesc.value = '';
  rDescCount.textContent = '0 / 1000';
  hide(rError);
  S.severity  = 1;
  S.photoB64  = null;
  S.photoMime = null;
  rPhoto.value = '';
  photoLabel.classList.remove('has-photo');
  photoText.textContent = 'إرفاق صورة';
  sevBtns.querySelectorAll('.sev-btn').forEach((b, i) => {
    b.classList.toggle('active', i === 0);
  });
}

// ── Receipt Modal ─────────────────────────────────────────────────────────────
function showReceipt({ id, receiptNumber: rn, createdAt, status }) {
  recNumber.textContent = rn ?? id;
  recTime.textContent   = formatDateTimeAr(createdAt);
  recStatus.textContent = status === 'open' ? '🔴 مفتوح' : status;
  show(modalReceipt);
  document.body.style.overflow = 'hidden';
}

btnCloseReceipt.addEventListener('click', () => {
  hide(modalReceipt);
  document.body.style.overflow = '';
  toast('تم تسجيل البلاغ وسيتابعه المختص', 'success');
});

// ── Login ─────────────────────────────────────────────────────────────────────
btnTogglePw.addEventListener('click', () => {
  const isPw = inPw.type === 'password';
  inPw.type  = isPw ? 'text' : 'password';
  svgHref(pwEyeUse, isPw ? '#ic-eye-off' : '#ic-eye');
  btnTogglePw.setAttribute('aria-label', isPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
});

formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  hide(loginError);

  const email    = inEmail.value.trim();
  const password = inPw.value;

  if (!email || !password) {
    loginError.textContent = 'يرجى إدخال البريد الإلكتروني وكلمة المرور';
    show(loginError);
    return;
  }

  setLoginBusy(true);
  try {
    const session = await login(email, password);

    if (session.role !== 'school_admin') {
      await logout().catch(() => {});
      loginError.textContent = 'هذا التطبيق مخصص لمديري المدارس فقط';
      show(loginError);
      return;
    }

    S.user = session;
    await initApp();
  } catch (err) {
    console.error('[NSAMS] login error', err);
    loginError.textContent =
      err?.message?.includes('Invalid login')
        ? 'بيانات الدخول غير صحيحة'
        : (err?.message ?? 'فشل تسجيل الدخول، يرجى المحاولة مجدداً');
    show(loginError);
  } finally {
    setLoginBusy(false);
  }
});

function setLoginBusy(busy) {
  btnLogin.disabled      = busy;
  btnLoginLabel.hidden   = busy;
  loginSpinner.hidden    = !busy;
}

// ── Logout ────────────────────────────────────────────────────────────────────
const modalConfirmLogout = el('modal-confirm-logout');
const btnLogoutCancel    = el('btn-logout-cancel');
const btnLogoutOk        = el('btn-logout-ok');

btnLogout.addEventListener('click', () => { modalConfirmLogout.hidden = false; });
btnLogoutCancel.addEventListener('click', () => { modalConfirmLogout.hidden = true; });
modalConfirmLogout.addEventListener('click', e => {
  if (e.target === modalConfirmLogout) modalConfirmLogout.hidden = true;
});
btnLogoutOk.addEventListener('click', async () => {
  modalConfirmLogout.hidden = true;
  try { await logout(); } catch { /* ignore */ }

  // إعادة تحميل كاملة — لا تنظيف يدوي للحالة.
  //
  // مسحُ حقول S وحدها كان يُبقي البوابة محمّلة: أعلام _xxxLoaded تبقى true،
  // والقوائم المرسومة تبقى في الـDOM، فيتخطّى switchTab إعادةَ التحميل ويرى
  // مديرُ المدرسة التالية طلابَ سابقتها حتى يُحدِّث الصفحة يدوياً.
  //
  // والتعداد اليدوي لكل مخبأ حلٌّ هشّ: البوابة تحمل عشرات المخابئ على مستوى
  // الوحدة، وأيّ ميزة جديدة تضيف واحداً تُعيد التسريب صامتاً. الجهاز يتناوب
  // عليه مديرو مدارس مختلفة فعلياً، فالضمان الوحيد أن تبدأ الجلسة التالية من
  // صفحة نظيفة — وهو ما تفعله بوابة المديرية أصلاً.
  try { await NDB.purgeTenantCaches(); } catch { /* غير قاتل */ }
  location.reload();
});

// ── In-app confirm ────────────────────────────────────────────────────────────
// Replaces native confirm(): the browser's dialog renders the hosting domain
// to the user ("andrewleko19-boop.github.io says…") and breaks the
// installed-app illusion. Returns a promise that resolves true (continue) or
// false (cancel) — same pattern as the teacher portal's askConfirm.
const modalAsk     = el('modal-ask');
const askModalText = el('ask-modal-text');
const btnAskCancel = el('btn-ask-cancel');
const btnAskOk     = el('btn-ask-ok');

let _askResolve = null;

function settleAsk(answer) {
  if (!_askResolve) return;
  const resolve = _askResolve;
  _askResolve = null;
  modalAsk.hidden = true;
  resolve(answer);
}

function askConfirm(message, okLabel = 'متابعة') {
  // A second call while one is open cancels the first rather than orphaning it.
  settleAsk(false);
  askModalText.textContent = message;
  btnAskOk.textContent     = okLabel;
  modalAsk.hidden = false;
  btnAskOk.focus();
  return new Promise((resolve) => { _askResolve = resolve; });
}

btnAskCancel.addEventListener('click', () => settleAsk(false));
btnAskOk.addEventListener('click',     () => settleAsk(true));
modalAsk.addEventListener('click', (e) => {
  if (e.target === modalAsk) settleAsk(false);
});

// ── Change Password Drawer ────────────────────────────────────────────────────
const pwdOverlay   = el('pwd-drawer-overlay');
const btnChangePwd = el('btn-change-pwd');
el('btn-settings')?.addEventListener('click', () => switchTab('staff'));
const btnClosePwd  = el('btn-close-pwd');
const formPwd      = el('form-pwd');
const pwdUserInfo  = el('pwd-user-info');
const pwdMsg       = el('pwd-msg');

function openPwdDrawer() {
  pwdUserInfo.textContent = S.user?.user?.email ?? '';
  formPwd.reset();
  pwdMsg.hidden = true;
  pwdMsg.className = 'pwd-msg';
  pwdOverlay.hidden = false;
  setTimeout(() => el('pwd-current')?.focus(), 50);
}
function closePwdDrawer() { pwdOverlay.hidden = true; }

btnChangePwd.addEventListener('click', openPwdDrawer);
btnClosePwd.addEventListener('click', closePwdDrawer);
pwdOverlay.addEventListener('click', e => { if (e.target === pwdOverlay) closePwdDrawer(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pwdOverlay.hidden) closePwdDrawer(); });

formPwd.addEventListener('submit', async e => {
  e.preventDefault();
  const cur  = el('pwd-current').value;
  const nw   = el('pwd-new').value;
  const conf = el('pwd-confirm').value;

  pwdMsg.hidden = true;
  pwdMsg.className = 'pwd-msg';

  if (nw.length < 8) {
    pwdMsg.textContent = 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل';
    pwdMsg.classList.add('is-error'); pwdMsg.hidden = false; return;
  }
  if (nw !== conf) {
    pwdMsg.textContent = 'كلمة المرور الجديدة وتأكيدها غير متطابقين';
    pwdMsg.classList.add('is-error'); pwdMsg.hidden = false; return;
  }

  const saveBtn = el('btn-pwd-save');
  saveBtn.disabled = true;

  const result = await changePassword(S.user?.user?.email ?? '', cur, nw);
  if (result.error) {
    pwdMsg.textContent = result.error;
    pwdMsg.classList.add('is-error'); pwdMsg.hidden = false;
  } else {
    pwdMsg.textContent = 'تم تغيير كلمة المرور بنجاح ✓';
    pwdMsg.classList.add('is-success'); pwdMsg.hidden = false;
    formPwd.reset();
    setTimeout(closePwdDrawer, 1600);
  }
  saveBtn.disabled = false;
});

// ── Tab History (back navigation) ─────────────────────────────────────────────
let _navDepth = 0;
const backNavBtn = el('btn-back-nav');

function pushTabHistory(tabName) {
  _navDepth++;
  history.pushState({ tab: tabName, d: _navDepth }, '', '#' + tabName);
  if (backNavBtn) backNavBtn.hidden = false;
}

window.addEventListener('popstate', e => {
  _navDepth = e.state?.d ?? 0;
  if (backNavBtn) backNavBtn.hidden = (_navDepth === 0);
  const tab = e.state?.tab;
  if (tab) switchTab(tab, true);
});

if (backNavBtn) {
  backNavBtn.addEventListener('click', () => history.back());
}

// ── App init ──────────────────────────────────────────────────────────────────
async function initApp() {
  showScreen('app');
  history.replaceState({ tab: 'attendance', d: 0 }, '', '#attendance');
  _navDepth = 0;
  if (backNavBtn) backNavBtn.hidden = true;

  // ── Fetch real school data from DB (offline-safe) ──────────────────────────
  await loadSchoolData();

  // Swap معلم↔موجه labels based on school type (after S.school is populated).
  applyRoleLabels();

  // Header — now uses the live DB name, not a hardcoded string
  hdrSchool.textContent = S.school?.name ?? '…';
  hdrDate.textContent   = formatDateAr(todayISO());

  // Onboarding banner: shown once when teacher/student counts are missing
  (function initSetupBanner() {
    const banner    = el('setup-banner');
    const bannerKey = `nsams_setup_done_${S.school?.id}`;
    const missing   = !S.school?.totalTeachers && !S.school?.totalStudents;
    if (banner && missing && !localStorage.getItem(bannerKey)) {
      banner.hidden = false;
      el('btn-dismiss-banner')?.addEventListener('click', () => {
        localStorage.setItem(bannerKey, '1');
        banner.hidden = true;
      });
      el('banner-goto-settings')?.addEventListener('click', () => {
        switchTab('staff');
        banner.hidden = true;
        localStorage.setItem(bannerKey, '1');
      });
    } else if (banner) {
      banner.hidden = true;
    }
  })();

  // Reset attendance inputs to a clean slate.
  S.absentTeachers = [];
  inStuPresent.value = '0';
  inStuAbsent.value  = '0';
  inNotes.value      = '';
  btnSubmitAtt.disabled = false;

  // Restore the submitted/pending state from the DB so a successful submit
  // persists across reloads (no double-submit, no editable zeroed form).
  let todayRec = null;
  try {
    todayRec = await getDailyAttendance(S.school.id, todayISO());
  } catch (e) {
    // Offline or fetch error → conservatively show the pending form.
    console.warn('[NSAMS] getDailyAttendance failed, treating as pending', e);
  }
  if (todayRec) {
    markAttendanceSubmitted(true, todayRec);
  } else {
    S.attSubmitted = false;
    show(attCard);
    hide(attDone);
    setStatusPending();
  }
  renderAbsentList();
  resetReportForm();
  updateConnUI();

  // Default to the attendance tab on each app entry; other tabs load lazily.
  // fromHistory=true: initApp already seeds history via replaceState, so this
  // initial activation must not push a new state or reveal the back button.
  // Flags reset BEFORE switchTab so the first switch sees fresh state.
  _manageLoaded    = false;
  _subjectsLoaded  = false;
  _mngSubjectsInit = false;
  _reportsLoaded   = false;
  _staffLoaded     = false;
  _registryLoaded  = false;
  _statementLoaded = false;
  _lookupCache     = {};
  switchTab('attendance', true);

  // Kick off sync of any offline-queued records
  await doSync();

  // Notifications (badge + realtime + push registration + attendance reminder)
  initNotifications(S.user.user.id);

  // Load teacher submissions now that S.school is populated.
  // (Previously triggered by a fragile MutationObserver that could fire before
  //  school data was ready; called directly here instead.)
  await loadClassSummaries();
  loadStaffDailyCounts();   // auto-fill admin/worker counts from the staff register

  await consumeNotifDeepLink();
}

// A push notification opens the portal at ?n=<type>&e=<entity_id>. Route to the
// matching screen, then strip the params so a reload doesn't reopen the dialog.
async function consumeNotifDeepLink() {
  const params = new URLSearchParams(location.search);
  const type   = params.get('n');
  const entity = params.get('e');
  if (!type || !entity) return;

  history.replaceState(null, '', location.pathname + location.hash);
  await handleNotifTarget(type, entity);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    const session = await getCurrentUser();
    if (session && session.role === 'school_admin') {
      S.user = session;
      await initApp();
      return;
    }
    // ⚠️ جلسة بدور خاطئ تُسجَّل خروجاً لا تُترك: تركها في التخزين يعني أنّ
    // فتح هذه البوابة لاحقاً يُعيد المحاولة نفسها إلى الأبد، وأنّ حساب بوابة
    // أخرى يبقى حيّاً على الجهاز بعد أن ظنّ صاحبه أنه غادر.
    if (session) { try { await logout(); } catch { /* ignore */ } }
  } catch (err) {
    console.warn('[NSAMS] bootstrap session check failed', err);
  }
  showScreen('login');
}

// NOTE: bootstrap() is invoked at the very END of this file, after ALL top-level
// const declarations (including the management-tab element refs that switchTab
// touches). Calling it here would hit the temporal dead zone for those consts.
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// CLASS SUBMISSIONS — Teacher → Principal review flow
// ════════════════════════════════════════════════════════════════════════════

// ── DOM refs (el() is already defined above) ──────────────────────────────────
const clasSubLoading     = el('class-sub-loading');
const clasSubEmpty       = el('class-sub-empty');
const clasSubList        = el('class-sub-list');
const btnRefreshClasses  = el('btn-refresh-classes');
const classesRefreshIcon = el('classes-refresh-icon');
const modalReject        = el('modal-reject');
const rejectClassName    = el('reject-class-name');
const rejectNotes        = el('reject-notes');
const rejectError        = el('reject-error');
const btnCloseReject     = el('btn-close-reject');
const btnConfirmReject   = el('btn-confirm-reject');
const rejectBtnLabel     = el('reject-btn-label');
const rejectSpinner      = el('reject-spinner');

// Class detail modal (read-only)
const modalDetail        = el('modal-detail');
const btnCloseDetail     = el('btn-close-detail');
const detailTitle        = el('detail-title');
const detailMeta         = el('detail-meta');
const detailLoading      = el('detail-loading');
const detailError        = el('detail-error');
const detailContent      = el('detail-content');
const detailStudents     = el('detail-students');
const detailAbsence      = el('detail-absence');
const detailDate         = el('detail-date');
const btnPrintDetail     = el('btn-print-detail');

// Ensure reject modal is hidden on page load
hide(modalReject);

// ── State ─────────────────────────────────────────────────────────────────────
let _rejectSubmissionId = null;
let _classBusy          = false;
let _summaryByClass     = {};   // classId -> summary row (for the detail modal)
// Class-detail modal state
let _detailClassId  = null;
let _detailStudents = [];
let _detailMap      = {};
let _detailDate     = null;

// ── Load class summaries ──────────────────────────────────────────────────────
async function loadClassSummaries() {
  if (!S.school?.id) return;
  const DB = window.NSAMS_DB;
  if (!DB || !DB.getSchoolDailySummary) return;

  show(clasSubLoading);
  hide(clasSubList);
  hide(clasSubEmpty);
  classesRefreshIcon.classList.add('syncing');

  try {
    const summaries = await DB.getSchoolDailySummary(S.school.id, todayISO());
    hide(clasSubLoading);
    classesRefreshIcon.classList.remove('syncing');

    if (!summaries || summaries.length === 0) {
      show(clasSubEmpty);
      return;
    }

    clasSubList.innerHTML = '';
    _summaryByClass = {};
    for (const s of summaries) {
      _summaryByClass[s.classId] = s;
      clasSubList.appendChild(buildClassRow(s));
    }
    show(clasSubList);

    // Update the overview card counters and date
    const ovDate = el('att-overview-date');
    if (ovDate) ovDate.textContent = formatDateAr(todayISO());

    const clsConfirmed = summaries.filter(s => (s.submission?.status ?? 'none') === 'confirmed').length;
    const clsTotal     = summaries.length;
    const clsPending   = clsTotal - clsConfirmed;
    if (el('cls-confirmed')) el('cls-confirmed').textContent = clsConfirmed;
    if (el('cls-pending'))   el('cls-pending').textContent   = clsPending;
    if (el('cls-total'))     el('cls-total').textContent     = clsTotal;

    // Wire the class filter toggle to .csub-row elements (idempotent)
    const filterToggle = el('class-filter-toggle');
    if (filterToggle && !filterToggle.dataset.wired) {
      filterToggle.dataset.wired = '1';
      filterToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        filterToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        el('class-sub-list')?.querySelectorAll('.csub-row').forEach(row => {
          const st = row.dataset.status ?? 'none';
          row.hidden = filter === 'all'       ? false
                     : filter === 'confirmed' ? st !== 'confirmed'
                     : /* pending */           st === 'confirmed';
        });
      });
    }

    // Auto-populate aggregate student counts from teacher data
    // Excused (بعذر) counts as attending, NOT absent — matches the system-wide
    // convention (directorate/ministry use attending = present + late + excused).
    const totalPresent = summaries.reduce((a, s) => a + s.stats.present + s.stats.late + s.stats.excused, 0);
    const totalAbsent  = summaries.reduce((a, s) => a + s.stats.absent, 0);
    if (totalPresent > 0 || totalAbsent > 0) {
      inStuPresent.value = totalPresent;
      inStuAbsent.value  = totalAbsent;
    }
  } catch (err) {
    console.error('[NSAMS] loadClassSummaries', err);
    hide(clasSubLoading);
    classesRefreshIcon.classList.remove('syncing');
    toast(RW.loadSubsErr, 'error');
  }
}

function buildClassRow(s) {
  const sub    = s.submission;
  const status = sub?.status ?? 'none';

  const badgeMap = {
    none:      ['csub-badge-none',      'لم يُرسل'],
    pending:   ['csub-badge-pending',   'بانتظار المراجعة'],
    confirmed: ['csub-badge-confirmed', 'مؤكد ✓'],
    rejected:  ['csub-badge-rejected',  'مُعاد ✗'],
  };
  const [badgeCls, badgeTxt] = badgeMap[status] ?? badgeMap.none;

  const statsHtml = sub
    ? `<span class="cstat-p">ح${s.stats.present}</span>
       <span class="cstat-l">ت${s.stats.late}</span>
       <span class="cstat-a">غ${s.stats.absent}</span>
       <span class="cstat-e">ع${s.stats.excused}</span>`
    : `<span style="color:#CBD5E1">—</span>`;

  const actionsHtml = status === 'pending'
    ? `<div class="csub-actions">
         <button class="csub-btn-confirm" data-sid="${sub.id}" data-cname="${escapeHtml(s.displayName)}">تأكيد</button>
         <button class="csub-btn-reject"  data-sid="${sub.id}" data-cname="${escapeHtml(s.displayName)}">إعادة</button>
       </div>`
    : '';

  const div = document.createElement('div');
  div.className = 'csub-row';
  div.dataset.classId = s.classId;
  div.dataset.status  = status;
  div.innerHTML = `
    <div class="csub-main">
      <div class="csub-grade">${s.grade}</div>
      <div class="csub-info">
        <div class="csub-name">${escapeHtml(s.displayName)}</div>
        <div class="csub-teacher">${escapeHtml(s.teacherName)}</div>
      </div>
      <div class="csub-stats">${statsHtml}</div>
    </div>
    <div class="csub-foot">
      <span class="csub-badge ${badgeCls}">${badgeTxt}</span>
      ${actionsHtml}
    </div>
  `;
  return div;
}

async function loadAbsenceView() {
  const listEl = el('absence-history-list');
  if (!listEl) return;
  if (Object.keys(_summaryByClass).length === 0) {
    await loadClassSummaries();
  }
  const summaries = Object.values(_summaryByClass);
  if (summaries.length === 0) {
    listEl.innerHTML = `<div style="text-align:center;padding:24px;color:#94A3B8">لا توجد بيانات لليوم</div>`;
    return;
  }
  const submitted = summaries.filter(s => s.submission).sort((a, b) => b.stats.absent - a.stats.absent);
  listEl.innerHTML = submitted.length === 0
    ? `<div style="text-align:center;padding:24px;color:#94A3B8">لم يُرسل أيّ معلم كشفه بعد</div>`
    : submitted.map(s => `
      <div class="absence-day-row">
        <span class="absence-day-label">${escapeHtml(s.displayName)}</span>
        <div class="absence-badges">
          ${s.stats.present > 0 ? `<span class="class-pill pill-done">${s.stats.present} حاضر</span>` : ''}
          ${s.stats.absent  > 0 ? `<span class="class-pill pill-rejected">${s.stats.absent} غائب</span>` : ''}
          ${s.stats.late    > 0 ? `<span class="class-pill pill-pending">${s.stats.late} متأخر</span>` : ''}
        </div>
      </div>`).join('');
}

async function loadSummaryReports() {
  const bodyEl  = el('summary-reports-body');
  const monthEl = el('reports-month');
  if (monthEl) monthEl.textContent = formatDateAr(todayISO());
  if (!bodyEl) return;
  if (Object.keys(_summaryByClass).length === 0) {
    await loadClassSummaries();
  }
  const summaries  = Object.values(_summaryByClass);
  const confirmed  = summaries.filter(s => s.submission?.status === 'confirmed').length;
  const total      = summaries.length;
  const pct        = total > 0 ? Math.round(confirmed / total * 100) : 0;
  const totPresent = summaries.reduce((a, s) => a + s.stats.present + s.stats.late + s.stats.excused, 0);
  const totAbsent  = summaries.reduce((a, s) => a + s.stats.absent, 0);
  const totStudents= summaries.reduce((a, s) => a + (s.totalStudents || 0), 0);
  const rows = [
    { label: 'نسبة تسليم الكشوف',     val: `${pct}٪ (${confirmed}/${total})`, color: '#2563eb' },
    { label: 'الطلاب الحاضرون اليوم', val: totPresent,                         color: '#16a34a' },
    { label: 'الطلاب الغائبون اليوم', val: totAbsent,                          color: '#dc2626' },
    { label: 'إجمالي الطلاب المسجّلين', val: totStudents,                      color: '#7c3aed' },
  ];
  bodyEl.innerHTML = rows.map(r => `
    <div class="report-row">
      <span class="report-row-label">${r.label}</span>
      <span class="report-row-value" style="color:${r.color}">${r.val}</span>
    </div>`).join('');
}

// ── Confirm ───────────────────────────────────────────────────────────────────
clasSubList.addEventListener('click', async (e) => {
  const confirmBtn = e.target.closest('.csub-btn-confirm');
  const rejectBtn  = e.target.closest('.csub-btn-reject');
  if (confirmBtn) { await handleConfirm(confirmBtn); return; }
  if (rejectBtn)  { openRejectModal(rejectBtn.dataset.sid, rejectBtn.dataset.cname); return; }
  // Otherwise: tapping the row opens the read-only class detail.
  const row = e.target.closest('.csub-row');
  if (row && row.dataset.classId) openDetailModal(row.dataset.classId);
});

async function handleConfirm(btn) {
  if (_classBusy) return;
  if (!navigator.onLine) {
    toast('تأكيد الكشف يحتاج اتصالاً بالإنترنت', 'warning', 3000);
    return;
  }
  _classBusy = true;
  const sid   = btn.dataset.sid;
  const cname = btn.dataset.cname;
  btn.disabled    = true;
  btn.textContent = '…';

  try {
    await window.NSAMS_DB.confirmClassSubmission(sid, S.user.user.id);
    toast(`تم تأكيد كشف ${cname}`, 'success');
    await loadClassSummaries();
  } catch (err) {
    console.error('[NSAMS] handleConfirm', err);
    toast('تعذّر تأكيد الكشف', 'error');
    btn.disabled    = false;
    btn.textContent = 'تأكيد';
  } finally {
    _classBusy = false;
  }
}

// ── Reject modal ──────────────────────────────────────────────────────────────
function openRejectModal(sid, cname) {
  if (!sid) {  // ← أضف هذا الفحص
    console.error('[NSAMS] openRejectModal: invalid submission ID', sid);
    return;
  }
  _rejectSubmissionId       = sid;
  rejectClassName.textContent = cname;
  rejectNotes.value         = '';
  hide(rejectError);
  show(modalReject);
  document.body.style.overflow = 'hidden';
  setTimeout(() => rejectNotes.focus(), 80);
}

function closeRejectModal() {
  hide(modalReject);
  document.body.style.overflow = '';
  _rejectSubmissionId = null;
}

btnCloseReject.addEventListener('click', closeRejectModal);
modalReject.addEventListener('click', (e) => { if (e.target === modalReject) closeRejectModal(); });

// ── Class detail modal (read-only — principal can view any class) ─────────────
const DET_STATUS_AR   = { present: 'حاضر', late: 'متأخر', absent: 'غائب', excused: 'بعذر' };
const DET_STATUS_PILL = { present: 'det-pill-present', late: 'det-pill-late', absent: 'det-pill-absent', excused: 'det-pill-excused' };

function countsFromMap(map) {
  const c = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const k in map) { const st = map[k].status; if (c[st] !== undefined) c[st]++; }
  return c;
}

function renderDetailMeta(s, counts) {
  const st = counts || s.stats || { present: 0, late: 0, absent: 0, excused: 0 };
  detailMeta.innerHTML =
    `<span class="det-chip">المعلّم: ${escapeHtml(s.teacherName || '—')}</span>` +
    `<span class="cstat-p det-chip">ح${st.present}</span>` +
    `<span class="cstat-l det-chip">ت${st.late}</span>` +
    `<span class="cstat-a det-chip">غ${st.absent || 0}</span>` +
    `<span class="cstat-e det-chip">ع${st.excused || 0}</span>` +
    `<span class="det-chip">العدد: ${s.totalStudents ?? (_detailStudents.length || '—')}</span>`;
}

function openDetailModal(classId) {
  const s = _summaryByClass[classId];
  if (!s) return;

  _detailClassId  = classId;
  _detailStudents = [];
  _detailMap      = {};
  _detailDate     = todayISO();

  detailTitle.textContent = s.displayName;
  renderDetailMeta(s, null);                 // teacher + total now; counts after load
  detailDate.value = todayISO();
  detailDate.max   = todayISO();

  detailStudents.innerHTML = '';
  detailAbsence.innerHTML  = '';
  hide(detailContent);
  hide(detailError);
  show(detailLoading);
  show(modalDetail);
  document.body.style.overflow = 'hidden';

  loadDetail(classId);
}

function closeDetailModal() {
  hide(modalDetail);
  document.body.style.overflow = '';
}

async function loadDetail(classId) {
  const DB = window.NSAMS_DB;
  try {
    const date = detailDate.value || todayISO();
    const [students, dayMap, absMap] = await Promise.all([
      DB.getClassStudents(classId),
      DB.getClassAttendanceForDate(classId, date),
      DB.getClassAbsenceSummary(classId),
    ]);
    _detailStudents = students || [];
    _detailMap      = dayMap || {};
    _detailDate     = date;
    renderDetailStudents(_detailStudents, _detailMap);
    renderDetailAbsence(_detailStudents, absMap);
    renderDetailMeta(_summaryByClass[classId], countsFromMap(_detailMap));
    hide(detailLoading);
    show(detailContent);
  } catch (err) {
    console.error('[NSAMS] loadDetail', err);
    hide(detailLoading);
    detailError.textContent = navigator.onLine
      ? 'تعذّر تحميل تفاصيل الصف.'
      : 'تفاصيل الصف تحتاج اتصالاً بالإنترنت.';
    show(detailError);
  }
}

// Change the day → re-fetch attendance for that date (roster + cumulative stay).
detailDate.addEventListener('change', async () => {
  if (!_detailClassId) return;
  const date = detailDate.value || todayISO();
  try {
    const map = await window.NSAMS_DB.getClassAttendanceForDate(_detailClassId, date);
    _detailMap  = map || {};
    _detailDate = date;
    renderDetailStudents(_detailStudents, _detailMap);
    renderDetailMeta(_summaryByClass[_detailClassId], countsFromMap(_detailMap));
  } catch (err) {
    console.error('[NSAMS] detail date change', err);
    toast('تعذّر تحميل حضور هذا التاريخ', 'error');
  }
});

function renderDetailStudents(students, todayMap) {
  if (!students || students.length === 0) {
    detailStudents.innerHTML = '<div class="det-empty">لا يوجد طلاب مسجلون في هذا الصف.</div>';
    return;
  }
  detailStudents.innerHTML = students.map((stu, i) => {
    const rec     = todayMap[stu.id];
    const status  = rec?.status;
    const pillCls = DET_STATUS_PILL[status] || 'det-pill-none';
    const label   = status ? DET_STATUS_AR[status] : 'لم يُسجّل';
    const reason  = rec?.reason ? `<span class="det-reason">${escapeHtml(rec.reason)}</span>` : '';
    const seat    = stu.seat_number ?? (i + 1);
    return `<div class="det-row">
      <span class="det-seat">${seat}</span>
      <span class="det-name">${escapeHtml(stu.full_name)}</span>
      ${reason}
      <span class="det-pill ${pillCls}">${label}</span>
    </div>`;
  }).join('');
}

function renderDetailAbsence(students, absMap) {
  const nameById = {};
  for (const stu of students || []) nameById[stu.id] = stu.full_name;

  const rows = Object.entries(absMap || {})
    .map(([id, c]) => ({ name: nameById[id] || '—', absent: c.absent || 0, excused: c.excused || 0 }))
    .filter(r => r.absent > 0 || r.excused > 0)
    .sort((a, b) => (b.absent + b.excused) - (a.absent + a.excused));

  if (rows.length === 0) {
    detailAbsence.innerHTML = '<div class="det-empty">لا يوجد غياب مسجّل هذه السنة 🎉</div>';
    return;
  }
  detailAbsence.innerHTML = rows.map(r => `<div class="det-row">
    <span class="det-name">${escapeHtml(r.name)}</span>
    <span class="det-reason">${r.excused ? `بعذر: ${r.excused}` : ''}</span>
    <span class="det-count">غياب: ${r.absent}</span>
  </div>`).join('');
}

btnCloseDetail.addEventListener('click', closeDetailModal);
modalDetail.addEventListener('click', (e) => { if (e.target === modalDetail) closeDetailModal(); });

// Export / PDF — open a clean printable sheet for the shown date.
// Open the window synchronously (popup-blocker friendly), then fill it async.
btnPrintDetail.addEventListener('click', () => {
  const win = window.open('', '_blank');
  if (!win) { toast('فعّل النوافذ المنبثقة لتتمكّن من التصدير', 'warning'); return; }
  printClassSheet(win);
});

// Fetch the eagle mark as a data URI so it embeds in the PDF (works offline too).
async function eagleDataUri() {
  try {
    const url = new URL('../icons/eagle-mark.png', location.href).href;
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  } catch { return ''; }
}

async function printClassSheet(win) {
  const s = _summaryByClass[_detailClassId];
  if (!s) { win.close(); return; }

  const dateLabel  = _detailDate || todayISO();
  const schoolName = S.school?.name || '';
  const c = countsFromMap(_detailMap);
  const logo = await eagleDataUri();

  const rows = _detailStudents.map((stu, i) => {
    const rec    = _detailMap[stu.id];
    const status = rec?.status;
    const label  = status ? DET_STATUS_AR[status] : 'لم يُسجّل';
    const reason = rec?.reason ? escapeHtml(rec.reason) : '';
    const seat   = stu.seat_number ?? (i + 1);
    return `<tr><td>${seat}</td><td>${escapeHtml(stu.full_name)}</td><td>${label}</td><td>${reason}</td></tr>`;
  }).join('');

  const logoHtml = logo ? '<img class="logo" src="' + logo + '" alt="">' : '';

  win.document.write(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<title>كشف الحضور — ' + escapeHtml(s.displayName) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">' +
    '<style>' +
    "body{font-family:'Cairo',Arial,sans-serif;color:#0f172a;padding:24px;margin:0}" +
    '.head{text-align:center;margin-bottom:6px}' +
    '.logo{width:90px;height:90px;object-fit:contain;display:block;margin:0 auto 8px}' +
    'h1{font-size:19px;margin:0 0 2px;color:#06b6d4}' +
    '.sub{color:#475569;font-size:13px;margin:2px 0}' +
    '.sum{margin-top:10px;font-size:13px;font-weight:700;text-align:center}' +
    'table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}' +
    'th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:right}' +
    'th{background:#06b6d4;color:#fff}' +
    'tr:nth-child(even) td{background:#f8fafc}' +
    '@media print{@page{margin:14mm}}' +
    '</style></head><body>' +
    '<div class="head">' +
    logoHtml +
    '<h1>' + escapeHtml(schoolName) + '</h1>' +
    '<div class="sub">كشف الحضور — ' + escapeHtml(s.displayName) + '</div>' +
    '<div class="sub">المعلّم: ' + escapeHtml(s.teacherName || '—') + ' &nbsp;·&nbsp; التاريخ: ' + dateLabel + '</div>' +
    '</div>' +
    '<div class="sum">حاضر: ' + c.present + ' · متأخر: ' + c.late + ' · غائب: ' + c.absent + ' · بعذر: ' + c.excused + ' · العدد: ' + _detailStudents.length + '</div>' +
    '<table><thead><tr><th>#</th><th>الاسم</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>' +
    rows +
    '</tbody></table>' +
    '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print()},400)}</scr' + 'ipt>' +
    '</body></html>'
  );
  win.document.close();
}

btnConfirmReject.addEventListener('click', async () => {
  if (!_rejectSubmissionId) {  // ← فحص
    rejectError.textContent = 'خطأ: معرّف الكشف غير صحيح';
    show(rejectError);
    return;
  }
  if (!navigator.onLine) {
    rejectError.textContent = 'إعادة الكشف تحتاج اتصالاً بالإنترنت';
    show(rejectError);
    return;
  }
  const notes = rejectNotes.value.trim();
  if (!notes) {
    rejectError.textContent = 'يرجى كتابة سبب الإعادة';
    show(rejectError);
    rejectNotes.focus();
    return;
  }
  hide(rejectError);
  btnConfirmReject.disabled = true;
  rejectBtnLabel.hidden     = true;
  rejectSpinner.hidden      = false;

  try {
    await window.NSAMS_DB.rejectClassSubmission(_rejectSubmissionId, S.user.user.id, notes);
    const cname = rejectClassName.textContent;
    closeRejectModal();
    toast(RW.rejectedToast(cname), 'warning');
    await loadClassSummaries();
  } catch (err) {
    console.error('[NSAMS] rejectSubmission', err);
    rejectError.textContent = 'حدث خطأ، يرجى المحاولة مجدداً';
    show(rejectError);
  } finally {
    btnConfirmReject.disabled = false;
    rejectBtnLabel.hidden     = false;
    rejectSpinner.hidden      = true;
  }
});

btnRefreshClasses.addEventListener('click', () => loadClassSummaries());

// ════════════════════════════════════════════════════════════════════════════
//  Tabs + Class/Teacher Management
// ════════════════════════════════════════════════════════════════════════════
const NDB = window.NSAMS_DB;

const tabAttendance   = el('tab-attendance');
const tabManage       = el('tab-manage');
const tabStudents     = el('tab-students');
const tabStaff        = el('tab-staff');
const tabSubjects     = el('tab-subjects');
const tabReports      = el('tab-reports');
const viewAttendance  = el('view-attendance');
const viewManage      = el('view-manage');
const viewStudents    = el('view-students');
const viewStaff       = el('view-staff');
const viewSubjects    = el('view-subjects');
const viewReports     = el('view-reports');
const tabRegistry     = el('tab-registry');
const viewRegistry    = el('view-registry');
const tabStatement    = el('tab-statement');
const viewStatement   = el('view-statement');
const tabPersonnel    = el('tab-personnel');
const viewPersonnel   = el('view-personnel');
const tabAbsence        = el('tab-absence');
const viewAbsence       = el('view-absence');
const tabSummaryReports = el('tab-summary-reports');
const viewSummaryReports= el('view-summary-reports');
const tabNoc          = el('tab-noc');
const viewNoc         = el('view-noc');
const fabReport       = el('btn-open-report');

// منتقي الأقسام — فقاعة تعرض القسم الحالي + شبكة الفقاعات (بدل الشريط الأفقي)
const secbarWrap       = el('secbar-wrap') ?? document.querySelector('.secbar-wrap');
const btnOpenSections  = el('btn-open-sections');
const secbarPillUse    = el('secbar-pill-use');
const secbarPillLabel  = el('secbar-pill-label');
const modalSections    = el('modal-sections');
const btnCloseSections = el('btn-close-sections');

const mngClassSelect    = el('mng-class-select');
const mngAssignedWrap   = el('mng-assigned-wrap');
const mngAssignedLoading= el('mng-assigned-loading');
const mngAssignedList   = el('mng-assigned-list');
const mngAssignedEmpty  = el('mng-assigned-empty');
const mngTeacherSelect  = el('mng-teacher-select');
const mngRoleSelect     = el('mng-role-select');
const mngSubjField      = el('mng-subj-field');
const mngSubjPick       = el('mng-subj-pick');
const mngSubjEmpty      = el('mng-subj-empty');
const mngSupSelect      = el('mng-sup-select');
const mngSupError       = el('mng-sup-error');
const btnAssignSup      = el('btn-assign-supervisor');
const assignSupSpinner  = el('assign-sup-spinner');
const mngError          = el('mng-error');
const btnAssignTeacher  = el('btn-assign-teacher');
const assignBtnLabel    = el('assign-btn-label');
const assignSpinner     = el('assign-spinner');
const btnRefreshManage  = el('btn-refresh-manage');

let _manageLoaded = false;   // classes dropdown loaded once per session
let _mngBusy      = false;

// أيقونة ونصّ كل قسم — لتحديث فقاعة المنتقي بعد كل تبديل، مطابقة لما في شبكة
// الفقاعات حرفياً.
const TAB_META = {
  attendance:        { icon: 'ic-home',         label: 'الرئيسية' },
  absence:           { icon: 'ic-x-circle',     label: 'الغياب' },
  'summary-reports': { icon: 'ic-bar-chart',    label: 'التقارير' },
  manage:            { icon: 'ic-users',        label: 'الصفوف' },
  students:          { icon: 'ic-user',         label: 'الطلاب' },
  personnel:         { icon: 'ic-receipt',      label: 'الكادر' },
  staff:             { icon: 'ic-settings',     label: 'إعدادات المدرسة' },
  subjects:          { icon: 'ic-inbox',        label: 'الطلبات' },
  reports:           { icon: 'ic-award',        label: 'الشهادات' },
  registry:          { icon: 'ic-user-group',   label: 'الكوادر' },
  statement:         { icon: 'ic-file-text',    label: 'البيان' },
  noc:               { icon: 'ic-send',         label: 'وثائق لا مانع' },
};

const TABS = {
  absence:           { tab: tabAbsence,        view: viewAbsence },
  'summary-reports': { tab: tabSummaryReports, view: viewSummaryReports },
  attendance: { tab: tabAttendance, view: viewAttendance },
  manage:     { tab: tabManage,     view: viewManage },
  students:   { tab: tabStudents,   view: viewStudents },
  staff:      { tab: tabStaff,      view: viewStaff },
  subjects:   { tab: tabSubjects,   view: viewSubjects },
  reports:    { tab: tabReports,    view: viewReports },
  registry:   { tab: tabRegistry,   view: viewRegistry },
  statement:  { tab: tabStatement,  view: viewStatement },
  personnel:  { tab: tabPersonnel,  view: viewPersonnel },
  noc:        { tab: tabNoc,        view: viewNoc },
};

function switchTab(tab, fromHistory = false) {
  for (const [name, { tab: t, view: v }] of Object.entries(TABS)) {
    const active = name === tab;
    if (v) v.hidden = !active;
    if (t) {
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    }
  }
  if (fabReport) fabReport.hidden = tab !== 'attendance';
  if (btnMore) btnMore.classList.toggle('is-active', tab !== 'attendance');
  closeMoreMenu();

  // فقاعة المنتقي تعكس القسم النشط، وتُغلَق الشبكة تلقائياً بعد الاختيار —
  // نقرة الفقاعة داخل الشبكة تستدعي هذه الدالة عبر مستمعاتها الفردية، فهذا
  // المكان الوحيد الكافي لإغلاقها بلا تكرار عند كل زرّ.
  const meta = TAB_META[tab];
  if (meta && secbarPillUse)   secbarPillUse.setAttribute('href', '#' + meta.icon);
  if (meta && secbarPillLabel) secbarPillLabel.textContent = meta.label;
  closeSectionsSheet();

  if (!fromHistory) pushTabHistory(tab);

  if (tab === 'absence')         loadAbsenceView();
  if (tab === 'summary-reports') loadSummaryReports();
  if (tab === 'manage'   && !_manageLoaded)  loadManageClasses();
  if (tab === 'manage'   && !_mngSubjectsInit) initManageSubjects();
  if (tab === 'students' && !_studentsLoaded) initStudentsTab();
  if ((tab === 'staff' || tab === 'personnel') && !_staffLoaded) initStaffTab();
  if (tab === 'subjects'  && !_subjectsLoaded)  initSubjectsTab();
  if (tab === 'reports'   && !_reportsLoaded)   initReportsTab();
  if (tab === 'registry'  && !_registryLoaded)  initRegistryTab();
  if (tab === 'statement' && !_statementLoaded) initStatementTab();
  if (tab === 'noc'       && !_nocLoaded)       initNocTab();
}

tabAbsence?.addEventListener('click',        () => switchTab('absence'));
tabSummaryReports?.addEventListener('click', () => switchTab('summary-reports'));
tabAttendance.addEventListener('click', () => switchTab('attendance'));
tabManage.addEventListener('click',     () => switchTab('manage'));
tabStudents.addEventListener('click',   () => switchTab('students'));
tabStaff.addEventListener('click',      () => switchTab('staff'));
tabSubjects.addEventListener('click',   () => switchTab('subjects'));
tabReports.addEventListener('click',    () => switchTab('reports'));
tabRegistry?.addEventListener('click',   () => switchTab('registry'));
tabStatement?.addEventListener('click',  () => switchTab('statement'));
tabPersonnel?.addEventListener('click',  () => switchTab('personnel'));
tabNoc?.addEventListener('click',        () => switchTab('noc'));

// ── منتقي الأقسام: فتح/إغلاق شبكة الفقاعات ─────────────────────────────────
function openSectionsSheet() {
  if (!modalSections) return;
  show(modalSections);
  secbarWrap?.setAttribute('data-open', '1');
  btnOpenSections?.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}
function closeSectionsSheet() {
  if (!modalSections || modalSections.hidden) return;
  hide(modalSections);
  secbarWrap?.setAttribute('data-open', '0');
  btnOpenSections?.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}
btnOpenSections?.addEventListener('click', openSectionsSheet);
btnCloseSections?.addEventListener('click', closeSectionsSheet);
modalSections?.addEventListener('click', e => { if (e.target === modalSections) closeSectionsSheet(); });

// «المزيد» sections menu (bottom sheet)
const btnMore   = el('btn-more');
const menuMore  = el('menu-more');
function openMoreMenu()  { if (menuMore) { menuMore.hidden = false; btnMore?.setAttribute('aria-expanded', 'true'); } }
function closeMoreMenu() { if (menuMore) { menuMore.hidden = true;  btnMore?.setAttribute('aria-expanded', 'false'); } }
btnMore?.addEventListener('click', openMoreMenu);
el('btn-close-more')?.addEventListener('click', closeMoreMenu);
// Tap on the backdrop (outside the sheet) closes the menu.
menuMore?.addEventListener('click', (e) => { if (e.target === menuMore) closeMoreMenu(); });

function clearMngError() { mngError.hidden = true; mngError.textContent = ''; }
function showMngError(msg) { mngError.textContent = msg; mngError.hidden = false; }
function clearSupError() { mngSupError.hidden = true; mngSupError.textContent = ''; }
function showSupError(msg) { mngSupError.textContent = msg; mngSupError.hidden = false; }

// Populate the class dropdown from the admin's school.
async function loadManageClasses() {
  if (!S.school?.id) return;
  try {
    const classes = await NDB.getSchoolClasses(S.school.id);
    mngClassSelect.innerHTML = '<option value="">— اختر صفاً —</option>';
    for (const c of classes) {
      const label = c.name || `${gradeLabel(c.grade)} / ${c.section ?? ''}`.trim();
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = label;
      opt.dataset.grade = c.grade;
      mngClassSelect.appendChild(opt);
    }
    _manageLoaded = true;
    CustomSelect.refresh(mngClassSelect);
  } catch (err) {
    console.error('[NSAMS] loadManageClasses', err);
    toast('تعذّر تحميل قائمة الصفوف', 'error');
  }
}

// Light grade label fallback (db.js gradeNameAr may not be exported here).
function gradeLabel(grade) {
  return grade != null ? `الصف ${grade}` : 'صف';
}

// Subjects of the currently-selected class's grade, for the assign picker.
let _mngGradeSubjects = [];

const ROLE_LABELS = {
  homeroom:   'معلم الصف (حضور + درجات)',
  supervisor: 'موجه الصف (حضور فقط)',
  subject:    'أستاذ مادة (درجات فقط)',
};

// §25 فصلت الإعدادي عن الثانوي، لكنّ السلوك واحد: كلاهما يعمل بموجّه. الشرط
// «ليس ابتدائياً» لا قائمة قيم صريحة — فأي مرحلة تُضاف مستقبلاً تعمل بلا تعديل،
// والاسم يصف السلوك المقصود لا القيمة المخزَّنة.
function usesSupervisors() {
  return !!S.school?.type && S.school.type !== 'primary';
}

function selectedClassGrade() {
  const opt = mngClassSelect.selectedOptions[0];
  const g = opt ? Number(opt.dataset.grade) : NaN;
  return Number.isFinite(g) ? g : null;
}

// Role choices for the teacher (معلم) section depend on the SCHOOL type:
// • primary (ابتدائي): معلم الصف (حضور + درجات) or أستاذ مادة (درجات فقط).
// • preparatory/secondary (إعدادي/ثانوي): أستاذ مادة only — attendance is handled
//   by the separate موجه section.
function populateRoleOptions() {
  const roles = usesSupervisors() ? ['subject'] : ['homeroom', 'subject'];
  mngRoleSelect.innerHTML = '';
  for (const r of roles) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = ROLE_LABELS[r];
    mngRoleSelect.appendChild(opt);
  }
  CustomSelect.refresh(mngRoleSelect);
  updateSubjFieldVisibility();
}

// The subjects picker is irrelevant for supervisors (they grade nothing); the
// teacher section never offers the supervisor role, so it stays visible.
function updateSubjFieldVisibility() {
  mngSubjField.hidden = (mngRoleSelect.value === 'supervisor');
}

async function loadSubjectsPicker(grade) {
  mngSubjPick.innerHTML = '';
  _mngGradeSubjects = [];
  mngSubjEmpty.hidden = true;
  if (grade == null) return;
  try {
    const subs = (await NDB.getSchoolSubjects(S.school.id, grade)).filter(s => s.is_active);
    _mngGradeSubjects = subs;
    if (subs.length === 0) { mngSubjEmpty.hidden = false; return; }
    for (const s of subs) {
      const lbl = document.createElement('label');
      lbl.innerHTML =
        `<input type="checkbox" value="${escapeHtml(s.id)}"><span>${escapeHtml(s.name)}</span>`;
      mngSubjPick.appendChild(lbl);
    }
  } catch (err) {
    console.error('[NSAMS] loadSubjectsPicker', err);
  }
}

mngRoleSelect.addEventListener('change', updateSubjFieldVisibility);

mngClassSelect.addEventListener('change', async () => {
  clearMngError();
  const classId = mngClassSelect.value;
  if (!classId) {
    mngAssignedWrap.hidden = true;
    return;
  }
  mngAssignedWrap.hidden = false;
  const grade = selectedClassGrade();
  await Promise.all([
    loadAssignedTeachers(classId),
    loadAssignableTeachers(classId),
    loadSubjectsPicker(grade),
  ]);
});

// Teachers currently on the selected class.
async function loadAssignedTeachers(classId) {
  mngAssignedLoading.hidden = false;
  mngAssignedList.innerHTML = '';
  mngAssignedEmpty.hidden = true;
  try {
    const teachers = await NDB.getClassTeachers(classId);
    mngAssignedLoading.hidden = true;
    if (teachers.length === 0) {
      mngAssignedEmpty.hidden = false;
      return;
    }
    teachers.forEach(t => mngAssignedList.appendChild(buildAssignedRow(classId, t)));
  } catch (err) {
    mngAssignedLoading.hidden = true;
    console.error('[NSAMS] loadAssignedTeachers', err);
    toast(RW.loadAssignedErr, 'error');
  }
}

function buildAssignedRow(classId, t) {
  const li = document.createElement('li');
  li.className = 'mng-row';
  const roleBadge = `<span class="mng-role-tag">${escapeHtml(ROLE_LABELS[t.role] || t.role)}</span>`;
  const subj = (t.subjectNames || [])
    .map(n => `<span class="mng-subject-tag">${escapeHtml(n)}</span>`).join('');
  li.innerHTML = `
    <div class="mng-row-main">
      <span class="mng-teacher-name">${escapeHtml(t.fullName)}</span>
      ${roleBadge}${subj}
    </div>
    <button class="mng-remove-btn" data-tid="${escapeHtml(t.teacherId)}"
            data-name="${escapeHtml(t.fullName)}" aria-label="إزالة ${escapeHtml(t.fullName)}">
      <svg class="icon icon-sm"><use href="#ic-x"/></svg>
      إزالة
    </button>
  `;
  li.querySelector('.mng-remove-btn').addEventListener('click', () =>
    handleRemoveTeacher(classId, t.teacherId, t.fullName));
  return li;
}

// Fill one <select> with the teachers available for assignment.
function fillAssignableSelect(sel, teachers, placeholder, noneLabel) {
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  for (const t of teachers) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.fullName;
    sel.appendChild(opt);
  }
  if (teachers.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = noneLabel;
    opt.disabled = true;
    sel.appendChild(opt);
  }
  CustomSelect.refresh(sel);
}

// Teachers in the school NOT yet on this class — feeds the teacher picker, and
// the موجه picker too (إعدادي/ثانوي), both drawing from the same pool.
async function loadAssignableTeachers(classId) {
  try {
    const teachers = await NDB.getTeachersBySchool(S.school.id, classId);
    fillAssignableSelect(mngTeacherSelect, teachers, '— اختر معلماً —',
      'لا يوجد معلمون متاحون للإسناد');
    if (usesSupervisors()) {
      fillAssignableSelect(mngSupSelect, teachers, '— اختر موجهاً —',
        'لا يوجد موجهون متاحون للإسناد');
    }
  } catch (err) {
    console.error('[NSAMS] loadAssignableTeachers', err);
    toast(RW.loadListErr, 'error');
  }
}

// Assign.
btnAssignTeacher.addEventListener('click', async () => {
  if (_mngBusy) return;
  clearMngError();
  const classId   = mngClassSelect.value;
  const teacherId = mngTeacherSelect.value;
  const role      = mngRoleSelect.value || 'homeroom';
  if (!classId)   { showMngError('اختر صفاً أولاً.'); return; }
  if (!teacherId) { showMngError('اختر معلماً للإسناد.'); return; }
  if (!navigator.onLine) { showMngError('الإسناد يحتاج اتصالاً بالإنترنت.'); return; }

  // The teacher section never assigns a supervisor — subjects are required.
  const subjectIds = Array.from(mngSubjPick.querySelectorAll('input:checked')).map(i => i.value);
  if (subjectIds.length === 0) {
    showMngError('اختر مادة واحدة على الأقل لهذا الدور.');
    return;
  }

  _mngBusy = true;
  btnAssignTeacher.disabled = true;
  assignBtnLabel.hidden = true;
  assignSpinner.hidden = false;
  try {
    await NDB.assignTeacherToClass(classId, teacherId, { role, subjectIds });
    mngTeacherSelect.value = '';
    mngSubjPick.querySelectorAll('input:checked').forEach(i => { i.checked = false; });
    toast('تم تعيين المعلم للصف', 'success');
    await Promise.all([loadAssignedTeachers(classId), loadAssignableTeachers(classId)]);
  } catch (err) {
    console.error('[NSAMS] assignTeacherToClass', err);
    // Unique-violation = teacher already on the class.
    if (err?.code === '23505') {
      showMngError('هذا المعلم مرتبط بالفعل بهذا الصف.');
    } else if (err?.code === '42501') {
      showMngError(RW.noPermission);
    } else {
      showMngError('تعذّر تعيين المعلم.');
    }
  } finally {
    _mngBusy = false;
    btnAssignTeacher.disabled = false;
    assignBtnLabel.hidden = false;
    assignSpinner.hidden = true;
  }
});

// Assign a supervisor (موجه) — attendance only, no subjects (إعدادي/ثانوي).
btnAssignSup.addEventListener('click', async () => {
  if (_mngBusy) return;
  clearSupError();
  const classId   = mngClassSelect.value;
  const teacherId = mngSupSelect.value;
  if (!classId)   { showSupError('اختر صفاً أولاً.'); return; }
  if (!teacherId) { showSupError('اختر موجهاً للإسناد.'); return; }
  if (!navigator.onLine) { showSupError('الإسناد يحتاج اتصالاً بالإنترنت.'); return; }

  _mngBusy = true;
  btnAssignSup.disabled = true;
  assignSupSpinner.hidden = false;
  try {
    await NDB.assignTeacherToClass(classId, teacherId, { role: 'supervisor', subjectIds: [] });
    mngSupSelect.value = '';
    toast('تم تعيين الموجه للصف', 'success');
    await Promise.all([loadAssignedTeachers(classId), loadAssignableTeachers(classId)]);
  } catch (err) {
    console.error('[NSAMS] assignSupervisor', err);
    if (err?.code === '23505') {
      showSupError('هذا الموجه مرتبط بالفعل بهذا الصف.');
    } else if (err?.code === '42501') {
      showSupError(RW.noPermission);
    } else {
      showSupError('تعذّر تعيين الموجه.');
    }
  } finally {
    _mngBusy = false;
    btnAssignSup.disabled = false;
    assignSupSpinner.hidden = true;
  }
});

// Remove — blocked if the class has attendance recorded today.
async function handleRemoveTeacher(classId, teacherId, name) {
  if (_mngBusy) return;
  clearMngError();
  if (!navigator.onLine) { showMngError('الإزالة تحتاج اتصالاً بالإنترنت.'); return; }

  _mngBusy = true;
  try {
    const hasToday = await NDB.hasTodayAttendance(classId);
    if (hasToday) {
      showMngError(RW.cannotRemove);
      _mngBusy = false;
      return;
    }
    const ok = await askConfirm(RW.removeConfirm(name));
    if (!ok) { _mngBusy = false; return; }

    await NDB.removeTeacherFromClass(classId, teacherId);
    toast(RW.removedToast, 'success');
    await Promise.all([loadAssignedTeachers(classId), loadAssignableTeachers(classId)]);
  } catch (err) {
    console.error('[NSAMS] removeTeacherFromClass', err);
    // 42501 = insufficient_privilege (RLS blocked the delete). Never surface the
    // raw English Postgres message — always show an Arabic, user-facing string.
    showMngError(err?.code === '42501' ? RW.noPermission : RW.removeFail);
  } finally {
    _mngBusy = false;
  }
}

btnRefreshManage.addEventListener('click', async () => {
  _manageLoaded = false;
  await loadManageClasses();
  // If a class was selected, refresh its lists too.
  const classId = mngClassSelect.value;
  if (classId) {
    mngAssignedWrap.hidden = false;
    await Promise.all([loadAssignedTeachers(classId), loadAssignableTeachers(classId)]);
  }
  if (_mngSubjectsInit) loadSubjects();
});

// ═══════════════════════════════════════════════════════════════════════════
// Subjects management (مواد الصفوف) — card inside the manage (الصفوف) tab
// ═══════════════════════════════════════════════════════════════════════════
const subjGradeSelect    = el('subj-grade-select');
const subjLoading        = el('subj-loading');
const subjListEl         = el('subj-list');
const subjEmpty          = el('subj-empty');
const btnAddSubject      = el('btn-add-subject');
const btnRefreshSubjects = el('btn-refresh-subjects');
// editor modal
const modalSubject   = el('modal-subject');
const btnCloseSubject= el('btn-close-subject');
const subjModalTitle = el('subj-modal-title');
const subjNameIn     = el('subj-name');
const subjMaxIn      = el('subj-max');
const subjPassIn     = el('subj-pass');
const subjArabicIn   = el('subj-arabic');
const subjMathIn     = el('subj-math');
const subjFullMarksIn = el('subj-full-marks');
const subjCompList   = el('subj-comp-list');
const btnAddComp     = el('btn-add-comp');
const btnSubjSingle  = el('btn-subj-single');
const subjCompSum    = el('subj-comp-sum');
const subjError      = el('subj-error');
const btnSaveSubject = el('btn-save-subject');
const subjSaveLabel  = el('subj-save-label');
const subjSpinner    = el('subj-spinner');

let _mngSubjectsInit  = false;
let _subjGrade        = 1;
let _editingSubjectId = null;

// Map a Supabase error to a clear Arabic message. 42501 / "permission denied
// for table" means the grades tables haven't been granted to the app role yet.
function gradesErr(err, fallback) {
  if (err?.code === '42501' || /permission denied/i.test(err?.message || '')) {
    return 'لا تملك صلاحية الوصول إلى بيانات الدرجات على قاعدة البيانات (راجع إعداد الصلاحيات).';
  }
  return fallback;
}

function initManageSubjects() {
  if (!S.school?.id) return;
  subjGradeSelect.innerHTML = '';
  for (let g = 1; g <= 12; g++) {
    const opt = document.createElement('option');
    opt.value = String(g);
    opt.textContent = gradeNameLabel(g);
    subjGradeSelect.appendChild(opt);
  }
  subjGradeSelect.value = String(_subjGrade);
  CustomSelect.refresh(subjGradeSelect);
  _mngSubjectsInit = true;
  loadSubjects();
}

async function loadSubjects() {
  if (!S.school?.id) return;
  _subjGrade = Number(subjGradeSelect.value) || 1;
  show(subjLoading);
  subjListEl.innerHTML = '';
  subjEmpty.hidden = true;
  try {
    const subjects = await NDB.getSchoolSubjects(S.school.id, _subjGrade);
    hide(subjLoading);
    if (!subjects.length) { subjEmpty.hidden = false; return; }
    for (const sub of subjects) subjListEl.appendChild(buildSubjectRow(sub));
  } catch (err) {
    console.error('[NSAMS] loadSubjects', err);
    hide(subjLoading);
    toast(gradesErr(err, 'تعذّر تحميل المواد'), 'error');
  }
}

// ── أضف من قائمة المواد المركزية (subject_catalog) ────────────────────────────
const modalCatalog      = el('modal-catalog');
const btnAddFromCatalog = el('btn-add-from-catalog');
const btnCloseCatalog   = el('btn-close-catalog');
const catalogGradeLabel = el('catalog-grade-label');
const catalogLoading    = el('catalog-loading');
const catalogListEl     = el('catalog-list');
const catalogEmpty      = el('catalog-empty');
const catalogError      = el('catalog-error');
const btnApplyCatalog   = el('btn-apply-catalog');
const catalogApplyLabel = el('catalog-apply-label');
const catalogSpinner    = el('catalog-spinner');

const catalogGrades   = el('catalog-grades');
const catalogGradeAll = el('catalog-grade-all');

function closeCatalogModal() { hide(modalCatalog); }

async function openCatalogModal() {
  if (!S.school?.id) return;
  catalogError.hidden = true;
  catalogEmpty.hidden = true;
  catalogListEl.innerHTML = '';
  catalogGrades.innerHTML = '';
  catalogGradeAll.checked = false;
  show(catalogLoading);
  show(modalCatalog);
  try {
    const [catalog, classes] = await Promise.all([
      NDB.getSubjectCatalog(),
      NDB.getSchoolClasses(S.school.id).catch(() => []),
    ]);
    hide(catalogLoading);
    // المواد
    if (!catalog.length) {
      catalogEmpty.hidden = false;
    } else {
      catalogListEl.innerHTML = catalog.map(c => {
        const arabic = c.is_core_arabic ? ' <small style="color:var(--clr-muted)">(عربي)</small>' : '';
        const math   = c.is_core_math   ? ' <small style="color:var(--clr-muted)">(رياضيات)</small>' : '';
        return `<li style="padding:6px 2px">
          <label class="subj-check" style="margin:0">
            <input type="checkbox" class="catalog-cb" value="${escapeHtml(c.id)}" />
            <span>${escapeHtml(c.name)}${arabic}${math}</span>
          </label>
        </li>`;
      }).join('');
    }
    // الصفوف — صفوف المدرسة الفعلية (fallback 1..12)
    let grades = [...new Set((classes || []).map(c => Number(c.grade)).filter(g => g >= 1 && g <= 12))].sort((a, b) => a - b);
    if (!grades.length) grades = Array.from({ length: 12 }, (_, i) => i + 1);
    catalogGrades.innerHTML = grades.map(g =>
      `<label class="subj-check" style="margin:0">
         <input type="checkbox" class="catalog-grade-cb" value="${g}" />
         <span>${escapeHtml(gradeNameLabel(g))}</span>
       </label>`).join('');
  } catch (err) {
    console.error('[NSAMS] openCatalogModal', err);
    hide(catalogLoading);
    catalogError.textContent = gradesErr(err, 'تعذّر تحميل قائمة المواد');
    catalogError.hidden = false;
  }
}

if (btnAddFromCatalog) btnAddFromCatalog.addEventListener('click', openCatalogModal);
if (btnCloseCatalog)   btnCloseCatalog.addEventListener('click', closeCatalogModal);
if (modalCatalog)      modalCatalog.addEventListener('click', e => { if (e.target === modalCatalog) closeCatalogModal(); });
if (catalogGradeAll)   catalogGradeAll.addEventListener('change', () => {
  catalogGrades.querySelectorAll('.catalog-grade-cb').forEach(cb => { cb.checked = catalogGradeAll.checked; });
});

if (btnApplyCatalog) btnApplyCatalog.addEventListener('click', async () => {
  const subjectIds = [...catalogListEl.querySelectorAll('.catalog-cb:checked')].map(cb => cb.value);
  const grades = catalogGradeAll.checked
    ? [...catalogGrades.querySelectorAll('.catalog-grade-cb')].map(cb => Number(cb.value))
    : [...catalogGrades.querySelectorAll('.catalog-grade-cb:checked')].map(cb => Number(cb.value));
  if (!subjectIds.length) { catalogError.textContent = 'اختر مادة واحدة على الأقل.'; catalogError.hidden = false; return; }
  if (!grades.length)     { catalogError.textContent = 'اختر صفّاً واحداً على الأقل.'; catalogError.hidden = false; return; }
  catalogError.hidden = true;
  btnApplyCatalog.disabled = true;
  show(catalogSpinner); catalogApplyLabel.textContent = 'جارٍ الإضافة…';
  try {
    const n = await NDB.applyCatalogSubjectsToGrades(S.school.id, grades, subjectIds);
    closeCatalogModal();
    toast(n ? `أُضيفت ${n} مادة` : 'كل المواد المختارة موجودة مسبقاً في الصفوف المحدّدة', n ? 'success' : 'info');
    await loadSubjects();
    refreshAssignSubjectsPicker();
  } catch (err) {
    console.error('[NSAMS] applyCatalog', err);
    catalogError.textContent = gradesErr(err, 'تعذّر إضافة المواد');
    catalogError.hidden = false;
  } finally {
    btnApplyCatalog.disabled = false;
    hide(catalogSpinner); catalogApplyLabel.textContent = 'إضافة المختارة';
  }
});

// Keep the teacher-assignment subjects picker (mng-subj-pick) in sync after a
// subject is created/edited/deleted for the currently selected class's grade.
function refreshAssignSubjectsPicker() {
  if (mngClassSelect.value) loadSubjectsPicker(selectedClassGrade());
}

function buildSubjectRow(sub) {
  const li = document.createElement('li');
  li.className = 'subj-row';
  // ⚠ فاصل ZWNJ قبل كل شارة. Blink يُشكّل النصّ العربي عبر حدود العناصر السطرية،
  // فيصير «رياضيات» + شارة «رياضيات» مقطعَ تشكيل واحداً وتتّصل التاء بالراء بعدها
  // (ثم يُطبَّق الهامش بعد التشكيل، فتظهر الحروف موصولة وبينها فجوة). والفاصل
  // لازم بين شارة وأخرى كذلك: «عربي» تليها «رياضيات» تتّصل ياؤها براء التالية.
  // الطبقة الثانية: .subj-tag { display: inline-block } في style.css.
  const tag = (sub.is_core_arabic ? '&zwnj;<span class="subj-tag">عربي</span>' : '')
            + (sub.is_core_math ? '&zwnj;<span class="subj-tag">رياضيات</span>' : '')
            + (sub.allow_full_marks ? '&zwnj;<span class="subj-tag">نشاط</span>' : '');
  li.innerHTML = `
    <div class="subj-info">
      <div class="subj-name">${escapeHtml(sub.name)}${tag}</div>
      <div class="subj-meta">العظمى ${escapeHtml(String(sub.max_total))} · النجاح ${escapeHtml(String(sub.pass_mark))}٪</div>
    </div>
    <div class="subj-actions">
      <button class="icon-btn-sm danger" data-act="del" aria-label="حذف">
        <svg class="icon icon-sm"><use href="#ic-trash"/></svg>
      </button>
    </div>
  `;
  li.querySelector('[data-act="del"]').addEventListener('click', () => deleteSubjectRow(sub));
  return li;
}

async function deleteSubjectRow(sub) {
  if (!await askConfirm(`حذف المادة «${sub.name}»؟ ستُحذف درجاتها أيضاً.`, 'حذف')) return;
  try {
    await NDB.deleteSubject(sub.id);
    toast('تم حذف المادة', 'success');
    loadSubjects();
    refreshAssignSubjectsPicker();
  } catch (err) {
    console.error('[NSAMS] deleteSubject', err);
    toast('تعذّر حذف المادة', 'error');
  }
}

subjGradeSelect.addEventListener('change', loadSubjects);
btnRefreshSubjects.addEventListener('click', loadSubjects);

// ── Subject editor modal ──
function addCompRow(name = '', max = '') {
  const li = document.createElement('li');
  li.className = 'comp-row';
  li.innerHTML = `
    <input class="field-input comp-name" type="text" placeholder="اسم المكوّن (مذاكرة…)" maxlength="40" />
    <input class="field-input comp-max"  type="number" min="0" step="1" placeholder="العظمى" />
    <button type="button" class="icon-btn-sm danger" aria-label="حذف المكوّن">
      <svg class="icon icon-sm"><use href="#ic-x"/></svg>
    </button>
  `;
  li.querySelector('.comp-name').value = name;
  li.querySelector('.comp-max').value  = max;
  li.querySelector('.comp-max').addEventListener('input', updateCompSum);
  li.querySelector('button').addEventListener('click', () => { li.remove(); updateCompSum(); });
  subjCompList.appendChild(li);
}

function updateCompSum() {
  let sum = 0;
  subjCompList.querySelectorAll('.comp-max').forEach(i => { sum += Number(i.value) || 0; });
  const max = Number(subjMaxIn.value) || 0;
  subjCompSum.textContent = `مجموع المكوّنات: ${sum} / ${max}`;
  subjCompSum.classList.toggle('ok',  sum === max && max > 0);
  subjCompSum.classList.toggle('bad', sum !== max);
}

async function openSubjectModal(sub) {
  _editingSubjectId = sub?.id ?? null;
  subjModalTitle.textContent = sub ? 'تعديل مادة' : 'مادة جديدة';
  subjError.hidden = true;
  subjNameIn.value   = sub?.name ?? '';
  subjMaxIn.value    = sub?.max_total ?? 100;
  subjPassIn.value   = sub?.pass_mark ?? 40;
  subjArabicIn.checked = !!sub?.is_core_arabic;
  subjMathIn.checked   = !!sub?.is_core_math;
  subjFullMarksIn.checked = !!sub?.allow_full_marks;
  subjCompList.innerHTML = '';

  show(modalSubject);
  document.body.style.overflow = 'hidden';

  if (sub) {
    try {
      const comps = await NDB.getSubjectComponents(sub.id);
      if (comps.length) comps.forEach(c => addCompRow(c.name, c.max_mark));
      else addCompRow();
    } catch {
      addCompRow();
    }
  } else {
    // sensible starter components (the user can adjust per stage)
    addCompRow('مذاكرة', '');
    addCompRow('شفهي / وظائف', '');
    addCompRow('امتحان فصلي', '');
  }
  updateCompSum();
}

function closeSubjectModal() {
  hide(modalSubject);
  document.body.style.overflow = '';
}

btnCloseSubject.addEventListener('click', closeSubjectModal);
modalSubject.addEventListener('click', (e) => { if (e.target === modalSubject) closeSubjectModal(); });
btnAddComp.addEventListener('click', () => { addCompRow(); updateCompSum(); });

// Shortcut for subjects graded as one mark rather than مذاكرة / شفهي / امتحان —
// conduct-style subjects and activity subjects (PE, music, fine arts). Collapses
// the component list to a single row carrying the subject's whole max mark.
btnSubjSingle.addEventListener('click', () => {
  subjCompList.innerHTML = '';
  addCompRow(subjNameIn.value.trim() || 'الدرجة', Number(subjMaxIn.value) || 100);
  updateCompSum();
});

subjMaxIn.addEventListener('input', updateCompSum);
subjArabicIn.addEventListener('change', () => {
  // Convenience: Arabic parts pass at 50% by default.
  if (subjArabicIn.checked && (Number(subjPassIn.value) || 0) < 50) subjPassIn.value = 50;
});

btnSaveSubject.addEventListener('click', async () => {
  const name = subjNameIn.value.trim();
  const maxTotal = Number(subjMaxIn.value) || 0;
  const passMark = Number(subjPassIn.value);
  subjError.hidden = true;

  if (!name)        { subjError.textContent = 'يرجى إدخال اسم المادة'; show(subjError); return; }
  if (maxTotal <= 0){ subjError.textContent = 'العلامة العظمى غير صحيحة'; show(subjError); return; }
  if (!(passMark >= 0 && passMark <= 100)) { subjError.textContent = 'نسبة النجاح يجب أن تكون بين 0 و 100'; show(subjError); return; }

  const comps = [];
  subjCompList.querySelectorAll('.comp-row').forEach(row => {
    const n = row.querySelector('.comp-name').value.trim();
    const m = Number(row.querySelector('.comp-max').value) || 0;
    if (n) comps.push({ name: n, maxMark: m });
  });
  if (comps.length === 0) { subjError.textContent = 'أضف مكوّناً واحداً على الأقل'; show(subjError); return; }
  const compSum = comps.reduce((a, c) => a + c.maxMark, 0);
  if (compSum !== maxTotal) {
    subjError.textContent = `مجموع المكوّنات (${compSum}) يجب أن يساوي العلامة العظمى (${maxTotal})`;
    show(subjError); return;
  }

  btnSaveSubject.disabled = true;
  subjSaveLabel.hidden = true;
  subjSpinner.hidden = false;
  try {
    let subjectId = _editingSubjectId;
    if (subjectId) {
      await NDB.updateSubject(subjectId, {
        name, maxTotal, passMark,
        isCoreArabic: subjArabicIn.checked, isCoreMath: subjMathIn.checked,
        allowFullMarks: subjFullMarksIn.checked,
      });
    } else {
      subjectId = await NDB.createSubject({
        schoolId: S.school.id, grade: _subjGrade,
        name, maxTotal, passMark,
        isCoreArabic: subjArabicIn.checked, isCoreMath: subjMathIn.checked,
        allowFullMarks: subjFullMarksIn.checked,
      });
    }
    await NDB.setSubjectComponents(subjectId, comps);
    closeSubjectModal();
    toast('تم حفظ المادة', 'success');
    loadSubjects();
    refreshAssignSubjectsPicker();
  } catch (err) {
    console.error('[NSAMS] saveSubject', err);
    subjError.textContent = err?.message ?? 'تعذّر حفظ المادة';
    show(subjError);
  } finally {
    btnSaveSubject.disabled = false;
    subjSaveLabel.hidden = false;
    subjSpinner.hidden = true;
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  Custom Select — themed dropdown replacing the OS-native <select> popup.
//
//  Wraps a real <select> (kept in the DOM, visually hidden) with a styled
//  trigger + popup list built from <div>s. The native element stays the source
//  of truth: choosing an option sets select.value and fires `change` + `input`,
//  so all existing handlers keep working unchanged.
//
//  Dynamic lists: when script code repopulates a <select>'s <option>s, call
//  cs.refresh() (or CustomSelect.refresh(selectEl)) to rebuild the menu. We use
//  an explicit refresh — NOT a MutationObserver — for predictability.
//
//  External value changes (e.g. `rType.value = ''` on form reset) are picked up
//  via refresh() too; resetReportForm() calls it.
// ════════════════════════════════════════════════════════════════════════════
const CustomSelect = (() => {
  const registry = new WeakMap();   // native <select> -> instance

  class Instance {
    constructor(select) {
      this.select = select;
      this.open = false;

      // If the select sits in a .select-wrap (it has its own SVG arrow), hide
      // that arrow — the custom trigger draws its own.
      const wrapArrow = select.parentElement?.querySelector?.('.select-arrow');
      if (wrapArrow) wrapArrow.style.display = 'none';

      // Build trigger + menu.
      this.root = document.createElement('div');
      this.root.className = 'csel';

      this.trigger = document.createElement('button');
      this.trigger.type = 'button';
      this.trigger.className = 'csel-trigger';
      this.trigger.setAttribute('aria-haspopup', 'listbox');
      this.trigger.setAttribute('aria-expanded', 'false');
      if (select.id) this.trigger.setAttribute('aria-labelledby', `${select.id}-label`);

      this.label = document.createElement('span');
      this.label.className = 'csel-label';

      const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chev.setAttribute('class', 'csel-chevron');
      chev.setAttribute('viewBox', '0 0 24 24');
      chev.innerHTML = '<polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';

      this.trigger.append(this.label, chev);

      this.menu = document.createElement('div');
      this.menu.className = 'csel-menu';
      this.menu.setAttribute('role', 'listbox');
      this.menu.hidden = true;

      this.root.append(this.trigger, this.menu);

      // Insert custom UI right after the (hidden) native select.
      select.classList.add('csel-native');
      select.parentElement.insertBefore(this.root, select.nextSibling);

      // Events.
      this.trigger.addEventListener('click', (e) => { e.preventDefault(); this.toggle(); });
      this.onDocClick = (e) => { if (!this.root.contains(e.target)) this.close(); };
      this.trigger.addEventListener('keydown', (e) => this.onKeydown(e));

      this.refresh();
    }

    buildMenu() {
      this.menu.innerHTML = '';
      const opts = Array.from(this.select.options);
      opts.forEach((opt) => {
        const item = document.createElement('div');
        item.className = 'csel-option';
        item.setAttribute('role', 'option');
        item.textContent = opt.textContent;
        item.dataset.value = opt.value;
        if (opt.disabled) item.classList.add('is-disabled');
        if (opt.value === this.select.value) {
          item.classList.add('is-selected');
          item.setAttribute('aria-selected', 'true');
        }
        if (!opt.disabled) {
          item.addEventListener('click', () => this.choose(opt.value));
        }
        this.menu.appendChild(item);
      });
    }

    syncLabel() {
      const sel = this.select.options[this.select.selectedIndex];
      this.label.textContent = sel ? sel.textContent : '';
      // Dim the label when the placeholder (empty value) is selected.
      this.label.classList.toggle('is-placeholder', !sel || sel.value === '');
    }

    choose(value) {
      if (this.select.value !== value) {
        this.select.value = value;
        // Fire the same events a real user selection would.
        this.select.dispatchEvent(new Event('input',  { bubbles: true }));
        this.select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      this.syncLabel();
      this.buildMenu();
      this.close();
      this.trigger.focus();
    }

    toggle() { this.open ? this.close() : this.openMenu(); }

    openMenu() {
      if (this.select.disabled) return;
      this.buildMenu();
      this.menu.hidden = false;
      this.open = true;
      this.trigger.setAttribute('aria-expanded', 'true');
      this.root.classList.add('is-open');
      document.addEventListener('click', this.onDocClick);
      // Scroll the selected option into view.
      const sel = this.menu.querySelector('.is-selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    close() {
      if (!this.open) return;
      this.menu.hidden = true;
      this.open = false;
      this.trigger.setAttribute('aria-expanded', 'false');
      this.root.classList.remove('is-open');
      document.removeEventListener('click', this.onDocClick);
    }

    onKeydown(e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (!this.open) { this.openMenu(); return; }
      }
      if (e.key === 'Escape' && this.open) { e.preventDefault(); this.close(); this.trigger.focus(); }
    }

    // Rebuild after the native <select>'s options or value changed externally.
    refresh() {
      this.syncLabel();
      this.buildMenu();
      // Reflect disabled state on the trigger.
      this.trigger.disabled = this.select.disabled;
      this.trigger.classList.toggle('is-disabled', this.select.disabled);
    }
  }

  function enhance(selectOrId) {
    const select = typeof selectOrId === 'string' ? el(selectOrId) : selectOrId;
    if (!select) return null;
    if (registry.has(select)) return registry.get(select);
    const inst = new Instance(select);
    registry.set(select, inst);
    return inst;
  }

  function refresh(selectOrId) {
    const select = typeof selectOrId === 'string' ? el(selectOrId) : selectOrId;
    const inst = select && registry.get(select);
    if (inst) inst.refresh();
  }

  return { enhance, refresh };
})();

// ═══════════════════════════════════════════════════════════════════════════
// Workflow requests tab (الطلبات)  — replaces the old المواد tab
// ═══════════════════════════════════════════════════════════════════════════
let _subjectsLoaded = false;   // kept for the tab lazy-load guard (tab name = 'subjects')

const REQ_TYPE_LABELS = {
  add_class:       'إضافة شعبة',
  add_student:     'تسجيل طالب',
  correct_student: 'تصحيح بيانات',
};
const REQ_STATUS_LABELS = {
  pending:  'بانتظار المديرية',
  approved: 'مقبول ✓',
  rejected: 'مرفوض ✗',
};
const REQ_STATUS_CLASS = { pending: 'req-status--pending', approved: 'req-status--approved', rejected: 'req-status--rejected' };

function gradeNameLabel(grade) {
  return (typeof NDB.gradeNameAr === 'function') ? `الصف ${NDB.gradeNameAr(grade)}` : `الصف ${grade}`;
}

async function initSubjectsTab() {
  if (!S.school?.id) return;
  _subjectsLoaded = true;
  // populate grade dropdowns with grades 1-12
  ['req-class-grade'].forEach(id => {
    const sel = el(id);
    if (!sel || sel.childElementCount > 1) return;
    for (let g = 1; g <= 12; g++) {
      const opt = document.createElement('option');
      opt.value = String(g);
      opt.textContent = gradeNameLabel(g);
      sel.appendChild(opt);
    }
    CustomSelect.refresh(sel);
  });
  // populate class dropdowns for add_student and correct_student
  try {
    const classes = await NDB.getSchoolClasses(S.school.id);
    ['req-stu-class', 'req-cor-class'].forEach(id => {
      const sel = el(id);
      if (!sel) return;
      classes.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name || gradeNameLabel(c.grade) + (c.section ? ` / شعبة ${c.section}` : '');
        sel.appendChild(opt);
      });
      CustomSelect.refresh(sel);
    });
  } catch (e) {
    console.warn('[Requests] could not load classes', e);
  }
  loadRequests();
}

// When correct_student class changes → load students for that class
el('req-cor-class')?.addEventListener('change', async function () {
  const stuSel = el('req-cor-student');
  stuSel.innerHTML = '<option value="">— اختر الطالب —</option>';
  stuSel.disabled = true;
  CustomSelect.refresh(stuSel);
  if (!this.value) return;
  try {
    const students = await NDB.getClassStudents(this.value);
    students.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.fullName ?? s.full_name ?? s.id;
      stuSel.appendChild(opt);
    });
    stuSel.disabled = false;
    CustomSelect.refresh(stuSel);
  } catch (e) { console.warn('[Requests] load students', e); }
});

// Show / hide dynamic fields based on request type
el('req-type-select')?.addEventListener('change', function () {
  ['req-fields-add-class', 'req-fields-add-student', 'req-fields-correct-stu'].forEach(id => {
    const el2 = el(id); if (el2) el2.hidden = true;
  });
  el('btn-send-req').disabled = !this.value;
  if (this.value === 'add_class')       { el('req-fields-add-class').hidden    = false; }
  if (this.value === 'add_student')     { el('req-fields-add-student').hidden  = false; }
  if (this.value === 'correct_student') { el('req-fields-correct-stu').hidden  = false; }
});

el('btn-send-req')?.addEventListener('click', submitRequest);

async function submitRequest() {
  const type    = el('req-type-select').value;
  const msgEl   = el('req-submit-msg');
  const btn     = el('btn-send-req');
  if (!type) return;

  let payload = {};
  let validationErr = '';

  if (type === 'add_class') {
    const grade   = el('req-class-grade').value;
    const section = el('req-class-section').value.trim();
    if (!grade)   validationErr = 'اختر الصف';
    if (!section) validationErr = 'أدخل رمز الشعبة';
    payload = { grade: Number(grade), section, note: el('req-class-note')?.value.trim() ?? '' };
  } else if (type === 'add_student') {
    const classId    = el('req-stu-class').value;
    const first_name = el('req-stu-first').value.trim();
    const father_name= el('req-stu-father').value.trim();
    const family_name= el('req-stu-family').value.trim();
    if (!classId)    validationErr = 'اختر الصف';
    else if (!first_name || !father_name || !family_name) validationErr = 'الاسم الثلاثي مطلوب';
    payload = {
      class_id: classId, first_name, father_name, family_name,
      gender:     el('req-stu-gender').value,
      national_id:el('req-stu-nid').value.trim(),
      birth_date: (() => {
        const d = el('req-stu-dob-day')?.value, m = el('req-stu-dob-month')?.value, y = el('req-stu-dob-year')?.value;
        return (y && m && d) ? `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : '';
      })(),
    };
  } else if (type === 'correct_student') {
    const studentId = el('req-cor-student').value;
    const field     = el('req-cor-field').value;
    const value     = el('req-cor-value').value.trim();
    if (!studentId) validationErr = 'اختر الطالب';
    else if (!field)  validationErr = 'اختر الحقل المراد تصحيحه';
    else if (!value)  validationErr = 'أدخل القيمة الجديدة';
    payload = {
      student_id: studentId, [field]: value,
      reason: el('req-cor-reason')?.value.trim() ?? '',
    };
  }

  if (validationErr) {
    msgEl.className = 'msg msg-error'; msgEl.textContent = validationErr; show(msgEl); return;
  }

  btn.disabled = true;
  msgEl.hidden = true;
  try {
    await NDB.createSchoolRequest(S.school.id, S.school.directorate_id, type, payload);
    msgEl.className = 'msg msg-success';
    msgEl.textContent = 'تم إرسال الطلب — ستُبلَّغ بالنتيجة عند مراجعة المديرية.';
    show(msgEl);
    // reset form
    el('req-type-select').value = '';
    CustomSelect.refresh(el('req-type-select'));
    ['req-fields-add-class','req-fields-add-student','req-fields-correct-stu']
      .forEach(id => { const e = el(id); if (e) e.hidden = true; });
    loadRequests();
  } catch (err) {
    console.error('[Requests] submit', err);
    msgEl.className = 'msg msg-error'; msgEl.textContent = err?.message ?? 'تعذّر إرسال الطلب'; show(msgEl);
  } finally {
    btn.disabled = false;
  }
}

async function loadRequests() {
  const listEl   = el('req-list');
  const loadEl   = el('req-list-loading');
  const emptyEl  = el('req-list-empty');
  if (!listEl) return;
  show(loadEl); listEl.innerHTML = ''; hide(emptyEl);
  try {
    const reqs = await NDB.getSchoolRequests(S.school.id);
    hide(loadEl);
    if (!reqs.length) { show(emptyEl); return; }
    reqs.forEach(r => listEl.appendChild(buildRequestCard(r)));
  } catch (err) {
    console.error('[Requests] load', err);
    hide(loadEl);
    toast('تعذّر تحميل الطلبات', 'error');
  }
}

function buildRequestCard(r) {
  const li = document.createElement('li');
  li.className = 'req-card';
  const date = r.created_at ? new Date(r.created_at).toLocaleDateString('ar-SY', { day:'numeric', month:'short', year:'numeric' }) : '';
  const statusLabel = REQ_STATUS_LABELS[r.status] ?? r.status;
  const statusClass = REQ_STATUS_CLASS[r.status]  ?? '';
  const typeLabel   = REQ_TYPE_LABELS[r.type]   ?? r.type;
  const reasonHtml  = (r.status === 'rejected' && r.review_reason)
    ? `<div class="req-reason">السبب: ${escapeHtml(r.review_reason)}</div>` : '';
  li.innerHTML = `
    <div class="req-card-hdr">
      <span class="req-type-label">${escapeHtml(typeLabel)}</span>
      <span class="req-status ${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</span>
    </div>
    <div class="req-date">${escapeHtml(date)}</div>
    ${reasonHtml}
  `;
  return li;
}

el('btn-refresh-requests')?.addEventListener('click', loadRequests);

// ═══════════════════════════════════════════════════════════════════════════
// Report cards (الشهادات)
// ═══════════════════════════════════════════════════════════════════════════
const repClassSelect    = el('rep-class-select');
const repTermSelect     = el('rep-term-select');
const repLoading        = el('rep-loading');
const repListEl         = el('rep-list');
const repEmpty          = el('rep-empty');
const btnPrintAll       = el('btn-print-all');
const btnRefreshReports = el('btn-refresh-reports');
const btnPromoteClass   = el('btn-promote-class');
const repMinAtt         = el('rep-minatt');
const btnSaveMinAtt     = el('btn-save-minatt');
const modalGrace        = el('modal-grace');
const graceList         = el('grace-list');
const graceTotalIn      = el('grace-total');
const graceStudentEl    = el('grace-student');
const graceSummaryEl    = el('grace-summary');
const graceErrorEl      = el('grace-error');
const btnCloseGrace     = el('btn-close-grace');
const btnSaveGrace      = el('btn-save-grace');

let _reportsLoaded = false;
let _repData       = null;

// Minimum-attendance setting: prefill from the loaded school, save on demand.
function syncMinAttField() {
  if (repMinAtt && S.school) repMinAtt.value = S.school.minAttendancePct ?? 75;
}
btnSaveMinAtt?.addEventListener('click', async () => {
  const v = Number(repMinAtt.value);
  if (!(v >= 0 && v <= 100)) { toast('النسبة يجب أن تكون بين 0 و 100', 'error'); return; }
  btnSaveMinAtt.disabled = true;
  try {
    await NDB.updateSchool(S.school.id, { minAttendancePct: v });
    S.school.minAttendancePct = v;
    toast('تم حفظ الحد الأدنى للدوام', 'success');
    if (repClassSelect.value) loadReports(repClassSelect.value);
  } catch (err) {
    console.error('[NSAMS] saveMinAtt', err);
    toast('تعذّر حفظ الإعداد', 'error');
  } finally {
    btnSaveMinAtt.disabled = false;
  }
});

function currentTerm() {
  return repTermSelect.value === 's1' ? 's1' : 'year';
}

async function initReportsTab() {
  if (!S.school?.id) return;
  try {
    const classes = await NDB.getSchoolClasses(S.school.id);
    repClassSelect.innerHTML = '<option value="">— اختر صفاً —</option>';
    for (const c of classes) {
      const label = c.name || `${gradeNameLabel(c.grade)} / ${c.section ?? ''}`.trim();
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = label;
      repClassSelect.appendChild(opt);
    }
    CustomSelect.refresh(repClassSelect);
    syncMinAttField();
    _reportsLoaded = true;
  } catch (err) {
    console.error('[NSAMS] initReportsTab', err);
    toast('تعذّر تحميل قائمة الصفوف', 'error');
  }
}

repClassSelect.addEventListener('change', () => {
  const id = repClassSelect.value;
  if (id) loadReports(id);
  else { repListEl.innerHTML = ''; repEmpty.hidden = true; hide(btnPrintAll); hide(btnPromoteClass); }
});
repTermSelect.addEventListener('change', () => { if (repClassSelect.value) loadReports(repClassSelect.value); });
btnRefreshReports.addEventListener('click', () => { if (repClassSelect.value) loadReports(repClassSelect.value); });

btnPromoteClass?.addEventListener('click', async () => {
  const classId = repClassSelect.value;
  if (!classId || !_repData) return;
  const cards = _repData.students || [];
  const incomplete = cards.filter(c => !c.complete);
  if (incomplete.length > 0) {
    toast(`${incomplete.length} طالب لم تكتمل نتائجه — يجب إدخال كل الدرجات أولاً`, 'error');
    return;
  }
  if (!await askConfirm(`تأكيد تنفيذ الترفيع السنوي لـ ${cards.length} طالب؟ هذا الإجراء لا يمكن التراجع عنه.`, 'ترفيع')) return;

  btnPromoteClass.disabled = true;
  btnPromoteClass.textContent = 'جارٍ الترفيع…';
  try {
    // 1. حفظ النتائج server-side
    const yearResults = cards.map(c => ({
      student_id:    c.student.id,
      academic_year: _repData.academicYear,
      result:        c.result,
      final_percent: c.finalPercent ?? null,
    }));
    await NDB.upsertYearResults(classId, yearResults);
    // 2. تنفيذ الترفيع
    const summary = await NDB.executeAnnualPromotion(classId);
    const s = summary || {};
    toast(
      `الترفيع اكتمل: ترقّى ${s.promoted ?? 0}، أعاد ${s.repeated ?? 0}، تخرّج ${s.graduated ?? 0}` +
      (s.skipped ? `، تجاوزنا ${s.skipped} (نتائج ناقصة)` : ''),
      'success',
    );
    // إعادة تحميل قائمة الصفوف بعد الترفيع (الصف الحالي قد يكون فارغاً الآن)
    await initReportsTab();
    repListEl.innerHTML = '';
    repEmpty.hidden = false;
    hide(btnPrintAll);
    hide(btnPromoteClass);
  } catch (err) {
    console.error('[NSAMS] promote', err);
    toast('تعذّر تنفيذ الترفيع: ' + (err.message || String(err)), 'error');
  } finally {
    btnPromoteClass.disabled = false;
    btnPromoteClass.textContent = 'تنفيذ الترفيع السنوي للصف';
  }
});

async function loadReports(classId) {
  show(repLoading);
  repListEl.innerHTML = '';
  repEmpty.hidden = true;
  hide(btnPrintAll);
  hide(btnPromoteClass);
  try {
    _repData = await NDB.getClassReportCards(classId, undefined, currentTerm());
    hide(repLoading);
    if (_repData?.minAttendancePct != null && S.school) {
      S.school.minAttendancePct = _repData.minAttendancePct;
      syncMinAttField();
    }
    const cards = _repData.students || [];
    if (cards.length === 0) { repEmpty.hidden = false; hide(el('rs-block')); return; }
    cards.forEach((card, i) => repListEl.appendChild(buildReportRow(card, i + 1)));
    show(btnPrintAll);
    // زر الترفيع يظهر فقط عند شهادة السنة وكل الطلاب مكتملون
    if (currentTerm() === 'year' && cards.length > 0 && cards.every(c => c.complete)) {
      show(btnPromoteClass);
    }
    // كتلة الجلاء (اعتماد المديرية) — تظهر دائماً عند وجود طلاب
    await _loadResultSheetStatus(classId);
  } catch (err) {
    console.error('[NSAMS] loadReports', err);
    hide(repLoading);
    toast(gradesErr(err, 'تعذّر تحميل النتائج'), 'error');
  }
}

// ── الجلاء (result_sheets): حالة + إرسال للمديرية ─────────────────────────────
async function _loadResultSheetStatus(classId) {
  const block = el('rs-block');
  if (!block) return;
  show(block);
  try {
    const st = await NDB.getResultSheet(classId, _repData.academicYear, currentTerm());
    _renderResultSheetStatus(st);
  } catch (err) {
    console.warn('[NSAMS] getResultSheet', err);
    _renderResultSheetStatus(null);
  }
}

function _renderResultSheetStatus(st) {
  const banner = el('rs-status-banner');
  const btn    = el('btn-submit-result-sheet');
  const label  = el('rs-submit-label');
  const status = st?.status || 'none';
  const map = {
    none:      { cls: 'stmt-status--draft',     txt: 'لم يُرسَل الجلاء بعد — يمكنك إرساله للمديرية للاعتماد.' },
    draft:     { cls: 'stmt-status--draft',     txt: 'مسودة — لم يُرسَل بعد.' },
    submitted: { cls: 'stmt-status--submitted', txt: 'مُرسَل للمديرية — بانتظار المراجعة.' },
    approved:  { cls: 'stmt-status--approved',  txt: 'معتمد من المديرية — بانتظار الإصدار النهائي.' },
    issued:    { cls: 'stmt-status--approved',  txt: 'صدر الجلاء نهائياً ✓ (غير قابل للتعديل)' },
    rejected:  { cls: 'stmt-status--rejected',  txt: 'رُفض الجلاء' + (st?.notes ? ' — ' + st.notes : '') },
  };
  const m = map[status] || map.none;
  if (banner) { banner.className = 'stmt-status-banner ' + m.cls; banner.textContent = m.txt; banner.hidden = false; }
  if (btn) {
    const locked = (status === 'submitted' || status === 'approved' || status === 'issued');
    btn.disabled = locked;
    if (label) label.textContent = status === 'rejected' ? 'إعادة إرسال الجلاء للمديرية' : 'إرسال الجلاء للمديرية';
  }
}

el('btn-submit-result-sheet')?.addEventListener('click', async () => {
  const classId = repClassSelect.value;
  if (!classId || !_repData) return;
  const cards = _repData.students || [];
  const incomplete = cards.filter(c => !c.complete);
  if (currentTerm() === 'year' && incomplete.length > 0) {
    toast(`${incomplete.length} طالب لم تكتمل نتائجه — أكمل الدرجات قبل إرسال الجلاء`, 'error');
    return;
  }
  if (!await askConfirm('إرسال الجلاء للمديرية؟ لن يمكن تعديله حتى تُراجعه المديرية.', 'إرسال')) return;

  const btn = el('btn-submit-result-sheet');
  const spinner = el('rs-submit-spinner');
  const errEl = el('rs-error');
  if (btn) btn.disabled = true;
  if (spinner) spinner.hidden = false;
  hide(errEl);
  try {
    // اللقطة = نتائج getClassReportCards مُقلَّمة (دون كائنات ثقيلة).
    const snapshot = {
      academicYear: _repData.academicYear,
      term:         currentTerm(),
      classLabel:   _repData.class ? `${gradeLabel(_repData.class.grade)} / ${_repData.class.section ?? ''}`.trim() : '',
      generatedAt:  new Date().toISOString(),
      students: cards.map(c => ({
        studentId:    c.student?.id,
        name:         c.student?.full_name,
        finalPercent: c.finalPercent ?? null,
        // المعدّل قبل المساعدة + مجموع المساعدة، لترى المديرية أساس النتيجة
        finalPercentNoGrace: c.finalPercentNoGrace ?? null,
        graceMarks:   (Number(c.graceSubjects) || 0) + (Number(c.graceTotal) || 0),
        result:       c.result ?? null,
        complete:     !!c.complete,
        conductMark:  c.conductMark ?? null,
        attendancePercent: c.attendancePercent ?? null,
      })),
    };
    await NDB.submitResultSheet(classId, schoolId(), _repData.academicYear, currentTerm(), snapshot);
    toast('أُرسل الجلاء للمديرية ✓', 'success');
    await _loadResultSheetStatus(classId);
  } catch (err) {
    console.error('[NSAMS] submitResultSheet', err);
    if (errEl) { errEl.textContent = 'تعذّر إرسال الجلاء — ' + (err?.message || err); show(errEl); }
    if (btn) btn.disabled = false;
  } finally {
    if (spinner) spinner.hidden = true;
  }
});

function resultBadge(card) {
  if (!card.complete) return { cls: 'pending', text: 'غير مكتمل' };
  if (card.result === 'ناجح')  return { cls: 'pass', text: 'ناجح' };
  return { cls: 'fail', text: 'راسب' };
}

function fmtNum(n) {
  return (n == null) ? '—' : String(Math.round(n * 10) / 10);
}

function buildReportRow(card, num) {
  const li = document.createElement('li');
  li.className = 'rep-row';
  const term = currentTerm();
  // Year certificate shows the verdict badge; the first-semester certificate
  // shows marks + average only (just «غير مكتمل» when sem1 marks are missing).
  let badgeHtml = '';
  if (term === 's1') {
    if (!card.complete) badgeHtml = `<span class="rep-badge pending">غير مكتمل</span>`;
  } else {
    const b = resultBadge(card);
    badgeHtml = `<span class="rep-badge ${b.cls}">${b.text}</span>`;
  }
  // Year cards show attendance % and (for grades 7+) conduct as small meta tags.
  const band = _repData?.band;
  let metaHtml = '';
  if (term !== 's1') {
    const att = card.attendancePercent;
    if (band === 'B' || band === 'C') {
      const attFail = att != null && att < (_repData.minAttendancePct ?? 75);
      metaHtml += `<span class="rep-meta-tag${attFail ? ' bad' : ''}">دوام ${att == null ? '—' : fmtNum(att) + '٪'}</span>`;
    }
    if (band === 'C') {
      const cFail = card.conductMark == null || card.conductMark < 60;
      metaHtml += `<span class="rep-meta-tag${cFail ? ' bad' : ''}">سلوك ${card.conductMark == null ? '—' : fmtNum(card.conductMark)}</span>`;
    }
  }
  // Grace-marks tool: only for grade bands that use it, on the year certificate.
  const showGrace = term !== 's1' && (band === 'B' || band === 'C');
  const graceBtn = showGrace
    ? `<button class="icon-btn-sm" data-act="grace" aria-label="درجات المساعدة">
         <svg class="icon icon-sm"><use href="#ic-award"/></svg>
       </button>`
    : '';

  li.innerHTML = `
    <div class="rep-row-head">
      <span class="student-num" style="min-width:24px;color:#94A3B8;font-weight:600">${num}</span>
      <div class="rep-info">
        <div class="rep-name">${escapeHtml(card.student.full_name)}</div>
        ${metaHtml ? `<div class="rep-meta">${metaHtml}</div>` : ''}
      </div>
    </div>
    <div class="rep-row-controls">
      <span class="rep-pct">${card.finalPercent == null ? '—' : fmtNum(card.finalPercent) + '٪'}</span>
      ${badgeHtml}
      ${graceBtn}
      <button class="icon-btn-sm" data-act="print" aria-label="تصدير الشهادة">
        <svg class="icon icon-sm"><use href="#ic-printer"/></svg>
      </button>
    </div>
  `;
  li.querySelector('[data-act="print"]').addEventListener('click', () => {
    const win = window.open('', '_blank');
    if (!win) { toast('فعّل النوافذ المنبثقة لتتمكّن من التصدير', 'warning'); return; }
    printReportDoc(win, [card], term);
  });
  const gBtn = li.querySelector('[data-act="grace"]');
  if (gBtn) gBtn.addEventListener('click', () => openGraceModal(card));
  return li;
}

btnPrintAll.addEventListener('click', () => {
  if (!_repData?.students?.length) return;
  const win = window.open('', '_blank');
  if (!win) { toast('فعّل النوافذ المنبثقة لتتمكّن من التصدير', 'warning'); return; }
  printReportDoc(win, _repData.students, currentTerm());
});

function classDisplay() {
  const c = _repData?.class;
  if (!c) return '';
  return `${gradeNameLabel(c.grade)} / شعبة ${c.section ?? ''}`.trim();
}

function ordinalAr(n) {
  const words = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس',
                 'السابع', 'الثامن', 'التاسع', 'العاشر'];
  return words[n] || ('الـ ' + n);
}

function reportCardHtml(card, term) {
  const isS1 = term === 's1';
  const st   = card.student || {};
  const info = _repData || {};
  const cls  = info.class || {};
  const g    = (v) => fmtNum(v);                 // رقم أو —
  const vh   = (t) => '<th class="vh"><span>' + t + '</span></th>';

  // ── صناديق معلومات الطالب ──
  const box = (k, v, wide) =>
    '<div class="rc-cell' + (wide ? ' wide' : '') + '">' +
      '<div class="rc-k">' + k + '</div>' +
      '<div class="rc-v">' + escapeHtml(v == null || v === '' ? '' : String(v)) + '</div>' +
    '</div>';
  const infoGrid =
    '<div class="rc-info">' +
      box('المديرية', info.directorate) +
      box('المجمّع', S.school?.complex_name) +
      box('المدرسة', S.school?.name) +
      box('الصف', gradeNameLabel(cls.grade)) +
      box('الشعبة', cls.section) +
      box('اسم الطالب', st.full_name, true) +
      box('اسم الأم', st.mother_name) +
      box('تاريخ الميلاد', st.birth_date) +
      box('مكان الميلاد', st.birth_place) +
      box('الرقم في السجل العام', st.card_number) +
    '</div>';

  // ── جدول الدرجات ──
  // الصفوف ١–٤: لا تُفصل درجة الأعمال — تُعرض 0 وتوضع العلامة كلها في الامتحان.
  const gradeNum  = parseInt(cls.grade, 10);
  const earlyGrade = gradeNum >= 1 && gradeNum <= 4;
  const workOf = (total, work) => earlyGrade ? (total == null ? null : 0) : work;
  const examOf = (total, exam) => earlyGrade ? total : exam;
  // «العظمى / المحصّل» مثل 100 / 93
  const outOf = (max, mark) => g(max) + ' / ' + g(mark);
  // مجاميع الأعمدة لصفّ «المجموع»
  const T = { min:0, max:0, w1:0, e1:0, t1:0, w2:0, e2:0, t2:0, avg:0 };
  card.subjects.forEach(s => {
    T.min += Number(s.passMark) || 0;
    T.max += Number(s.maxTotal) || 0;
    T.w1  += Number(workOf(s.sem1, s.sem1Work)) || 0;
    T.e1  += Number(examOf(s.sem1, s.sem1Exam)) || 0;
    T.t1  += Number(s.sem1) || 0;
    T.w2  += Number(workOf(s.sem2, s.sem2Work)) || 0;
    T.e2  += Number(examOf(s.sem2, s.sem2Exam)) || 0;
    T.t2  += Number(s.sem2) || 0;
    T.avg += Number(s.mark) || 0;
  });

  let colgroup, thead, rows, tfoot;
  if (isS1) {
    colgroup = '<colgroup><col class="c-sub"><col class="c-mm"><col class="c-mm">' +
      '<col class="c-g"><col class="c-g"><col class="c-g"></colgroup>';
    thead = '<tr><th class="h-sub">المادة</th>' +
      vh('الدرجة الدنيا') + vh('الدرجة العظمى') +
      vh('درجة الأعمال') + vh('درجة الامتحان') + vh('المحصلة') + '</tr>';
    rows = card.subjects.map(s =>
      '<tr' + (s.passed === false ? ' class="fail"' : '') + '>' +
        '<td class="subject">' + escapeHtml(s.name) + '</td>' +
        '<td>' + g(s.passMark) + '</td><td>' + g(s.maxTotal) + '</td>' +
        '<td>' + g(workOf(s.sem1, s.sem1Work)) + '</td><td>' + g(examOf(s.sem1, s.sem1Exam)) + '</td><td>' + g(s.sem1) + '</td>' +
      '</tr>'
    ).join('');
    tfoot = '<tr class="rc-sum"><td class="subject">المجموع</td>' +
      '<td>' + g(T.min) + '</td><td>' + g(T.max) + '</td>' +
      '<td>' + g(T.w1) + '</td><td>' + g(T.e1) + '</td><td>' + g(T.t1) + '</td></tr>';
  } else {
    colgroup = '<colgroup><col class="c-sub"><col class="c-mm"><col class="c-mm">' +
      '<col class="c-g"><col class="c-g"><col class="c-g">' +
      '<col class="c-g"><col class="c-g"><col class="c-g">' +
      '<col class="c-avg"><col class="c-res"></colgroup>';
    thead = '<tr>' +
        '<th class="h-sub" rowspan="2">المادة</th>' +
        '<th class="vh" rowspan="2"><span>الدرجة الدنيا</span></th>' +
        '<th class="vh" rowspan="2"><span>الدرجة العظمى</span></th>' +
        '<th colspan="3">الفصل الأول</th>' +
        '<th colspan="3">الفصل الثاني</th>' +
        '<th class="vh" rowspan="2"><span>المعدّل</span></th>' +
        '<th class="h-res" rowspan="2">النتيجة</th>' +
      '</tr>' +
      '<tr class="sub">' +
        vh('الأعمال') + vh('الامتحان') + vh('المحصلة') +
        vh('الأعمال') + vh('الامتحان') + vh('المحصلة') +
      '</tr>';
    rows = card.subjects.map(s => {
      const verdict = s.passed == null ? '—' : (s.passed ? 'ناجح' : 'راسب');
      return '<tr' + (s.passed === false ? ' class="fail"' : '') + '>' +
        '<td class="subject">' + escapeHtml(s.name) + '</td>' +
        '<td>' + g(s.passMark) + '</td><td>' + g(s.maxTotal) + '</td>' +
        '<td>' + g(workOf(s.sem1, s.sem1Work)) + '</td><td>' + g(examOf(s.sem1, s.sem1Exam)) + '</td><td>' + g(s.sem1) + '</td>' +
        '<td>' + g(workOf(s.sem2, s.sem2Work)) + '</td><td>' + g(examOf(s.sem2, s.sem2Exam)) + '</td><td>' + g(s.sem2) + '</td>' +
        '<td>' + outOf(s.maxTotal, s.mark) + '</td><td>' + verdict + '</td>' +
      '</tr>';
    }).join('');
    tfoot = '<tr class="rc-sum"><td class="subject">المجموع</td>' +
      '<td>' + g(T.min) + '</td><td>' + g(T.max) + '</td>' +
      '<td>' + g(T.w1) + '</td><td>' + g(T.e1) + '</td><td>' + g(T.t1) + '</td>' +
      '<td>' + g(T.w2) + '</td><td>' + g(T.e2) + '</td><td>' + g(T.t2) + '</td>' +
      '<td>' + outOf(T.max, T.avg) + '</td><td></td></tr>';
  }

  // ── النتيجة النهائية ──
  const pct = card.finalPercent == null ? '—' : fmtNum(card.finalPercent) + '٪';
  let finalRow;
  if (isS1) {
    finalRow = '<div class="rc-final-row">' +
      '<div class="rc-final-box"><span>معدّل الفصل الأول</span><b>' + pct + '</b></div></div>';
  } else {
    const b = resultBadge(card);
    const col = b.cls === 'pass' ? '#059669' : (b.cls === 'fail' ? '#dc2626' : '#64748b');
    finalRow = '<div class="rc-final-row">' +
      '<div class="rc-final-box"><span>النسبة النهائية</span><b>' + pct + '</b></div>' +
      '<div class="rc-final-box"><span>النتيجة النهائية</span><b style="color:' + col + '">' + b.text + '</b></div>' +
    '</div>';
  }

  // ── سطر إضافي: ترتيب الطالب + ملخّص الدوام والسلوك (للسنة الكاملة فقط) ──
  let extraRow = '';
  if (!isS1) {
    let rankTxt = '—';
    // الترتيب يُحسب على المعدّل قبل درجات المساعدة — «لا تدخل درجات المساعدة
    // المضافة على المواد أو المجموع في حساب ترتيب النجاح».
    const rankPct = (c) => (c.finalPercentNoGrace != null ? c.finalPercentNoGrace : c.finalPercent);
    const myRankPct = rankPct(card);
    if (myRankPct != null) {
      // ترتيب تنافسي: ١ + عدد الطلاب الأعلى معدّلاً (المتساوون يتشاركون الرتبة)
      const higher = (info.students || [])
        .filter(c => rankPct(c) != null && rankPct(c) > myRankPct).length;
      rankTxt = ordinalAr(higher + 1);
    }
    const att     = card.attendancePercent == null ? '—' : fmtNum(card.attendancePercent) + '٪';
    const conduct = card.conductMark == null ? '—' : fmtNum(card.conductMark);
    // درجات المساعدة تُسجَّل على الجلاء (تُسجَّل في السجل العام ويُعلَم ولي الأمر)
    const graceSum = (Number(card.graceSubjects) || 0) + (Number(card.graceTotal) || 0);
    const graceLine = graceSum > 0
      ? '<div>درجات المساعدة: <b>' + fmtNum(graceSum) + '</b></div>' : '';
    extraRow = '<div class="rc-extra">' +
      graceLine +
      '<div>الترتيب في الصف: <b>' + rankTxt + '</b></div>' +
      '<div>الدوام: <b>' + att + '</b> &nbsp;·&nbsp; السلوك: <b>' + conduct + '</b></div>' +
    '</div>';
  }

  // ── رمز التحقّق QR (يُولَّد محليّاً بلا إنترنت) ──
  // يحمل رابط صفحة التحقّق العامّة: مسحه يفتح ملخّص الشهادة من قاعدة البيانات.
  let qrHtml = '';
  try {
    if (typeof window !== 'undefined' && typeof window.qrcode === 'function') {
      const base   = new URL('../verify.html', location.href).href;
      const verify = base + '?t=' + encodeURIComponent(card.student?.id || '') +
                            '&y=' + encodeURIComponent(info.academicYear || '');
      const q = window.qrcode(0, 'M');
      q.addData(verify);
      q.make();
      qrHtml = '<div class="rc-qr">' +
        q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }) +
        '<div class="rc-qr-cap">للتحقّق</div></div>';
    }
  } catch (_) { /* بلا رمز إن تعذّر التوليد */ }

  // ── التذييل: مدير المدرسة + الختم + QR + التاريخ ──
  const principal = escapeHtml(S.user?.user?.fullName || '');
  const foot = '<div class="rc-foot">' +
    '<div class="rc-sign"><div class="r">مدير المدرسة</div><div class="n">' + principal + '</div></div>' +
    '<div class="rc-stamp">ختم المدرسة</div>' +
    qrHtml +
    '<div class="rc-sign"><div class="r">تاريخ الإصدار</div><div class="n">' +
      new Date().toLocaleDateString('ar-SY') + '</div></div>' +
  '</div>';

  const subtitle = (isS1 ? 'شهادة الفصل الأول — ' : '') + 'العام الدراسي ' + escapeHtml(info.academicYear || '');

  return '<section class="card-page">' +
    '<img class="rc-wm" src="%%WM%%" alt="">' +
    '<div class="rc-body">' +
      '<div class="rc-head">' + '%%LOGO%%' +
        '<div class="rc-titles">' +
          '<div class="rc-country">الجمهورية العربية السورية</div>' +
          '<div class="rc-ministry">وزارة التربية والتعليم</div>' +
          '<h1>الجلاء المدرسي</h1>' +
          '<div class="rc-year">' + subtitle + '</div>' +
        '</div>' +
        '<div class="rc-logo-spacer"></div>' +
      '</div>' +
      infoGrid +
      '<table class="rc-table">' + colgroup + '<thead>' + thead + '</thead>' +
        '<tbody>' + rows + '</tbody><tfoot>' + tfoot + '</tfoot></table>' +
      extraRow +
      finalRow +
      foot +
    '</div>' +
  '</section>';
}

async function printReportDoc(win, cards, term = 'year') {
  const logo = await eagleDataUri();
  const logoHtml = logo ? '<img class="logo" src="' + logo + '" alt="">' : '<div class="logo"></div>';
  const body = cards.map(c => {
    let html = reportCardHtml(c, term).replace('%%LOGO%%', logoHtml);
    // العلامة المائية: استبدل رمزها بالشعار، أو احذفها إن لم يتوفّر الشعار
    html = logo ? html.replace(/%%WM%%/g, logo) : html.replace(/<img class="rc-wm"[^>]*>/g, '');
    return html;
  }).join('');

  win.document.write(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<title>الجلاء المدرسي</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">' +
    '<style>' +
    // print-color-adjust:exact يمنع تحوّل الرؤوس الخضراء إلى رمادي عند الطباعة
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}' +
    "body{font-family:'Cairo',Arial,sans-serif;color:#0f172a;margin:0}" +
    '.card-page{position:relative;padding:10mm 8mm;page-break-after:always;overflow:hidden}' +
    '.card-page:last-child{page-break-after:auto}' +
    // العلامة المائية: شعار النسر باهتاً خلف المحتوى
    '.rc-wm{position:absolute;top:50%;left:50%;width:120mm;height:120mm;transform:translate(-50%,-50%);opacity:.05;object-fit:contain;pointer-events:none;z-index:0}' +
    '.rc-body{position:relative;z-index:1}' +
    '.rc-head{display:flex;align-items:center;gap:12px;border-bottom:3px solid #0f8f7e;padding-bottom:8px;margin-bottom:10px}' +
    '.rc-head .logo{width:64px;height:64px;object-fit:contain;flex-shrink:0}' +
    '.rc-logo-spacer{width:64px;flex-shrink:0}' +
    '.rc-titles{flex:1;text-align:center}' +
    '.rc-country{font-size:11px;color:#64748b;font-weight:600}' +
    '.rc-ministry{font-size:12px;color:#64748b;font-weight:600}' +
    '.rc-titles h1{font-size:22px;font-weight:900;color:#0f8f7e;margin:4px 0 2px}' +
    '.rc-year{font-size:12px;color:#334155;font-weight:700}' +
    '.rc-info{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:10px}' +
    '.rc-cell{border:1px solid #cbd5e1;border-radius:5px;overflow:hidden}' +
    '.rc-cell.wide{grid-column:span 2}' +
    '.rc-cell .rc-k{background:#e8f5f2;color:#0b6d60;font-size:9px;font-weight:700;padding:2px 7px}' +
    '.rc-cell .rc-v{padding:4px 7px;font-size:11px;font-weight:600;min-height:1.4em}' +
    '.rc-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px}' +
    '.rc-table th{border:1px solid #cbd5e1;padding:2px;text-align:center}' +
    '.rc-table td{border:1px solid #cbd5e1;padding:2px;text-align:center;overflow:hidden}' +
    '.rc-table thead th{background:#0f8f7e;color:#fff;font-weight:700}' +
    '.rc-table thead tr.sub th{background:#0b6d60}' +
    // رؤوس الأعمدة الرقمية مكتوبة عموديّاً (بالجانب) كما في القالب الرسمي
    '.rc-table th.vh{height:86px;padding:2px 0;vertical-align:middle}' +
    '.rc-table th.vh span{display:inline-block;transform:rotate(-90deg);white-space:nowrap;font-size:10px;font-weight:700}' +
    '.rc-table th.h-sub,.rc-table th.h-res{font-size:11px}' +
    '.rc-table col.c-sub{width:16%}' +
    '.rc-table col.c-mm{width:6%}' +
    '.rc-table col.c-g{width:7%}' +
    '.rc-table col.c-avg{width:8%}' +
    '.rc-table col.c-res{width:11%}' +
    '.rc-table td.subject{text-align:right;font-weight:600}' +
    '.rc-table tbody tr:nth-child(even) td{background:#f8fafc}' +
    '.rc-table tr.fail td{color:#dc2626;font-weight:700}' +
    '.rc-table tfoot tr.rc-sum td{background:#e8f5f2;font-weight:800;color:#0b6d60}' +
    '.rc-extra{display:flex;justify-content:space-between;gap:12px;margin-top:8px;font-size:11px;color:#334155}' +
    '.rc-extra b{color:#0b6d60}' +
    '.rc-final-row{display:flex;gap:10px;margin-top:10px}' +
    '.rc-final-box{flex:1;border:1.5px solid #0f8f7e;border-radius:7px;padding:6px 12px;display:flex;justify-content:space-between;align-items:center;font-size:12px}' +
    '.rc-final-box span{font-weight:700;color:#0b6d60}' +
    '.rc-final-box b{font-size:15px}' +
    '.rc-foot{display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px}' +
    '.rc-sign{text-align:center;font-size:12px}' +
    '.rc-sign .r{color:#64748b;margin-bottom:4px;white-space:nowrap}' +
    '.rc-sign .n{font-weight:700;border-top:1px dotted #64748b;padding-top:5px;min-width:140px}' +
    '.rc-stamp{width:96px;height:96px;border:1.5px dashed #cbd5e1;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px}' +
    '.rc-qr{text-align:center;flex-shrink:0}' +
    '.rc-qr svg{width:74px;height:74px;display:block}' +
    '.rc-qr-cap{font-size:9px;color:#64748b;margin-top:2px}' +
    // أبقِ هذه الكتل في نفس الصفحة (المدير/الختم مع الشهادة)
    '.rc-table,.rc-final-row,.rc-foot,.rc-extra{page-break-inside:avoid}' +
    '@page{size:A4;margin:10mm}' +
    '</style></head><body>' +
    body +
    '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print()},400)}</scr' + 'ipt>' +
    '</body></html>'
  );
  win.document.close();
}

// ─── Grace marks (درجات المساعدة) ─────────────────────────────────────────────
let _graceCard = null;

const GRACE_PER_SUBJECT = 10;   // ≤10 per subject
const GRACE_TOTAL_CAP   = 50;   // ≤50 overall

// Sum of grace inputs: each subject row + the total field. Arabic rows share one
// cap of 10 (the two زمرتان count as a single subject).
function graceFigures() {
  let arabic = 0, others = 0;
  graceList.querySelectorAll('.grace-in').forEach(inp => {
    const v = Math.max(0, Number(inp.value) || 0);
    if (inp.dataset.arabic === '1') arabic += v; else others += v;
  });
  const total = Math.max(0, Number(graceTotalIn.value) || 0);
  const arabicCapped = Math.min(arabic, GRACE_PER_SUBJECT);
  return { arabic, others, total, grandTotal: arabicCapped + others + total, arabicCapped };
}

function refreshGraceSummary() {
  const f = graceFigures();
  const over = f.grandTotal > GRACE_TOTAL_CAP;
  const arOver = f.arabic > GRACE_PER_SUBJECT;
  graceSummaryEl.innerHTML =
    `الإجمالي المستخدم: <strong>${f.grandTotal}</strong> / ${GRACE_TOTAL_CAP}` +
    (arOver ? ' — <span style="color:#DC2626">مجموع مساعدة العربية يتجاوز ١٠</span>' : '') +
    (over ? ' — <span style="color:#DC2626">يتجاوز الحد الأقصى</span>' : '');
  btnSaveGrace.disabled = over || arOver;
}

function openGraceModal(card) {
  _graceCard = card;
  graceErrorEl.hidden = true;
  graceStudentEl.textContent = card.student.full_name;
  graceList.innerHTML = '';
  // Offer grace on subjects the student hasn't passed (after current grace).
  const subs = card.subjects.filter(s => s.passed === false || (s.grace || 0) > 0);
  if (subs.length === 0) {
    graceList.innerHTML = '<li class="mng-hint">لا توجد مواد راسبة تحتاج مساعدة.</li>';
  }
  subs.forEach(s => {
    const li = document.createElement('li');
    li.className = 'comp-row';
    li.innerHTML =
      `<span style="flex:1">${escapeHtml(s.name)}` +
      `<small style="color:#94A3B8"> (${fmtNum(s.percent)}٪)</small></span>` +
      `<input class="field-input grace-in" type="number" min="0" max="${GRACE_PER_SUBJECT}" step="1" ` +
      `style="width:84px" data-sid="${escapeHtml(s.subjectId)}" data-arabic="${s.isCoreArabic ? '1' : '0'}" ` +
      `value="${s.grace || 0}" />`;
    graceList.appendChild(li);
  });
  graceTotalIn.value = card.graceTotal || 0;
  refreshGraceSummary();
  show(modalGrace);
  document.body.style.overflow = 'hidden';
  loadGraceProposals(card);
}

// ── صندوق اقتراحات المعلّمين لهذا الطالب ──
const graceProposalsWrap = el('grace-proposals-wrap');
const graceProposalsList = el('grace-proposals');

async function loadGraceProposals(card) {
  if (!graceProposalsWrap || !_repData?.class?.id) return;
  graceProposalsWrap.hidden = true;
  graceProposalsList.innerHTML = '';
  try {
    const all = await NDB.getGraceProposals(_repData.class.id, 'pending');
    const mine = (all || []).filter(p => p.student_id === card.student.id);
    if (!mine.length) return;
    const nameOf = (sid) => {
      const s = card.subjects.find(x => x.subjectId === sid);
      return s ? s.name : 'المجموع';
    };
    graceProposalsList.innerHTML = mine.map(p =>
      `<li class="comp-row" data-pid="${escapeHtml(p.id)}">
         <span style="flex:1">${escapeHtml(nameOf(p.subject_id))}
           <strong>+${escapeHtml(String(p.marks))}</strong>
           ${p.reason ? `<small style="color:#94A3B8"> — ${escapeHtml(p.reason)}</small>` : ''}
         </span>
         <button type="button" class="btn btn-ghost btn-sm" data-gp="approved">اعتماد</button>
         <button type="button" class="btn btn-ghost btn-sm" data-gp="rejected">رفض</button>
       </li>`).join('');
    graceProposalsWrap.hidden = false;
    graceProposalsList.querySelectorAll('[data-gp]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const li = btn.closest('[data-pid]');
        btn.disabled = true;
        try {
          await NDB.decideGraceProposal(li.dataset.pid, btn.dataset.gp);
          toast(btn.dataset.gp === 'approved' ? 'اعتُمد الاقتراح' : 'رُفض الاقتراح', 'success');
          closeGraceModal();
          loadReports(_repData.class.id);
        } catch (err) {
          console.error('[NSAMS] decideGraceProposal', err);
          graceErrorEl.textContent = err?.message || 'تعذّر تنفيذ القرار.';
          show(graceErrorEl);
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    console.error('[NSAMS] loadGraceProposals', err);
  }
}

function closeGraceModal() {
  hide(modalGrace);
  document.body.style.overflow = '';
  _graceCard = null;
}

graceList.addEventListener('input', (e) => { if (e.target.closest('.grace-in')) refreshGraceSummary(); });
graceTotalIn.addEventListener('input', refreshGraceSummary);
btnCloseGrace.addEventListener('click', closeGraceModal);
modalGrace.addEventListener('click', (e) => { if (e.target === modalGrace) closeGraceModal(); });

btnSaveGrace.addEventListener('click', async () => {
  if (!_graceCard) return;
  const f = graceFigures();
  if (f.arabic > GRACE_PER_SUBJECT) { graceErrorEl.textContent = 'مساعدة العربية لا تتجاوز ١٠.'; show(graceErrorEl); return; }
  if (f.grandTotal > GRACE_TOTAL_CAP) { graceErrorEl.textContent = 'الإجمالي يتجاوز ٥٠.'; show(graceErrorEl); return; }
  graceErrorEl.hidden = true;

  const items = [];
  graceList.querySelectorAll('.grace-in').forEach(inp => {
    const marks = Math.max(0, Number(inp.value) || 0);
    items.push({ subjectId: inp.dataset.sid, marks: Math.min(marks, GRACE_PER_SUBJECT) });
  });
  const totalMarks = Math.max(0, Number(graceTotalIn.value) || 0);
  if (totalMarks > 0) items.push({ subjectId: null, marks: totalMarks });

  btnSaveGrace.disabled = true;
  try {
    // الصلاحية والسقوف تُفرض على الخادم داخل grant_grace (المسار الوحيد للكتابة).
    await NDB.setStudentGrace({
      studentId: _graceCard.student.id,
      classId:   _repData.class.id,
      items,
    });
    closeGraceModal();
    toast('تم حفظ درجات المساعدة', 'success');
    loadReports(_repData.class.id);
  } catch (err) {
    console.error('[NSAMS] setStudentGrace', err);
    graceErrorEl.textContent = err?.message || 'تعذّر الحفظ.'; show(graceErrorEl);
    btnSaveGrace.disabled = false;
  }
});

// ═══ Staff attendance (دوام الموظفين) ════════════════════════════════════════
let _staffLoaded = false;
let _staffData   = { teachers: [], admins: [], workers: [] };
let _staffEdit   = null;  // { kind, refId, name, record } currently being edited
let _rosterAll   = [];

// Refs — roster card
const rosterSearchInp   = el('roster-search');
const rosterCounts      = el('roster-counts');
const rosterLoading     = el('roster-loading');
const rosterListEl      = el('roster-list');
const rosterErrorEl     = el('roster-error');
const btnRefreshRoster  = el('btn-refresh-roster');
const rosterRefreshIcon = el('roster-refresh-icon');

// Refs — work-start + register + roster
const inWorkStart       = el('in-work-start');
const btnSaveWorkStart  = el('btn-save-work-start');
const workStartMsg      = el('work-start-msg');
const btnRefreshStaff   = el('btn-refresh-staff');
const staffRefreshIcon  = el('staff-refresh-icon');
const staffLoading      = el('staff-loading');
const staffListEl       = el('staff-list');
const staffErrorEl      = el('staff-error');
const inPersonnelName   = el('in-personnel-name');
const inPersonnelKind   = el('in-personnel-kind');
const btnAddPersonnel   = el('btn-add-personnel');
const personnelErrorEl  = el('personnel-error');
const personnelListEl   = el('personnel-list');

// Refs — staff edit modal
const modalStaff        = el('modal-staff');
const btnCloseStaff     = el('btn-close-staff');
const staffEditName     = el('staff-edit-name');
const staffStatusSel    = el('staff-status');
const staffCheckinInp   = el('staff-checkin');
const staffCheckoutInp  = el('staff-checkout');
const staffReasonInp    = el('staff-reason');
const staffNoteInp      = el('staff-note');
const staffEditError    = el('staff-edit-error');
const btnSaveStaff      = el('btn-save-staff');
const staffSaveLabel    = el('staff-save-label');
const staffSaveSpinner  = el('staff-save-spinner');

const STAFF_STATUS_AR    = { present: 'حاضر', late: 'متأخر', absent: 'غائب', leave: 'إجازة' };
const PERSONNEL_KIND_AR  = { admin: 'إداري', worker: 'مستخدم' };

function staffWorkStart() { return S.school?.work_start_time || null; }

function isoToLocalHHMM(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function hhmmToISO(hhmm, dateISO) {
  if (!hhmm) return null;
  const d = new Date(`${dateISO}T${hhmm}:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function fmtHHMM(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit', hour12: true });
}

async function initStaffTab() {
  _staffLoaded = true;
  if (inWorkStart) inWorkStart.value = staffWorkStart() ? String(staffWorkStart()).slice(0, 5) : '';
  populateIdentityCard();
  await Promise.all([loadRosterCard(), loadStaffAttendance(), loadPersonnelRoster(), loadStaffCredentials()]);
}

// ── Roster card (الكوادر المدرسية) ─────────────────────────────────────────
const ROSTER_KIND_AR = { teacher: 'معلم', admin: 'إداري', worker: 'مستخدم' };

async function loadRosterCard() {
  if (!S.school?.id) return;
  show(rosterLoading); hide(rosterListEl); hide(rosterErrorEl);
  if (rosterRefreshIcon) rosterRefreshIcon.classList.add('syncing');
  try {
    _rosterAll = await window.NSAMS_DB.getFullStaffRoster(S.school.id);
    renderRoster(rosterSearchInp ? rosterSearchInp.value : '');
    hide(rosterLoading); show(rosterListEl);
  } catch (err) {
    console.error('[NSAMS] loadRosterCard', err);
    hide(rosterLoading);
    if (rosterErrorEl) { rosterErrorEl.textContent = 'تعذّر تحميل الكوادر.'; show(rosterErrorEl); }
  } finally {
    if (rosterRefreshIcon) rosterRefreshIcon.classList.remove('syncing');
  }
}

function renderRoster(query) {
  const q = (query ?? '').trim().toLowerCase();
  const filtered = q
    ? _rosterAll.filter(m =>
        m.fullName.toLowerCase().includes(q) ||
        (m.username && m.username.toLowerCase().includes(q))
      )
    : _rosterAll;

  const teachers = filtered.filter(m => m.kind === 'teacher');
  const admins   = filtered.filter(m => m.kind === 'admin');
  const workers  = filtered.filter(m => m.kind === 'worker');

  if (rosterCounts) {
    const t = _rosterAll.filter(m => m.kind === 'teacher').length;
    const a = _rosterAll.filter(m => m.kind === 'admin').length;
    const w = _rosterAll.filter(m => m.kind === 'worker').length;
    rosterCounts.textContent = `${t} معلم · ${a} إداري · ${w} مستخدم`;
  }

  const buildGroup = (label, list) => {
    if (!list.length) return '';
    return (
      `<li class="roster-group-lbl">${label}</li>` +
      list.map(m =>
        `<li class="roster-item">` +
          `<span class="roster-kind roster-kind-${m.kind}">${ROSTER_KIND_AR[m.kind] || ''}</span>` +
          `<span class="roster-name">${escapeHtml(m.fullName)}</span>` +
          (m.username ? `<span class="roster-username">${escapeHtml(m.username)}</span>` : '') +
        `</li>`
      ).join('')
    );
  };

  const html = buildGroup('المعلمون', teachers) +
               buildGroup('الإداريون', admins) +
               buildGroup('المستخدمون', workers);

  if (rosterListEl) {
    rosterListEl.innerHTML = html ||
      `<li style="padding:24px 16px;text-align:center;color:#94A3B8;font-size:.85rem">لا توجد نتائج.</li>`;
  }
}

if (rosterSearchInp) rosterSearchInp.addEventListener('input', () => renderRoster(rosterSearchInp.value));
if (btnRefreshRoster) btnRefreshRoster.addEventListener('click', () => loadRosterCard());

async function loadStaffAttendance() {
  if (!S.school?.id) return;
  show(staffLoading); hide(staffListEl); hide(staffErrorEl);
  staffRefreshIcon.classList.add('syncing');
  try {
    _staffData = await window.NSAMS_DB.getStaffAttendanceForDate(S.school.id, todayISO());
    renderStaffGroups();
    hide(staffLoading); show(staffListEl);
  } catch (err) {
    console.error('[NSAMS] loadStaffAttendance', err);
    hide(staffLoading);
    staffErrorEl.textContent = 'تعذّر تحميل دوام الموظفين.'; show(staffErrorEl);
  } finally {
    staffRefreshIcon.classList.remove('syncing');
  }
}

function staffRowHtml(entry) {
  const r = entry.record;
  const status   = r?.status;
  const badgeCls = status ? `staff-badge-${status}` : 'staff-badge-none';
  const badgeTxt = status ? STAFF_STATUS_AR[status] : 'لم يُسجّل';
  const inT = r ? (r.checkInAdjusted ?? r.checkInOriginal) : null;
  let times = '';
  if (inT)                times += `دخول ${fmtHHMM(inT)}`;
  if (r?.checkOut)        times += `${times ? ' · ' : ''}خروج ${fmtHHMM(r.checkOut)}`;
  if (r?.lateMinutes > 0) times += `${times ? ' · ' : ''}تأخّر ${r.lateMinutes}د`;
  const src = r ? (r.source === 'self' ? 'معلم' : 'مدير') : '';
  return (
    `<div class="staff-row" data-kind="${entry.kind}" data-ref="${entry.refId}">` +
      `<span class="staff-name">${escapeHtml(entry.name)}</span>` +
      `<span class="staff-badge ${badgeCls}">${badgeTxt}</span>` +
      (times ? `<span class="staff-times">${times}</span>` : '') +
      (src ? `<span class="staff-src">${src}</span>` : '') +
      `<button class="staff-edit-btn" data-act="edit-staff">تعديل</button>` +
    `</div>`
  );
}

function renderStaffGroups() {
  const groups = [
    ['المعلمون', _staffData.teachers],
    ['الإداريون', _staffData.admins],
    ['المستخدمون', _staffData.workers],
  ];
  let html = '';
  for (const [label, list] of groups) {
    if (!list || list.length === 0) continue;
    html += `<div class="staff-group-label">${label}</div>`;
    html += list.map(staffRowHtml).join('');
  }
  staffListEl.innerHTML = html ||
    '<div style="padding:24px 16px;text-align:center;color:#94A3B8;font-size:.85rem">لا يوجد موظفون.</div>';
}

if (staffListEl) staffListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act="edit-staff"]');
  if (!btn) return;
  const row  = btn.closest('.staff-row');
  const kind = row.dataset.kind, refId = row.dataset.ref;
  const list = kind === 'teacher' ? _staffData.teachers
             : kind === 'admin'   ? _staffData.admins
             : _staffData.workers;
  const entry = list.find(x => String(x.refId) === String(refId));
  if (entry) openStaffModal(entry);
});

function openStaffModal(entry) {
  _staffEdit = entry;
  const r = entry.record;
  staffEditName.textContent = entry.name;
  staffStatusSel.value = r?.status || 'present';
  CustomSelect.refresh(staffStatusSel);
  staffCheckinInp.value  = isoToLocalHHMM(r ? (r.checkInAdjusted ?? r.checkInOriginal) : null);
  staffCheckoutInp.value = isoToLocalHHMM(r?.checkOut);
  staffReasonInp.value   = r?.adjustReason || '';
  staffNoteInp.value     = r?.note || '';
  hide(staffEditError);
  show(modalStaff);
  document.body.style.overflow = 'hidden';
}
function closeStaffModal() {
  hide(modalStaff);
  document.body.style.overflow = '';
  _staffEdit = null;
}
if (btnCloseStaff) btnCloseStaff.addEventListener('click', closeStaffModal);
if (modalStaff) modalStaff.addEventListener('click', (e) => { if (e.target === modalStaff) closeStaffModal(); });

if (btnSaveStaff) btnSaveStaff.addEventListener('click', async () => {
  if (!_staffEdit) return;
  if (!navigator.onLine) { staffEditError.textContent = 'التعديل يحتاج اتصالاً بالإنترنت'; show(staffEditError); return; }
  const reason = staffReasonInp.value.trim();
  if (!reason) { staffEditError.textContent = 'يرجى كتابة سبب التعديل'; show(staffEditError); staffReasonInp.focus(); return; }

  const date    = todayISO();
  const status  = staffStatusSel.value;
  const isAway  = status === 'absent' || status === 'leave';
  const checkInTime = isAway ? null : hhmmToISO(staffCheckinInp.value,  date);
  const checkOut    = isAway ? null : hhmmToISO(staffCheckoutInp.value, date);

  hide(staffEditError);
  btnSaveStaff.disabled = true; staffSaveLabel.hidden = true; staffSaveSpinner.hidden = false;
  try {
    await window.NSAMS_DB.upsertStaffAttendance({
      schoolId:    S.school.id, date,
      kind:        _staffEdit.kind,
      teacherId:   _staffEdit.kind === 'teacher' ? _staffEdit.refId : null,
      personnelId: _staffEdit.kind === 'teacher' ? null : _staffEdit.refId,
      status, checkInTime, checkOut,
      adjustReason:  reason,
      note:          staffNoteInp.value.trim() || null,
      workStartTime: staffWorkStart(),
      adjustedBy:    S.user?.user?.id ?? null,
    });
    closeStaffModal();
    toast('تم حفظ الدوام', 'success');
    await loadStaffAttendance();
    loadStaffDailyCounts();
  } catch (err) {
    console.error('[NSAMS] upsertStaffAttendance', err);
    staffEditError.textContent = 'تعذّر الحفظ، حاول مجدداً'; show(staffEditError);
  } finally {
    btnSaveStaff.disabled = false; staffSaveLabel.hidden = false; staffSaveSpinner.hidden = true;
  }
});

// ── Personnel roster (admins & workers) ──
async function loadPersonnelRoster() {
  if (!S.school?.id) return;
  try {
    const list = await window.NSAMS_DB.getSchoolPersonnel(S.school.id);
    personnelListEl.innerHTML = list.filter(p => p.isActive).map(p =>
      `<li class="staff-roster-item" data-id="${p.id}">` +
        `<span class="sr-name">${escapeHtml(p.fullName)}</span>` +
        `<span class="sr-kind">${PERSONNEL_KIND_AR[p.kind] || ''}</span>` +
        // المرآة تُحذف من مصدرها في «الكوادر» لا من هنا، وإلا عاد الانفصال بين
        // الجدولين من الباب الخلفي: يختفي من الدوام ويبقى في السجلّ والبيان.
        (p.staffRecordId
          ? `<span class="sr-src" title="مصدره سجلّ الكوادر — يُحذف من هناك">من الكوادر</span>`
          : `<button class="staff-roster-del" data-act="del-personnel" aria-label="إزالة">` +
              `<svg class="icon icon-sm"><use href="#ic-x"/></svg></button>`) +
      `</li>`
    ).join('');
  } catch (err) {
    console.error('[NSAMS] loadPersonnelRoster', err);
  }
}

async function addPersonnelHandler() {
  const name = inPersonnelName.value.trim();
  const kind = inPersonnelKind.value;
  hide(personnelErrorEl);
  if (!name) { personnelErrorEl.textContent = 'يرجى إدخال الاسم'; show(personnelErrorEl); return; }
  if (!navigator.onLine) { personnelErrorEl.textContent = 'الإضافة تحتاج اتصالاً بالإنترنت'; show(personnelErrorEl); return; }
  btnAddPersonnel.disabled = true;
  try {
    await window.NSAMS_DB.addPersonnel({ schoolId: S.school.id, fullName: name, kind });
    inPersonnelName.value = '';
    await Promise.all([loadPersonnelRoster(), loadRosterCard()]);
    await loadStaffAttendance();
    toast('تمت الإضافة', 'success');
  } catch (err) {
    console.error('[NSAMS] addPersonnel', err);
    personnelErrorEl.textContent = 'تعذّرت الإضافة'; show(personnelErrorEl);
  } finally {
    btnAddPersonnel.disabled = false;
  }
}
if (btnAddPersonnel) btnAddPersonnel.addEventListener('click', addPersonnelHandler);
if (inPersonnelName) inPersonnelName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addPersonnelHandler(); }
});

if (personnelListEl) personnelListEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act="del-personnel"]');
  if (!btn) return;
  const id = btn.closest('.staff-roster-item').dataset.id;
  if (!await askConfirm('إزالة هذا الموظف من السجل؟', 'إزالة')) return;
  try {
    await window.NSAMS_DB.setPersonnelActive(id, false);
    await Promise.all([loadPersonnelRoster(), loadRosterCard()]);
    await loadStaffAttendance();
    loadStaffDailyCounts();
  } catch (err) {
    console.error('[NSAMS] setPersonnelActive', err);
    toast('تعذّرت الإزالة', 'error');
  }
});

// ── Work-start time ──
if (btnSaveWorkStart) btnSaveWorkStart.addEventListener('click', async () => {
  if (!navigator.onLine) {
    workStartMsg.className = 'msg msg-error'; workStartMsg.textContent = 'الحفظ يحتاج اتصالاً'; show(workStartMsg); return;
  }
  const val = inWorkStart.value || null;
  btnSaveWorkStart.disabled = true;
  try {
    await window.NSAMS_DB.updateSchool(S.school.id, { workStartTime: val });
    if (S.school) S.school.work_start_time = val;
    workStartMsg.className = 'msg msg-success'; workStartMsg.textContent = 'تم حفظ بداية الدوام'; show(workStartMsg);
    setTimeout(() => hide(workStartMsg), 2500);
  } catch (err) {
    console.error('[NSAMS] updateSchool workStart', err);
    workStartMsg.className = 'msg msg-error'; workStartMsg.textContent = 'تعذّر الحفظ'; show(workStartMsg);
  } finally {
    btnSaveWorkStart.disabled = false;
  }
});

if (btnRefreshStaff) btnRefreshStaff.addEventListener('click', () => loadStaffAttendance());

// Auto-fill the daily-record admin/worker counts from the staff register.
async function loadStaffDailyCounts() {
  if (!S.school?.id || !window.NSAMS_DB?.computeStaffDailyCounts) return;
  try {
    const c = await window.NSAMS_DB.computeStaffDailyCounts(S.school.id, todayISO());
    if (inAdminPresent)  inAdminPresent.value  = c.admins.present;
    if (inAdminAbsent)   inAdminAbsent.value   = c.admins.absent;
    if (inWorkerPresent) inWorkerPresent.value = c.workers.present;
    if (inWorkerAbsent)  inWorkerAbsent.value  = c.workers.absent;
  } catch (err) {
    console.warn('[NSAMS] loadStaffDailyCounts', err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  Students (سجل الطلاب / SIS): roster, editor, transfer, archive, CSV import
// ════════════════════════════════════════════════════════════════════════════
let _studentsLoaded = false;
let _stuClassId = '';
let _stuList    = [];          // raw student rows for the selected class
let _stuEditId  = null;        // student id being edited (null = create)
let _stuActionStudent = null;  // student targeted by transfer / archive
let _stuImportRows = [];       // parsed+validated rows ready to import

const stuClassSelect = el('stu-class-select');
const stuTools       = el('stu-tools');
const stuSearch      = el('stu-search');
const stuLoading     = el('stu-loading');
const stuListEl      = el('stu-list');
const stuEmpty       = el('stu-empty');
const stuNoResults   = el('stu-noresults');

const STU_FIELDS = {
  firstName:'stu-first', fatherName:'stu-father', familyName:'stu-family',
  gender:'stu-gender', nationalId:'stu-natid',
  motherName:'stu-mother', motherFamily:'stu-mother-family', grandfatherName:'stu-grandfather',
  cardNumber:'stu-card', birthPlace:'stu-birthplace', contactPhone:'stu-phone',
  resGovernorate:'stu-gov', resRegion:'stu-region', resSubdistrict:'stu-subdistrict',
  resTown:'stu-town', resSector:'stu-sector', resBlock:'stu-block',
};

function actorId() { return S.user?.user?.id ?? null; }
function schoolId() { return S.school?.id ?? S.user?.schoolId ?? null; }

// ── Date of birth: three numeric boxes (day / month / year) + live validation ─
const dobDay   = el('stu-dob-day');
const dobMonth = el('stu-dob-month');
const dobYear  = el('stu-dob-year');
const dobError = el('stu-dob-error');

function daysInMonth(m, y) {
  if (m === 2) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}
function showDobError(msg) {
  if (msg) { dobError.textContent = msg; show(dobError); } else hide(dobError);
}
// Strict check used on save — all-or-nothing; returns { ok, value:'YYYY-MM-DD'|'', error }.
function validateDob() {
  const d = dobDay.value.trim(), m = dobMonth.value.trim(), y = dobYear.value.trim();
  if (!d && !m && !y) return { ok: true, value: '' };               // left blank = optional
  if (!d || !m || y.length < 4) return { ok: false, error: 'أكمل خانات اليوم والشهر والسنة.' };
  const dd = +d, mm = +m, yy = +y, now = new Date();
  if (mm < 1 || mm > 12) return { ok: false, error: 'الشهر يجب أن يكون بين ١ و ١٢.' };
  if (dd < 1 || dd > 31) return { ok: false, error: 'اليوم يجب أن يكون بين ١ و ٣١.' };
  if (yy < now.getFullYear() - 120) return { ok: false, error: 'سنة الميلاد قديمة جداً (أكثر من ١٢٠ سنة).' };
  const max = daysInMonth(mm, yy);
  if (dd > max) return { ok: false, error: `اليوم غير صحيح لهذا الشهر (الحد الأقصى ${max}).` };
  if (new Date(yy, mm - 1, dd) > now) return { ok: false, error: 'لا يمكن أن يكون تاريخ الميلاد في المستقبل.' };
  return { ok: true, value: `${String(yy).padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}` };
}
// Lighter check used live (while typing / onBlur) — flags impossible values as
// soon as enough is entered, without nagging about not-yet-filled boxes.
function liveDobError() {
  const dRaw = dobDay.value, mRaw = dobMonth.value, yRaw = dobYear.value;
  const dd = +dRaw, mm = +mRaw, yy = +yRaw, now = new Date();
  if (mRaw && (mm < 1 || mm > 12)) return 'الشهر يجب أن يكون بين ١ و ١٢.';
  if (dRaw && (dd < 1 || dd > 31)) return 'اليوم يجب أن يكون بين ١ و ٣١.';
  if (dRaw && mRaw && mm >= 1 && mm <= 12) {
    const yForMax = yRaw.length === 4 ? yy : 2000;   // unknown year ⇒ leap, so 29 stays allowed
    const max = daysInMonth(mm, yForMax);
    if (dd > max) return `اليوم غير صحيح لهذا الشهر (الحد الأقصى ${max}).`;
  }
  if (yRaw.length === 4) {
    if (yy < now.getFullYear() - 120) return 'سنة الميلاد قديمة جداً (أكثر من ١٢٠ سنة).';
    if (dRaw && mRaw && mm >= 1 && mm <= 12 && dd >= 1 && new Date(yy, mm - 1, dd) > now)
      return 'لا يمكن أن يكون تاريخ الميلاد في المستقبل.';
  }
  return '';
}
[dobDay, dobMonth, dobYear].forEach((node, idx) => {
  node.addEventListener('input', () => {
    const cleaned = node.value.replace(/\D/g, '');
    if (cleaned !== node.value) node.value = cleaned;   // numeric only
    if (idx === 0 && node.value.length === 2) dobMonth.focus();   // auto-advance
    else if (idx === 1 && node.value.length === 2) dobYear.focus();
    showDobError(liveDobError());
  });
  node.addEventListener('blur', () => showDobError(liveDobError()));
});

async function initStudentsTab() {
  _studentsLoaded = true;
  await Promise.all([loadStuClasses(), loadDropoutWarning()]);
}

// ── Dropout warning ───────────────────────────────────────────────────────────
async function loadDropoutWarning() {
  if (!S.school?.id) return;
  const DB            = window.NSAMS_DB;
  const loadingEl     = el('dropout-loading');
  const riskHdr       = el('dropout-risk-hdr');
  const riskList      = el('dropout-risk-list');
  const riskEmpty     = el('dropout-risk-empty');
  const flaggedHdr    = el('dropout-flagged-hdr');
  const flaggedList   = el('dropout-flagged-list');
  const hintEl        = el('dropout-hint');
  if (!loadingEl) return;

  loadingEl.hidden = false;
  if (riskHdr)    riskHdr.hidden    = true;
  if (riskEmpty)  riskEmpty.hidden  = true;
  if (flaggedHdr) flaggedHdr.hidden = true;

  try {
    const [atRisk, flagged] = await Promise.all([
      DB.getDropoutRiskStudents(S.school.id),
      DB.getFlaggedDropoutStudents(S.school.id),
    ]);
    loadingEl.hidden = true;

    // ── طلاب في خطر ───────────────────────────────────
    if (riskHdr) riskHdr.hidden = false;
    if (atRisk.length === 0) {
      if (riskEmpty) riskEmpty.hidden = false;
    } else {
      riskList.innerHTML = atRisk.map(r => {
        const semLabel = r.semester === '1' ? 'الفصل الأول' : 'الفصل الثاني';
        return `<li class="mng-item" style="align-items:flex-start;flex-direction:column;gap:4px">
          <div style="display:flex;align-items:center;gap:8px;width:100%">
            <span style="font-weight:600;flex:1">${escHtml(r.full_name)}</span>
            <span style="background:#450a0a;color:#f87171;border:1px solid #dc2626;border-radius:20px;font-size:11px;font-weight:600;padding:2px 10px;white-space:nowrap">${r.absent_days} يوم غياب</span>
            <button class="btn btn-danger btn-sm" data-flag-id="${r.student_id}" data-flag-grade="${r.grade}">
              ترقين القيد
            </button>
          </div>
          <small style="color:#94a3b8">الصف ${r.grade} — ${escHtml(r.class_name ?? '')} — ${semLabel} — الحد: ${r.threshold}</small>
        </li>`;
      }).join('');
    }

    // ── طلاب مرقَّن قيدهم ───────────────────────────────
    if (flagged.length > 0) {
      if (flaggedHdr) flaggedHdr.hidden = false;
      flaggedList.innerHTML = flagged.map(r => {
        const flagDate = new Date(r.dropout_flagged_at).toLocaleDateString('ar-SY', { dateStyle: 'medium' });
        const returnInfo = r.dropout_return_at
          ? `حق العودة من: ${new Date(r.dropout_return_at).toLocaleDateString('ar-SY', { dateStyle: 'medium' })}`
          : 'انفصال نهائي';
        return `<li class="mng-item" style="align-items:flex-start;flex-direction:column;gap:4px">
          <span style="font-weight:600">${escHtml(r.full_name)}</span>
          <small style="color:#94a3b8">الصف ${r.dropout_grade ?? '—'} — تاريخ الترقين: ${flagDate} — ${returnInfo}</small>
        </li>`;
      }).join('');
    }

    // Wire up flag buttons
    riskList.querySelectorAll('[data-flag-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sid        = btn.dataset.flagId;
        const gradeRaw   = parseInt(btn.dataset.flagGrade, 10);
        const grade      = Number.isFinite(gradeRaw) ? gradeRaw : null;
        if (!await askConfirm('تأكيد ترقين قيد هذا الطالب؟', 'ترقين')) return;
        btn.disabled = true;
        try {
          await DB.flagStudentDropout(sid, grade);
          toast('تم ترقين قيد الطالب', 'success');
          await loadDropoutWarning();
        } catch (e) {
          toast('تعذّر ترقين القيد: ' + e.message, 'error');
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    loadingEl.hidden = true;
    if (hintEl) hintEl.textContent = 'تعذّر تحميل بيانات التسرب' + (err?.message ? ' — ' + err.message : '');
    console.warn('[Dropout]', err);
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function loadStuClasses() {
  if (!S.school?.id) return;
  try {
    const classes = await NDB.getSchoolClasses(S.school.id);
    _stuClasses = classes;
    const opts = '<option value="">— اختر صفاً —</option>' + classes.map(c => {
      const label = c.name || `${gradeLabel(c.grade)} / ${c.section ?? ''}`.trim();
      return `<option value="${escapeHtml(c.id)}">${escapeHtml(label)}</option>`;
    }).join('');
    stuClassSelect.innerHTML = opts;
    CustomSelect.refresh(stuClassSelect);
  } catch (err) {
    console.error('[NSAMS] loadStuClasses', err);
    toast('تعذّر تحميل قائمة الصفوف', 'error');
  }
}
let _stuClasses = [];

stuClassSelect.addEventListener('change', async () => {
  _stuClassId = stuClassSelect.value;
  const btnAddStu = el('btn-add-student');
  if (btnAddStu) btnAddStu.disabled = !_stuClassId;
  if (!_stuClassId) { stuTools.hidden = true; stuListEl.innerHTML = ''; hide(stuEmpty); hide(stuNoResults); return; }
  stuTools.hidden = false;
  await loadStudents();
});

// Lifecycle status → Arabic label + badge modifier (دورة حياة الطالب).
const STU_STATUS_LABELS = {
  active: 'نشط', transferred: 'منقول', out_of_year: 'خارج السنة',
  graduated: 'متخرّج', struck_off: 'مرقّن القيد',
};
let _stuStatus = 'active';

async function loadStudents() {
  if (!_stuClassId) return;
  show(stuLoading); stuListEl.innerHTML = ''; hide(stuEmpty); hide(stuNoResults);
  try {
    // Default chip (active) uses the cached/offline path; other statuses are online-only.
    const opts = _stuStatus && _stuStatus !== 'active' ? { status: _stuStatus } : {};
    _stuList = await NDB.getClassStudents(_stuClassId, opts);
    renderStudents();
  } catch (err) {
    console.error('[NSAMS] loadStudents', err);
    toast('تعذّر تحميل الطلاب', 'error');
  } finally {
    hide(stuLoading);
  }
}

function renderStudents() {
  const q = (stuSearch.value || '').trim();
  const list = q
    ? _stuList.filter(s => (s.full_name || '').includes(q) || (s.national_id || '').includes(q))
    : _stuList;
  hide(stuEmpty); hide(stuNoResults);
  if (_stuList.length === 0) { stuListEl.innerHTML = ''; show(stuEmpty); return; }
  if (list.length === 0)     { stuListEl.innerHTML = ''; show(stuNoResults); return; }
  stuListEl.innerHTML = list.map((s) => {
    const st = s.status || 'active';
    const badge = st !== 'active'
      ? `<span class="stu-status-badge st-${st}">${STU_STATUS_LABELS[st] || st}</span>`
      : '';
    const gDot = s.gender === 'female'
      ? '<span class="gender-dot gender-dot--female" title="أنثى"></span>'
      : s.gender === 'male'
        ? '<span class="gender-dot gender-dot--male" title="ذكر"></span>'
        : '<span class="gender-dot" style="background:var(--clr-border)"></span>';
    return (
      `<li class="stu-row" data-id="${escapeHtml(s.id)}">` +
        gDot +
        `<span class="stu-info"><span class="stu-name">${escapeHtml(s.full_name || '—')}</span>${badge}</span>` +
        `<span class="stu-acts">` +
          `<button class="icon-btn-sm" data-act="edit" title="تعديل"><svg class="icon icon-sm"><use href="#ic-edit"/></svg></button>` +
          `<button class="icon-btn-sm" data-act="transfer" title="نقل بين الشعب"><svg class="icon icon-sm"><use href="#ic-arrow-right"/></svg></button>` +
          `<button class="icon-btn-sm" data-act="status" title="تغيير الحالة"><svg class="icon icon-sm"><use href="#ic-user"/></svg></button>` +
        `</span>` +
      `</li>`
    );
  }).join('');
  const cntBadge = el('stu-count-badge');
  if (cntBadge) {
    cntBadge.hidden = !list.length;
    cntBadge.textContent = list.length ? `${list.length} طالب` : '';
  }
}

stuSearch.addEventListener('input', renderStudents);
el('btn-refresh-students').addEventListener('click', () => { if (_stuClassId) loadStudents(); });
el('btn-refresh-dropout')?.addEventListener('click', loadDropoutWarning);

stuListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.stu-row')?.dataset.id;
  const student = _stuList.find(s => s.id === id);
  if (!student) return;
  if (btn.dataset.act === 'edit')     openStudentForm(student);
  if (btn.dataset.act === 'transfer') openTransfer(student);
  if (btn.dataset.act === 'status')   openStatus(student);
});

// ── Status filter chips (دورة حياة الطالب) ───────────────────────────────────
el('stu-status-chips')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.stu-chip');
  if (!chip || chip.classList.contains('is-on')) return;
  el('stu-status-chips').querySelectorAll('.stu-chip').forEach(c => {
    const on = c === chip;
    c.classList.toggle('is-on', on);
    c.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  _stuStatus = chip.dataset.status || 'active';
  if (_stuClassId) loadStudents();
});

// ── Student editor ──────────────────────────────────────────────────────────
const modalStudent = el('modal-student');
const stuFormError = el('stu-form-error');

function openStudentForm(student) {
  _stuEditId = student?.id ?? null;
  el('stu-modal-title').textContent = student ? 'تعديل بيانات الطالب' : 'طالب جديد';
  for (const [key, id] of Object.entries(STU_FIELDS)) {
    const node = el(id); if (!node) continue;
    const col = ({ firstName:'first_name', fatherName:'father_name', familyName:'family_name',
      gender:'gender', nationalId:'national_id',
      motherName:'mother_name', motherFamily:'mother_family', grandfatherName:'grandfather_name',
      cardNumber:'card_number', birthPlace:'birth_place', contactPhone:'contact_phone',
      resGovernorate:'res_governorate', resRegion:'res_region', resSubdistrict:'res_subdistrict',
      resTown:'res_town', resSector:'res_sector', resBlock:'res_block' })[key];
    node.value = student && student[col] != null ? student[col] : '';
  }
  // Date of birth → fill the three day/month/year boxes from YYYY-MM-DD.
  const bd = (student && student.birth_date) ? String(student.birth_date).split('-') : [];
  dobYear.value  = bd[0] || '';
  dobMonth.value = bd[1] ? String(Number(bd[1])) : '';
  dobDay.value   = bd[2] ? String(Number(bd[2])) : '';
  hide(dobError);
  CustomSelect.refresh(el('stu-gender'));
  CustomSelect.refresh(el('stu-gov'));
  hide(stuFormError);
  show(modalStudent);
  if (!student) modalStudent.querySelector('.sheet-body').scrollTop = 0;
}
function closeStudentForm() { hide(modalStudent); }
el('btn-close-student').addEventListener('click', closeStudentForm);

el('btn-save-student').addEventListener('click', async () => {
  hide(stuFormError);
  const input = {};
  for (const key of Object.keys(STU_FIELDS)) input[key] = el(STU_FIELDS[key]).value.trim();
  if (!input.firstName || !input.fatherName || !input.familyName) {
    stuFormError.textContent = 'الاسم واسم الأب والكنية حقول إلزامية.'; show(stuFormError); return;
  }
  // إلزامي كي لا يُحفظ طالب بلا نقطة جنس في القائمة.
  if (!input.gender) {
    stuFormError.textContent = 'الجنس حقل إلزامي.'; show(stuFormError); return;
  }

  if (input.nationalId && !/^\d{11}$/.test(input.nationalId)) {
    stuFormError.textContent = input.nationalId.length < 11
      ? `الرقم الوطني يجب أن يكون ١١ رقماً — أدخلت ${input.nationalId.length} فقط.`
      : `الرقم الوطني يجب أن يكون ١١ رقماً — أدخلت ${input.nationalId.length}.`;
    show(stuFormError); return;
  }
  // Date of birth (optional) — must be a valid, non-future, not-too-old date.
  const dob = validateDob();
  if (!dob.ok) { showDobError(dob.error); return; }
  input.birthDate = dob.value;   // '' when left blank
  const btn = el('btn-save-student'); btn.disabled = true; show(el('stu-save-spinner'));
  try {
    if (input.nationalId && navigator.onLine) {
      const dup = await NDB.findDuplicateStudent(schoolId(), input.nationalId, _stuEditId);
      if (dup) {
        stuFormError.textContent = `الرقم الوطني مُستخدم لطالب آخر: ${dup.full_name || ''}`.trim();
        show(stuFormError); btn.disabled = false; hide(el('stu-save-spinner')); return;
      }
    }
    const res = await NDB.saveStudent({
      ...input, id: _stuEditId || undefined,
      schoolId: schoolId(), classId: _stuClassId, actorId: actorId(),
    });
    closeStudentForm();
    toast(res.synced ? (_stuEditId ? 'تم تحديث الطالب' : 'تمت إضافة الطالب')
                     : 'حُفظ محلياً وسيُزامن عند الاتصال', res.synced ? 'success' : 'warning');
    await loadStudents();
  } catch (err) {
    console.error('[NSAMS] saveStudent', err);
    stuFormError.textContent = 'تعذّر الحفظ.'; show(stuFormError);
  } finally {
    btn.disabled = false; hide(el('stu-save-spinner'));
  }
});

el('btn-add-student').addEventListener('click', () => openStudentForm(null));

// ملاحظة: زرّ «البحث في السجل الوطني» للطالب حُذف — الجدول المركزي
// national_students_registry بلا صلاحية للدور authenticated فيسقط الاستدعاء بـ
// «permission denied»، وهو فارغ أصلاً إذ لا شاشة في التطبيق تملؤه. يعود الزرّ
// في دفعة الاستيراد حين تُملأ السجلّات المركزية فعلاً. المعادل للكادر حُذف معه.

// ── Transfer ────────────────────────────────────────────────────────────────
const modalTransfer = el('modal-transfer');
function openTransfer(student) {
  _stuActionStudent = student;
  el('transfer-name').textContent = student.full_name || '—';
  el('transfer-reason').value = '';
  hide(el('transfer-error'));
  const sel = el('transfer-class');
  sel.innerHTML = '<option value="">— اختر صفاً —</option>' + _stuClasses
    .filter(c => c.id !== _stuClassId)
    .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || `${gradeLabel(c.grade)} / ${c.section ?? ''}`.trim())}</option>`)
    .join('');
  CustomSelect.refresh(sel);
  show(modalTransfer);
}
el('btn-close-transfer').addEventListener('click', () => hide(modalTransfer));
el('btn-confirm-transfer').addEventListener('click', async () => {
  const toClassId = el('transfer-class').value;
  if (!toClassId) { el('transfer-error').textContent = 'اختر الصف الجديد.'; show(el('transfer-error')); return; }
  const btn = el('btn-confirm-transfer'); btn.disabled = true; show(el('transfer-spinner'));
  try {
    const res = await NDB.transferStudent({
      id: _stuActionStudent.id, schoolId: schoolId(),
      fromClassId: _stuClassId, toClassId,
      reason: el('transfer-reason').value.trim() || null, actorId: actorId(),
    });
    hide(modalTransfer);
    toast(res.synced ? 'تم نقل الطالب' : 'سيُنقل عند الاتصال', res.synced ? 'success' : 'warning');
    await loadStudents();
  } catch (err) {
    console.error('[NSAMS] transferStudent', err);
    el('transfer-error').textContent = 'تعذّر النقل.'; show(el('transfer-error'));
  } finally {
    btn.disabled = false; hide(el('transfer-spinner'));
  }
});

// ── Archive (soft-delete) ─────────────────────────────────────────────────────
const modalArchive = el('modal-archive');
function openArchive(student) {
  _stuActionStudent = student;
  el('archive-name').textContent = student.full_name || '—';
  el('archive-reason').value = '';
  hide(el('archive-error'));
  show(modalArchive);
}
el('btn-close-archive').addEventListener('click', () => hide(modalArchive));
el('btn-confirm-archive').addEventListener('click', async () => {
  const btn = el('btn-confirm-archive'); btn.disabled = true; show(el('archive-spinner'));
  try {
    const res = await NDB.archiveStudent({
      id: _stuActionStudent.id, schoolId: schoolId(), classId: _stuClassId,
      reason: el('archive-reason').value.trim() || null, actorId: actorId(),
    });
    hide(modalArchive);
    toast(res.synced ? 'تمت أرشفة الطالب' : 'ستُؤرشف عند الاتصال', res.synced ? 'success' : 'warning');
    await loadStudents();
  } catch (err) {
    console.error('[NSAMS] archiveStudent', err);
    el('archive-error').textContent = 'تعذّرت الأرشفة.'; show(el('archive-error'));
  } finally {
    btn.disabled = false; hide(el('archive-spinner'));
  }
});

// ── Change lifecycle status (دورة حياة الطالب) ────────────────────────────────
const modalStatus = el('modal-status');
function openStatus(student) {
  _stuActionStudent = student;
  const cur = student.status || 'active';
  el('status-name').textContent    = student.full_name || '—';
  el('status-current').textContent = STU_STATUS_LABELS[cur] || cur;
  el('status-new').value    = cur;
  el('status-reason').value = '';
  hide(el('status-error'));
  CustomSelect.refresh(el('status-new'));
  show(modalStatus);
}
el('btn-close-status').addEventListener('click', () => hide(modalStatus));
el('btn-confirm-status').addEventListener('click', async () => {
  const newStatus = el('status-new').value;
  const cur = _stuActionStudent?.status || 'active';
  if (cur === 'graduated') {
    el('status-error').textContent = 'لا يمكن تغيير حالة طالب متخرّج.'; show(el('status-error')); return;
  }
  if (newStatus === cur) {
    el('status-error').textContent = 'اختر حالة مختلفة عن الحالية.'; show(el('status-error')); return;
  }
  const btn = el('btn-confirm-status'); btn.disabled = true; show(el('status-spinner'));
  try {
    const res = await NDB.setStudentStatus({
      id: _stuActionStudent.id, schoolId: schoolId(), classId: _stuClassId,
      newStatus, reason: el('status-reason').value.trim() || null, actorId: actorId(),
    });
    hide(modalStatus);
    toast(res.synced ? 'تم تغيير حالة الطالب' : 'سيُحدَّث عند الاتصال', res.synced ? 'success' : 'warning');
    await loadStudents();
  } catch (err) {
    console.error('[NSAMS] setStudentStatus', err);
    el('status-error').textContent = 'تعذّر تغيير الحالة.'; show(el('status-error'));
  } finally {
    btn.disabled = false; hide(el('status-spinner'));
  }
});

// ── CSV bulk import ───────────────────────────────────────────────────────────
const modalImport = el('modal-import');
el('btn-import-students').addEventListener('click', () => {
  _stuImportRows = [];
  el('import-file').value = '';
  el('import-preview').hidden = true; el('import-preview').innerHTML = '';
  el('btn-confirm-import').hidden = true;
  hide(el('import-error'));
  show(modalImport);
});
el('btn-close-import').addEventListener('click', () => hide(modalImport));

el('btn-download-template').addEventListener('click', () => {
  const csv = 'الاسم,الأب,الكنية,الجنس,تاريخ الميلاد,الرقم الوطني\n'
            + 'أحمد,محمد,العلي,male,2015-03-01,\n';
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'students-template.csv';
  a.click(); URL.revokeObjectURL(a.href);
});

function parseCSV(text) {
  const rows = []; let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function normGender(v) {
  const s = (v || '').trim().toLowerCase();
  if (['male', 'm', 'ذكر'].includes(s)) return 'male';
  if (['female', 'f', 'أنثى', 'انثى'].includes(s)) return 'female';
  return '';
}

el('import-file').addEventListener('change', async (e) => {
  hide(el('import-error'));
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length <= 1) throw new Error('الملف فارغ أو لا يحوي بيانات.');
    const dataRows = rows.slice(1); // skip header
    const parsed = []; const errors = [];
    dataRows.forEach((cols, idx) => {
      const [firstName, fatherName, familyName, gender, birthDate, nationalId] =
        cols.map(c => (c || '').trim());
      if (!firstName || !fatherName || !familyName) {
        errors.push(`السطر ${idx + 2}: الاسم/الأب/الكنية مطلوبة`); return;
      }
      parsed.push({
        firstName, fatherName, familyName, gender: normGender(gender),
        birthDate: birthDate || '', nationalId: nationalId || '',
      });
    });
    _stuImportRows = parsed;
    const prev = el('import-preview');
    prev.innerHTML =
      `<div class="import-sum">جاهز للاستيراد: ${parsed.length} طالب${errors.length ? ` — تخطّي ${errors.length} سطر` : ''}</div>` +
      parsed.slice(0, 20).map(p => `<div class="stu-meta">• ${escapeHtml([p.firstName, p.fatherName, p.familyName].join(' '))}</div>`).join('') +
      (parsed.length > 20 ? `<div class="stu-meta">… و${parsed.length - 20} غيرهم</div>` : '') +
      errors.slice(0, 10).map(er => `<div class="import-fail">${escapeHtml(er)}</div>`).join('');
    prev.hidden = false;
    el('import-btn-label').textContent = `استيراد ${parsed.length} طالب`;
    el('btn-confirm-import').hidden = parsed.length === 0;
  } catch (err) {
    el('import-error').textContent = err.message || 'تعذّرت قراءة الملف.'; show(el('import-error'));
  }
});

el('btn-confirm-import').addEventListener('click', async () => {
  if (!_stuImportRows.length || !_stuClassId) return;
  const btn = el('btn-confirm-import'); btn.disabled = true; show(el('import-spinner'));
  hide(el('import-error'));
  try {
    const sum = await NDB.bulkImportStudents({
      schoolId: schoolId(), classId: _stuClassId, rows: _stuImportRows, actorId: actorId(),
    });
    hide(modalImport);
    let msg = `تم استيراد ${sum.inserted} طالب`;
    if (sum.duplicate) msg += ` · ${sum.duplicate} مكرّر`;
    if (sum.failed.length) msg += ` · ${sum.failed.length} فشل`;
    toast(msg, sum.failed.length ? 'warning' : 'success', 5000);
    await loadStudents();
  } catch (err) {
    console.error('[NSAMS] bulkImportStudents', err);
    el('import-error').textContent = err.message || 'تعذّر الاستيراد.'; show(el('import-error'));
  } finally {
    btn.disabled = false; hide(el('import-spinner'));
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  School identity + GPS (هوية المدرسة والموقع)
// ════════════════════════════════════════════════════════════════════════════
function populateIdentityCard() {
  const s = S.school; if (!s) return;
  if (el('sch-complex'))        el('sch-complex').value        = s.complex_name   ?? '';
  if (el('sch-classification')) el('sch-classification').value = s.classification ?? '';
  if (el('sch-edutype'))      { el('sch-edutype').value        = s.education_type ?? ''; CustomSelect.refresh(el('sch-edutype')); }
  if (el('sch-shift'))        { el('sch-shift').value          = s.shift ?? ''; CustomSelect.refresh(el('sch-shift')); }
  if (el('sch-studenttype'))    el('sch-studenttype').value    = s.student_type   ?? '';
  if (el('sch-lat'))            el('sch-lat').value            = s.lat ?? '';
  if (el('sch-lng'))            el('sch-lng').value            = s.lng ?? '';
  // Staff & student counts
  if (el('sch-total-teachers')) el('sch-total-teachers').value = s.totalTeachers || '';
  if (el('sch-total-students')) el('sch-total-students').value = s.totalStudents || '';
}

el('btn-locate')?.addEventListener('click', () => {
  if (!navigator.geolocation) { toast('المتصفّح لا يدعم تحديد الموقع', 'error'); return; }
  toast('جارٍ تحديد الموقع…', 'info');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el('sch-lat').value = pos.coords.latitude.toFixed(6);
      el('sch-lng').value = pos.coords.longitude.toFixed(6);
      toast('تم تحديد الموقع — لا تنسَ الحفظ', 'success');
    },
    (err) => { console.warn('[NSAMS] geolocation', err); toast('تعذّر تحديد الموقع. أدخله يدوياً أو امنح الإذن.', 'error', 4500); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

el('btn-save-identity')?.addEventListener('click', async () => {
  const msg = el('sch-identity-msg');
  const latRaw = el('sch-lat').value.trim(), lngRaw = el('sch-lng').value.trim();
  const patch = {
    complexName:   el('sch-complex').value.trim(),
    classification:el('sch-classification').value.trim(),
    educationType: el('sch-edutype').value.trim(),
    shift:         el('sch-shift').value,
    studentType:   el('sch-studenttype').value.trim(),
    lat: latRaw === '' ? null : Number(latRaw),
    lng: lngRaw === '' ? null : Number(lngRaw),
  };
  if ((latRaw && Number.isNaN(patch.lat)) || (lngRaw && Number.isNaN(patch.lng))) {
    msg.className = 'msg msg-error'; msg.textContent = 'إحداثيات GPS غير صحيحة.'; show(msg); return;
  }
  // المجمّع يُطبَع في ترويسة بطاقة العلامات وورقة «لا مانع». وهذا النموذج يرسل
  // المفتاح دائماً، فحفظُه فارغاً كان **يمحو** قيمةً ضبطتها المديرية.
  if (!patch.complexName) {
    msg.className = 'msg msg-error';
    msg.textContent = 'المجمّع التربوي مطلوب — يظهر في ترويسة الوثائق المطبوعة.';
    show(msg); return;
  }
  const btn = el('btn-save-identity'); btn.disabled = true;
  try {
    await NDB.updateSchool(S.school.id, patch);
    // Reflect on the cached school object so the card persists across tabs.
    Object.assign(S.school, {
      complex_name: patch.complexName || null, classification: patch.classification || null,
      education_type: patch.educationType || null, shift: patch.shift || null,
      student_type: patch.studentType || null, lat: patch.lat, lng: patch.lng,
    });
    cacheSchool(S.school.id, S.school);
    msg.className = 'msg msg-success'; msg.textContent = 'تم حفظ هوية المدرسة'; show(msg);
    setTimeout(() => hide(msg), 2500);
  } catch (err) {
    console.error('[NSAMS] saveIdentity', err);
    msg.className = 'msg msg-error'; msg.textContent = 'تعذّر الحفظ.'; show(msg);
  } finally {
    btn.disabled = false;
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  Staff & student real counts (بيانات الكادر والطلاب)
// ════════════════════════════════════════════════════════════════════════════
el('btn-save-counts')?.addEventListener('click', async () => {
  const teachersVal = el('sch-total-teachers')?.value.trim() ?? '';
  const studentsVal = el('sch-total-students')?.value.trim() ?? '';
  const msg = el('sch-counts-msg');
  const btn = el('btn-save-counts'); btn.disabled = true;
  try {
    const patch = {
      totalTeachers: teachersVal === '' ? null : Number(teachersVal),
      totalStudents: studentsVal === '' ? null : Number(studentsVal),
    };
    if ((teachersVal !== '' && isNaN(patch.totalTeachers)) ||
        (studentsVal !== '' && isNaN(patch.totalStudents))) {
      msg.className = 'msg msg-error'; msg.textContent = 'الأرقام غير صحيحة.'; show(msg);
      btn.disabled = false; return;
    }
    await NDB.updateSchool(S.school.id, patch);
    S.school.totalTeachers = patch.totalTeachers ?? null;
    S.school.totalStudents = patch.totalStudents ?? null;
    cacheSchool(S.school.id, S.school);
    // Dismiss banner now that counts are set
    const bannerKey = `nsams_setup_done_${S.school.id}`;
    localStorage.setItem(bannerKey, '1');
    const banner = el('setup-banner'); if (banner) banner.hidden = true;
    msg.className = 'msg msg-success'; msg.textContent = 'تم حفظ الأعداد'; show(msg);
    setTimeout(() => hide(msg), 2500);
  } catch (err) {
    console.error('[NSAMS] saveCounts', err);
    msg.className = 'msg msg-error'; msg.textContent = err?.message ?? 'تعذّر الحفظ.'; show(msg);
  } finally {
    btn.disabled = false;
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  Teacher accounts (معلومات تسجيل الكادر) — principal-created logins
// ════════════════════════════════════════════════════════════════════════════
let _credList = [];        // [{ id, userId, username, password, createdAt }]
let _teacherNames = {};    // userId → fullName (from getTeachersBySchool)
let _credEditUserId = null;

const credListEl = el('cred-list');
const modalTeacher = el('modal-teacher');

async function loadStaffCredentials() {
  if (!S.school?.id || !NDB.getStaffCredentials) return;
  show(el('cred-loading')); hide(el('cred-empty'));
  try {
    const [creds, teachers] = await Promise.all([
      NDB.getStaffCredentials(S.school.id),
      NDB.getTeachersBySchool(S.school.id).catch(() => []),
    ]);
    _credList = creds;
    _teacherNames = {};
    for (const t of teachers) _teacherNames[t.id] = t.fullName;
    renderCredentials();
  } catch (err) {
    console.error('[NSAMS] loadStaffCredentials', err);
    toast('تعذّر تحميل بيانات تسجيل الكادر', 'error');
  } finally {
    hide(el('cred-loading'));
  }
}

function renderCredentials() {
  if (_credList.length === 0) { credListEl.innerHTML = ''; show(el('cred-empty')); return; }
  hide(el('cred-empty'));
  credListEl.innerHTML = _credList.map(c => {
    const name = _teacherNames[c.userId] || '—';
    return (
      `<li class="cred-row" data-uid="${escapeHtml(c.userId)}">` +
        `<div class="cred-main">` +
          `<div class="cred-name">${escapeHtml(name)}</div>` +
          `<div class="cred-line">اسم المستخدم: <code>${escapeHtml(c.username)}</code></div>` +
          `<div class="cred-line">كلمة المرور: <code class="cred-pw" data-pw="${escapeHtml(c.password)}">••••••••</code></div>` +
        `</div>` +
        `<div class="cred-acts">` +
          `<button class="icon-btn-sm" data-act="reveal" title="إظهار/إخفاء"><svg class="icon icon-sm"><use href="#ic-eye"/></svg></button>` +
          `<button class="icon-btn-sm" data-act="copy" title="نسخ"><svg class="icon icon-sm"><use href="#ic-clipboard"/></svg></button>` +
          `<button class="icon-btn-sm" data-act="reset" title="تغيير كلمة المرور"><svg class="icon icon-sm"><use href="#ic-edit"/></svg></button>` +
          `<button class="icon-btn-sm danger" data-act="delete" title="حذف الحساب"><svg class="icon icon-sm"><use href="#ic-trash"/></svg></button>` +
        `</div>` +
      `</li>`
    );
  }).join('');
}

credListEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]'); if (!btn) return;
  const row = btn.closest('.cred-row'); const uid = row?.dataset.uid;
  const cred = _credList.find(c => c.userId === uid); if (!cred) return;
  const pwNode = row.querySelector('.cred-pw');
  if (btn.dataset.act === 'reveal') {
    const shown = pwNode.dataset.shown === '1';
    pwNode.textContent = shown ? '••••••••' : pwNode.dataset.pw;
    pwNode.dataset.shown = shown ? '0' : '1';
  } else if (btn.dataset.act === 'copy') {
    try { await navigator.clipboard.writeText(cred.password); toast('تم نسخ كلمة المرور', 'success'); }
    catch { toast('تعذّر النسخ', 'error'); }
  } else if (btn.dataset.act === 'reset') {
    openTeacherModal(cred);
  } else if (btn.dataset.act === 'delete') {
    openDeleteTeacherModal(cred);
  }
});

el('btn-refresh-cred')?.addEventListener('click', () => loadStaffCredentials());

// ── Permanent teacher-account deletion (with confirmation) ──────────────────
let _credDeleteUserId = null;
const modalDelTeacher = el('modal-del-teacher');

function openDeleteTeacherModal(cred) {
  _credDeleteUserId = cred.userId;
  el('del-teacher-name').textContent = _teacherNames[cred.userId] || cred.username || '—';
  hide(el('del-teacher-error'));
  show(modalDelTeacher);
}
el('btn-close-del-teacher')?.addEventListener('click', () => hide(modalDelTeacher));
modalDelTeacher?.addEventListener('click', (e) => { if (e.target === modalDelTeacher) hide(modalDelTeacher); });

el('btn-confirm-del-teacher')?.addEventListener('click', async () => {
  if (!_credDeleteUserId) return;
  hide(el('del-teacher-error'));
  const btn = el('btn-confirm-del-teacher'); btn.disabled = true; show(el('del-teacher-spinner'));
  try {
    await NDB.deleteTeacherAccount(_credDeleteUserId);
    hide(modalDelTeacher);
    toast('تم حذف الحساب نهائياً', 'success');
    await loadStaffCredentials();
  } catch (err) {
    console.error('[NSAMS] delete teacher account', err);
    el('del-teacher-error').textContent = err.message || 'تعذّر الحذف.'; show(el('del-teacher-error'));
  } finally {
    btn.disabled = false; hide(el('del-teacher-spinner'));
  }
});

function openTeacherModal(cred) {
  _credEditUserId = cred?.userId ?? null;
  const editing = !!cred;
  el('tch-modal-title').textContent = editing ? 'تغيير كلمة المرور' : 'إضافة معلّم';
  el('tch-save-label').textContent  = editing ? 'حفظ كلمة المرور' : 'إنشاء الحساب';
  el('tch-name').value = editing ? (_teacherNames[cred.userId] || '') : '';
  el('tch-username').value = editing ? cred.username : '';
  el('tch-password').value = '';
  // When editing we only reset the password — hide name/username inputs.
  el('tch-name-group').hidden = editing;
  el('tch-username-group').hidden = editing;
  hide(el('tch-error'));
  show(modalTeacher);
}
el('btn-add-teacher').addEventListener('click', () => openTeacherModal(null));
el('btn-close-teacher').addEventListener('click', () => hide(modalTeacher));

el('btn-save-teacher').addEventListener('click', async () => {
  hide(el('tch-error'));
  const editing  = !!_credEditUserId;
  const fullName = el('tch-name').value.trim();
  const username = el('tch-username').value.trim().toLowerCase();
  const password = el('tch-password').value;
  if (!editing) {
    if (!fullName) { return showTchErr('الاسم الكامل مطلوب.'); }
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) { return showTchErr('اسم المستخدم: أحرف لاتينية/أرقام (٣–٤٠) بدون فراغات.'); }
  }
  if (password.length < 6) { return showTchErr('كلمة المرور ٦ أحرف على الأقل.'); }
  const btn = el('btn-save-teacher'); btn.disabled = true; show(el('tch-spinner'));
  try {
    if (editing) {
      await NDB.updateTeacherCredential({ userId: _credEditUserId, password });
      toast('تم تحديث كلمة المرور', 'success');
    } else {
      await NDB.createTeacherAccount({ fullName, username, password });
      toast('تم إنشاء حساب المعلّم', 'success');
    }
    hide(modalTeacher);
    await Promise.all([loadStaffCredentials(), loadRosterCard()]);
  } catch (err) {
    console.error('[NSAMS] save teacher account', err);
    showTchErr(err.message || 'تعذّر الحفظ.');
  } finally {
    btn.disabled = false; hide(el('tch-spinner'));
  }
});
function showTchErr(msg) { el('tch-error').textContent = msg; show(el('tch-error')); el('btn-save-teacher').disabled = false; hide(el('tch-spinner')); }

// ── Notifications ─────────────────────────────────────────────────────────────
const btnNotif      = el('btn-notif');
const notifBadge    = el('notif-badge');
const modalNotif    = el('modal-notif');
let   _unreadCount  = 0;
let   _unsubNotif   = null;

function updateNotifBadge(n) {
  _unreadCount = n;
  notifBadge.textContent = n > 0 ? String(Math.min(n, 99)) : '';
  notifBadge.hidden = n <= 0;
}

async function loadNotifList() {
  const notifList = el('notif-list');
  try {
    const items = await window.NSAMS_DB.getNotifications(30);
    if (!items.length) {
      notifList.innerHTML = '<li class="notif-empty">لا توجد إشعارات</li>';
      return;
    }
    notifList.innerHTML = items.map(n => {
      const ago = formatTimeAgoAr(n.created_at);
      const unread = !n.read_at ? ' notif-item--unread' : '';
      // Titles/bodies are server-composed from user-entered names — escape them.
      const actionable = notifHandlerFor(n.type) ? ' notif-item--action' : '';
      return `<li class="notif-item${unread}${actionable}" data-id="${escapeHtml(n.id)}"
                  data-type="${escapeHtml(n.type || '')}" data-entity="${escapeHtml(n.entity_id || '')}">
        <div class="notif-item-title">${escapeHtml(n.title)}</div>
        ${n.body ? `<div class="notif-item-body">${escapeHtml(n.body)}</div>` : ''}
        <div class="notif-item-time">${ago}</div>
      </li>`;
    }).join('');
  } catch (e) {
    console.warn('[NSAMS] loadNotifList', e);
  }
}

// ── Notification deep links ───────────────────────────────────────────────────
// Types whose notification points at one specific screen. Clicking the item (or
// arriving via ?n=<type>&e=<id> from a push notification) opens that screen and
// the dialog the user actually needs — not just the portal's default tab.
const NOTIF_TARGETS = {
  grace_proposed: openGraceProposalTarget,
};

// hasOwn, not a plain lookup: a notification type of "constructor"/"toString"
// would otherwise resolve to an inherited Object member and get called.
function notifHandlerFor(type) {
  return Object.hasOwn(NOTIF_TARGETS, type) ? NOTIF_TARGETS[type] : null;
}

// Open the certificates tab on the proposal's class and pop the student's grace
// dialog, which lists the pending proposals with approve / reject buttons.
async function openGraceProposalTarget(proposalId) {
  const prop = await NDB.getGraceProposalById(proposalId);
  if (!prop) { toast('لم يُعثر على الاقتراح — ربما حُذف', 'warning'); return; }
  if (prop.status !== 'pending') { toast('هذا الاقتراح تمّ البتّ فيه سابقاً', 'info'); }

  // Fill the class picker BEFORE switching: switchTab kicks off initReportsTab
  // without awaiting it, so loading first (and flipping _reportsLoaded) keeps
  // the two from racing to rebuild the same <select>.
  if (!_reportsLoaded) await initReportsTab();
  switchTab('reports');
  // Grace applies to the full-year certificate only — a first-semester view has
  // no grace tool at all, so force the term before loading.
  repTermSelect.value = 'year';
  CustomSelect.refresh(repTermSelect);
  repClassSelect.value = prop.class_id;
  CustomSelect.refresh(repClassSelect);
  await loadReports(prop.class_id);

  const card = (_repData?.students || []).find(c => c.student?.id === prop.student_id);
  if (!card) { toast('الطالب غير موجود في نتائج هذا الصف', 'warning'); return; }
  openGraceModal(card);
}

async function handleNotifTarget(type, entityId) {
  const handler = notifHandlerFor(type);
  if (!handler || !entityId) return false;
  try {
    await handler(entityId);
  } catch (err) {
    console.error('[NSAMS] handleNotifTarget', type, err);
    toast('تعذّر فتح الإشعار', 'error');
  }
  return true;
}

function formatTimeAgoAr(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'الآن';
  if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  return `منذ ${Math.floor(h / 24)} يوم`;
}

function openNotifModal() {
  modalNotif.hidden = false;
  loadNotifList();
}

function closeNotifModal() {
  modalNotif.hidden = true;
}

if (btnNotif)       btnNotif.addEventListener('click', openNotifModal);
if (el('btn-notif-close')) el('btn-notif-close').addEventListener('click', closeNotifModal);
if (modalNotif)     modalNotif.addEventListener('click', (e) => { if (e.target === modalNotif) closeNotifModal(); });

// Clicking an actionable notification marks it read and jumps to its screen.
if (el('notif-list')) el('notif-list').addEventListener('click', async (e) => {
  const item = e.target.closest('.notif-item[data-type]');
  if (!item) return;
  const { type, entity, id } = item.dataset;
  if (!notifHandlerFor(type) || !entity) return;

  closeNotifModal();
  if (item.classList.contains('notif-item--unread')) {
    await NDB.markNotificationRead(id).catch(() => {});
    updateNotifBadge(Math.max(0, _unreadCount - 1));
  }
  await handleNotifTarget(type, entity);
});

if (el('btn-notif-read-all')) el('btn-notif-read-all').addEventListener('click', async () => {
  await window.NSAMS_DB.markAllNotificationsRead().catch(() => {});
  updateNotifBadge(0);
  loadNotifList();
});

function initNotifications(userId) {
  // Seed badge with current unread count (async, non-blocking)
  window.NSAMS_DB.getUnreadNotificationsCount().then(updateNotifBadge).catch(() => {});

  // Real-time subscription — fires when a new notification arrives for this user
  if (_unsubNotif) _unsubNotif();
  _unsubNotif = window.NSAMS_DB.subscribeNotifications(userId, (notif) => {
    updateNotifBadge(_unreadCount + 1);
    toast(notif.title, 'info', 5000);
    // OS notifications come from web push (the SW push handler). The page-context
    // `new Notification()` constructor throws on Android, so it is not used here.
  });

  // Web Push registration (fire-and-forget)
  Notification.requestPermission().then((perm) => {
    if (perm === 'granted') window.NSAMS_DB.registerPushSubscription().catch(() => {});
  });

  // Attendance reminder
  checkAttendanceReminder();
  setInterval(checkAttendanceReminder, 10 * 60 * 1000);
}

function checkAttendanceReminder() {
  const key = `nsams_reminder_${localDateISO()}`;
  if (S.attSubmitted || localStorage.getItem(key)) return;
  const now = new Date();
  const threshold = new Date(); threshold.setHours(9, 30, 0, 0);
  if (now < threshold) return;
  localStorage.setItem(key, '1');
  toast('لم يُرسل سجل الحضور بعد — يرجى الإرسال قبل نهاية الدوام', 'warning', 7000);
  if (Notification.permission === 'granted') {
    new Notification('رُقِيّ — تذكير', { body: 'لم يُرسل سجل الحضور اليوم', dir: 'rtl', lang: 'ar' });
  }
}

// National-ID fields: numeric only, 11 digits max.
['sr-national-id', 'stu-natid', 'req-stu-nid'].forEach(id => {
  el(id)?.addEventListener('input', function() {
    this.value = this.value.replace(/\D/g, '').slice(0, 11);
  });
});

// Enhance the school-admin selects once the DOM is parsed.
CustomSelect.enhance('stu-class-select');
CustomSelect.enhance('stu-gender');
CustomSelect.enhance('stu-gov');
CustomSelect.enhance('transfer-class');
CustomSelect.enhance('sch-shift');
CustomSelect.enhance('sch-edutype');
CustomSelect.enhance('staff-status');
CustomSelect.enhance('in-personnel-kind');
CustomSelect.enhance('mng-class-select');
CustomSelect.enhance('mng-role-select');
CustomSelect.enhance('mng-sup-select');
CustomSelect.enhance('mng-teacher-select');
CustomSelect.enhance('r-type');
CustomSelect.enhance('subj-grade-select');
CustomSelect.enhance('rep-class-select');
CustomSelect.enhance('rep-term-select');
CustomSelect.enhance('req-type-select');
CustomSelect.enhance('req-class-grade');
CustomSelect.enhance('req-stu-class');
CustomSelect.enhance('req-stu-gender');
CustomSelect.enhance('req-cor-class');
CustomSelect.enhance('req-cor-student');
CustomSelect.enhance('req-cor-field');

// ════════════════════════════════════════════════════════════════════════════
//  Tab: Registry — سجل الكوادر البشرية
// ════════════════════════════════════════════════════════════════════════════
let _registryLoaded = false;
let _regSegment     = 'admin';   // 'admin' | 'teaching' | 'support'
let _regAllRecords  = [];
let _regEditId      = null;
let _leavesStaff    = null;
let _delStaffId     = null;
let _lookupCache    = {};

const regList         = el('reg-list');
const regLoading      = el('reg-loading');
const regError        = el('reg-error');
const regEmpty        = el('reg-empty');
const btnRefreshReg   = el('btn-refresh-registry');
const btnAddStaffRec  = el('btn-add-staff-rec');
const modalStaffRec   = el('modal-staff-rec');
const btnCloseStaffRec= el('btn-close-staff-rec');
const staffRecTitle   = el('staff-rec-title');
const srFullName      = el('sr-full-name');
const srJobTitle      = el('sr-job-title');
const srSpec          = el('sr-specialization');
const srSubjectWrap   = el('sr-subject-wrap');
const srSubject       = el('sr-subject');
const srRosterType    = el('sr-roster-type');
const srCertificate   = el('sr-certificate');
const srHigherDegree  = el('sr-higher-degree');
const srSeniority     = el('sr-seniority');
const srStartDay      = el('sr-start-day');
const srStartMonth    = el('sr-start-month');
const srStartYear     = el('sr-start-year');
const srSelfNumber    = el('sr-self-number');
const srRegResult     = el('sr-reg-result');
// الجنس منتقٍ مقطعي بزرَّي اختيار لا <select>، فتبقى «غير محدَّد» ممكنة.
const srGenderRadios  = () => document.querySelectorAll('input[name="sr-gender"]');
const _getGender      = () => document.querySelector('input[name="sr-gender"]:checked')?.value || '';
const _setGender      = (v) => {
  srGenderRadios().forEach(r => {
    r.checked = r.value === v;
    r.closest('.seg-2-opt')?.classList.toggle('is-selected', r.checked);
  });
};
// إفادة بصرية عند النقر لا تتّكل على دعم :has() في CSS وحده — طبقة إضافية
// تُبدّل صفّاً يدوياً فور تغيّر الاختيار، لتبقى محسوسة على كل متصفّح.
srGenderRadios().forEach(r => r.addEventListener('change', () => {
  srGenderRadios().forEach(x => x.closest('.seg-2-opt')?.classList.toggle('is-selected', x.checked));
}));
const srNationalId    = el('sr-national-id');
const srMotherName    = el('sr-mother-name');
const srDobDay        = el('sr-dob-day');
const srDobMonth      = el('sr-dob-month');
const srDobYear       = el('sr-dob-year');
const srPhone         = el('sr-phone');
const srLandline      = el('sr-landline');
const srTeachExtra    = el('sr-teach-extra');
const srTeachHours    = el('sr-teaching-hours');
const srAsgGrade      = el('sr-assigned-grade');
const srAsgSection    = el('sr-assigned-section');
const srQuotaSubj     = el('sr-quota-subjects');
const srQuotaSchool   = el('sr-quota-school');
const srResZone       = el('sr-res-zone');
const srEduZone       = el('sr-edu-zone');
const srMinDoc        = el('sr-min-doc');
const srNotes         = el('sr-notes');
const srError         = el('sr-error');
const srSaveSpinner   = el('sr-save-spinner');
const btnSaveStaffRec = el('btn-save-staff-rec');

const modalLeaves     = el('modal-staff-leaves');
const btnCloseLeaves  = el('btn-close-staff-leaves');
const leavesStaffName = el('leaves-staff-name');
const leavesMonthSel  = el('leaves-month-sel');
const leavesYearIn    = el('leaves-year-in');
const leavesList      = el('leaves-list');
const leaveTypeSel    = el('leave-type-sel');
const leaveDaysIn     = el('leave-days-in');
const btnSaveLeave    = el('btn-save-leave');
const leavesError     = el('leaves-error');
const modalDelStaff   = el('modal-del-staff-rec');
const btnCloseDelStaff= el('btn-close-del-staff');
const delStaffName    = el('del-staff-name');
const delStaffError   = el('del-staff-error');
const btnConfirmDel   = el('btn-confirm-del-staff');

async function getLookup(type) {
  if (_lookupCache[type]) return _lookupCache[type];
  // School admins carry no directorate_id on their user row — the directorate
  // link lives on the school. Fall back to it so per-directorate lookups
  // (e.g. educational_zone) resolve. Global lookups (directorate_id IS NULL)
  // are always returned regardless, so other types are unaffected.
  const dirId = S.user?.directorateId ?? S.school?.directorate_id ?? null;
  const vals = await NDB.getLookupList(type, dirId);
  _lookupCache[type] = vals;
  return vals;
}

function fillSel(sel, values, blank = '— اختر —') {
  sel.innerHTML = `<option value="">${blank}</option>`;
  for (const v of values) {
    const o = document.createElement('option');
    o.value = o.textContent = v;
    sel.appendChild(o);
  }
  CustomSelect.refresh(sel);
}

async function initRegistryTab() {
  _registryLoaded = true;
  await Promise.all([loadRegistryRecords(), loadAssignments()]);
}

async function loadRegistryRecords() {
  if (!S.school?.id) return;
  show(regLoading); hide(regError);
  try {
    _regAllRecords = await NDB.getStaffRecords(S.school.id);
    renderRegistryList();
  } catch (err) {
    console.error('[NSAMS] loadRegistryRecords', err);
    show(regError);
  } finally {
    hide(regLoading);
  }
}

function renderRegistryList() {
  const filtered = _regAllRecords.filter(r => {
    if (_regSegment === 'admin')    return r.staff_type === 'admin';
    if (_regSegment === 'teaching') return r.staff_type === 'teaching';
    return ['professional','worker','guard'].includes(r.staff_type);
  });
  if (!filtered.length) {
    show(regEmpty);
    if (regList) regList.innerHTML = '';
    return;
  }
  hide(regEmpty);
  if (regList) regList.innerHTML = filtered.map(r => {
    const meta = [r.job_title, r.specialization].filter(Boolean).join(' · ');
    const genderDot = r.gender === 'female'
      ? '<span class="gender-dot gender-dot--female" title="أنثى"></span>'
      : r.gender === 'male'
        ? '<span class="gender-dot gender-dot--male" title="ذكر"></span>'
        : '';
    const nums = [
      r.self_number    ? `ذاتي: ${escapeHtml(r.self_number)}`    : null,
    ].filter(Boolean).join(' / ');
    const linkedBadge = r.registry_self_number
      ? '<span class="reg-linked-badge">مرتبط بالسجل</span>' : '';
    return `<li class="reg-row" data-id="${r.id}">
      <div class="reg-row-main">
        <div class="reg-name">${genderDot}${escapeHtml(r.full_name)}${linkedBadge}</div>
        ${nums ? `<div class="reg-nums">${nums}</div>` : ''}
        ${meta ? `<div class="reg-meta">${escapeHtml(meta)}</div>` : ''}
      </div>
      <div class="reg-row-acts">
        <button class="icon-btn" data-act="leaves" aria-label="إجازات" title="إجازات">
          <svg class="icon icon-sm"><use href="#ic-list"/></svg>
        </button>
        <button class="icon-btn" data-act="edit" aria-label="تعديل" title="تعديل">
          <svg class="icon icon-sm"><use href="#ic-edit"/></svg>
        </button>
        <button class="icon-btn" data-act="del" aria-label="حذف" title="حذف">
          <svg class="icon icon-sm"><use href="#ic-trash"/></svg>
        </button>
      </div>
    </li>`;
  }).join('');
}

// Segment switching
document.querySelectorAll('.reg-seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    _regSegment = btn.dataset.seg;
    document.querySelectorAll('.reg-seg-btn').forEach(b =>
      b.classList.toggle('is-active', b === btn));
    renderRegistryList();
  });
});

// Row action delegation
regList?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const li  = btn.closest('.reg-row');
  const rec = _regAllRecords.find(r => r.id === li?.dataset.id);
  if (!rec) return;
  const act = btn.dataset.act;
  if      (act === 'edit')   openStaffRecModal(rec);
  else if (act === 'leaves') openLeavesModal(rec);
  else if (act === 'del')    openDelStaffModal(rec);
});

btnAddStaffRec?.addEventListener('click', () => openStaffRecModal(null));
btnRefreshReg?.addEventListener('click',  loadRegistryRecords);

// ── Staff Record Modal ────────────────────────────────────────────────────────
async function openStaffRecModal(rec) {
  _regEditId = rec?.id ?? null;
  if (staffRecTitle) staffRecTitle.textContent = rec ? 'تعديل بيانات كادر' : 'إضافة كادر جديد';

  const jobTitles = _regSegment === 'admin'
    ? await getLookup('admin_role')
    : _regSegment === 'teaching'
      ? ['معلم', 'مدرس', 'مدرس مساعد']
      : await getLookup('support_job');

  const [specs, certs, higher, minDocs, eduZones] = await Promise.all([
    getLookup('specialization'), getLookup('certificate'),
    getLookup('higher_degree'),  getLookup('ministerial_doc'),
    getLookup('educational_zone'),
  ]);

  fillSel(srJobTitle, jobTitles);
  fillSel(srSpec, specs);
  fillSel(srCertificate, certs);
  fillSel(srHigherDegree, higher, '— لا يوجد —');
  fillSel(srMinDoc, minDocs, '— لا يوجد —');
  fillSel(srEduZone, eduZones, '— لا يوجد —');

  if (srSubjectWrap) srSubjectWrap.hidden = _regSegment !== 'teaching';
  // الحقول التي تطلبها ورقة الجهاز التدريسي وحدها (§20.3)
  if (srTeachExtra)  srTeachExtra.hidden  = _regSegment !== 'teaching';

  const textInputs = [srFullName, srNationalId, srMotherName, srDobDay, srDobMonth,
                      srDobYear, srStartDay, srStartMonth, srStartYear, srSubject, srPhone, srResZone, srNotes,
                      srSelfNumber, srLandline, srAsgGrade, srAsgSection,
                      srQuotaSubj, srQuotaSchool];
  const numInputs  = [srSeniority, srTeachHours];

  if (rec) {
    srFullName.value      = rec.full_name          || '';
    srNationalId.value    = rec.national_id        || '';
    srMotherName.value    = rec.mother_name        || '';
    srPhone.value         = rec.phone              || '';
    srResZone.value       = rec.residential_zone   || '';
    srNotes.value         = rec.notes              || '';
    srSubject.value       = rec.subject_taught     || '';
    srSeniority.value     = rec.seniority_year     ?? '';
    srSelfNumber.value    = rec.self_number        || '';
    if (srLandline)    srLandline.value    = rec.landline              || '';
    if (srTeachHours)  srTeachHours.value  = rec.teaching_hours        ?? '';
    if (srAsgGrade)    srAsgGrade.value    = rec.assigned_grade        || '';
    if (srAsgSection)  srAsgSection.value  = rec.assigned_section      || '';
    if (srQuotaSubj)   srQuotaSubj.value   = rec.quota_subjects        || '';
    if (srQuotaSchool) srQuotaSchool.value = rec.quota_school_external || '';
    if (rec.start_date) {
      const [sy, sm, sd] = rec.start_date.split('-');
      srStartYear.value = sy; srStartMonth.value = String(Number(sm)); srStartDay.value = String(Number(sd));
    } else {
      srStartYear.value = srStartMonth.value = srStartDay.value = '';
    }
    if (rec.birth_date) {
      const [y, m, d]  = rec.birth_date.split('-');
      srDobYear.value  = y; srDobMonth.value = m; srDobDay.value = d;
    } else {
      srDobYear.value  = srDobMonth.value = srDobDay.value = '';
    }
    srJobTitle.value    = rec.job_title        || '';
    srSpec.value        = rec.specialization   || '';
    srCertificate.value = rec.certificate      || '';
    srHigherDegree.value= rec.higher_degree    || '';
    srEduZone.value     = rec.educational_zone || '';
    srRosterType.value  = rec.roster_type      || 'inside';
    srMinDoc.value      = rec.ministerial_doc  || '';
    _setGender(rec.gender || '');
    [srJobTitle, srSpec, srCertificate, srHigherDegree, srEduZone, srRosterType, srMinDoc]
      .forEach(s => CustomSelect.refresh(s));

    const isLinked = !!rec.registry_self_number;
    _lockStaffPersonalFields(isLinked);
    if (isLinked) {
      _showRegResult(srRegResult, `مرتبط بالسجل المركزي — الرقم الذاتي: ${escapeHtml(rec.registry_self_number)}`, 'success');
    } else {
      hide(srRegResult);
    }
  } else {
    textInputs.forEach(i => { if (i) i.value = ''; });
    numInputs.forEach(i => { if (i) i.value = ''; });
    srRosterType.value = 'inside';
    _setGender('');
    [srJobTitle, srSpec, srCertificate, srHigherDegree, srEduZone, srMinDoc]
      .forEach(s => { if (s) { s.value = ''; CustomSelect.refresh(s); } });
    CustomSelect.refresh(srRosterType);
    _lockStaffPersonalFields(false);
    hide(srRegResult);
  }

  hide(srError);
  show(modalStaffRec);
  if (!rec) modalStaffRec.querySelector('.sheet-body').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function _lockStaffPersonalFields(locked) {
  [srFullName, srNationalId, srMotherName, srDobDay, srDobMonth, srDobYear].forEach(el => {
    if (!el) return;
    el.readOnly = locked;
    el.classList.toggle('field-locked', locked);
  });
  // أزرار الاختيار لا تحترم readOnly، فتُعطَّل صراحةً.
  srGenderRadios().forEach(r => { r.disabled = locked; });
  document.querySelectorAll('.seg-2-opt').forEach(o => o.classList.toggle('field-locked', locked));
}

function _showRegResult(container, msg, type = 'info') {
  if (!container) return;
  container.textContent = msg;
  container.className = `registry-result registry-result--${type}`;
  container.hidden = false;
}

function closeStaffRecModal() {
  hide(modalStaffRec);
  document.body.style.overflow = '';
  _regEditId = null;
}
btnCloseStaffRec?.addEventListener('click', closeStaffRecModal);
modalStaffRec?.addEventListener('click', e => { if (e.target === modalStaffRec) closeStaffRecModal(); });

// ملاحظة: زرّ «البحث في السجل الذاتي» حُذف — national_staff_registry بلا صلاحية
// للدور authenticated فيسقط بـ «permission denied»، وهو فارغ إذ لا شاشة تملؤه.
// يبقى srRegResult و_lockStaffPersonalFields: openStaffRecModal يستعملهما لعرض
// «مرتبط بالسجل المركزي» وقفل الحقول للسجلّات المرتبطة سلفاً، وهو مسار مستقلّ.

btnSaveStaffRec?.addEventListener('click', async () => {
  const fullName = srFullName?.value.trim();
  if (!fullName) { if (srError) { srError.textContent = 'الاسم الثلاثي مطلوب'; show(srError); } return; }
  // إلزامي كي لا يُحفظ سجلّ بلا نقطة جنس في القائمة — أياً كان سبب إفلات
  // الاختيار سابقاً، هذا الفحص يمنع تكرّره.
  if (!_getGender()) { if (srError) { srError.textContent = 'الجنس حقل إلزامي'; show(srError); } return; }
  if (!navigator.onLine) { if (srError) { srError.textContent = 'الحفظ يحتاج اتصالاً بالإنترنت'; show(srError); } return; }

  let birth_date = null;
  if (srDobYear?.value && srDobMonth?.value && srDobDay?.value) {
    const y = String(srDobYear.value).padStart(4, '0');
    const m = String(srDobMonth.value).padStart(2, '0');
    const d = String(srDobDay.value).padStart(2, '0');
    birth_date = `${y}-${m}-${d}`;
  }

  const jt = srJobTitle?.value || null;
  let staff_type = _regSegment === 'admin' ? 'admin'
    : _regSegment === 'teaching' ? 'teaching'
    : jt === 'مستخدم' ? 'worker' : jt === 'حارس' ? 'guard' : 'professional';

  const payload = {
    school_id:        S.school.id,
    staff_type,
    full_name:        fullName,
    national_id:      srNationalId?.value.trim() || null,
    mother_name:      srMotherName?.value.trim() || null,
    birth_date,
    gender:           _getGender() || null,
    self_number:      srSelfNumber?.value.trim() || null,
    job_title:        jt,
    specialization:   srSpec?.value || null,
    subject_taught:   _regSegment === 'teaching' ? (srSubject?.value.trim() || null) : null,
    certificate:      srCertificate?.value || null,
    higher_degree:    srHigherDegree?.value || null,
    // سنة التعيين لا عدد سنوات — هكذا تكتبها الورقة الرسمية (مثال: 1978).
    seniority_year:   srSeniority?.value ? parseInt(srSeniority.value, 10) : null,
    start_date:       (srStartYear?.value && srStartMonth?.value && srStartDay?.value)
                        ? `${String(srStartYear.value).padStart(4,'0')}-${String(srStartMonth.value).padStart(2,'0')}-${String(srStartDay.value).padStart(2,'0')}`
                        : null,
    phone:            srPhone?.value.trim() || null,
    landline:         srLandline?.value.trim() || null,
    residential_zone: srResZone?.value.trim() || null,
    educational_zone: srEduZone?.value || null,
    roster_type:      srRosterType?.value || 'inside',
    ministerial_doc:  srMinDoc?.value || null,
    notes:            srNotes?.value.trim() || null,
  };

  // حقول ورقة الجهاز التدريسي وحدها — تبقى null لغيرهم فلا تتسرّب بيانات
  // تدريس إلى سجلّ إداري أو مهني.
  if (_regSegment === 'teaching') {
    // teaching_rank لا يُدخَل هنا: يُستنتج مرّةً في _stmtTeachRank ويُخزَّن، ويُحرَّر
    // عند اللزوم من جدول القسم ٦ في البيان. حقل «رتبة التدريس» كان مكرّراً مع
    // «العمل المسند» فحُذف من هذا النموذج.
    payload.teaching_hours        = srTeachHours?.value ? parseInt(srTeachHours.value, 10) : null;
    payload.assigned_grade        = srAsgGrade?.value.trim() || null;
    payload.assigned_section      = srAsgSection?.value.trim() || null;
    payload.quota_subjects        = srQuotaSubj?.value.trim() || null;
    payload.quota_school_external = srQuotaSchool?.value.trim() || null;
  }

  if (btnSaveStaffRec) btnSaveStaffRec.disabled = true;
  if (srSaveSpinner) srSaveSpinner.hidden = false;
  hide(srError);
  try {
    let savedId = _regEditId;
    if (_regEditId) {
      await NDB.updateStaffRecord(_regEditId, payload);
    } else {
      const row = await NDB.createStaffRecord(payload);
      savedId = row.id;
    }
    // مرآة كشف الدوام: من يُضاف هنا (إداري/مهني/مستخدم/حارس) يظهر فوراً في تبويب
    // «الكادر» بلا إعادة تحميل. فشلها لا يُسقط الحفظ — السجلّ نفسه محفوظ.
    try {
      await NDB.syncPersonnelFromStaffRecord({
        staffRecordId: savedId, schoolId: S.school.id,
        fullName: payload.full_name, staffType: payload.staff_type,
        nationalId: payload.national_id,
      });
      await Promise.all([loadPersonnelRoster(), loadRosterCard(), loadStaffAttendance()]);
    } catch (mirrorErr) {
      console.warn('[NSAMS] syncPersonnelFromStaffRecord (non-fatal)', mirrorErr);
    }

    toast(_regEditId ? 'تم تحديث البيانات' : 'تمت الإضافة إلى السجل', 'success');
    closeStaffRecModal();
    await loadRegistryRecords();
  } catch (err) {
    console.error('[NSAMS] saveStaffRecord', err);
    if (srError) { srError.textContent = 'تعذّر الحفظ. تحقق من البيانات وحاول مجدداً.'; show(srError); }
  } finally {
    if (btnSaveStaffRec) btnSaveStaffRec.disabled = false;
    if (srSaveSpinner) srSaveSpinner.hidden = true;
  }
});

// ── Leaves Modal ──────────────────────────────────────────────────────────────
async function openLeavesModal(rec) {
  _leavesStaff = rec;
  if (leavesStaffName) leavesStaffName.textContent = rec.full_name;
  const now = new Date();
  if (leavesMonthSel) leavesMonthSel.value = String(now.getMonth() + 1);
  if (leavesYearIn)   leavesYearIn.value   = String(now.getFullYear());
  const types = await getLookup('leave_type');
  fillSel(leaveTypeSel, types, '— نوع الإجازة —');
  if (leaveDaysIn) leaveDaysIn.value = '';
  await loadLeavesForStaff();
  hide(leavesError);
  show(modalLeaves);
  document.body.style.overflow = 'hidden';
}

function closeLeavesModal() {
  hide(modalLeaves);
  document.body.style.overflow = '';
  _leavesStaff = null;
}
btnCloseLeaves?.addEventListener('click', closeLeavesModal);
modalLeaves?.addEventListener('click', e => { if (e.target === modalLeaves) closeLeavesModal(); });

async function loadLeavesForStaff() {
  if (!_leavesStaff || !S.school?.id) return;
  const month = parseInt(leavesMonthSel?.value || 1);
  const year  = parseInt(leavesYearIn?.value   || new Date().getFullYear());
  try {
    const all = await NDB.getStaffLeaves(S.school.id, month, year);
    const my  = all.filter(l => l.staff_id === _leavesStaff.id);
    if (leavesList) leavesList.innerHTML = my.length
      ? my.map(l => `<li class="leave-row" data-id="${l.id}">
          <span class="leave-type">${escapeHtml(l.leave_type)}</span>
          <span class="leave-days">${l.leave_days} يوم</span>
          <button class="icon-btn" data-act="del-leave" aria-label="حذف الإجازة">
            <svg class="icon icon-sm"><use href="#ic-trash"/></svg>
          </button>
        </li>`).join('')
      : '<li style="padding:8px 0;color:#94A3B8;font-size:.85rem">لا توجد إجازات لهذا الشهر</li>';
  } catch (err) {
    console.error('[NSAMS] loadLeavesForStaff', err);
  }
}

leavesMonthSel?.addEventListener('change', loadLeavesForStaff);
leavesYearIn?.addEventListener('change',   loadLeavesForStaff);

btnSaveLeave?.addEventListener('click', async () => {
  const type = leaveTypeSel?.value;
  const days = parseInt(leaveDaysIn?.value || '0');
  hide(leavesError);
  if (!type) { if (leavesError) { leavesError.textContent = 'اختر نوع الإجازة'; show(leavesError); } return; }
  if (!days || days < 1) { if (leavesError) { leavesError.textContent = 'أدخل عدد أيام صحيح (1 على الأقل)'; show(leavesError); } return; }
  try {
    await NDB.upsertStaffLeave({
      staff_id:   _leavesStaff.id,
      school_id:  S.school.id,
      leave_type: type,
      leave_days: days,
      month:      parseInt(leavesMonthSel.value),
      year:       parseInt(leavesYearIn.value),
    });
    if (leaveTypeSel) { leaveTypeSel.value = ''; CustomSelect.refresh(leaveTypeSel); }
    if (leaveDaysIn)    leaveDaysIn.value  = '';
    await loadLeavesForStaff();
    toast('تم تسجيل الإجازة', 'success');
  } catch (err) {
    console.error('[NSAMS] saveLeave', err);
    if (leavesError) { leavesError.textContent = 'تعذّر الحفظ'; show(leavesError); }
  }
});

leavesList?.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act="del-leave"]');
  if (!btn) return;
  const id = btn.closest('.leave-row')?.dataset.id;
  if (!id) return;
  try {
    await NDB.deleteStaffLeave(id);
    await loadLeavesForStaff();
  } catch (err) {
    toast('تعذّر حذف الإجازة', 'error');
  }
});

// ── Delete Confirm Modal ──────────────────────────────────────────────────────
function openDelStaffModal(rec) {
  _delStaffId = rec.id;
  if (delStaffName) delStaffName.textContent = rec.full_name;
  hide(delStaffError);
  show(modalDelStaff);
  document.body.style.overflow = 'hidden';
}

function closeDelStaffModal() {
  hide(modalDelStaff);
  document.body.style.overflow = '';
  _delStaffId = null;
}
btnCloseDelStaff?.addEventListener('click', closeDelStaffModal);
modalDelStaff?.addEventListener('click', e => { if (e.target === modalDelStaff) closeDelStaffModal(); });

btnConfirmDel?.addEventListener('click', async () => {
  if (!_delStaffId) return;
  if (btnConfirmDel) btnConfirmDel.disabled = true;
  const spinner = el('del-staff-spinner');
  if (spinner) spinner.hidden = false;
  try {
    await NDB.softDeleteStaffRecord(_delStaffId);
    // المرآة تتبع مصدرها: حذف السجلّ يُخرج صاحبه من كشف الدوام كذلك، وإلا بقي
    // شبحاً يُطالَب بحضوره كل صباح.
    try {
      await NDB.deactivatePersonnelForStaffRecord(_delStaffId);
      await Promise.all([loadPersonnelRoster(), loadRosterCard(), loadStaffAttendance()]);
    } catch (mirrorErr) {
      console.warn('[NSAMS] deactivatePersonnelForStaffRecord (non-fatal)', mirrorErr);
    }
    toast('تم حذف الكادر من السجل', 'success');
    closeDelStaffModal();
    await loadRegistryRecords();
  } catch (err) {
    console.error('[NSAMS] delStaffRecord', err);
    if (delStaffError) { delStaffError.textContent = 'تعذّر الحذف'; show(delStaffError); }
  } finally {
    if (btnConfirmDel) btnConfirmDel.disabled = false;
    if (spinner) spinner.hidden = true;
  }
});

// Registry tab selects (populated dynamically — enhance once, refresh on populate)
CustomSelect.enhance('sr-job-title');
CustomSelect.enhance('sr-specialization');
CustomSelect.enhance('sr-roster-type');
CustomSelect.enhance('sr-certificate');
CustomSelect.enhance('sr-higher-degree');
CustomSelect.enhance('sr-edu-zone');
CustomSelect.enhance('sr-min-doc');
CustomSelect.enhance('leave-type-sel');
CustomSelect.enhance('leaves-month-sel');
CustomSelect.enhance('status-new');

// ─────────────────────────────────────────────────────────────────────────────
// § التكاليف (staff_assignments) — المرحلة 3أ
// ─────────────────────────────────────────────────────────────────────────────

let _asnSegment   = 'technical';   // 'technical' | 'administrative'
let _asnAll       = [];
let _asnEditId    = null;
let _asnClasses   = [];
let _asnTeachers  = [];
let _asnSubjects  = [];            // subjects for the currently selected class grade

const asnList         = el('asn-list');
const asnLoading      = el('asn-loading');
const asnError        = el('asn-error');
const asnEmpty        = el('asn-empty');
const btnRefreshAsn   = el('btn-refresh-assignments');
const btnAddAsn       = el('btn-add-assignment');
const modalAsn        = el('modal-staff-assignment');
const btnCloseAsn     = el('btn-close-assignment');
const asnTitle        = el('asn-title');
const asnKind         = el('asn-kind');
const asnJobTitle     = el('asn-job-title');
const asnTechFields   = el('asn-technical-fields');
const asnClass        = el('asn-class');
const asnSection      = el('asn-section');
const asnSubjects     = el('asn-subjects');
const asnLessonCount  = el('asn-lesson-count');
const asnUser         = el('asn-user');
const asnStartDate    = el('asn-start-date');
const asnCommenceDate = el('asn-commence-date');
const asnAssignDate   = el('asn-assignment-date');
const asnExecStart    = el('asn-execution-start');
const asnFormError    = el('asn-form-error');
const asnSaveSpinner  = el('asn-save-spinner');
const btnSaveAsn      = el('btn-save-assignment');

CustomSelect.enhance('asn-kind');
CustomSelect.enhance('asn-job-title');
CustomSelect.enhance('asn-class');
CustomSelect.enhance('asn-user');

async function loadAssignments() {
  if (!S.school?.id) return;
  show(asnLoading); hide(asnError);
  try {
    _asnAll = await NDB.getStaffAssignments(S.school.id);
    renderAssignments();
  } catch (err) {
    console.error('[NSAMS] loadAssignments', err);
    show(asnError);
  } finally {
    hide(asnLoading);
  }
}

function renderAssignments() {
  const filtered = _asnAll.filter(a => a.assignment_kind === _asnSegment);
  if (!filtered.length) {
    show(asnEmpty);
    if (asnList) asnList.innerHTML = '';
    return;
  }
  hide(asnEmpty);
  if (asnList) asnList.innerHTML = filtered.map(a => {
    const cls = a.class_id ? (_asnClasses.find(c => c.id === a.class_id)) : null;
    const clsLabel = cls ? (cls.name || `${gradeLabel(cls.grade)} / ${cls.section ?? ''}`.trim()) : '';
    const synced = a.assignment_kind === 'technical' && a.class_id && a.user_id
      ? '<span class="reg-linked-badge">مُزامَن مع صلاحية المعلّم</span>' : '';
    const meta = [clsLabel, a.section ? `شعبة ${a.section}` : '',
      a.lesson_count != null ? `${a.lesson_count} درساً` : ''].filter(Boolean).join(' · ');
    return `<li class="reg-row" data-id="${a.id}">
      <div class="reg-row-main">
        <div class="reg-name">${escapeHtml(a.job_title)}${synced}</div>
        ${meta ? `<div class="reg-meta">${escapeHtml(meta)}</div>` : ''}
      </div>
      <div class="reg-row-acts">
        <button class="icon-btn" data-act="edit" aria-label="تعديل" title="تعديل">
          <svg class="icon icon-sm"><use href="#ic-edit"/></svg>
        </button>
        <button class="icon-btn" data-act="end" aria-label="إنهاء" title="إنهاء التكليف">
          <svg class="icon icon-sm"><use href="#ic-trash"/></svg>
        </button>
      </div>
    </li>`;
  }).join('');
}

// Segment switching
document.querySelectorAll('.asn-seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    _asnSegment = btn.dataset.asnSeg;
    document.querySelectorAll('.asn-seg-btn').forEach(b =>
      b.classList.toggle('is-active', b === btn));
    renderAssignments();
  });
});

// Row actions
asnList?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const li  = btn.closest('.reg-row');
  const asn = _asnAll.find(a => a.id === li?.dataset.id);
  if (!asn) return;
  if (btn.dataset.act === 'edit') openAssignmentModal(asn);
  else if (btn.dataset.act === 'end') {
    if (!await askConfirm('إنهاء هذا التكليف؟ سيُزال جسر الصلاحية المُزامَن إن وُجد.', 'إنهاء')) return;
    try {
      await NDB.endStaffAssignment(asn.id);
      toast('أُنهي التكليف', 'success');
      await loadAssignments();
    } catch (err) {
      console.error('[NSAMS] endStaffAssignment', err);
      toast('تعذّر إنهاء التكليف', 'error');
    }
  }
});

btnAddAsn?.addEventListener('click', () => openAssignmentModal(null));
btnRefreshAsn?.addEventListener('click', loadAssignments);

function _renderAsnKindFields() {
  const isTech = asnKind.value === 'technical';
  if (asnTechFields) asnTechFields.hidden = !isTech;
}

function _fillAsnSubjects(selectedIds = []) {
  if (!asnSubjects) return;
  if (!_asnSubjects.length) {
    asnSubjects.innerHTML = '<span class="empty-hint">اختر صفاً لعرض المواد.</span>';
    return;
  }
  asnSubjects.innerHTML = _asnSubjects.map(s => `
    <label class="asn-subj-chip">
      <input type="checkbox" value="${escapeHtml(s.id)}" ${selectedIds.includes(s.id) ? 'checked' : ''} />
      <span>${escapeHtml(s.name)}</span>
    </label>`).join('');
}

async function _loadAsnSubjectsForClass(classId, selectedIds = []) {
  const cls = _asnClasses.find(c => c.id === classId);
  if (!cls) { _asnSubjects = []; _fillAsnSubjects([]); return; }
  try {
    _asnSubjects = (await NDB.getSchoolSubjects(S.school.id, cls.grade)).filter(s => s.is_active);
  } catch { _asnSubjects = []; }
  _fillAsnSubjects(selectedIds);
}

asnKind?.addEventListener('change', _renderAsnKindFields);
asnClass?.addEventListener('change', () => _loadAsnSubjectsForClass(asnClass.value, []));

async function openAssignmentModal(asn) {
  _asnEditId = asn?.id ?? null;
  if (asnTitle) asnTitle.textContent = asn ? 'تعديل تكليف' : 'إضافة تكليف';

  // Load classes + teacher accounts once per open (cheap, keeps data fresh).
  try {
    [_asnClasses, _asnTeachers] = await Promise.all([
      NDB.getSchoolClasses(S.school.id),
      NDB.getTeachersBySchool(S.school.id),
    ]);
  } catch (err) { console.warn('[NSAMS] openAssignmentModal load', err); }

  // Kind
  asnKind.value = asn?.assignment_kind || _asnSegment;
  CustomSelect.refresh(asnKind);
  _renderAsnKindFields();

  // Job title list depends on kind
  const listType = asnKind.value === 'technical' ? 'job_title' : 'school_admin_role';
  const titles = await getLookup(listType);
  fillSel(asnJobTitle, titles);
  asnJobTitle.value = asn?.job_title || '';
  CustomSelect.refresh(asnJobTitle);

  // Classes
  asnClass.innerHTML = '<option value="">— بلا صف —</option>' + _asnClasses.map(c =>
    `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || `${gradeLabel(c.grade)} / ${c.section ?? ''}`.trim())}</option>`
  ).join('');
  asnClass.value = asn?.class_id || '';
  CustomSelect.refresh(asnClass);

  // Teacher accounts (for sync)
  asnUser.innerHTML = '<option value="">— بلا مزامنة —</option>' + _asnTeachers.map(t =>
    `<option value="${escapeHtml(t.id)}">${escapeHtml(t.fullName)}</option>`).join('');
  asnUser.value = asn?.user_id || '';
  CustomSelect.refresh(asnUser);

  // Subjects for the selected class
  await _loadAsnSubjectsForClass(asn?.class_id || '', asn?.subject_ids || []);

  asnSection.value      = asn?.section        || '';
  asnLessonCount.value  = asn?.lesson_count   ?? '';
  asnStartDate.value    = asn?.start_date     || '';
  asnCommenceDate.value = asn?.commence_date  || '';
  asnAssignDate.value   = asn?.assignment_date|| '';
  asnExecStart.value    = asn?.execution_start|| '';

  hide(asnFormError);
  show(modalAsn);
  if (!asn) modalAsn.querySelector('.sheet-body').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeAssignmentModal() {
  hide(modalAsn);
  document.body.style.overflow = '';
  _asnEditId = null;
}
btnCloseAsn?.addEventListener('click', closeAssignmentModal);
modalAsn?.addEventListener('click', e => { if (e.target === modalAsn) closeAssignmentModal(); });

// Update job-title list when kind changes inside the modal
asnKind?.addEventListener('change', async () => {
  const listType = asnKind.value === 'technical' ? 'job_title' : 'school_admin_role';
  const titles = await getLookup(listType);
  const prev = asnJobTitle.value;
  fillSel(asnJobTitle, titles);
  asnJobTitle.value = titles.includes(prev) ? prev : '';
  CustomSelect.refresh(asnJobTitle);
});

btnSaveAsn?.addEventListener('click', async () => {
  hide(asnFormError);
  const kind = asnKind.value;
  const jobTitle = asnJobTitle.value;
  if (!jobTitle) {
    asnFormError.textContent = 'اختر الصفة / العمل المسند.'; show(asnFormError); return;
  }
  const selectedSubjects = asnSubjects
    ? [...asnSubjects.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value)
    : [];

  const payload = {
    id:              _asnEditId || undefined,
    assignment_kind: kind,
    job_title:       jobTitle,
    class_id:        kind === 'technical' ? (asnClass.value || undefined) : undefined,
    section:         kind === 'technical' ? (asnSection.value.trim() || undefined) : undefined,
    subject_ids:     kind === 'technical' ? selectedSubjects : [],
    lesson_count:    kind === 'technical' && asnLessonCount.value ? Number(asnLessonCount.value) : undefined,
    user_id:         kind === 'technical' ? (asnUser.value || undefined) : undefined,
    start_date:      asnStartDate.value || undefined,
    commence_date:   asnCommenceDate.value || undefined,
    assignment_date: asnAssignDate.value || undefined,
    execution_start: asnExecStart.value || undefined,
    academic_year:   NDB.getAcademicYear(),
  };

  if (btnSaveAsn) btnSaveAsn.disabled = true;
  if (asnSaveSpinner) asnSaveSpinner.hidden = false;
  try {
    await NDB.upsertStaffAssignment(payload);
    toast(_asnEditId ? 'تم تحديث التكليف' : 'تمت إضافة التكليف', 'success');
    closeAssignmentModal();
    await loadAssignments();
  } catch (err) {
    console.error('[NSAMS] upsertStaffAssignment', err);
    asnFormError.textContent = 'تعذّر حفظ التكليف. تحقق من البيانات وحاول مجدداً.';
    show(asnFormError);
  } finally {
    if (btnSaveAsn) btnSaveAsn.disabled = false;
    if (asnSaveSpinner) asnSaveSpinner.hidden = true;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// § البيان الشهري — statement tab
//
// عشرة أقسام تغطّي أوراق النموذج الرسمي السبع. الشريط اللاصق يحكم الفترة،
// وشريط الأقسام يعرض قسماً واحداً في كل مرّة: النموذج ٢٠٠ حقل، فعرضها دفعةً
// واحدة يُنتج صفحة تتجاوز ٤٠٠٠px ويقفز فيها المستخدم بلا مرجع.
//
// مصدر الحقيقة هو صفّ monthly_statements (status='draft') لا localStorage:
// سطور التعديلات الطارئة تحتاج statement_id، والمسودة تُحفظ تلقائياً في
// snapshot_data. localStorage صار احتياطاً للعمل دون اتصال فقط.
// ─────────────────────────────────────────────────────────────────────────────

let _statementLoaded = false;

// Arabic number words for 0-99 (used in column P of البيان template)
const _arNumWords = [
  'صفر','واحد','اثنان','ثلاثة','أربعة','خمسة','ستة','سبعة','ثمانية','تسعة','عشرة',
  'أحد عشر','اثنا عشر','ثلاثة عشر','أربعة عشر','خمسة عشر','ستة عشر','سبعة عشر',
  'ثمانية عشر','تسعة عشر','عشرون','واحد وعشرون','اثنان وعشرون','ثلاثة وعشرون',
  'أربعة وعشرون','خمسة وعشرون','ستة وعشرون','سبعة وعشرون','ثمانية وعشرون',
  'تسعة وعشرون','ثلاثون','واحد وثلاثون','اثنان وثلاثون','ثلاثة وثلاثون',
  'أربعة وثلاثون','خمسة وثلاثون','ستة وثلاثون','سبعة وثلاثون','ثمانية وثلاثون',
  'تسعة وثلاثون','أربعون','واحد وأربعون','اثنان وأربعون','ثلاثة وأربعون',
  'أربعة وأربعون','خمسة وأربعون','ستة وأربعون','سبعة وأربعون','ثمانية وأربعون',
  'تسعة وأربعون','خمسون','واحد وخمسون','اثنان وخمسون','ثلاثة وخمسون',
  'أربعة وخمسون','خمسة وخمسون','ستة وخمسون','سبعة وخمسون','ثمانية وخمسون',
  'تسعة وخمسون','ستون','واحد وستون','اثنان وستون','ثلاثة وستون','أربعة وستون',
  'خمسة وستون','ستة وستون','سبعة وستون','ثمانية وستون','تسعة وستون','سبعون',
  'واحد وسبعون','اثنان وسبعون','ثلاثة وسبعون','أربعة وسبعون','خمسة وسبعون',
  'ستة وسبعون','سبعة وسبعون','ثمانية وسبعون','تسعة وسبعون','ثمانون',
  'واحد وثمانون','اثنان وثمانون','ثلاثة وثمانون','أربعة وثمانون','خمسة وثمانون',
  'ستة وثمانون','سبعة وثمانون','ثمانية وثمانون','تسعة وثمانون','تسعون',
  'واحد وتسعون','اثنان وتسعون','ثلاثة وتسعون','أربعة وتسعون','خمسة وتسعون',
  'ستة وتسعون','سبعة وتسعون','ثمانية وتسعون','تسعة وتسعون',
];
function arNumWord(n) {
  const i = Math.round(n);
  if (i >= 0 && i < _arNumWords.length) return _arNumWords[i];
  return String(i);
}

// أرقام البيان تُعرض لاتينية — كما تُكتب في الورقة الرسمية وكما تُخزَّن
// وتُصدَّر. (كانت تُحوَّل إلى هندية للعرض، فاختلف ما يراه المدير عمّا يُسلَّم.)
function stmtNum(n) {
  return String(n ?? 0);
}

// Month labels matching template format
const MONTH_LABELS = [
  '', '1 / يناير / كانون الثاني', '2 / فبراير / شباط', '3 / مارس / آذار',
  '4 / أبريل / نيسان', '5 / مايو / أيار', '6 / يونيو / حزيران',
  '7 / يوليو / تموز', '8 / أغسطس / آب', '9 / سبتمبر / أيلول',
  '10 / أكتوبر / تشرين الأول', '11 / نوفمبر / تشرين الثاني', '12 / ديسمبر / كانون الأول',
];
const MONTH_SHORT = ['', 'كانون الثاني','شباط','آذار','نيسان','أيار','حزيران',
                     'تموز','آب','أيلول','تشرين الأول','تشرين الثاني','كانون الأول'];

// Admin role order matching template rows M20..M36 (المجموع في M38)
// ⚠ الهمزات هنا يجب أن تطابق قيم lookup_lists حرفياً وإلا ظهر الصف صفراً
// رغم وجود موظفين — لذلك تُطبَّع الأسماء بـ _stmtNormRole قبل المطابقة.
const ADMIN_ROLE_ORDER = [
  'مدير','معاون مدير','توجيه','أمانة سر','معاون أمين سر',
  'أمانة مكتبة','معاون أمين مكتبة','أمين مخبر','مساعد أمين مخبر',
  'أمين سر حاسوب','م. أمين سر حاسوب','ارشاد اجتماعي','ارشاد نفسي',
  'أمين مشغل','انشطة لاصفية','كاتب','مشرف جاهزية',
];
// تطبيع يزيل الهمزات والمسافات الزائدة، فتتطابق «امين مخبر» مع «أمين مخبر».
function _stmtNormRole(s) {
  return String(s || '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[.‏‎]/g, '').replace(/\s+/g, ' ').trim();
}
const _ADMIN_ROLE_NORM = ADMIN_ROLE_ORDER.map(_stmtNormRole);

// تصنيفات الجهاز التدريسي — بنفس ترتيب خلايا الورقة الرسمية (الصفوف ١٣–١٥)
const STMT_TEACH_TEACHERS = [
  ['معلم صف','E13'], ['تعميق تأهيل','G13'], ['أهلية تعليم','E14'], ['ق. 38','E15'],
];
const STMT_TEACH_MASTERS = [
  ['عربي','J13'], ['رياضيات','J14'], ['فيزياء+كيمياء','J15'],
  ['تاريخ','L13'], ['جغرافية','L14'], ['قومية','L15'],
  ['اسلامية','N13'], ['مسيحية','N14'], ['معلوماتية','N15'],
  ['انكليزي','P13'], ['فرنسي','P14'], ['روسي','P15'],
  ['علوم','R13'], ['رياضة','R14'], ['فنون','R15'],
  ['تجارة واقتصاد','T13'], ['فلسفة','T14'], ['مهندس','T15'],
];
const STMT_TEACH_ASSIST = [
  ['عربي','W13'], ['رياضيات','W14'], ['علوم','W15'],
  ['انكليزي','Y13'], ['فرنسي','Y14'], ['موسيقا','Y15'],
  ['فنون','AA13'], ['معلوماتية','AA14'], ['رياضة','AA15'],
];

// Grade key → DB grade value(s) mapping — الترتيب هو ترتيب صفوف الورقة ٢٢..٤١
const GRADE_KEY_MAP = {
  'استعدوا': ['استعدوا','0'],
  '1':['1'],'2':['2'],'3':['3'],'4':['4'],'5':['5'],
  '6':['6'],'7':['7'],'8':['8'],'9':['9'],
  'م1':['المستوى 1','المستوى الأول','10'],
  'م2':['المستوى 2','المستوى الثاني','11'],
  'م3':['المستوى 3','المستوى الثالث','12'],
  'م4':['المستوى 4','المستوى الرابع','13'],
  'ث1أ':['الأول الثانوي أدبي','الأول الثانوي(أدبي)','10ث'],
  'ث1ع':['الأول الثانوي علمي','الأول الثانوي(علمي)','10ثع'],
  'ث2أ':['الثاني الثانوي أدبي','الثاني الثانوي(أدبي)','11ث'],
  'ث2ع':['الثاني الثانوي علمي','الثاني الثانوي(علمي)','11ثع'],
  'ث3أ':['الثالث الثانوي أدبي','الثالث الثانوي(أدبي)','12ث'],
  'ث3ع':['الثالث الثانوي علمي','الثالث الثانوي(علمي)','12ثع'],
};
const GRADE_LABELS = {
  'استعدوا':'استعدوا','1':'الأول','2':'الثاني','3':'الثالث','4':'الرابع','5':'الخامس',
  '6':'السادس','7':'السابع','8':'الثامن','9':'التاسع',
  'م1':'المستوى الأول','م2':'المستوى الثاني','م3':'المستوى الثالث','م4':'المستوى الرابع',
  'ث1أ':'الأول الثانوي (أدبي)','ث1ع':'الأول الثانوي (علمي)',
  'ث2أ':'الثاني الثانوي (أدبي)','ث2ع':'الثاني الثانوي (علمي)',
  'ث3أ':'الثالث الثانوي (أدبي)','ث3ع':'الثالث الثانوي (علمي)',
};
// ⚠ الترتيب هنا هو ترتيب الصفوف C22..C41 في ورقة «البيان»، والتصدير يكتب
// الأعداد **بالموضع** في تلك الصفوف. لا تُشتقّ هذه المصفوفة من
// Object.keys(GRADE_KEY_MAP): جافاسكربت ترفع المفاتيح الشبيهة بمؤشّرات المصفوفة
// ('1'..'9') إلى مقدّمة الكائن مهما كان ترتيب الكتابة، فيصير «استعدوا» عاشراً
// وتُزاح أعداد كل الصفوف سطراً كاملاً في الورقة الرسمية.
// «استعدوا» صفّ روضة لا صفّ ابتدائي — يتصدّر الجدول كما في الورقة، ويُحتسب
// ضمن «رياض» في _stmtStudentTotals لا ضمن حلقة (1).
const GRADE_KEYS = [
  'استعدوا', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'م1', 'م2', 'م3', 'م4',
  'ث1أ', 'ث1ع', 'ث2أ', 'ث2ع', 'ث3أ', 'ث3ع',
];

// Flatten to a reverse map: dbGrade → gradeKey
const DB_GRADE_TO_KEY = {};
for (const [key, vals] of Object.entries(GRADE_KEY_MAP)) {
  for (const v of vals) DB_GRADE_TO_KEY[String(v)] = key;
}

// أقسام التبويب — الترتيب هو ترتيب الشريط والصفحات
const STMT_SECS = [
  { short: 'الترويسة',  full: 'الترويسة والتسليم' },
  { short: 'المدرسة',   full: 'هوية المدرسة' },
  { short: 'البناء',    full: 'البناء المدرسي' },
  { short: 'الطلاب',    full: 'الطلاب والشعب' },
  { short: 'التدريسي',  full: 'الجهاز التدريسي' },
  { short: 'الإداري',   full: 'الجهاز الإداري' },
  { short: 'الكوادر',   full: 'قوائم الكوادر — السير الذاتية' },
  { short: 'التعديلات', full: 'التعديلات الطارئة' },
  { short: 'النتائج',   full: 'نتائج نهاية العام' },
  { short: 'الإرسال',   full: 'المراجعة والإرسال' },
];

// أعمدة الأوراق الرسمية الثلاث — [مفتاح, عنوان, مطلوب]
// مفاتيح مركّبة: '@birth' و '@start' تُبنى من يوم/شهر/سنة.
// «الرقم الذاتي» ليس عموداً في النموذج الورقي فلا يُكتب في xlsx، لكنه مفتاح
// الربط بالسجلّ الوطني فيظهر في بطاقات القسم ٧ ويُحفظ في جدول السير المحمي.
const STMT_ROSTER_FIELDS = {
  admin: [
    ['national_id','الرقم الوطني',1], ['self_number','الرقم الذاتي',0],
    ['mother_name','الأم',1], ['@birth','تاريخ الولادة',1],
    ['certificate','الشهادة /ج/م.م/أ.ه/ثا',1], ['specialization','الاختصاص',1],
    ['seniority_year','القدم الوظيفي (سنة التعيين)',1], ['job_title','العمل المسند إليه',1],
    ['higher_degree','الشهادات العليا',0], ['@start','تاريخ المباشرة بالعمل الإداري الحالي',1],
    ['phone','الهاتف — الجوال',1], ['landline','الهاتف — الأرضي',0],
    ['residential_zone','المنطقة السكنية',1], ['@leave','إجازات ادارية/صحية/أمومة/زواج',0],
    ['ministerial_doc','نوع الوثيقة / موافقة وزارية',0], ['notes','ملاحظات / عن أي بيانات مدخلة',0],
  ],
  teaching: [
    ['national_id','الرقم الوطني',1], ['self_number','الرقم الذاتي',0],
    ['mother_name','الأم',1], ['@birth','تاريخ الولادة',1],
    ['certificate','الشهادة ج/م.م/أ.ه/ثا',1], ['specialization','الاختصاص',1],
    ['seniority_year','القدم الوظيفي (سنة التعيين)',1], ['subject_taught','المادة التي يدرسها',1],
    ['teaching_hours','عدد الساعات التي يدرسها',1],
    ['quota_subjects','المواد التي يكمل فيها نصابه في مدرسته وعددها',0],
    ['quota_school_external','المدرسة التي يكمل نصابه بها وعددها',0],
    ['assigned_grade','الصف',0], ['assigned_section','الشعبة',0],
    ['@start','تاريخ المباشرة في المدرسة',1],
    ['phone','الهاتف — الجوال',1], ['landline','الهاتف — الأرضي',0],
    ['residential_zone','المنطقة السكنية',1], ['@leave','إجازات ادارية/صحية/أمومة/زواج',0],
    ['ministerial_doc','نوع الوثيقة / موافقة وزارية',0], ['notes','ملاحظات / عن أي بيانات مدخلة',0],
  ],
  support: [
    ['national_id','الرقم الوطني',1], ['self_number','الرقم الذاتي',0],
    ['mother_name','الأم',1], ['@birth','تاريخ الولادة',1],
    ['certificate','الشهادة',1], ['seniority_year','القدم الوظيفي (سنة التعيين)',1],
    ['job_title','العمل المسند إليه',1], ['@start','تاريخ المباشرة في المدرسة',1],
    ['phone','الهاتف — الجوال',1], ['landline','الهاتف — الأرضي',0],
    ['residential_zone','السكن',1], ['@leave','إجازات ادارية/صحية/أمومة/زواج',0],
    ['ministerial_doc','نوع الوثيقة / موافقة وزارية',0], ['notes','ملاحظات / عن أي بيانات مدخلة',0],
  ],
};
const STMT_ROSTER_LABELS = { admin: 'الإداري', teaching: 'التدريسي', support: 'مهنيون ومستخدمون وحراس' };
// staff_records.staff_type القيم المسموحة: admin | teaching | professional | worker | guard
// «support» ليست قيمة في القاعدة — كان الكود يقارن بها فيخرج صفراً دائماً.
const STMT_SUPPORT_TYPES = ['professional','worker','guard'];

const STMT_EVENTS = ['مباشرة','انفكاك','نقل','تقاعد','وفاة','أخرى'];

// ── أعمدة ورقة «التعديلات الطارئة الشهرية» ──────────────────────────────────
// مستخرجة حرفياً من القالب: كتلة الإداري (رؤوس السطر ٩)، التدريسي (١٥)،
// المهنيين والمستخدمين والحراس (٢٢). كل عمود حقلٌ يُملأ يدوياً ويُمحى يدوياً —
// حتى المملوء آلياً من سجلّ الكوادر يبقى قابلاً للتعديل.
// [مفتاح, عنوان, نوع, مطلوب؟] — 'date' يعني ثلاثة حقول يوم/شهر/سنة.
const _CHG_ID   = ['national_id','الرقم الوطني','text'];
const _CHG_SELF  = ['self_number','الرقم الذاتي','text'];
const _CHG_NAME  = ['full_name','الاسم الثلاثي','text', 1];
const _CHG_MOM   = ['mother_name','الأم','text'];
const _CHG_BIRTH = ['@birth','تاريخ الولادة','date'];
const _CHG_CERT  = ['certificate','الشهادة /ج/م.م/أ.ه/ثا','text'];
const _CHG_SPEC  = ['specialization','الاختصاص','text'];
const _CHG_SEN   = ['seniority_year','القدم الوظيفي (سنة التعيين)','num'];
const _CHG_PHONE = ['phone','الهاتف — الجوال','text'];
const _CHG_LAND  = ['landline','الهاتف — الأرضي','text'];
const _CHG_LEAVE = ['leave_text','إجازات ادارية / صحية / أمومة / زواج','text'];
const _CHG_DOC   = ['ministerial_doc','نوع الوثيقة / موافقة وزارية','text'];
const _CHG_NOTES = ['notes','ملاحظات / عن أي بيانات مدخلة','textarea'];

const STMT_CHG_FIELDS = {
  admin: [
    _CHG_ID, _CHG_SELF, _CHG_NAME, _CHG_MOM, _CHG_BIRTH, _CHG_CERT, _CHG_SPEC, _CHG_SEN,
    ['job_title','العمل المسند إليه','text'],
    ['higher_degree','الشهادات العليا','text'],
    ['@start','تاريخ المباشرة بالعمل الإداري الحالي','date'],
    _CHG_PHONE, _CHG_LAND,
    ['residential_zone','المنطقة السكنية','text'],
    _CHG_LEAVE, _CHG_DOC, _CHG_NOTES,
  ],
  teaching: [
    _CHG_ID, _CHG_SELF, _CHG_NAME, _CHG_MOM, _CHG_BIRTH, _CHG_CERT, _CHG_SPEC, _CHG_SEN,
    ['subject_taught','المادة التي يدرسها','text'],
    ['teaching_hours','عدد الساعات التي يدرسها','num'],
    ['quota_subjects','المواد التي يكمل فيها نصابه في مدرسته وعددها','text'],
    ['quota_school_external','المدرسة التي يكمل نصابه بها وعددها','text'],
    ['assigned_grade','الصف','text'],
    ['assigned_section','الشعبة','text'],
    ['@start','تاريخ المباشرة في المدرسة','date'],
    _CHG_PHONE, _CHG_LAND,
    ['residential_zone','المنطقة السكنية','text'],
    _CHG_LEAVE, _CHG_DOC, _CHG_NOTES,
  ],
  support: [
    _CHG_ID, _CHG_SELF, _CHG_NAME, _CHG_MOM, _CHG_BIRTH, _CHG_CERT, _CHG_SPEC, _CHG_SEN,
    ['job_title','العمل المسند إليه','text'],
    ['@start','تاريخ المباشرة في المدرسة','date'],
    _CHG_PHONE, _CHG_LAND,
    ['residential_zone','السكن','text'],
    ['roster_note','داخل الملاك / تحديد مركز عمل محافظة','text'],
    _CHG_LEAVE,
    ['ministerial_doc','ملاحظات إدارية / نوع الوثيقة / موافقة وزارية','text'],
    _CHG_NOTES,
  ],
};

// مفتاح الحقل → عمود staff_records، لتعبئة النافذة من السجلّ عند اختيار شخص.
// ما ليس هنا يُشتقّ خاصّةً (@birth و@start و leave_text و roster_note).
const STMT_CHG_FROM_REC = [
  'national_id','self_number','full_name','mother_name','certificate','specialization',
  'seniority_year','job_title','higher_degree','phone','landline','residential_zone',
  'ministerial_doc','notes','subject_taught','teaching_hours','quota_subjects',
  'quota_school_external','assigned_grade','assigned_section',
];
const STMT_ROSTER_TYPE_LABEL = { inside: 'داخل الملاك', outside: 'خارج الملاك', contract: 'عقود' };

// حالة التبويب — كل ما يُعرض ويُحفظ
const STMT = {
  sec: 0, id: null, status: 'draft', notes: null,
  month: 1, year: new Date().getFullYear(),
  school: null, building: null,
  staff: [], leaves: [], stuStats: {}, changes: [], prev: null,
  header: {}, students: {}, adminOverride: {}, teachFull: null,
  yearEnd: null, sig: {}, noChange: false,
  rosG: 'admin', rosQ: '', rosMiss: false,
  saveTimer: null, loading: false, chgEditId: null, chgGroup: 'admin',
};

// ── أدوات مساعدة ─────────────────────────────────────────────────────────────

function _stmtVal(id) { return el(id)?.value?.trim() ?? ''; }
function _stmtNum(id) { const v = parseInt(el(id)?.value ?? '', 10); return Number.isFinite(v) ? v : 0; }
function _stmtSet(id, v) { const e = el(id); if (e) e.value = (v ?? '') === null ? '' : (v ?? ''); }

// تاريخ ISO → 'يوم/شهر/سنة' كما يُكتب في الورقة
function _stmtDMY(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return '';
  return `${Number(d)}/${Number(m)}/${y}`;
}

// فئة الورقة التي ينتمي إليها الكادر
function _stmtGroupOf(rec) {
  if (rec.staff_type === 'admin') return 'admin';
  if (rec.staff_type === 'teaching') return 'teaching';
  return 'support';
}

// إجازات الشهر لكل كادر، مجمّعة نصّاً كما تُكتب في خانة الإجازات
function _stmtLeaveText(staffId) {
  const parts = STMT.leaves
    .filter(l => l.staff_id === staffId)
    // العمود اسمه leave_days — كتابة lv.days كانت تطبع «undefined» في الورقة
    .map(l => `${l.leave_type} ${l.leave_days}`);
  return parts.join(' + ');
}

// قيمة حقل واحد من سجل كادر بمنطق الأعمدة المركّبة
function _stmtFieldVal(rec, key) {
  if (key === '@birth') return _stmtDMY(rec.birth_date);
  if (key === '@start') return _stmtDMY(rec.start_date);
  if (key === '@leave') return _stmtLeaveText(rec.id);
  const v = rec[key];
  return (v === null || v === undefined || v === '') ? '' : String(v);
}

function _stmtMissingCount(rec) {
  const spec = STMT_ROSTER_FIELDS[_stmtGroupOf(rec)];
  let n = 0;
  for (const [key, , req] of spec) if (req && !_stmtFieldVal(rec, key)) n++;
  return n;
}

// ── تصنيف الجهاز التدريسي ────────────────────────────────────────────────────
// التصنيف استنتاجي، لذا يُحسب مرّة ثم **يُخزَّن** في staff_records.teaching_rank
// ولا يُعاد تخمينه. ومَن لم يطابق لا يُسقَط ولا يُخمَّن: يذهب لسلّة «غير مصنّف»
// وهي خانة رسمية في النموذج نفسه (S23 «عدد الجهاز التدريسي غير المصنف»).
function _stmtInferRank(rec) {
  if (rec.teaching_rank) return rec.teaching_rank;
  const hay = _stmtNormRole(`${rec.job_title || ''} ${rec.specialization || ''} ${rec.certificate || ''}`);
  if (/معلم صف|اهليه تعليم|تعميق|ق ?38/.test(hay)) return 'معلم';
  if (/مدرس مساعد/.test(hay)) return 'مدرس مساعد';
  if (/^مدرس| مدرس/.test(hay)) return 'مدرس';
  if (/معهد/.test(hay)) return 'مدرس مساعد';
  if (/جامعه/.test(hay)) return 'مدرس';
  return null;                       // غير مصنّف — لا تخمين
}

// الخانة الفرعية داخل الرتبة (معلم صف / عربي / …)
function _stmtBucketOf(rec, rank) {
  const list = rank === 'معلم' ? STMT_TEACH_TEACHERS
             : rank === 'مدرس' ? STMT_TEACH_MASTERS
             : STMT_TEACH_ASSIST;
  const hay = _stmtNormRole(`${rec.specialization || ''} ${rec.job_title || ''} ${rec.subject_taught || ''} ${rec.certificate || ''}`);
  for (const [label] of list) {
    if (hay.includes(_stmtNormRole(label))) return label;
  }
  return rank === 'معلم' ? 'معلم صف' : null;
}

// كل أرقام الجهاز التدريسي في مكان واحد
function _stmtTeaching() {
  const buckets = { 'معلم': {}, 'مدرس': {}, 'مدرس مساعد': {} };
  const unclassified = [];
  for (const rec of STMT.staff) {
    if (rec.staff_type !== 'teaching') continue;
    const rank = _stmtInferRank(rec);
    if (!rank) { unclassified.push(rec); continue; }
    const b = _stmtBucketOf(rec, rank);
    if (!b) { unclassified.push(rec); continue; }
    buckets[rank][b] = (buckets[rank][b] || 0) + 1;
  }
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  const teachers = sum(buckets['معلم']);
  const masters  = sum(buckets['مدرس']);
  const assist   = sum(buckets['مدرس مساعد']);
  const bySpec   = teachers + masters + assist;
  // «بشكل كامل» هو العدد الفعلي للكادر التدريسي، و«غير المصنف» فرقه عن المصنَّف.
  const full = STMT.teachFull ?? STMT.staff.filter(r => r.staff_type === 'teaching').length;
  return { buckets, unclassified, teachers, masters, assist, bySpec, full,
           unclassifiedCount: full - bySpec };
}

// أعداد الجهاز الإداري لكل وظيفة (مع إمكان التصحيح اليدوي)
function _stmtAdminCounts() {
  const auto = {};
  const unmapped = [];
  for (const rec of STMT.staff) {
    if (rec.staff_type !== 'admin') continue;
    const idx = _ADMIN_ROLE_NORM.indexOf(_stmtNormRole(rec.job_title));
    if (idx < 0) { unmapped.push(rec); continue; }
    const role = ADMIN_ROLE_ORDER[idx];
    auto[role] = (auto[role] || 0) + 1;
  }
  const rows = ADMIN_ROLE_ORDER.map(role => ({
    role,
    auto: auto[role] || 0,
    count: STMT.adminOverride[role] ?? (auto[role] || 0),
  }));
  const total = rows.reduce((a, r) => a + r.count, 0);
  return { rows, total, unmapped };
}

// أعداد المهنيين والمستخدمين والحراس — كلٌّ من نوعه في القاعدة مباشرةً
function _stmtSupportCounts() {
  const c = { professional: 0, worker: 0, guard: 0 };
  for (const rec of STMT.staff) if (c[rec.staff_type] !== undefined) c[rec.staff_type]++;
  return c;
}

// مجاميع جدول الطلاب
function _stmtStudentTotals() {
  let sections = 0, enM = 0, enF = 0, frM = 0, frF = 0, ruM = 0, ruF = 0;
  const byKey = {};
  for (const key of GRADE_KEYS) {
    const r = STMT.students[key] || {};
    const row = {
      sections: r.sections || 0,
      enM: r.enM || 0, enF: r.enF || 0, frM: r.frM || 0,
      frF: r.frF || 0, ruM: r.ruM || 0, ruF: r.ruF || 0,
    };
    row.total = row.enM + row.enF + row.frM + row.frF + row.ruM + row.ruF;
    byKey[key] = row;
    sections += row.sections; enM += row.enM; enF += row.enF;
    frM += row.frM; frF += row.frF; ruM += row.ruM; ruF += row.ruF;
  }
  const total = enM + enF + frM + frF + ruM + ruF;
  const sumKeys = ks => ks.reduce((a, k) => a + byKey[k].total, 0);
  return {
    byKey, sections, enM, enF, frM, frF, ruM, ruF, total,
    cycle1: sumKeys(['1','2','3','4','5','6']),
    cycle2: sumKeys(['7','8','9']),
    kinder: sumKeys(['استعدوا','م1','م2','م3','م4']),
    secondary: sumKeys(['ث1أ','ث1ع','ث2أ','ث2ع','ث3أ','ث3ع']),
  };
}

// ملخّص العاملين (١١ رقماً في خانات S18..AA23)
function _stmtWorkforce() {
  const t = _stmtTeaching();
  const a = _stmtAdminCounts();
  const s = _stmtSupportCounts();
  return {
    teachers: t.teachers, masters: t.masters, assist: t.assist,
    bySpec: t.bySpec, full: t.full, unclassified: t.unclassifiedCount,
    admin: a.total, professional: s.professional, worker: s.worker, guard: s.guard,
    grand: a.total + t.full + s.professional + s.worker + s.guard,
  };
}

// ── حالة كل قسم: تُغذّي نقطة الشريط ونسبة الاكتمال وقائمة التحقّق ────────────
// 'bad' يمنع الإرسال · 'warn' ينبّه · 'ok' مكتمل · 'empty' لم يُبدأ
function _stmtSectionState(i) {
  switch (i) {
    case 0: {
      const has = _stmtVal('stmt-deliver-d') && _stmtVal('stmt-deliver-m') && _stmtVal('stmt-deliver-y');
      return has ? { s: 'ok', note: 'مكتمل' } : { s: 'empty', note: 'تاريخ التسليم لم يُملأ' };
    }
    case 1: {
      const miss = [];
      if (!_stmtVal('stmt-edu-zone')) miss.push('المنطقة التعليمية');
      if (!_stmtVal('stmt-address'))  miss.push('العنوان');
      if (!_stmtVal('stmt-day-type')) miss.push('نوع الدوام');
      if (!_stmtVal('stmt-statno')) miss.push('الرقم الإحصائي');
      if (!_stmtVal('stmt-cycle'))  miss.push('الحلقة');
      return miss.length ? { s: 'warn', note: 'ينقص: ' + miss.join('، ') } : { s: 'ok', note: 'مكتمل' };
    }
    case 2: {
      const any = _stmtNum('stmt-b-class-rooms') || _stmtNum('stmt-b-floors');
      if (!any) return { s: 'empty', note: 'لم يُملأ بعد' };
      return _stmtVal('stmt-b-ownership') ? { s: 'ok', note: 'مكتمل' }
                                          : { s: 'warn', note: 'ينقص: حكومي/مستأجر' };
    }
    case 3: {
      const t = _stmtStudentTotals();
      if (!t.total) return { s: 'empty', note: 'لا طلاب' };
      return { s: 'ok', note: `${t.sections} شعبة · ${t.total} طالب` };
    }
    case 4: {
      const t = _stmtTeaching();
      if (t.unclassified.length) return { s: 'warn', note: `${t.unclassified.length} غير مصنّفين` };
      return t.full ? { s: 'ok', note: 'مكتمل' } : { s: 'empty', note: 'لا كادر تدريسي' };
    }
    case 5: {
      const a = _stmtAdminCounts();
      if (a.unmapped.length) return { s: 'warn', note: `${a.unmapped.length} خارج خانات النموذج` };
      return a.total ? { s: 'ok', note: 'مكتمل' } : { s: 'empty', note: 'لا كادر إداري' };
    }
    case 6: {
      const miss = STMT.staff.filter(r => _stmtMissingCount(r)).length;
      if (!STMT.staff.length) return { s: 'empty', note: 'سجل الكوادر فارغ' };
      return miss ? { s: 'warn', note: `${miss} سجلات ناقصة من ${STMT.staff.length}` }
                  : { s: 'ok', note: 'كل السجلات مكتملة' };
    }
    case 7: {
      const pending = STMT.changes.filter(c => c.detected && !c.confirmed_at).length;
      if (pending) return { s: 'bad', note: `${pending} بانتظار التأكيد` };
      if (STMT.noChange) return { s: 'ok', note: 'لا يوجد تعديل — موثَّق' };
      const done = STMT.changes.length;
      return done ? { s: 'ok', note: `${done} تعديلات مؤكَّدة` }
                  : { s: 'empty', note: 'لم يُحسم بعد' };
    }
    case 8: {
      if (!_stmtYearEndDue()) return { s: 'ok', note: 'غير مطلوبة هذا الشهر' };
      return STMT.yearEnd ? { s: 'ok', note: 'مُملأة' } : { s: 'empty', note: 'مطلوبة — لم تُملأ' };
    }
    case 9: {
      const blocks = _stmtChecklist().filter(c => c.k === 'bad').length;
      return blocks ? { s: 'bad', note: `${blocks} يمنعان الإرسال` } : { s: 'ok', note: 'جاهز للإرسال' };
    }
    default: return { s: 'empty', note: '' };
  }
}

// الورقة السادسة موسمية: تُملأ في نهاية العام الدراسي (أيار/حزيران)
function _stmtYearEndDue() { return STMT.month === 5 || STMT.month === 6; }

// قائمة التحقّق — ما يمنع الإرسال وما ينبّه فقط
function _stmtChecklist() {
  const out = [];
  const pending = STMT.changes.filter(c => c.detected && !c.confirmed_at).length;
  if (pending) out.push({ k: 'bad', t: `${stmtNum(pending)} تعديلات مقترحة لم تُؤكَّد`, go: 7 });
  if (!STMT.noChange && !STMT.changes.length)
    out.push({ k: 'bad', t: 'لم تُحسم التعديلات الطارئة — أكّدها أو اكتب «لا يوجد تعديل»', go: 7 });
  if (!_stmtVal('stmt-statno'))
    out.push({ k: 'bad', t: 'الرقم الإحصائي غير محدَّد', go: 1 });
  if (!_stmtVal('stmt-day-type'))
    out.push({ k: 'bad', t: 'نوع الدوام (كامل/نصفي) غير محدَّد', go: 1 });

  const t = _stmtTeaching();
  if (t.unclassified.length)
    out.push({ k: 'warn', t: `${stmtNum(t.unclassified.length)} كوادر غير مصنّفين في الجهاز التدريسي`, go: 4 });
  const a = _stmtAdminCounts();
  if (a.unmapped.length)
    out.push({ k: 'warn', t: `${stmtNum(a.unmapped.length)} إداريون خارج خانات النموذج`, go: 5 });
  const missRec = STMT.staff.filter(r => _stmtMissingCount(r)).length;
  if (missRec)
    out.push({ k: 'warn', t: `${stmtNum(missRec)} سجلات كوادر ناقصة الحقول`, go: 6 });
  if (_stmtYearEndDue() && !STMT.yearEnd)
    out.push({ k: 'warn', t: 'ورقة نتائج نهاية العام مطلوبة هذا الشهر ولم تُملأ', go: 8 });

  const st = _stmtStudentTotals();
  const live = Object.values(STMT.stuStats).reduce((n, g) => n + g.male + g.female, 0);
  if (st.total === live)
    out.push({ k: 'ok', t: `مجموع الطلاب (${stmtNum(st.total)}) يطابق سجلّ الطلاب النشطين` });
  else
    out.push({ k: 'warn', t: `مجموع البيان ${stmtNum(st.total)} بينما سجلّ الطلاب ${stmtNum(live)}`, go: 3 });
  return out;
}

// ── الشريط والفهرس والتقدّم ─────────────────────────────────────────────────

function renderStmtRail() {
  const rail = el('stmt-rail');
  if (!rail) return;
  rail.innerHTML = STMT_SECS.map((s, i) => {
    const st = _stmtSectionState(i);
    return `<button type="button" class="stmt-chip" role="tab" data-go="${i}"
      aria-selected="${i === STMT.sec}"><span class="stmt-chip-dot ${st.s}"></span>${escapeHtml(s.short)}</button>`;
  }).join('');
  const active = rail.querySelector('[aria-selected="true"]');
  active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

function renderStmtProgress() {
  let done = 0;
  for (let i = 0; i < STMT_SECS.length; i++) if (_stmtSectionState(i).s === 'ok') done++;
  const pct = Math.round(done / STMT_SECS.length * 100);
  const fill = el('stmt-prog-fill'); if (fill) fill.style.width = pct + '%';
  const num  = el('stmt-prog-num');  if (num)  num.textContent = stmtNum(pct) + '%';
}

function renderStmtPagers() {
  document.querySelectorAll('#view-statement .stmt-pager').forEach(p => {
    const i = Number(p.dataset.pager);
    const prev = i > 0 ? `<button type="button" class="btn btn-outline btn-sm" data-go="${i - 1}">→ السابق</button>`
                       : `<button type="button" class="btn btn-outline btn-sm" disabled>—</button>`;
    const next = i < STMT_SECS.length - 1
      ? `<button type="button" class="btn btn-outline btn-sm" data-go="${i + 1}">التالي: ${escapeHtml(STMT_SECS[i + 1].short)} ←</button>`
      : `<button type="button" class="btn btn-outline btn-sm" disabled>—</button>`;
    p.innerHTML = prev + next;
  });
}

function renderStmtIndex() {
  const host = el('stmt-index-list');
  if (!host) return;
  host.innerHTML = STMT_SECS.map((s, i) => {
    const st = _stmtSectionState(i);
    return `<button type="button" class="stmt-idx-row" data-go="${i}">
      <span class="stmt-chip-dot ${st.s}"></span>
      <span style="min-width:0"><span class="stmt-idx-row-n">${escapeHtml(s.full)}</span>
      <span class="stmt-idx-row-s">${escapeHtml(st.note)}</span></span></button>`;
  }).join('');
}

function stmtGo(i) {
  STMT.sec = Math.max(0, Math.min(STMT_SECS.length - 1, i));
  document.querySelectorAll('#view-statement .stmt-sec').forEach(sec => {
    sec.hidden = Number(sec.dataset.sec) !== STMT.sec;
  });
  renderStmtRail();
  el('stmt-period')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// إعادة رسم المؤشّرات المشتركة بعد أي تغيير
function stmtRefreshMeta() {
  renderStmtRail();
  renderStmtProgress();
  renderStmtIndex();
  renderStmtChecklist();
}

// ── رسم الأقسام ──────────────────────────────────────────────────────────────

function renderStmtHeaderSec() {
  _stmtSet('stmt-hdr-month', MONTH_LABELS[STMT.month] || String(STMT.month));
  _stmtSet('stmt-hdr-year',  STMT.year);
}

function renderStmtSchoolSec() {
  const s = STMT.school || {};
  _stmtSet('stmt-school-name', s.name || '');
  // لا حارس «—» هنا: الحقول صارت قابلة للتحرير، وأي حارس يُقرأ لاحقاً بـ _stmtVal
  // فيُحفظ نصّاً في schools.cycle. الفراغ يعني فراغاً.
  _stmtSet('stmt-cycle',       s.cycle || '');
  _stmtSet('stmt-statno',      s.statistical_number || '');
  // ثلاثي الحالة: null يعني «لم يُحدَّد بعد»، وهو غير «لا».
  _stmtSet('stmt-rural', s.rural_curriculum === true ? 'نعم'
                       : s.rural_curriculum === false ? 'لا' : '');
  _stmtSet('stmt-former-name', s.former_name || '');
  _stmtSet('stmt-village',     s.village || '');
  _stmtSet('stmt-address',     s.address || '');
  _stmtSet('stmt-phone',       s.phone || '');
  _stmtSet('stmt-shared-with', s.shared_with || '');
  _stmtSet('stmt-edu-zone',    s.educational_zone || '');
  _stmtSet('stmt-day-type',    s.day_type || '');
  CustomSelect.refresh(el('stmt-edu-zone'));
  CustomSelect.refresh(el('stmt-day-type'));
  CustomSelect.refresh(el('stmt-rural'));
}

const STMT_BUILDING_FIELDS = [
  ['floors','stmt-b-floors'], ['class_rooms','stmt-b-class-rooms'],
  ['admin_rooms','stmt-b-admin-rooms'], ['unused_rooms','stmt-b-unused'],
  ['basement','stmt-b-basement'], ['lab','stmt-b-lab'], ['computer_lab','stmt-b-computer'],
  ['library','stmt-b-library'], ['secretariat','stmt-b-secretary'], ['gym','stmt-b-gym'],
  ['storage','stmt-b-storage'], ['guidance','stmt-b-guidance'], ['health_room','stmt-b-health'],
  ['workshop','stmt-b-workshop'], ['theater','stmt-b-theater'], ['yard','stmt-b-yard'],
  ['other_halls','stmt-b-other'],
];

function renderStmtBuildingSec() {
  const b = STMT.building || {};
  for (const [col, id] of STMT_BUILDING_FIELDS) _stmtSet(id, b[col] ?? 0);
  _stmtSet('stmt-b-ownership', b.ownership || '');
  CustomSelect.refresh(el('stmt-b-ownership'));
  const banner = el('stmt-building-banner');
  if (banner) {
    banner.hidden = !STMT.building;
    const txt = el('stmt-building-banner-txt');
    if (txt && STMT.building?.updated_at) {
      const d = new Date(STMT.building.updated_at);
      // تنسيق صريح: toLocaleDateString('ar-SY') يطبع أرقاماً هندية، والتبويب لاتيني بالكامل.
      const dmy = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
      txt.textContent = `محفوظ منذ ${dmy} — عدّل ما تغيّر فقط.`;
    }
  }
  renderStmtBuildingTotal();
}

function renderStmtBuildingTotal() {
  const n = _stmtNum('stmt-b-class-rooms') + _stmtNum('stmt-b-admin-rooms') + _stmtNum('stmt-b-unused');
  const e = el('stmt-b-total');
  if (e) e.textContent = `${stmtNum(n)} غرفة (${stmtNum(_stmtNum('stmt-b-class-rooms'))} صفية + ` +
                         `${stmtNum(_stmtNum('stmt-b-admin-rooms'))} إدارية + ` +
                         `${stmtNum(_stmtNum('stmt-b-unused'))} غير مستخدمة)`;
}

// ── القسم ٤: الطلاب ──────────────────────────────────────────────────────────
// تمثيل واحد فقط في الشجرة — الجدول الرسمي، على كل عرض شاشة. وجود تمثيلين معاً
// يعني حقلَي إدخال لنفس الرقم، وهذا مصدر تعارض مضمون.
//
// ⚠ كان هنا تفرّعٌ على matchMedia('(min-width: 760px)') يعرض بطاقاتٍ مطويّةً على
// الجوّال بدل الجدول: لا أعمدة ولا مجاميع، وكل صفّ يحتاج نقرةً ليُفتح. فاضطرّ
// المستخدم إلى «وضع مصمّم للكمبيوتر» في المتصفّح ليرى بيانات مدرسته. الجدول نفسه
// يعمل على الهاتف تماماً ما دامت حاويته `.stmt-tw` تتمرّر أفقياً (style.css)،
// والعمود الأول مثبَّت فيبقى اسم الصف ظاهراً أثناء التمرير. فلا تُعِد التفرّع.
const STMT_STU_COLS = [
  ['sections','الشعب'], ['enM','انكليزي ذكور'], ['enF','انكليزي إناث'],
  ['frM','فرنسي ذكور'], ['frF','فرنسي إناث'], ['ruM','روسي ذكور'], ['ruF','روسي إناث'],
];

function renderStmtStudentsSec() {
  const host = el('stmt-students-host');
  if (!host) return;
  const t = _stmtStudentTotals();

  host.innerHTML = `<div class="stmt-tw"><table class="stmt-table stmt-table--stick">
    <thead>
      <tr><th rowspan="2">الصف</th><th rowspan="2">الشعب</th><th colspan="2">انكليزي</th>
          <th colspan="2">فرنسي</th><th colspan="2">روسي</th><th rowspan="2">المجموع</th></tr>
      <tr><th>ذكور</th><th>إناث</th><th>ذكور</th><th>إناث</th><th>ذكور</th><th>إناث</th></tr>
    </thead>
    <tbody>${GRADE_KEYS.map(k => {
      const r = t.byKey[k];
      return `<tr><td>${escapeHtml(GRADE_LABELS[k])}</td>` +
        STMT_STU_COLS.map(([c]) =>
          `<td><input class="stmt-cell-in" type="number" min="0" inputmode="numeric"
               data-stu="${k}" data-col="${c}" value="${r[c]}"></td>`).join('') +
        `<td>${stmtNum(r.total)}</td></tr>`;
    }).join('')}</tbody>
    <tfoot><tr><td>المجموع</td><td>${stmtNum(t.sections)}</td><td>${stmtNum(t.enM)}</td>
      <td>${stmtNum(t.enF)}</td><td>${stmtNum(t.frM)}</td><td>${stmtNum(t.frF)}</td>
      <td>${stmtNum(t.ruM)}</td><td>${stmtNum(t.ruF)}</td><td>${stmtNum(t.total)}</td></tr></tfoot>
  </table></div>`;

  const badge = el('stmt-stu-badge');
  if (badge) badge.textContent = `${stmtNum(t.sections)} شعبة · ${stmtNum(t.total)} طالب`;

  const sum = el('stmt-stu-sum');
  if (sum) sum.innerHTML = [
    ['مجموع الطلاب الكلي <span class="stmt-tag-calc">محسوب</span>', t.total],
    ['حلقة (1)', t.cycle1], ['حلقة (2)', t.cycle2],
    ['رياض', t.kinder], ['ثانوي', t.secondary],
  ].map(([l, v]) => `<div class="stmt-sbox"><span class="stmt-sbox-l">${l}</span><b>${stmtNum(v)}</b></div>`).join('');

  renderStmtChangeStats();
}

function renderStmtTeachingSec() {
  const t = _stmtTeaching();
  const cell = (list, bucket) => list.map(([label]) =>
    `<div class="stmt-cnt"><span>${escapeHtml(label)}</span><b>${stmtNum(bucket[label] || 0)}</b></div>`).join('');
  el('stmt-teach-teachers').innerHTML = cell(STMT_TEACH_TEACHERS, t.buckets['معلم']);
  el('stmt-teach-masters').innerHTML  = cell(STMT_TEACH_MASTERS,  t.buckets['مدرس']);
  el('stmt-teach-assist').innerHTML   = cell(STMT_TEACH_ASSIST,   t.buckets['مدرس مساعد']);
  el('stmt-c-teachers').textContent = stmtNum(t.teachers);
  el('stmt-c-masters').textContent  = stmtNum(t.masters);
  el('stmt-c-assist').textContent   = stmtNum(t.assist);

  const box = el('stmt-unclass-box');
  if (box) {
    box.hidden = t.unclassifiedCount === 0;
    el('stmt-c-unclass').textContent = stmtNum(t.unclassifiedCount);
  }
  const warn = el('stmt-teach-warn');
  if (warn) {
    warn.hidden = t.unclassified.length === 0;
    el('stmt-teach-warn-txt').textContent =
      `${stmtNum(t.unclassified.length)} كوادر لم يطابق تصنيفهم أياً من خانات النموذج.`;
  }
}

function renderStmtAdminSec() {
  const a = _stmtAdminCounts();
  const body = el('stmt-adm-body');
  if (body) {
    body.innerHTML = a.rows.map(r => `<tr>
      <td>${escapeHtml(r.role)}</td>
      <td><input class="stmt-cell-in" type="number" min="0" inputmode="numeric"
           data-adm="${escapeHtml(r.role)}" value="${r.count}"></td>
      <td>${escapeHtml(arNumWord(r.count))}</td></tr>`).join('') +
      `<tr><td><b>مجموع الإداريين</b></td><td><b>${stmtNum(a.total)}</b></td>
       <td><b>${escapeHtml(arNumWord(a.total))}</b></td></tr>`;
  }
  const badge = el('stmt-adm-badge');
  if (badge) badge.textContent = `${stmtNum(a.total)} إداري`;
  const warn = el('stmt-adm-warn');
  if (warn) {
    warn.hidden = a.unmapped.length === 0;
    el('stmt-adm-warn-txt').textContent =
      `${stmtNum(a.unmapped.length)} إداريون عملهم المسند خارج خانات النموذج: ` +
      a.unmapped.map(r => r.job_title || '—').join('، ');
  }
}

// ── القسم ٧: السير الذاتية الكاملة ──────────────────────────────────────────
function renderStmtRosters() {
  const list = el('stmt-ros-list');
  if (!list) return;
  const spec = STMT_ROSTER_FIELDS[STMT.rosG];
  const inGroup = STMT.staff.filter(r => _stmtGroupOf(r) === STMT.rosG);
  const q = STMT.rosQ.trim();
  const shown = inGroup.filter(r => {
    if (STMT.rosMiss && !_stmtMissingCount(r)) return false;
    if (!q) return true;
    return (r.full_name || '').includes(q) || (r.national_id || '').includes(q);
  });

  list.innerHTML = shown.length ? shown.map((r, i) => {
    const miss = _stmtMissingCount(r);
    const rows = spec.map(([key, label, req]) => {
      const v = _stmtFieldVal(r, key);
      const bad = !v && req;
      return `<div class="stmt-dr${bad ? ' is-miss' : ''}"><dt>${escapeHtml(label)}</dt>
        <dd>${v ? escapeHtml(v) : (req ? 'ناقص' : '—')}</dd></div>`;
    }).join('');
    const job = STMT.rosG === 'teaching' ? (r.subject_taught || r.specialization || '')
                                         : (r.job_title || '');
    return `<div class="stmt-cvc${miss ? ' is-miss' : ''}" data-open="0">
      <button type="button" class="stmt-cvh" data-cv="${escapeHtml(r.id)}">
        <span class="stmt-cvh-sq">${stmtNum(i + 1)}</span>
        <span class="stmt-cvh-who"><span class="stmt-cvh-nm">${escapeHtml(r.full_name || '—')}</span>
        <span class="stmt-cvh-jb">${escapeHtml(job || '—')}</span></span>
        ${miss ? `<span class="stmt-badge stmt-badge-warn">ينقص ${stmtNum(miss)}</span>`
               : '<span class="stmt-badge stmt-badge-ok">مكتمل</span>'}
        <svg class="stmt-cvh-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <dl class="stmt-cvb" hidden>${rows}
        <div class="stmt-cvact"><button type="button" class="stmt-mini"
          data-cv-edit="${escapeHtml(r.id)}">تعديل في سجل الكوادر</button></div>
      </dl></div>`;
  }).join('') : '<div class="stmt-prow stmt-prow-empty">لا نتائج</div>';

  const totalMiss = inGroup.filter(r => _stmtMissingCount(r)).length;
  const badge = el('stmt-ros-badge');
  if (badge) {
    badge.textContent = totalMiss ? `${stmtNum(totalMiss)} سجلات ناقصة` : 'كل السجلات مكتملة';
    badge.className = 'stmt-badge ' + (totalMiss ? 'stmt-badge-warn' : 'stmt-badge-ok');
  }
  const cnt = el('stmt-ros-count');
  if (cnt) cnt.textContent = `${stmtNum(STMT.staff.length)} كادراً · العرض هنا للمراجعة فقط.`;

  document.querySelectorAll('#view-statement .stmt-seg [data-ros]').forEach(b => {
    b.setAttribute('aria-selected', String(b.dataset.ros === STMT.rosG));
    const base = STMT_ROSTER_LABELS[b.dataset.ros];
    const n = STMT.staff.filter(r => _stmtGroupOf(r) === b.dataset.ros).length;
    b.textContent = `${base} (${stmtNum(n)})`;
  });

  renderStmtLeaves();
}

function renderStmtLeaves() {
  const host = el('stmt-leaves-list');
  if (!host) return;
  const byStaff = {};
  for (const l of STMT.leaves) (byStaff[l.staff_id] ??= []).push(l);
  const names = Object.fromEntries(STMT.staff.map(r => [r.id, r.full_name]));
  const rows = Object.entries(byStaff);
  host.innerHTML = rows.length ? rows.map(([sid, ls]) =>
    `<div class="stmt-prow"><span class="stmt-prow-n">${escapeHtml(names[sid] || '—')}</span>
      ${ls.map(l => `<span class="stmt-badge stmt-badge-info">${escapeHtml(l.leave_type)} (${stmtNum(l.leave_days)} أيام)</span>`).join('')}
      <span class="stmt-prow-sp"></span></div>`).join('')
    : '<div class="stmt-prow stmt-prow-empty">لا إجازات مسجّلة هذا الشهر</div>';
}

// ── القسم ٨: التعديلات الطارئة ──────────────────────────────────────────────
// بصمة مضغوطة لكل كادر — أساس المقارنة بين بيان وبيان.
function _stmtRosterIndex() {
  const idx = {};
  for (const r of STMT.staff) {
    idx[r.id] = {
      n: r.full_name || '', g: _stmtGroupOf(r), j: r.job_title || '',
      s: r.specialization || '', t: r.subject_taught || '',
    };
  }
  return idx;
}

// الكشف اقتراح لا قرار: النظام يعرف *أنّ* أحداً غادر ولا يعرف *لماذا*،
// والعمود الأخير في الورقة الرسمية هو الـ«لماذا». فالتأكيد البشري ضرورة
// بنيوية لا تزيّن.
function _stmtDetectChanges() {
  const prevIdx = STMT.prev?.snapshot_data?.rosterIndex;
  if (!prevIdx || typeof prevIdx !== 'object') return [];   // لا سابق → لا نخترع
  const cur = _stmtRosterIndex();
  const out = [];
  for (const [id, c] of Object.entries(cur)) {
    const p = prevIdx[id];
    if (!p) { out.push({ staff_id: id, change_type: 'added', name: c.n, group: c.g, job: c.j, before: null, after: c }); continue; }
    const diffs = [];
    if (p.j !== c.j) diffs.push(['العمل المسند إليه', p.j, c.j]);
    if (p.s !== c.s) diffs.push(['الاختصاص', p.s, c.s]);
    if (p.t !== c.t) diffs.push(['المادة التي يدرسها', p.t, c.t]);
    if (p.n !== c.n) diffs.push(['الاسم', p.n, c.n]);
    if (diffs.length) out.push({ staff_id: id, change_type: 'modified', name: c.n, group: c.g, job: c.j, diffs });
  }
  for (const [id, p] of Object.entries(prevIdx)) {
    if (!cur[id]) out.push({ staff_id: id, change_type: 'removed', name: p.n, group: p.g, job: p.j, before: p, after: null });
  }
  return out;
}

const _CHG_LABEL = { added: 'أُضيف', removed: 'غادر', modified: 'تغيّرت بياناته' };
const _GRP_LABEL = { admin: 'إداري', teaching: 'تدريسي', support: 'مهني/مستخدم/حارس' };

function renderStmtChangesSec() {
  const detHost  = el('stmt-chg-detected');
  const confHost = el('stmt-chg-confirmed');
  if (!detHost || !confHost) return;

  const known = new Set(STMT.changes.map(c => `${c.staff_id || ''}|${c.change_type}`));
  const suggestions = _stmtDetectChanges().filter(s => !known.has(`${s.staff_id}|${s.change_type}`));

  detHost.innerHTML = suggestions.map(s => {
    const why = s.change_type === 'removed'
      ? 'كان في البيان السابق ولم يعد في سجلّ الكوادر — النظام لا يعرف <b>السبب</b>، حدّده أنت.'
      : s.change_type === 'added'
        ? 'ظهر في سجلّ الكوادر بعد البيان السابق — أكّد نوع الحدث.'
        : 'تغيّرت بياناته منذ البيان السابق.';
    const diffs = (s.diffs || []).map(([lab, a, b]) =>
      `<div class="stmt-dr"><dt>${escapeHtml(lab)}</dt><dd>${escapeHtml(a || '—')} ← ${escapeHtml(b || '—')}</dd></div>`).join('');
    return `<div class="stmt-chgc is-pending" data-sug="${escapeHtml(s.staff_id)}">
      <div class="stmt-chgc-h"><span class="stmt-badge stmt-badge-warn">${escapeHtml(_CHG_LABEL[s.change_type])}</span>
        <span class="stmt-chgc-n">${escapeHtml(s.name || '—')}</span>
        <span class="stmt-badge">${escapeHtml(_GRP_LABEL[s.group] || '')}</span></div>
      ${diffs}
      <div class="stmt-chgc-note">${why}</div>
      <div class="stmt-chgc-act">
        <button type="button" class="btn btn-primary btn-sm" data-sug-ok="${escapeHtml(s.staff_id)}"
          data-sug-type="${s.change_type}">تأكيد وتحديد السبب</button>
        <button type="button" class="btn btn-outline btn-sm" data-sug-skip="${escapeHtml(s.staff_id)}"
          data-sug-type="${s.change_type}">تجاهل</button>
      </div></div>`;
  }).join('');

  confHost.innerHTML = STMT.changes.map(c => {
    const d = c.change_data || {};
    return `<div class="stmt-chgc">
      <div class="stmt-chgc-h">
        <span class="stmt-badge stmt-badge-ok">${escapeHtml(c.event_type || _CHG_LABEL[c.change_type] || '')}</span>
        <span class="stmt-chgc-n">${escapeHtml(d.name || '—')}</span>
        <span class="stmt-badge">${escapeHtml(c.detected ? 'مكتشَف' : 'مُدخَل يدوياً')}</span></div>
      <div class="stmt-dr"><dt>العمل المسند</dt><dd>${escapeHtml(d.job || '—')}</dd></div>
      <div class="stmt-dr"><dt>الفئة</dt><dd>${escapeHtml(_GRP_LABEL[c.staff_group] || '—')}</dd></div>
      <div class="stmt-dr"><dt>تاريخ النفاذ</dt><dd>${escapeHtml(_stmtDMY(c.effective_date) || '—')}</dd></div>
      ${c.reason ? `<div class="stmt-dr"><dt>السبب</dt><dd>${escapeHtml(c.reason)}</dd></div>` : ''}
      <div class="stmt-chgc-act">
        <button type="button" class="stmt-mini" data-chg-edit="${escapeHtml(c.id)}">تعديل</button>
        <button type="button" class="stmt-mini" data-chg-del="${escapeHtml(c.id)}">حذف</button>
      </div></div>`;
  }).join('');

  el('stmt-chg-det-hd').hidden  = suggestions.length === 0;
  el('stmt-chg-conf-hd').hidden = STMT.changes.length === 0;

  const banner = el('stmt-chg-banner');
  const txt    = el('stmt-chg-banner-txt');
  const badge  = el('stmt-chg-badge');
  const pending = suggestions.length;
  if (!STMT.prev) {
    banner.className = 'stmt-banner';
    txt.textContent = 'لا يوجد بيان سابق مُرسَل لهذه المدرسة — لا مقارنة تلقائية. أضف التعديلات يدوياً أو اكتب «لا يوجد تعديل».';
  } else if (pending) {
    banner.className = 'stmt-banner stmt-banner-warn';
    txt.innerHTML = `قارنّا كادرك ببيان ${escapeHtml(MONTH_SHORT[STMT.prev.month] || '')} ${stmtNum(STMT.prev.year)} ووجدنا ` +
                    `${stmtNum(pending)} تغييرات — أكّد سببها قبل الإرسال.`;
  } else if (STMT.noChange) {
    banner.className = 'stmt-banner stmt-banner-ok';
    txt.textContent = 'مسجَّل صراحةً: لا يوجد تعديل هذا الشهر.';
  } else {
    banner.className = 'stmt-banner stmt-banner-ok';
    txt.textContent = `قارنّا كادرك ببيان ${MONTH_SHORT[STMT.prev.month] || ''} ${STMT.prev.year} — لا فروق غير محسومة.`;
  }
  if (badge) {
    badge.textContent = pending ? `${stmtNum(pending)} بانتظار التأكيد`
                                : STMT.noChange ? 'لا يوجد تعديل'
                                : `${stmtNum(STMT.changes.length)} مؤكَّدة`;
    badge.className = 'stmt-badge ' + (pending ? 'stmt-badge-bad' : 'stmt-badge-ok');
  }
  renderStmtChangeStats();
}

// إحصائية الشعب والطلاب في ورقة التعديلات — محسوبة من القسم ٤ لا مُدخَلة
function renderStmtChangeStats() {
  const tbl = el('stmt-chg-stats');
  if (!tbl) return;
  const keys = ['استعدوا','1','2','3','4','5','6','7','8','9'];
  const t = _stmtStudentTotals();
  const row = (label, pick) => `<tr><td>${label}</td>` +
    keys.map(k => `<td>${stmtNum(pick(t.byKey[k]))}</td>`).join('') +
    `<td><b>${stmtNum(keys.reduce((a, k) => a + pick(t.byKey[k]), 0))}</b></td></tr>`;
  tbl.innerHTML = `<thead><tr><th>البند</th>${keys.map(k => `<th>${escapeHtml(GRADE_LABELS[k])}</th>`).join('')}<th>المجموع</th></tr></thead>
    <tbody>${row('عدد الشعب', r => r.sections)}
      ${row('عدد الطلاب الذكور', r => r.enM + r.frM + r.ruM)}
      ${row('عدد الطلاب الإناث', r => r.enF + r.frF + r.ruF)}</tbody>`;
}

// ── القسم ٩: نتائج نهاية العام ──────────────────────────────────────────────
const STMT_YE_GRADES = ['1','2','3','4','5','6','7','8','9'];
const STMT_YE_LEVELS = ['م1','م2','م3','م4'];
const STMT_YE_EXAM_GRADES = ['1','2','3','4','5','6','7','8'];
const STMT_YE_ROWS = [
  ['total','العدد الكلي'], ['dropout','متسرب'], ['sat','متقدم'],
  ['pass','ناجح'], ['partial','مكمل (معلقة نتيجته)'], ['fail','راسب'],
];

// اقتراح أعداد العام القادم من أعداد هذا العام (القسم ٤).
// القاعدة التي يتّبعها المدير على الورق: كل صفّ ينتقل إلى الذي يليه، والصف
// الأول يأتي من خرّيجي الروضة. «المستوى الأول» وافدون جدد فلا مصدر له هنا،
// ويبقى كما تركه المستخدم. الاقتراح يملأ ولا يقفل — كل خانة تبقى قابلة للتعديل.
function _stmtYearEndSuggest() {
  const t = _stmtStudentTotals();
  const m = k => { const r = t.byKey[k] || {}; return (r.enM || 0) + (r.frM || 0) + (r.ruM || 0); };
  const f = k => { const r = t.byKey[k] || {}; return (r.enF || 0) + (r.frF || 0) + (r.ruF || 0); };

  STMT.yearEnd ??= { next: {}, exam: {} };
  const next = STMT.yearEnd.next;
  const put = (key, mv, fv) => { (next[key] ??= {}).m = mv; next[key].f = fv; };

  // الصف الأول ← خرّيجو الروضة (استعدوا + المستوى الرابع)
  put('1', m('استعدوا') + m('م4'), f('استعدوا') + f('م4'));
  // الصفوف ٢..٩ ← الصف الذي قبلها
  for (let g = 2; g <= 9; g++) put(String(g), m(String(g - 1)), f(String(g - 1)));
  // مستويات الرياض ٢..٤ ← المستوى الذي قبلها؛ المستوى الأول لا مصدر له
  for (let l = 2; l <= 4; l++) put('م' + l, m('م' + (l - 1)), f('م' + (l - 1)));
}

function renderStmtYearEndSec() {
  const due  = _stmtYearEndDue();
  const gate = el('stmt-ye-gate');
  const wrap = el('stmt-ye-wrap');
  const badge = el('stmt-ye-badge');
  const open = !!STMT.yearEnd;

  if (gate) {
    gate.hidden = open;
    el('stmt-ye-gate-txt').textContent = due
      ? 'هذه الورقة مطلوبة الآن — تُملأ مرّة واحدة في نهاية العام بعد صدور نتائج الفصل الثاني.'
      : 'ورقة موسمية غير مطلوبة هذا الشهر — تُملأ في أيار أو حزيران. يمكنك فتحها الآن إن لزم.';
  }
  if (badge) {
    badge.textContent = open ? 'مُملأة' : due ? 'مطلوبة' : 'غير مطلوبة';
    badge.className = 'stmt-badge ' + (open ? 'stmt-badge-ok' : due ? 'stmt-badge-warn' : '');
  }
  if (wrap) wrap.hidden = !open;
  if (!open) return;

  const ye = STMT.yearEnd;
  const next = el('stmt-ye-next');
  if (next) {
    const cols = [...STMT_YE_GRADES, ...STMT_YE_LEVELS];
    const lab = k => STMT_YE_GRADES.includes(k) ? 'الصف ' + GRADE_LABELS[k] : GRADE_LABELS[k];
    const cell = (k, g) => `<td><input class="stmt-cell-in" type="number" min="0" inputmode="numeric"
        data-ye-next="${k}" data-g="${g}" value="${ye.next?.[k]?.[g] ?? 0}"></td>`;
    const tot = g => cols.reduce((a, k) => a + (Number(ye.next?.[k]?.[g]) || 0), 0);
    next.innerHTML = `<thead><tr><th>الصف</th><th>ذكور</th><th>اناث</th><th>المجموع</th></tr></thead>
      <tbody>${cols.map(k => {
        const m = Number(ye.next?.[k]?.m) || 0, f = Number(ye.next?.[k]?.f) || 0;
        return `<tr><td>${escapeHtml(lab(k))}</td>${cell(k, 'm')}${cell(k, 'f')}<td>${stmtNum(m + f)}</td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td>جميع الصفوف</td><td>${stmtNum(tot('m'))}</td><td>${stmtNum(tot('f'))}</td>
        <td>${stmtNum(tot('m') + tot('f'))}</td></tr></tfoot>`;
  }

  const exam = el('stmt-ye-exam');
  if (exam) {
    const val = (rk, g) => Number(ye.exam?.[rk]?.[g]) || 0;
    exam.innerHTML = `<thead><tr><th>الصف</th>${STMT_YE_EXAM_GRADES.map(g =>
        `<th>${escapeHtml(GRADE_LABELS[g])}</th>`).join('')}<th>المجموع</th></tr></thead>
      <tbody>${STMT_YE_ROWS.map(([rk, lab]) => {
        const computed = rk === 'sat';
        return `<tr><td>${escapeHtml(lab)}${computed ? ' <span class="stmt-tag-calc">محسوب</span>' : ''}</td>` +
          STMT_YE_EXAM_GRADES.map(g => computed
            ? `<td>${stmtNum(val('total', g) - val('dropout', g))}</td>`
            : `<td><input class="stmt-cell-in" type="number" min="0" inputmode="numeric"
                 data-ye-exam="${rk}" data-g="${g}" value="${val(rk, g)}"></td>`).join('') +
          `<td><b>${stmtNum(STMT_YE_EXAM_GRADES.reduce((a, g) =>
            a + (computed ? val('total', g) - val('dropout', g) : val(rk, g)), 0))}</b></td></tr>`;
      }).join('')}</tbody>`;
  }
}

// ── القسم ١٠: المراجعة ──────────────────────────────────────────────────────
function renderStmtReviewSec() {
  const w = _stmtWorkforce();
  const host = el('stmt-workforce');
  if (host) host.innerHTML = [
    ['عدد المعلمين', w.teachers, 0], ['عدد المدرسين', w.masters, 0],
    ['عدد المدرسين المساعدين', w.assist, 0],
    ['الجهاز التدريسي حسب الاختصاصات', w.bySpec, 0],
    ['الجهاز التدريسي بشكل كامل', w.full, 0],
    ['غير المصنّف', w.unclassified, 1],
    ['كل العاملين في الجهاز الإداري', w.admin, 0],
    ['العاملون المهنيون', w.professional, 0],
    ['المستخدمون', w.worker, 0], ['الحراس', w.guard, 0],
    ['مجموع العاملين في المدرسة', w.grand, 0],
  ].map(([l, v, hi]) =>
    `<div class="stmt-sbox${hi && v !== 0 ? ' stmt-sbox-hi' : ''}">
      <span class="stmt-sbox-l">${escapeHtml(l)}</span><b>${stmtNum(v)}</b></div>`).join('');
  renderStmtChecklist();
}

function renderStmtChecklist() {
  const host = el('stmt-checklist');
  if (!host) return;
  const items = _stmtChecklist();
  const icon = { bad: '⛔', warn: '⚠', ok: '✓' };
  host.innerHTML = items.map(c =>
    `<div class="stmt-ci stmt-ci-${c.k}"><span>${icon[c.k]}</span><span>${escapeHtml(c.t)}</span>
      ${c.go !== undefined ? `<button type="button" class="stmt-ci-go" data-go="${c.go}">اذهب</button>` : ''}</div>`).join('');
  const btn = el('btn-submit-statement');
  const blocked = items.some(c => c.k === 'bad');
  const locked  = STMT.status === 'submitted' || STMT.status === 'approved';
  if (btn) btn.disabled = blocked || locked;
}

// ── اللقطة (snapshot_data v2) ────────────────────────────────────────────────
// مبدأ: **مُصدَّرة ذاتياً** — المُصدِّر يقرأ اللقطة وحدها ولا يستعلم من جديد،
// فالبيان المُرسَل يُطبَع بعد سنة كما أُرسل تماماً.
// ⚠ الحقول الشخصية (الرقم الوطني، الأم، الولادة، الهاتف، العنوان) **لا تدخل
// هنا** — تذهب إلى monthly_statement_rosters وحده بصلاحياته (§20.7).
function _stmtSnapshot() {
  const t = _stmtStudentTotals();
  const teach = _stmtTeaching();
  const adm   = _stmtAdminCounts();
  const sup   = _stmtSupportCounts();
  const s     = STMT.school || {};
  return {
    schemaVersion: 2,
    period: {
      month: STMT.month, year: STMT.year,
      deliveryDay: _stmtVal('stmt-deliver-d'),
      deliveryMonth: _stmtVal('stmt-deliver-m'),
      deliveryYear: _stmtVal('stmt-deliver-y'),
      receivedBy: _stmtVal('stmt-receiver'),
    },
    school: {
      // تُقرأ من الحقول لا من STMT.school: حفظ الملف الشخصي مؤجَّل بمؤقّت،
      // فقراءة الكائن تلتقط قيمة ما قبل آخر تعديل.
      name: s.name || '', formerName: _stmtVal('stmt-former-name'),
      cycle: _stmtVal('stmt-cycle'), statisticalNumber: _stmtVal('stmt-statno'),
      ruralCurriculum: _stmtRuralVal(),
      educationalZone: _stmtVal('stmt-edu-zone'), village: _stmtVal('stmt-village'),
      address: _stmtVal('stmt-address'), phone: _stmtVal('stmt-phone'),
      dayType: _stmtVal('stmt-day-type'), sharedWith: _stmtVal('stmt-shared-with'),
    },
    building: Object.fromEntries([
      ...STMT_BUILDING_FIELDS.map(([col, id]) => [col, _stmtNum(id)]),
      ['ownership', _stmtVal('stmt-b-ownership')],
    ]),
    students: {
      rows: GRADE_KEYS.map(k => ({ key: k, label: GRADE_LABELS[k], ...t.byKey[k] })),
      totals: { sections: t.sections, enM: t.enM, enF: t.enF, frM: t.frM, frF: t.frF,
                ruM: t.ruM, ruF: t.ruF, total: t.total },
      byCycle: { cycle1: t.cycle1, cycle2: t.cycle2, kinder: t.kinder, secondary: t.secondary },
    },
    teachingStaff: {
      buckets: teach.buckets, teachers: teach.teachers, masters: teach.masters,
      assistants: teach.assist, bySpec: teach.bySpec, full: teach.full,
      unclassified: teach.unclassifiedCount,
      unclassifiedNames: teach.unclassified.map(r => r.full_name),
    },
    adminStaff: {
      rows: adm.rows.map(r => ({ role: r.role, count: r.count, words: arNumWord(r.count) })),
      total: adm.total, unmapped: adm.unmapped.map(r => r.job_title || ''),
    },
    workforce: _stmtWorkforce(),
    supportCounts: sup,
    leaves: STMT.leaves.map(l => ({
      staffId: l.staff_id, type: l.leave_type, days: l.leave_days,
    })),
    changes: {
      none: STMT.noChange,
      items: STMT.changes.map(c => ({
        staffId: c.staff_id, group: c.staff_group, changeType: c.change_type,
        eventType: c.event_type, effectiveDate: c.effective_date, reason: c.reason,
        detected: c.detected, confirmedAt: c.confirmed_at, data: c.change_data,
      })),
    },
    yearEnd: STMT.yearEnd,
    signatures: { secretary: _stmtVal('stmt-sig-secretary'), principal: _stmtVal('stmt-sig-principal') },
    rosterIndex: _stmtRosterIndex(),
    meta: { generatedAt: new Date().toISOString(), checklist: _stmtChecklist() },
  };
}

// السير الذاتية الكاملة — تذهب للجدول المحمي وحده
function _stmtRosterPayload() {
  const out = { admin: [], teaching: [], support: [] };
  for (const r of STMT.staff) {
    const g = _stmtGroupOf(r);
    const row = { id: r.id, full_name: r.full_name || '' };
    for (const [key] of STMT_ROSTER_FIELDS[g]) row[key.replace('@', '')] = _stmtFieldVal(r, key);
    out[g].push(row);
  }
  return out;
}

// ── الحفظ التلقائي ───────────────────────────────────────────────────────────
// كل تغيير يُجدول حفظاً بعد سكون قصير، فلا نكتب على كل ضغطة مفتاح.
function stmtQueueSave() {
  if (STMT.loading || !STMT.id) return;
  clearTimeout(STMT.saveTimer);
  STMT.saveTimer = setTimeout(() => { stmtSaveNow().catch(() => {}); }, 900);
}

async function stmtSaveNow() {
  if (!STMT.id || STMT.status === 'submitted' || STMT.status === 'approved') return;
  try {
    await NDB.saveStatementDraft(STMT.id, _stmtSnapshot());
  } catch (err) {
    console.warn('[Statement] autosave', err);
  }
}

// «منهاج التعليم الريفي» ثلاثي الحالة: نعم / لا / لم يُحدَّد (null).
function _stmtRuralVal() {
  const v = _stmtVal('stmt-rural');
  return v === 'نعم' ? true : v === 'لا' ? false : null;
}

// هوية المدرسة والبناء يُحفظان في جدوليهما لا في اللقطة — فهما ثابتان
// عبر الأشهر، وهذا ما يقتل الاعتماد على localStorage.
async function stmtSaveSchoolProfile() {
  if (!S.school?.id) return;
  const patch = {
    former_name:      _stmtVal('stmt-former-name') || null,
    village:          _stmtVal('stmt-village') || null,
    address:          _stmtVal('stmt-address') || null,
    phone:            _stmtVal('stmt-phone') || null,
    shared_with:      _stmtVal('stmt-shared-with') || null,
    educational_zone: _stmtVal('stmt-edu-zone') || null,
    day_type:         _stmtVal('stmt-day-type') || null,
    // الثلاثة الآتية كانت للقراءة فقط ولا واجهة أخرى في التطبيق تضبطها،
    // فكانت تبقى فارغة أبداً وتمنع إرسال البيان.
    cycle:              _stmtVal('stmt-cycle') || null,
    statistical_number: _stmtVal('stmt-statno') || null,
    rural_curriculum:   _stmtRuralVal(),
  };
  await NDB.saveSchoolProfile(S.school.id, patch);
  STMT.school = { ...(STMT.school || {}), ...patch };
}

async function stmtSaveBuilding() {
  if (!S.school?.id) return;
  const patch = Object.fromEntries(STMT_BUILDING_FIELDS.map(([col, id]) => [col, _stmtNum(id)]));
  patch.ownership = _stmtVal('stmt-b-ownership') || null;
  STMT.building = await NDB.saveSchoolBuilding(S.school.id, patch);
}

// ── التحميل ──────────────────────────────────────────────────────────────────

function _stmtSeedStudents() {
  // الشعب والأعداد من سجلّ الطلاب، وتوزيع اللغة من classes.foreign_language
  const seeded = {};
  const claimed = new Set();
  for (const key of GRADE_KEYS) {
    const row = { sections: 0, enM: 0, enF: 0, frM: 0, frF: 0, ruM: 0, ruF: 0 };
    for (const dbGrade of GRADE_KEY_MAP[key]) {
      const g = STMT.stuStats[dbGrade];
      if (!g) continue;
      claimed.add(dbGrade);
      row.sections += g.sections;
      for (const [lang, v] of Object.entries(g.lang || {})) {
        if (lang === 'فرنسي')      { row.frM += v.m; row.frF += v.f; }
        else if (lang === 'روسي')  { row.ruM += v.m; row.ruF += v.f; }
        else                       { row.enM += v.m; row.enF += v.f; }
      }
    }
    seeded[key] = row;
  }
  // صفوف لم يطابق اسمها أي مفتاح — لا تُسقَط بصمت
  STMT.unclaimed = Object.entries(STMT.stuStats)
    .filter(([g]) => !claimed.has(g))
    .map(([g, v]) => ({ grade: g, ...v }));
  return seeded;
}

async function loadStatementPeriod() {
  const school = S.school;
  if (!school?.id) return;
  STMT.loading = true;
  const errEl = el('stmt-error');
  if (errEl) errEl.hidden = true;

  try {
    STMT.month = parseInt(el('stmt-month-sel')?.value || '1', 10);
    STMT.year  = parseInt(el('stmt-year-in')?.value || String(new Date().getFullYear()), 10);

    const [row, profile, building, staff, leaves, stats, prev] = await Promise.all([
      NDB.ensureDraftStatement(school.id, STMT.month, STMT.year),
      NDB.getSchoolProfile(school.id),
      NDB.getSchoolBuilding(school.id),
      NDB.getStaffRecords(school.id),
      NDB.getStaffLeaves(school.id, STMT.month, STMT.year),
      NDB.getSchoolStudentStats(school.id),
      NDB.getPreviousStatementSnapshot(school.id, STMT.month, STMT.year),
    ]);

    // احتياطات مقصودة: كل استدعاء أعلاه قد يعود فارغاً (شبكة، صلاحية، جدول
    // فارغ). بلا هذه الحواجز يسقط التبويب كلّه لأن أحد الاستدعاءات عاد null.
    STMT.id       = row?.id ?? null;
    STMT.status   = row?.status ?? 'draft';
    STMT.notes    = row?.notes ?? null;
    STMT.school   = profile || school;
    STMT.building = building;
    STMT.staff    = staff  || [];
    STMT.leaves   = leaves || [];
    STMT.stuStats = stats  || {};
    STMT.prev     = prev;
    STMT.changes  = await NDB.getStatementChanges(row.id);

    const snap = row.snapshot_data && row.snapshot_data.schemaVersion === 2 ? row.snapshot_data : null;

    // الأعداد تُبذَر من سجلّ الطلاب، ثم تُغلَّب تعديلات المسودة المحفوظة.
    STMT.students = _stmtSeedStudents();
    if (snap?.students?.rows) {
      for (const r of snap.students.rows) {
        if (STMT.students[r.key]) {
          STMT.students[r.key] = {
            sections: r.sections | 0, enM: r.enM | 0, enF: r.enF | 0,
            frM: r.frM | 0, frF: r.frF | 0, ruM: r.ruM | 0, ruF: r.ruF | 0,
          };
        }
      }
    }
    STMT.adminOverride = {};
    if (snap?.adminStaff?.rows) for (const r of snap.adminStaff.rows) STMT.adminOverride[r.role] = r.count;
    STMT.teachFull = snap?.teachingStaff?.full ?? null;
    STMT.yearEnd   = snap?.yearEnd || null;
    STMT.noChange  = !!snap?.changes?.none;

    _stmtSet('stmt-deliver-d', snap?.period?.deliveryDay || '');
    _stmtSet('stmt-deliver-m', snap?.period?.deliveryMonth || '');
    _stmtSet('stmt-deliver-y', snap?.period?.deliveryYear || '');
    _stmtSet('stmt-receiver',  snap?.period?.receivedBy || '');
    _stmtSet('stmt-sig-secretary', snap?.signatures?.secretary || '');
    _stmtSet('stmt-sig-principal', snap?.signatures?.principal || '');

    renderStmtHeaderSec();
    renderStmtSchoolSec();
    renderStmtBuildingSec();
    renderStmtStudentsSec();
    renderStmtTeachingSec();
    renderStmtAdminSec();
    renderStmtRosters();
    renderStmtChangesSec();
    renderStmtYearEndSec();
    renderStmtReviewSec();
    _renderStatementStatus(row);
    stmtRefreshMeta();
  } catch (err) {
    console.error('[Statement] load', err);
    if (errEl) { errEl.textContent = 'تعذّر تحميل البيان — ' + (err?.message || err); errEl.hidden = false; }
  } finally {
    STMT.loading = false;
  }
}

// شارة الحالة في الشريط + لافتة الحالة + قفل زر الإرسال
function _renderStatementStatus(st) {
  const status = st?.status || 'draft';
  STMT.status = status;
  const map = {
    draft:     { cls: '',             chip: 'مسودة',   b: 'stmt-status--draft',     t: 'مسودة محفوظة — لم تُرسَل بعد.' },
    submitted: { cls: 'is-sent',      chip: 'مُرسَل',   b: 'stmt-status--submitted', t: 'مُرسَل للمديرية — بانتظار المراجعة.' },
    approved:  { cls: 'is-approved',  chip: 'معتمد',   b: 'stmt-status--approved',  t: 'معتمد من المديرية ✓' },
    rejected:  { cls: 'is-rejected',  chip: 'مرفوض',   b: 'stmt-status--rejected',  t: 'رُفض من المديرية' + (st?.notes ? ' — ' + st.notes : '') },
  };
  const m = map[status] || map.draft;
  const chip = el('stmt-state');
  if (chip) { chip.className = 'stmt-state ' + m.cls; el('stmt-state-txt').textContent = m.chip; }
  const banner = el('stmt-status-banner');
  if (banner) {
    banner.className = 'stmt-status-banner ' + m.b;
    banner.textContent = m.t;
    banner.hidden = (status === 'draft');
  }
  const lbl = el('btn-submit-label');
  if (lbl) lbl.textContent = status === 'rejected' ? 'إعادة الإرسال للمديرية' : 'إرسال للمديرية';
}

// ── التهيئة والتفاعل ─────────────────────────────────────────────────────────

async function initStatementTab() {
  _statementLoaded = true;

  const yearIn = el('stmt-year-in');
  if (yearIn && !yearIn.value) yearIn.value = new Date().getFullYear();
  // البيان يُسلَّم عن الشهر الذي انتهى، فالافتراضي هو الشهر الماضي. لا يمكن
  // الاعتماد على !monthSel.value: عنصر select بلا selected يعيد قيمة أول خيار.
  const monthSel = el('stmt-month-sel');
  if (monthSel && !STMT._periodInit) {
    STMT._periodInit = true;
    const now = new Date();
    monthSel.value = String(now.getMonth() === 0 ? 12 : now.getMonth());
    if (yearIn) yearIn.value = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    CustomSelect.refresh(monthSel);
  }

  // الشريط اللاصق يجب أن يقف تحت شريط التبويبات لا فوقه.
  _stmtSyncStickyOffsets();
  window.addEventListener('resize', _stmtSyncStickyOffsets);

  const zoneEl = el('stmt-edu-zone');
  if (zoneEl) {
    try {
      const zones = await getLookup('educational_zone');
      const cur = zoneEl.value;
      zoneEl.innerHTML = '<option value="">— اختر —</option>' +
        zones.map(z => `<option value="${escapeHtml(z)}"${z === cur ? ' selected' : ''}>${escapeHtml(z)}</option>`).join('');
      CustomSelect.refresh(zoneEl);
    } catch { /* non-fatal */ }
  }

  renderStmtPagers();
  _stmtWire();
  await loadStatementPeriod();
  stmtGo(0);
}

function _stmtSyncStickyOffsets() {
  // منتقي الأقسام (الفقاعة) هو المُثبَّت الآن، لا الشريط الأفقي القديم.
  const bar = document.querySelector('.secbar-wrap');
  const period = el('stmt-period');
  const root = document.documentElement;
  if (bar) root.style.setProperty('--stmt-top', bar.offsetHeight + 'px');
  if (period) root.style.setProperty('--stmt-period-h', period.offsetHeight + 'px');
}

let _stmtWired = false;
function _stmtWire() {
  if (_stmtWired) return;
  _stmtWired = true;
  const view = el('view-statement');
  if (!view) return;

  // تغيير الفترة يعيد التحميل بالكامل — كل شيء مرتبط بها.
  el('stmt-month-sel')?.addEventListener('change', () => { loadStatementPeriod(); stmtGo(STMT.sec); });
  el('stmt-year-in')?.addEventListener('change',   () => { loadStatementPeriod(); stmtGo(STMT.sec); });

  // التنقّل — زرّ واحد يخدم الشريط والفهرس وقائمة التحقّق والصفحات.
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (!go) return;
    if (!go.closest('#view-statement') && !go.closest('#modal-stmt-index')) return;
    stmtGo(Number(go.dataset.go));
    const idx = el('modal-stmt-index');
    if (idx && !idx.hidden) { idx.hidden = true; document.body.style.overflow = ''; }
  });

  el('btn-stmt-index')?.addEventListener('click', () => {
    renderStmtIndex();
    const m = el('modal-stmt-index');
    if (m) { m.hidden = false; document.body.style.overflow = 'hidden'; }
  });
  el('btn-close-stmt-index')?.addEventListener('click', () => {
    const m = el('modal-stmt-index');
    if (m) { m.hidden = true; document.body.style.overflow = ''; }
  });

  // القسم ٢ + ٣: كل تغيير يُحفظ في جدوله ثم في اللقطة
  ['stmt-former-name','stmt-village','stmt-address','stmt-phone','stmt-shared-with',
   'stmt-cycle','stmt-statno']
    .forEach(id => el(id)?.addEventListener('input', () => {
      stmtQueueSave(); clearTimeout(STMT.profTimer);
      STMT.profTimer = setTimeout(() => stmtSaveSchoolProfile().catch(() => {}), 1200);
      stmtRefreshMeta();
    }));
  ['stmt-edu-zone','stmt-day-type','stmt-rural'].forEach(id => el(id)?.addEventListener('change', () => {
    stmtSaveSchoolProfile().catch(() => {}); stmtQueueSave(); stmtRefreshMeta();
  }));

  const buildingIds = STMT_BUILDING_FIELDS.map(([, id]) => id);
  buildingIds.forEach(id => el(id)?.addEventListener('input', () => {
    renderStmtBuildingTotal(); stmtQueueSave(); stmtRefreshMeta();
    clearTimeout(STMT.bldTimer);
    STMT.bldTimer = setTimeout(() => stmtSaveBuilding().catch(() => {}), 1200);
  }));
  el('stmt-b-ownership')?.addEventListener('change', () => {
    stmtSaveBuilding().catch(() => {}); stmtQueueSave(); stmtRefreshMeta();
  });
  el('btn-stmt-building-same')?.addEventListener('click', async () => {
    await stmtSaveBuilding().catch(() => {});
    toast('تم تأكيد بيانات البناء دون تغيير ✓', 'success');
    stmtRefreshMeta();
  });

  // القسم ١ + ١٠: حقول نصّية بسيطة
  ['stmt-deliver-d','stmt-deliver-m','stmt-deliver-y','stmt-receiver',
   'stmt-sig-secretary','stmt-sig-principal']
    .forEach(id => el(id)?.addEventListener('input', () => { stmtQueueSave(); stmtRefreshMeta(); }));

  // القسم ٤: بطاقات الصفوف والجدول — مصدر واحد في STMT.students
  view.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset?.stu) {
      const row = STMT.students[t.dataset.stu];
      if (row) {
        row[t.dataset.col] = Math.max(0, parseInt(t.value || '0', 10) || 0);
        _stmtUpdateStudentEcho(t.dataset.stu);
        stmtQueueSave(); stmtRefreshMeta();
      }
      return;
    }
    if (t.dataset?.adm) {
      STMT.adminOverride[t.dataset.adm] = Math.max(0, parseInt(t.value || '0', 10) || 0);
      _stmtUpdateAdminEcho(t);
      stmtQueueSave(); stmtRefreshMeta();
      return;
    }
    if (t.dataset?.yeNext || t.dataset?.yeExam) {
      _stmtApplyYearEndInput(t);
      stmtQueueSave(); stmtRefreshMeta();
    }
  });
  // الحقول المحسوبة تُعاد كتابتها عند مغادرة الحقل لا على كل ضغطة، وإلا قفز
  // مؤشّر الكتابة داخل الخانة التي يحرّرها المستخدم.
  view.addEventListener('change', (e) => {
    if (e.target.dataset?.stu) renderStmtStudentsSec();
    if (e.target.dataset?.adm) renderStmtAdminSec();
    if (e.target.dataset?.yeNext || e.target.dataset?.yeExam) renderStmtYearEndSec();
  });
  // القسم ٥: تصنيف غير المصنّفين
  el('btn-stmt-classify')?.addEventListener('click', openStmtClassify);
  el('btn-close-stmt-classify')?.addEventListener('click', () => {
    const m = el('modal-stmt-classify');
    if (m) { m.hidden = true; document.body.style.overflow = ''; }
  });

  // القسم ٧: البحث، الفلتر، المُقسِّم، فتح البطاقة، التعديل
  el('stmt-ros-q')?.addEventListener('input', (e) => { STMT.rosQ = e.target.value; renderStmtRosters(); });
  el('stmt-ros-miss')?.addEventListener('change', (e) => { STMT.rosMiss = e.target.checked; renderStmtRosters(); });
  view.addEventListener('click', (e) => {
    const seg = e.target.closest('.stmt-seg [data-ros]');
    if (seg) { STMT.rosG = seg.dataset.ros; renderStmtRosters(); return; }

    const cv = e.target.closest('[data-cv]');
    if (cv) {
      const card = cv.parentNode;
      const open = card.dataset.open === '1';
      card.dataset.open = open ? '0' : '1';
      card.querySelector('.stmt-cvb').hidden = open;
      return;
    }
    const edit = e.target.closest('[data-cv-edit]');
    if (edit) { _stmtOpenStaffRecord(edit.dataset.cvEdit); return; }
  });
  el('btn-stmt-open-registry')?.addEventListener('click', () => switchTab('registry'));

  // القسم ٨
  el('btn-stmt-add-change')?.addEventListener('click', () => openStmtChangeModal(null));
  el('btn-stmt-no-change')?.addEventListener('click', stmtMarkNoChange);
  el('btn-close-stmt-change')?.addEventListener('click', closeStmtChangeModal);
  el('btn-save-stmt-change')?.addEventListener('click', saveStmtChange);

  // تبديل الفئة يعيد بناء الحقول (أعمدة كل كتلة مختلفة) مع الحفاظ على
  // ما أُدخل في الحقول المشتركة، فلا يضيع عمل المستخدم بضغطة خطأ.
  el('stmt-chg-group')?.addEventListener('change', () => {
    const group = _stmtVal('stmt-chg-group') || 'admin';
    const keep  = _stmtCollectChangeData(STMT.chgGroup || 'admin');
    STMT.chgGroup = group;
    renderStmtChangeStaffPicker(group, null);
    renderStmtChangeFields(group, keep);
  });

  // اختيار شخص من السجلّ يملأ الخانات — ثم تبقى كلها قابلة للتحرير والمسح.
  el('stmt-chg-staff')?.addEventListener('change', () => {
    const id = _stmtVal('stmt-chg-staff');
    const group = _stmtVal('stmt-chg-group') || 'admin';
    if (!id) return;
    const rec = STMT.staff.find(r => r.id === id);
    if (rec) renderStmtChangeFields(group, _stmtChangeDataFromRecord(rec));
  });
  view.addEventListener('click', (e) => {
    const ok = e.target.closest('[data-sug-ok]');
    if (ok) { _stmtConfirmSuggestion(ok.dataset.sugOk, ok.dataset.sugType); return; }
    const skip = e.target.closest('[data-sug-skip]');
    if (skip) { _stmtSkipSuggestion(skip.dataset.sugSkip, skip.dataset.sugType); return; }
    const ed = e.target.closest('[data-chg-edit]');
    if (ed) { openStmtChangeModal(STMT.changes.find(c => c.id === ed.dataset.chgEdit)); return; }
    const del = e.target.closest('[data-chg-del]');
    if (del) { _stmtDeleteChange(del.dataset.chgDel); return; }
  });

  // القسم ٩
  el('btn-stmt-ye-fill')?.addEventListener('click', () => {
    STMT.yearEnd = STMT.yearEnd || { next: {}, exam: {} };
    renderStmtYearEndSec(); stmtQueueSave(); stmtRefreshMeta();
  });

  el('btn-stmt-ye-suggest')?.addEventListener('click', () => {
    _stmtYearEndSuggest();
    renderStmtYearEndSec(); stmtQueueSave(); stmtRefreshMeta();
    toast('مُلئ الجدول من أعداد هذا العام — عدّل ما تعرفه', 'success');
  });

  el('btn-print-statement')?.addEventListener('click', printStatement);
  el('btn-export-excel')?.addEventListener('click', exportStatementExcel);
  el('btn-submit-statement')?.addEventListener('click', submitStatement);

  // الحفظ المعلّق يُنجَز قبل مغادرة الصفحة
  window.addEventListener('pagehide', () => { if (STMT.saveTimer) stmtSaveNow(); });
}

// تحديث الأرقام المشتقّة في جدول الطلاب دون إعادة رسم الحقل الذي يُحرَّر
// (إعادة الرسم تسحب التركيز من الخانة وتقطع الكتابة).
function _stmtUpdateStudentEcho(key) {
  const t = _stmtStudentTotals();

  // مجموع سطر الصف المُحرَّر — آخر خلية في صفّه
  const row = document.querySelector(`.stmt-table [data-stu="${key}"]`)?.closest('tr');
  const rowTotal = row?.lastElementChild;
  if (rowTotal) rowTotal.textContent = stmtNum(t.byKey[key].total);

  // سطر المجاميع في تذييل الجدول
  const foot = document.querySelector('.stmt-table tfoot tr');
  if (foot) {
    [t.sections, t.enM, t.enF, t.frM, t.frF, t.ruM, t.ruF, t.total]
      .forEach((v, i) => { const c = foot.children[i + 1]; if (c) c.textContent = stmtNum(v); });
  }

  const badge = el('stmt-stu-badge');
  if (badge) badge.textContent = `${stmtNum(t.sections)} شعبة · ${stmtNum(t.total)} طالب`;
}

function _stmtUpdateAdminEcho(input) {
  const cell = input.closest('tr')?.children?.[2];
  if (cell) cell.textContent = arNumWord(Math.max(0, parseInt(input.value || '0', 10) || 0));
}

function _stmtApplyYearEndInput(t) {
  STMT.yearEnd ??= { next: {}, exam: {} };
  const v = Math.max(0, parseInt(t.value || '0', 10) || 0);
  if (t.dataset.yeNext) {
    (STMT.yearEnd.next[t.dataset.yeNext] ??= {})[t.dataset.g] = v;
  } else {
    (STMT.yearEnd.exam[t.dataset.yeExam] ??= {})[t.dataset.g] = v;
  }
}

// يفتح نافذة سجل الكوادر القائمة على هذا الشخص — مسار كتابة واحد فقط.
function _stmtOpenStaffRecord(id) {
  const rec = STMT.staff.find(r => r.id === id);
  if (!rec) return;
  _regSegment = rec.staff_type === 'admin' ? 'admin'
              : rec.staff_type === 'teaching' ? 'teaching' : 'support';
  openStaffRecModal(rec);
}

// ── التعديلات الطارئة: تأكيد، إضافة، حذف ────────────────────────────────────

// يبني حقول الفئة المختارة ويملؤها من `data` — الحقول كلها قابلة للتحرير والمسح.
function renderStmtChangeFields(group, data) {
  const host = el('stmt-chg-fields');
  if (!host) return;
  const d = data || {};
  const spec = STMT_CHG_FIELDS[group] || STMT_CHG_FIELDS.admin;

  host.innerHTML = spec.map(([key, label, type, req]) => {
    const id  = 'stmt-chg-f-' + key.replace('@', '');
    const lbl = escapeHtml(label) + (req ? ' <span class="req">*</span>' : '');
    if (type === 'date') {
      const [y, m, dd] = String(d[key] || '').split('-');
      return `<div class="field-group"><label>${lbl}</label><div class="dob-row">
        <input id="${id}-d" class="field-input dob-in" type="text" inputmode="numeric" maxlength="2"
               placeholder="يوم" aria-label="اليوم" value="${dd ? Number(dd) : ''}">
        <input id="${id}-m" class="field-input dob-in" type="text" inputmode="numeric" maxlength="2"
               placeholder="شهر" aria-label="الشهر" value="${m ? Number(m) : ''}">
        <input id="${id}-y" class="field-input dob-in dob-year" type="text" inputmode="numeric" maxlength="4"
               placeholder="سنة" aria-label="السنة" value="${escapeHtml(y || '')}">
      </div></div>`;
    }
    if (type === 'textarea') {
      return `<div class="field-group"><label for="${id}">${lbl}</label>
        <textarea id="${id}" class="field-input" rows="2" maxlength="400">${escapeHtml(d[key] ?? '')}</textarea></div>`;
    }
    const attrs = type === 'num'
      ? 'type="number" inputmode="numeric"'
      : 'type="text" maxlength="120"';
    return `<div class="field-group"><label for="${id}">${lbl}</label>
      <input id="${id}" class="field-input" ${attrs} value="${escapeHtml(String(d[key] ?? ''))}"></div>`;
  }).join('');
}

// قائمة «تعبئة من سجلّ الكوادر» — كوادر الفئة المختارة وحدهم.
function renderStmtChangeStaffPicker(group, selectedId) {
  const sel = el('stmt-chg-staff');
  if (!sel) return;
  const inGroup = STMT.staff.filter(r => _stmtGroupOf(r) === group);
  sel.innerHTML = '<option value="">— شخص خارج السجلّ (أدخل يدوياً) —</option>' +
    inGroup.map(r =>
      `<option value="${escapeHtml(r.id)}">${escapeHtml(r.full_name || '—')}</option>`).join('');
  sel.value = selectedId && inGroup.some(r => r.id === selectedId) ? selectedId : '';
  CustomSelect.refresh(sel);
}

// يحوّل سجلّ كادر إلى شكل change_data — نسخة لحظة الحدث، لا مرجعاً حيّاً:
// السجلّ قد يتغيّر لاحقاً، والورقة المُسلَّمة يجب أن تبقى كما سُلِّمت.
function _stmtChangeDataFromRecord(rec) {
  const d = {};
  for (const k of STMT_CHG_FROM_REC) {
    const v = rec[k];
    if (v !== null && v !== undefined && v !== '') d[k] = String(v);
  }
  if (rec.birth_date) d['@birth'] = rec.birth_date;
  if (rec.start_date) d['@start'] = rec.start_date;
  const lv = _stmtLeaveText(rec.id);
  if (lv) d.leave_text = lv;
  if (rec.roster_type) d.roster_note = STMT_ROSTER_TYPE_LABEL[rec.roster_type] || rec.roster_type;
  return d;
}

function openStmtChangeModal(chg) {
  STMT.chgEditId = chg?.id || null;
  const d = chg?.change_data || {};
  const group = chg?.staff_group || 'admin';
  el('stmt-chg-title').textContent = chg ? 'تعديل سطر' : 'إضافة تعديل يدوي';
  STMT.chgGroup = group;
  _stmtSet('stmt-chg-group', group);
  renderStmtChangeStaffPicker(group, chg?.staff_id || null);
  renderStmtChangeFields(group, d);
  _stmtSet('stmt-chg-event', chg?.event_type || '');
  _stmtSet('stmt-chg-reason', chg?.reason || '');
  const [y, m, dd] = String(chg?.effective_date || '').split('-');
  _stmtSet('stmt-chg-year',  y || String(STMT.year));
  _stmtSet('stmt-chg-month', m ? String(Number(m)) : String(STMT.month));
  _stmtSet('stmt-chg-day',   dd ? String(Number(dd)) : '');
  STMT.chgPending = chg ? null : STMT.chgPending;
  CustomSelect.refresh(el('stmt-chg-group'));
  CustomSelect.refresh(el('stmt-chg-event'));
  el('stmt-chg-error').hidden = true;
  const m2 = el('modal-stmt-change');
  if (m2) { m2.hidden = false; m2.querySelector('.sheet-body')?.scrollTo(0, 0);
            document.body.style.overflow = 'hidden'; }
}

// يجمع كل حقول الفئة المعروضة إلى كائن change_data
function _stmtCollectChangeData(group) {
  const out = {};
  for (const [key, , type] of (STMT_CHG_FIELDS[group] || STMT_CHG_FIELDS.admin)) {
    const id = 'stmt-chg-f-' + key.replace('@', '');
    if (type === 'date') {
      const dd = _stmtNum(id + '-d'), mm = _stmtNum(id + '-m'), yy = _stmtNum(id + '-y');
      if (dd && mm && yy) {
        out[key] = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }
      continue;
    }
    const v = _stmtVal(id);
    if (v) out[key] = v;
  }
  return out;
}

function closeStmtChangeModal() {
  const m = el('modal-stmt-change');
  if (m) { m.hidden = true; document.body.style.overflow = ''; }
  STMT.chgEditId = null;
  STMT.chgPending = null;
}

// تأكيد اقتراح مكتشَف: نفتح النافذة نفسها مملوءة، فالمدير يختار **السبب**.
function _stmtConfirmSuggestion(staffId, changeType) {
  const sug = _stmtDetectChanges().find(s => s.staff_id === staffId && s.change_type === changeType);
  if (!sug) return;
  STMT.chgPending = { staff_id: staffId, change_type: changeType, detected: true };
  const group = sug.group || 'admin';
  // نملأ من سجلّ الكادر إن كان ما يزال موجوداً (أُضيف/تغيّر)، وإلا من
  // بصمة الشهر السابق (غادر) — فسطر «من غادر» يحتاج بياناته كاملة أيضاً.
  const rec = STMT.staff.find(r => r.id === staffId);
  const data = rec ? _stmtChangeDataFromRecord(rec)
                   : { full_name: sug.name || '', job_title: sug.job || '' };
  openStmtChangeModal({
    staff_group: group, staff_id: staffId, change_data: data,
    // اقتراح افتراضي للسبب حسب نوع التغيير — والمدير يبقى صاحب القرار.
    event_type: changeType === 'added' ? 'مباشرة' : '',
  });
  // openStmtChangeModal تظنّه سطراً محفوظاً فتصفّر chgPending — نعيدها.
  el('stmt-chg-title').textContent = 'تأكيد تعديل مكتشَف';
  STMT.chgEditId = null;
  STMT.chgPending = { staff_id: staffId, change_type: changeType, detected: true };
}

// «تجاهل» يُسجَّل سطراً بـ event_type='أخرى' لا يُحذف بصمت — البيان وثيقة،
// وتجاهل تغيير حقيقي بلا أثر يجعل الشهر القادم يكتشفه من جديد إلى الأبد.
async function _stmtSkipSuggestion(staffId, changeType) {
  if (!await askConfirm('تجاهل هذا التغيير؟ سيُسجَّل في البيان بوصفه «أخرى» بلا سبب محدَّد.', 'تجاهل')) return;
  const sug = _stmtDetectChanges().find(s => s.staff_id === staffId && s.change_type === changeType);
  try {
    const row = await NDB.upsertStatementChange({
      statement_id: STMT.id, school_id: S.school.id,
      change_type: changeType, staff_id: staffId,
      staff_group: sug?.group || null, event_type: 'أخرى',
      change_data: { name: sug?.name || '', job: sug?.job || '' },
      reason: 'تُجوهل من المدير', detected: true,
      confirmed_at: new Date().toISOString(),
    });
    STMT.changes.push(row);
    STMT.noChange = false;
    renderStmtChangesSec(); stmtQueueSave(); stmtRefreshMeta();
  } catch (err) {
    console.error('[Statement] skip suggestion', err);
    toast('تعذّر حفظ التجاهل — ' + (err?.message || err), 'error');
  }
}

async function saveStmtChange() {
  const errEl = el('stmt-chg-error');
  const spin  = el('stmt-chg-spinner');
  const group = _stmtVal('stmt-chg-group') || 'admin';
  const data  = _stmtCollectChangeData(group);
  const name  = data.full_name || '';
  const event = _stmtVal('stmt-chg-event');
  if (!name)  { errEl.textContent = 'الاسم الثلاثي مطلوب'; errEl.hidden = false; return; }
  if (!event) { errEl.textContent = 'نوع الحدث مطلوب — النظام لا يعرف السبب، وهو عمود في الورقة الرسمية'; errEl.hidden = false; return; }
  errEl.hidden = true;
  if (spin) spin.hidden = false;

  const d = _stmtNum('stmt-chg-day'), m = _stmtNum('stmt-chg-month'), y = _stmtNum('stmt-chg-year');
  const eff = (d && m && y) ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  const pend = STMT.chgPending;

  try {
    const payload = {
      statement_id: STMT.id, school_id: S.school.id,
      change_type: pend?.change_type
        || STMT.changes.find(c => c.id === STMT.chgEditId)?.change_type
        || (event === 'مباشرة' ? 'added' : 'removed'),
      staff_id: _stmtVal('stmt-chg-staff') || pend?.staff_id
        || STMT.changes.find(c => c.id === STMT.chgEditId)?.staff_id || null,
      staff_group: group,
      event_type: event,
      // `name` و`job` يبقيان للتوافق مع السطور المحفوظة بالصيغة القديمة،
      // وبقية الأعمدة الرسمية تُحفظ بمفاتيحها.
      change_data: { ...data, name, job: data.job_title || '' },
      reason: _stmtVal('stmt-chg-reason') || null,
      effective_date: eff,
      detected: !!pend?.detected || !!STMT.changes.find(c => c.id === STMT.chgEditId)?.detected,
      confirmed_at: new Date().toISOString(),
    };
    if (STMT.chgEditId) payload.id = STMT.chgEditId;
    const row = await NDB.upsertStatementChange(payload);
    const i = STMT.changes.findIndex(c => c.id === row.id);
    if (i >= 0) STMT.changes[i] = row; else STMT.changes.push(row);
    STMT.noChange = false;
    closeStmtChangeModal();
    renderStmtChangesSec(); stmtQueueSave(); stmtRefreshMeta();
    toast('حُفظ التعديل ✓', 'success');
  } catch (err) {
    console.error('[Statement] save change', err);
    errEl.textContent = 'تعذّر الحفظ — ' + (err?.message || err);
    errEl.hidden = false;
  } finally {
    if (spin) spin.hidden = true;
  }
}

async function _stmtDeleteChange(id) {
  if (!await askConfirm('حذف هذا السطر من التعديلات الطارئة؟', 'حذف')) return;
  try {
    await NDB.deleteStatementChange(id);
    STMT.changes = STMT.changes.filter(c => c.id !== id);
    renderStmtChangesSec(); stmtQueueSave(); stmtRefreshMeta();
  } catch (err) {
    console.error('[Statement] delete change', err);
    toast('تعذّر الحذف — ' + (err?.message || err), 'error');
  }
}

// النموذج ينصّ: «في حال لايوجد تعديلات نكتب داخلها لايوجد تعديل» — فنكتبها
// صراحةً بدل ترك الورقة فارغة، ليصير «لم يحدث شيء» أمراً موثَّقاً.
async function stmtMarkNoChange() {
  const pending = _stmtDetectChanges().length;
  if (pending) {
    toast('هناك تغييرات مكتشفة — أكّدها أو تجاهلها أولاً', 'error');
    stmtGo(7);
    return;
  }
  if (STMT.changes.length) {
    if (!await askConfirm('يوجد تعديلات مسجّلة — هل تريد تعليم الشهر بـ«لا يوجد تعديل» رغم ذلك؟', 'متابعة')) return;
  }
  STMT.noChange = true;
  renderStmtChangesSec(); stmtQueueSave(); stmtRefreshMeta();
  toast('سُجّل صراحةً: لا يوجد تعديل هذا الشهر ✓', 'success');
}

// ── تصنيف الجهاز التدريسي غير المصنّف ───────────────────────────────────────
function openStmtClassify() {
  const list = el('stmt-classify-list');
  const t = _stmtTeaching();
  if (list) {
    list.innerHTML = t.unclassified.map(r => `<div class="stmt-prow">
      <span class="stmt-prow-n">${escapeHtml(r.full_name || '—')}</span>
      <span class="stmt-prow-sp"></span>
      <select class="stmt-fld" data-rank="${escapeHtml(r.id)}" style="width:auto">
        <option value="">— اختر —</option>
        <option value="معلم">معلم</option>
        <option value="مدرس">مدرس</option>
        <option value="مدرس مساعد">مدرس مساعد</option>
      </select></div>`).join('') ||
      '<div class="stmt-prow stmt-prow-empty">لا كوادر غير مصنّفين</div>';
    list.querySelectorAll('[data-rank]').forEach(sel => {
      sel.addEventListener('change', async () => {
        if (!sel.value) return;
        sel.disabled = true;
        try {
          await NDB.updateStaffRecord(sel.dataset.rank, { teaching_rank: sel.value });
          const rec = STMT.staff.find(r => r.id === sel.dataset.rank);
          if (rec) rec.teaching_rank = sel.value;
          renderStmtTeachingSec(); renderStmtReviewSec(); stmtQueueSave(); stmtRefreshMeta();
          toast('حُفظ التصنيف ✓', 'success');
          openStmtClassify();
        } catch (err) {
          console.error('[Statement] classify', err);
          el('stmt-classify-error').textContent = 'تعذّر الحفظ — ' + (err?.message || err);
          el('stmt-classify-error').hidden = false;
          sel.disabled = false;
        }
      });
    });
  }
  const m = el('modal-stmt-classify');
  if (m) { m.hidden = false; document.body.style.overflow = 'hidden'; }
}

// ── الإرسال ──────────────────────────────────────────────────────────────────
async function submitStatement() {
  const btn     = el('btn-submit-statement');
  const label   = el('btn-submit-label');
  const spinner = el('stmt-submit-spinner');
  const errEl   = el('stmt-error');
  const blocks  = _stmtChecklist().filter(c => c.k === 'bad');
  if (blocks.length) {
    toast('لا يمكن الإرسال — راجع قائمة التحقّق', 'error');
    stmtGo(9);
    return;
  }
  if (!await askConfirm('إرسال البيان للمديرية؟ لن يمكن تعديله حتى تُراجعه المديرية.', 'إرسال')) return;
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'جارٍ الإرسال...';
  if (spinner) spinner.hidden = false;
  if (errEl) errEl.hidden = true;
  try {
    clearTimeout(STMT.saveTimer);
    await stmtSaveSchoolProfile().catch(() => {});
    await stmtSaveBuilding().catch(() => {});
    // السير الذاتية الكاملة تُكتب قبل قلب الحالة: سياسة المديرية تقرأ
    // الجدول بعد status='submitted'، والكتابة بعده تصطدم بقفل التعديل.
    await NDB.saveStatementRosters(STMT.id, S.school.id, _stmtRosterPayload());
    await NDB.submitMonthlyStatement(S.school.id, STMT.month, STMT.year, _stmtSnapshot());
    toast('أُرسل البيان للمديرية ✓', 'success');
    const st = await NDB.getMonthlyStatement(S.school.id, STMT.month, STMT.year);
    _renderStatementStatus(st);
    stmtRefreshMeta();
  } catch (err) {
    console.error('[Statement] submit', err);
    if (errEl) { errEl.textContent = 'تعذّر إرسال البيان — ' + (err?.message || err); errEl.hidden = false; }
    if (btn) btn.disabled = false;
  } finally {
    if (spinner) spinner.hidden = true;
    if (label) label.textContent = 'إرسال للمديرية';
  }
}

// ── ExcelJS lazy loader ──────────────────────────────────────────────────────
let _excelJsPromise = null;
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve();
  return _excelJsPromise ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload = res;
    s.onerror = () => rej(new Error('تعذّر تحميل مكتبة Excel'));
    document.head.appendChild(s);
  });
}

function _setCell(ws, addr, val) {
  try {
    const cell = ws.getCell(addr);
    if (cell.formula) return; // never overwrite formulas
    cell.value = (val === null || val === undefined || val === '') ? null : val;
  } catch { /* merged/invalid cell */ }
}

// يوم/شهر/سنة من تاريخ ISO إلى ثلاث خلايا متتالية
function _setDate(ws, iso, c1, c2, c3, row) {
  if (!iso) return;
  const [y, m, d] = String(iso).split('-');
  if (!y) return;
  _setCell(ws, `${c1}${row}`, Number(d));
  _setCell(ws, `${c2}${row}`, Number(m));
  _setCell(ws, `${c3}${row}`, Number(y));
}

// سطر التعديل → شكل سجلّ كادر صالح لـ _writeStaffRow.
// **ما كتبه المدير في النافذة يسبق سجلّ الكوادر**: البيان وثيقة تصف لحظةً
// بعينها، والسجلّ قد يكون تغيّر بعدها — بل قد يكون صاحبه غادر فلم يعد له سجلّ.
function _stmtChangeRecord(c) {
  const live = STMT.staff.find(r => r.id === c.staffId) || {};
  const d = c.data || {};
  const pick = (dk, lk) => (d[dk] !== undefined && d[dk] !== '') ? d[dk] : (live[lk] ?? '');
  return {
    national_id:  pick('national_id', 'national_id'),
    full_name:    d.full_name || d.name || live.full_name || '',
    mother_name:  pick('mother_name', 'mother_name'),
    birth_date:   pick('@birth', 'birth_date'),
    certificate:  pick('certificate', 'certificate'),
    specialization: pick('specialization', 'specialization'),
    seniority_year: pick('seniority_year', 'seniority_year'),
    job_title:    d.job_title || d.job || live.job_title || '',
    higher_degree: pick('higher_degree', 'higher_degree'),
    subject_taught: pick('subject_taught', 'subject_taught'),
    teaching_hours: pick('teaching_hours', 'teaching_hours'),
    quota_subjects: pick('quota_subjects', 'quota_subjects'),
    quota_school_external: pick('quota_school_external', 'quota_school_external'),
    assigned_grade:   pick('assigned_grade', 'assigned_grade'),
    assigned_section: pick('assigned_section', 'assigned_section'),
    start_date:   pick('@start', 'start_date'),
    phone:        pick('phone', 'phone'),
    landline:     pick('landline', 'landline'),
    residential_zone: pick('residential_zone', 'residential_zone'),
    ministerial_doc:  pick('ministerial_doc', 'ministerial_doc'),
    notes:        pick('notes', 'notes'),
    leave_text:   d.leave_text || '',
    roster_note:  d.roster_note || STMT_ROSTER_TYPE_LABEL[live.roster_type] || '',
  };
}

// صفّ كادر واحد في ورقة الكوادر أو في ورقة التعديلات، حسب خريطة أعمدة.
// المفاتيح هنا هي أسماء أعمدة الورقة، والقيم أحرف العمود.
function _writeStaffRow(ws, row, r, map, leaveText) {
  const put = (k, v) => { if (map[k]) _setCell(ws, `${map[k]}${row}`, v); };
  put('seq', row);
  put('national_id',  r.national_id || '');
  put('full_name',    r.full_name || '');
  put('mother_name',  r.mother_name || '');
  if (map.birth_d) _setDate(ws, r.birth_date, map.birth_d, map.birth_m, map.birth_y, row);
  put('certificate',  r.certificate || '');
  put('specialization', r.specialization || '');
  // «القدم الوظيفي» في الورقة الرسمية سنةُ تعيين (1931 / 2015 في عيّنة
  // النموذج) لا عددَ سنوات. seniority_years القديم كان numeric(4,1) فلا
  // يتّسع لسنة أصلاً؛ يُقرأ هنا احتياطاً للسجلات التي لم تُحدَّث بعد.
  put('seniority',    r.seniority_year ?? r.seniority_years ?? '');
  put('job_title',    r.job_title || '');
  put('higher_degree', r.higher_degree || '');
  put('subject',      r.subject_taught || '');
  put('hours',        r.teaching_hours ?? '');
  put('quota_subj',   r.quota_subjects || '');
  put('quota_school', r.quota_school_external || '');
  put('grade',        r.assigned_grade || '');
  put('section',      r.assigned_section || '');
  if (map.start_d) _setDate(ws, r.start_date, map.start_d, map.start_m, map.start_y, row);
  put('phone',        r.phone || '');
  put('landline',     r.landline || '');
  put('zone',         r.residential_zone || '');
  put('leave',        leaveText || '');
  put('doc',          r.ministerial_doc || '');
  put('notes',        r.notes || '');
}

// خرائط أعمدة الأوراق الثلاث المستقلّة (الصفوف تبدأ من ٤)
const _MAP_ADMIN_SHEET = {
  seq:'A', national_id:'B', full_name:'C', mother_name:'D',
  birth_d:'E', birth_m:'F', birth_y:'G', certificate:'H', specialization:'I',
  seniority:'J', job_title:'K', higher_degree:'L',
  start_d:'M', start_m:'N', start_y:'O', phone:'P', landline:'Q',
  zone:'R', leave:'S', doc:'T', notes:'U',
};
const _MAP_TEACH_SHEET = {
  seq:'A', national_id:'B', full_name:'C', mother_name:'D',
  birth_d:'E', birth_m:'F', birth_y:'G', certificate:'H', specialization:'I',
  seniority:'J', subject:'K', hours:'L', quota_subj:'M', quota_school:'N',
  grade:'O', section:'P', start_d:'Q', start_m:'R', start_y:'S',
  phone:'T', landline:'U', zone:'V', leave:'W', doc:'X', notes:'Y',
};
const _MAP_SUPPORT_SHEET = {
  seq:'A', national_id:'B', full_name:'C', mother_name:'D',
  birth_d:'E', birth_m:'F', birth_y:'G', certificate:'H',
  seniority:'I', job_title:'J', start_d:'K', start_m:'L', start_y:'M',
  phone:'N', landline:'O', zone:'P', leave:'Q', doc:'R', notes:'S',
};
// ورقة التعديلات — ثلاث كتل بأعمدة مختلفة. كتلة المهنيين وحدها لها عمود حدث
// مستقلّ (V22 «مباشرة/انفكاك/وفاة/تقاعد/ملاحظات أخرى»)؛ الإداري والتدريسي
// يكتبان الحدث داخل عمود الملاحظات كما تفعل المدارس على الورق.
const _MAP_CHG_ADMIN = {
  seq:'A', national_id:'B', full_name:'C', mother_name:'D',
  birth_d:'E', birth_m:'F', birth_y:'G', certificate:'H', specialization:'I',
  seniority:'J', job_title:'K', higher_degree:'L',
  start_d:'M', start_m:'N', start_y:'O', phone:'P', landline:'Q',
  zone:'R', leave:'S', doc:'T', notes:'U',
};
const _MAP_CHG_TEACH = { ..._MAP_TEACH_SHEET };
const _MAP_CHG_SUPPORT = {
  seq:'A', national_id:'B', full_name:'C', mother_name:'D',
  birth_d:'E', birth_m:'F', birth_y:'G', certificate:'H', specialization:'I',
  seniority:'J', job_title:'K', start_d:'M', start_m:'N', start_y:'O',
  phone:'P', landline:'Q', zone:'R',
  roster_note:'S',   // داخل الملاك / تحديد مركز عمل محافظة — لم يكن مُسنداً
  leave:'T', doc:'U',
  event:'V',         // كان مُسنداً لـ notes فيُكتب الحدث فوق الملاحظات
};

async function exportStatementExcel() {
  const btn     = el('btn-export-excel');
  const label   = el('btn-export-label');
  const spinner = el('stmt-export-spinner');
  const errEl   = el('stmt-error');
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'جارٍ التصدير...';
  if (spinner) spinner.hidden = false;
  if (errEl) errEl.hidden = true;

  try {
    await loadExcelJS();
    // المُصدِّر يقرأ اللقطة وحدها — فما يُصدَّر هو بالضبط ما يُرسَل.
    const snap = _stmtSnapshot();
    // كتل ورقة التعديلات ذات سعة ثابتة؛ ما يفيض كان يُقتطع بصمت.
    const overflow = [];

    const resp = await fetch('../shared/statement_template.xlsx');
    if (!resp.ok) throw new Error(`تعذّر تحميل القالب (${resp.status})`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await resp.arrayBuffer());

    const ws1 = wb.getWorksheet('البيان');
    if (!ws1) throw new Error('ورقة البيان غير موجودة في القالب');
    const sc = snap.school;

    // ── الورقة ١: البيان ───────────────────────────────────────────────────
    _setCell(ws1, 'E3', MONTH_LABELS[snap.period.month] || String(snap.period.month));
    _setCell(ws1, 'K3', snap.period.year);
    if (snap.period.deliveryDay)   _setCell(ws1, 'R3', Number(snap.period.deliveryDay));
    if (snap.period.deliveryMonth) _setCell(ws1, 'S3', Number(snap.period.deliveryMonth));
    if (snap.period.deliveryYear)  _setCell(ws1, 'T3', Number(snap.period.deliveryYear));
    _setCell(ws1, 'U4', snap.period.receivedBy);
    _setCell(ws1, 'C7', sc.educationalZone);
    _setCell(ws1, 'E7', sc.village);
    _setCell(ws1, 'G7', sc.address);
    _setCell(ws1, 'J7', sc.cycle);
    _setCell(ws1, 'K7', sc.name);
    _setCell(ws1, 'O7', sc.phone);
    _setCell(ws1, 'R7', sc.statisticalNumber);
    // ثلاثي الحالة: null يعني «لم يُحدَّد» فتبقى الخانة فارغة بدل ادّعاء «لا».
    _setCell(ws1, 'T7', sc.ruralCurriculum === null ? '' : (sc.ruralCurriculum ? 'نعم' : 'لا'));
    // ⚠ نوع الدوام كامل/نصفي محورٌ مستقلّ عن schools.shift (صباحي/مسائي).
    _setCell(ws1, 'Y7', sc.dayType);
    _setCell(ws1, 'W8', sc.sharedWith);

    const b = snap.building;
    const bCols = [['C','floors'],['E','ownership'],['H','class_rooms'],['K','admin_rooms'],
      ['M','unused_rooms'],['O','basement'],['P','lab'],['Q','computer_lab'],['R','library'],
      ['S','secretariat'],['T','gym'],['U','storage'],['V','guidance'],['W','health_room'],
      ['X','workshop'],['Y','theater'],['Z','yard'],['AA','other_halls']];
    for (const [col, key] of bCols) _setCell(ws1, `${col}11`, b[key] === '' ? null : b[key]);

    // الجهاز التدريسي — الخانات الفرعية في مواضعها الحرفية
    for (const [label, addr] of STMT_TEACH_TEACHERS) _setCell(ws1, addr, snap.teachingStaff.buckets['معلم'][label] || 0);
    for (const [label, addr] of STMT_TEACH_MASTERS)  _setCell(ws1, addr, snap.teachingStaff.buckets['مدرس'][label] || 0);
    for (const [label, addr] of STMT_TEACH_ASSIST)   _setCell(ws1, addr, snap.teachingStaff.buckets['مدرس مساعد'][label] || 0);
    _setCell(ws1, 'G16',  snap.teachingStaff.teachers);
    _setCell(ws1, 'T16',  snap.teachingStaff.masters);
    _setCell(ws1, 'AA16', snap.teachingStaff.assistants);

    // أعداد الطلاب — الصفوف ٢٢..٤١ بترتيب GRADE_KEYS
    snap.students.rows.forEach((r, i) => {
      const row = 22 + i;
      _setCell(ws1, `D${row}`, r.sections);
      _setCell(ws1, `E${row}`, r.enM); _setCell(ws1, `F${row}`, r.enF);
      _setCell(ws1, `G${row}`, r.frM); _setCell(ws1, `H${row}`, r.frF);
      _setCell(ws1, `I${row}`, r.ruM); _setCell(ws1, `J${row}`, r.ruF);
      _setCell(ws1, `K${row}`, r.total);
    });
    const tt = snap.students.totals;
    _setCell(ws1, 'D42', tt.sections); _setCell(ws1, 'E42', tt.enM); _setCell(ws1, 'F42', tt.enF);
    _setCell(ws1, 'G42', tt.frM); _setCell(ws1, 'H42', tt.frF);
    _setCell(ws1, 'I42', tt.ruM); _setCell(ws1, 'J42', tt.ruF);
    _setCell(ws1, 'F43', tt.total);
    _setCell(ws1, 'I43', snap.students.byCycle.cycle1);
    _setCell(ws1, 'K43', snap.students.byCycle.cycle2);
    _setCell(ws1, 'I44', snap.students.byCycle.kinder);
    _setCell(ws1, 'K44', snap.students.byCycle.secondary);

    // الجهاز الإداري — العدد رقماً وكتابةً (الصفوف ٢٠..٣٦، المجموع ٣٨)
    snap.adminStaff.rows.forEach((r, i) => {
      const row = 20 + i;
      _setCell(ws1, `O${row}`, r.count);
      _setCell(ws1, `P${row}`, r.words);
    });
    _setCell(ws1, 'O38', snap.adminStaff.total);
    _setCell(ws1, 'P38', arNumWord(snap.adminStaff.total));

    // ملخّص العاملين
    const w = snap.workforce;
    _setCell(ws1, 'V18', w.teachers);  _setCell(ws1, 'V19', w.masters);
    _setCell(ws1, 'V20', w.assist);    _setCell(ws1, 'V21', w.bySpec);
    _setCell(ws1, 'V22', w.full);      _setCell(ws1, 'V23', w.unclassified);
    _setCell(ws1, 'AA18', w.admin);    _setCell(ws1, 'AA19', w.professional);
    _setCell(ws1, 'AA20', w.worker);   _setCell(ws1, 'AA21', w.guard);
    _setCell(ws1, 'AA23', w.grand);
    _setCell(ws1, 'T44', snap.signatures.secretary);
    _setCell(ws1, 'X44', snap.signatures.principal);

    // ── الأوراق ٢–٤: الكوادر ───────────────────────────────────────────────
    const leaveOf = id => (snap.leaves.filter(l => l.staffId === id)
      .map(l => `${l.type} ${l.days}`).join(' + '));
    const sheets = [
      ['الجهاز الإداري', 'admin', _MAP_ADMIN_SHEET],
      ['الجهاز التدريسي', 'teaching', _MAP_TEACH_SHEET],
      ['مهنيين ومستخدمين وحراس', 'support', _MAP_SUPPORT_SHEET],
    ];
    for (const [sheetName, group, map] of sheets) {
      const ws = wb.getWorksheet(sheetName);
      if (!ws) continue;
      // ⚠ «support» ليست قيمة staff_type في القاعدة — المقارنة بها كانت
      // تُخرج قائمة فارغة، فتُصدَّر ورقة المهنيين بلا صفّ واحد.
      const recs = STMT.staff.filter(r => _stmtGroupOf(r) === group);
      recs.forEach((r, i) => _writeStaffRow(ws, 4 + i, r, map, leaveOf(r.id)));
    }

    // ── الورقة ٥: التعديلات الطارئة ────────────────────────────────────────
    const ws5 = wb.getWorksheet('التعديلات الطارئة الشهرية');
    if (ws5) {
      _setCell(ws5, 'A6', sc.educationalZone);
      _setCell(ws5, 'D6', sc.village);
      _setCell(ws5, 'H6', sc.formerName);
      _setCell(ws5, 'K6', sc.cycle);
      _setCell(ws5, 'L6', sc.name);
      _setCell(ws5, 'Q6', sc.phone);
      // الجواب يُكتب تحت الخانة المختارة، كما في الورقة الأصلية
      if (sc.ruralCurriculum !== null)
        _setCell(ws5, sc.ruralCurriculum ? 'T7' : 'U7', sc.ruralCurriculum ? 'نعم' : 'لا');
      if (sc.dayType) _setCell(ws5, sc.dayType === 'كامل' ? 'V7' : 'W7', sc.dayType);
      _setCell(ws5, 'X7', sc.sharedWith);

      // ⚠ كان `byGroup[c.group] ??= byGroup.admin` يُسند مصفوفة الإداريين نفسها
      // لأي فئة مجهولة، فتسقط سطورها في كتلة الإداريين بصمت.
      const byGroup = { admin: [], teaching: [], support: [] };
      for (const c of snap.changes.items) (byGroup[c.group] || byGroup.admin).push(c);
      const blocks = [
        ['admin',    11, 13, _MAP_CHG_ADMIN],
        ['teaching', 17, 20, _MAP_CHG_TEACH],
        ['support',  24, 29, _MAP_CHG_SUPPORT],
      ];
      for (const [g, first, last, map] of blocks) {
        const items = byGroup[g] || [];
        const cap = last - first + 1;
        items.slice(0, cap).forEach((c, i) => {
          const row = first + i;
          const rec = _stmtChangeRecord(c);
          _writeStaffRow(ws5, row, rec, map, rec.leave_text || leaveOf(c.staffId));
          // الورقة لا تفرد عمود حدث إلا لكتلة المهنيين (V). في كتلتَي الإداري
          // والتدريسي يُكتب الحدث والسبب داخل عمود الملاحظات نفسه — وكان
          // الكود يكتب الحدث فوق الملاحظات فيمحوها، ويُسقط السبب أصلاً.
          const eventTxt = [c.eventType, c.reason].filter(Boolean).join(' — ');
          if (map.event) {
            _setCell(ws5, `${map.event}${row}`, eventTxt);
            if (map.doc) _setCell(ws5, `${map.doc}${row}`,
              [rec.ministerial_doc, rec.notes].filter(Boolean).join(' — '));
          } else if (map.notes) {
            _setCell(ws5, `${map.notes}${row}`,
              [rec.notes, eventTxt].filter(Boolean).join(' — '));
          }
          if (map.roster_note) _setCell(ws5, `${map.roster_note}${row}`, rec.roster_note || '');
        });
        if (items.length > cap) {
          overflow.push(`${STMT_ROSTER_LABELS[g]}: ${items.length} سطراً والورقة تتّسع لـ ${cap}`);
        }
      }
      // «لا يوجد تعديل» يُكتب صراحةً كما ينصّ النموذج
      if (snap.changes.none && !snap.changes.items.length) _setCell(ws5, 'C11', 'لا يوجد تعديل');

      const cols = ['استعدوا','1','2','3','4','5','6','7','8','9'];
      const colLetters = ['D','E','F','G','H','I','J','K','L','M'];
      const byKey = Object.fromEntries(snap.students.rows.map(r => [r.key, r]));
      cols.forEach((k, i) => {
        const r = byKey[k] || {};
        _setCell(ws5, `${colLetters[i]}32`, r.sections || 0);
        _setCell(ws5, `${colLetters[i]}33`, (r.enM || 0) + (r.frM || 0) + (r.ruM || 0));
        _setCell(ws5, `${colLetters[i]}34`, (r.enF || 0) + (r.frF || 0) + (r.ruF || 0));
      });
      const sum = pick => cols.reduce((a, k) => a + pick(byKey[k] || {}), 0);
      _setCell(ws5, 'N32', sum(r => r.sections || 0));
      _setCell(ws5, 'N33', sum(r => (r.enM || 0) + (r.frM || 0) + (r.ruM || 0)));
      _setCell(ws5, 'N34', sum(r => (r.enF || 0) + (r.frF || 0) + (r.ruF || 0)));
      _setCell(ws5, 'K35', snap.students.totals.total);
      _setCell(ws5, 'W37', sc.name);
    }

    // ── الورقة ٦: نتائج نهاية العام ────────────────────────────────────────
    const ws6 = wb.getWorksheet('جدول نتائج نهاية العام');
    if (ws6 && snap.yearEnd) {
      _setCell(ws6, 'C1', sc.name);
      _setCell(ws6, 'B6', sc.educationalZone);
      _setCell(ws6, 'D6', sc.village);
      _setCell(ws6, 'F6', sc.address);
      _setCell(ws6, 'I6', sc.cycle);
      _setCell(ws6, 'J6', sc.name);
      _setCell(ws6, 'N6', sc.statisticalNumber);
      _setCell(ws6, 'P6', sc.ruralCurriculum === null ? '' : (sc.ruralCurriculum ? 'نعم' : 'لا'));
      _setCell(ws6, 'U6', sc.dayType);
      _setCell(ws6, 'U7', sc.sharedWith);

      const gCols = ['B','D','F','H','J','L','N','P','R'];
      let tm = 0, tf = 0;
      STMT_YE_GRADES.forEach((k, i) => {
        const m = Number(snap.yearEnd.next?.[k]?.m) || 0;
        const f = Number(snap.yearEnd.next?.[k]?.f) || 0;
        tm += m; tf += f;
        const c = gCols[i], c2 = String.fromCharCode(c.charCodeAt(0) + 1);
        _setCell(ws6, `${c}11`, m); _setCell(ws6, `${c2}11`, f);
        _setCell(ws6, `${c2}12`, m + f);
      });
      _setCell(ws6, 'T11', tm); _setCell(ws6, 'U11', tf); _setCell(ws6, 'U12', tm + tf);

      const lCols = ['H','J','L','N'];
      STMT_YE_LEVELS.forEach((k, i) => {
        const m = Number(snap.yearEnd.next?.[k]?.m) || 0;
        const f = Number(snap.yearEnd.next?.[k]?.f) || 0;
        const c = lCols[i], c2 = String.fromCharCode(c.charCodeAt(0) + 1);
        _setCell(ws6, `${c}15`, m); _setCell(ws6, `${c2}15`, f);
        _setCell(ws6, `${c2}16`, m + f);
      });

      const eCols = ['D','F','H','J','L','N','P','R'];
      const val = (rk, g) => Number(snap.yearEnd.exam?.[rk]?.[g]) || 0;
      STMT_YE_ROWS.forEach(([rk], ri) => {
        const row = 21 + ri;
        let total = 0;
        STMT_YE_EXAM_GRADES.forEach((g, gi) => {
          const v = rk === 'sat' ? val('total', g) - val('dropout', g) : val(rk, g);
          total += v;
          _setCell(ws6, `${eCols[gi]}${row}`, v);
        });
        _setCell(ws6, `T${row}`, total);
      });
    }

    const outBuf = await wb.xlsx.writeBuffer();
    const blob = new Blob([outBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const safeName = (sc.name || 'المدرسة').replace(/[/\\?%*:|"<>]/g, '-');
    a.href = url;
    a.download = `بيان_${safeName}_${MONTH_SHORT[snap.period.month]}_${snap.period.year}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);

    // الاقتطاع الصامت أخطر من الفشل: المدير يظنّ السطور وصلت وهي لم تصل.
    if (overflow.length && errEl) {
      errEl.textContent = 'صُدِّر الملف، لكن ورقة التعديلات لا تتّسع لكل السطور — '
        + overflow.join('؛ ') + '. سلّم الفائض بورقة إضافية.';
      errEl.hidden = false;
    }
  } catch (err) {
    console.error('[Statement] exportExcel', err);
    if (errEl) { errEl.textContent = 'تعذّر تصدير Excel — ' + (err?.message || err); errEl.hidden = false; }
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = 'تصدير Excel';
    if (spinner) spinner.hidden = true;
  }
}

// ── الطباعة ──────────────────────────────────────────────────────────────────
// تُطبع من اللقطة نفسها التي تُرسَل، فالورقة والمُرسَل لا يفترقان.
function printStatement() {
  const snap = _stmtSnapshot();
  const sc = snap.school;
  const win = window.open('', '_blank', 'width=1000,height=700');
  if (!win) { toast('يرجى السماح بالنوافذ المنبثقة', 'error'); return; }

  const esc = escapeHtml;
  const stuRows = snap.students.rows.map(r =>
    `<tr><td>${esc(r.label)}</td><td>${r.sections}</td><td>${r.enM}</td><td>${r.enF}</td>
     <td>${r.frM}</td><td>${r.frF}</td><td>${r.ruM}</td><td>${r.ruF}</td><td>${r.total}</td></tr>`).join('');
  const t = snap.students.totals;
  const admRows = snap.adminStaff.rows.map(r =>
    `<tr><td>${esc(r.role)}</td><td>${r.count}</td><td>${esc(r.words)}</td></tr>`).join('');
  const w = snap.workforce;
  const wfRows = [
    ['عدد المعلمين', w.teachers], ['عدد المدرسين', w.masters],
    ['عدد المدرسين المساعدين', w.assist], ['الجهاز التدريسي حسب الاختصاصات', w.bySpec],
    ['الجهاز التدريسي بشكل كامل', w.full], ['عدد الجهاز التدريسي غير المصنف', w.unclassified],
    ['كل العاملين في الجهاز الإداري', w.admin], ['العاملون المهنيون', w.professional],
    ['المستخدمون', w.worker], ['الحراس', w.guard], ['مجموع العاملين في المدرسة', w.grand],
  ].map(([l, v]) => `<tr><td>${esc(l)}</td><td>${v}</td></tr>`).join('');
  const chgRows = snap.changes.none && !snap.changes.items.length
    ? '<tr><td colspan="5">لا يوجد تعديل</td></tr>'
    : snap.changes.items.map(c =>
      `<tr><td>${esc(c.data?.name || '')}</td><td>${esc(c.data?.job || '')}</td>
       <td>${esc(_GRP_LABEL[c.group] || '')}</td><td>${esc(c.eventType || '')}</td>
       <td>${esc(c.effectiveDate || '')}</td></tr>`).join('');

  win.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl">
<head><meta charset="UTF-8">
<title>البيان الشهري — ${esc(sc.name)} — ${esc(MONTH_LABELS[snap.period.month])} ${snap.period.year}</title>
<style>
  @page { size:A4 landscape; margin:10mm; }
  body { font-family:'Segoe UI',Tahoma,sans-serif; font-size:9pt; direction:rtl; }
  h1 { font-size:12pt; margin:0 0 4px; }
  h2 { font-size:10pt; margin:10px 0 4px; }
  table { border-collapse:collapse; width:100%; margin-bottom:8px; }
  th, td { border:1px solid #555; padding:3px 5px; text-align:center; }
  th { background:#e2e8f0; font-weight:700; }
  td:first-child, th:first-child { text-align:right; }
  .meta { font-size:8pt; color:#333; margin-bottom:6px; line-height:1.7; }
  .sig { display:flex; justify-content:space-between; margin-top:18px; font-size:9pt; }
</style></head><body>
<h1>البيان الشهري — ${esc(sc.name)} — ${esc(MONTH_LABELS[snap.period.month])} ${snap.period.year}</h1>
<div class="meta">
  المنطقة التعليمية: ${esc(sc.educationalZone || '—')} | القرية: ${esc(sc.village || '—')} |
  العنوان: ${esc(sc.address || '—')} | الهاتف: ${esc(sc.phone || '—')}<br>
  الحلقة: ${esc(sc.cycle || '—')} | الرقم الإحصائي: ${esc(sc.statisticalNumber || '—')} |
  منهاج ريفي: ${sc.ruralCurriculum === null ? '—' : (sc.ruralCurriculum ? 'نعم' : 'لا')} | نوع الدوام: ${esc(sc.dayType || '—')} |
  مشترك مع: ${esc(sc.sharedWith || '—')}${sc.formerName ? ' | الاسم سابقاً: ' + esc(sc.formerName) : ''}
</div>
<h2>أعداد الطلاب والشعب</h2>
<table><thead><tr><th rowspan="2">الصف</th><th rowspan="2">الشعب</th><th colspan="2">انكليزي</th>
<th colspan="2">فرنسي</th><th colspan="2">روسي</th><th rowspan="2">المجموع</th></tr>
<tr><th>ذكور</th><th>إناث</th><th>ذكور</th><th>إناث</th><th>ذكور</th><th>إناث</th></tr></thead>
<tbody>${stuRows}</tbody>
<tfoot><tr><td>المجموع</td><td>${t.sections}</td><td>${t.enM}</td><td>${t.enF}</td>
<td>${t.frM}</td><td>${t.frF}</td><td>${t.ruM}</td><td>${t.ruF}</td><td>${t.total}</td></tr></tfoot></table>
<div class="meta">حلقة (1): ${snap.students.byCycle.cycle1} | حلقة (2): ${snap.students.byCycle.cycle2} |
رياض: ${snap.students.byCycle.kinder} | ثانوي: ${snap.students.byCycle.secondary}</div>
<h2>الجهاز الإداري</h2>
<table><thead><tr><th>الوظيفة</th><th>العدد</th><th>كتابةً</th></tr></thead><tbody>${admRows}
<tr><td><b>مجموع الإداريين</b></td><td><b>${snap.adminStaff.total}</b></td>
<td><b>${esc(arNumWord(snap.adminStaff.total))}</b></td></tr></tbody></table>
<h2>ملخّص العاملين</h2>
<table><tbody>${wfRows}</tbody></table>
<h2>التعديلات الطارئة</h2>
<table><thead><tr><th>الاسم</th><th>العمل المسند</th><th>الفئة</th><th>نوع الحدث</th><th>تاريخ النفاذ</th></tr></thead>
<tbody>${chgRows}</tbody></table>
<div class="sig"><span>أمين سر المدرسة: ${esc(snap.signatures.secretary || '')}</span>
<span>مدير المدرسة: ${esc(snap.signatures.principal || '')}</span></div>
</body></html>`);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 400);
}

CustomSelect.enhance('stmt-month-sel');
CustomSelect.enhance('stmt-edu-zone');
CustomSelect.enhance('stmt-day-type');
CustomSelect.enhance('stmt-rural');
CustomSelect.enhance('stmt-b-ownership');
CustomSelect.enhance('stmt-chg-group');
CustomSelect.enhance('stmt-chg-staff');
CustomSelect.enhance('stmt-chg-event');


// ════════════════════════════════════════════════════════════════════════════
//  وثائق «لا مانع» — نقل الطالب بين مدرستين (§23)
// ════════════════════════════════════════════════════════════════════════════
// المُبادِر هو المدرسة **المستقبِلة**: هي التي تُصدر «لا مانع لدينا من قبول
// الطالب … في مدرستنا»، والمدرسة الحالية هي التي توافق أو ترفض.
//
// ولذلك لا تُستعمل «صادر/وارد» في الواجهة إطلاقاً: تطبيق الوزارة يسمّي التبويب
// بمن أنشأ السجلّ، بينما المدير يفكّر باتجاه الطالب — والاتجاهان متعاكسان هنا،
// وهو ما يوقع القارئ في العكس. المقطعان يُسمَّيان باتجاه الطالب وحده.

const nocList        = el('noc-list');
const nocLoading     = el('noc-loading');
const nocError       = el('noc-error');
const nocEmpty       = el('noc-empty');
const nocOutCount    = el('noc-out-count');
const nocSegHint     = el('noc-seg-hint');
const btnRefreshNoc  = el('btn-refresh-noc');
const btnNocNew      = el('btn-noc-new');
const btnNocNewExc   = el('btn-noc-new-exc');

const modalNocIssue  = el('modal-noc-issue');
const nocIssueTitle  = el('noc-issue-title');
const nocNatId       = el('noc-national-id');
const nocFirstName   = el('noc-first-name');
const nocFatherName  = el('noc-father-name');
const nocFamilyName  = el('noc-family-name');
const btnNocVerify   = el('btn-noc-verify');
const nocVerifySpin  = el('noc-verify-spinner');
const nocVerifyHint  = el('noc-verify-hint');
const nocStage2      = el('noc-stage2');
const nocGradeWrap   = el('noc-grade-wrap');
const nocGradeSel    = el('noc-grade-sel');
const nocSectionSel  = el('noc-section-sel');
const nocSectionLbl  = el('noc-section-lbl');
const nocReasonSel   = el('noc-reason-sel');
const nocNotes       = el('noc-notes');
const nocIssueError  = el('noc-issue-error');
const btnNocSubmit   = el('btn-noc-submit');
const nocSubmitSpin  = el('noc-submit-spinner');

const modalNocVerify = el('modal-noc-verify');
const btnNocVOk      = el('btn-noc-v-ok');

const modalNocReview = el('modal-noc-review');
const nocRReason     = el('noc-r-reason');
const nocReviewError = el('noc-review-error');
const btnNocApprove  = el('btn-noc-approve');
const nocApproveSpin = el('noc-approve-spinner');
const btnNocReject   = el('btn-noc-reject');

let _nocLoaded   = false;
let _nocDocs     = [];
let _nocSeg      = 'incoming';
let _nocMyClasses= [];
let _nocDocType  = 'regular';
let _nocVerified = null;   // نتيجة lookup — بدونها لا إصدار
let _nocReviewId = null;
let _nocBusy     = false;

const NOC_REASONS = ['نقل سكن', 'نقل طالب', 'أسباب صحية', 'أسباب أخرى'];

// المقطعان يُفرَزان باتجاه الطالب لا بمن أنشأ السجلّ.
const NOC_SEG = {
  incoming: {
    hint:  'طلاب قادمون إلى مدرستك من مدارس أخرى — مدرستك هي من أصدرت الطلب.',
    match: (d, myId) => d.to_school_id === myId,
  },
  outgoing: {
    hint:  'طلاب من مدرستك تطلبهم مدارس أخرى — القرار عندك.',
    match: (d, myId) => d.from_school_id === myId,
  },
};

// «معلّق» تحمل معنيين متعاكسين حسب المقطع: بانتظارهم أو بانتظاري. الحالة في
// القاعدة واحدة، والنصّ يختلف — وإلا بقي المدير يخمّن هل الدور عليه.
const NOC_STATUS_TEXT = {
  incoming: {
    pending:   'بانتظار موافقة المدرسة الحالية',
    executed:  'نُفِّذ — التحق الطالب بمدرستنا',
    rejected:  'رُفض من المدرسة الحالية',
    cancelled: 'مسحوبة',
  },
  outgoing: {
    pending:   'بانتظار قرارك',
    executed:  'نُفِّذ — غادر الطالب',
    rejected:  'رُفض',
    cancelled: 'سحبتها المدرسة الطالبة',
  },
};
const NOC_STATUS_CLASS = {
  pending:   'req-status--pending',
  executed:  'req-status--approved',
  rejected:  'req-status--rejected',
  cancelled: 'req-status--cancelled',
};

const nocSectionLabel = (c) =>
  `${c.section || '—'}${c.level_track ? ` (مستوى ${['','أول','ثانٍ','ثالث'][c.level_track] || c.level_track})` : ''}`;

// ── التحميل والعرض ────────────────────────────────────────────────────────
async function loadNocDocs() {
  if (nocLoading) show(nocLoading);
  if (nocError)   hide(nocError);
  try {
    _nocDocs = await NDB.getTransferDocuments();
    renderNocList();
  } catch (err) {
    console.error('[NSAMS] loadNocDocs', err);
    if (nocError) show(nocError);
  } finally {
    if (nocLoading) hide(nocLoading);
  }
}

function renderNocList() {
  const myId = S.user?.schoolId;
  const seg  = NOC_SEG[_nocSeg];
  const rows = _nocDocs.filter(d => seg.match(d, myId));

  // الشارة على «المغادرة» وحدها — هي التي تنتظر قراراً من هذا المدير.
  const waiting = _nocDocs.filter(
    d => d.status === 'pending' && NOC_SEG.outgoing.match(d, myId)).length;
  if (nocOutCount) {
    nocOutCount.textContent = waiting > 0 ? String(waiting) : '';
    nocOutCount.hidden = waiting === 0;
  }
  if (nocSegHint) nocSegHint.textContent = seg.hint;

  if (!rows.length) {
    if (nocEmpty) show(nocEmpty);
    if (nocList)  nocList.innerHTML = '';
    return;
  }
  if (nocEmpty) hide(nocEmpty);

  if (nocList) nocList.innerHTML = rows.map(d => {
    const statusTxt = NOC_STATUS_TEXT[_nocSeg][d.status] || d.status;
    const statusCls = NOC_STATUS_CLASS[d.status] || 'req-status--pending';
    const canReview = _nocSeg === 'outgoing' && d.status === 'pending';
    const canCancel = _nocSeg === 'incoming' && d.status === 'pending';
    const kv = [
      ['اسم الأم',                d.mother_name],
      ['تاريخ الميلاد',           d.birth_date],
      ['الصف في المدرسة الجديدة', d.to_grade_label],
      ['الشعبة في المدرسة الجديدة', d.to_section_label],
      ['اللغة',                   d.to_foreign_language],
      ['سبب النقل',               d.transfer_reason],
      ['ملاحظات',                 d.notes],
      ['رقم الصادر',              d.outgoing_number],
      ['مُصدِر الوثيقة',           d.issued_by_name],
      ['معالِج الوثيقة',           d.processed_by_name],
      ['تاريخ المعالجة',          d.processed_at ? String(d.processed_at).slice(0, 10) : null],
      ['سبب الرفض',               d.reject_reason],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '')
     .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`)
     .join('');

    return `<div class="noc-card" data-open="0" data-id="${escapeHtml(d.id)}">
      <button type="button" class="noc-card-hdr" data-noc-toggle>
        <span class="noc-hd-main">
          <span class="noc-name">${escapeHtml(d.student_full_name || '—')}</span>
          <span class="noc-route">
            <span class="noc-route-line">
              <span class="noc-role-tag">من</span>
              <span class="noc-sch">${escapeHtml(d.from_school_name || '—')}</span>
              <span class="noc-role-note">المدرسة الحالية</span>
            </span>
            <span class="noc-route-line">
              <span class="noc-role-tag">إلى</span>
              <span class="noc-sch">${escapeHtml(d.to_school_name || '—')}</span>
              <span class="noc-role-note">المستقبِلة</span>
            </span>
          </span>
        </span>
        <span class="noc-hd-side">
          <span class="req-status ${statusCls}">${escapeHtml(statusTxt)}</span>
          <span class="req-date">${escapeHtml(String(d.issued_at || '').slice(0, 10))}</span>
          <svg class="noc-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
        </span>
      </button>
      <div class="noc-card-body" hidden>
        <dl class="noc-kv">${kv}</dl>
        <div class="noc-card-acts">
          <button type="button" class="btn btn-ghost btn-sm" data-act="print">
            <svg class="icon icon-sm"><use href="#ic-printer"/></svg> طباعة الورقة
          </button>
          ${canReview ? `<button type="button" class="btn btn-primary btn-sm" data-act="review">
            <svg class="icon icon-sm"><use href="#ic-clipboard"/></svg> البتّ في الطلب
          </button>` : ''}
          ${canCancel ? `<button type="button" class="btn btn-ghost btn-sm" data-act="cancel">
            <svg class="icon icon-sm"><use href="#ic-x-circle"/></svg> سحب الوثيقة
          </button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── نموذج الإصدار ─────────────────────────────────────────────────────────
function openNocIssue(docType) {
  _nocDocType  = docType;
  _nocVerified = null;
  if (nocIssueTitle) nocIssueTitle.textContent =
    docType === 'exceptional' ? 'إصدار وثيقة لا مانع استثنائية' : 'إصدار وثيقة لا مانع';
  [nocNatId, nocFirstName, nocFatherName, nocFamilyName, nocNotes].forEach(i => {
    if (!i) return;
    i.value = '';
    i.readOnly = false;
    i.classList.remove('field-locked');
  });
  if (nocStage2)     nocStage2.hidden = true;
  if (nocGradeWrap)  nocGradeWrap.hidden = docType !== 'exceptional';
  if (nocSectionLbl) nocSectionLbl.innerHTML = docType === 'exceptional'
    ? 'الشعبة الاستثنائية <span class="req">*</span>'
    : 'الشعبة المستقبِلة في مدرستك <span class="req">*</span>';
  if (nocVerifyHint) show(nocVerifyHint);
  if (nocIssueError) hide(nocIssueError);
  if (btnNocSubmit)  btnNocSubmit.disabled = true;
  fillSel(nocReasonSel, NOC_REASONS, '— بلا سبب —');
  show(modalNocIssue);
  modalNocIssue.querySelector('.sheet-body').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeNocIssue() {
  hide(modalNocIssue);
  document.body.style.overflow = '';
  _nocVerified = null;
}

// بعد التحقّق تُقفَل حقول الهوية: ما وُثِّق لا يُعدَّل بعده يدوياً.
function _lockNocIdentityFields(locked) {
  [nocNatId, nocFirstName, nocFatherName, nocFamilyName].forEach(i => {
    if (!i) return;
    i.readOnly = locked;
    i.classList.toggle('field-locked', locked);
  });
}

async function verifyNocStudent() {
  if (_nocBusy) return;
  const natId  = nocNatId?.value.trim()      || '';
  const first  = nocFirstName?.value.trim()  || '';
  const father = nocFatherName?.value.trim() || '';
  const family = nocFamilyName?.value.trim() || '';
  if (!natId)  { nocIssueError.textContent = 'الرقم التعريفي للطالب مطلوب'; show(nocIssueError); return; }
  if (!first || !father || !family) {
    nocIssueError.textContent = 'الاسم واسم الأب والكنية مطلوبة جميعاً للمطابقة';
    show(nocIssueError); return;
  }
  hide(nocIssueError);
  _nocBusy = true;
  if (btnNocVerify) btnNocVerify.disabled = true;
  if (nocVerifySpin) nocVerifySpin.hidden = false;
  try {
    const r = await NDB.lookupStudentForTransfer({
      nationalId: natId, firstName: first, fatherName: father, familyName: family });
    if (!r) throw new Error('لم يُعثر على طالب بهذا الرقم في رُقِيّ');
    _nocVerified = r;
    el('noc-v-name').textContent    = r.full_name || '—';
    el('noc-v-natid').textContent   = r.national_id || '—';
    el('noc-v-dob').textContent     = r.birth_date || '—';
    el('noc-v-school').textContent  = r.school_name || '—';
    el('noc-v-grade').textContent   = r.grade_label || '—';
    el('noc-v-section').textContent = r.section_label || '—';
    show(modalNocVerify);
  } catch (err) {
    _nocVerified = null;
    nocIssueError.textContent = err?.message || 'تعذّر التحقّق من بيانات الطالب.';
    show(nocIssueError);
  } finally {
    _nocBusy = false;
    if (btnNocVerify) btnNocVerify.disabled = false;
    if (nocVerifySpin) nocVerifySpin.hidden = true;
  }
}

// «البيانات صحيحة، متابعة» — يكشف المرحلة الثانية ويملأ الشعب المتاحة.
function acceptNocVerify() {
  hide(modalNocVerify);
  if (!_nocVerified) return;
  _lockNocIdentityFields(true);
  if (nocVerifyHint) hide(nocVerifyHint);
  if (nocStage2)     nocStage2.hidden = false;
  if (btnNocSubmit)  btnNocSubmit.disabled = false;

  if (_nocDocType === 'exceptional') {
    const grades = [...new Set(_nocMyClasses.map(c => c.grade).filter(Boolean))];
    fillSel(nocGradeSel, grades);
    nocGradeSel.value = '';
    CustomSelect.refresh(nocGradeSel);
    fillSel(nocSectionSel, []);
  } else {
    fillNocSections(_nocVerified.grade_label);
  }
}

// الشعب المتاحة في صفّ بعينه من مدرستي. القيمة معرّف الشعبة والنصّ اسمها.
function fillNocSections(grade) {
  const opts = _nocMyClasses.filter(c => c.grade === grade);
  if (!nocSectionSel) return;
  nocSectionSel.innerHTML = '<option value="">— اختر —</option>' +
    opts.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(nocSectionLabel(c))}</option>`).join('');
  CustomSelect.refresh(nocSectionSel);
  if (!opts.length && nocIssueError) {
    nocIssueError.textContent =
      `لا توجد شعبة في الصف «${grade || '—'}» في مدرستك — استخدم الوثيقة الاستثنائية لوضعه في صفّ آخر.`;
    show(nocIssueError);
  }
}

async function submitNocDocument() {
  if (_nocBusy) return;
  if (!_nocVerified) {
    nocIssueError.textContent = 'اضغط «تحقق من بيانات الطالب» أولاً.';
    show(nocIssueError); return;
  }
  const toClassId = nocSectionSel?.value || '';
  if (!toClassId) {
    nocIssueError.textContent = 'اختر الشعبة التي ستستقبل الطالب في مدرستك.';
    show(nocIssueError); return;
  }
  hide(nocIssueError);
  _nocBusy = true;
  if (btnNocSubmit) btnNocSubmit.disabled = true;
  if (nocSubmitSpin) nocSubmitSpin.hidden = false;
  try {
    const doc = await NDB.issueTransferDocument({
      docType:        _nocDocType,
      nationalId:     nocNatId.value.trim(),
      firstName:      nocFirstName.value.trim(),
      fatherName:     nocFatherName.value.trim(),
      familyName:     nocFamilyName.value.trim(),
      toClassId,
      transferReason: nocReasonSel?.value || null,
      notes:          nocNotes?.value.trim() || null,
    });
    closeNocIssue();
    toast(`صدرت الوثيقة برقم صادر ${doc.outgoing_number}`, 'success');
    _nocSeg = 'incoming';
    document.querySelectorAll('[data-noc-seg]').forEach(b =>
      b.classList.toggle('is-active', b.dataset.nocSeg === 'incoming'));
    await loadNocDocs();
    printNocDocument(doc);
  } catch (err) {
    nocIssueError.textContent = err?.message || 'تعذّر إصدار الوثيقة.';
    show(nocIssueError);
  } finally {
    _nocBusy = false;
    if (btnNocSubmit) btnNocSubmit.disabled = false;
    if (nocSubmitSpin) nocSubmitSpin.hidden = true;
  }
}

// ── البتّ (المدرسة الحالية) ────────────────────────────────────────────────
function openNocReview(doc) {
  _nocReviewId = doc.id;
  el('noc-r-name').textContent  = doc.student_full_name || '—';
  el('noc-r-route').textContent =
    `${doc.from_school_name || '—'} ← ${doc.to_school_name || '—'} · ` +
    `الصف ${doc.to_grade_label || '—'} · الشعبة ${doc.to_section_label || '—'}`;
  if (nocRReason) nocRReason.value = '';
  if (nocReviewError) hide(nocReviewError);
  show(modalNocReview);
  document.body.style.overflow = 'hidden';
}

function closeNocReview() {
  hide(modalNocReview);
  document.body.style.overflow = '';
  _nocReviewId = null;
}

async function reviewNoc(action) {
  if (_nocBusy || !_nocReviewId) return;
  const reason = nocRReason?.value.trim() || null;
  if (action === 'reject' && !reason) {
    nocReviewError.textContent = 'اذكر سبب الرفض — يصل إلى المدرسة الطالبة.';
    show(nocReviewError); return;
  }
  const ok = await askConfirm(
    action === 'approve'
      ? 'الموافقة تنقل الطالب فوراً ولا يمكن التراجع عنها. متابعة؟'
      : 'سيُرفض طلب النقل ويُبلَّغ المُصدِر بالسبب. متابعة؟',
    action === 'approve' ? 'موافقة ونقل' : 'رفض');
  if (!ok) return;
  hide(nocReviewError);
  _nocBusy = true;
  if (btnNocApprove) btnNocApprove.disabled = true;
  if (btnNocReject)  btnNocReject.disabled  = true;
  if (nocApproveSpin && action === 'approve') nocApproveSpin.hidden = false;
  try {
    await NDB.reviewTransferDocument(_nocReviewId, action, reason);
    closeNocReview();
    toast(action === 'approve' ? 'نُفِّذ النقل — غادر الطالب مدرستك' : 'رُفض طلب النقل', 'success');
    await loadNocDocs();
    // قوائم الطلاب تغيّرت فعلياً: أعِد تحميلها في زيارتها القادمة.
    _studentsLoaded = false;
  } catch (err) {
    nocReviewError.textContent = err?.message || 'تعذّر تنفيذ القرار.';
    show(nocReviewError);
  } finally {
    _nocBusy = false;
    if (btnNocApprove) btnNocApprove.disabled = false;
    if (btnNocReject)  btnNocReject.disabled  = false;
    if (nocApproveSpin) nocApproveSpin.hidden = true;
  }
}

async function cancelNoc(doc) {
  const ok = await askConfirm(
    `سحب الوثيقة رقم ${doc.outgoing_number}؟ الرقم يبقى محجوزاً في سجلّ الصادر ولا يُعاد استعماله.`,
    'سحب');
  if (!ok) return;
  try {
    await NDB.cancelTransferDocument(doc.id);
    toast('سُحبت الوثيقة', 'success');
    await loadNocDocs();
  } catch (err) {
    toast(err?.message || 'تعذّر سحب الوثيقة', 'error');
  }
}

// ── التهيئة والأسلاك ──────────────────────────────────────────────────────
async function initNocTab() {
  _nocLoaded = true;
  try {
    _nocMyClasses = await NDB.getSchoolClasses(S.user.schoolId);
  } catch (err) {
    console.warn('[NSAMS] initNocTab: classes', err);
    _nocMyClasses = [];
  }
  await loadNocDocs();
}

document.querySelectorAll('[data-noc-seg]').forEach(btn => {
  btn.addEventListener('click', () => {
    _nocSeg = btn.dataset.nocSeg;
    document.querySelectorAll('[data-noc-seg]').forEach(b =>
      b.classList.toggle('is-active', b === btn));
    renderNocList();
  });
});

btnRefreshNoc?.addEventListener('click', loadNocDocs);
btnNocNew?.addEventListener('click',     () => openNocIssue('regular'));
btnNocNewExc?.addEventListener('click',  () => openNocIssue('exceptional'));

el('btn-close-noc-issue')?.addEventListener('click', closeNocIssue);
modalNocIssue?.addEventListener('click', e => { if (e.target === modalNocIssue) closeNocIssue(); });
btnNocVerify?.addEventListener('click', verifyNocStudent);
btnNocSubmit?.addEventListener('click', submitNocDocument);

el('btn-close-noc-verify')?.addEventListener('click', () => hide(modalNocVerify));
modalNocVerify?.addEventListener('click', e => { if (e.target === modalNocVerify) hide(modalNocVerify); });
btnNocVOk?.addEventListener('click', acceptNocVerify);

el('btn-close-noc-review')?.addEventListener('click', closeNocReview);
modalNocReview?.addEventListener('click', e => { if (e.target === modalNocReview) closeNocReview(); });
btnNocApprove?.addEventListener('click', () => reviewNoc('approve'));
btnNocReject?.addEventListener('click',  () => reviewNoc('reject'));

nocGradeSel?.addEventListener('change', () => fillNocSections(nocGradeSel.value));

// تفويض واحد على الحاوية بدل مستمع لكل بطاقة
nocList?.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-noc-toggle]');
  if (toggle) {
    const card = toggle.closest('.noc-card');
    const open = card.dataset.open === '1';
    card.dataset.open = open ? '0' : '1';
    card.querySelector('.noc-card-body').hidden = open;
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const doc = _nocDocs.find(d => d.id === btn.closest('.noc-card')?.dataset.id);
  if (!doc) return;
  if      (btn.dataset.act === 'print')  printNocDocument(doc);
  else if (btn.dataset.act === 'review') openNocReview(doc);
  else if (btn.dataset.act === 'cancel') cancelNoc(doc);
});

CustomSelect.enhance('noc-grade-sel');
CustomSelect.enhance('noc-section-sel');
CustomSelect.enhance('noc-reason-sel');

// ── طباعة «ورقة لا مانع» ──────────────────────────────────────────────────
// نافذة طباعة كبقية مطبوعات البوابة (كشف الحضور، البيان) لا مكتبة PDF: المدير
// سيوقّع ويختم بيده على أي حال، وحوار الطباعة يعطي «حفظ كـPDF» مجاناً.
//
// كل حقل من لقطة الوثيقة لا من قراءة حيّة — الورقة تُطبع بعد سنة كما صدرت.

const NOC_LANG_AR = { 'انكليزي': 'الإنكليزية', 'فرنسي': 'الفرنسية', 'روسي': 'الروسية' };

async function printNocDocument(doc) {
  const win = window.open('', '_blank');
  if (!win) { toast('امنع حاصر النوافذ المنبثقة لطباعة الورقة', 'error'); return; }

  const logo = await eagleDataUri();
  const esc  = escapeHtml;

  // صياغة تتبع جنس الطالب — «الطالبة / التلميذة … ابنة السيد» مقابل المذكّر.
  const isF   = doc.student_gender === 'female';
  const who   = isF ? 'الطالبة / التلميذة' : 'الطالب / التلميذ';
  const child = isF ? 'ابنة السيد'          : 'ابن السيد';

  // «شام باسم الاسماعيل» = الاسم + الأب + الكنية (بلا الجد، كما في الورقة).
  const name = [doc.first_name, doc.father_name, doc.family_name]
    .filter(Boolean).join(' ') || doc.student_full_name || '—';

  const d    = new Date(doc.issued_at || Date.now());
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const date = `${dd} / ${mm} / ${d.getFullYear()} م`;
  const lang = NOC_LANG_AR[doc.to_foreign_language] || doc.to_foreign_language || '—';

  win.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>ورقة لا مانع — ${esc(name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family:'Cairo',Arial,sans-serif; color:#0f172a; margin:0; font-size:13px; line-height:1.9; }
  .pg { border:1px solid #cbd5e1; padding:18px 20px; }
  .pgno { font-size:11px; color:#64748b; }
  .hd { display:flex; align-items:flex-start; gap:12px; }
  .hd-t { flex:1; text-align:center; font-size:19px; font-weight:900; margin-top:6px; }
  .logo { width:64px; height:64px; object-fit:contain; }
  .meta { display:flex; justify-content:space-between; gap:24px; margin-top:10px; }
  .meta div { flex:1; }
  .meta b { font-weight:700; }
  .dots { letter-spacing:2px; color:#475569; }
  .body { margin:26px 0 8px; }
  .body .ln { margin-bottom:10px; }
  .req { text-align:center; font-weight:700; margin:18px 0 26px; }
  .dates { display:flex; justify-content:space-between; gap:24px; margin-top:30px; }
  .sig { margin-top:26px; display:flex; justify-content:space-between; align-items:flex-start; gap:24px; }
  .sig-c { text-align:center; flex:1; }
  .sig-c .ttl { font-weight:700; margin-bottom:10px; }
  .sig-c .fld { text-align:start; display:inline-block; }
  .stamp { width:120px; text-align:center; color:#475569; }
</style></head><body>
<div class="pg">
  <div class="pgno">رقم الصفحة ١</div>
  <div class="hd">
    <div class="hd-t">ورقة لا مانع</div>
    ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
  </div>

  <div class="meta">
    <div>
      <div>مديرية التربية والتعليم في: <b>${esc(doc.to_directorate_name || '—')}</b></div>
      <div>المجمع التربوي في: <b>${esc(doc.to_complex_name || '—')}</b></div>
      <div>المدرسة: <b>${esc(doc.to_school_name || '—')}</b></div>
    </div>
    <div>
      <div>كود المدرسة: <span class="dots">............</span></div>
      <div>رقم الصادر: <b>${esc(String(doc.outgoing_number ?? '—'))}</b></div>
    </div>
  </div>

  <div class="body">
    <div class="ln">لا مانع لدينا من قبول ${who}: <b>${esc(name)}</b>
      ${child}: <b>${esc(doc.father_name || '—')}</b></div>
    <div class="ln">في الصف: <b>${esc(doc.to_grade_label || '—')}</b>
      &nbsp;&nbsp; اللغة: <b>${esc(lang)}</b> &nbsp;&nbsp; في مدرستنا</div>
  </div>
  <div class="req">يرجى موافاتنا بوثيقة الانتقال مصدقة أصولاً</div>

  <div class="dates">
    <div>الموافق لـ: <span class="dots">.. / .. / ....</span> هـ</div>
    <div>الواقع في: <b>${esc(date)}</b></div>
  </div>

  <div class="sig">
    <div class="stamp">الخاتم</div>
    <div class="sig-c">
      <div class="ttl">مدير المدرسة</div>
      <div class="fld">
        <div>الاسم: <b>${esc(doc.issued_by_name || '—')}</b></div>
        <div>التوقيع:</div>
      </div>
    </div>
    <div class="stamp"></div>
  </div>
</div>
<scr${''}ipt>window.onload=function(){setTimeout(function(){window.print()},400)}</scr${''}ipt>
</body></html>`);
  win.document.close();
}


// ── Start the app (after all declarations are initialized) ──
bootstrap();