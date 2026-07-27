import { supabase, supabaseUrl } from '../shared/db.js';
import { CustomSelect } from '../shared/csel.js';

const EDGE_BASE = supabaseUrl + '/functions/v1';

// ── Audit log translation maps ────────────────────────────────────────────────
const AUDIT_ACTION_LABELS = {
  create: 'إضافة', update: 'تعديل', delete: 'حذف',
  archive: 'أرشفة', transfer: 'نقل', promote: 'ترفيع',
  graduate: 'تخريج', flag_dropout: 'ترقين قيد',
};
const AUDIT_ENTITY_LABELS = {
  student: 'طالب', class: 'صف', school: 'مدرسة',
  report: 'بلاغ', user: 'مستخدم', holiday: 'عطلة',
};
const AUDIT_FIELD_LABELS = {
  full_name: 'الاسم الكامل', gender: 'الجنس', birth_date: 'تاريخ الميلاد',
  class_id: 'الصف', is_active: 'الحالة', national_id: 'الرقم الوطني',
  grade: 'المرحلة', section: 'الشعبة', academic_year: 'العام الدراسي',
  result: 'النتيجة', name: 'الاسم',
};
const AUDIT_VALUE_LABELS = {
  male: 'ذكر', female: 'أنثى', true: 'نعم', false: 'لا',
  'ناجح': 'ناجح', 'راسب': 'راسب',
};

function buildAuditChangesText(changes) {
  if (!changes || typeof changes !== 'object') return JSON.stringify(changes, null, 2);
  const lines = [];
  for (const [k, v] of Object.entries(changes)) {
    const label = AUDIT_FIELD_LABELS[k] ?? k;
    let val = v;
    if (val !== null && val !== undefined) {
      const strVal = String(val);
      val = AUDIT_VALUE_LABELS[strVal] ?? strVal;
      // format date strings YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(strVal)) {
        val = new Date(strVal).toLocaleDateString('ar-SY');
      }
    }
    lines.push(`${label}: ${val ?? '—'}`);
  }
  return lines.join('\n');
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const loginScreen   = document.getElementById('login-screen');
const dashboard     = document.getElementById('dashboard');
const loginBtn      = document.getElementById('login-btn');
const logoutBtn     = document.getElementById('logout-btn');
const emailInput    = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginError    = document.getElementById('login-error');
const userEmailEl   = document.getElementById('user-email');

// Tab
const tabBtns   = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

// Schools tab
const schoolsCount     = document.getElementById('schools-count');
const schoolsLoading   = document.getElementById('schools-loading');
const schoolsTableWrap = document.getElementById('schools-table-wrap');
const schoolsEmpty     = document.getElementById('schools-empty');
const schoolsTbody     = document.getElementById('schools-tbody');
const addSchoolBtn     = document.getElementById('add-school-btn');

// Users tab
const usersCount     = document.getElementById('users-count');
const usersLoading   = document.getElementById('users-loading');
const usersTableWrap = document.getElementById('users-table-wrap');
const usersEmpty     = document.getElementById('users-empty');
const usersTbody     = document.getElementById('users-tbody');
const addUserBtn     = document.getElementById('add-user-btn');
const usersRoleFilter = document.getElementById('users-role-filter');

// Audit tab
const auditLoading     = document.getElementById('audit-loading');
const auditTableWrap   = document.getElementById('audit-table-wrap');
const auditEmpty       = document.getElementById('audit-empty');
const auditTbody       = document.getElementById('audit-tbody');
const auditSchoolFilter= document.getElementById('audit-school-filter');
const auditFromInput   = document.getElementById('audit-from');
const auditToInput     = document.getElementById('audit-to');
const auditFilterBtn   = document.getElementById('audit-filter-btn');
const auditLoadMoreWrap= document.getElementById('audit-load-more-wrap');
const auditLoadMoreBtn = document.getElementById('audit-load-more');

// School modal
const schoolModal       = document.getElementById('school-modal');
const schoolModalTitle  = document.getElementById('school-modal-title');
const schoolModalError  = document.getElementById('school-modal-error');
const schoolModalClose  = document.getElementById('school-modal-close');
const schoolModalCancel = document.getElementById('school-modal-cancel');
const schoolModalSave   = document.getElementById('school-modal-save');
const smName            = document.getElementById('sm-name');
const smDirectorate     = document.getElementById('sm-directorate');
const smLat             = document.getElementById('sm-lat');
const smLng             = document.getElementById('sm-lng');
const smClassification  = document.getElementById('sm-classification');
const smEducationType   = document.getElementById('sm-education-type');
const smShift           = document.getElementById('sm-shift');
const smStudentType     = document.getElementById('sm-student-type');
const smTotalStudents   = document.getElementById('sm-total-students');
const smTotalTeachers   = document.getElementById('sm-total-teachers');
const smComplexName     = document.getElementById('sm-complex-name');

// User modal
const userModal         = document.getElementById('user-modal');
const userModalError    = document.getElementById('user-modal-error');
const userModalClose    = document.getElementById('user-modal-close');
const userModalCancel   = document.getElementById('user-modal-cancel');
const userModalSave     = document.getElementById('user-modal-save');
const umEmail           = document.getElementById('um-email');
const umFullname        = document.getElementById('um-fullname');
const umPassword        = document.getElementById('um-password');
const umRole            = document.getElementById('um-role');
const umSchoolGroup     = document.getElementById('um-school-group');
const umSchool          = document.getElementById('um-school');
const umDirGroup        = document.getElementById('um-directorate-group');
const umDir             = document.getElementById('um-directorate');

// Credentials modal
const credModal     = document.getElementById('cred-modal');
const credName      = document.getElementById('cred-name');
const credEmail     = document.getElementById('cred-email');
const credNotFound  = document.getElementById('cred-not-found');
const credModalClose= document.getElementById('cred-modal-close');
const credModalOk   = document.getElementById('cred-modal-ok');

// Deactivate modal
const deactivateModal   = document.getElementById('deactivate-modal');
const deactivateName    = document.getElementById('deactivate-name');
const deactivateError   = document.getElementById('deactivate-modal-error');
const deactivateClose   = document.getElementById('deactivate-modal-close');
const deactivateCancel  = document.getElementById('deactivate-modal-cancel');
const deactivateConfirm = document.getElementById('deactivate-modal-confirm');

// ── Custom selects ────────────────────────────────────────────────────────────
CustomSelect.enhance('users-role-filter');
CustomSelect.enhance('audit-school-filter');
CustomSelect.enhance('sm-directorate');
CustomSelect.enhance('sm-classification');
CustomSelect.enhance('sm-education-type');
CustomSelect.enhance('sm-shift');
CustomSelect.enhance('sm-student-type');
CustomSelect.enhance('um-role');
CustomSelect.enhance('um-school');
CustomSelect.enhance('um-directorate');

// Holidays tab DOM refs
const holidaysCount     = document.getElementById('holidays-count');
const holidaysLoading   = document.getElementById('holidays-loading');
const holidaysTableWrap = document.getElementById('holidays-table-wrap');
const holidaysEmpty     = document.getElementById('holidays-empty');
const holidaysTbody     = document.getElementById('holidays-tbody');
const addHolidayBtn     = document.getElementById('add-holiday-btn');
const holidayModal      = document.getElementById('holiday-modal');
const holidayModalError = document.getElementById('holiday-modal-error');
const holidayModalClose = document.getElementById('holiday-modal-close');
const holidayModalCancel= document.getElementById('holiday-modal-cancel');
const holidayModalSave  = document.getElementById('holiday-modal-save');
const hmDate            = document.getElementById('hm-date');
const hmName            = document.getElementById('hm-name');
const delHolidayModal   = document.getElementById('delete-holiday-modal');
const delHolidayName    = document.getElementById('del-holiday-name');
const delHolidayClose   = document.getElementById('del-holiday-close');
const delHolidayCancel  = document.getElementById('del-holiday-cancel');
const delHolidayConfirm = document.getElementById('del-holiday-confirm');

