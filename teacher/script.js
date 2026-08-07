// teacher/script.js
// Loaded as <script type="module"> after shared/db.js

// ── Guard ─────────────────────────────────────────────────────────────────────
if (!window.RUQI_DB) {
  document.body.innerHTML =
    '<p style="padding:24px;color:#EF4444;font-family:sans-serif;direction:rtl">' +
    'خطأ: تعذّر تحميل طبقة البيانات. تأكد من تضمين shared/db.js قبل هذا الملف.</p>';
  throw new Error('window.RUQI_DB is not defined');
}

const {
  login,
  logout,
  getCurrentUser,
  getTeacherClasses,
  getClassStudents,
  getClassSubmissionStatus,
  getClassAttendanceForDate,
  saveStudentAttendance,
  getPendingStudentAttendance,
  getPendingStudentGrades,
  syncPending,
  gradeNameAr,
  localDateISO,
  getClassAbsenceLog,
  getClassGradeSubjects,
  getClassGrades,
  saveStudentGrades,
  getClassConduct,
  saveStudentConduct,
  proposeGrace,
  getGraceProposals,
  teacherCheckIn,
  teacherCheckOut,
  getMyStaffAttendanceToday,
  errMessage,
} = window.RUQI_DB;

// ── App State ─────────────────────────────────────────────────────────────────
const S = {
  user:       null,          // { user: {id, email, fullName}, role, schoolId }
  classes:    [],            // array from getTeacherClasses()
  // --- attendance view ---
  activeClass:      null,    // one item from S.classes
  students:         [],      // from getClassStudents()
  attendance:       {},      // { [studentId]: { status, reason } }
  submission:       null,    // from getClassSubmissionStatus() – null = not yet
  isDirty:          false,   // unsaved changes since last render
  duty:             null,    // today's staff_attendance record (or null)
  dutyBusy:         false,   // a check-in/out request is in flight
};

// Default status for a student when the teacher first opens the class.
// present-by-default is intentional: paper registers work by marking only the
// absentees. The confirm modal (not a per-row "must mark" check) is the guard.
const DEFAULT_STATUS = 'present';

// Statuses that can carry a note/reason.
const REASON_STATUSES = new Set(['late', 'absent', 'excused']);

// ── Local draft store ─────────────────────────────────────────────────────────
// Drafts live ONLY on this device and never touch the DB or the manager's queue.
// A class+date sheet reaches Supabase exclusively via an explicit "إرسال للمدير".
const DRAFT_PFX = 'nsams_draft_';
const draftKey = (classId, date) => `${DRAFT_PFX}${classId}_${date}`;

function loadLocalDraft(classId, date) {
  try {
    const raw = localStorage.getItem(draftKey(classId, date));
    return raw ? JSON.parse(raw) : null; // { attendance, status, ts }
  } catch { return null; }
}
function saveLocalDraft(classId, date, attendance, status = 'draft') {
  try {
    localStorage.setItem(
      draftKey(classId, date),
      JSON.stringify({ attendance, status, ts: Date.now() })
    );
  } catch { /* quota — non-fatal */ }
}
function clearLocalDraft(classId, date) {
  try { localStorage.removeItem(draftKey(classId, date)); } catch { /* ignore */ }
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// Screens / views
const screenLogin  = $('screen-login');
const screenApp    = $('screen-app');
const viewHome     = $('view-home');
const viewAtt      = $('view-att');

// Duty card (دوامي اليوم)
const dutyCard     = $('duty-card');
const dutyStatus   = $('duty-status');
const dutyInfo     = $('duty-info');
const btnCheckIn   = $('btn-check-in');
const btnCheckOut  = $('btn-check-out');

// Login
const formLogin      = $('form-login');
const inEmail        = $('in-email');
const inPw           = $('in-password');
const btnTogglePw    = $('btn-toggle-pw');
const pwEyeUse       = $('pw-eye-use');
const loginError     = $('login-error');
const btnLogin       = $('btn-login');
const btnLoginLabel  = $('btn-login-label');
const loginSpinner   = $('login-spinner');

// Home header
const hdrTeacherName = $('hdr-teacher-name');
const hdrDate        = $('hdr-date');
const connPill       = $('conn-pill');
const connIcon       = $('conn-icon');
const connLabel      = $('conn-label');
const pendingBar     = $('pending-bar');
const pendingText    = $('pending-text');
const btnSync        = $('btn-sync');
const syncIcon       = $('sync-icon');
const btnSyncBar     = $('btn-sync-bar');
const btnLogout      = $('btn-logout');

// Home view
const classesLoading = $('classes-loading');
const classesList    = $('classes-list');
const classesEmpty   = $('classes-empty');
const classesFailed  = $('classes-failed');

// Attendance view
const attClassName   = $('att-class-name');
const btnBack        = $('btn-back');
const sumPresent     = $('sum-present');
const sumLate        = $('sum-late');
const sumAbsent      = $('sum-absent');
const sumExcused     = $('sum-excused');
const submittedBanner= $('submitted-banner');
const submittedBannerText = $('submitted-banner-text');
const rejectedBanner = $('rejected-banner');
const rejectedReason = $('rejected-reason');
const studentsLoading= $('students-loading');
const studentsList   = $('students-list');
const studentsEmpty  = $('students-empty');
const attFooter      = $('att-footer');
const btnSaveDraft   = $('btn-save-draft');
const btnSubmitAtt   = $('btn-submit-att');
const btnSubmitLabel = $('btn-submit-label');
const submitSpinner  = $('submit-spinner');

// Reason modal
const modalReason       = $('modal-reason');
const reasonStudentName = $('reason-student-name');
const reasonTitle       = $('reason-title');
const reasonInput       = $('reason-input');
const btnReasonCancel   = $('btn-reason-cancel');
const btnReasonSave     = $('btn-reason-save');

// Confirm modal
const modalConfirm      = $('modal-confirm');
const cPresent          = $('c-present');
const cAbsent           = $('c-absent');
const cLate             = $('c-late');
const cExcused          = $('c-excused');
const confirmWarning    = $('confirm-warning');
const confirmWarningText= $('confirm-warning-text');
const btnConfirmCancel  = $('btn-confirm-cancel');
const btnConfirmSubmit  = $('btn-confirm-submit');
const confirmSubmitLabel= $('confirm-submit-label');
const confirmSpinner    = $('confirm-spinner');

// Toast zone
const toastZone = $('toasts');

// ── Utilities ─────────────────────────────────────────────────────────────────
// Local calendar date (not UTC). Falls back to a local computation if the DB
// layer didn't export the helper (e.g. stale cached db.js).
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function svgHref(el, href) { el.setAttribute('href', href); }

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

// ── In-app confirm ────────────────────────────────────────────────────────────
// Replaces native confirm(): the browser's dialog is chrome, not app UI — it
// renders the hosting domain to the user and breaks the installed-app illusion.
// Returns a promise that resolves true (continue) or false (cancel).
const modalAsk     = document.getElementById('modal-ask');
const askModalText = document.getElementById('ask-modal-text');
const btnAskCancel = document.getElementById('btn-ask-cancel');
const btnAskOk     = document.getElementById('btn-ask-ok');

let _askResolve = null;

function settleAsk(answer) {
  if (!_askResolve) return;
  const resolve = _askResolve;
  _askResolve = null;
  hide(modalAsk);
  document.body.style.overflow = '';
  resolve(answer);
}

function askConfirm(message, okLabel = 'متابعة') {
  // A second call while one is open cancels the first rather than orphaning it.
  settleAsk(false);
  askModalText.textContent = message;
  btnAskOk.textContent     = okLabel;
  show(modalAsk);
  document.body.style.overflow = 'hidden';
  btnAskOk.focus();
  return new Promise((resolve) => { _askResolve = resolve; });
}

btnAskCancel.addEventListener('click', () => settleAsk(false));
btnAskOk.addEventListener('click',     () => settleAsk(true));
modalAsk.addEventListener('click', (e) => {
  if (e.target === modalAsk) settleAsk(false);
});

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
  // Icon is a static, trusted template; the message is user/server-derived so
  // it goes in via textContent to avoid HTML injection.
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

// ── Screen / view routing ─────────────────────────────────────────────────────
function showScreen(name) {
  removeBootSplash();               // أول شاشة حقيقية تُرفع مؤشّر الإقلاع فوراً
  screenLogin.hidden = name !== 'login';
  screenApp.hidden   = name !== 'app';
}

// مؤشّر تحميل الإقلاع: يمنع وميض شاشة الدخول قبل حسم الجلسة — قد يستغرق فحصُها
// ثوانيَ قليلة على شبكة «متصلة لكن ميتة». يُنشأ من JS فقط، فلو تعذّر تحميل
// السكربت أصلاً تبقى شاشة الدخول ظاهرة كحالة تراجُع آمنة. يُرفع في showScreen بمجرّد
// ظهور اللوحة (لا بعد اكتمال كل تحميلاتها) كي لا يحجب لوحةً جاهزة تحته.
function showBootSplash() {
  screenLogin.hidden = true;
  let el = document.getElementById('boot-splash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-splash';
    el.setAttribute('style',
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:var(--clr-bg,#0f172a);z-index:9999');
    el.innerHTML = '<span class="spinner" style="width:40px;height:40px"></span>';
    document.body.appendChild(el);
  }
  el.hidden = false;
  return el;
}
function removeBootSplash() {
  const el = document.getElementById('boot-splash');
  if (el) el.remove();
}

function showView(name) {
  viewHome.hidden   = name !== 'home';
  viewAtt.hidden    = name !== 'att';
  if (viewGrades)  viewGrades.hidden  = name !== 'grades';
  if (viewConduct) viewConduct.hidden = name !== 'conduct';
}

// ── Connectivity ──────────────────────────────────────────────────────────────
function updateConnUI() {
  const online = navigator.onLine;
  connPill.classList.toggle('offline', !online);
  connLabel.textContent = online ? 'متصل' : 'غير متصل';
  svgHref(connIcon, online ? '#ic-wifi' : '#ic-wifi-off');
  refreshPendingBar();
}

function refreshPendingBar() {
  const n = getPendingStudentAttendance().length
          + (typeof getPendingStudentGrades === 'function' ? getPendingStudentGrades().length : 0);
  if (n > 0) {
    pendingText.textContent = `${n} كشف في انتظار المزامنة`;
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
  if (syncing || !navigator.onLine) return;
  syncing = true;
  syncIcon.classList.add('syncing');
  try {
    const result = await syncPending();
    const total  = (result.studentAtt?.synced ?? 0)
                 + (result.attendance?.synced ?? 0)
                 + (result.reports?.synced    ?? 0)
                 + (result.grades?.synced     ?? 0)
                 + (result.staffAtt?.synced   ?? 0);
    if (total > 0) toast(`تمت مزامنة ${total} سجل بنجاح`, 'success');
    if (result.staffAtt?.synced > 0) await loadDutyCard();
    refreshPendingBar();
  } catch (err) {
    console.warn('[Ruqi-T] sync error', err);
    toast('تعذّرت المزامنة', 'error');
  } finally {
    syncIcon.classList.remove('syncing');
    syncing = false;
  }
}

btnSync.addEventListener('click', doSync);
btnSyncBar.addEventListener('click', doSync);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'BG_SYNC') doSync();
  });
}

