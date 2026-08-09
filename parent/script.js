// ── Guard ─────────────────────────────────────────────────────────────────
if (!window.RUQI_DB) {
  document.body.innerHTML = '<p style="padding:2rem;text-align:center;color:red">تعذَّر تحميل shared/db.js</p>';
  throw new Error('RUQI_DB not loaded');
}

const {
  parentRequestOtp,
  parentVerifyOtp,
  parentLogout,
  parentRestoreSession,
  parentGetMyStudents,
  parentGetStudentAttendance,
  parentGetStudentAttendanceYear,
  parentGetStudentGrades,
  parentGetHolidays,
  parentGetAbsenceExcuses,
  parentSubmitAbsenceExcuse,
  parentUploadExcusePhoto,
  getAcademicYear,
  registerPushSubscription,
  escapeHtml,
  errMessage,
  withTimeout,
  isOnline,
} = window.RUQI_DB;

// ── مخبأ محلّي ────────────────────────────────────────────────────────────
// بوّابة ولي الأمر كانت الوحيدة بلا أيّ مخبأ: كلّ شاشة تتطلّب شبكة حيّة، فتظهر
// فارغةً في المدرسة/المواصلات حيث التغطية ضعيفة. المفاتيح كلّها ضمن
// TENANT_CACHE_PREFIXES في db.js فتُمحى عند الخروج (هاتف العائلة مشترَك).
const CACHE_TTL_MS = 6000;   // مهلة القراءة قبل السقوط للمخبأ

function cacheRead(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function cacheWrite(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch { /* حصة التخزين ممتلئة — غير قاتل */ }
}

/* اقرأ من الشبكة بمهلة، واسقُط للمخبأ عند الفشل أو انعدام الاتصال.
   يعيد { data, fromCache } — الواجهة تحتاج تمييزهما لتعرض شريط «بيانات محفوظة». */
async function readCached(key, fetcher, fallback = []) {
  if (!isOnline()) {
    const hit = cacheRead(key);
    return { data: hit ?? fallback, fromCache: hit !== null };
  }
  try {
    const data = await withTimeout(fetcher(), CACHE_TTL_MS);
    cacheWrite(key, data);
    return { data, fromCache: false };
  } catch (err) {
    const hit = cacheRead(key);
    if (hit !== null) return { data: hit, fromCache: true };
    throw err;
  }
}

// ── State ─────────────────────────────────────────────────────────────────
const S = {
  phone: '',
  students: [],
  activeIdx: 0,
  activeStudent: null,
  viewMonth: new Date(),
  attendance: [],     // current month attendance records
  grades: { s1: [], s2: [] },
  allGrades: [],
  holidays: [],
  excuses: [],
  excuseDate: null,   // date being excused (YYYY-MM-DD)
  dayModalDate: null, // اليوم المعروض في بطاقة التفاصيل
  excusePhotoDataUri: null,
  activeSemester: 1,
  activeView: 'att',
  userId: null,       // معرّف الوليّ — يدخل في مفاتيح المخبأ (هاتف العائلة مشترَك)
};

// ── DOM Refs ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Screens
const scrLogin  = $('screen-login');
const scrOtp    = $('screen-otp');
const scrApp    = $('screen-app');

// Login
const formPhone   = $('form-phone');
const inpPhone    = $('inp-phone');
const phoneErr    = $('phone-err');
const btnSendOtp  = $('btn-send-otp');
const spinPhone   = $('spin-phone');

// OTP
const formOtp     = $('form-otp');
const otpGrid     = $('otp-grid');
const otpCells    = Array.from(otpGrid.querySelectorAll('.otp-cell'));
const otpErr      = $('otp-err');
const btnVerify   = $('btn-verify-otp');
const spinOtp     = $('spin-otp');
const otpCountdown = $('otp-countdown');
const btnResend   = $('btn-resend-otp');
const btnBackPhone = $('btn-back-phone');
const otpPhoneDisplay = $('otp-phone-display');

// App
const childrenBar   = $('children-bar');
const childrenPills = $('children-pills');
const mainLoading   = $('main-loading');
const noStudents    = $('no-students');
const portalDisabled= $('portal-disabled');
const bottomNav     = $('bottom-nav');
const btnLogout     = $('btn-logout');

// Views
const viewAtt      = $('view-att');
const viewGrades   = $('view-grades');
const viewCalendar = $('view-calendar');
const viewMore     = $('view-more');
const allViews     = [viewAtt, viewGrades, viewCalendar, viewMore];

// Student summary card
const stuCard      = $('stu-card');
const stuAvatar    = $('stu-avatar');
const stuName      = $('stu-name');
const stuMeta      = $('stu-meta');
const stuAttPct    = $('stu-att-pct');
const stuAbsTotal  = $('stu-abs-total');
const stuExcTotal  = $('stu-exc-total');
const stuWarn      = $('stu-warn');
const stuWarnText  = $('stu-warn-text');
const stuWarnCount = $('stu-warn-count');
const stuWarnFill  = $('stu-warn-fill');

// Attendance
const monthCalendar = $('month-calendar');
const monthTitle    = $('month-title');
const btnPrevMonth  = $('btn-prev-month');
const btnNextMonth  = $('btn-next-month');
const attSummary    = $('att-summary');
const sumPresent    = $('sum-present');
const sumAbsent     = $('sum-absent');
const sumExcused    = $('sum-excused');
const sumLate       = $('sum-late');

// Grades
const tabS1         = $('tab-s1');
const tabS2         = $('tab-s2');
const gradesLoading = $('grades-loading');
const gradesEmpty   = $('grades-empty');
const gradesTable   = $('grades-table');
const gradesTbody   = $('grades-tbody');
const totalMax      = $('total-max');
const totalPct      = $('total-pct');

// Calendar
const holidaysLoading = $('holidays-loading');
const holidaysEmpty   = $('holidays-empty');
const holidaysList    = $('holidays-list');

// More
const schoolNameDisplay   = $('school-name-display');
const schoolPhoneRow      = $('school-phone-row');
const schoolPhoneLink     = $('school-phone-link');
const excusesEmpty        = $('excuses-empty');
const excusesList         = $('excuses-list');
const btnNewExcuseMore    = $('btn-new-excuse-more');
const excuseDatePickerWrap = $('excuse-date-picker-wrap');
const inpExcuseDate       = $('inp-excuse-date');

// Logout Confirm Modal
const modalConfirmLogout     = $('modal-confirm-logout');
const btnConfirmLogoutOk     = $('btn-confirm-logout-ok');
const btnConfirmLogoutCancel = $('btn-confirm-logout-cancel');

// Day Detail Modal
const modalDay      = $('modal-day');
const dayDateLabel  = $('day-date-label');
const dayBadge      = $('day-badge');
const dayRows       = $('day-rows');
const btnDayClose   = $('btn-day-close');
const btnDayExcuse  = $('btn-day-excuse');

// Excuse Modal
const modalExcuse      = $('modal-excuse');
const formExcuse       = $('form-excuse');
const excuseDateLabel  = $('excuse-date-label');
const excuseReason     = $('excuse-reason');
const excuseReasonErr  = $('excuse-reason-err');
const excuseSubmitErr  = $('excuse-submit-err');
const btnExcuseCancel  = $('btn-excuse-cancel');
const btnExcuseSubmit  = $('btn-excuse-submit');
const spinExcuse       = $('spin-excuse');
const photoUploadArea  = $('photo-upload-area');
const photoPlaceholder = $('photo-placeholder');
const photoPreview     = $('photo-preview');
const photoRemoveBtn   = $('photo-remove-btn');
const inputCamera      = $('input-camera');
const inputGallery     = $('input-gallery');

// Photo source modal
const modalPhotoSource     = $('modal-photo-source');
const btnUseCamera         = $('btn-use-camera');
const btnUseGallery        = $('btn-use-gallery');
const btnPhotoSourceCancel = $('btn-photo-source-cancel');

// Toasts
const toastsContainer = $('toasts');

// ── Helpers ───────────────────────────────────────────────────────────────
function showScreen(name) {
  removeBootSplash();               // أوّل شاشة حقيقية تُزيل مؤشّر الإقلاع
  scrLogin.hidden = name !== 'login';
  scrOtp.hidden   = name !== 'otp';
  scrApp.hidden   = name !== 'app';
}

/* مؤشّر إقلاع يمنع وميض شاشة الدخول قبل حسم الجلسة: parentRestoreSession قد
   تستغرق ثوانيَ على شبكة «متصلة لكن ميتة»، وكانت شاشة الدخول تظهر خلالها ثمّ
   تُستبدَل باللوحة. يُنشأ من JS فقط، فلو تعذّر السكربت تبقى شاشة الدخول كتراجُع. */
function showBootSplash() {
  scrLogin.hidden = true;
  let el = document.getElementById('boot-splash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-splash';
    el.setAttribute('style',
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:var(--clr-bg,#f0f4fa);z-index:9999');
    el.innerHTML = '<div class="spinner spinner-lg"></div>';
    document.body.appendChild(el);
  }
  el.hidden = false;
}
function removeBootSplash() {
  document.getElementById('boot-splash')?.remove();
}

function showView(name) {
  S.activeView = name;
  allViews.forEach(v => v.hidden = true);
  const viewMap = { att: viewAtt, grades: viewGrades, calendar: viewCalendar, more: viewMore };
  const v = viewMap[name];
  if (v) v.hidden = false;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('nav-active', btn.dataset.view === name);
  });
}

const _activeToasts = new Map();

function toast(msg, type = 'info', duration = 3000) {
  // تكرارُ نفس الرسالة يزيد عدّاداً على البطاقة القائمة بدل تكديس بطاقاتٍ تغطّي
  // الشاشة (ضغطُ زرٍّ مرّاتٍ متتالية كان يملأ الشاشة برسائل متطابقة).
  const key = type + ':' + msg;
  const existing = _activeToasts.get(key);
  if (existing) {
    existing.count++;
    existing.badge.textContent = '×' + existing.count;
    existing.badge.hidden = false;
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => dismissToast(key), duration);
    return existing.el;
  }
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  const badge = document.createElement('span');
  badge.className = 'toast-badge';
  badge.hidden = true;
  el.appendChild(badge);
  toastsContainer.appendChild(el);
  const timer = setTimeout(() => dismissToast(key), duration);
  _activeToasts.set(key, { el, badge, count: 1, timer });
  return el;
}

