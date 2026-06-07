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
    id:            row.id,
    name:          row.name,
    totalTeachers: row.total_teachers ?? 0,
    totalStudents: row.total_students ?? 0,
    // 'primary' (ابتدائي) | 'middle_high' (إعدادي/ثانوي). Drives معلم↔موجه labels.
    // Falls back to 'primary' if the column is missing (e.g. migration not run yet).
    type:          row.school_type ?? 'primary',
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
  const total   = S.school?.totalTeachers ?? 0;
  const absent  = S.absentTeachers.length;
  const present = Math.max(0, total - absent);

  const prevAbsent  = tAbsent.textContent;
  const prevPresent = tPresent.textContent;

  tTotal.textContent   = total;
  tAbsent.textContent  = absent;
  tPresent.textContent = present;

  if (String(absent)  !== prevAbsent)  animateBump(tAbsent);
  if (String(present) !== prevPresent) animateBump(tPresent);
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
  _manageLoaded   = false;
  _subjectsLoaded = false;
  _reportsLoaded  = false;

  // Kick off sync of any offline-queued records
  await doSync();

  // Load teacher submissions now that S.school is populated.
  // (Previously triggered by a fragile MutationObserver that could fire before
  //  school data was ready; called directly here instead.)
  await loadClassSummaries();
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
    'h1{font-size:19px;margin:0 0 2px;color:#0B2B5E}' +
    '.sub{color:#475569;font-size:13px;margin:2px 0}' +
    '.sum{margin-top:10px;font-size:13px;font-weight:700;text-align:center}' +
    'table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}' +
    'th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:right}' +
    'th{background:#0B2B5E;color:#fff}' +
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
const tabSubjects     = el('tab-subjects');
const tabReports      = el('tab-reports');
const viewAttendance  = el('view-attendance');
const viewManage      = el('view-manage');
const viewSubjects    = el('view-subjects');
const viewReports     = el('view-reports');
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
  subjects:   { tab: tabSubjects,   view: viewSubjects },
  reports:    { tab: tabReports,    view: viewReports },
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

  if (tab === 'manage'   && !_manageLoaded)  loadManageClasses();
  if (tab === 'subjects' && !_subjectsLoaded) initSubjectsTab();
  if (tab === 'reports'  && !_reportsLoaded)  initReportsTab();
}

tabAttendance.addEventListener('click', () => switchTab('attendance'));
tabManage.addEventListener('click',     () => switchTab('manage'));
tabSubjects.addEventListener('click',   () => switchTab('subjects'));
tabReports.addEventListener('click',    () => switchTab('reports'));

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
// Subjects management (المواد)
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
const subjCompList   = el('subj-comp-list');
const btnAddComp     = el('btn-add-comp');
const subjCompSum    = el('subj-comp-sum');
const subjError      = el('subj-error');
const btnSaveSubject = el('btn-save-subject');
const subjSaveLabel  = el('subj-save-label');
const subjSpinner    = el('subj-spinner');

let _subjectsLoaded   = false;
let _subjGrade        = 1;
let _editingSubjectId = null;

function gradeNameLabel(grade) {
  return (typeof NDB.gradeNameAr === 'function') ? `الصف ${NDB.gradeNameAr(grade)}` : gradeLabel(grade);
}

// Map a Supabase error to a clear Arabic message. 42501 / "permission denied
// for table" means the grades tables haven't been granted to the app role yet.
function gradesErr(err, fallback) {
  if (err?.code === '42501' || /permission denied/i.test(err?.message || '')) {
    return 'لا تملك صلاحية الوصول إلى بيانات الدرجات على قاعدة البيانات (راجع إعداد الصلاحيات).';
  }
  return fallback;
}