// Read by shared/db.js before it reloads the page for a Service Worker update:
// a teacher mid-entry must not lose an attendance sheet or a column of marks.
// G and C are declared later in the file; guard against the temporal dead zone
// by only touching them once they exist.
window.ruqiHasUnsavedWork = () => {
  try {
    return Boolean(S.isDirty || G?.dirty || C?.dirty);
  } catch { return false; }
};

// ── Password toggle ───────────────────────────────────────────────────────────
btnTogglePw.addEventListener('click', () => {
  const isPw = inPw.type === 'password';
  inPw.type  = isPw ? 'text' : 'password';
  svgHref(pwEyeUse, isPw ? '#ic-eye-off' : '#ic-eye');
  btnTogglePw.setAttribute('aria-label', isPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
});

// ── Login ─────────────────────────────────────────────────────────────────────
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

    if (session.role !== 'teacher') {
      await logout().catch(() => {});
      loginError.textContent = 'هذا التطبيق مخصص لمعلمي الصفوف فقط';
      show(loginError);
      return;
    }

    S.user = session;
    await initApp();
  } catch (err) {
    console.error('[Ruqi-T] login error', err);
    loginError.textContent = errMessage(err, 'تعذّر تسجيل الدخول. أعد المحاولة.');
    show(loginError);
  } finally {
    setLoginBusy(false);
  }
});

function setLoginBusy(busy) {
  btnLogin.disabled    = busy;
  btnLoginLabel.hidden = busy;
  loginSpinner.hidden  = !busy;
}

// ── Logout ────────────────────────────────────────────────────────────────────
const modalConfirmLogout = document.getElementById('modal-confirm-logout');
const btnLogoutCancel    = document.getElementById('btn-logout-cancel');
const btnLogoutOk        = document.getElementById('btn-logout-ok');

btnLogout.addEventListener('click', async () => {
  if (S.isDirty && !(await askConfirm('يوجد تغييرات غير محفوظة. هل تريد الخروج؟', 'خروج'))) return;
  modalConfirmLogout.hidden = false;
});
btnLogoutCancel.addEventListener('click', () => { modalConfirmLogout.hidden = true; });
modalConfirmLogout.addEventListener('click', e => {
  if (e.target === modalConfirmLogout) modalConfirmLogout.hidden = true;
});
btnLogoutOk.addEventListener('click', async () => {
  modalConfirmLogout.hidden = true;
  try { await logout(); } catch { /* ignore */ }

  // إعادة تحميل كاملة بدل مسح حقول S وحدها: المعلّم التالي على الجهاز نفسه
  // يجب ألّا يرى صفّاً واحداً من طلاب سابقه. نفس علّة بوابة المدرسة —
  // الحالة والقوائم المرسومة تنجو من تبديل الشاشة وحده.
  try { await window.RUQI_DB.purgeTenantCaches(); } catch { /* غير قاتل */ }
  location.reload();
});

// ── App Init ──────────────────────────────────────────────────────────────────
async function initApp() {
  await RUQI_PERMISSIONS.init(S.user?.user?.id);
  RUQI_PERMISSIONS.applyToDom();
  showScreen('app');
  showView('home');

  hdrTeacherName.textContent = S.user?.user?.fullName ?? 'المعلم';
  hdrDate.textContent        = formatDateAr(todayISO());

  updateConnUI();
  await loadClasses();
  await loadDutyCard();
  await doSync();
  initNotificationsTeacher(S.user.user.id);
}

// ── Load Classes ──────────────────────────────────────────────────────────────
async function loadClasses() {
  show(classesLoading);
  hide(classesList);
  hide(classesEmpty);
  hide(classesFailed);

  /* ثلاث حالات لا واحدة. كان الفشل في الجلب يُسنِد [] ثم يعرض «لا توجد صفوف
     مسندة إليك» — وهي كذبة على معلّم له صفوف، وهي بالضبط ما أبلغ عنه
     المستخدم. الآن: نجاح · فشل مع نسخة محفوظة (يقرأها db.js تلقائياً) ·
     فشل بلا نسخة (NoCachedClassesError) → شاشة خاصّة بها. */
  try {
    S.classes = await getTeacherClasses(S.user.user.id);
  } catch (err) {
    console.error('[Ruqi-T] getTeacherClasses', err);
    S.classes = [];
    hide(classesLoading);
    show(classesFailed);
    return;
  }

  hide(classesLoading);

  if (S.classes.length === 0) {
    show(classesEmpty);
    return;
  }

  // Roles decide which tab a class belongs to: attendance is for the homeroom
  // teacher (معلم الصف) and the supervisor (موجه الصف); grades are for the
  // homeroom teacher and subject teachers (أستاذ مادة).
  setupModeTabs();
  applyHomeMode();
}

// إعادة المحاولة يدوياً: أسرع من إغلاق التطبيق وفتحه بعد عودة الشبكة.
$('btn-retry-classes')?.addEventListener('click', () => { loadClasses(); });

// وعودة الشبكة تُعيد المحاولة تلقائياً إن كنّا عالقين على شاشة الفشل — فمعلّم
// دخل الصفّ قبل أن يلتقط الجهاز الشبكة لا يبقى ينظر إلى رسالة خطأ.
window.addEventListener('online', () => {
  if (classesFailed && !classesFailed.hidden) loadClasses();
});