function dismissToast(key) {
  const entry = _activeToasts.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  _activeToasts.delete(key);
  entry.el.remove();
}

// ── شريط انعدام الاتصال ───────────────────────────────────────────────────
const offlineBar = $('offline-bar');
function refreshOfflineBar() {
  if (offlineBar) offlineBar.hidden = isOnline();
}
window.addEventListener('online',  refreshOfflineBar);
window.addEventListener('offline', refreshOfflineBar);

function setBusy(spinEl, labelEl, busy) {
  spinEl.hidden = !busy;
  if (labelEl) labelEl.style.visibility = busy ? 'hidden' : '';
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ar-SY', { year: 'numeric', month: 'long', day: 'numeric' });
}

function localISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// ── OTP Countdown ─────────────────────────────────────────────────────────
let _countdownTimer = null;
function startCountdown(seconds = 600) {
  clearInterval(_countdownTimer);
  btnResend.hidden = true;
  let remaining = seconds;
  const tick = () => {
    if (remaining <= 0) {
      clearInterval(_countdownTimer);
      otpCountdown.textContent = '';
      btnResend.hidden = false;
      return;
    }
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    otpCountdown.textContent = `ينتهي خلال ${m}:${String(s).padStart(2,'0')}`;
    remaining--;
  };
  tick();
  _countdownTimer = setInterval(tick, 1000);
}

// ── Login Flow ────────────────────────────────────────────────────────────
let _phoneSubmitting = false;
formPhone.addEventListener('submit', async e => {
  e.preventDefault();
  if (_phoneSubmitting) return;
  phoneErr.hidden = true;
  const phone = inpPhone.value.trim();
  if (!phone) { phoneErr.textContent = 'يرجى إدخال رقم الهاتف'; phoneErr.hidden = false; return; }
  _phoneSubmitting = true;
  setBusy(spinPhone, btnSendOtp.querySelector('.btn-label'), true);
  btnSendOtp.disabled = true;
  try {
    await parentRequestOtp(phone);
    S.phone = phone;
    otpPhoneDisplay.textContent = phone;
    // Reset button BEFORE transitioning so it's clean if user returns
    setBusy(spinPhone, btnSendOtp.querySelector('.btn-label'), false);
    btnSendOtp.disabled = false;
    showScreen('otp');
    otpCells[0].focus();
    startCountdown(600);
  } catch (err) {
    phoneErr.textContent = errMessage(err, 'تعذّر إرسال رمز التحقّق. تأكّد من الرقم.');
    phoneErr.hidden = false;
  } finally {
    _phoneSubmitting = false;
    setBusy(spinPhone, btnSendOtp.querySelector('.btn-label'), false);
    btnSendOtp.disabled = false;
  }
});

