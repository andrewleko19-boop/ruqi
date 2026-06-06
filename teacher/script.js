// teacher/script.js
// Loaded as <script type="module"> after shared/db.js

// ── Guard ─────────────────────────────────────────────────────────────────────
if (!window.NSAMS_DB) {
  document.body.innerHTML =
    '<p style="padding:24px;color:#EF4444;font-family:sans-serif;direction:rtl">' +
    'خطأ: تعذّر تحميل طبقة البيانات. تأكد من تضمين shared/db.js قبل هذا الملف.</p>';
  throw new Error('window.NSAMS_DB is not defined');
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
} = window.NSAMS_DB;

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

// Attendance view
const attClassName   = $('att-class-name');
const attDate        = $('att-date');
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
  screenLogin.hidden = name !== 'login';
  screenApp.hidden   = name !== 'app';
}

function showView(name) {
  viewHome.hidden   = name !== 'home';
  viewAtt.hidden    = name !== 'att';
  if (viewGrades) viewGrades.hidden = name !== 'grades';
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
                 + (result.grades?.synced     ?? 0);
    if (total > 0) toast(`تمت مزامنة ${total} سجل بنجاح`, 'success');
    refreshPendingBar();
  } catch (err) {
    console.warn('[NSAMS-T] sync error', err);
    toast('تعذّرت المزامنة', 'error');
  } finally {
    syncIcon.classList.remove('syncing');
    syncing = false;
  }
}

btnSync.addEventListener('click', doSync);
btnSyncBar.addEventListener('click', doSync);

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
    console.error('[NSAMS-T] login error', err);
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
  btnLogin.disabled    = busy;
  btnLoginLabel.hidden = busy;
  loginSpinner.hidden  = !busy;
}

// ── Logout ────────────────────────────────────────────────────────────────────
btnLogout.addEventListener('click', async () => {
  if (S.isDirty && !confirm('يوجد تغييرات غير محفوظة. هل تريد الخروج؟')) return;
  if (!S.isDirty && !confirm('هل تريد تسجيل الخروج؟')) return;
  try { await logout(); } catch { /* ignore */ }
  S.user        = null;
  S.classes     = [];
  S.activeClass = null;
  S.students    = [];
  S.attendance  = {};
  S.submission  = null;
  S.isDirty     = false;
  showScreen('login');
});

// ── App Init ──────────────────────────────────────────────────────────────────
async function initApp() {
  showScreen('app');
  showView('home');

  hdrTeacherName.textContent = S.user?.user?.fullName ?? 'المعلم';
  hdrDate.textContent        = formatDateAr(todayISO());

  updateConnUI();
  await loadClasses();
  await doSync();
}

// ── Load Classes ──────────────────────────────────────────────────────────────
async function loadClasses() {
  show(classesLoading);
  hide(classesList);
  hide(classesEmpty);

  try {
    S.classes = await getTeacherClasses(S.user.user.id);
  } catch (err) {
    console.error('[NSAMS-T] getTeacherClasses', err);
    toast('تعذّر تحميل قائمة الصفوف', 'error');
    S.classes = [];
  }

  hide(classesLoading);

  if (S.classes.length === 0) {
    show(classesEmpty);
    return;
  }

  // Fetch submission status for each class (best-effort, parallel)
  const today = todayISO();
  const statuses = await Promise.allSettled(
    S.classes.map(c => getClassSubmissionStatus(c.id, today))
  );

  show(classesList);
  classesList.innerHTML = '';
  S.classes.forEach((cls, i) => {
    const sub = statuses[i].status === 'fulfilled' ? statuses[i].value : null;
    classesList.appendChild(buildClassCard(cls, sub));
  });
}