// ── Duty card: self check-in / out ──────────────────────────────────────────────
// The teacher's school + work-start time come from their class assignment (all
// classes are in the same school); the session also carries schoolId as a fallback.
function dutySchoolId() {
  return S.classes[0]?.schoolId ?? S.user?.schoolId ?? null;
}
function dutyWorkStart() {
  return S.classes[0]?.workStartTime ?? null;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function renderDutyCard() {
  if (!dutyCard) return;
  const rec = S.duty;

  // Discard any record that isn't strictly for today — prevents a stale cached
  // or wrong-date result from enabling checkout on a fresh session.
  if (rec && rec.date !== todayISO()) {
    S.duty = null;
    loadDutyCard().catch(() => {});
    return;
  }

  const effIn = rec?.checkInAdjusted ?? rec?.checkInOriginal ?? null;

  // Status pill
  if (rec && (rec.status === 'present' || rec.status === 'late')) {
    dutyStatus.hidden = false;
    dutyStatus.textContent = rec.status === 'late' ? 'متأخر' : 'حاضر';
    dutyStatus.className = 'duty-status ' + (rec.status === 'late' ? 'is-late' : 'is-present');
  } else {
    dutyStatus.hidden = true;
  }

  // Info line
  if (!effIn) {
    dutyInfo.textContent = 'لم تُسجّل دخولك بعد.';
  } else {
    let html = `الدخول: <strong>${fmtTime(effIn)}</strong>`;
    if (rec.lateMinutes > 0) html += ` · تأخّر <strong>${rec.lateMinutes}</strong> دقيقة`;
    html += rec.checkOut ? ` · الخروج: <strong>${fmtTime(rec.checkOut)}</strong>` : '';
    dutyInfo.innerHTML = html;
  }

  // Buttons: can check in only if not yet; can check out only after check-in & before checkout.
  const hasIn  = !!effIn;
  const hasOut = !!rec?.checkOut;
  btnCheckIn.disabled  = S.dutyBusy || hasIn;
  btnCheckOut.disabled = S.dutyBusy || !hasIn || hasOut;
}

async function loadDutyCard() {
  if (!dutyCard) return;
  if (!dutySchoolId()) { dutyCard.hidden = true; return; }
  dutyCard.hidden = false;
  try {
    S.duty = await getMyStaffAttendanceToday(S.user.user.id);
  } catch (err) {
    console.error('[Ruqi-T] getMyStaffAttendanceToday', err);
    S.duty = null;
  }
  renderDutyCard();
}

async function handleCheckIn() {
  const schoolId = dutySchoolId();
  if (!schoolId || S.dutyBusy) return;
  S.dutyBusy = true; renderDutyCard();
  try {
    const res = await teacherCheckIn(S.user.user.id, schoolId, dutyWorkStart());
    S.duty = await getMyStaffAttendanceToday(S.user.user.id).catch(() => S.duty);
    toast(res.synced ? 'تم تسجيل دخولك' : 'سُجّل دخولك محلياً وسيُزامن عند الاتصال',
          res.synced ? 'success' : 'warning');
  } catch (err) {
    console.error('[Ruqi-T] checkIn', err);
    toast('تعذّر تسجيل الدخول', 'error');
  } finally {
    S.dutyBusy = false; renderDutyCard();
  }
}

async function handleCheckOut() {
  const schoolId = dutySchoolId();
  if (!schoolId || S.dutyBusy) return;
  S.dutyBusy = true; renderDutyCard();
  try {
    const res = await teacherCheckOut(S.user.user.id, schoolId);
    S.duty = await getMyStaffAttendanceToday(S.user.user.id).catch(() => S.duty);
    toast(res.synced ? 'تم تسجيل خروجك' : 'سُجّل خروجك محلياً وسيُزامن عند الاتصال',
          res.synced ? 'success' : 'warning');
  } catch (err) {
    console.error('[Ruqi-T] checkOut', err);
    toast('تعذّر تسجيل الخروج', 'error');
  } finally {
    S.dutyBusy = false; renderDutyCard();
  }
}

if (btnCheckIn)  btnCheckIn.addEventListener('click', handleCheckIn);
if (btnCheckOut) btnCheckOut.addEventListener('click', handleCheckOut);

function attendanceClasses() {
  return S.classes.filter(c => c.role === 'homeroom' || c.role === 'supervisor');
}
function gradeClasses() {
  return S.classes.filter(c => c.role === 'homeroom' || c.role === 'subject');
}
// Conduct (السلوك) is entered by the attendance teacher — one mark out of 100,
// no components. Available for every grade the teacher takes attendance for.
function conductClasses() {
  return S.classes.filter(c => c.role === 'homeroom' || c.role === 'supervisor');
}
function classesForMode(mode) {
  if (mode === 'grades')  return gradeClasses();
  if (mode === 'conduct') return conductClasses();
  return attendanceClasses();
}

// Show only the tabs the teacher actually has classes for; pick a sensible
// default mode. A teacher with a single mode sees no tab bar at all.
function setupModeTabs() {
  const hasAtt     = attendanceClasses().length > 0;
  const hasGrades  = gradeClasses().length > 0;
  const hasConduct = conductClasses().length > 0;
  modeAttBtn.style.display     = hasAtt     ? '' : 'none';
  modeGradesBtn.style.display  = hasGrades  ? '' : 'none';
  modeConductBtn.style.display = hasConduct ? '' : 'none';
  const count = [hasAtt, hasGrades, hasConduct].filter(Boolean).length;
  if (modeTabs) modeTabs.style.display = count > 1 ? '' : 'none';
  homeMode = hasAtt ? 'att' : (hasGrades ? 'grades' : (hasConduct ? 'conduct' : 'att'));
}

// Render the class list for the current mode (re-run when the tab changes).
async function renderClassList() {
  const list = classesForMode(homeMode);

  hide(classesEmpty);
  hide(classesFailed);
  // فراغ حقيقي هنا: الصفوف محمّلة لكن لا شيء منها يخصّ هذا الوضع (حضور /
  // درجات / سلوك) — رسالة «لا توجد صفوف» صادقة في هذا الموضع وحده.
  if (list.length === 0) { hide(classesList); show(classesEmpty); return; }

  // Submission badges only matter in attendance mode.
  let statuses = [];
  if (homeMode === 'att') {
    const today = todayISO();
    statuses = await Promise.allSettled(list.map(c => getClassSubmissionStatus(c.id, today)));
  }

  show(classesList);
  classesList.innerHTML = '';
  list.forEach((cls, i) => {
    const sub = (homeMode === 'att' && statuses[i]?.status === 'fulfilled') ? statuses[i].value : null;
    classesList.appendChild(buildClassCard(cls, sub, homeMode));
  });
}

// ── Class Card ────────────────────────────────────────────────────────────────
function buildClassCard(cls, submission, mode = 'att') {
  const card = document.createElement('button');
  card.className   = 'class-card';
  card.setAttribute('aria-label', `فتح ${cls.displayName}`);

  // The submission badge is an attendance concept; other modes omit it.
  const statusHtml = mode === 'att'
    ? (() => {
        const { badgeClass, badgeText } = submissionBadge(submission);
        return `<div class="class-status"><span class="status-badge ${badgeClass}">${badgeText}</span></div>`;
      })()
    : '';

  card.innerHTML = `
    <div class="class-icon">
      <span>${cls.grade}</span>
    </div>
    <div class="class-info">
      <div class="class-name">${escapeHtml(cls.displayName)}</div>
      <div class="class-meta">${escapeHtml(cls.schoolName)}</div>
    </div>
    ${statusHtml}
  `;

  card.addEventListener('click', () => {
    if (mode === 'grades')       openGradesView(cls);
    else if (mode === 'conduct') openConductView(cls);
    else                         openAttendanceView(cls);
  });
  return card;
}

function submissionBadge(sub) {
  if (!sub)                   return { badgeClass: 'badge-pending',   badgeText: 'لم يُرسل' };
  if (sub.status === 'pending')   return { badgeClass: 'badge-submitted', badgeText: 'بانتظار المدير' };
  if (sub.status === 'confirmed') return { badgeClass: 'badge-confirmed', badgeText: 'مؤكد ✓' };
  if (sub.status === 'rejected')  return { badgeClass: 'badge-rejected',  badgeText: 'مُعاد ✗' };
  return { badgeClass: 'badge-pending', badgeText: 'لم يُرسل' };
}

// ── Attendance View ───────────────────────────────────────────────────────────
async function openAttendanceView(cls) {
  S.activeClass = cls;
  S.attendance  = {};
  S.isDirty     = false;

  attClassName.textContent = cls.displayName;

  showView('att');

  // Reset banners and footer
  hide(submittedBanner);
  hide(rejectedBanner);
  hide(studentsEmpty);
  hide(studentsList);
  show(studentsLoading);
  show(attFooter);
  hide(btnSaveDraft);
  show(btnSubmitAtt);
  btnSubmitAtt.disabled = false;
  btnSubmitLabel.hidden = false;
  submitSpinner.hidden  = true;
  studentsList.classList.remove('locked');

  updateSummaryBar();

  const today = todayISO();

  try {
    // Parallel: students + submission status + existing attendance
    const [students, submission, existing] = await Promise.all([
      getClassStudents(cls.id),
      getClassSubmissionStatus(cls.id, today),
      getClassAttendanceForDate(cls.id, today),
    ]);

    S.students  = students;

    const localDraft = loadLocalDraft(cls.id, today);

    if (Object.keys(existing).length > 0) {
      // DB has real records → authoritative. A local draft is now stale.
      S.attendance = existing;
      S.submission = submission;
      clearLocalDraft(cls.id, today);
    } else if (localDraft && localDraft.attendance) {
      // No DB record yet, but an unsent local draft exists → restore it.
      S.attendance = localDraft.attendance;
      // If we submitted while offline, the submission lives only locally as
      // 'pending' until sync; reflect that so the banner is correct.
      S.submission = submission
        ?? (localDraft.status === 'pending' ? { status: 'pending' } : null);
    } else {
      // First open today: everyone present by default; teacher flips absentees.
      S.attendance = {};
      for (const stu of students) {
        S.attendance[stu.id] = { status: DEFAULT_STATUS, reason: null };
      }
      S.submission = submission;
    }

    hide(studentsLoading);

    if (students.length === 0) {
      show(studentsEmpty);
      hide(attFooter);
      return;
    }

    renderSubmissionBanners();
    renderStudentsList();
    updateSummaryBar();

  } catch (err) {
    console.error('[Ruqi-T] openAttendanceView', err);
    toast(errMessage(err, 'تعذّر تحميل بيانات الصف'), 'error');
    hide(studentsLoading);
    hide(attFooter);
  }
}

// ── Render submission banners ─────────────────────────────────────────────────
function renderSubmissionBanners() {
  hide(submittedBanner);
  hide(rejectedBanner);

  if (!S.submission) return;

  if (S.submission.status === 'confirmed') {
    submittedBannerText.textContent = 'تم قبول الكشف من المدير — لا يمكن التعديل';
    show(submittedBanner);
    hide(attFooter);
    studentsList.classList.add('locked');

  } else if (S.submission.status === 'pending') {
    submittedBannerText.textContent = 'تم إرسال الكشف — في انتظار مراجعة المدير';
    show(submittedBanner);
    // Footer still visible to allow re-send if needed
    show(btnSaveDraft);

  } else if (S.submission.status === 'rejected') {
    rejectedReason.textContent = S.submission.notes
      ? ` ${S.submission.notes}`
      : ' يرجى المراجعة والإرسال مجدداً.';
    show(rejectedBanner);
  }
}

// ── Render students list ──────────────────────────────────────────────────────
function renderStudentsList() {
  studentsList.innerHTML = '';

  S.students.forEach((stu) => {
    const rec = S.attendance[stu.id] ?? { status: DEFAULT_STATUS, reason: null };
    const li  = buildStudentRow(stu, rec);
    studentsList.appendChild(li);
  });

  show(studentsList);
}

function buildStudentRow(stu, rec) {
  const li = document.createElement('li');
  li.className    = 'student-row';
  li.dataset.id   = stu.id;
  li.dataset.status = rec.status;
  li.setAttribute('role', 'listitem');

  const showReason = rec.reason && REASON_STATUSES.has(rec.status);
  const gDot = stu.gender === 'female'
    ? '<span class="gender-dot gender-dot--female" title="أنثى"></span>'
    : stu.gender === 'male'
      ? '<span class="gender-dot gender-dot--male" title="ذكر"></span>'
      : '<span class="gender-dot" style="background:var(--clr-border)"></span>';

  li.innerHTML = `
    ${gDot}
    <div class="student-name-wrap">
      <div class="student-name">${escapeHtml(stu.full_name)}</div>
      ${showReason
        ? `<div class="student-reason-text">${escapeHtml(rec.reason)}</div>`
        : ''}
    </div>
    <div class="stn-btns" data-sid="${escapeHtml(stu.id)}" aria-label="حالة ${escapeHtml(stu.full_name)}">
      <button class="stn-btn${rec.status==='present' ?' active':''}" data-s="present"  title="حاضر"  aria-label="حاضر"  aria-pressed="${rec.status==='present'}">ح</button>
      <button class="stn-btn${rec.status==='late'    ?' active':''}" data-s="late"     title="متأخر" aria-label="متأخر" aria-pressed="${rec.status==='late'}">ت</button>
      <button class="stn-btn${rec.status==='absent'  ?' active':''}" data-s="absent"   title="غائب"  aria-label="غائب"  aria-pressed="${rec.status==='absent'}">غ</button>
      <button class="stn-btn${rec.status==='excused' ?' active':''}" data-s="excused"  title="بعذر"  aria-label="بعذر"  aria-pressed="${rec.status==='excused'}">ع</button>
    </div>
  `;

  return li;
}

// ── Status button event delegation ───────────────────────────────────────────
studentsList.addEventListener('click', (e) => {
  const btn = e.target.closest('.stn-btn');
  if (!btn || studentsList.classList.contains('locked')) return;

  const wrap   = btn.closest('.stn-btns');
  const sid    = wrap.dataset.sid;
  const status = btn.dataset.s;
  const row    = btn.closest('.student-row');

  // Update state
  const prev = S.attendance[sid] ?? { status: DEFAULT_STATUS, reason: null };
  S.attendance[sid] = { status, reason: prev.reason ?? null };
  S.isDirty = true;

  // Update button active states
  wrap.querySelectorAll('.stn-btn').forEach(b => {
    b.classList.toggle('active', b === btn);
    b.setAttribute('aria-pressed', String(b === btn));
  });

  // Update row color
  row.dataset.status = status;

  // Show reason modal for any status that can carry a note (late/absent/excused)
  if (REASON_STATUSES.has(status)) {
    openReasonModal(sid);
  } else {
    // present → clear any reason
    S.attendance[sid].reason = null;
    const nameWrap = row.querySelector('.student-name-wrap');
    const existing = nameWrap.querySelector('.student-reason-text');
    if (existing) existing.remove();
  }

  updateSummaryBar();
});

// ── Summary bar update ────────────────────────────────────────────────────────
function updateSummaryBar() {
  const counts = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const rec of Object.values(S.attendance)) {
    if (counts[rec.status] !== undefined) counts[rec.status]++;
  }
  sumPresent.textContent = counts.present;
  sumLate.textContent    = counts.late;
  sumAbsent.textContent  = counts.absent;
  sumExcused.textContent = counts.excused;

  // Bump animation on change
  [sumPresent, sumLate, sumAbsent, sumExcused].forEach(el => {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    el.addEventListener('animationend', () => el.classList.remove('bump'), { once: true });
  });
}

