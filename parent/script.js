// ── Guard ─────────────────────────────────────────────────────────────────
if (!window.NSAMS_DB) {
  document.body.innerHTML = '<p style="padding:2rem;text-align:center;color:red">تعذَّر تحميل shared/db.js</p>';
  throw new Error('NSAMS_DB not loaded');
}

const {
  parentRequestOtp,
  parentVerifyOtp,
  parentLogout,
  parentRestoreSession,
  parentGetMyStudents,
  parentGetStudentAttendance,
  parentGetStudentGrades,
  parentGetHolidays,
  parentGetAbsenceExcuses,
  parentSubmitAbsenceExcuse,
  parentUploadExcusePhoto,
  getAcademicYear,
  registerPushSubscription,
  escapeHtml,
} = window.NSAMS_DB;

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
  excusePhotoDataUri: null,
  activeSemester: 1,
  activeView: 'att',
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
const bottomNav     = $('bottom-nav');
const btnLogout     = $('btn-logout');

// Views
const viewAtt      = $('view-att');
const viewGrades   = $('view-grades');
const viewCalendar = $('view-calendar');
const viewMore     = $('view-more');
const allViews     = [viewAtt, viewGrades, viewCalendar, viewMore];

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
  scrLogin.hidden = name !== 'login';
  scrOtp.hidden   = name !== 'otp';
  scrApp.hidden   = name !== 'app';
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

function toast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  toastsContainer.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

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
    phoneErr.textContent = err.message;
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
    otpErr.textContent = err.message;
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
    otpErr.textContent = err.message;
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
  childrenBar.hidden = true;
  bottomNav.hidden = true;
  allViews.forEach(v => v.hidden = true);

  try {
    const students = await parentGetMyStudents();
    S.students = students;
    if (!students.length) {
      noStudents.hidden = false;
      return;
    }
    S.activeIdx = 0;
    S.activeStudent = students[0];
    renderChildrenBar();
    childrenBar.hidden = false;
    bottomNav.hidden = false;
    await loadActiveStudentData();
  } catch (err) {
    toast('تعذَّر تحميل البيانات: ' + err.message, 'error');
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
      loadSchoolInfo(),
    ]);
    showView(S.activeView);
  } catch (err) {
    toast('تعذَّر تحميل البيانات', 'error');
  } finally {
    mainLoading.hidden = true;
  }
}

// ── Attendance ────────────────────────────────────────────────────────────
async function loadAttendanceForMonth() {
  const y = S.viewMonth.getFullYear();
  const m = S.viewMonth.getMonth() + 1;
  const [attRows, excuseRows, holidayRows] = await Promise.allSettled([
    parentGetStudentAttendance(S.activeStudent.id, y, m),
    parentGetAbsenceExcuses(S.activeStudent.id),
    S.holidays.length ? Promise.resolve(S.holidays) : parentGetHolidays(y),
  ]);
  S.attendance = attRows.value ?? [];
  S.excuses = excuseRows.value ?? [];
  if (holidayRows.value) S.holidays = holidayRows.value;
  renderMonthCalendar();
}

function renderMonthCalendar() {
  const y = S.viewMonth.getFullYear();
  const m = S.viewMonth.getMonth();
  monthTitle.textContent = new Date(y, m, 1).toLocaleDateString('ar-SY', { year: 'numeric', month: 'long' });

  const attMap = {};
  S.attendance.forEach(r => attMap[r.date] = r.status);
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
    const status = attMap[iso];
    const isHoliday = holidayDates.has(iso);
    const hasExcuse = excusedDates.has(iso);

    let cls = 'cal-day';
    if (isWeekend) cls += ' cal-day--weekend';
    if (isToday) cls += ' cal-day--today';
    if (hasExcuse) cls += ' cal-day--has-excuse';

    let dotHtml = '';
    if (isHoliday) {
      dotHtml = '<div class="cal-day-dot cal-day-dot--holiday" title="عطلة رسمية"></div>';
    } else if (status) {
      const dotCls = `cal-day-dot cal-day-dot--${status}`;
      dotHtml = `<div class="${dotCls}"></div>`;
      if (status === 'absent' && !hasExcuse && !isWeekend) {
        dotHtml += `<button class="cal-day-excuse-btn" data-date="${iso}" type="button" title="تقديم عذر">عذر</button>`;
      }
    }

    html += `<div class="${cls}">
      <span class="cal-day-num">${d}</span>
      ${dotHtml}
    </div>`;
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

  // Excuse button listeners (event delegation)
  monthCalendar.querySelectorAll('.cal-day-excuse-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openExcuseModal(btn.dataset.date);
    });
  });
}

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

