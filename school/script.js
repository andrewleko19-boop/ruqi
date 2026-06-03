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
    manageHint:      'اختر صفاً لعرض موجهيه وإدارة الإسناد. يمكن لعدة موجهين متابعة الصف نفسه.',
    assignedLabel:   'الموجهون المرتبطون بالصف',
    assignedEmpty:   'لا يوجد موجهون مرتبطون بهذا الصف بعد.',
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
  set('assign-new-label',  RW.assignNew);
  set('mng-teacher-label', RW.pickLabel);
  set('assign-btn-label',  RW.assignBtn);
  set('reject-title',      RW.rejectTitle);
  // The assignable-teachers placeholder (mirrors the rebuild in loadAssignableTeachers).
  const ts = el('mng-teacher-select');
  if (ts && ts.options[0]) {
    ts.options[0].textContent = RW.pickPlaceholder;
    if (window.CustomSelect) CustomSelect.refresh(ts);
  }
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

  // Default to the attendance tab on each app entry; manage loads lazily.
  switchTab('attendance');
  _manageLoaded = false;

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

// Ensure reject modal is hidden on page load
hide(modalReject);

// ── State ─────────────────────────────────────────────────────────────────────
let _rejectSubmissionId = null;
let _classBusy          = false;

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
    for (const s of summaries) clasSubList.appendChild(buildClassRow(s));
    show(clasSubList);

    // Auto-populate aggregate student counts from teacher data
    const totalPresent = summaries.reduce((a, s) => a + s.stats.present + s.stats.late, 0);
    const totalAbsent  = summaries.reduce((a, s) => a + s.stats.absent  + s.stats.excused, 0);
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
       <span class="cstat-a">غ${s.stats.absent + s.stats.excused}</span>`
    : `<span style="color:#CBD5E1">—</span>`;

  const actionsHtml = status === 'pending'
    ? `<div class="csub-actions">
         <button class="csub-btn-confirm" data-sid="${sub.id}" data-cname="${escapeHtml(s.displayName)}">تأكيد</button>
         <button class="csub-btn-reject"  data-sid="${sub.id}" data-cname="${escapeHtml(s.displayName)}">إعادة</button>
       </div>`
    : '';

  const div = document.createElement('div');
  div.className = 'csub-row';
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
  if (confirmBtn) await handleConfirm(confirmBtn);
  if (rejectBtn)  openRejectModal(rejectBtn.dataset.sid, rejectBtn.dataset.cname);
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
const viewAttendance  = el('view-attendance');
const viewManage      = el('view-manage');
const fabReport       = el('btn-open-report');

const mngClassSelect    = el('mng-class-select');
const mngAssignedWrap   = el('mng-assigned-wrap');
const mngAssignedLoading= el('mng-assigned-loading');
const mngAssignedList   = el('mng-assigned-list');
const mngAssignedEmpty  = el('mng-assigned-empty');
const mngTeacherSelect  = el('mng-teacher-select');
const mngError          = el('mng-error');
const btnAssignTeacher  = el('btn-assign-teacher');
const assignBtnLabel    = el('assign-btn-label');
const assignSpinner     = el('assign-spinner');
const btnRefreshManage  = el('btn-refresh-manage');

let _manageLoaded = false;   // classes dropdown loaded once per session
let _mngBusy      = false;

function switchTab(tab) {
  const onManage = tab === 'manage';
  viewManage.hidden     = !onManage;
  viewAttendance.hidden = onManage;
  tabManage.classList.toggle('is-active', onManage);
  tabAttendance.classList.toggle('is-active', !onManage);
  tabManage.setAttribute('aria-selected', String(onManage));
  tabAttendance.setAttribute('aria-selected', String(!onManage));
  // The emergency-report FAB belongs to the attendance view only.
  if (fabReport) fabReport.hidden = onManage;

  if (onManage && !_manageLoaded) loadManageClasses();
}

tabAttendance.addEventListener('click', () => switchTab('attendance'));
tabManage.addEventListener('click',     () => switchTab('manage'));

function clearMngError() { mngError.hidden = true; mngError.textContent = ''; }
function showMngError(msg) { mngError.textContent = msg; mngError.hidden = false; }

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

mngClassSelect.addEventListener('change', async () => {
  clearMngError();
  const classId = mngClassSelect.value;
  if (!classId) {
    mngAssignedWrap.hidden = true;
    return;
  }
  mngAssignedWrap.hidden = false;
  await Promise.all([loadAssignedTeachers(classId), loadAssignableTeachers(classId)]);
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
  const subj = t.subject
    ? `<span class="mng-subject-tag">${escapeHtml(t.subject)}</span>` : '';
  li.innerHTML = `
    <div class="mng-row-main">
      <span class="mng-teacher-name">${escapeHtml(t.fullName)}</span>
      ${subj}
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

// Teachers in the school NOT yet on this class.
async function loadAssignableTeachers(classId) {
  mngTeacherSelect.innerHTML = `<option value="">${RW.pickPlaceholder}</option>`;
  try {
    const teachers = await NDB.getTeachersBySchool(S.school.id, classId);
    for (const t of teachers) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.fullName;
      mngTeacherSelect.appendChild(opt);
    }
    if (teachers.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = RW.noneAvailable;
      opt.disabled = true;
      mngTeacherSelect.appendChild(opt);
    }
    CustomSelect.refresh(mngTeacherSelect);
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
  if (!classId)   { showMngError('اختر صفاً أولاً.'); return; }
  if (!teacherId) { showMngError(RW.pickToAssign); return; }
  if (!navigator.onLine) { showMngError('الإسناد يحتاج اتصالاً بالإنترنت.'); return; }

  _mngBusy = true;
  btnAssignTeacher.disabled = true;
  assignBtnLabel.hidden = true;
  assignSpinner.hidden = false;
  try {
    // subject is intentionally null — the المادة field was removed from this UI.
    await NDB.assignTeacherToClass(classId, teacherId, null);
    mngTeacherSelect.value = '';
    toast(RW.assignedToast, 'success');
    await Promise.all([loadAssignedTeachers(classId), loadAssignableTeachers(classId)]);
  } catch (err) {
    console.error('[NSAMS] assignTeacherToClass', err);
    // Unique-violation = teacher already on the class.
    if (err?.code === '23505') {
      showMngError(RW.alreadyOnClass);
    } else {
      showMngError(err?.message || RW.assignFail);
    }
  } finally {
    _mngBusy = false;
    btnAssignTeacher.disabled = false;
    assignBtnLabel.hidden = false;
    assignSpinner.hidden = true;
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
    showMngError(err?.message || RW.removeFail);
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

// Enhance the three school-admin selects once the DOM is parsed.
CustomSelect.enhance('mng-class-select');
CustomSelect.enhance('mng-teacher-select');
CustomSelect.enhance('r-type');

// ── Start the app (after all declarations are initialized) ──
bootstrap();