// ── Reason Modal ──────────────────────────────────────────────────────────────
let _reasonSid = null; // student id being edited

function openReasonModal(sid) {
  _reasonSid = sid;
  const stu    = S.students.find(s => s.id === sid);
  const status = S.attendance[sid]?.status ?? DEFAULT_STATUS;
  const meta = {
    absent:  ['سبب الغياب',      'مثال: غائب بسبب المرض (إفادة طبية)'],
    late:    ['سبب التأخير',     'مثال: تأخّر بسبب ازدحام الطريق'],
    excused: ['سبب الغياب بعذر', 'مثال: مغادرة مبكّرة بإذن وليّ الأمر'],
  }[status] ?? ['الملاحظة', 'اكتب ملاحظة…'];
  reasonTitle.textContent     = meta[0];
  reasonInput.placeholder     = meta[1];
  reasonStudentName.textContent = stu?.full_name ?? '—';
  reasonInput.value = S.attendance[sid]?.reason ?? '';
  show(modalReason);
  setTimeout(() => reasonInput.focus(), 80);
}

function closeReasonModal() {
  hide(modalReason);
  _reasonSid = null;
}

btnReasonCancel.addEventListener('click', closeReasonModal);

btnReasonSave.addEventListener('click', () => {
  if (!_reasonSid) return;
  const reason = reasonInput.value.trim() || null;
  S.attendance[_reasonSid].reason = reason;
  S.isDirty = true;

  // Refresh row to show/hide reason text
  const row = studentsList.querySelector(`[data-id="${_reasonSid}"]`);
  if (row) {
    const nameWrap = row.querySelector('.student-name-wrap');
    let rt = nameWrap.querySelector('.student-reason-text');
    if (reason) {
      if (!rt) {
        rt = document.createElement('div');
        rt.className = 'student-reason-text';
        nameWrap.appendChild(rt);
      }
      rt.textContent = reason;
    } else if (rt) {
      rt.remove();
    }
  }

  closeReasonModal();
  toast('تم حفظ الملاحظة', 'success', 2000);
});

modalReason.addEventListener('click', (e) => {
  if (e.target === modalReason) closeReasonModal();
});

// ── Back button ───────────────────────────────────────────────────────────────
btnBack.addEventListener('click', async () => {
  if (S.isDirty && S.activeClass) {
    // Persist locally so the teacher can resume — does NOT submit to the manager.
    saveLocalDraft(S.activeClass.id, todayISO(), S.attendance, 'draft');
  }
  S.activeClass = null;
  S.students    = [];
  S.attendance  = {};
  S.submission  = null;
  S.isDirty     = false;
  showView('home');
  // Refresh class cards to reflect any status changes
  await loadClasses();
});

// ── Save Draft (local only) ───────────────────────────────────────────────────
// Stores the current marks on this device. Nothing is sent to the manager and
// no attendance_submissions row is created until the teacher explicitly submits.
function saveDraft(silent = false) {
  if (!S.activeClass || S.students.length === 0) return;
  saveLocalDraft(S.activeClass.id, todayISO(), S.attendance, 'draft');
  S.isDirty = false;
  if (!silent) toast('تم حفظ الكشف مؤقتاً على هذا الجهاز', 'success');
}

btnSaveDraft.addEventListener('click', () => saveDraft(false));