btnBackPhone.addEventListener('click', () => {
  clearInterval(_countdownTimer);
  showScreen('login');
});

btnResend.addEventListener('click', async () => {
  btnResend.hidden = true;
  otpErr.hidden = true;
  try {
    await parentRequestOtp(S.phone);
    toast('أُعيد إرسال رمز التحقق', 'success');
    startCountdown(600);
    otpCells.forEach(c => c.value = '');
    otpCells[0].focus();
  } catch (err) {
    otpErr.textContent = errMessage(err, 'الرمز غير صحيح أو انتهت صلاحيته.');
    otpErr.hidden = false;
    btnResend.hidden = false;
  }
});

// OTP cell keyboard navigation
otpCells.forEach((cell, i) => {
  cell.addEventListener('input', e => {
    const val = e.target.value.replace(/\D/g, '');
    e.target.value = val.slice(-1);
    if (val && i < otpCells.length - 1) otpCells[i + 1].focus();
    if (getOtpCode().length === 6) formOtp.dispatchEvent(new Event('submit'));
  });
  cell.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !cell.value && i > 0) otpCells[i - 1].focus();
  });
  cell.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
    text.slice(0, 6).split('').forEach((ch, j) => {
      if (otpCells[j]) otpCells[j].value = ch;
    });
    const next = Math.min(text.length, 5);
    otpCells[next].focus();
    if (text.length >= 6) formOtp.dispatchEvent(new Event('submit'));
  });
});

function getOtpCode() { return otpCells.map(c => c.value).join(''); }

let _otpSubmitting = false;
formOtp.addEventListener('submit', async e => {
  e.preventDefault();
  if (_otpSubmitting) return;
  const code = getOtpCode();
  if (code.length < 6) { otpErr.textContent = 'أدخل الرمز المكوَّن من 6 أرقام'; otpErr.hidden = false; return; }
  otpErr.hidden = true;
  _otpSubmitting = true;
  setBusy(spinOtp, btnVerify.querySelector('.btn-label'), true);
  btnVerify.disabled = true;
  try {
    await parentVerifyOtp(S.phone, code);
    clearInterval(_countdownTimer);
    // Reset button BEFORE switching screens — keeps it clean if session expires
    setBusy(spinOtp, btnVerify.querySelector('.btn-label'), false);
    btnVerify.disabled = false;
    showScreen('app');
    await loadApp();
  } catch (err) {
    otpErr.textContent = errMessage(err, 'الرمز غير صحيح أو انتهت صلاحيته.');
    otpErr.hidden = false;
    otpCells.forEach(c => c.value = '');
    otpCells[0].focus();
  } finally {
    _otpSubmitting = false;
    setBusy(spinOtp, btnVerify.querySelector('.btn-label'), false);
    btnVerify.disabled = false;
  }
});

// ── App Initialization ────────────────────────────────────────────────────
async function loadApp() {
  mainLoading.hidden = false;
  noStudents.hidden = true;
  portalDisabled.hidden = true;
  childrenBar.hidden = true;
  bottomNav.hidden = true;
  allViews.forEach(v => v.hidden = true);

  await window.RUQI_PERMISSIONS.init();
  if (!window.RUQI_PERMISSIONS.isEnabled('parent-portal')) {
    mainLoading.hidden = true;
    portalDisabled.hidden = false;
    return;
  }
  window.RUQI_PERMISSIONS.applyToDom();

  refreshOfflineBar();
  // بذرة التاريخ: التبويب الافتراضي عمقه صفر، فأيّ تنقّلٍ بعده يُدفع فوقه
  // ويعيده زرُّ الرجوع بدل الخروج من البوّابة.
  history.replaceState({ view: S.activeView, d: 0 }, '', '#' + S.activeView);
  _navDepth = 0;

  // مفاتيح المخبأ تحمل معرّف الوليّ: هاتف العائلة قد يتناوب عليه وليّان، وبلا
  // ذلك يرى الثاني أسماء أبناء الأوّل أوفلاين قبل وصول بياناته.
  try {
    const sess = await withTimeout(parentRestoreSession(), 4000);
    S.userId = sess?.user?.id ?? null;
  } catch { /* يبقى null — المفاتيح تصير محايدة */ }

  try {
    const { data: students, fromCache } =
      await readCached(`nsams_pstu_${S.userId ?? 'anon'}`, parentGetMyStudents);
    S.students = students;
    if (!students.length) {
      noStudents.hidden = false;
      return;
    }
    if (fromCache) toast('تُعرض بيانات محفوظة على الجهاز', 'info');
    S.activeIdx = 0;
    S.activeStudent = students[0];
    renderChildrenBar();
    childrenBar.hidden = false;
    bottomNav.hidden = false;
    await loadActiveStudentData();
  } catch (err) {
    toast(errMessage(err, 'تعذَّر تحميل البيانات.'), 'error');
  } finally {
    mainLoading.hidden = true;
  }

  setupPushNotifications();
}

// ── Web Push: notify the parent when their child is marked absent ───────────
// granted → register silently. default → show a dismissible banner with an
// enable button (no forced permission prompt). denied → nothing.
function setupPushNotifications() {
  if (!('Notification' in window) || typeof registerPushSubscription !== 'function') return;

  const banner = document.getElementById('push-banner');

  if (Notification.permission === 'granted') {
    registerPushSubscription().catch(() => {});
    if (banner) banner.hidden = true;
    return;
  }

  if (Notification.permission === 'default' && banner) {
    banner.hidden = false;
    const enableBtn = document.getElementById('push-banner-enable');
    const closeBtn  = document.getElementById('push-banner-close');
    if (closeBtn) closeBtn.onclick = () => { banner.hidden = true; };
    if (enableBtn) enableBtn.onclick = async () => {
      enableBtn.disabled = true;
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') await registerPushSubscription();
      } catch (_) { /* ignore */ }
      banner.hidden = true;
    };
  }
}

