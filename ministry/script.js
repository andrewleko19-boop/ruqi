// ════════════════════════════════════════════════════════════════════════════
//  NSAMS — لوحة تحكم الوزارة (script.js)
//  مصدر الحضور: daily_student_attendance (سجل فردي لكل طالب) — المصدر الحقيقي.
//
//  ⚠️ إعادة كتابة جذرية: النسخة السابقة كانت تقرأ من daily_attendance (رقم مجمّع
//     لكل مدرسة) وتخلط مقياسين: "schoolsReported" (عدد مدارس) تحت اسم "إجمالي الطلاب".
//     النظام فعلياً يعتمد التعليم الفردي (تأكدنا: 61 سجل فردي مقابل 1 مجمّع).
//
//  تعريف المقاييس (مُقرّر مع المستخدم):
//   • الحاضر  = present + late + excused   (الغائب الحقيقي = absent فقط)
//   • النسبة  = الحاضرون ÷ المسجّلين فعلاً اليوم (المعياري — لا يعاقب المدارس الصامتة)
//   • "مدارس لم تُسجّل" = مؤشّر منفصل، لا يُخلط بالنسبة
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from '../shared/db.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const loginScreen   = document.getElementById('login-screen');
const dashboard     = document.getElementById('dashboard');
const loginBtn      = document.getElementById('login-btn');
const logoutBtn     = document.getElementById('logout-btn');
const refreshBtn    = document.getElementById('refresh-btn');
const exportBtn     = document.getElementById('export-btn');
const emailInput    = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginError    = document.getElementById('login-error');
const userEmailEl   = document.getElementById('user-email');
const todayLabel    = document.getElementById('today-label');
const lastUpdated   = document.getElementById('last-updated');

// Stats — المعرّفات نفسها في index.html (التسميات تُصحّح في HTML، انظر الملاحظة أسفل)
const statGov     = document.getElementById('stat-governorates'); // عدد المحافظات
const statTotal   = document.getElementById('stat-total');        // إجمالي الطلاب المسجّلين اليوم
const statPresent = document.getElementById('stat-present');      // الحاضرون (present+late+excused)
const statAbsent  = document.getElementById('stat-absent');       // الغائبون (absent)
const statRate    = document.getElementById('stat-rate');         // نسبة الحضور الوطنية
const statAdmins  = document.getElementById('stat-admins');       // الإداريون الحاضرون
const statWorkers = document.getElementById('stat-workers');      // العمال الحاضرون

// Table
const tableLoading = document.getElementById('table-loading');
const tableWrapper = document.getElementById('table-wrapper');
const tableEmpty   = document.getElementById('table-empty');
const govTbody     = document.getElementById('gov-tbody');
const govTfoot     = document.getElementById('gov-tfoot');

// ── State ─────────────────────────────────────────────────────────────────────
let tableData = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => (n === null || n === undefined) ? '—' : Number(n).toLocaleString();
const pct = (part, total) => total > 0 ? ((part / total) * 100).toFixed(1) + '%' : '—';
const today = () => new Date().toISOString().split('T')[0];

// الحاضر = حاضر + متأخر + مأذون (قرار المستخدم)
const presentOf = (agg) => agg.present + agg.late + agg.excused;
// إجمالي المسجّلين اليوم = كل الحالات الأربع
const enrolledOf = (agg) => agg.present + agg.late + agg.excused + agg.absent;