// ── Submit Attendance ─────────────────────────────────────────────────────────
btnSubmitAtt.addEventListener('click', () => {
  if (S.students.length === 0) return;
  // No per-row "must mark" check: present is the deliberate default, so every
  // student already has a status. The confirm modal (counts + all-absent
  // warning) is the real guard against accidental submission.
  openConfirmModal();
});

function buildRecordsArray() {
  return S.students.map(stu => ({
    studentId: stu.id,
    status:    S.attendance[stu.id]?.status ?? DEFAULT_STATUS,
    reason:    S.attendance[stu.id]?.reason ?? null,
  }));
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────
function openConfirmModal() {
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const rec of Object.values(S.attendance)) {
    if (counts[rec.status] !== undefined) counts[rec.status]++;
  }

  cPresent.textContent = counts.present;
  cAbsent.textContent  = counts.absent;
  cLate.textContent    = counts.late;
  cExcused.textContent = counts.excused;

  // Warn if 100% absent (likely a mistake)
  const warnAll = counts.absent + counts.excused === S.students.length && S.students.length > 0;
  if (warnAll) {
    confirmWarningText.textContent = 'جميع الطلاب غائبون — تأكد من صحة البيانات قبل الإرسال.';
    confirmWarning.style.display = 'block';
  } else {
    confirmWarning.style.display = 'none';
  }

  show(modalConfirm);
}

function closeConfirmModal() {
  hide(modalConfirm);
  confirmSubmitLabel.hidden = false;
  confirmSpinner.hidden     = true;
  btnConfirmSubmit.disabled = false;
}

btnConfirmCancel.addEventListener('click', closeConfirmModal);

modalConfirm.addEventListener('click', (e) => {
  if (e.target === modalConfirm) closeConfirmModal();
});

btnConfirmSubmit.addEventListener('click', async () => {
  btnConfirmSubmit.disabled = true;
  confirmSubmitLabel.hidden = true;
  confirmSpinner.hidden     = false;

  const records = buildRecordsArray();

  try {
    const result = await saveStudentAttendance({
      records,
      classId:   S.activeClass.id,
      schoolId:  S.activeClass.schoolId,
      date:      todayISO(),
      teacherId: S.user.user.id,
    });

    S.isDirty = false;
    const today = todayISO();

    if (result.synced) {
      // DB now owns this sheet — drop the local draft.
      clearLocalDraft(S.activeClass.id, today);
      toast('تم إرسال الكشف للمدير بنجاح', 'success');
      // Re-fetch the real status: the manager may have already acted on it.
      try {
        S.submission = await getClassSubmissionStatus(S.activeClass.id, today);
      } catch {
        S.submission = { status: 'pending' };
      }
    } else {
      // Offline: keep the sheet locally as 'pending' so reopening restores both
      // the marks and the "awaiting sync" state instead of falling back to defaults.
      saveLocalDraft(S.activeClass.id, today, S.attendance, 'pending');
      S.submission = { status: 'pending' };
      toast('حُفظ الكشف محلياً وسيُرسل عند توفر الاتصال', 'warning', 5000);
      refreshPendingBar();
    }

    closeConfirmModal();
    renderSubmissionBanners();

    // Footer: lock entirely if already confirmed, else allow correction + resend.
    if (S.submission?.status !== 'confirmed') {
      hide(btnSubmitAtt);
      show(btnSaveDraft);
    }

  } catch (err) {
    console.error('[Ruqi-T] submit error', err);
    toast(errMessage(err, 'حدث خطأ أثناء الإرسال'), 'error');
    closeConfirmModal();
  }
});

// ── Absence Log ───────────────────────────────────────────────────────────────
const modalAbslog        = $('modal-abslog');
const btnAbsenceLog      = $('btn-absence-log');
const btnAbslogClose     = $('btn-abslog-close');
const abslogClass        = $('abslog-class');
const abslogLoading      = $('abslog-loading');
const abslogEmpty        = $('abslog-empty');
const abslogBody         = $('abslog-body');
const abslogUnexcusedList  = $('abslog-unexcused-list');
const abslogExcusedList    = $('abslog-excused-list');
const abslogUnexcusedCount = $('abslog-unexcused-count');
const abslogExcusedCount   = $('abslog-excused-count');
const abslogUnexcusedEmpty = $('abslog-unexcused-empty');
const abslogExcusedEmpty   = $('abslog-excused-empty');

hide(modalAbslog);

function buildAbslogRow(stu, count) {
  const li = document.createElement('li');
  li.className = 'abslog-row';
  const seat = stu.seatNumber != null ? `<span class="abslog-seat">${escapeHtml(String(stu.seatNumber))}</span>` : '';
  li.innerHTML = `
    ${seat}
    <span class="abslog-name">${escapeHtml(stu.fullName ?? '—')}</span>
    <span class="abslog-count">${count} ${count === 1 ? 'مرة' : 'مرات'}</span>
  `;
  return li;
}

async function openAbsenceLog() {
  if (!S.activeClass) return;
  abslogClass.textContent = S.activeClass.displayName ?? '';
  abslogUnexcusedList.innerHTML = '';
  abslogExcusedList.innerHTML   = '';
  show(abslogLoading);
  hide(abslogBody);
  hide(abslogEmpty);
  show(modalAbslog);
  document.body.style.overflow = 'hidden';

  try {
    const rows = await getClassAbsenceLog(S.activeClass.id);
    hide(abslogLoading);

    const unexcused = rows.filter(r => r.absentCount  > 0);
    const excused   = rows.filter(r => r.excusedCount > 0);

    if (unexcused.length === 0 && excused.length === 0) {
      show(abslogEmpty);
      return;
    }

    abslogUnexcusedCount.textContent = unexcused.reduce((s, r) => s + r.absentCount, 0);
    abslogExcusedCount.textContent   = excused.reduce((s, r) => s + r.excusedCount, 0);

    if (unexcused.length === 0) {
      show(abslogUnexcusedEmpty);
    } else {
      hide(abslogUnexcusedEmpty);
      unexcused.forEach(r => abslogUnexcusedList.appendChild(buildAbslogRow(r, r.absentCount)));
    }

    if (excused.length === 0) {
      show(abslogExcusedEmpty);
    } else {
      hide(abslogExcusedEmpty);
      excused.forEach(r => abslogExcusedList.appendChild(buildAbslogRow(r, r.excusedCount)));
    }

    show(abslogBody);
  } catch (err) {
    console.error('[Ruqi-T] absence log', err);
    hide(abslogLoading);
    closeAbsenceLog();
    toast(errMessage(err, 'تعذّر تحميل سجل الغيابات.'), 'error');
  }
}

function closeAbsenceLog() {
  hide(modalAbslog);
  document.body.style.overflow = '';
}

btnAbsenceLog.addEventListener('click', openAbsenceLog);
btnAbslogClose.addEventListener('click', closeAbsenceLog);
modalAbslog.addEventListener('click', (e) => {
  if (e.target === modalAbslog) closeAbsenceLog();
});

// ═══════════════════════════════════════════════════════════════════════════
// Grades (الدرجات)
// ═══════════════════════════════════════════════════════════════════════════
const viewGrades        = $('view-grades');
const viewConduct       = $('view-conduct');
const modeAttBtn        = $('mode-att');
const modeGradesBtn     = $('mode-grades');
const modeConductBtn    = $('mode-conduct');
const modeTabs          = document.querySelector('.mode-tabs');
const homeSectionTitle  = $('home-section-title');
const btnGradesBack     = $('btn-grades-back');
const gradesClassName   = $('grades-class-name');
const gradesSubjectSel  = $('grades-subject');
const gradesSemesterSel = $('grades-semester');
const gradesLegend      = $('grades-legend');
const gradesReadonly    = $('grades-readonly');
const gradesLoading     = $('grades-loading');
const gradesFillWrap    = $('grades-fill-wrap');
const btnFillFull       = $('btn-fill-full');
const gradesList        = $('grades-list');
const gradesEmpty       = $('grades-empty');
const gradesEmptyText   = $('grades-empty-text');
const gradesNoSubjects  = $('grades-no-subjects');
const gradesFooter      = $('grades-footer');
const btnSaveGrades     = $('btn-save-grades');
const saveGradesLabel   = $('save-grades-label');
const saveGradesSpinner = $('save-grades-spinner');
const viewConductName   = $('conduct-class-name');
const btnConductBack    = $('btn-conduct-back');
const conductLoading    = $('conduct-loading');
const conductList       = $('conduct-list');
const conductEmpty      = $('conduct-empty');
const conductFooter     = $('conduct-footer');
const btnSaveConduct    = $('btn-save-conduct');
const saveConductLabel  = $('save-conduct-label');
const saveConductSpinner= $('save-conduct-spinner');