// ── State ─────────────────────────────────────────────────────────────────────
let allSchools     = [];   // { id, name, directorate_id, directorates:{name,governorate}, ... }
let allUsers       = [];   // { id, full_name, role, school_id, directorate_id, schools, directorates }
let allDirectorates= [];   // { id, name, governorate }
let editingSchoolId= null; // null = create mode
let pendingDeactivateId = null;
let pendingDeleteHolidayId = null;
let auditOffset    = 0;
const AUDIT_LIMIT  = 100;

// ── Helpers ───────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const hide = (el) => el.classList.add('hidden');
const show = (el) => el.classList.remove('hidden');
function showError(el, msg) { el.textContent = msg; show(el); }
function clearError(el) { el.textContent = ''; hide(el); }

function roleName(role) {
  return { school_admin: 'مدير مدرسة', directorate_user: 'مشرف مديرية', ministry_user: 'مستخدم وزارة' }[role] ?? role;
}
function roleBadgeClass(role) {
  return { school_admin: 'role-school-admin', directorate_user: 'role-directorate', ministry_user: 'role-ministry' }[role] ?? '';
}

async function edgeFetch(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${EDGE_BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const ok = await verifyRole(session.user.id);
  if (ok) showDashboard(session.user.email);
}

async function verifyRole(userId) {
  const { data } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
  return data?.role === 'ministry_user';
}

async function doLogin() {
  clearError(loginError);
  const email    = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) { showError(loginError, 'أدخل البريد وكلمة المرور.'); return; }
  loginBtn.disabled = true;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const ok = await verifyRole(data.user.id);
    if (!ok) {
      await supabase.auth.signOut();
      showError(loginError, 'هذه البوابة مخصصة لمشرف النظام فقط.');
      return;
    }
    showDashboard(data.user.email);
  } catch (e) {
    showError(loginError, e.message);
  } finally {
    loginBtn.disabled = false;
  }
}

function showDashboard(email) {
  hide(loginScreen);
  show(dashboard);
  userEmailEl.textContent = email;

  // Web Push registration (fire-and-forget) — admin users are ministry_user and
  // must subscribe here to receive OS push notifications.
  if ('Notification' in window) {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') window.NSAMS_DB.registerPushSubscription().catch(() => {});
    });
  }

  loadDirectorates().then(() => {
    loadSchools();
    loadUsers();
    populateAuditSchoolFilter();
    loadHolidays();
    loadLookups();
    loadSubjectCatalog();
  });
}

const modalConfirmLogout = document.getElementById('modal-confirm-logout');
const btnLogoutCancel    = document.getElementById('btn-logout-cancel');
const btnLogoutOk        = document.getElementById('btn-logout-ok');

logoutBtn.addEventListener('click', () => { modalConfirmLogout.hidden = false; });
btnLogoutCancel.addEventListener('click', () => { modalConfirmLogout.hidden = true; });
modalConfirmLogout.addEventListener('click', e => {
  if (e.target === modalConfirmLogout) modalConfirmLogout.hidden = true;
});
btnLogoutOk.addEventListener('click', async () => {
  modalConfirmLogout.hidden = true;
  await supabase.auth.signOut();
  location.reload();
});

loginBtn.addEventListener('click', doLogin);
emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordInput.focus(); });
passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

// ── Tabs + history ────────────────────────────────────────────────────────────
let _adminNavDepth = 0;
const _adminBackBtn = document.getElementById('btn-back-nav');

function _adminActivateTab(tabName) {
  tabBtns.forEach(b => b.classList.remove('is-active'));
  tabPanels.forEach(p => p.classList.remove('is-active'));
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) btn.classList.add('is-active');
  document.getElementById(`tab-${tabName}`)?.classList.add('is-active');
}

history.replaceState({ tab: 'schools', d: 0 }, '', '#schools');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    _adminNavDepth++;
    history.pushState({ tab: btn.dataset.tab, d: _adminNavDepth }, '', '#' + btn.dataset.tab);
    if (_adminBackBtn) _adminBackBtn.hidden = false;
    _adminActivateTab(btn.dataset.tab);
  });
});

window.addEventListener('popstate', e => {
  _adminNavDepth = e.state?.d ?? 0;
  if (_adminBackBtn) _adminBackBtn.hidden = (_adminNavDepth === 0);
  const tab = e.state?.tab;
  if (tab) _adminActivateTab(tab);
});

if (_adminBackBtn) {
  _adminBackBtn.addEventListener('click', () => history.back());
}

// ── Directorates (shared lookup) ──────────────────────────────────────────────
async function loadDirectorates() {
  const { data, error } = await supabase
    .from('directorates').select('id, name, governorate').order('name');
  if (error) { console.warn('[admin] loadDirectorates', error); return; }
  allDirectorates = data ?? [];

  // Populate dropdowns
  [smDirectorate, umDir, lkDirFilter].forEach(sel => {
    while (sel.options.length > 1) sel.remove(1);
    allDirectorates.forEach(d => {
      const o = new Option(`${d.name}`, d.id);
      sel.add(o);
    });
    CustomSelect.refresh(sel);
  });
}

// ── Schools tab ───────────────────────────────────────────────────────────────
async function loadSchools() {
  show(schoolsLoading);
  hide(schoolsTableWrap);
  hide(schoolsEmpty);

  const { data, error } = await supabase
    .from('schools')
    .select('id, name, directorate_id, directorates(name, governorate), classification, education_type, shift, student_type, total_students, total_teachers, lat, lng, complex_name')
    .order('name');

  hide(schoolsLoading);

  if (error) { schoolsCount.textContent = '!'; console.error(error); return; }
  allSchools = data ?? [];
  schoolsCount.textContent = allSchools.length;

  // Populate audit school filter
  populateAuditSchoolFilter();

  // Populate school dropdown in user modal
  while (umSchool.options.length > 1) umSchool.remove(1);
  allSchools.forEach(s => umSchool.add(new Option(s.name, s.id)));
  CustomSelect.refresh(umSchool);

  if (allSchools.length === 0) { show(schoolsEmpty); return; }

  schoolsTbody.innerHTML = allSchools.map((s, i) => `
    <tr>
      <td class="muted">${i + 1}</td>
      <td>${esc(s.name)}</td>
      <td>${esc(s.directorates?.name ?? '—')}</td>
      <td>${esc(s.directorates?.governorate ?? '—')}</td>
      <td>${esc(s.classification ?? '—')}</td>
      <td>${s.total_students ?? '—'}</td>
      <td>${s.total_teachers ?? '—'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" data-edit-school="${esc(s.id)}">
          <svg width="13" height="13"><use href="#icon-edit"/></svg>
          تعديل
        </button>
      </td>
    </tr>
  `).join('');
  show(schoolsTableWrap);

  schoolsTbody.querySelectorAll('[data-edit-school]').forEach(btn => {
    btn.addEventListener('click', () => openEditSchool(btn.dataset.editSchool));
  });
}