// ── Grades ────────────────────────────────────────────────────────────────
async function loadGrades() {
  if (S.allGrades.length) { renderGrades(S.activeSemester); return; }
  gradesLoading.hidden = false;
  gradesTable.hidden = true;
  gradesEmpty.hidden = true;
  try {
    const year = getAcademicYear ? getAcademicYear() : getCurrentAcademicYear();
    const grades = await parentGetStudentGrades(S.activeStudent.id, year);
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
  gradesTbody.innerHTML = subjects.map(s => {
    totalM  += s.totalMark;
    totalMx += s.totalMax;
    const pct = s.totalMax > 0 ? Math.round(s.totalMark / s.totalMax * 100) : '—';
    return `<tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${s.totalMark}</td>
      <td>${s.totalMax}</td>
      <td>${pct}${typeof pct === 'number' ? '%' : ''}</td>
    </tr>`;
  }).join('');

  totalMax.textContent = totalMx;
  totalPct.textContent = totalMx > 0 ? Math.round(totalM / totalMx * 100) + '%' : '—';
}

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
    const holidays = await parentGetHolidays(year);
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
  try {
    S.excuses = await parentGetAbsenceExcuses(S.activeStudent.id);
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
      </div>
      <span class="excuse-status-label excuse-status-label--${status}">${escapeHtml(statusLabel[status])}</span>
    </li>
  `;
  }).join('');
}

// ── Navigation ────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const view = btn.dataset.view;
    showView(view);
    if (view === 'grades' && !S.allGrades.length) await loadGrades();
    if (view === 'calendar') await loadHolidays();
    if (view === 'more') { loadSchoolInfo(); await loadExcuses(); renderExcuses(); }
  });
});

// ── Logout ────────────────────────────────────────────────────────────────
btnLogout.addEventListener('click', () => {
  modalConfirmLogout.hidden = false;
});
btnConfirmLogoutCancel.addEventListener('click', () => {
  modalConfirmLogout.hidden = true;
});
modalConfirmLogout.addEventListener('click', e => {
  if (e.target === modalConfirmLogout) modalConfirmLogout.hidden = true;
});
btnConfirmLogoutOk.addEventListener('click', async () => {
  modalConfirmLogout.hidden = true;
  try { await parentLogout(); } catch { /* ignore */ }
  S.students = []; S.activeStudent = null; S.phone = '';
  inpPhone.value = '';
  showScreen('login');
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
function openExcuseModal(date) {
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
  excuseReason.focus();
}

function closeExcuseModal() {
  modalExcuse.hidden = true;
  S.excuseDate = null;
  S.excusePhotoDataUri = null;
}

btnExcuseCancel.addEventListener('click', closeExcuseModal);
modalExcuse.addEventListener('click', e => { if (e.target === modalExcuse) closeExcuseModal(); });

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
}
function hidePhotoSourceModal() {
  modalPhotoSource.hidden = true;
}
btnPhotoSourceCancel.addEventListener('click', hidePhotoSourceModal);
modalPhotoSource.addEventListener('click', e => { if (e.target === modalPhotoSource) hidePhotoSourceModal(); });

btnUseCamera.addEventListener('click', () => {
  hidePhotoSourceModal();
  inputCamera.value = '';
  inputCamera.click();
});
btnUseGallery.addEventListener('click', () => {
  hidePhotoSourceModal();
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
    closeExcuseModal();
    // Refresh excuses list
    S.excuses = [];
    S.allGrades = []; // invalidate so next open re-fetches
    await loadAttendanceForMonth();
    if (S.activeView === 'more') await loadExcuses();
  } catch (err) {
    excuseSubmitErr.textContent = err.message;
    excuseSubmitErr.hidden = false;
  } finally {
    setBusy(spinExcuse, btnExcuseSubmit.querySelector('.btn-label'), false);
    btnExcuseSubmit.disabled = false;
  }
});

// ── Entry ─────────────────────────────────────────────────────────────────
(async () => {
  try {
    const session = await parentRestoreSession();
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