function showError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}
function hideError() {
  loginError.classList.add('hidden');
}
function setLastUpdated() {
  lastUpdated.textContent = 'آخر تحديث: ' + new Date().toLocaleTimeString('ar-SY');
}
function setTodayLabel() {
  todayLabel.textContent = new Date().toLocaleDateString('ar-SY', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

// شارة حسب نسبة الحضور
function rateBadge(rate) {
  if (rate === null) return '<span class="badge badge-none">لا بيانات</span>';
  const n = parseFloat(rate);
  if (n >= 90) return '<span class="badge badge-good">ممتاز</span>';
  if (n >= 75) return '<span class="badge badge-warning">مقبول</span>';
  return '<span class="badge badge-poor">ضعيف</span>';
}
function rateBarClass(rate) {
  if (rate === null) return '';
  const n = parseFloat(rate);
  if (n >= 90) return 'green';
  if (n >= 75) return 'yellow';
  return 'red';
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const ok = await verifyRole(session.user.id);
    if (ok) showDashboard(session.user.email);
    else await supabase.auth.signOut();
  }
}

async function verifyRole(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();
  if (error || !data) return false;
  return data.role === 'ministry_user';
}

loginBtn.addEventListener('click', async () => {
  hideError();
  const email    = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) { showError('الرجاء إدخال البريد وكلمة المرور.'); return; }

  loginBtn.disabled    = true;
  loginBtn.textContent = 'جارٍ تسجيل الدخول…';

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    showError(error.message);
    loginBtn.disabled    = false;
    loginBtn.textContent = 'تسجيل الدخول';
    return;
  }

  const ok = await verifyRole(data.user.id);
  if (!ok) {
    showError('الوصول مرفوض. هذه البوابة لمستخدمي الوزارة فقط.');
    await supabase.auth.signOut();
    loginBtn.disabled    = false;
    loginBtn.textContent = 'تسجيل الدخول';
    return;
  }
  showDashboard(data.user.email);
});

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  dashboard.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  loginBtn.disabled    = false;
  loginBtn.textContent = 'تسجيل الدخول';
  emailInput.value    = '';
  passwordInput.value = '';
  tableData = [];
});

function showDashboard(email) {
  loginScreen.classList.add('hidden');
  dashboard.classList.remove('hidden');
  userEmailEl.textContent = email;
  setTodayLabel();
  loadAllData();
}