function openAddSchool() {
  editingSchoolId = null;
  schoolModalTitle.textContent = 'إضافة مدرسة';
  [smName, smLat, smLng, smTotalStudents, smTotalTeachers, smComplexName].forEach(el => el.value = '');
  smDirectorate.value = '';
  smClassification.value = '';
  smEducationType.value = '';
  smShift.value = '';
  smStudentType.value = '';
  [smDirectorate, smClassification, smEducationType, smShift, smStudentType].forEach(s => CustomSelect.refresh(s));
  clearError(schoolModalError);
  show(schoolModal);
  smName.focus();
}

function openEditSchool(schoolId) {
  const s = allSchools.find(x => x.id === schoolId);
  if (!s) return;
  editingSchoolId = schoolId;
  schoolModalTitle.textContent = 'تعديل مدرسة';
  smName.value            = s.name ?? '';
  smDirectorate.value     = s.directorate_id ?? '';
  smLat.value             = s.lat ?? '';
  smLng.value             = s.lng ?? '';
  smClassification.value  = s.classification ?? '';
  smEducationType.value   = s.education_type ?? '';
  smShift.value           = s.shift ?? '';
  smStudentType.value     = s.student_type ?? '';
  smTotalStudents.value   = s.total_students ?? '';
  smTotalTeachers.value   = s.total_teachers ?? '';
  smComplexName.value     = s.complex_name ?? '';
  [smDirectorate, smClassification, smEducationType, smShift, smStudentType].forEach(s => CustomSelect.refresh(s));
  clearError(schoolModalError);
  show(schoolModal);
  smName.focus();
}

function closeSchoolModal() { hide(schoolModal); }
schoolModalClose.addEventListener('click', closeSchoolModal);
schoolModalCancel.addEventListener('click', closeSchoolModal);
addSchoolBtn.addEventListener('click', openAddSchool);

schoolModalSave.addEventListener('click', async () => {
  clearError(schoolModalError);
  const name = smName.value.trim();
  const dirId = smDirectorate.value;
  if (!name)  { showError(schoolModalError, 'اسم المدرسة مطلوب.'); return; }
  if (!dirId) { showError(schoolModalError, 'يجب اختيار المديرية.'); return; }

  schoolModalSave.disabled = true;
  try {
    const row = {
      name,
      directorate_id: dirId,
      lat:             smLat.value       ? parseFloat(smLat.value)  : null,
      lng:             smLng.value       ? parseFloat(smLng.value)  : null,
      classification:  smClassification.value  || null,
      education_type:  smEducationType.value   || null,
      shift:           smShift.value           || null,
      student_type:    smStudentType.value      || null,
      total_students:  smTotalStudents.value !== '' ? parseInt(smTotalStudents.value, 10) : null,
      total_teachers:  smTotalTeachers.value !== '' ? parseInt(smTotalTeachers.value, 10) : null,
      complex_name:    smComplexName.value.trim() || null,
    };

    let err;
    if (editingSchoolId) {
      ({ error: err } = await supabase.from('schools').update(row).eq('id', editingSchoolId));
    } else {
      ({ error: err } = await supabase.from('schools').insert(row));
    }
    if (err) throw err;

    closeSchoolModal();
    await loadSchools();
  } catch (e) {
    showError(schoolModalError, e.message);
  } finally {
    schoolModalSave.disabled = false;
  }
});

// ── Users tab ─────────────────────────────────────────────────────────────────
async function loadUsers() {
  show(usersLoading);
  hide(usersTableWrap);
  hide(usersEmpty);

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, role, is_active, school_id, directorate_id, schools(name), directorates(name)')
    .in('role', ['school_admin', 'directorate_user', 'ministry_user'])
    .order('role')
    .order('full_name');

  hide(usersLoading);

  if (error) { usersCount.textContent = '!'; console.error(error); return; }
  allUsers = data ?? [];
  renderUsers();
}

function renderUsers() {
  const roleFilter = usersRoleFilter.value;
  const filtered   = roleFilter ? allUsers.filter(u => u.role === roleFilter) : allUsers;
  usersCount.textContent = filtered.length;

  if (filtered.length === 0) { hide(usersTableWrap); show(usersEmpty); return; }

  usersTbody.innerHTML = filtered.map((u, i) => {
    const org = u.schools?.name ?? u.directorates?.name ?? '—';
    return `
    <tr style="cursor:pointer" data-view-cred="${esc(u.id)}" data-cred-name="${esc(u.full_name ?? '')}">
      <td class="muted">${i + 1}</td>
      <td>${esc(u.full_name ?? '—')}</td>
      <td><span class="role-badge ${roleBadgeClass(u.role)}">${roleName(u.role)}</span></td>
      <td>${esc(org)}</td>
      <td>${u.role !== 'ministry_user' ? (
        u.is_active === false
          ? `<span class="badge-inactive">مُعطَّل</span>`
          : `<button class="btn btn-danger btn-sm" data-deactivate="${esc(u.id)}" data-name="${esc(u.full_name)}">تعطيل</button>`
      ) : ''}
      </td>
    </tr>`;
  }).join('');
  show(usersTableWrap);
  hide(usersEmpty);

  usersTbody.querySelectorAll('[data-deactivate]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openDeactivate(btn.dataset.deactivate, btn.dataset.name);
    });
  });
  usersTbody.querySelectorAll('[data-view-cred]').forEach(row => {
    row.addEventListener('click', () => openCredModal(row.dataset.viewCred, row.dataset.credName));
  });
}

usersRoleFilter.addEventListener('change', renderUsers);

function openAddUser() {
  clearError(userModalError);
  umEmail.value = '';
  umFullname.value = '';
  umPassword.value = '';
  umRole.value = '';
  CustomSelect.refresh(umRole);
  umSchoolGroup.style.display = 'none';
  umDirGroup.style.display = 'none';
  show(userModal);
  umEmail.focus();
}

function closeUserModal() { hide(userModal); }
userModalClose.addEventListener('click', closeUserModal);
userModalCancel.addEventListener('click', closeUserModal);
addUserBtn.addEventListener('click', openAddUser);

umRole.addEventListener('change', () => {
  umSchoolGroup.style.display  = umRole.value === 'school_admin'      ? '' : 'none';
  umDirGroup.style.display     = umRole.value === 'directorate_user'  ? '' : 'none';
});

[umEmail, umPassword, umFullname].forEach(el =>
  el.addEventListener('input', () => clearError(userModalError)));

userModalSave.addEventListener('click', async () => {
  clearError(userModalError);
  const email    = umEmail.value.trim().toLowerCase();
  const fullName = umFullname.value.trim();
  const password = umPassword.value;
  const role     = umRole.value;
  const schoolId = umSchool.value;
  const dirId    = umDir.value;

  if (!email)               { showError(userModalError, 'أدخل البريد الإلكتروني.'); return; }
  if (!email.includes('@')) { showError(userModalError, 'البريد الإلكتروني غير صالح.'); return; }
  if (!password)            { showError(userModalError, 'أدخل كلمة المرور.'); return; }
  if (password.length < 8)  { showError(userModalError, 'كلمة المرور ٨ أحرف على الأقل.'); return; }
  if (!fullName)            { showError(userModalError, 'أدخل الاسم الكامل.'); return; }
  if (!role)                { showError(userModalError, 'اختر الدور.'); return; }
  if (role === 'school_admin' && !schoolId)      { showError(userModalError, 'اختر المدرسة.'); return; }
  if (role === 'directorate_user' && !dirId)     { showError(userModalError, 'اختر المديرية.'); return; }

  userModalSave.disabled = true;
  try {
    const action = role === 'school_admin' ? 'create_school_admin' : 'create_directorate_user';
    const body   = { action, email, fullName, password };
    if (role === 'school_admin')     body.schoolId      = schoolId;
    if (role === 'directorate_user') body.directorateId = dirId;

    await edgeFetch('admin-create-user', body);
    closeUserModal();
    await loadUsers();
  } catch (e) {
    showError(userModalError, e.message);
  } finally {
    userModalSave.disabled = false;
  }
});