// ── Class Card ────────────────────────────────────────────────────────────────
function buildClassCard(cls, submission) {
  const card = document.createElement('button');
  card.className   = 'class-card';
  card.setAttribute('aria-label', `فتح ${cls.displayName}`);

  const { badgeClass, badgeText } = submissionBadge(submission);

  card.innerHTML = `
    <div class="class-icon">
      <span>${cls.grade}</span>
    </div>
    <div class="class-info">
      <div class="class-name">${escapeHtml(cls.displayName)}</div>
      <div class="class-meta">${escapeHtml(cls.schoolName)}</div>
    </div>
    <div class="class-status">
      <span class="status-badge ${badgeClass}">${badgeText}</span>
    </div>
  `;

  card.addEventListener('click', () => {
    if (homeMode === 'grades') openGradesView(cls);
    else                       openAttendanceView(cls);
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
  attDate.textContent      = formatDateAr(todayISO());

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
    console.error('[NSAMS-T] openAttendanceView', err);
    toast(err?.message ?? 'تعذّر تحميل بيانات الصف', 'error');
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

  S.students.forEach((stu, idx) => {
    const rec    = S.attendance[stu.id] ?? { status: DEFAULT_STATUS, reason: null };
    const li     = buildStudentRow(stu, idx + 1, rec);
    studentsList.appendChild(li);
  });

  show(studentsList);
}

function buildStudentRow(stu, num, rec) {
  const li = document.createElement('li');
  li.className    = 'student-row';
  li.dataset.id   = stu.id;
  li.dataset.status = rec.status;
  li.setAttribute('role', 'listitem');

  const showReason = rec.reason && REASON_STATUSES.has(rec.status);

  li.innerHTML = `
    <span class="student-num">${num}</span>
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
  const stu = S.students.find(s => s.id === sid);
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
    console.error('[NSAMS-T] submit error', err);
    toast(err?.message ?? 'حدث خطأ أثناء الإرسال', 'error');
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
    console.error('[NSAMS-T] absence log', err);
    hide(abslogLoading);
    closeAbsenceLog();
    toast('تعذّر تحميل سجل الغيابات', 'error');
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
const modeAttBtn        = $('mode-att');
const modeGradesBtn     = $('mode-grades');
const homeSectionTitle  = $('home-section-title');
const btnGradesBack     = $('btn-grades-back');
const gradesClassName   = $('grades-class-name');
const gradesSubjectSel  = $('grades-subject');
const gradesSemesterSel = $('grades-semester');
const gradesLegend      = $('grades-legend');
const gradesLoading     = $('grades-loading');
const gradesList        = $('grades-list');
const gradesEmpty       = $('grades-empty');
const gradesEmptyText   = $('grades-empty-text');
const gradesNoSubjects  = $('grades-no-subjects');
const gradesFooter      = $('grades-footer');
const btnSaveGrades     = $('btn-save-grades');
const saveGradesLabel   = $('save-grades-label');
const saveGradesSpinner = $('save-grades-spinner');

// Home mode: 'att' (attendance) or 'grades'. Drives what a class card opens.
let homeMode = 'att';

// Grades view state
const G = {
  class:    null,   // active class (one of S.classes)
  students: [],
  subjects: [],     // [{ id, name, max_total, pass_mark, is_core_arabic, components:[{id,name,max_mark}] }]
  semester: 1,
  marks:    {},     // { [studentId]: { [componentId]: number|null } }
  dirty:    false,
};

function setHomeMode(mode) {
  homeMode = mode;
  const grading = mode === 'grades';
  modeAttBtn.classList.toggle('is-active', !grading);
  modeGradesBtn.classList.toggle('is-active', grading);
  modeAttBtn.setAttribute('aria-selected', String(!grading));
  modeGradesBtn.setAttribute('aria-selected', String(grading));
  homeSectionTitle.textContent = grading ? 'اختر صفاً لإدخال الدرجات' : 'صفوفي اليوم';
}

modeAttBtn.addEventListener('click', () => setHomeMode('att'));
modeGradesBtn.addEventListener('click', () => setHomeMode('grades'));

function currentSubject() {
  return G.subjects.find(s => s.id === gradesSubjectSel.value) ?? null;
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
  show(gradesFooter);
  show(gradesLoading);

  try {
    const [{ subjects }, students] = await Promise.all([
      getClassGradeSubjects(cls.id),
      getClassStudents(cls.id),
    ]);
    G.subjects = subjects ?? [];
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

    // Populate the subject dropdown.
    gradesSubjectSel.innerHTML = '';
    for (const sub of G.subjects) {
      const opt = document.createElement('option');
      opt.value = sub.id;
      opt.textContent = sub.name;
      gradesSubjectSel.appendChild(opt);
    }
    gradesSemesterSel.value = String(G.semester);

    await loadGradesForCurrent();
  } catch (err) {
    console.error('[NSAMS-T] openGradesView', err);
    hide(gradesLoading);
    hide(gradesFooter);
    toast(err?.message ?? 'تعذّر تحميل المواد', 'error');
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
    console.error('[NSAMS-T] getClassGrades', err);
    toast(err?.message ?? 'تعذّر تحميل الدرجات', 'error');
    for (const stu of G.students) {
      G.marks[stu.id] = {};
      for (const comp of sub.components) G.marks[stu.id][comp.id] = null;
    }
  }

  hide(gradesLoading);
  renderLegend(sub);
  renderGradeRows(sub);
}

function renderLegend(sub) {
  if (!sub.components || sub.components.length === 0) {
    gradesLegend.innerHTML =
      '<span class="gl-chip">لم تُعرّف مكوّنات لهذه المادة — تواصل مع المدير</span>';
    show(gradesLegend);
    return;
  }
  gradesLegend.innerHTML = sub.components
    .map(c => `<span class="gl-chip">${escapeHtml(c.name)} (من ${escapeHtml(String(c.max_mark))})</span>`)
    .join('') +
    `<span class="gl-chip">المجموع من ${escapeHtml(String(sub.max_total))} · النجاح ≥ ${escapeHtml(String(sub.pass_mark))}٪</span>`;
  show(gradesLegend);
}

function renderGradeRows(sub) {
  gradesList.innerHTML = '';
  if (!sub.components || sub.components.length === 0) {
    hide(gradesList);
    return;
  }
  G.students.forEach((stu, i) => {
    gradesList.appendChild(buildGradeRow(stu, i + 1, sub));
  });
  show(gradesList);
}

function buildGradeRow(stu, num, sub) {
  const li = document.createElement('li');
  li.className  = 'grade-row';
  li.dataset.id = stu.id;

  const inputs = sub.components.map(comp => {
    const v = G.marks[stu.id]?.[comp.id];
    return `<input class="grade-input" type="number" inputmode="decimal"
      min="0" max="${escapeHtml(String(comp.max_mark))}" step="0.5"
      data-cid="${escapeHtml(comp.id)}"
      aria-label="${escapeHtml(comp.name)} لـ ${escapeHtml(stu.full_name)}"
      value="${v == null ? '' : escapeHtml(String(v))}" />`;
  }).join('');

  li.innerHTML = `
    <span class="student-num">${num}</span>
    <div class="student-name-wrap">
      <div class="student-name">${escapeHtml(stu.full_name)}</div>
    </div>
    <div class="grade-inputs" data-sid="${escapeHtml(stu.id)}">${inputs}</div>
    <span class="grade-total" data-total-for="${escapeHtml(stu.id)}"></span>
  `;

  // Initial total
  setTimeout(() => updateRowTotal(li, stu.id, sub), 0);
  return li;
}

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
  if (G.dirty && !confirm('يوجد درجات غير محفوظة. هل تريد المتابعة وتجاهلها؟')) {
    // revert the select to the loaded context
    gradesSemesterSel.value = String(G.semester);
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
    console.error('[NSAMS-T] saveStudentGrades', err);
    toast(err?.message ?? 'تعذّر حفظ الدرجات', 'error');
  } finally {
    btnSaveGrades.disabled   = false;
    saveGradesLabel.hidden   = false;
    saveGradesSpinner.hidden = true;
  }
});

btnGradesBack.addEventListener('click', () => {
  if (G.dirty && !confirm('يوجد درجات غير محفوظة. هل تريد الخروج وتجاهلها؟')) return;
  G.class = null; G.students = []; G.subjects = []; G.marks = {}; G.dirty = false;
  showView('home');
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    const session = await getCurrentUser();
    if (session && session.role === 'teacher') {
      S.user = session;
      await initApp();
      return;
    }
  } catch (err) {
    console.warn('[NSAMS-T] bootstrap session check failed', err);
  }
  showScreen('login');
}

bootstrap();