function initSubjectsTab() {
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
  _subjectsLoaded = true;
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

function buildSubjectRow(sub) {
  const li = document.createElement('li');
  li.className = 'subj-row';
  const tag = sub.is_core_arabic ? '<span class="subj-tag">عربي</span>' : '';
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
        name, maxTotal, passMark, isCoreArabic: subjArabicIn.checked,
      });
    } else {
      subjectId = await NDB.createSubject({
        schoolId: S.school.id, grade: _subjGrade,
        name, maxTotal, passMark, isCoreArabic: subjArabicIn.checked,
      });
    }
    await NDB.setSubjectComponents(subjectId, comps);
    closeSubjectModal();
    toast('تم حفظ المادة', 'success');
    loadSubjects();
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

let _reportsLoaded = false;
let _repData       = null;

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
    _reportsLoaded = true;
  } catch (err) {
    console.error('[NSAMS] initReportsTab', err);
    toast('تعذّر تحميل قائمة الصفوف', 'error');
  }
}

repClassSelect.addEventListener('change', () => {
  const id = repClassSelect.value;
  if (id) loadReports(id);
  else { repListEl.innerHTML = ''; repEmpty.hidden = true; hide(btnPrintAll); }
});
repTermSelect.addEventListener('change', () => { if (repClassSelect.value) loadReports(repClassSelect.value); });
btnRefreshReports.addEventListener('click', () => { if (repClassSelect.value) loadReports(repClassSelect.value); });

async function loadReports(classId) {
  show(repLoading);
  repListEl.innerHTML = '';
  repEmpty.hidden = true;
  hide(btnPrintAll);
  try {
    _repData = await NDB.getClassReportCards(classId, undefined, currentTerm());
    hide(repLoading);
    const cards = _repData.students || [];
    if (cards.length === 0) { repEmpty.hidden = false; return; }
    cards.forEach((card, i) => repListEl.appendChild(buildReportRow(card, i + 1)));
    show(btnPrintAll);
  } catch (err) {
    console.error('[NSAMS] loadReports', err);
    hide(repLoading);
    toast(gradesErr(err, 'تعذّر تحميل النتائج'), 'error');
  }
}

function resultBadge(card) {
  if (!card.complete) return { cls: 'pending', text: 'غير مكتمل' };
  if (card.result === 'ناجح')  return { cls: 'pass',    text: 'ناجح' };
  if (card.result === 'مكمّل') return { cls: 'partial', text: 'مكمّل' };
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
  li.innerHTML = `
    <div class="rep-row-head">
      <span class="student-num" style="min-width:24px;color:#94A3B8;font-weight:600">${num}</span>
      <div class="rep-info">
        <div class="rep-name">${escapeHtml(card.student.full_name)}</div>
      </div>
    </div>
    <div class="rep-row-controls">
      <span class="rep-pct">${card.finalPercent == null ? '—' : fmtNum(card.finalPercent) + '٪'}</span>
      ${badgeHtml}
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
    const resultColor = b.cls === 'pass' ? '#059669' : (b.cls === 'fail' ? '#DC2626' : (b.cls === 'partial' ? '#B45309' : '#64748B'));
    footer = 'النسبة النهائية: <strong>' + (card.finalPercent == null ? '—' : fmtNum(card.finalPercent) + '٪') + '</strong>' +
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
    'h1{font-size:19px;margin:0 0 2px;color:#0B2B5E}' +
    '.sub{color:#475569;font-size:13px;margin:2px 0}' +
    '.rc-meta{display:flex;justify-content:space-between;font-size:13px;margin:14px 0 8px;gap:12px}' +
    'table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}' +
    'th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:center}' +
    'th{background:#0B2B5E;color:#fff}' +
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

// Enhance the school-admin selects once the DOM is parsed.
CustomSelect.enhance('mng-class-select');
CustomSelect.enhance('mng-role-select');
CustomSelect.enhance('mng-sup-select');
CustomSelect.enhance('mng-teacher-select');
CustomSelect.enhance('r-type');
CustomSelect.enhance('subj-grade-select');
CustomSelect.enhance('rep-class-select');
CustomSelect.enhance('rep-term-select');

// ── Start the app (after all declarations are initialized) ──
bootstrap();