// ── Deactivate modal ──────────────────────────────────────────────────────────
function openDeactivate(userId, name) {
  pendingDeactivateId = userId;
  deactivateName.textContent = name;
  clearError(deactivateError);
  show(deactivateModal);
}

function closeDeactivateModal() { hide(deactivateModal); pendingDeactivateId = null; }
deactivateClose.addEventListener('click', closeDeactivateModal);
deactivateCancel.addEventListener('click', closeDeactivateModal);

deactivateConfirm.addEventListener('click', async () => {
  if (!pendingDeactivateId) return;
  clearError(deactivateError);
  deactivateConfirm.disabled = true;
  try {
    await edgeFetch('admin-create-user', { action: 'deactivate', userId: pendingDeactivateId });
    closeDeactivateModal();
    await loadUsers();
  } catch (e) {
    showError(deactivateError, e.message);
  } finally {
    deactivateConfirm.disabled = false;
  }
});

// ── Audit tab ─────────────────────────────────────────────────────────────────
function populateAuditSchoolFilter() {
  while (auditSchoolFilter.options.length > 1) auditSchoolFilter.remove(1);
  allSchools.forEach(s => auditSchoolFilter.add(new Option(s.name, s.id)));
  CustomSelect.refresh(auditSchoolFilter);
}