function renderChildrenBar() {
  childrenPills.innerHTML = '';
  S.students.forEach((stu, i) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'child-pill' + (i === S.activeIdx ? ' active' : '');
    pill.role = 'listitem';
    pill.innerHTML = `
      <span>${escapeHtml(stu.full_name || 'طالب')}</span>
      <span class="child-pill-gender">${stu.gender === 'female' ? 'أنثى' : 'ذكر'}</span>
    `;
    pill.addEventListener('click', () => switchChild(i));
    childrenPills.appendChild(pill);
  });
}

async function switchChild(idx) {
  if (idx === S.activeIdx && S.activeStudent) return;
  S.activeIdx = idx;
  S.activeStudent = S.students[idx];
  S.grades = { s1: [], s2: [] };
  S.allGrades = [];
  S.excuses = [];
  S.attendance = [];
  document.querySelectorAll('.child-pill').forEach((p, i) => p.classList.toggle('active', i === idx));
  await loadActiveStudentData();
}

async function loadActiveStudentData() {
  mainLoading.hidden = false;
  try {
    S.viewMonth = new Date();
    await Promise.allSettled([
      loadAttendanceForMonth(),
      loadStudentSummary(),
      loadSchoolInfo(),
    ]);
    showView(S.activeView);
  } catch (err) {
    toast('تعذَّر تحميل البيانات', 'error');
  } finally {
    mainLoading.hidden = true;
  }
}

// ── بطاقة ملخّص الطالب ────────────────────────────────────────────────────
/* ⚠️ حدود الغياب مبدئية وتحتاج إقرار الوزارة قبل الاعتماد الرسمي. وُضعت في
   جدولٍ واحد ليُعدَّل رقمٌ واحد لكلّ مرحلة حين يصدر القرار، بلا لمس المنطق. */
const ABSENCE_LIMITS = { primary: 15, lower: 15, upper: 20, default: 15 };

function stageOf(grade) {
  const g = parseInt(grade, 10);
  if (!Number.isFinite(g)) return 'default';
  if (g <= 6) return 'primary';   // الحلقة الأولى
  if (g <= 9) return 'lower';     // الحلقة الثانية
  return 'upper';                 // الثانوي
}

function daysAr(n) {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومان';
  if (n >= 3 && n <= 10) return n + ' أيام';
  return n + ' يوماً';
}

async function loadStudentSummary() {
  const stu = S.activeStudent;
  if (!stu) return;

  // الهوية — كانت مجلوبةً من قاعدة البيانات ولا تُعرض أبداً: الوليّ لم يكن يعرف
  // حتى في أيّ صفٍّ ابنُه.
  stuName.textContent   = stu.full_name || 'طالب';
  stuAvatar.textContent = (stu.full_name || '؟').trim().charAt(0);
  const bits = [];
  if (stu.class?.name)      bits.push(stu.class.name);
  else if (stu.class?.grade) bits.push('الصف ' + stu.class.grade);
  if (stu.class?.section)   bits.push('شعبة ' + stu.class.section);
  if (stu.school?.name)     bits.push(stu.school.name);
  stuMeta.textContent = bits.join(' · ');
  stuCard.hidden = false;

  const year = getAcademicYear ? getAcademicYear() : getCurrentAcademicYear();
  let rows = [];
  try {
    const { data } = await readCached(`nsams_patt_${stu.id}_Y${year}`,
      () => parentGetStudentAttendanceYear(stu.id, year));
    rows = data ?? [];
  } catch { rows = []; }

  const c = { present: 0, absent: 0, excused: 0, late: 0 };
  rows.forEach(r => { if (c[r.status] !== undefined) c[r.status]++; });
  const recorded = c.present + c.absent + c.excused + c.late;
  const attended = c.present + c.late;

  if (recorded) {
    const pct = Math.round(attended / recorded * 100);
    stuAttPct.textContent = pct + '%';
    stuAttPct.className = 'stu-stat-val ' +
      (pct >= 90 ? 'val-present' : pct >= 75 ? 'val-late' : 'val-absent');
  } else {
    stuAttPct.textContent = '—';
    stuAttPct.className = 'stu-stat-val';
  }
  stuAbsTotal.textContent = c.absent;
  stuExcTotal.textContent = c.excused;

  // موقع الابن من حدّ الإنذار — الغياب غير المبرَّر وحده يُحتسب.
  const limit = ABSENCE_LIMITS[stageOf(stu.class?.grade)] ?? ABSENCE_LIMITS.default;
  const used  = c.absent;
  const left  = Math.max(0, limit - used);
  stuWarnCount.textContent = `${used} / ${limit}`;
  stuWarnText.textContent  = used >= limit
    ? 'بلغ حدّ الغياب — يُرجى مراجعة المدرسة'
    : `يتبقّى ${daysAr(left)} قبل بلوغ حدّ الغياب`;
  const ratio = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
  stuWarnFill.style.width = ratio + '%';
  stuWarn.classList.toggle('is-danger', used >= limit);
  stuWarn.classList.toggle('is-warn',   used < limit && left <= 3);
  stuWarn.hidden = false;
}

// ── Attendance ────────────────────────────────────────────────────────────
async function loadAttendanceForMonth() {
  const y   = S.viewMonth.getFullYear();
  const m   = S.viewMonth.getMonth() + 1;
  const sid = S.activeStudent.id;
  const ym  = `${y}-${String(m).padStart(2,'0')}`;
  const [attRows, excuseRows, holidayRows] = await Promise.allSettled([
    readCached(`nsams_patt_${sid}_${ym}`, () => parentGetStudentAttendance(sid, y, m)),
    readCached(`nsams_pexc_${sid}`,       () => parentGetAbsenceExcuses(sid)),
    S.holidays.length
      ? Promise.resolve({ data: S.holidays })
      : readCached(`nsams_phol_${y}`,     () => parentGetHolidays(y)),
  ]);
  S.attendance = attRows.value?.data   ?? [];
  S.excuses    = excuseRows.value?.data ?? [];
  if (holidayRows.value?.data) S.holidays = holidayRows.value.data;
  renderMonthCalendar();
}