// ── Data Fetching ─────────────────────────────────────────────────────────────
//
// الـ schema (مؤكّد هذه الجلسة):
//   directorates(id, name, governorate)
//   schools(id, directorate_id, total_students)
//   daily_student_attendance(school_id, status, date)  status∈present|late|absent|excused
//
// المقياس الجديد (حضور طلاب حقيقي، تجميع لكل محافظة):
//   present/late/absent/excused = عدّ السجلات الفردية لهذا اليوم
//   schoolsReporting = عدد المدارس التي سجّلت ولو طالباً واحداً اليوم
//   النسبة = (present+late+excused) ÷ (كل المسجّلين اليوم)
//
async function loadAllData() {
  tableLoading.classList.remove('hidden');
  tableWrapper.classList.add('hidden');
  tableEmpty.classList.add('hidden');
  [statGov, statTotal, statPresent, statAbsent, statRate, statAdmins, statWorkers].forEach(el => el.textContent = '—');

  try {
    // 1. كل المديريات
    const { data: directorates, error: dirErr } = await supabase
      .from('directorates')
      .select('id, name, governorate')
      .order('governorate');
    if (dirErr) throw dirErr;
    if (!directorates || directorates.length === 0) { showEmpty('لا توجد مديريات.'); return; }

    // 2. كل المدارس (id + directorate_id + total_students للمرجع)
    const { data: schools, error: schErr } = await supabase
      .from('schools')
      .select('id, directorate_id, total_students');
    if (schErr) throw schErr;

    const allSchoolIds = (schools || []).map(s => s.id);

    // 3. سجلات الحضور الفردية لهذا اليوم (المصدر الحقيقي)
    const { data: attendance, error: attErr } = await supabase
      .from('daily_student_attendance')
      .select('school_id, status')
      .eq('date', today())
      .in('school_id', allSchoolIds.length > 0 ? allSchoolIds : ['__none__']);
    if (attErr) throw attErr;

    // 3ب. دوام الإداريين والعمال (مجمّع المدرسة daily_attendance) — للبطاقات الوطنية
    const { data: staffAgg, error: staffErr } = await supabase
      .from('daily_attendance')
      .select('admins_present, workers_present')
      .eq('date', today())
      .in('school_id', allSchoolIds.length > 0 ? allSchoolIds : ['__none__']);
    if (staffErr) throw staffErr;
    let adminsPresent = 0, workersPresent = 0;
    for (const r of staffAgg || []) {
      adminsPresent  += r.admins_present  || 0;
      workersPresent += r.workers_present || 0;
    }
    statAdmins.textContent  = fmt(adminsPresent);
    statWorkers.textContent = fmt(workersPresent);

    // خرائط البحث: school → directorate
    const schoolToDir = {};
    for (const s of schools || []) schoolToDir[s.id] = s.directorate_id;

    // تجميع حسب المديرية: عدّ الحالات + مجموعة المدارس المُسجّلة
    const dirAgg = {};
    for (const d of directorates) {
      dirAgg[d.id] = {
        present: 0, late: 0, absent: 0, excused: 0,
        reportingSchools: new Set(),
      };
    }
    for (const rec of attendance || []) {
      const dirId = schoolToDir[rec.school_id];
      if (!dirId || !dirAgg[dirId]) continue;
      const a = dirAgg[dirId];
      if (rec.status === 'present')      a.present++;
      else if (rec.status === 'late')    a.late++;
      else if (rec.status === 'absent')  a.absent++;
      else if (rec.status === 'excused') a.excused++;
      a.reportingSchools.add(rec.school_id);
    }

    // تجميع حسب المحافظة
    const govMap = {};
    for (const d of directorates) {
      const gov = d.governorate || 'غير محدد';
      if (!govMap[gov]) {
        govMap[gov] = { governorate: gov, present: 0, late: 0, absent: 0, excused: 0, reportingSchools: 0 };
      }
      const a = dirAgg[d.id];
      govMap[gov].present          += a.present;
      govMap[gov].late             += a.late;
      govMap[gov].absent           += a.absent;
      govMap[gov].excused          += a.excused;
      govMap[gov].reportingSchools += a.reportingSchools.size;
    }

    const rows = Object.values(govMap).sort((a, b) => a.governorate.localeCompare(b.governorate, 'ar'));
    if (rows.length === 0) { showEmpty('لا تتوفر بيانات.'); return; }

    renderStats(rows);
    renderTable(rows);
    setLastUpdated();

  } catch (err) {
    console.error('NSAMS Ministry load error:', err);
    tableLoading.classList.add('hidden');
    tableEmpty.textContent = 'خطأ في تحميل البيانات: ' + (err.message || String(err));
    tableEmpty.classList.remove('hidden');
  }
}

function showEmpty(msg = 'لا تتوفر بيانات حضور لهذا اليوم.') {
  tableLoading.classList.add('hidden');
  tableEmpty.textContent = msg;
  tableEmpty.classList.remove('hidden');
}

// ── Render Stats (الكروت العلوية) ─────────────────────────────────────────────
function renderStats(rows) {
  let present = 0, late = 0, absent = 0, excused = 0;
  for (const r of rows) {
    present += r.present; late += r.late; absent += r.absent; excused += r.excused;
  }
  const enrolled  = present + late + absent + excused;   // كل المسجّلين اليوم
  const attending = present + late + excused;            // الحاضرون (قرار المستخدم)

  statGov.textContent     = rows.length;                 // المحافظات
  statTotal.textContent   = fmt(enrolled);               // إجمالي الطلاب (المسجّلون اليوم)
  statPresent.textContent = fmt(attending);              // الحاضرون
  statAbsent.textContent  = fmt(absent);                 // الغائبون
  statRate.textContent    = pct(attending, enrolled);    // نسبة الحضور الوطنية الحقيقية
}