async function loadAudit(reset = true) {
  if (reset) {
    auditOffset = 0;
    auditTbody.innerHTML = '';
    hide(auditLoadMoreWrap);
  }

  show(auditLoading);
  hide(auditEmpty);

  const schoolId = auditSchoolFilter.value || null;
  const from     = auditFromInput.value  || null;
  const to       = auditToInput.value    ? auditToInput.value + 'T23:59:59' : null;

  let q = supabase
    .from('audit_log')
    .select('id, school_id, actor_id, entity, action, changes, reason, created_at')
    .order('created_at', { ascending: false })
    .range(auditOffset, auditOffset + AUDIT_LIMIT - 1);

  if (schoolId) q = q.eq('school_id', schoolId);
  if (from)     q = q.gte('created_at', from);
  if (to)       q = q.lte('created_at', to);

  const { data, error } = await q;
  hide(auditLoading);

  if (error) {
    auditEmpty.textContent = 'خطأ في تحميل السجل: ' + error.message;
    show(auditEmpty);
    return;
  }

  const rows = data ?? [];
  if (reset && rows.length === 0) {
    auditEmpty.textContent = 'لا توجد سجلات تطابق الفلتر.';
    show(auditEmpty);
    return;
  }

  // Build school-name map: seed from already-loaded allSchools, then batch-fetch
  // any IDs not yet known (audit viewed before schools tab, or new schools added).
  const schoolMap = {};
  allSchools.forEach(s => { schoolMap[s.id] = s.name; });
  const missingSchoolIds = [...new Set(rows.map(r => r.school_id).filter(id => id && !schoolMap[id]))];
  if (missingSchoolIds.length > 0) {
    const { data: schoolRows } = await supabase
      .from('schools').select('id, name').in('id', missingSchoolIds);
    (schoolRows ?? []).forEach(s => { schoolMap[s.id] = s.name; });
  }

  // Batch-fetch actor names (UUIDs from actor_id column → full_name in users)
  const actorIds = [...new Set(rows.map(r => r.actor_id).filter(Boolean))];
  const nameMap  = {};
  if (actorIds.length > 0) {
    const { data: nameRows } = await supabase
      .from('users').select('id, full_name').in('id', actorIds);
    (nameRows ?? []).forEach(u => { nameMap[u.id] = u.full_name; });
  }

  rows.forEach(r => {
    const date = new Date(r.created_at).toLocaleString('ar-SY', { dateStyle: 'short', timeStyle: 'short' });
    const schoolName = (r.school_id && schoolMap[r.school_id]) || '—';
    const actorCell = (r.actor_id && nameMap[r.actor_id])
      ? esc(nameMap[r.actor_id])
      : (r.actor_id
          ? `<button type="button" class="actor-id" data-full="${esc(r.actor_id)}" title="انقر لعرض المعرّف كاملاً">${esc(r.actor_id.slice(0, 8))}…</button>`
          : '—');
    const changesId  = `ch-${r.id}`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="muted" style="white-space:nowrap">${esc(date)}</td>
      <td>${esc(schoolName)}</td>
      <td>${actorCell}</td>
      <td>${esc(AUDIT_ENTITY_LABELS[r.entity] ?? r.entity ?? '—')}</td>
      <td>${esc(AUDIT_ACTION_LABELS[r.action] ?? r.action ?? '—')}</td>
      <td>
        ${r.changes ? `
          <button class="changes-toggle" data-target="${changesId}">عرض</button>
          <pre class="changes-json hidden" id="${changesId}">${esc(buildAuditChangesText(r.changes))}</pre>
        ` : '—'}
      </td>`;
    auditTbody.appendChild(tr);
  });

  show(auditTableWrap);

  auditTbody.querySelectorAll('.changes-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const pre = document.getElementById(btn.dataset.target);
      if (!pre) return;
      pre.classList.toggle('hidden');
      btn.textContent = pre.classList.contains('hidden') ? 'عرض' : 'إخفاء';
    });
  });

  auditTbody.querySelectorAll('.actor-id').forEach(btn => {
    btn.addEventListener('click', () => {
      const full = btn.dataset.full;
      if (btn.textContent.includes('…')) {
        btn.textContent = full;
      } else {
        btn.textContent = full.slice(0, 8) + '…';
      }
    });
  });

  if (rows.length === AUDIT_LIMIT) {
    auditOffset += AUDIT_LIMIT;
    show(auditLoadMoreWrap);
  } else {
    hide(auditLoadMoreWrap);
  }
}

auditFilterBtn.addEventListener('click', () => loadAudit(true));
auditLoadMoreBtn.addEventListener('click', () => loadAudit(false));

// ── Holidays tab ──────────────────────────────────────────────────────────────
let allHolidays = [];

async function loadHolidays() {
  show(holidaysLoading);
  hide(holidaysTableWrap);
  hide(holidaysEmpty);

  try {
    const { data, error } = await supabase
      .from('school_holidays').select('id, date, name, created_at').order('date');
    if (error) throw error;
    allHolidays = data ?? [];
  } catch (e) {
    console.error('[admin] loadHolidays', e);
    allHolidays = [];
  }

  hide(holidaysLoading);
  holidaysCount.textContent = allHolidays.length;

  if (allHolidays.length === 0) { show(holidaysEmpty); return; }

  holidaysTbody.innerHTML = allHolidays.map((h, i) => {
    const d = new Date(h.date + 'T00:00:00').toLocaleDateString('ar-SY', { dateStyle: 'long' });
    return `
    <tr>
      <td class="muted">${i + 1}</td>
      <td>${esc(d)}</td>
      <td>${esc(h.name)}</td>
      <td>
        <button class="btn btn-danger btn-sm" data-del-holiday="${esc(h.id)}" data-del-name="${esc(h.name)}">
          حذف
        </button>
      </td>
    </tr>`;
  }).join('');
  show(holidaysTableWrap);

  holidaysTbody.querySelectorAll('[data-del-holiday]').forEach(btn => {
    btn.addEventListener('click', () => openDeleteHoliday(btn.dataset.delHoliday, btn.dataset.delName));
  });
}

function openAddHoliday() {
  hmDate.value = '';
  hmName.value = '';
  clearError(holidayModalError);
  show(holidayModal);
  hmDate.focus();
}

function closeHolidayModal() { hide(holidayModal); }
holidayModalClose.addEventListener('click', closeHolidayModal);
holidayModalCancel.addEventListener('click', closeHolidayModal);
addHolidayBtn.addEventListener('click', openAddHoliday);

holidayModalSave.addEventListener('click', async () => {
  clearError(holidayModalError);
  const date = hmDate.value;
  const name = hmName.value.trim();
  if (!date) { showError(holidayModalError, 'التاريخ مطلوب.'); return; }
  if (!name) { showError(holidayModalError, 'اسم العطلة مطلوب.'); return; }

  holidayModalSave.disabled = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('school_holidays')
      .insert({ date, name, created_by: user?.id ?? null });
    if (error) throw error;
    closeHolidayModal();
    await loadHolidays();
  } catch (e) {
    const dup = /duplicate|unique|already/i.test(e.message);
    showError(holidayModalError, dup ? 'هذا التاريخ مسجّل مسبقاً.' : e.message);
  } finally {
    holidayModalSave.disabled = false;
  }
});

function openDeleteHoliday(id, name) {
  pendingDeleteHolidayId = id;
  delHolidayName.textContent = name;
  show(delHolidayModal);
}

function closeDeleteHolidayModal() { hide(delHolidayModal); pendingDeleteHolidayId = null; }
delHolidayClose.addEventListener('click', closeDeleteHolidayModal);
delHolidayCancel.addEventListener('click', closeDeleteHolidayModal);

delHolidayConfirm.addEventListener('click', async () => {
  if (!pendingDeleteHolidayId) return;
  delHolidayConfirm.disabled = true;
  try {
    const { error } = await supabase
      .from('school_holidays').delete().eq('id', pendingDeleteHolidayId);
    if (error) throw error;
    closeDeleteHolidayModal();
    await loadHolidays();
  } catch (e) {
    console.error('[admin] deleteHoliday', e);
  } finally {
    delHolidayConfirm.disabled = false;
  }
});

// ══════════════════════════════════════════════
//  القوائم المرجعية (lookup_lists)
// ══════════════════════════════════════════════

const LIST_TYPE_LABELS = {
  admin_role:         'الأعمال الإدارية',
  specialization:     'الاختصاصات',
  certificate:        'الشهادات',
  higher_degree:      'الشهادات العليا',
  leave_type:         'أنواع الإجازات',
  ministerial_doc:    'الوثائق / الموافقات',
  support_job:        'الأعمال المساندة',
  educational_zone:   'المناطق التعليمية (لكل مديرية)',
  job_title:          'الصفة الوظيفية — التكليف الفني',
  school_admin_role:  'الصفة الإدارية — التكليف الإداري',
};

// Lookups DOM refs
const lkTypeFilter    = document.getElementById('lk-type-filter');
const lkDirWrap       = document.getElementById('lk-dir-wrap');
const lkDirFilter     = document.getElementById('lk-dir-filter');
const addLookupBtn    = document.getElementById('add-lookup-btn');
const lookupsCount    = document.getElementById('lookups-count');
const lookupsLoading  = document.getElementById('lookups-loading');
const lookupsTableWrap= document.getElementById('lookups-table-wrap');
const lookupsEmpty    = document.getElementById('lookups-empty');
const lookupsHint     = document.getElementById('lookups-hint');
const lookupsTbody    = document.getElementById('lookups-tbody');
const lookupModal     = document.getElementById('lookup-modal');
const lookupModalTitle= document.getElementById('lookup-modal-title');
const lookupModalError= document.getElementById('lookup-modal-error');
const lookupModalClose= document.getElementById('lookup-modal-close');
const lookupModalCancel=document.getElementById('lookup-modal-cancel');
const lookupModalSave = document.getElementById('lookup-modal-save');
const lkTypeLabel     = document.getElementById('lk-type-label');
const lkDirRow        = document.getElementById('lk-dir-row');
const lkDirLabel      = document.getElementById('lk-dir-label');
const lkValue         = document.getElementById('lk-value');
const lkSort          = document.getElementById('lk-sort');
const lkActive        = document.getElementById('lk-active');
const delLookupModal  = document.getElementById('delete-lookup-modal');
const delLookupName   = document.getElementById('del-lookup-name');
const delLookupError  = document.getElementById('del-lookup-error');
const delLookupClose  = document.getElementById('del-lookup-close');
const delLookupCancel = document.getElementById('del-lookup-cancel');
const delLookupConfirm= document.getElementById('del-lookup-confirm');

let allLookups = [];
let editingLookupId = null;
let pendingDeleteLookupId = null;

// Build the list_type filter options, then enhance all three selects.
lkTypeFilter.innerHTML = Object.entries(LIST_TYPE_LABELS)
  .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
CustomSelect.enhance('lk-type-filter');
CustomSelect.enhance('lk-dir-filter');
CustomSelect.enhance('lk-active');

function lkIsPerDirectorate() { return lkTypeFilter.value === 'educational_zone'; }

function syncLookupDir() {
  lkDirWrap.style.display = lkIsPerDirectorate() ? 'inline-block' : 'none';
}

async function loadLookups() {
  syncLookupDir();
  const listType = lkTypeFilter.value;
  const per      = listType === 'educational_zone';
  const dirId    = lkDirFilter.value;

  hide(lookupsTableWrap);
  hide(lookupsEmpty);
  hide(lookupsHint);

  // educational_zone needs a directorate selected first
  if (per && !dirId) {
    if (addLookupBtn) addLookupBtn.disabled = true;
    lookupsCount.textContent = '—';
    show(lookupsHint);
    return;
  }
  if (addLookupBtn) addLookupBtn.disabled = false;

  show(lookupsLoading);
  try {
    let q = supabase.from('lookup_lists')
      .select('id, list_type, value, sort_order, active, directorate_id')
      .eq('list_type', listType)
      .order('sort_order').order('value');
    q = per ? q.eq('directorate_id', dirId) : q.is('directorate_id', null);
    const { data, error } = await q;
    if (error) throw error;
    allLookups = data ?? [];
  } catch (e) {
    console.error('[admin] loadLookups', e);
    allLookups = [];
  }
  hide(lookupsLoading);
  lookupsCount.textContent = allLookups.length;

  if (!allLookups.length) { show(lookupsEmpty); return; }

  lookupsTbody.innerHTML = allLookups.map((r, i) => `
    <tr>
      <td class="muted">${i + 1}</td>
      <td>${esc(r.value)}</td>
      <td class="muted">${r.sort_order ?? 0}</td>
      <td>${r.active
            ? 'نشط'
            : '<span style="color:var(--text-dim)">معطّل</span>'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" data-edit-lookup="${esc(r.id)}">
          <svg width="13" height="13"><use href="#icon-edit"/></svg>
          تعديل
        </button>
        <button class="btn btn-danger btn-sm" data-del-lookup="${esc(r.id)}" data-del-name="${esc(r.value)}">
          حذف
        </button>
      </td>
    </tr>`).join('');
  show(lookupsTableWrap);

  lookupsTbody.querySelectorAll('[data-edit-lookup]').forEach(btn => {
    btn.addEventListener('click', () => openEditLookup(btn.dataset.editLookup));
  });
  lookupsTbody.querySelectorAll('[data-del-lookup]').forEach(btn => {
    btn.addEventListener('click', () => openDeleteLookup(btn.dataset.delLookup, btn.dataset.delName));
  });
}

function openAddLookup() {
  const listType = lkTypeFilter.value;
  const per = listType === 'educational_zone';
  if (per && !lkDirFilter.value) return;   // guard (button is disabled in this state)
  editingLookupId = null;
  lookupModalTitle.textContent = 'إضافة عنصر';
  lkTypeLabel.value = LIST_TYPE_LABELS[listType] ?? listType;
  lkDirRow.style.display = per ? '' : 'none';
  if (per) {
    const d = allDirectorates.find(x => x.id === lkDirFilter.value);
    lkDirLabel.value = d ? `${d.name}` : '';
  }
  lkValue.value = '';
  lkSort.value  = allLookups.length ? (Math.max(...allLookups.map(r => r.sort_order || 0)) + 1) : 0;
  lkActive.value = 'true'; CustomSelect.refresh(lkActive);
  clearError(lookupModalError);
  show(lookupModal);
  lkValue.focus();
}

function openEditLookup(id) {
  const r = allLookups.find(x => x.id === id);
  if (!r) return;
  editingLookupId = id;
  lookupModalTitle.textContent = 'تعديل عنصر';
  lkTypeLabel.value = LIST_TYPE_LABELS[r.list_type] ?? r.list_type;
  const per = r.list_type === 'educational_zone';
  lkDirRow.style.display = per ? '' : 'none';
  if (per) {
    const d = allDirectorates.find(x => x.id === r.directorate_id);
    lkDirLabel.value = d ? `${d.name}` : '';
  }
  lkValue.value = r.value ?? '';
  lkSort.value  = r.sort_order ?? 0;
  lkActive.value = r.active ? 'true' : 'false'; CustomSelect.refresh(lkActive);
  clearError(lookupModalError);
  show(lookupModal);
  lkValue.focus();
}

function closeLookupModal() { hide(lookupModal); }

lookupModalClose.addEventListener('click', closeLookupModal);
lookupModalCancel.addEventListener('click', closeLookupModal);
addLookupBtn.addEventListener('click', openAddLookup);
lkTypeFilter.addEventListener('change', loadLookups);
lkDirFilter.addEventListener('change', loadLookups);

lookupModalSave.addEventListener('click', async () => {
  clearError(lookupModalError);
  const value = lkValue.value.trim();
  if (!value) { showError(lookupModalError, 'القيمة مطلوبة.'); return; }

  const editing = editingLookupId ? allLookups.find(r => r.id === editingLookupId) : null;
  const listType = editing ? editing.list_type : lkTypeFilter.value;
  const per = listType === 'educational_zone';
  const dirId = per ? (editing ? editing.directorate_id : lkDirFilter.value) : null;
  if (per && !dirId) { showError(lookupModalError, 'يجب اختيار مديرية.'); return; }

  const row = {
    list_type:      listType,
    value,
    sort_order:     lkSort.value !== '' ? (parseInt(lkSort.value, 10) || 0) : 0,
    active:         lkActive.value === 'true',
    directorate_id: dirId,
  };

  lookupModalSave.disabled = true;
  try {
    let err;
    if (editingLookupId) {
      ({ error: err } = await supabase.from('lookup_lists').update(row).eq('id', editingLookupId));
    } else {
      ({ error: err } = await supabase.from('lookup_lists').insert(row));
    }
    if (err) throw err;
    closeLookupModal();
    await loadLookups();
  } catch (e) {
    const dup = /duplicate|unique|already/i.test(e.message);
    showError(lookupModalError, dup ? 'هذه القيمة موجودة مسبقاً في هذه القائمة.' : e.message);
  } finally {
    lookupModalSave.disabled = false;
  }
});

function openDeleteLookup(id, name) {
  pendingDeleteLookupId = id;
  delLookupName.textContent = name;
  clearError(delLookupError);
  show(delLookupModal);
}

function closeDeleteLookupModal() { hide(delLookupModal); pendingDeleteLookupId = null; }
delLookupClose.addEventListener('click', closeDeleteLookupModal);
delLookupCancel.addEventListener('click', closeDeleteLookupModal);

delLookupConfirm.addEventListener('click', async () => {
  if (!pendingDeleteLookupId) return;
  delLookupConfirm.disabled = true;
  try {
    const { error } = await supabase.from('lookup_lists').delete().eq('id', pendingDeleteLookupId);
    if (error) throw error;
    closeDeleteLookupModal();
    await loadLookups();
  } catch (e) {
    showError(delLookupError, e.message);
  } finally {
    delLookupConfirm.disabled = false;
  }
});

// ── Credentials modal ─────────────────────────────────────────────────────────
// The stored password is never read back — handing an operator an existing
// credential puts the plaintext one screenshot away. They mint a fresh one,
// see it once, and pass it on; the stored copy is destroyed server-side.
let credUserId = null;

async function openCredModal(userId, name) {
  credUserId = userId;
  credName.textContent  = name || '—';
  credEmail.textContent = '…';
  credNotFound.classList.add('hidden');
  document.getElementById('cred-reset-box')?.classList.add('hidden');
  document.getElementById('cred-msg')?.classList.add('hidden');
  show(credModal);

  // Only the address is selected — the password column is deliberately not read.
  const { data, error } = await supabase
    .from('admin_credentials')
    .select('email')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    credEmail.textContent = '—';
    credNotFound.classList.remove('hidden');
  } else {
    credEmail.textContent = data.email;
  }
}

document.getElementById('cred-reset')?.addEventListener('click', async () => {
  if (!credUserId) return;
  const btn    = document.getElementById('cred-reset');
  const box    = document.getElementById('cred-reset-box');
  const msgEl  = document.getElementById('cred-msg');
  const passEl = document.getElementById('cred-newpass');
  btn.disabled = true;
  msgEl?.classList.add('hidden');
  try {
    const res = await edgeFetch('admin-create-user', { action: 'reset_password', userId: credUserId });
    if (passEl) passEl.textContent = res.password;
    box?.classList.remove('hidden');
    if (res.warning && msgEl) { msgEl.textContent = res.warning; msgEl.classList.remove('hidden'); }
  } catch (e) {
    if (msgEl) { msgEl.textContent = e.message || 'تعذّرت إعادة التعيين'; msgEl.classList.remove('hidden'); }
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('cred-copy')?.addEventListener('click', async () => {
  const txt = document.getElementById('cred-newpass')?.textContent ?? '';
  if (!txt || txt === '—') return;
  try { await navigator.clipboard.writeText(txt); } catch { /* المتصفّح منع النسخ — النصّ محدَّد يدوياً */ }
});

function closeCredModal() { hide(credModal); }
credModalClose.addEventListener('click', closeCredModal);
credModalOk.addEventListener('click',    closeCredModal);
credModal.addEventListener('click', e => { if (e.target === credModal) closeCredModal(); });

// ══════════════════════════════════════════════
//  فهرس المواد (subject_catalog) — global, ministry-managed
// ══════════════════════════════════════════════
const addSubjectBtn     = document.getElementById('add-subject-btn');
const subjectsCount     = document.getElementById('subjects-count');
const subjectsLoading   = document.getElementById('subjects-loading');
const subjectsTableWrap = document.getElementById('subjects-table-wrap');
const subjectsEmpty     = document.getElementById('subjects-empty');
const subjectsTbody     = document.getElementById('subjects-tbody');
const scModal           = document.getElementById('subject-cat-modal');
const scModalTitle      = document.getElementById('subject-cat-modal-title');
const scModalError      = document.getElementById('subject-cat-modal-error');
const scModalClose      = document.getElementById('subject-cat-modal-close');
const scModalCancel     = document.getElementById('subject-cat-modal-cancel');
const scModalSave       = document.getElementById('subject-cat-modal-save');
const scName            = document.getElementById('sc-name');
const scArabic          = document.getElementById('sc-arabic');
const scMath            = document.getElementById('sc-math');
const scFullMarks       = document.getElementById('sc-full-marks');
const scSort            = document.getElementById('sc-sort');
const scActive          = document.getElementById('sc-active');
const delScModal        = document.getElementById('delete-subject-cat-modal');
const delScName         = document.getElementById('del-subject-cat-name');
const delScError        = document.getElementById('del-subject-cat-error');
const delScClose        = document.getElementById('del-subject-cat-close');
const delScCancel       = document.getElementById('del-subject-cat-cancel');
const delScConfirm      = document.getElementById('del-subject-cat-confirm');

CustomSelect.enhance('sc-active');

const scCompList   = document.getElementById('sc-comp-list');
const scAddComp    = document.getElementById('sc-add-comp');
const scSingleComp = document.getElementById('sc-single-comp');
const scCompSum    = document.getElementById('sc-comp-sum');

let allCatalogSubjects = [];
let editingCatalogId = null;
let pendingDeleteCatalogId = null;

function scRecalcSum() {
  let sum = 0;
  scCompList.querySelectorAll('.sc-comp-max').forEach(inp => { sum += Number(inp.value) || 0; });
  scCompSum.textContent = 'مجموع درجات المكوّنات: ' + sum;
}

function scAddCompRow(name = '', maxMark = '') {
  const row = document.createElement('div');
  row.className = 'form-row sc-comp-row';
  row.style.cssText = 'gap:8px;align-items:center;margin-bottom:6px';
  row.innerHTML =
    '<input type="text" class="sc-comp-name" placeholder="اسم المكوّن (مثال: مذاكرة)" maxlength="40" style="flex:2" value="' + esc(name) + '" />' +
    '<input type="number" class="sc-comp-max" min="0" placeholder="الدرجة" style="flex:1" value="' + esc(maxMark) + '" />' +
    '<button type="button" class="btn btn-danger btn-sm sc-comp-del">حذف</button>';
  row.querySelector('.sc-comp-del').addEventListener('click', () => { row.remove(); scRecalcSum(); });
  row.querySelector('.sc-comp-max').addEventListener('input', scRecalcSum);
  scCompList.appendChild(row);
  scRecalcSum();
}

function scReadComps() {
  return [...scCompList.querySelectorAll('.sc-comp-row')].map(r => ({
    name:    r.querySelector('.sc-comp-name').value.trim(),
    maxMark: Number(r.querySelector('.sc-comp-max').value) || 0,
  })).filter(c => c.name);
}

scAddComp.addEventListener('click', () => scAddCompRow());

// Shortcut for subjects graded as a single mark out of 100 (e.g. السلوك): one
// component carrying the whole mark, instead of مذاكرة / شفهي / امتحان فصلي.
scSingleComp.addEventListener('click', () => {
  scCompList.innerHTML = '';
  scAddCompRow(scName.value.trim() || 'الدرجة', 100);
});

async function loadSubjectCatalog() {
  hide(subjectsTableWrap); hide(subjectsEmpty);
  show(subjectsLoading);
  try {
    const { data, error } = await supabase.from('subject_catalog')
      .select('id, name, is_core_arabic, is_core_math, allow_full_marks, sort_order, active')
      .order('sort_order').order('name');
    if (error) throw error;
    allCatalogSubjects = data ?? [];
  } catch (e) {
    console.error('[admin] loadSubjectCatalog', e);
    allCatalogSubjects = [];
  }
  hide(subjectsLoading);
  subjectsCount.textContent = allCatalogSubjects.length;
  if (!allCatalogSubjects.length) { show(subjectsEmpty); return; }

  subjectsTbody.innerHTML = allCatalogSubjects.map((r, i) => {
    const tags = [
      r.is_core_arabic   ? 'عربي'          : '',
      r.is_core_math     ? 'رياضيات'       : '',
      r.allow_full_marks ? 'علامة كاملة'   : '',
    ].filter(Boolean).join('، ') || '—';
    return `<tr>
      <td class="muted">${i + 1}</td>
      <td>${esc(r.name)}${r.active ? '' : ' <span style="color:var(--text-dim)">(معطّلة)</span>'}</td>
      <td class="muted">${esc(tags)}</td>
      <td class="muted">${r.sort_order ?? 0}</td>
      <td>
        <button class="btn btn-ghost btn-sm" data-edit-sc="${esc(r.id)}"><svg width="13" height="13"><use href="#icon-edit"/></svg> تعديل</button>
        <button class="btn btn-danger btn-sm" data-del-sc="${esc(r.id)}" data-del-name="${esc(r.name)}">حذف</button>
      </td>
    </tr>`;
  }).join('');
  show(subjectsTableWrap);
  subjectsTbody.querySelectorAll('[data-edit-sc]').forEach(b => b.addEventListener('click', () => openEditCatalog(b.dataset.editSc)));
  subjectsTbody.querySelectorAll('[data-del-sc]').forEach(b => b.addEventListener('click', () => openDeleteCatalog(b.dataset.delSc, b.dataset.delName)));
}

function openAddCatalog() {
  editingCatalogId = null;
  scModalTitle.textContent = 'إضافة مادة';
  scName.value = '';
  scArabic.checked = false;
  scMath.checked = false;
  scFullMarks.checked = false;
  scSort.value = allCatalogSubjects.length ? (Math.max(...allCatalogSubjects.map(r => r.sort_order || 0)) + 1) : 0;
  scActive.value = 'true'; CustomSelect.refresh(scActive);
  scCompList.innerHTML = '';
  scAddCompRow('مذاكرة', '');
  scAddCompRow('شفهي / وظائف', '');
  scAddCompRow('امتحان فصلي', '');
  clearError(scModalError);
  show(scModal);
  scName.focus();
}

async function openEditCatalog(id) {
  const r = allCatalogSubjects.find(x => x.id === id);
  if (!r) return;
  editingCatalogId = id;
  scModalTitle.textContent = 'تعديل مادة';
  scName.value = r.name;
  scArabic.checked = !!r.is_core_arabic;
  scMath.checked = !!r.is_core_math;
  scFullMarks.checked = !!r.allow_full_marks;
  scSort.value = r.sort_order ?? 0;
  scActive.value = r.active ? 'true' : 'false'; CustomSelect.refresh(scActive);
  scCompList.innerHTML = '';
  scRecalcSum();
  clearError(scModalError);
  show(scModal);
  scName.focus();
  try {
    const comps = await window.NSAMS_DB.getCatalogComponents(id);
    scCompList.innerHTML = '';
    if (comps.length) comps.forEach(c => scAddCompRow(c.name, c.max_mark));
    else scAddCompRow('', '');
  } catch (e) {
    console.error('[admin] getCatalogComponents', e);
    scAddCompRow('', '');
  }
}

function closeScModal() { hide(scModal); }
scModalClose.addEventListener('click', closeScModal);
scModalCancel.addEventListener('click', closeScModal);
scModal.addEventListener('click', e => { if (e.target === scModal) closeScModal(); });
addSubjectBtn.addEventListener('click', openAddCatalog);

scModalSave.addEventListener('click', async () => {
  const name = scName.value.trim();
  if (!name) { showError(scModalError, 'أدخل اسم المادة.'); return; }
  const row = {
    name,
    is_core_arabic:   scArabic.checked,
    is_core_math:     scMath.checked,
    allow_full_marks: scFullMarks.checked,
    sort_order:       Number(scSort.value) || 0,
    active:           scActive.value === 'true',
  };
  scModalSave.disabled = true;
  try {
    let catalogId = editingCatalogId;
    if (editingCatalogId) {
      const { error } = await supabase.from('subject_catalog').update(row).eq('id', editingCatalogId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('subject_catalog').insert(row).select('id').single();
      if (error) throw error;
      catalogId = data.id;
    }
    await window.NSAMS_DB.setCatalogComponents(catalogId, scReadComps());
    closeScModal();
    await loadSubjectCatalog();
    // Push allow_full_marks onto any subjects already created from this
    // catalog entry in schools, before this save — best-effort, a failure
    // here must not make the catalog save itself look like it failed.
    window.NSAMS_DB.syncFullMarksFromCatalog().catch((e) =>
      console.warn('[admin] auto syncFullMarksFromCatalog', e));
  } catch (e) {
    const dup = /duplicate|unique|already/i.test(e.message);
    showError(scModalError, dup ? 'هذه المادة موجودة مسبقاً.' : e.message);
  } finally {
    scModalSave.disabled = false;
  }
});

function openDeleteCatalog(id, name) {
  pendingDeleteCatalogId = id;
  delScName.textContent = name;
  clearError(delScError);
  show(delScModal);
}
function closeDelScModal() { hide(delScModal); pendingDeleteCatalogId = null; }
delScClose.addEventListener('click', closeDelScModal);
delScCancel.addEventListener('click', closeDelScModal);
delScModal.addEventListener('click', e => { if (e.target === delScModal) closeDelScModal(); });

delScConfirm.addEventListener('click', async () => {
  if (!pendingDeleteCatalogId) return;
  delScConfirm.disabled = true;
  try {
    const { error } = await supabase.from('subject_catalog').delete().eq('id', pendingDeleteCatalogId);
    if (error) throw error;
    closeDelScModal();
    await loadSubjectCatalog();
  } catch (e) {
    showError(delScError, e.message);
  } finally {
    delScConfirm.disabled = false;
  }
});

// ══════════════════════════════════════════════
//  قواعد النجاح (grade_pass_rules)
// ══════════════════════════════════════════════
const syncFullMarksBtn = document.getElementById('sync-full-marks-btn');
const syncFullMarksMsg = document.getElementById('sync-full-marks-msg');

// Backfill: pushes allow_full_marks from the catalog onto subjects rows that
// were already created in some school before the catalog flag was turned on —
// those never pick it up on their own (see syncFullMarksFromCatalog in db.js).
async function runSyncFullMarks() {
  syncFullMarksBtn.disabled = true;
  hide(syncFullMarksMsg);
  try {
    const n = await window.NSAMS_DB.syncFullMarksFromCatalog();
    syncFullMarksMsg.textContent = n > 0
      ? `تمّت مزامنة ${n} مادة في المدارس.`
      : 'كل المواد متزامنة أصلاً — لا شيء يحتاج تحديثاً.';
    syncFullMarksMsg.classList.add('success-msg');
    syncFullMarksMsg.classList.remove('error-msg');
    show(syncFullMarksMsg);
  } catch (e) {
    console.error('[admin] syncFullMarksFromCatalog', e);
    syncFullMarksMsg.textContent = 'تعذّرت المزامنة: ' + e.message;
    syncFullMarksMsg.classList.add('error-msg');
    syncFullMarksMsg.classList.remove('success-msg');
    show(syncFullMarksMsg);
  } finally {
    syncFullMarksBtn.disabled = false;
  }
}
syncFullMarksBtn.addEventListener('click', runSyncFullMarks);

const passRulesBtn    = document.getElementById('pass-rules-btn');
const passRulesModal  = document.getElementById('pass-rules-modal');
const passRulesClose  = document.getElementById('pass-rules-close');
const passRulesCancel = document.getElementById('pass-rules-cancel');
const passRulesSave   = document.getElementById('pass-rules-save');
const passRulesError  = document.getElementById('pass-rules-error');
const passRulesList   = document.getElementById('pass-rules-list');
const passRulesAdd    = document.getElementById('pass-rules-add');

function passRuleRow(r = {}) {
  const row = document.createElement('div');
  row.className = 'pass-rule-row';
  row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px';
  row.innerHTML =
    '<input type="number" class="pr-from" min="1" max="12" style="flex:1" value="' + esc(r.grade_from ?? '') + '" />' +
    '<input type="number" class="pr-to" min="1" max="12" style="flex:1" value="' + esc(r.grade_to ?? '') + '" />' +
    '<input type="number" class="pr-default" min="0" max="100" style="flex:1" value="' + esc(r.default_pass ?? '') + '" />' +
    '<input type="number" class="pr-core" min="0" max="100" style="flex:1" value="' + esc(r.core_pass ?? '') + '" />' +
    '<button type="button" class="btn btn-danger btn-sm pr-del" style="width:52px">حذف</button>';
  row.querySelector('.pr-del').addEventListener('click', () => row.remove());
  passRulesList.appendChild(row);
}

async function openPassRules() {
  clearError(passRulesError);
  passRulesList.innerHTML = '';
  show(passRulesModal);
  try {
    const rules = await window.NSAMS_DB.getGradePassRules();
    if (rules.length) {
      rules.forEach(passRuleRow);
    } else {
      passRuleRow({ grade_from: 1, grade_to: 4,  default_pass: 41, core_pass: 41 });
      passRuleRow({ grade_from: 5, grade_to: 12, default_pass: 40, core_pass: 50 });
    }
  } catch (e) {
    console.error('[admin] getGradePassRules', e);
    passRuleRow();
  }
}

function closePassRules() { hide(passRulesModal); }
passRulesBtn.addEventListener('click', openPassRules);
passRulesClose.addEventListener('click', closePassRules);
passRulesCancel.addEventListener('click', closePassRules);
passRulesModal.addEventListener('click', e => { if (e.target === passRulesModal) closePassRules(); });
passRulesAdd.addEventListener('click', () => passRuleRow());

passRulesSave.addEventListener('click', async () => {
  const rules = [...passRulesList.querySelectorAll('.pass-rule-row')].map(r => ({
    gradeFrom:   Number(r.querySelector('.pr-from').value),
    gradeTo:     Number(r.querySelector('.pr-to').value),
    defaultPass: Number(r.querySelector('.pr-default').value),
    corePass:    Number(r.querySelector('.pr-core').value),
  })).filter(r => r.gradeFrom && r.gradeTo);
  for (const r of rules) {
    if (r.gradeFrom > r.gradeTo) { showError(passRulesError, 'نطاق صفوف غير صحيح (من > إلى).'); return; }
  }
  passRulesSave.disabled = true;
  try {
    await window.NSAMS_DB.setGradePassRules(rules);
    closePassRules();
  } catch (e) {
    showError(passRulesError, e.message);
  } finally {
    passRulesSave.disabled = false;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
checkSession();