function renderMonthCalendar() {
  const y = S.viewMonth.getFullYear();
  const m = S.viewMonth.getMonth();
  monthTitle.textContent = new Date(y, m, 1).toLocaleDateString('ar-SY', { year: 'numeric', month: 'long' });

  const attMap = {};
  S.attendance.forEach(r => attMap[r.date] = r);
  const excusedDates = new Set(S.excuses.map(e => e.date));
  const holidayDates = new Set(
    S.holidays
      .filter(h => { const d = new Date(h.date + 'T00:00:00'); return d.getFullYear() === y && d.getMonth() === m; })
      .map(h => h.date)
  );

  const firstDay = new Date(y, m, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = localISO(new Date());

  const weekdays = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  let html = '<div class="cal-weekdays">' +
    weekdays.map(d => `<div class="cal-weekday">${d}</div>`).join('') +
    '</div><div class="cal-days">';

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day cal-day--empty"></div>';

  // Days
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayOfWeek = new Date(y, m, d).getDay();
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Fri/Sat
    const isToday = iso === today;
    // الحالة تدخل في اسم صنفٍ — تُقيَّد بالقيم المعروفة قبل الحقن (كما في renderExcuses).
    const raw = attMap[iso]?.status;
    const status = ATT_STATUSES.includes(raw) ? raw : null;
    const isHoliday = holidayDates.has(iso);
    const hasExcuse = excusedDates.has(iso);

    let cls = 'cal-day';
    if (isWeekend) cls += ' cal-day--weekend';
    if (isToday) cls += ' cal-day--today';
    if (hasExcuse) cls += ' cal-day--has-excuse';

    let dotHtml = '';
    if (isHoliday) {
      dotHtml = '<span class="cal-day-dot cal-day-dot--holiday"></span>';
    } else if (status) {
      dotHtml = `<span class="cal-day-dot cal-day-dot--${status}"></span>`;
      // علامةٌ لا زرّ: الخليّة كلّها صارت هدف اللمس، وإجراءُ العذر داخل بطاقة
      // التفاصيل — زرٌّ داخل زرٍّ HTML غير صالح، والهدف الصغير يصعب لمسه.
      if (status === 'absent' && !hasExcuse && !isWeekend) {
        dotHtml += '<span class="cal-day-flag">عذر؟</span>';
      }
    }

    html += `<button type="button" class="${cls}" data-date="${iso}">
      <span class="cal-day-num">${d}</span>
      ${dotHtml}
    </button>`;
  }

  html += '</div>';
  monthCalendar.innerHTML = html;

  // Summary
  const counts = { present: 0, absent: 0, excused: 0, late: 0 };
  S.attendance.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
  sumPresent.textContent = counts.present;
  sumAbsent.textContent  = counts.absent;
  sumExcused.textContent = counts.excused;
  sumLate.textContent    = counts.late;
  attSummary.hidden = false;
}

// تفويضٌ على الحاوية الثابتة: renderMonthCalendar يستبدل محتواها كلَّ شهر،
// فالمستمع هنا يبقى بلا إعادة ربطٍ في كلّ رسم.
monthCalendar.addEventListener('click', e => {
  const cell = e.target.closest('.cal-day[data-date]');
  if (cell) openDayModal(cell.dataset.date);
});

btnPrevMonth.addEventListener('click', async () => {
  S.viewMonth = new Date(S.viewMonth.getFullYear(), S.viewMonth.getMonth() - 1, 1);
  await loadAttendanceForMonth();
});
btnNextMonth.addEventListener('click', async () => {
  const now = new Date();
  const next = new Date(S.viewMonth.getFullYear(), S.viewMonth.getMonth() + 1, 1);
  if (next > new Date(now.getFullYear(), now.getMonth(), 1)) return; // don't go into future
  S.viewMonth = next;
  await loadAttendanceForMonth();
});

// ── تفاصيل اليوم ──────────────────────────────────────────────────────────
const ATT_STATUSES  = ['present', 'absent', 'excused', 'late'];
const STATUS_LABEL  = { present: 'حاضر', absent: 'غائب', excused: 'غياب مبرَّر', late: 'متأخّر' };
const EXCUSE_LABEL  = { pending: 'بانتظار المراجعة', accepted: 'مقبول', rejected: 'مرفوض' };