// ─── Custom Select (themed dropdown) ─────────────────────────────────────────
// Same component the school page uses, so the teacher pickers match the rest of
// the app instead of rendering the raw OS-native popup.
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
    const select = typeof selectOrId === 'string' ? $(selectOrId) : selectOrId;
    if (!select) return null;
    if (registry.has(select)) return registry.get(select);
    const inst = new Instance(select);
    registry.set(select, inst);
    return inst;
  }

  function refresh(selectOrId) {
    const select = typeof selectOrId === 'string' ? $(selectOrId) : selectOrId;
    const inst = select && registry.get(select);
    if (inst) inst.refresh();
  }

  return { enhance, refresh };
})();

// Theme both grade pickers (subject options are filled in later → refresh then).
CustomSelect.enhance(gradesSubjectSel);
CustomSelect.enhance(gradesSemesterSel);

// Home mode: 'att' (attendance) or 'grades'. Drives what a class card opens.
let homeMode = 'att';

// Grades view state
const G = {
  class:    null,   // active class (one of S.classes)
  students: [],
  subjects: [],     // [{ id, name, max_total, pass_mark, is_core_arabic, components:[{id,name,max_mark}] }]
  editableIds: [],  // subject ids this teacher may EDIT in this class (others are read-only)
  semester: 1,
  marks:    {},     // { [studentId]: { [componentId]: number|null } }
  dirty:    false,
};

// The teacher may edit only the subjects assigned to them in this class; the
// rest of the grade's subjects are shown read-only.
function canEditSubject(subjectId) {
  return G.editableIds.includes(subjectId);
}
function canEditCurrent() {
  const sub = currentSubject();
  return !!sub && canEditSubject(sub.id);
}

function setHomeMode(mode) {
  homeMode = mode;
  applyHomeMode();
}

// Reflect the current homeMode in the tab UI + re-render the filtered list.
function applyHomeMode() {
  const set = (btn, on) => {
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', String(on));
  };
  set(modeAttBtn,     homeMode === 'att');
  set(modeGradesBtn,  homeMode === 'grades');
  set(modeConductBtn, homeMode === 'conduct');
  homeSectionTitle.textContent =
    homeMode === 'grades'  ? 'اختر صفاً لإدخال الدرجات' :
    homeMode === 'conduct' ? 'اختر صفاً لإدخال السلوك'  : 'صفوفي اليوم';
  renderClassList();
}

modeAttBtn.addEventListener('click', () => setHomeMode('att'));
modeGradesBtn.addEventListener('click', () => setHomeMode('grades'));
modeConductBtn.addEventListener('click', () => setHomeMode('conduct'));

function currentSubject() {
  return G.subjects.find(s => s.id === gradesSubjectSel.value) ?? null;
}

// Map a Supabase error to a clear Arabic message. Permission errors (42501 /
// "permission denied for table") mean the grades tables haven't been granted to
// the app role yet — surface that instead of the raw English string.
function gradesErr(err, fallback) {
  if (err?.code === '42501' || /permission denied/i.test(err?.message || '')) {
    return 'لا تملك صلاحية الوصول إلى بيانات الدرجات على قاعدة البيانات (راجع إعداد الصلاحيات).';
  }
  return fallback;
}

async function openGradesView(cls) {
  G.class    = cls;
  G.subjects = [];
  G.marks    = {};
  G.dirty    = false;

  gradesClassName.textContent = cls.displayName;
  showView('grades');

  hide(gradesList);
  hide(gradesEmpty);
  hide(gradesNoSubjects);
  hide(gradesLegend);
  gradesReadonly.hidden = true;
  show(gradesFooter);
  show(gradesLoading);

  try {
    const [{ subjects }, students] = await Promise.all([
      getClassGradeSubjects(cls.id),
      getClassStudents(cls.id),
    ]);
    G.editableIds = Array.isArray(cls.subjectIds) ? cls.subjectIds : [];
    // Show the teacher's own subjects first so they land on an editable one.
    G.subjects = (subjects ?? []).slice().sort((a, b) =>
      (canEditSubject(b.id) ? 1 : 0) - (canEditSubject(a.id) ? 1 : 0));
    G.students = students ?? [];

    hide(gradesLoading);

    if (G.subjects.length === 0) {
      hide(gradesFooter);
      show(gradesNoSubjects);
      return;
    }
    if (G.students.length === 0) {
      hide(gradesFooter);
      gradesEmptyText.textContent = 'لا يوجد طلاب في هذا الصف.';
      show(gradesEmpty);
      return;
    }

    // Populate the subject dropdown (own subjects flagged).
    gradesSubjectSel.innerHTML = '';
    for (const sub of G.subjects) {
      const opt = document.createElement('option');
      opt.value = sub.id;
      opt.textContent = canEditSubject(sub.id) ? `${sub.name} — اختصاصك` : sub.name;
      gradesSubjectSel.appendChild(opt);
    }
    CustomSelect.refresh(gradesSubjectSel);
    gradesSemesterSel.value = String(G.semester);
    CustomSelect.refresh(gradesSemesterSel);

    await loadGradesForCurrent();
  } catch (err) {
    console.error('[Ruqi-T] openGradesView', err);
    hide(gradesLoading);
    hide(gradesFooter);
    gradesFillWrap.hidden = true;
    toast(gradesErr(err, 'تعذّر تحميل المواد'), 'error');
  }
}

async function loadGradesForCurrent() {
  const sub = currentSubject();
  if (!sub) return;
  G.semester = Number(gradesSemesterSel.value) || 1;
  G.marks    = {};
  G.dirty    = false;

  show(gradesLoading);
  hide(gradesList);
  gradesFillWrap.hidden = true;   // re-decided by renderGradeRows once loaded

  try {
    const existing = await getClassGrades(G.class.id, sub.id, G.semester);
    for (const stu of G.students) {
      const row = existing[stu.id] || {};
      G.marks[stu.id] = {};
      for (const comp of sub.components) {
        const v = row[comp.id];
        G.marks[stu.id][comp.id] = (v == null) ? null : Number(v);
      }
    }
  } catch (err) {
    console.error('[Ruqi-T] getClassGrades', err);
    toast(gradesErr(err, 'تعذّر تحميل الدرجات'), 'error');
    for (const stu of G.students) {
      G.marks[stu.id] = {};
      for (const comp of sub.components) G.marks[stu.id][comp.id] = null;
    }
  }

  hide(gradesLoading);
  const readOnly = !canEditSubject(sub.id);
  gradesReadonly.hidden = !readOnly;
  // No Save button when the subject isn't the teacher's own.
  if (readOnly) hide(gradesFooter); else show(gradesFooter);
  renderLegend(sub);
  renderGradeRows(sub, readOnly);
}

function renderLegend(sub) {
  if (!sub.components || sub.components.length === 0) {
    gradesLegend.innerHTML =
      '<span class="gl-chip">لم تُعرّف مكوّنات لهذه المادة — تواصل مع المدير</span>';
    show(gradesLegend);
    return;
  }
  // Per-component names now appear under each input box, so the legend only
  // shows the subject summary (total + pass threshold).
  gradesLegend.innerHTML =
    `<span class="gl-chip">المجموع من ${escapeHtml(String(sub.max_total))} · النجاح ≥ ${escapeHtml(String(sub.pass_mark))}٪</span>`;
  show(gradesLegend);
}

function renderGradeRows(sub, readOnly = false) {
  gradesList.innerHTML = '';
  if (!sub.components || sub.components.length === 0) {
    hide(gradesList);
    gradesFillWrap.hidden = true;
    return;
  }
  G.students.forEach((stu, i) => {
    gradesList.appendChild(buildGradeRow(stu, i + 1, sub, readOnly));
  });
  show(gradesList);
  // Bulk full-marks shortcut: only for subjects the admin flagged, and never in
  // the read-only view of another teacher's subject.
  gradesFillWrap.hidden = readOnly || !sub.allow_full_marks || G.students.length === 0;
}

// Fill every student's every component with its maximum. Values stay editable —
// the teacher adjusts the exceptions, then saves as usual.
function fillAllFullMarks() {
  const sub = currentSubject();
  if (!sub || !sub.allow_full_marks || !canEditCurrent()) return;

  for (const row of gradesList.querySelectorAll('.grade-row')) {
    const wrap = row.querySelector('.grade-inputs');
    if (!wrap) continue;
    const sid = wrap.dataset.sid;
    for (const input of wrap.querySelectorAll('.grade-input')) {
      const max = Number(input.max);
      if (!Number.isFinite(max)) continue;
      input.value = String(max);
      input.classList.remove('invalid');
      (G.marks[sid] ||= {})[input.dataset.cid] = max;
    }
    updateRowTotal(row, sid, sub);
  }
  G.dirty = true;
  toast('وُضعت العلامة الكاملة للجميع — يمكنك تعديل أي طالب قبل الحفظ', 'success');
}

btnFillFull.addEventListener('click', fillAllFullMarks);