// ── Render Table (جدول المحافظات) ─────────────────────────────────────────────
function renderTable(rows) {
  tableLoading.classList.add('hidden');
  tableData = rows;

  let tPresent = 0, tLate = 0, tAbsent = 0, tExcused = 0, tReporting = 0;

  govTbody.innerHTML = rows.map((row, i) => {
    const enrolled  = row.present + row.late + row.absent + row.excused;
    const attending = row.present + row.late + row.excused;
    const rate      = enrolled > 0 ? (attending / enrolled * 100) : null;
    const rateStr   = rate !== null ? rate.toFixed(1) : null;
    const barClass  = rateBarClass(rateStr);
    const barWidth  = rate !== null ? rate.toFixed(1) : 0;

    tPresent += row.present; tLate += row.late; tAbsent += row.absent;
    tExcused += row.excused; tReporting += row.reportingSchools;

    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${row.governorate}</strong></td>
        <td>${fmt(row.reportingSchools)}</td>
        <td>${fmt(enrolled)}</td>
        <td style="color:#4ade80">${fmt(attending)}</td>
        <td style="color:#f87171">${fmt(row.absent)}</td>
        <td>
          <div class="rate-cell">
            <div class="rate-bar-bg">
              <div class="rate-bar-fill ${barClass}" style="width:${barWidth}%"></div>
            </div>
            <span class="rate-text" style="color:${
              barClass === 'green'  ? '#4ade80' :
              barClass === 'yellow' ? '#fde047' :
              barClass === 'red'    ? '#f87171' : '#64748b'
            }">
              ${rateStr !== null ? rateStr + '%' : '—'}
            </span>
          </div>
        </td>
        <td>${rateBadge(rateStr)}</td>
      </tr>`;
  }).join('');

  const totEnrolled  = tPresent + tLate + tAbsent + tExcused;
  const totAttending = tPresent + tLate + tExcused;
  const nationalRate = totEnrolled > 0 ? (totAttending / totEnrolled * 100).toFixed(1) : null;

  govTfoot.innerHTML = `
    <tr>
      <td></td>
      <td>الإجمالي الوطني</td>
      <td>${fmt(tReporting)}</td>
      <td>${fmt(totEnrolled)}</td>
      <td style="color:#4ade80">${fmt(totAttending)}</td>
      <td style="color:#f87171">${fmt(tAbsent)}</td>
      <td>${nationalRate !== null ? nationalRate + '%' : '—'}</td>
      <td>${rateBadge(nationalRate)}</td>
    </tr>`;

  tableWrapper.classList.remove('hidden');
}

// ── Refresh ───────────────────────────────────────────────────────────────────
refreshBtn.addEventListener('click', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) loadAllData();
});

// ── CSV Export ────────────────────────────────────────────────────────────────
exportBtn.addEventListener('click', () => {
  if (!tableData.length) return;

  const dateStr = today();
  const headers = ['المحافظة', 'المدارس المُسجّلة', 'إجمالي الطلاب', 'الحاضرون', 'الغائبون', 'نسبة الحضور (%)'];

  const dataLines = tableData.map(row => {
    const enrolled  = row.present + row.late + row.absent + row.excused;
    const attending = row.present + row.late + row.excused;
    const rate      = enrolled > 0 ? (attending / enrolled * 100).toFixed(1) : '';
    return [
      `"${row.governorate}"`,
      row.reportingSchools,
      enrolled,
      attending,
      row.absent,
      rate,
    ].join(',');
  });

  // سطر المجاميع
  let tPresent = 0, tLate = 0, tAbsent = 0, tExcused = 0, tReporting = 0;
  tableData.forEach(r => {
    tPresent += r.present; tLate += r.late; tAbsent += r.absent;
    tExcused += r.excused; tReporting += r.reportingSchools;
  });
  const totEnrolled  = tPresent + tLate + tAbsent + tExcused;
  const totAttending = tPresent + tLate + tExcused;
  const totRate = totEnrolled > 0 ? (totAttending / totEnrolled * 100).toFixed(1) : '';

  const csvRows = [
    `# تقرير الحضور الوطني NSAMS — ${dateStr}`,
    headers.join(','),
    ...dataLines,
    ['"الإجمالي الوطني"', tReporting, totEnrolled, totAttending, tAbsent, totRate].join(','),
  ];

  // BOM لضمان عرض العربية صحيحاً في Excel
  const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `nsams_national_report_${dateStr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── Boot ──────────────────────────────────────────────────────────────────────
checkSession();