function openDayModal(iso) {
  const row       = S.attendance.find(r => r.date === iso);
  const excuse    = S.excuses.find(x => x.date === iso);
  const holiday   = S.holidays.find(h => h.date === iso);
  const dow       = new Date(iso + 'T00:00:00').getDay();
  const isWeekend = dow === 5 || dow === 6;
  const status    = ATT_STATUSES.includes(row?.status) ? row.status : null;

  dayDateLabel.textContent = formatDate(iso);

  let badgeText, badgeCls;
  if (holiday)        { badgeText = 'عطلة رسمية';            badgeCls = 'holiday'; }
  else if (status)    { badgeText = STATUS_LABEL[status];    badgeCls = status; }
  else if (isWeekend) { badgeText = 'عطلة نهاية الأسبوع';    badgeCls = 'weekend'; }
  else                { badgeText = 'لا يوجد سجل لهذا اليوم'; badgeCls = 'none'; }
  dayBadge.textContent = badgeText;
  dayBadge.className   = 'day-badge day-badge--' + badgeCls;

  const rows = [];
  if (holiday?.name)  rows.push(['المناسبة', holiday.name]);
  if (row?.reason)    rows.push(['ملاحظة المدرسة', row.reason]);
  if (excuse) {
    rows.push(['حالة العذر', EXCUSE_LABEL[excuse.status] ?? EXCUSE_LABEL.pending]);
    if (excuse.reason)      rows.push(['نص العذر', excuse.reason]);
    if (excuse.review_note) rows.push(['ردّ المدرسة', excuse.review_note]);
  }
  dayRows.innerHTML = rows.map(([k, v]) =>
    `<div class="day-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('');
  dayRows.hidden = rows.length === 0;

  S.dayModalDate  = iso;
  btnDayExcuse.hidden = !(status === 'absent' && !excuse && !isWeekend && !holiday);

  modalDay.hidden = false;
  pushModalHistory();
}

function closeDayModal() { modalDay.hidden = true; }
function dismissDayModal() { closeDayModal(); popModalHistory(); }

btnDayClose.addEventListener('click', dismissDayModal);
modalDay.addEventListener('click', e => { if (e.target === modalDay) dismissDayModal(); });

/* الانتقال من بطاقة اليوم إلى نافذة العذر يُسلّمها سجلَّ التاريخ نفسه بدل سحبٍ
   ثمّ دفعٍ فوريّ: history.back غير متزامن، فالدفع بعده مباشرةً سباقٌ سلوكُه
   يختلف بين المتصفّحات. بإعادة الاستعمال يبقى العمق صحيحاً وزرُّ الرجوع يغلق
   نافذة العذر ويعود للتقويم. */
btnDayExcuse.addEventListener('click', () => {
  const iso = S.dayModalDate;
  closeDayModal();
  openExcuseModal(iso, true);
});

// ── Grades ────────────────────────────────────────────────────────────────
async function loadGrades() {
  if (S.allGrades.length) { renderGrades(S.activeSemester); return; }
  gradesLoading.hidden = false;
  gradesTable.hidden = true;
  gradesEmpty.hidden = true;
  try {
    const year = getAcademicYear ? getAcademicYear() : getCurrentAcademicYear();
    const sid  = S.activeStudent.id;
    const { data: grades } = await readCached(
      `nsams_pgrades_${sid}_${year}`,
      () => parentGetStudentGrades(sid, year));
    S.allGrades = grades;
    S.grades.s1 = grades.filter(g => g.semester === 1);
    S.grades.s2 = grades.filter(g => g.semester === 2);
    renderGrades(S.activeSemester);
  } catch (err) {
    gradesEmpty.textContent = 'تعذَّر تحميل الدرجات';
    gradesEmpty.hidden = false;
  } finally {
    gradesLoading.hidden = true;
  }
}

function getCurrentAcademicYear() {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 8 ? `${y}-${y+1}` : `${y-1}-${y}`;
}

function renderGrades(semester) {
  const rows = semester === 1 ? S.grades.s1 : S.grades.s2;

  // Group by subject
  const bySubject = {};
  rows.forEach(g => {
    const key = g.subject_id;
    if (!bySubject[key]) {
      bySubject[key] = {
        name: g.subject?.name ?? 'مادة',
        order: g.subject?.sort_order ?? 99,
        totalMark: 0,
        totalMax: 0,
        components: [],
      };
    }
    bySubject[key].components.push(g);
    bySubject[key].totalMark += (g.mark ?? 0);
    bySubject[key].totalMax  += (g.component?.max_mark ?? g.subject?.max_total ?? 0);
  });

  const subjects = Object.values(bySubject).sort((a, b) => a.order - b.order);

  if (!subjects.length) {
    gradesTable.hidden = true;
    gradesEmpty.hidden = false;
    return;
  }
  gradesEmpty.hidden = true;
  gradesTable.hidden = false;

  let totalM = 0, totalMx = 0;
  gradesTbody.innerHTML = subjects.map((s, i) => {
    totalM  += s.totalMark;
    totalMx += s.totalMax;
    const pct = s.totalMax > 0 ? Math.round(s.totalMark / s.totalMax * 100) : null;

    /* تفصيل المكوّنات (شفهي/نشاط/اختبار…): كان يُجمَع في رقمٍ واحد فلا يعرف
       الوليّ أين نقطة ضعف ابنه. البيانات مجلوبةٌ أصلاً في components. */
    const comps = s.components
      .filter(c => c.component?.name)
      .sort((a, b) => (a.component.sort_order ?? 99) - (b.component.sort_order ?? 99));
    const expandable = comps.length > 1;
    const detailId   = 'gd-' + i;

    const detail = expandable ? `<tr class="grade-detail" id="${detailId}" hidden>
        <td colspan="4">
          <ul class="comp-list">${comps.map(c => {
            const mk = c.mark ?? 0;
            const mx = c.component.max_mark ?? 0;
            const w  = mx > 0 ? Math.min(100, Math.round(mk / mx * 100)) : 0;
            return `<li class="comp-item">
              <span class="comp-name">${escapeHtml(c.component.name)}</span>
              <span class="comp-val">${mk} / ${mx}</span>
              <span class="comp-track"><span class="comp-fill" style="width:${w}%"></span></span>
            </li>`;
          }).join('')}</ul>
        </td>
      </tr>` : '';

    const nameCell = expandable
      ? `<button type="button" class="subj-toggle" data-target="${detailId}" aria-expanded="false" aria-controls="${detailId}">
           <span class="subj-name">${escapeHtml(s.name)}</span>
           <span class="grade-chev" aria-hidden="true"></span>
         </button>`
      : escapeHtml(s.name);

    return `<tr class="grade-row${i % 2 ? ' is-alt' : ''}">
      <td class="subj-cell">${nameCell}</td>
      <td>${s.totalMark}</td>
      <td>${s.totalMax}</td>
      <td>${pct === null ? '—' : pct + '%'}</td>
    </tr>${detail}`;
  }).join('');

  totalMax.textContent = totalMx;
  totalPct.textContent = totalMx > 0 ? Math.round(totalM / totalMx * 100) + '%' : '—';
}

// طيّ/بسط تفصيل المادّة — تفويضٌ على الجسم الثابت، فالمحتوى يُعاد رسمه مع كلّ فصل.
gradesTbody.addEventListener('click', e => {
  const btn = e.target.closest('.subj-toggle');
  if (!btn) return;
  const detail = document.getElementById(btn.dataset.target);
  if (!detail) return;
  const willOpen = detail.hidden;
  detail.hidden = !willOpen;
  btn.setAttribute('aria-expanded', String(willOpen));
  btn.classList.toggle('is-open', willOpen);
});

tabS1.addEventListener('click', () => {
  S.activeSemester = 1;
  tabS1.classList.add('tab-active');
  tabS2.classList.remove('tab-active');
  if (viewGrades.hidden) return;
  renderGrades(1);
});
tabS2.addEventListener('click', () => {
  S.activeSemester = 2;
  tabS2.classList.add('tab-active');
  tabS1.classList.remove('tab-active');
  if (viewGrades.hidden) return;
  renderGrades(2);
});

// ── Holidays ──────────────────────────────────────────────────────────────
async function loadHolidays() {
  holidaysLoading.hidden = false;
  holidaysList.hidden = true;
  holidaysEmpty.hidden = true;
  try {
    const year = new Date().getFullYear();
    const { data: holidays } = await readCached(
      `nsams_phol_${year}`, () => parentGetHolidays(year));
    S.holidays = holidays;
    renderHolidays(holidays);
  } catch (err) {
    holidaysEmpty.textContent = 'تعذَّر تحميل العطل';
    holidaysEmpty.hidden = false;
  } finally {
    holidaysLoading.hidden = true;
  }
}

function renderHolidays(holidays) {
  if (!holidays.length) { holidaysEmpty.hidden = false; return; }
  holidaysList.hidden = false;
  const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

  let currentMonth = -1;
  holidaysList.innerHTML = holidays.map(h => {
    const d = new Date(h.date + 'T00:00:00');
    const m = d.getMonth();
    let monthHeader = '';
    if (m !== currentMonth) {
      currentMonth = m;
      monthHeader = `<li class="holiday-month-header">${AR_MONTHS[m]} ${d.getFullYear()}</li>`;
    }
    return `${monthHeader}<li class="holiday-item">
      <span class="holiday-date">${d.toLocaleDateString('ar-SY', { day: 'numeric', month: 'short' })}</span>
      <span class="holiday-name">${escapeHtml(h.name || 'عطلة رسمية')}</span>
    </li>`;
  }).join('');
}

// ── School Info ───────────────────────────────────────────────────────────
function loadSchoolInfo() {
  const stu = S.activeStudent;
  if (!stu || !stu.school) return;
  schoolNameDisplay.textContent = stu.school.name || '—';
  const phone = stu.school.contact_phone;
  if (phone) {
    schoolPhoneLink.textContent = phone;
    schoolPhoneLink.href = `tel:${phone}`;
    schoolPhoneRow.hidden = false;
  } else {
    schoolPhoneRow.hidden = true;
  }
}

async function loadExcuses() {
  if (S.excuses.length || !S.activeStudent) return;
  const sid = S.activeStudent.id;
  try {
    const { data } = await readCached(`nsams_pexc_${sid}`,
      () => parentGetAbsenceExcuses(sid));
    S.excuses = data;
  } catch { /* silent */ }
  renderExcuses();
}

function renderExcuses() {
  const excuses = S.excuses;
  if (!excuses.length) { excusesEmpty.hidden = false; excusesList.hidden = true; return; }
  excusesEmpty.hidden = true;
  excusesList.hidden = false;
  const statusLabel = { pending: 'بانتظار المراجعة', accepted: 'مقبول', rejected: 'مرفوض' };
  excusesList.innerHTML = excuses.map(e => {
    // Constrain status to the known enum before using it in a class name, and
    // escape all free-text/DB values before injecting them into innerHTML.
    const status = ['pending', 'accepted', 'rejected'].includes(e.status) ? e.status : 'pending';
    return `
    <li class="excuse-item">
      <div class="excuse-status-dot excuse-status-dot--${status}"></div>
      <div class="excuse-body">
        <div class="excuse-date">${escapeHtml(formatDate(e.date))}</div>
        <div class="excuse-reason">${escapeHtml(e.reason)}</div>
        ${e.review_note ? `<div class="excuse-note">ردّ المدرسة: ${escapeHtml(e.review_note)}</div>` : ''}
      </div>
      <span class="excuse-status-label excuse-status-label--${status}">${escapeHtml(statusLabel[status])}</span>
    </li>
  `;
  }).join('');
}

// ── Navigation + تاريخ المتصفّح ───────────────────────────────────────────
// بلا هذه الطبقة كان زرّ الرجوع في الجهاز يخرج من البوّابة كلّها من أيّ تبويب
// أو نافذة — نفس العلّة التي أُصلحت في بوّابتَي المدرسة والمعلّم.
let _navDepth    = 0;
let _modalDepth  = 0;
let _inPopstate  = false;
let _pendingBack = 0;

function pushModalHistory() {
  _modalDepth++;
  _navDepth++;
  history.pushState({ modal: _modalDepth, d: _navDepth }, '');
}

/* يُستدعى من كلّ مسار إغلاقٍ للنافذة.
   • أثناء popstate: يكتفي بتصحيح العدّاد، فالمتصفّح سحب السجلّ أصلاً — بلا هذا
     الحارس يتراجع التاريخ مرّتين.
   • خارجه: يسحب السجلّ بنفسه ويُعلِّم الحدثَ الناتج ليُتجاهَل (_pendingBack).
     بلا هذا التعليم كان إغلاق نافذةٍ فوق أخرى يُغلق الاثنتين: إغلاق «مصدر
     الصورة» يستدعي history.back فيرى المعالجُ نافذةَ العذر مفتوحةً فيغلقها. */
function popModalHistory() {
  if (_inPopstate) { _modalDepth = Math.max(0, _modalDepth - 1); return; }
  if (_modalDepth > 0) { _modalDepth--; _pendingBack++; history.back(); }
}

async function navigateToView(view, fromHistory) {
  showView(view);
  if (!fromHistory) {
    _navDepth++;
    history.pushState({ view, d: _navDepth }, '', '#' + view);
  }
  if (view === 'grades' && !S.allGrades.length) await loadGrades();
  if (view === 'calendar') await loadHolidays();
  if (view === 'more') { loadSchoolInfo(); await loadExcuses(); renderExcuses(); }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigateToView(btn.dataset.view));
});

window.addEventListener('popstate', e => {
  _inPopstate = true;
  try {
    _navDepth = e.state?.d ?? 0;
    // حدثٌ ناتج عن إغلاقٍ يدويّ سحبَ السجلّ بنفسه — استُهلك، فلا يُغلق شيئاً آخر.
    if (_pendingBack > 0) { _pendingBack--; return; }
    // النافذة المفتوحة فعلياً هي ما يغلقه الرجوع — الأعلى أوّلاً (مصدر الصورة
    // يُفتح من داخل نافذة العذر فيجب أن يُغلق قبلها).
    if (!modalPhotoSource.hidden)      { dismissPhotoSourceModal();  return; }
    if (!modalExcuse.hidden)           { dismissExcuseModal();       return; }
    if (!modalDay.hidden)              { dismissDayModal();          return; }
    if (!modalConfirmLogout.hidden)    { dismissLogoutModal();       return; }
    const view = e.state?.view;
    if (view) navigateToView(view, true);
  } finally {
    _inPopstate = false;
  }
});

// ── Logout ────────────────────────────────────────────────────────────────
function dismissLogoutModal() {
  modalConfirmLogout.hidden = true;
  popModalHistory();
}

btnLogout.addEventListener('click', () => {
  modalConfirmLogout.hidden = false;
  pushModalHistory();
});
btnConfirmLogoutCancel.addEventListener('click', dismissLogoutModal);
modalConfirmLogout.addEventListener('click', e => {
  if (e.target === modalConfirmLogout) dismissLogoutModal();
});
btnConfirmLogoutOk.addEventListener('click', async () => {
  modalConfirmLogout.hidden = true;
  try { await parentLogout(); } catch { /* ignore */ }
  try { await window.RUQI_DB.purgeTenantCaches(); } catch { /* ignore */ }
  // ⚠️ إعادة تحميل لا showScreen: الأخيرة تقلب hidden فقط، فتبقى أسماء أبناء
  // الأهل السابق ودرجاتهم وتقويم غيابهم واسم مدرستهم **في الـDOM** مخفيّةً،
  // وتعود للظهور لحظة دخول أهلٍ آخرين قبل أن تصل بياناتهم. نفس العلّة أُصلحت
  // في بوابتَي المدرسة والمعلّم بإعادة التحميل، ولم تُصلَح هنا.
  location.reload();
});

// ── Excuse from More Tab ──────────────────────────────────────────────────
btnNewExcuseMore.addEventListener('click', () => {
  excuseDatePickerWrap.hidden = false;
  const today = localISO(new Date());
  inpExcuseDate.max = today;
  inpExcuseDate.value = today;
  inpExcuseDate.focus();
});

inpExcuseDate.addEventListener('change', () => {
  const d = inpExcuseDate.value;
  if (!d) return;
  excuseDatePickerWrap.hidden = true;
  openExcuseModal(d);
});

// ── Excuse Modal ──────────────────────────────────────────────────────────
function openExcuseModal(date, reuseHistory) {
  S.excuseDate = date;
  S.excusePhotoDataUri = null;
  excuseDateLabel.textContent = 'غياب بتاريخ: ' + formatDate(date);
  excuseReason.value = '';
  excuseReasonErr.hidden = true;
  excuseSubmitErr.hidden = true;
  photoPreview.hidden = true;
  photoPlaceholder.hidden = false;
  photoRemoveBtn.hidden = true;
  photoPreview.src = '';
  modalExcuse.hidden = false;
  if (!reuseHistory) pushModalHistory();
  excuseReason.focus();
}

function closeExcuseModal() {
  modalExcuse.hidden = true;
  S.excuseDate = null;
  S.excusePhotoDataUri = null;
}

function dismissExcuseModal() {
  closeExcuseModal();
  popModalHistory();
}

btnExcuseCancel.addEventListener('click', dismissExcuseModal);
modalExcuse.addEventListener('click', e => { if (e.target === modalExcuse) dismissExcuseModal(); });

// Photo Upload
photoUploadArea.addEventListener('click', () => {
  if (S.excusePhotoDataUri) return; // already has photo, click remove instead
  showPhotoSourceModal();
});
photoRemoveBtn.addEventListener('click', e => {
  e.stopPropagation();
  S.excusePhotoDataUri = null;
  photoPreview.hidden = true;
  photoPreview.src = '';
  photoPlaceholder.hidden = false;
  photoRemoveBtn.hidden = true;
});

function showPhotoSourceModal() {
  modalPhotoSource.hidden = false;
  pushModalHistory();
}
function hidePhotoSourceModal() {
  modalPhotoSource.hidden = true;
}
function dismissPhotoSourceModal() {
  hidePhotoSourceModal();
  popModalHistory();
}
btnPhotoSourceCancel.addEventListener('click', dismissPhotoSourceModal);
modalPhotoSource.addEventListener('click', e => { if (e.target === modalPhotoSource) dismissPhotoSourceModal(); });

btnUseCamera.addEventListener('click', () => {
  dismissPhotoSourceModal();
  inputCamera.value = '';
  inputCamera.click();
});
btnUseGallery.addEventListener('click', () => {
  dismissPhotoSourceModal();
  inputGallery.value = '';
  inputGallery.click();
});

function handleFileSelected(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    S.excusePhotoDataUri = e.target.result;
    photoPreview.src = e.target.result;
    photoPreview.hidden = false;
    photoPlaceholder.hidden = true;
    photoRemoveBtn.hidden = false;
  };
  reader.readAsDataURL(file);
}

inputCamera.addEventListener('change', e => handleFileSelected(e.target.files?.[0]));
inputGallery.addEventListener('change', e => handleFileSelected(e.target.files?.[0]));

formExcuse.addEventListener('submit', async e => {
  e.preventDefault();
  excuseReasonErr.hidden = true;
  excuseSubmitErr.hidden = true;
  const reason = excuseReason.value.trim();
  if (!reason) {
    excuseReasonErr.textContent = 'يرجى كتابة سبب الغياب';
    excuseReasonErr.hidden = false;
    return;
  }
  setBusy(spinExcuse, btnExcuseSubmit.querySelector('.btn-label'), true);
  btnExcuseSubmit.disabled = true;
  try {
    let photoUrl = null;
    if (S.excusePhotoDataUri) {
      photoUrl = await parentUploadExcusePhoto(S.excusePhotoDataUri);
    }
    const stu = S.activeStudent;
    await parentSubmitAbsenceExcuse(stu.id, stu.school_id, S.excuseDate, reason, photoUrl);
    toast('تم إرسال العذر بنجاح ✓', 'success');
    dismissExcuseModal();
    // Refresh excuses list
    S.excuses = [];
    S.allGrades = []; // invalidate so next open re-fetches
    await loadAttendanceForMonth();
    if (S.activeView === 'more') await loadExcuses();
  } catch (err) {
    excuseSubmitErr.textContent = errMessage(err, 'تعذّر إرسال العذر.');
    excuseSubmitErr.hidden = false;
  } finally {
    setBusy(spinExcuse, btnExcuseSubmit.querySelector('.btn-label'), false);
    btnExcuseSubmit.disabled = false;
  }
});

// ── Entry ─────────────────────────────────────────────────────────────────
showBootSplash();
(async () => {
  try {
    // withTimeout: على شبكة «متصلة لكن ميتة» كان استرجاعُ الجلسة يتعلّق فيبقى
    // الوليّ أمام شاشةٍ ساكنة. بعد المهلة نُعامله كغير مسجَّل ونعرض الدخول.
    const session = await withTimeout(parentRestoreSession(), 6000);
    if (session) {
      showScreen('app');
      await loadApp();
    } else {
      showScreen('login');
    }
  } catch {
    showScreen('login');
  }
})();