function buildGradeRow(stu, num, sub, readOnly = false) {
  const li = document.createElement('li');
  li.className  = 'grade-row';
  li.dataset.id = stu.id;

  const inputs = sub.components.map(comp => {
    const v = G.marks[stu.id]?.[comp.id];
    return `<div class="grade-cell">
      <input class="grade-input" type="number" inputmode="decimal"
        min="0" max="${escapeHtml(String(comp.max_mark))}" step="0.5"
        data-cid="${escapeHtml(comp.id)}"
        ${readOnly ? 'disabled' : ''}
        aria-label="${escapeHtml(comp.name)} لـ ${escapeHtml(stu.full_name)}"
        value="${v == null ? '' : escapeHtml(String(v))}" />
      <span class="grade-cell-lbl">${escapeHtml(comp.name)}<span class="gcl-max">من ${escapeHtml(String(comp.max_mark))}</span></span>
    </div>`;
  }).join('');

  // زر اقتراح درجات مساعدة — يظهر للمعلّم في مادته للصفوف ٥ فأعلى فقط
  // (الصفوف ١–٤ لا تُطبَّق عليها المساعدة). الاقتراح يعتمده مدير المدرسة.
  const canPropose = !readOnly && Number(G.class?.grade) >= 5;
  const graceBtn = canPropose
    ? `<button type="button" class="btn btn-ghost btn-sm grace-propose" data-sid="${escapeHtml(stu.id)}"
         style="margin-top:6px">اقتراح درجات مساعدة</button>`
    : '';

  li.innerHTML = `
    <div class="grade-row-head">
      <span class="student-num">${num}</span>
      <span class="student-name">${escapeHtml(stu.full_name)}</span>
      <span class="grade-total" data-total-for="${escapeHtml(stu.id)}"></span>
    </div>
    <div class="grade-inputs" data-sid="${escapeHtml(stu.id)}">${inputs}</div>
    ${graceBtn}
  `;

  const gb = li.querySelector('.grace-propose');
  if (gb) gb.addEventListener('click', () => openProposeGrace(stu, sub));

  // Initial total
  setTimeout(() => updateRowTotal(li, stu.id, sub), 0);
  return li;
}

// ── اقتراح درجات مساعدة ───────────────────────────────────────────────────────
// لطالب في مادة المعلّم (لا يؤثّر على النتيجة حتى يعتمده مدير المدرسة).
// نافذة واحدة داخل التطبيق تجمع الدرجة والسبب — كانت prompt() مرّتين متتاليتين.
const modalGrace       = $('modal-grace');
const graceModalSub    = $('grace-modal-sub');
const graceMarksIn     = $('grace-marks');
const graceReasonIn    = $('grace-reason');
const graceModalError  = $('grace-modal-error');
const btnGraceCancel   = $('btn-grace-cancel');
const btnGraceSend     = $('btn-grace-send');
const graceSendLabel   = $('grace-send-label');
const graceSendSpinner = $('grace-send-spinner');

// The student/subject the open sheet is about; null when closed.
let _graceCtx = null;

function openProposeGrace(stu, sub) {
  _graceCtx = { stu, sub };
  graceModalSub.textContent = `${stu.full_name} — ${sub.name}`;
  // Blank both fields on every open: the sheet is reused, so a value left from
  // the previous student would otherwise be pre-filled here.
  graceMarksIn.value  = '';
  graceReasonIn.value = '';
  hide(graceModalError);
  setGraceBusy(false);
  show(modalGrace);
  modalGrace.querySelector('.confirm-modal-sheet').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  graceMarksIn.focus();
}

function closeProposeGrace() {
  hide(modalGrace);
  document.body.style.overflow = '';
  _graceCtx = null;
}

function setGraceBusy(busy) {
  btnGraceSend.disabled     = busy;
  btnGraceCancel.disabled   = busy;
  graceSendLabel.hidden     = busy;
  graceSendSpinner.hidden   = !busy;
}

function graceError(msg) {
  graceModalError.textContent = msg;
  show(graceModalError);
}

btnGraceCancel.addEventListener('click', closeProposeGrace);
modalGrace.addEventListener('click', (e) => {
  if (e.target === modalGrace && !btnGraceSend.disabled) closeProposeGrace();
});

// Escape closes whichever in-app dialog is open (topmost first).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!modalGrace.hidden) { if (!btnGraceSend.disabled) closeProposeGrace(); return; }
  if (!modalAsk.hidden)   { settleAsk(false); return; }
});

btnGraceSend.addEventListener('click', async () => {
  if (!_graceCtx) return;
  const { stu, sub } = _graceCtx;

  const marks = Number(graceMarksIn.value.trim());
  if (!Number.isInteger(marks) || marks < 1 || marks > 10) {
    graceError('أدخل عدداً صحيحاً بين ١ و١٠');
    graceMarksIn.focus();
    return;
  }

  hide(graceModalError);
  setGraceBusy(true);
  try {
    await proposeGrace({
      studentId: stu.id,
      classId:   G.class.id,
      schoolId:  G.class.schoolId ?? S.user?.schoolId ?? null,
      subjectId: sub.id,
      marks,
      reason:    graceReasonIn.value.trim(),
    });
    closeProposeGrace();
    toast('أُرسل الاقتراح لمدير المدرسة', 'success');
  } catch (err) {
    console.error('[Ruqi] proposeGrace', err);
    setGraceBusy(false);
    graceError(errMessage(err, 'تعذّر إرسال الاقتراح'));
  }
});

function rowTotal(sid, sub) {
  let sum = 0, any = false;
  for (const comp of sub.components) {
    const v = G.marks[sid]?.[comp.id];
    if (v != null && Number.isFinite(v)) { sum += v; any = true; }
  }
  return { sum, any };
}

function updateRowTotal(row, sid, sub) {
  const el = row.querySelector(`[data-total-for="${CSS.escape(sid)}"]`);
  if (!el) return;
  const { sum, any } = rowTotal(sid, sub);
  if (!any) { el.textContent = '—'; el.classList.remove('fail'); return; }
  const maxTotal = Number(sub.max_total) || 100;
  const pct      = (sum / maxTotal) * 100;
  el.textContent = String(Math.round(sum * 100) / 100);
  el.classList.toggle('fail', pct < Number(sub.pass_mark));
}

// Input delegation: validate against the component max + keep state + live total.
gradesList.addEventListener('input', (e) => {
  const input = e.target.closest('.grade-input');
  if (!input) return;
  const wrap = input.closest('.grade-inputs');
  const row  = input.closest('.grade-row');
  const sid  = wrap.dataset.sid;
  const cid  = input.dataset.cid;
  const sub  = currentSubject();
  if (!sub) return;

  const raw = input.value.trim();
  const max = Number(input.max);
  if (raw === '') {
    G.marks[sid][cid] = null;
    input.classList.remove('invalid');
  } else {
    const n = Number(raw);
    const valid = Number.isFinite(n) && n >= 0 && n <= max;
    input.classList.toggle('invalid', !valid);
    G.marks[sid][cid] = valid ? n : null;
  }
  G.dirty = true;
  updateRowTotal(row, sid, sub);
});

// Subject / semester switching (warn on unsaved edits).
async function switchGradeContext() {
  if (G.dirty && !(await askConfirm('يوجد درجات غير محفوظة. هل تريد المتابعة وتجاهلها؟', 'تجاهل ومتابعة'))) {
    // revert the select to the loaded context
    gradesSemesterSel.value = String(G.semester);
    CustomSelect.refresh(gradesSemesterSel);
    return;
  }
  await loadGradesForCurrent();
}
gradesSubjectSel.addEventListener('change', switchGradeContext);
gradesSemesterSel.addEventListener('change', switchGradeContext);

// Save
btnSaveGrades.addEventListener('click', async () => {
  const sub = currentSubject();
  if (!sub) return;
  // Guard: can't save a subject that isn't the teacher's own (RLS also blocks it).
  if (!canEditCurrent()) {
    toast('لا يمكنك تعديل علامات مادة ليست من اختصاصك.', 'error');
    return;
  }

  if (gradesList.querySelector('.grade-input.invalid')) {
    toast('توجد درجات غير صالحة (تتجاوز الحد الأقصى) — يرجى تصحيحها', 'error');
    return;
  }

  const records = [];
  for (const stu of G.students) {
    for (const comp of sub.components) {
      const v = G.marks[stu.id]?.[comp.id];
      if (v != null && Number.isFinite(v)) {
        records.push({ studentId: stu.id, componentId: comp.id, mark: v });
      }
    }
  }

  if (records.length === 0) {
    toast('لم تُدخل أي درجات بعد', 'warning');
    return;
  }

  btnSaveGrades.disabled   = true;
  saveGradesLabel.hidden   = true;
  saveGradesSpinner.hidden = false;

  try {
    const result = await saveStudentGrades({
      records,
      classId:   G.class.id,
      schoolId:  G.class.schoolId,
      subjectId: sub.id,
      semester:  G.semester,
      teacherId: S.user.user.id,
    });
    G.dirty = false;
    if (result.synced) {
      toast('تم حفظ الدرجات بنجاح', 'success');
    } else {
      toast('حُفظت الدرجات محلياً وستُرسل عند توفر الاتصال', 'warning', 5000);
      refreshPendingBar();
    }
  } catch (err) {
    console.error('[Ruqi-T] saveStudentGrades', err);
    toast(gradesErr(err, 'تعذّر حفظ الدرجات'), 'error');
  } finally {
    btnSaveGrades.disabled   = false;
    saveGradesLabel.hidden   = false;
    saveGradesSpinner.hidden = true;
  }
});

