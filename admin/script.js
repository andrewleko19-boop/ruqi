import { supabase, supabaseUrl } from '../shared/db.js';
import { CustomSelect } from '../shared/csel.js';

const EDGE_BASE = supabaseUrl + '/functions/v1';

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

// ── State ─────────────────────────────────────────────────────────────────────
let allSchools     = [];   // { id, name, directorate_id, directorates:{name,governorate}, ... }
let allUsers       = [];   // { id, full_name, role, school_id, directorate_id, schools, directorates }
let allDirectorates= [];   // { id, name, governorate }
let editingSchoolId= null; // null = create mode
let pendingDeactivateId = null;
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
  loadDirectorates().then(() => {
    loadSchools();
    loadUsers();
    populateAuditSchoolFilter();
  });
}

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

loginBtn.addEventListener('click', doLogin);
emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordInput.focus(); });
passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

// ── Tabs ──────────────────────────────────────────────────────────────────────
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.remove('is-active'));
    tabPanels.forEach(p => p.classList.remove('is-active'));
    btn.classList.add('is-active');
    document.getElementById(`tab-${tab}`).classList.add('is-active');
  });
});

// ── Directorates (shared lookup) ──────────────────────────────────────────────
async function loadDirectorates() {
  const { data, error } = await supabase
    .from('directorates').select('id, name, governorate').order('name');
  if (error) { console.warn('[admin] loadDirectorates', error); return; }
  allDirectorates = data ?? [];

  // Populate dropdowns
  [smDirectorate, umDir].forEach(sel => {
    while (sel.options.length > 1) sel.remove(1);
    allDirectorates.forEach(d => {
      const o = new Option(`${d.name} — ${d.governorate}`, d.id);
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
    .select('id, full_name, role, school_id, directorate_id, schools(name), directorates(name)')
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
    <tr>
      <td class="muted">${i + 1}</td>
      <td>${esc(u.full_name ?? '—')}</td>
      <td><span class="role-badge ${roleBadgeClass(u.role)}">${roleName(u.role)}</span></td>
      <td>${esc(org)}</td>
      <td>${u.role !== 'ministry_user' ? `
        <button class="btn btn-danger btn-sm" data-deactivate="${esc(u.id)}" data-name="${esc(u.full_name)}">
          تعطيل
        </button>` : ''}
      </td>
    </tr>`;
  }).join('');
  show(usersTableWrap);
  hide(usersEmpty);

  usersTbody.querySelectorAll('[data-deactivate]').forEach(btn => {
    btn.addEventListener('click', () => openDeactivate(btn.dataset.deactivate, btn.dataset.name));
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

userModalSave.addEventListener('click', async () => {
  clearError(userModalError);
  const email    = umEmail.value.trim().toLowerCase();
  const fullName = umFullname.value.trim();
  const password = umPassword.value;
  const role     = umRole.value;
  const schoolId = umSchool.value;
  const dirId    = umDir.value;

  if (!email || !email.includes('@')) { showError(userModalError, 'البريد غير صالح.'); return; }
  if (!fullName)                       { showError(userModalError, 'الاسم الكامل مطلوب.'); return; }
  if (password.length < 8)            { showError(userModalError, 'كلمة المرور ٨ أحرف على الأقل.'); return; }
  if (!role)                           { showError(userModalError, 'اختر الدور.'); return; }
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
    const actorName  = (r.actor_id && nameMap[r.actor_id]) ? nameMap[r.actor_id] : (r.actor_id ? r.actor_id.slice(0, 8) + '…' : '—');
    const changesId  = `ch-${r.id}`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="muted" style="white-space:nowrap">${esc(date)}</td>
      <td>${esc(schoolName)}</td>
      <td>${esc(actorName)}</td>
      <td>${esc(r.entity ?? '—')}</td>
      <td>${esc(r.action ?? '—')}</td>
      <td>
        ${r.changes ? `
          <button class="changes-toggle" data-target="${changesId}">عرض</button>
          <pre class="changes-json hidden" id="${changesId}">${esc(JSON.stringify(r.changes, null, 2))}</pre>
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

  if (rows.length === AUDIT_LIMIT) {
    auditOffset += AUDIT_LIMIT;
    show(auditLoadMoreWrap);
  } else {
    hide(auditLoadMoreWrap);
  }
}

auditFilterBtn.addEventListener('click', () => loadAudit(true));
auditLoadMoreBtn.addEventListener('click', () => loadAudit(false));

// ── Boot ──────────────────────────────────────────────────────────────────────
checkSession();
