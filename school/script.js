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
  getSchoolById,       // ← NEW: fetches real school row from DB
  saveAttendance,
  submitReport,
  syncPending,
  getPendingAttendance,
  getPendingReports,
  localDateISO,
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
const SCHOOL_CACHE_PREFIX = 'nsams_school_';

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
    // 'primary' (ابتدائي) | 'middle_high' (إعدادي/ثانوي). Drives معلم↔موجه labels.
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
  RW = roleWords(S.school?.type === 'middle_high');
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
  if (supSection) supSection.hidden = !isMiddleHigh();
  // Role choices depend on the school type, not the grade number (إعدادي/ثانوي
  // classes are numbered الأول/الثاني/الثالث which stageForGrade would misread).
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

    S.attSubmitted = true;
    hide(attCard);
    show(attDone);
    attDoneSub.textContent = `${formatDateAr(todayISO())} — ${
      result.synced ? 'تم الإرسال' : 'محفوظ محلياً'
    }`;
    setStatusDone(result.synced);

    if (result.synced) {
      toast('تم إرسال سجل الحضور بنجاح', 'success');
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
btnLogout.addEventListener('click', async () => {
  if (!confirm('هل تريد تسجيل الخروج؟')) return;
  try { await logout(); } catch { /* ignore */ }
  S.user           = null;
  S.school         = null;
  S.absentTeachers = [];
  S.attSubmitted   = false;
  showScreen('login');
});

// ── App init ──────────────────────────────────────────────────────────────────
async function initApp() {
  showScreen('app');

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

  // Reset attendance state
  S.absentTeachers = [];
  S.attSubmitted   = false;
  show(attCard);
  hide(attDone);
  inStuPresent.value = '0';
  inStuAbsent.value  = '0';
  inNotes.value      = '';
  btnSubmitAtt.disabled = false;

  setStatusPending();
  renderAbsentList();
  resetReportForm();
  updateConnUI();

  // Default to the attendance tab on each app entry; other tabs load lazily.
  switchTab('attendance');
  _manageLoaded    = false;
  _subjectsLoaded  = false;
  _mngSubjectsInit = false;
  _reportsLoaded   = false;
  _staffLoaded     = false;
  _registryLoaded  = false;
  _statementLoaded = false;
  _lookupCache     = {};

  // Kick off sync of any offline-queued records
  await doSync();

  // Notifications (badge + realtime + push registration + attendance reminder)
  initNotifications(S.user.user.id);

  // Load teacher submissions now that S.school is populated.
  // (Previously triggered by a fragile MutationObserver that could fire before
  //  school data was ready; called directly here instead.)
  await loadClassSummaries();
  loadStaffDailyCounts();   // auto-fill admin/worker counts from the staff register
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
  div.innerHTML = `
    <div class="csub-grade">${s.grade}</div>
    <div class="csub-info">
      <div class="csub-name">${escapeHtml(s.displayName)}</div>
      <div class="csub-teacher">${escapeHtml(s.teacherName)}</div>
    </div>
    <div class="csub-stats">${statsHtml}</div>
    <span class="csub-badge ${badgeCls}">${badgeTxt}</span>
    ${actionsHtml}
  `;
  return div;
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
const fabReport       = el('btn-open-report');

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

const TABS = {
  attendance: { tab: tabAttendance, view: viewAttendance },
  manage:     { tab: tabManage,     view: viewManage },
  students:   { tab: tabStudents,   view: viewStudents },
  staff:      { tab: tabStaff,      view: viewStaff },
  subjects:   { tab: tabSubjects,   view: viewSubjects },
  reports:    { tab: tabReports,    view: viewReports },
  registry:   { tab: tabRegistry,   view: viewRegistry },
  statement:  { tab: tabStatement,  view: viewStatement },
  personnel:  { tab: tabPersonnel,  view: viewPersonnel },
};

function switchTab(tab) {
  for (const [name, { tab: t, view: v }] of Object.entries(TABS)) {
    const active = name === tab;
    if (v) v.hidden = !active;
    if (t) {
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    }
  }
  // The emergency-report FAB belongs to the attendance view only.
  if (fabReport) fabReport.hidden = tab !== 'attendance';
  // The «المزيد» hamburger lights up whenever a non-primary section is active,
  // and the menu closes after a selection.
  if (btnMore) btnMore.classList.toggle('is-active', tab !== 'attendance');
  closeMoreMenu();

  if (tab === 'manage'   && !_manageLoaded)  loadManageClasses();
  if (tab === 'manage'   && !_mngSubjectsInit) initManageSubjects();
  if (tab === 'students' && !_studentsLoaded) initStudentsTab();
  if ((tab === 'staff' || tab === 'personnel') && !_staffLoaded) initStaffTab();
  if (tab === 'subjects'  && !_subjectsLoaded)  initSubjectsTab();
  if (tab === 'reports'   && !_reportsLoaded)   initReportsTab();
  if (tab === 'registry'  && !_registryLoaded)  initRegistryTab();
  if (tab === 'statement' && !_statementLoaded) initStatementTab();
}

tabAttendance.addEventListener('click', () => switchTab('attendance'));
tabManage.addEventListener('click',     () => switchTab('manage'));
tabStudents.addEventListener('click',   () => switchTab('students'));
tabStaff.addEventListener('click',      () => switchTab('staff'));
tabSubjects.addEventListener('click',   () => switchTab('subjects'));
tabReports.addEventListener('click',    () => switchTab('reports'));
tabRegistry?.addEventListener('click',   () => switchTab('registry'));
tabStatement?.addEventListener('click',  () => switchTab('statement'));
tabPersonnel?.addEventListener('click',  () => switchTab('personnel'));

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

function isMiddleHigh() {
  return S.school?.type === 'middle_high';
}

function selectedClassGrade() {
  const opt = mngClassSelect.selectedOptions[0];
  const g = opt ? Number(opt.dataset.grade) : NaN;
  return Number.isFinite(g) ? g : null;
}

// Role choices for the teacher (معلم) section depend on the SCHOOL type:
// • primary (ابتدائي): معلم الصف (حضور + درجات) or أستاذ مادة (درجات فقط).
// • middle_high (إعدادي/ثانوي): أستاذ مادة only — attendance is handled by the
//   separate موجه section.
function populateRoleOptions() {
  const roles = isMiddleHigh() ? ['subject'] : ['homeroom', 'subject'];
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
    if (isMiddleHigh()) {
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
    const ok = confirm(RW.removeConfirm(name));
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
const subjCompList   = el('subj-comp-list');
const btnAddComp     = el('btn-add-comp');
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

// Keep the teacher-assignment subjects picker (mng-subj-pick) in sync after a
// subject is created/edited/deleted for the currently selected class's grade.
function refreshAssignSubjectsPicker() {
  if (mngClassSelect.value) loadSubjectsPicker(selectedClassGrade());
}

function buildSubjectRow(sub) {
  const li = document.createElement('li');
  li.className = 'subj-row';
  const tag = (sub.is_core_arabic ? '<span class="subj-tag">عربي</span>' : '')
            + (sub.is_core_math ? '<span class="subj-tag">رياضيات</span>' : '');
  li.innerHTML = `
    <div class="subj-info">
      <div class="subj-name">${escapeHtml(sub.name)}${tag}</div>
      <div class="subj-meta">العظمى ${escapeHtml(String(sub.max_total))} · النجاح ${escapeHtml(String(sub.pass_mark))}٪</div>
    </div>
    <div class="subj-actions">
      <button class="icon-btn-sm" data-act="edit" aria-label="تعديل">
        <svg class="icon icon-sm"><use href="#ic-edit"/></svg>
      </button>
      <button class="icon-btn-sm danger" data-act="del" aria-label="حذف">
        <svg class="icon icon-sm"><use href="#ic-trash"/></svg>
      </button>
    </div>
  `;
  li.querySelector('[data-act="edit"]').addEventListener('click', () => openSubjectModal(sub));
  li.querySelector('[data-act="del"]').addEventListener('click', () => deleteSubjectRow(sub));
  return li;
}

async function deleteSubjectRow(sub) {
  if (!confirm(`حذف المادة «${sub.name}»؟ ستُحذف درجاتها أيضاً.`)) return;
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
btnAddSubject.addEventListener('click', () => openSubjectModal(null));

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
      });
    } else {
      subjectId = await NDB.createSubject({
        schoolId: S.school.id, grade: _subjGrade,
        name, maxTotal, passMark,
        isCoreArabic: subjArabicIn.checked, isCoreMath: subjMathIn.checked,
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
  if (!confirm(`تأكيد تنفيذ الترفيع السنوي لـ ${cards.length} طالب؟ هذا الإجراء لا يمكن التراجع عنه.`)) return;

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
  if (!confirm('إرسال الجلاء للمديرية؟ لن يمكن تعديله حتى تُراجعه المديرية.')) return;

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

function reportCardHtml(card, term) {
  const isS1 = term === 's1';

  let thead, rows;
  if (isS1) {
    thead = '<tr><th>المادة</th><th>علامة الفصل الأول</th></tr>';
    rows = card.subjects.map(s =>
      '<tr>' +
        '<td>' + escapeHtml(s.name) + '</td>' +
        '<td>' + fmtNum(s.sem1) + ' / ' + escapeHtml(String(s.maxTotal)) + '</td>' +
      '</tr>'
    ).join('');
  } else {
    thead = '<tr><th>المادة</th><th>الفصل الأول</th><th>الفصل الثاني</th><th>المعدّل</th><th>النتيجة</th></tr>';
    rows = card.subjects.map(s => {
      const verdict = s.passed == null ? '—' : (s.passed ? 'ناجح' : 'راسب');
      const cls = s.passed === false ? ' style="color:#DC2626;font-weight:700"' : '';
      return '<tr>' +
        '<td>' + escapeHtml(s.name) + '</td>' +
        '<td>' + fmtNum(s.sem1) + '</td>' +
        '<td>' + fmtNum(s.sem2) + '</td>' +
        '<td>' + fmtNum(s.mark) + ' / ' + escapeHtml(String(s.maxTotal)) + '</td>' +
        '<td' + cls + '>' + verdict + '</td>' +
      '</tr>';
    }).join('');
  }

  const title = isS1 ? 'شهادة الفصل الأول' : 'شهادة نهاية العام';

  let footer;
  if (isS1) {
    footer = 'معدّل الفصل الأول: <strong>' +
      (card.finalPercent == null ? '—' : fmtNum(card.finalPercent) + '٪') + '</strong>';
  } else {
    const b = resultBadge(card);
    const resultColor = b.cls === 'pass' ? '#059669' : (b.cls === 'fail' ? '#DC2626' : '#64748B');
    const band = _repData?.band;
    let extra = '';
    if (band === 'B' || band === 'C') {
      extra += ' &nbsp;·&nbsp; الدوام: <strong>' +
        (card.attendancePercent == null ? '—' : fmtNum(card.attendancePercent) + '٪') + '</strong>';
    }
    if (band === 'C') {
      extra += ' &nbsp;·&nbsp; السلوك: <strong>' +
        (card.conductMark == null ? '—' : fmtNum(card.conductMark)) + '</strong>';
    }
    footer = 'النسبة النهائية: <strong>' + (card.finalPercent == null ? '—' : fmtNum(card.finalPercent) + '٪') + '</strong>' +
      extra +
      ' &nbsp;·&nbsp; النتيجة: <strong style="color:' + resultColor + '">' + b.text + '</strong>';
  }

  return '<section class="card-page">' +
    '<div class="rc-head">' + '%%LOGO%%' +
      '<h1>' + escapeHtml(S.school?.name || '') + '</h1>' +
      '<div class="sub">' + title + ' — العام الدراسي ' + escapeHtml(_repData.academicYear) + '</div>' +
    '</div>' +
    '<div class="rc-meta">' +
      '<div><strong>الطالب:</strong> ' + escapeHtml(card.student.full_name) + '</div>' +
      '<div><strong>الصف:</strong> ' + escapeHtml(classDisplay()) + '</div>' +
    '</div>' +
    '<table><thead>' + thead + '</thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    '<div class="rc-final">' + footer + '</div>' +
    '</section>';
}

async function printReportDoc(win, cards, term = 'year') {
  const logo = await eagleDataUri();
  const logoHtml = logo ? '<img class="logo" src="' + logo + '" alt="">' : '';
  const body = cards.map(c => reportCardHtml(c, term).replace('%%LOGO%%', logoHtml)).join('');

  win.document.write(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<title>شهادة درجات</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">' +
    '<style>' +
    "body{font-family:'Cairo',Arial,sans-serif;color:#0f172a;padding:24px;margin:0}" +
    '.card-page{page-break-after:always}' +
    '.card-page:last-child{page-break-after:auto}' +
    '.rc-head{text-align:center;margin-bottom:8px}' +
    '.logo{width:84px;height:84px;object-fit:contain;display:block;margin:0 auto 8px}' +
    'h1{font-size:19px;margin:0 0 2px;color:#06b6d4}' +
    '.sub{color:#475569;font-size:13px;margin:2px 0}' +
    '.rc-meta{display:flex;justify-content:space-between;font-size:13px;margin:14px 0 8px;gap:12px}' +
    'table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}' +
    'th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:center}' +
    'th{background:#06b6d4;color:#fff}' +
    'td:first-child{text-align:right}' +
    'tr:nth-child(even) td{background:#f8fafc}' +
    '.rc-final{margin-top:14px;font-size:15px;text-align:center}' +
    '@media print{@page{margin:14mm}}' +
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
    await NDB.setStudentGrace({
      studentId: _graceCard.student.id,
      classId:   _repData.class.id,
      schoolId:  S.school.id,
      items,
      adminId:   S.user?.user?.id ?? null,
    });
    closeGraceModal();
    toast('تم حفظ درجات المساعدة', 'success');
    loadReports(_repData.class.id);
  } catch (err) {
    console.error('[NSAMS] setStudentGrace', err);
    graceErrorEl.textContent = 'تعذّر الحفظ.'; show(graceErrorEl);
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
const ROSTER_KIND_AR = { teacher: 'معلم', admin: 'إداري', worker: 'عامل' };

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
    rosterCounts.textContent = `${t} معلم · ${a} إداري · ${w} عامل`;
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
               buildGroup('العمال', workers);

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
        `<button class="staff-roster-del" data-act="del-personnel" aria-label="إزالة">` +
          `<svg class="icon icon-sm"><use href="#ic-x"/></svg></button>` +
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
  if (!confirm('إزالة هذا الموظف من السجل؟')) return;
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
        if (!confirm('تأكيد ترقين قيد هذا الطالب؟')) return;
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
    // If a registry lookup was done, link the student to the national registry.
    if (_stuRegistryData && res.id && res.synced) {
      try {
        await NDB.linkStudentToRegistry(res.id, _stuRegistryData.national_id);
      } catch (linkErr) {
        console.warn('[NSAMS] linkStudentToRegistry (non-fatal)', linkErr);
      }
    }
    _stuRegistryData = null;
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

// ── Student registry lookup (السجل الوطني للطالب) ────────────────────────────
let _stuRegistryData = null;
const stuRegResult    = el('stu-reg-result');
const btnStuRegLookup = el('btn-stu-reg-lookup');

function openStudentFormOrig() {}  // placeholder — real fn defined above as openStudentForm

// Reset registry state when form opens (patch the existing openStudentForm)
const _origOpenStudentForm = openStudentForm;
// @ts-ignore — wrapping the existing function
window._openStudentForm = (student) => {
  _stuRegistryData = null;
  if (stuRegResult) stuRegResult.hidden = true;
  _origOpenStudentForm(student);
};

btnStuRegLookup?.addEventListener('click', async () => {
  const natId = el('stu-natid')?.value.trim();
  if (!natId) {
    if (stuRegResult) { _showRegResult(stuRegResult, 'أدخل الرقم الوطني (11 رقماً) أولاً.', 'error'); } return;
  }
  if (!/^\d{11}$/.test(natId)) {
    if (stuRegResult) { _showRegResult(stuRegResult, `الرقم الوطني يجب أن يكون ١١ رقماً — أدخلت ${natId.length}.`, 'error'); }
    return;
  }
  btnStuRegLookup.disabled = true;
  _showRegResult(stuRegResult, 'جارٍ البحث…', 'info');
  try {
    const res = await NDB.lookupNationalStudent(natId);
    if (!res.ok || !res.data) {
      _showRegResult(stuRegResult, 'لم يُعثر على الطالب في السجل الوطني.', 'error');
      _stuRegistryData = null; return;
    }
    const d = res.data;
    _stuRegistryData = d;
    // Fill personal fields from registry
    const firstEl  = el('stu-first');
    const fatherEl = el('stu-father');
    const familyEl = el('stu-family');
    const genderEl = el('stu-gender');
    if (firstEl)  firstEl.value  = d.first_name   || '';
    if (fatherEl) fatherEl.value = d.father_name  || '';
    if (familyEl) familyEl.value = d.family_name  || '';
    if (genderEl) { genderEl.value = d.gender || ''; CustomSelect.refresh(genderEl); }
    const motherEl    = el('stu-mother');
    const motherFamEl = el('stu-mother-family');
    const grandEl     = el('stu-grandfather');
    const bpEl        = el('stu-birthplace');
    const cardEl      = el('stu-card');
    if (motherEl)    motherEl.value    = d.mother_name    || '';
    if (motherFamEl) motherFamEl.value = d.mother_family  || '';
    if (grandEl)     grandEl.value     = d.grandfather_name || '';
    if (bpEl)        bpEl.value        = d.birth_place    || '';
    if (cardEl)      cardEl.value      = d.card_number    || '';
    if (d.birth_date) {
      const [y, m, dd] = d.birth_date.split('-');
      const dobY = el('stu-dob-year'); const dobM = el('stu-dob-month'); const dobD = el('stu-dob-day');
      if (dobY) dobY.value = y;
      if (dobM) dobM.value = String(Number(m));
      if (dobD) dobD.value = String(Number(dd));
    }
    _showRegResult(stuRegResult, `السجل الوطني: ${escapeHtml(d.full_name)} — سيُربط الطالب بالسجل عند الحفظ`, 'success');
  } catch (err) {
    _showRegResult(stuRegResult, `تعذّر البحث: ${err.message}`, 'error');
    _stuRegistryData = null;
  } finally {
    btnStuRegLookup.disabled = false;
  }
});

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
  if (el('sch-edutype'))        el('sch-edutype').value        = s.education_type ?? '';
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
      return `<li class="notif-item${unread}" data-id="${n.id}">
        <div class="notif-item-title">${n.title}</div>
        ${n.body ? `<div class="notif-item-body">${n.body}</div>` : ''}
        <div class="notif-item-time">${ago}</div>
      </li>`;
    }).join('');
  } catch (e) {
    console.warn('[NSAMS] loadNotifList', e);
  }
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
    if (Notification.permission === 'granted') {
      new Notification(notif.title, { body: notif.body ?? '', dir: 'rtl', lang: 'ar' });
    }
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
const srGeneralNumber = el('sr-general-number');
const srGender        = el('sr-gender');
const srRegResult     = el('sr-reg-result');
const btnSrRegLookup  = el('btn-sr-reg-lookup');
const srNationalId    = el('sr-national-id');
const srMotherName    = el('sr-mother-name');
const srDobDay        = el('sr-dob-day');
const srDobMonth      = el('sr-dob-month');
const srDobYear       = el('sr-dob-year');
const srPhone         = el('sr-phone');
const srResZone       = el('sr-res-zone');
const srEduZone       = el('sr-edu-zone');
const srMinDoc        = el('sr-min-doc');
const srNotes         = el('sr-notes');
const srError         = el('sr-error');
const srSaveSpinner   = el('sr-save-spinner');
const btnSaveStaffRec = el('btn-save-staff-rec');

let _srRegistryData = null;   // كائن بيانات السجل الذاتي عند وجود ربط ناجح
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
      r.general_number ? `عام: ${escapeHtml(r.general_number)}`   : null,
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
  _srRegistryData = null;
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

  const textInputs = [srFullName, srNationalId, srMotherName, srDobDay, srDobMonth,
                      srDobYear, srStartDay, srStartMonth, srStartYear, srSubject, srPhone, srResZone, srNotes,
                      srSelfNumber, srGeneralNumber];
  const numInputs  = [srSeniority];

  if (rec) {
    srFullName.value      = rec.full_name          || '';
    srNationalId.value    = rec.national_id        || '';
    srMotherName.value    = rec.mother_name        || '';
    srPhone.value         = rec.phone              || '';
    srResZone.value       = rec.residential_zone   || '';
    srNotes.value         = rec.notes              || '';
    srSubject.value       = rec.subject_taught     || '';
    srSeniority.value     = rec.seniority_years    ?? '';
    srSelfNumber.value    = rec.self_number        || '';
    srGeneralNumber.value = rec.general_number     || '';
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
    srGender && (srGender.value = rec.gender   || '');
    [srJobTitle, srSpec, srCertificate, srHigherDegree, srEduZone, srRosterType, srMinDoc]
      .forEach(s => CustomSelect.refresh(s));
    if (srGender) CustomSelect.refresh(srGender);

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
    if (srGender) { srGender.value = ''; CustomSelect.refresh(srGender); }
    [srJobTitle, srSpec, srCertificate, srHigherDegree, srEduZone, srRosterType, srMinDoc]
      .forEach(s => { if (s) { s.value = ''; CustomSelect.refresh(s); } });
    _lockStaffPersonalFields(false);
    hide(srRegResult);
  }

  hide(srError);
  show(modalStaffRec);
  if (!rec) modalStaffRec.querySelector('.sheet-body').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function _lockStaffPersonalFields(locked) {
  [srFullName, srNationalId, srMotherName, srDobDay, srDobMonth, srDobYear,
   srGeneralNumber, srGender].forEach(el => {
    if (!el) return;
    el.readOnly = locked;
    el.disabled = locked && el.tagName === 'SELECT';
    el.classList.toggle('field-locked', locked);
  });
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

// ── Registry lookup: staff (الرقم الذاتي) ────────────────────────────────────
btnSrRegLookup?.addEventListener('click', async () => {
  const selfNum = srSelfNumber?.value.trim();
  if (!selfNum) {
    _showRegResult(srRegResult, 'أدخل الرقم الذاتي أولاً.', 'error'); return;
  }
  btnSrRegLookup.disabled = true;
  _showRegResult(srRegResult, 'جارٍ البحث…', 'info');
  try {
    const res = await NDB.lookupNationalStaff(selfNum);
    if (!res.ok || !res.data) {
      _showRegResult(srRegResult, 'لم يُعثر على سجل بهذا الرقم الذاتي.', 'error');
      _srRegistryData = null; _lockStaffPersonalFields(false); return;
    }
    const d = res.data;
    _srRegistryData = d;
    srFullName.value      = d.full_name      || '';
    srNationalId.value    = d.national_id    || '';
    srMotherName.value    = d.mother_name    || '';
    srGeneralNumber.value = d.general_number || '';
    if (srGender) { srGender.value = d.gender || ''; CustomSelect.refresh(srGender); }
    if (d.birth_date) {
      const [y, m, dd] = d.birth_date.split('-');
      if (srDobYear)  srDobYear.value  = y;
      if (srDobMonth) srDobMonth.value = String(Number(m));
      if (srDobDay)   srDobDay.value   = String(Number(dd));
    }
    _lockStaffPersonalFields(true);
    _showRegResult(srRegResult, `تمّ العثور على السجل: ${escapeHtml(d.full_name)}`, 'success');
  } catch (err) {
    _showRegResult(srRegResult, `تعذّر البحث: ${err.message}`, 'error');
    _srRegistryData = null; _lockStaffPersonalFields(false);
  } finally {
    btnSrRegLookup.disabled = false;
  }
});

btnSaveStaffRec?.addEventListener('click', async () => {
  const fullName = srFullName?.value.trim();
  if (!fullName) { if (srError) { srError.textContent = 'الاسم الثلاثي مطلوب'; show(srError); } return; }
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
    gender:           srGender?.value || null,
    self_number:      srSelfNumber?.value.trim() || null,
    general_number:   srGeneralNumber?.value.trim() || null,
    job_title:        jt,
    specialization:   srSpec?.value || null,
    subject_taught:   _regSegment === 'teaching' ? (srSubject?.value.trim() || null) : null,
    certificate:      srCertificate?.value || null,
    higher_degree:    srHigherDegree?.value || null,
    seniority_years:  srSeniority?.value ? parseFloat(srSeniority.value) : null,
    start_date:       (srStartYear?.value && srStartMonth?.value && srStartDay?.value)
                        ? `${String(srStartYear.value).padStart(4,'0')}-${String(srStartMonth.value).padStart(2,'0')}-${String(srStartDay.value).padStart(2,'0')}`
                        : null,
    phone:            srPhone?.value.trim() || null,
    residential_zone: srResZone?.value.trim() || null,
    educational_zone: srEduZone?.value || null,
    roster_type:      srRosterType?.value || 'inside',
    ministerial_doc:  srMinDoc?.value || null,
    notes:            srNotes?.value.trim() || null,
  };

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
    // If a registry lookup was done in this session, establish the formal link.
    if (_srRegistryData && savedId) {
      try {
        await NDB.linkStaffToRegistry(savedId, _srRegistryData.self_number);
      } catch (linkErr) {
        console.warn('[NSAMS] linkStaffToRegistry (non-fatal)', linkErr);
      }
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
CustomSelect.enhance('sr-gender');
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
    if (!confirm('إنهاء هذا التكليف؟ سيُزال جسر الصلاحية المُزامَن إن وُجد.')) return;
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

// Month labels matching template format
const MONTH_LABELS = [
  '', '1 / يناير / كانون الثاني', '2 / فبراير / شباط', '3 / مارس / آذار',
  '4 / أبريل / نيسان', '5 / مايو / أيار', '6 / يونيو / حزيران',
  '7 / يوليو / تموز', '8 / أغسطس / آب', '9 / سبتمبر / أيلول',
  '10 / أكتوبر / تشرين الأول', '11 / نوفمبر / تشرين الثاني', '12 / ديسمبر / كانون الأول',
];

// Admin role order matching template rows M20..M37
const ADMIN_ROLE_ORDER = [
  'مدير','معاون مدير','توجيه','أمانة سر','معاون أمين سر',
  'أمانة مكتبة','معاون أمين مكتبة','امين مخبر','مساعد امين مخبر',
  'امين سر حاسوب','م.امين سر حاسوب','ارشاد اجتماعي','ارشاد نفسي',
  'أمين مشغل','انشطة لاصفية','كاتب','مشرف جاهزية','مجموع الإداريين',
];

// Grade key → DB grade value(s) mapping
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

// Flatten to a reverse map: dbGrade → gradeKey
const DB_GRADE_TO_KEY = {};
for (const [key, vals] of Object.entries(GRADE_KEY_MAP)) {
  for (const v of vals) DB_GRADE_TO_KEY[String(v)] = key;
}

function _stmtMetaKey() { return `nsams_stmt_meta_${S.school?.id || 'x'}`; }

function _stmtSaveMeta() {
  const meta = {
    eduZone:   el('stmt-edu-zone')?.value || '',
    village:   el('stmt-village')?.value || '',
    address:   el('stmt-address')?.value || '',
    phone:     el('stmt-phone')?.value || '',
    sharedWith:el('stmt-shared-with')?.value || '',
    bFloors:   el('stmt-b-floors')?.value || '',
    bOwnership:el('stmt-b-ownership')?.value || '',
    bClassRooms:el('stmt-b-class-rooms')?.value || '',
    bAdminRooms:el('stmt-b-admin-rooms')?.value || '',
    bUnused:   el('stmt-b-unused')?.value || '',
    bBasement: el('stmt-b-basement')?.value || '',
    bLab:      el('stmt-b-lab')?.value || '',
    bComputer: el('stmt-b-computer')?.value || '',
    bLibrary:  el('stmt-b-library')?.value || '',
    bSecretary:el('stmt-b-secretary')?.value || '',
    bGym:      el('stmt-b-gym')?.value || '',
    bStorage:  el('stmt-b-storage')?.value || '',
    bGuidance: el('stmt-b-guidance')?.value || '',
    bHealth:   el('stmt-b-health')?.value || '',
    bWorkshop: el('stmt-b-workshop')?.value || '',
    bTheater:  el('stmt-b-theater')?.value || '',
    bYard:     el('stmt-b-yard')?.value || '',
    bOther:    el('stmt-b-other')?.value || '',
  };
  localStorage.setItem(_stmtMetaKey(), JSON.stringify(meta));
  return meta;
}

function _stmtLoadMeta() {
  try {
    const raw = localStorage.getItem(_stmtMetaKey());
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function _stmtRestoreMeta(meta) {
  const set = (id, val) => { const e = el(id); if (e && val !== undefined) e.value = val; };
  set('stmt-edu-zone',     meta.eduZone);
  set('stmt-village',      meta.village);
  set('stmt-address',      meta.address);
  set('stmt-phone',        meta.phone);
  set('stmt-shared-with',  meta.sharedWith);
  set('stmt-b-floors',     meta.bFloors);
  set('stmt-b-ownership',  meta.bOwnership);
  set('stmt-b-class-rooms',meta.bClassRooms);
  set('stmt-b-admin-rooms',meta.bAdminRooms);
  set('stmt-b-unused',     meta.bUnused);
  set('stmt-b-basement',   meta.bBasement);
  set('stmt-b-lab',        meta.bLab);
  set('stmt-b-computer',   meta.bComputer);
  set('stmt-b-library',    meta.bLibrary);
  set('stmt-b-secretary',  meta.bSecretary);
  set('stmt-b-gym',        meta.bGym);
  set('stmt-b-storage',    meta.bStorage);
  set('stmt-b-guidance',   meta.bGuidance);
  set('stmt-b-health',     meta.bHealth);
  set('stmt-b-workshop',   meta.bWorkshop);
  set('stmt-b-theater',    meta.bTheater);
  set('stmt-b-yard',       meta.bYard);
  set('stmt-b-other',      meta.bOther);
  if (meta.eduZone) CustomSelect.refresh(el('stmt-edu-zone'));
  if (meta.bOwnership) CustomSelect.refresh(el('stmt-b-ownership'));
}

async function initStatementTab() {
  _statementLoaded = true;
  // Set default year to current
  const yearIn = el('stmt-year-in');
  if (yearIn && !yearIn.value) yearIn.value = new Date().getFullYear();
  // Restore saved meta
  _stmtRestoreMeta(_stmtLoadMeta());
  // Populate educational zone lookup
  const zoneEl = el('stmt-edu-zone');
  if (zoneEl) {
    try {
      const zones = await getLookup('educational_zone');
      const cur = zoneEl.value;
      zoneEl.innerHTML = '<option value="">— اختر —</option>' +
        zones.map(z => `<option value="${escapeHtml(z)}"${z===cur?' selected':''}>${escapeHtml(z)}</option>`).join('');
      CustomSelect.refresh(zoneEl);
    } catch { /* non-fatal */ }
  }
  el('btn-gen-statement')?.addEventListener('click', generateStatementPreview);
  el('btn-print-statement')?.addEventListener('click', printStatement);
  el('btn-export-excel')?.addEventListener('click', exportStatementExcel);
  el('btn-submit-statement')?.addEventListener('click', submitStatement);
}

// Render submission status banner + toggle submit button enabled/disabled
function _renderStatementStatus(st) {
  const banner = el('stmt-status-banner');
  const btn    = el('btn-submit-statement');
  const status = st?.status || 'none';
  const map = {
    none:      { cls: 'stmt-status--draft',     txt: 'لم يُرسَل بعد — يمكنك الإرسال للمديرية.' },
    draft:     { cls: 'stmt-status--draft',     txt: 'مسودة محفوظة — لم تُرسَل بعد.' },
    submitted: { cls: 'stmt-status--submitted', txt: 'مُرسَل للمديرية — بانتظار المراجعة.' },
    approved:  { cls: 'stmt-status--approved',  txt: 'معتمد من المديرية ✓' },
    rejected:  { cls: 'stmt-status--rejected',  txt: 'رُفض من المديرية' + (st?.notes ? ' — ' + st.notes : '') },
  };
  const m = map[status] || map.none;
  if (banner) {
    banner.className = 'stmt-status-banner ' + m.cls;
    banner.textContent = m.txt;
    banner.hidden = false;
  }
  if (btn) {
    const locked = (status === 'submitted' || status === 'approved');
    btn.disabled = locked;
    const lbl = el('btn-submit-label');
    if (lbl) lbl.textContent = status === 'rejected' ? 'إعادة الإرسال للمديرية' : 'إرسال للمديرية';
  }
}

// Collect a JSONB snapshot from the current (possibly hand-edited) preview
function _collectStatementSnapshot(d) {
  const students = [];
  const stuBody = el('stmt-students-body');
  if (stuBody) {
    for (const row of stuBody.querySelectorAll('tr[data-grade-key]')) {
      const cells = row.querySelectorAll('.stmt-num');
      const n = i => parseInt(cells[i]?.textContent || '0', 10) || 0;
      students.push({
        key: row.dataset.gradeKey,
        sections: n(0), enM: n(1), enF: n(2),
        frM: n(3), frF: n(4), ruM: n(5), ruF: n(6),
      });
    }
  }
  return {
    month: d.month, year: d.year,
    schoolName: d.school.name || '',
    statisticalNumber: d.school.statistical_number || '',
    cycle: d.school.cycle || '',
    students,
    adminByRole: d.adminByRole,
    staffCounts: d.staffCounts,
    leaveLines: d.leaveLines,
    generatedAt: new Date().toISOString(),
  };
}

async function submitStatement() {
  const btn     = el('btn-submit-statement');
  const label   = el('btn-submit-label');
  const spinner = el('stmt-submit-spinner');
  const errEl   = el('stmt-preview-error');
  if (!confirm('إرسال البيان للمديرية؟ لن يمكن تعديله حتى تُراجعه المديرية.')) return;
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'جارٍ الإرسال...';
  if (spinner) spinner.hidden = false;
  hide(errEl);
  try {
    const d = await buildStatementData();
    const snapshot = _collectStatementSnapshot(d);
    await NDB.submitMonthlyStatement(d.school.id, d.month, d.year, snapshot);
    toast('أُرسل البيان للمديرية ✓', 'success');
    const st = await NDB.getMonthlyStatement(d.school.id, d.month, d.year);
    if (spinner) spinner.hidden = true;
    if (label) label.textContent = 'إرسال للمديرية';
    _renderStatementStatus(st);   // locks the button (status now 'submitted')
  } catch (err) {
    console.error('[Statement] submit', err);
    if (errEl) { errEl.textContent = 'تعذّر إرسال البيان — ' + (err?.message || err); show(errEl); }
    if (spinner) spinner.hidden = true;
    if (label) label.textContent = 'إرسال للمديرية';
    if (btn) btn.disabled = false;  // failed → allow retry
  }
}

async function buildStatementData() {
  const month  = parseInt(el('stmt-month-sel')?.value || '1', 10);
  const year   = parseInt(el('stmt-year-in')?.value || new Date().getFullYear(), 10);
  const meta   = _stmtSaveMeta();
  const school = S.school;

  const [stuStats, staffRecs, staffLeaves] = await Promise.all([
    NDB.getSchoolStudentStats(school.id),
    NDB.getStaffRecords(school.id),
    NDB.getStaffLeaves(school.id, month, year),
  ]);

  // Build admin role counts
  const adminByRole = {};
  for (const r of (staffRecs || [])) {
    if (r.staff_type !== 'admin') continue;
    const role = r.job_title || 'غير محدد';
    adminByRole[role] = (adminByRole[role] || 0) + 1;
  }

  // Staff type counts
  const staffCounts = { admin: 0, teaching: 0, professional: 0, worker: 0, guard: 0 };
  for (const r of (staffRecs || [])) {
    if (r.staff_type === 'admin') staffCounts.admin++;
    else if (r.staff_type === 'teaching') staffCounts.teaching++;
    else if (r.staff_type === 'support') {
      const jt = r.job_title || '';
      if (jt === 'مستخدم') staffCounts.worker++;
      else if (jt === 'حارس') staffCounts.guard++;
      else staffCounts.professional++;
    }
  }

  // Teaching counts by specialization category
  const teachBySpec = {};
  for (const r of (staffRecs || [])) {
    if (r.staff_type !== 'teaching') continue;
    const sp = r.specialization || 'غير محدد';
    teachBySpec[sp] = (teachBySpec[sp] || 0) + 1;
  }

  // Leaves: merge by staff_id
  const leavesMap = {};
  for (const lv of (staffLeaves || [])) {
    if (!leavesMap[lv.staff_id]) leavesMap[lv.staff_id] = [];
    leavesMap[lv.staff_id].push(`${lv.leave_type} ${lv.days}`);
  }
  // Enrich with staff name
  const staffById = {};
  for (const r of (staffRecs || [])) staffById[r.id] = r;
  const leaveLines = Object.entries(leavesMap).map(([sid, parts]) => {
    const name = staffById[sid]?.full_name || '—';
    return `${name}: ${parts.join(' + ')}`;
  });

  return { month, year, meta, school, stuStats, staffRecs,
           adminByRole, staffCounts, teachBySpec, leaveLines };
}

async function generateStatementPreview() {
  const genBtn  = el('btn-gen-statement');
  const spinner = el('stmt-gen-spinner');
  const errEl   = el('stmt-gen-error');
  if (genBtn) genBtn.disabled = true;
  if (spinner) spinner.hidden = false;
  hide(errEl);

  try {
    const d = await buildStatementData();

    // Header summary
    const headerEl = el('stmt-header-summary');
    if (headerEl) {
      headerEl.innerHTML = `
        <span><strong>المدرسة:</strong> ${escapeHtml(d.school.name || '—')}</span>
        <span><strong>الشهر:</strong> ${escapeHtml(MONTH_LABELS[d.month] || d.month)}</span>
        <span><strong>العام:</strong> ${d.year}</span>
        <span><strong>الحلقة:</strong> ${escapeHtml(d.school.cycle || d.meta.eduZone || '—')}</span>
        ${d.school.statistical_number ? `<span><strong>الرقم الإحصائي:</strong> ${escapeHtml(d.school.statistical_number)}</span>` : ''}
      `;
    }

    // Student table
    const allKeys = Object.keys(GRADE_KEY_MAP);
    const claimed = new Set();
    for (const key of allKeys) {
      const row = el('stmt-students-body')?.querySelector(`[data-grade-key="${key}"]`);
      if (!row) continue;
      const cells = row.querySelectorAll('.stmt-num');
      let sections = 0, male = 0, female = 0;
      for (const dbGrade of GRADE_KEY_MAP[key]) {
        const s = d.stuStats[dbGrade];
        if (s) { sections += s.sections; male += s.male; female += s.female; claimed.add(dbGrade); }
      }
      if (cells[0]) cells[0].textContent = sections;
      if (cells[1]) cells[1].textContent = male;
      if (cells[2]) cells[2].textContent = female;
      // cols 3-6 (French/Russian) left for manual edit, zero them only on first generate
      if (cells[3] && cells[3].textContent === '0') cells[3].textContent = '0';
    }

    // Unclassified grades
    let uncSec = 0, uncM = 0, uncF = 0;
    for (const [grade, s] of Object.entries(d.stuStats)) {
      if (!claimed.has(grade)) { uncSec += s.sections; uncM += s.male; uncF += s.female; }
    }
    const uncRow = el('stmt-unclassified-row');
    if (uncRow) {
      uncRow.hidden = (uncSec === 0);
      const secEl = el('stmt-unclassified-sections');
      const mEl   = el('stmt-unclassified-male');
      const fEl   = el('stmt-unclassified-female');
      if (secEl) secEl.textContent = uncSec;
      if (mEl)   mEl.textContent   = uncM;
      if (fEl)   fEl.textContent   = uncF;
    }

    // Update totals
    _updateStudentTotals();

    // Admin staff table
    const adminBody = el('stmt-admin-body');
    if (adminBody) {
      adminBody.innerHTML = ADMIN_ROLE_ORDER.map(role => {
        const cnt = role === 'مجموع الإداريين'
          ? d.staffCounts.admin
          : (d.adminByRole[role] || 0);
        return `<tr><td>${escapeHtml(role)}</td><td class="stmt-num">${cnt}</td></tr>`;
      }).join('');
    }

    // Staff totals
    const totalsEl = el('stmt-staff-totals');
    if (totalsEl) {
      const total = d.staffCounts.admin + d.staffCounts.teaching +
                    d.staffCounts.professional + d.staffCounts.worker + d.staffCounts.guard;
      totalsEl.innerHTML = `
        <strong>إجمالي العاملين: ${total}</strong> &nbsp;|&nbsp;
        إداري: ${d.staffCounts.admin} &nbsp;|&nbsp;
        تدريسي: ${d.staffCounts.teaching} &nbsp;|&nbsp;
        مهني: ${d.staffCounts.professional} &nbsp;|&nbsp;
        مستخدم: ${d.staffCounts.worker} &nbsp;|&nbsp;
        حارس: ${d.staffCounts.guard}
        ${d.leaveLines.length ? '<br><small style="color:#475569">إجازات الشهر: ' + d.leaveLines.map(l => escapeHtml(l)).join(' — ') + '</small>' : ''}
      `;
    }

    // Show preview
    const previewCard = el('stmt-preview-card');
    if (previewCard) previewCard.hidden = false;
    const titleEl = el('stmt-preview-title');
    if (titleEl) titleEl.textContent = `${MONTH_LABELS[d.month]} / ${d.year}`;

    // Reflect existing submission status (if any) on the banner + submit button
    try {
      const st = await NDB.getMonthlyStatement(d.school.id, d.month, d.year);
      _renderStatementStatus(st);
    } catch (e) {
      console.warn('[Statement] status fetch', e);
      _renderStatementStatus(null);
    }

    previewCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error('[Statement] generate', err);
    if (errEl) { errEl.textContent = 'تعذّر توليد البيان — ' + (err?.message || err); show(errEl); }
  } finally {
    if (genBtn) genBtn.disabled = false;
    if (spinner) spinner.hidden = true;
  }
}

function _updateStudentTotals() {
  const tbody = el('stmt-students-body');
  if (!tbody) return;
  let totSec = 0, totM = 0, totF = 0;
  for (const row of tbody.querySelectorAll('tr[data-grade-key]:not([hidden])')) {
    const cells = row.querySelectorAll('.stmt-num');
    totSec += parseInt(cells[0]?.textContent || '0', 10) || 0;
    totM   += parseInt(cells[1]?.textContent || '0', 10) || 0;
    totF   += parseInt(cells[2]?.textContent || '0', 10) || 0;
  }
  const st = el('stmt-total-sections'); if (st) st.textContent = totSec;
  const tm = el('stmt-total-male');     if (tm) tm.textContent = totM;
  const tf = el('stmt-total-female');   if (tf) tf.textContent = totF;
}

// ── ExcelJS lazy loader ───────────────────────────────────────────────────────
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

async function exportStatementExcel() {
  const btn     = el('btn-export-excel');
  const label   = el('btn-export-label');
  const spinner = el('stmt-export-spinner');
  const errEl   = el('stmt-preview-error');
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'جارٍ التصدير...';
  if (spinner) spinner.hidden = false;
  hide(errEl);

  try {
    await loadExcelJS();
    const d = await buildStatementData();

    const resp = await fetch('../shared/statement_template.xlsx');
    if (!resp.ok) throw new Error(`تعذّر تحميل القالب (${resp.status})`);
    const buffer = await resp.arrayBuffer();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    const wsBayan = wb.getWorksheet('البيان');
    if (!wsBayan) throw new Error('ورقة البيان غير موجودة في القالب');

    // ── الترويسة ──────────────────────────────────────────────────────────────
    _setCell(wsBayan, 'E3', MONTH_LABELS[d.month] || String(d.month));
    _setCell(wsBayan, 'K3', d.year);
    _setCell(wsBayan, 'C7', d.meta.eduZone);
    _setCell(wsBayan, 'E7', d.meta.village);
    _setCell(wsBayan, 'G7', d.meta.address);
    _setCell(wsBayan, 'J7', d.school.cycle || '');
    _setCell(wsBayan, 'K7', d.school.name || '');
    _setCell(wsBayan, 'O7', d.meta.phone);
    _setCell(wsBayan, 'R7', d.school.statistical_number || '');
    _setCell(wsBayan, 'T7', d.school.rural_curriculum ? 'نعم' : 'لا');
    _setCell(wsBayan, 'Y7', d.school.shift === 'full' ? 'كامل' : d.school.shift === 'half' ? 'نصفي' : (d.school.shift || ''));
    _setCell(wsBayan, 'W8', d.meta.sharedWith);

    // ── البناء ───────────────────────────────────────────────────────────────
    const bCols = ['C','E','H','K','M','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA'];
    const bVals = [
      d.meta.bFloors, d.meta.bOwnership, d.meta.bClassRooms, d.meta.bAdminRooms,
      d.meta.bUnused, d.meta.bBasement, d.meta.bLab, d.meta.bComputer,
      d.meta.bLibrary, d.meta.bSecretary, d.meta.bGym, d.meta.bStorage,
      d.meta.bGuidance, d.meta.bHealth, d.meta.bWorkshop, d.meta.bTheater,
      d.meta.bYard, d.meta.bOther,
    ];
    bCols.forEach((col, i) => {
      const v = bVals[i];
      _setCell(wsBayan, `${col}11`, v === '' ? null : (isNaN(Number(v)) ? v : Number(v)));
    });

    // ── أعداد الطلاب (تُقرأ من المعاينة المحررة) ────────────────────────────
    const gradeKeys = Object.keys(GRADE_KEY_MAP);
    // Template row offsets: استعدوا=22, 1..9=23..31, م1..م4=32..35, ث1أ..ث3ع=36..41
    const keyToTemplateRow = {};
    gradeKeys.forEach((key, idx) => { keyToTemplateRow[key] = 22 + idx; });

    const stuBody = el('stmt-students-body');
    if (stuBody) {
      for (const row of stuBody.querySelectorAll('tr[data-grade-key]')) {
        const key = row.dataset.gradeKey;
        const tRow = keyToTemplateRow[key];
        if (!tRow) continue;
        const cells = row.querySelectorAll('.stmt-num');
        const sec = parseInt(cells[0]?.textContent || '0', 10) || 0;
        const enM = parseInt(cells[1]?.textContent || '0', 10) || 0;
        const enF = parseInt(cells[2]?.textContent || '0', 10) || 0;
        const frM = parseInt(cells[3]?.textContent || '0', 10) || 0;
        const frF = parseInt(cells[4]?.textContent || '0', 10) || 0;
        const ruM = parseInt(cells[5]?.textContent || '0', 10) || 0;
        const ruF = parseInt(cells[6]?.textContent || '0', 10) || 0;
        _setCell(wsBayan, `D${tRow}`, sec);
        _setCell(wsBayan, `E${tRow}`, enM);
        _setCell(wsBayan, `F${tRow}`, enF);
        _setCell(wsBayan, `G${tRow}`, frM);
        _setCell(wsBayan, `H${tRow}`, frF);
        _setCell(wsBayan, `I${tRow}`, ruM);
        _setCell(wsBayan, `J${tRow}`, ruF);
      }
    }

    // ── الجهاز الإداري — أعداد حسب الوظيفة ───────────────────────────────────
    const roleRows = ADMIN_ROLE_ORDER.slice(0, -1); // exclude مجموع الإداريين row
    roleRows.forEach((role, idx) => {
      const tRow = 20 + idx;
      const cnt = role === 'مجموع الإداريين' ? d.staffCounts.admin : (d.adminByRole[role] || 0);
      _setCell(wsBayan, `O${tRow}`, cnt);
      _setCell(wsBayan, `P${tRow}`, arNumWord(cnt));
    });
    // مجموع الإداريين (row 38)
    _setCell(wsBayan, `O38`, d.staffCounts.admin);
    _setCell(wsBayan, `P38`, arNumWord(d.staffCounts.admin));

    // ── ملخص المهنيين / مستخدمين / حراس ─────────────────────────────────────
    _setCell(wsBayan, 'AA19', d.staffCounts.professional);
    _setCell(wsBayan, 'AA20', d.staffCounts.worker);
    _setCell(wsBayan, 'AA21', d.staffCounts.guard);
    const grandTotal = d.staffCounts.admin + d.staffCounts.teaching +
                       d.staffCounts.professional + d.staffCounts.worker + d.staffCounts.guard;
    _setCell(wsBayan, 'AA23', grandTotal);

    // ── أوراق الكوادر — الجهاز الإداري ───────────────────────────────────────
    const wsAdmin = wb.getWorksheet('الجهاز الإداري');
    if (wsAdmin) {
      const adminRecs = (d.staffRecs || []).filter(r => r.staff_type === 'admin');
      adminRecs.forEach((r, i) => {
        const row = 4 + i;
        _setCell(wsAdmin, `B${row}`, r.national_id || '');
        _setCell(wsAdmin, `C${row}`, r.full_name || '');
        _setCell(wsAdmin, `D${row}`, r.mother_name || '');
        if (r.birth_date) {
          const bd = new Date(r.birth_date);
          _setCell(wsAdmin, `E${row}`, bd.getDate());
          _setCell(wsAdmin, `F${row}`, bd.getMonth() + 1);
          _setCell(wsAdmin, `G${row}`, bd.getFullYear());
        }
        _setCell(wsAdmin, `H${row}`, r.certificate || '');
        _setCell(wsAdmin, `I${row}`, r.specialization || '');
        _setCell(wsAdmin, `J${row}`, r.seniority_year || '');
        _setCell(wsAdmin, `K${row}`, r.job_title || '');
        _setCell(wsAdmin, `L${row}`, r.higher_degree || '');
        if (r.start_date) {
          const sd = new Date(r.start_date);
          _setCell(wsAdmin, `M${row}`, sd.getDate());
          _setCell(wsAdmin, `N${row}`, sd.getMonth() + 1);
          _setCell(wsAdmin, `O${row}`, sd.getFullYear());
        }
        _setCell(wsAdmin, `P${row}`, r.phone || '');
        _setCell(wsAdmin, `R${row}`, r.residential_zone || '');
        // إجازات
        const lvParts = (d.leaveLines.find(l => l.startsWith(r.full_name + ':')) || '').split(':')[1] || '';
        _setCell(wsAdmin, `S${row}`, lvParts.trim());
        _setCell(wsAdmin, `T${row}`, r.ministerial_doc || '');
        _setCell(wsAdmin, `U${row}`, r.notes || '');
      });
    }

    // ── أوراق الكوادر — الجهاز التدريسي ──────────────────────────────────────
    const wsTeach = wb.getWorksheet('الجهاز التدريسي');
    if (wsTeach) {
      const teachRecs = (d.staffRecs || []).filter(r => r.staff_type === 'teaching');
      teachRecs.forEach((r, i) => {
        const row = 4 + i;
        _setCell(wsTeach, `B${row}`, r.national_id || '');
        _setCell(wsTeach, `C${row}`, r.full_name || '');
        _setCell(wsTeach, `D${row}`, r.mother_name || '');
        if (r.birth_date) {
          const bd = new Date(r.birth_date);
          _setCell(wsTeach, `E${row}`, bd.getDate());
          _setCell(wsTeach, `F${row}`, bd.getMonth() + 1);
          _setCell(wsTeach, `G${row}`, bd.getFullYear());
        }
        _setCell(wsTeach, `H${row}`, r.certificate || '');
        _setCell(wsTeach, `I${row}`, r.specialization || '');
        _setCell(wsTeach, `J${row}`, r.seniority_year || '');
        _setCell(wsTeach, `K${row}`, r.subject_taught || '');
        if (r.start_date) {
          const sd = new Date(r.start_date);
          _setCell(wsTeach, `Q${row}`, sd.getDate());
          _setCell(wsTeach, `R${row}`, sd.getMonth() + 1);
          _setCell(wsTeach, `S${row}`, sd.getFullYear());
        }
        _setCell(wsTeach, `T${row}`, r.phone || '');
        _setCell(wsTeach, `V${row}`, r.residential_zone || '');
        const lvParts = (d.leaveLines.find(l => l.startsWith(r.full_name + ':')) || '').split(':')[1] || '';
        _setCell(wsTeach, `W${row}`, lvParts.trim());
        _setCell(wsTeach, `X${row}`, r.ministerial_doc || '');
        _setCell(wsTeach, `Y${row}`, r.notes || '');
      });
    }

    // ── أوراق الكوادر — مهنيون ومستخدمون وحراس ───────────────────────────────
    const wsSupport = wb.getWorksheet('مهنيين ومستخدمين وحراس');
    if (wsSupport) {
      const suppRecs = (d.staffRecs || []).filter(r => r.staff_type === 'support');
      suppRecs.forEach((r, i) => {
        const row = 4 + i;
        _setCell(wsSupport, `B${row}`, r.national_id || '');
        _setCell(wsSupport, `C${row}`, r.full_name || '');
        _setCell(wsSupport, `D${row}`, r.mother_name || '');
        if (r.birth_date) {
          const bd = new Date(r.birth_date);
          _setCell(wsSupport, `E${row}`, bd.getDate());
          _setCell(wsSupport, `F${row}`, bd.getMonth() + 1);
          _setCell(wsSupport, `G${row}`, bd.getFullYear());
        }
        _setCell(wsSupport, `H${row}`, r.certificate || '');
        _setCell(wsSupport, `I${row}`, r.seniority_year || '');
        _setCell(wsSupport, `J${row}`, r.job_title || '');
        if (r.start_date) {
          const sd = new Date(r.start_date);
          _setCell(wsSupport, `K${row}`, sd.getDate());
          _setCell(wsSupport, `L${row}`, sd.getMonth() + 1);
          _setCell(wsSupport, `M${row}`, sd.getFullYear());
        }
        _setCell(wsSupport, `N${row}`, r.phone || '');
        _setCell(wsSupport, `P${row}`, r.residential_zone || '');
        const lvParts = (d.leaveLines.find(l => l.startsWith(r.full_name + ':')) || '').split(':')[1] || '';
        _setCell(wsSupport, `Q${row}`, lvParts.trim());
        _setCell(wsSupport, `R${row}`, r.ministerial_doc || '');
        _setCell(wsSupport, `S${row}`, r.notes || '');
      });
    }

    // ── تنزيل الملف ──────────────────────────────────────────────────────────
    const outBuf = await wb.xlsx.writeBuffer();
    const blob = new Blob([outBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const safeName = (d.school.name || 'المدرسة').replace(/[/\\?%*:|"<>]/g, '-');
    a.href = url;
    a.download = `بيان_${safeName}_${MONTH_LABELS[d.month]}_${d.year}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[Statement] exportExcel', err);
    if (errEl) { errEl.textContent = 'تعذّر تصدير Excel — ' + (err?.message || err); show(errEl); }
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = 'تصدير Excel';
    if (spinner) spinner.hidden = true;
  }
}

function printStatement() {
  const d_school = S.school;
  const month  = parseInt(el('stmt-month-sel')?.value || '1', 10);
  const year   = parseInt(el('stmt-year-in')?.value || new Date().getFullYear(), 10);

  // Collect current preview data
  const stuRows = [];
  el('stmt-students-body')?.querySelectorAll('tr[data-grade-key]:not([hidden])').forEach(row => {
    const label = row.querySelector('td:first-child')?.textContent || '';
    const cells = row.querySelectorAll('.stmt-num');
    const vals  = [...cells].map(c => c.textContent || '0');
    stuRows.push({ label, vals });
  });

  const adminRows = [];
  el('stmt-admin-body')?.querySelectorAll('tr').forEach(row => {
    const tds = row.querySelectorAll('td');
    adminRows.push({ role: tds[0]?.textContent || '', cnt: tds[1]?.textContent || '0' });
  });

  const totals = el('stmt-staff-totals')?.textContent || '';

  const win = window.open('', '_blank', 'width=1000,height=700');
  if (!win) { toast('يرجى السماح بالنوافذ المنبثقة', 'error'); return; }

  const stuTableHtml = `
    <table>
      <thead>
        <tr>
          <th rowspan="2">الصف</th><th rowspan="2">عدد الشعب</th>
          <th colspan="2">انكليزي</th><th colspan="2">فرنسي</th><th colspan="2">روسي</th>
        </tr>
        <tr><th>ذكور</th><th>إناث</th><th>ذكور</th><th>إناث</th><th>ذكور</th><th>إناث</th></tr>
      </thead>
      <tbody>
        ${stuRows.map(r => `<tr><td>${r.label}</td>${r.vals.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `;

  const adminHtml = `
    <table>
      <thead><tr><th>المنصب</th><th>العدد</th></tr></thead>
      <tbody>${adminRows.map(r=>`<tr><td>${r.role}</td><td>${r.cnt}</td></tr>`).join('')}</tbody>
    </table>
  `;

  win.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>البيان الشهري — ${escapeHtml(d_school?.name || '')} — ${MONTH_LABELS[month]} ${year}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap');
  @page { size:A4 landscape; margin:10mm; }
  body { font-family:'Cairo',sans-serif; font-size:9pt; direction:rtl; }
  h1 { font-size:12pt; margin:0 0 4px; }
  h2 { font-size:10pt; margin:8px 0 4px; }
  table { border-collapse:collapse; width:100%; margin-bottom:8px; }
  th, td { border:1px solid #555; padding:3px 5px; text-align:center; }
  th { background:#e2e8f0; font-weight:700; }
  .page-break { page-break-after: always; }
  .header-meta { font-size:8pt; color:#333; margin-bottom:6px; }
</style>
</head>
<body>
<h1>البيان الشهري — ${escapeHtml(d_school?.name || '')} — ${MONTH_LABELS[month]} ${year}</h1>
<div class="header-meta">
  الحلقة: ${escapeHtml(d_school?.cycle||'—')} | الرقم الإحصائي: ${escapeHtml(d_school?.statistical_number||'—')} | نوع الدوام: ${escapeHtml(d_school?.shift||'—')}
</div>
<h2>أعداد الطلاب</h2>
${stuTableHtml}
<h2>الجهاز الإداري</h2>
${adminHtml}
<p style="font-size:8pt">${escapeHtml(totals)}</p>
</body></html>`);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 600);
}

CustomSelect.enhance('stmt-month-sel');
CustomSelect.enhance('stmt-edu-zone');
CustomSelect.enhance('stmt-b-ownership');

// ── Start the app (after all declarations are initialized) ──
bootstrap();