btnGradesBack.addEventListener('click', async () => {
  if (G.dirty && !(await askConfirm('يوجد درجات غير محفوظة. هل تريد الخروج وتجاهلها؟', 'خروج وتجاهل'))) return;
  G.class = null; G.students = []; G.subjects = []; G.marks = {}; G.dirty = false;
  showView('home');
});

// ── Conduct (السلوك) entry ─────────────────────────────────────────────────────
const C = { class: null, students: [], marks: {}, dirty: false };

async function openConductView(cls) {
  C.class = cls; C.students = []; C.marks = {}; C.dirty = false;
  viewConductName.textContent = cls.displayName;
  showView('conduct');
  hide(conductList); hide(conductEmpty); show(conductFooter); show(conductLoading);
  try {
    const [students, existing] = await Promise.all([
      getClassStudents(cls.id),
      getClassConduct(cls.id).catch(() => ({})),
    ]);
    C.students = students ?? [];
    hide(conductLoading);
    if (C.students.length === 0) { hide(conductFooter); show(conductEmpty); return; }
    conductList.innerHTML = '';
    C.students.forEach((stu, i) => {
      const v = existing[stu.id];
      C.marks[stu.id] = (v == null) ? null : Number(v);
      conductList.appendChild(buildConductRow(stu, i + 1));
    });
    show(conductList);
  } catch (err) {
    console.error('[Ruqi-T] openConductView', err);
    hide(conductLoading); hide(conductFooter);
    toast(errMessage(err, 'تعذّر تحميل قائمة الطلاب.'), 'error');
  }
}

function buildConductRow(stu, num) {
  const li = document.createElement('li');
  li.className = 'grade-row';
  const v = C.marks[stu.id];
  li.innerHTML = `
    <div class="grade-row-head">
      <span class="student-num">${num}</span>
      <span class="student-name">${escapeHtml(stu.full_name)}</span>
    </div>
    <div class="grade-inputs" data-sid="${escapeHtml(stu.id)}">
      <div class="grade-cell">
        <input class="grade-input conduct-input" type="number" inputmode="numeric"
          min="0" max="100" step="1" data-sid="${escapeHtml(stu.id)}"
          aria-label="درجة سلوك ${escapeHtml(stu.full_name)}"
          value="${v == null ? '' : escapeHtml(String(v))}" />
        <span class="grade-cell-lbl">من ١٠٠</span>
      </div>
    </div>
  `;
  return li;
}

conductList.addEventListener('input', (e) => {
  const input = e.target.closest('.conduct-input');
  if (!input) return;
  const sid = input.dataset.sid;
  const raw = input.value.trim();
  if (raw === '') { C.marks[sid] = null; input.classList.remove('invalid'); }
  else {
    const n = Number(raw);
    const valid = Number.isFinite(n) && n >= 0 && n <= 100;
    input.classList.toggle('invalid', !valid);
    C.marks[sid] = valid ? n : null;
  }
  C.dirty = true;
});

btnSaveConduct.addEventListener('click', async () => {
  if (!C.class) return;
  const records = C.students
    .filter(stu => C.marks[stu.id] != null)
    .map(stu => ({ studentId: stu.id, mark: C.marks[stu.id] }));
  if (records.length === 0) { toast('أدخل درجة سلوك واحدة على الأقل', 'warning'); return; }

  btnSaveConduct.disabled = true;
  saveConductLabel.hidden = true;
  saveConductSpinner.hidden = false;
  try {
    const res = await saveStudentConduct({
      records, classId: C.class.id, schoolId: C.class.schoolId, teacherId: S.user.user.id,
    });
    C.dirty = false;
    toast(res.synced ? 'تم حفظ السلوك' : 'حُفظ محلياً وسيُرسل عند الاتصال', 'success');
  } catch (err) {
    console.error('[Ruqi-T] saveStudentConduct', err);
    toast('تعذّر حفظ السلوك', 'error');
  } finally {
    btnSaveConduct.disabled = false;
    saveConductLabel.hidden = false;
    saveConductSpinner.hidden = true;
  }
});

btnConductBack.addEventListener('click', async () => {
  if (C.dirty && !(await askConfirm('يوجد درجات سلوك غير محفوظة. هل تريد الخروج وتجاهلها؟', 'خروج وتجاهل'))) return;
  C.class = null; C.students = []; C.marks = {}; C.dirty = false;
  showView('home');
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
// ── Notifications (teacher) ───────────────────────────────────────────────────
let _unsubNotifT  = null;
let _unreadCountT = 0;

function updateNotifBadgeT(n) {
  _unreadCountT = n;
  const badge = $('notif-badge');
  if (!badge) return;
  badge.textContent = n > 0 ? String(Math.min(n, 99)) : '';
  badge.hidden = n <= 0;
}

async function loadNotifListT() {
  const notifList = $('notif-list');
  if (!notifList) return;
  try {
    const items = await window.RUQI_DB.getNotifications(30);
    if (!items.length) { notifList.innerHTML = '<li class="notif-empty">لا توجد إشعارات</li>'; return; }
    notifList.innerHTML = items.map(n => {
      const diff = Date.now() - new Date(n.created_at).getTime();
      const m = Math.floor(diff / 60000);
      const ago = m < 1 ? 'الآن' : m < 60 ? `منذ ${m} دقيقة` : m < 1440 ? `منذ ${Math.floor(m/60)} ساعة` : `منذ ${Math.floor(m/1440)} يوم`;
      const unread = !n.read_at ? ' notif-item--unread' : '';
      // Titles/bodies are server-composed from user-entered names — escape them.
      return `<li class="notif-item${unread}">
        <div class="notif-item-title">${escapeHtml(n.title)}</div>
        ${n.body ? `<div class="notif-item-body">${escapeHtml(n.body)}</div>` : ''}
        <div class="notif-item-time">${ago}</div>
      </li>`;
    }).join('');
  } catch (e) { console.warn('[Ruqi-T] loadNotifList', e); }
}

function initNotificationsTeacher(userId) {
  const btnNotif   = $('btn-notif');
  const modalNotif = $('modal-notif');

  if (btnNotif)   btnNotif.addEventListener('click', () => { if (modalNotif) modalNotif.hidden = false; loadNotifListT(); });
  if ($('btn-notif-close'))  $('btn-notif-close').addEventListener('click',  () => { if (modalNotif) modalNotif.hidden = true; });
  if (modalNotif) modalNotif.addEventListener('click', (e) => { if (e.target === modalNotif) modalNotif.hidden = true; });
  if ($('btn-notif-read-all')) $('btn-notif-read-all').addEventListener('click', async () => {
    await window.RUQI_DB.markAllNotificationsRead().catch(() => {});
    updateNotifBadgeT(0);
    loadNotifListT();
  });

  window.RUQI_DB.getUnreadNotificationsCount().then(updateNotifBadgeT).catch(() => {});

  if (_unsubNotifT) _unsubNotifT();
  _unsubNotifT = window.RUQI_DB.subscribeNotifications(userId, (notif) => {
    updateNotifBadgeT(_unreadCountT + 1);
    toast(notif.title, 'info', 5000);
    if (Notification.permission === 'granted') {
      new Notification(notif.title, { body: notif.body ?? '', dir: 'rtl', lang: 'ar' });
    }
    if (notif.type === 'duty_adjusted') loadDutyCard().catch(() => {});
  });

  // Web Push: طلب تفعيل ضمن إيماءة مستخدم (يشترك بصمت إن كان الإذن ممنوحاً)
  window.RUQI_DB.initPushPrompt();
}

async function bootstrap() {
  showBootSplash();
  try {
    const session = await getCurrentUser();
    if (session && session.role === 'teacher') {
      S.user = session;
      await initApp();
      return;
    }
    // ⚠️ جلسة بدور خاطئ تُسجَّل خروجاً لا تُترك: تركها في التخزين يعني أنّ
    // فتح هذه البوابة لاحقاً يُعيد المحاولة نفسها إلى الأبد، وأنّ حساب بوابة
    // أخرى يبقى حيّاً على الجهاز بعد أن ظنّ صاحبه أنه غادر.
    if (session) { try { await logout(); } catch { /* ignore */ } }
  } catch (err) {
    console.warn('[Ruqi-T] bootstrap session check failed', err);
  } finally {
    removeBootSplash();  // شبكة أمان: fall-through يستدعي showScreen('login') الذي يرفعه أصلاً
  }
  showScreen('login');
}

bootstrap();