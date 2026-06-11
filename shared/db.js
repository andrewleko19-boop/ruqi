import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = "https://xocrzpjfvizgnsybegwr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_HCVzNgEJmov38FWXRO1uFw_DG1d87Y4";

const LAYER = location.pathname.split('/').filter(Boolean).find(
  s => ['school', 'teacher', 'directorate', 'ministry'].includes(s)
) || 'root';

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey:       `nsams-auth-${LAYER}`,
    persistSession:   true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
export { db as supabase };

// ─────────────────────────────────────────────────────────────────────────────
// Queue helpers (offline support)
// ─────────────────────────────────────────────────────────────────────────────
const QUEUE_ATTENDANCE = "nsams_pending_attendance";
const QUEUE_REPORTS    = "nsams_pending_reports";
const QUEUE_STU_ATT    = 'nsams_pending_stu_att';
const QUEUE_GRADES     = 'nsams_pending_grades';
const QUEUE_CONDUCT    = 'nsams_pending_conduct';
const QUEUE_STAFF_ATT  = 'nsams_pending_staff_att';
const QUEUE_STUDENTS   = 'nsams_pending_students';

// Default work-start time used for the lateness calculation when a school has
// not configured `schools.work_start_time`.
const DEFAULT_WORK_START = '07:30';

function readQueue(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
}

function writeQueue(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function generateLocalId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateReceiptNumber() {
  return `RPT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function isOnline() { return navigator.onLine; }

// ── Report photo storage ──────────────────────────────────────────────────────
// Emergency-report photos arrive from the UI as data: URIs. Storing a multi-MB
// base64 string inside a table row is wasteful, so we upload to Supabase Storage
// and keep only the public URL. SAFE FALLBACK: if the bucket is missing or the
// upload fails, we KEEP the original data URI rather than dropping the photo —
// no regression versus the old behaviour, and no silent data loss.
const REPORT_BUCKET = 'report-photos';

async function uploadDataUri(dataUri) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUri);
  if (!m) return dataUri; // not a data URI — leave untouched
  const mime = m[1];
  const b64  = m[2];
  const ext  = (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';

  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const path = `reports/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await db.storage
    .from(REPORT_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw error;

  const { data } = db.storage.from(REPORT_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Replace any inline data-URI photos with uploaded Storage URLs.
// Keeps the data URI on failure so the photo is never lost.
async function materialisePhotos(mediaUrls) {
  if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) return mediaUrls ?? [];
  const out = [];
  for (const u of mediaUrls) {
    if (typeof u === 'string' && u.startsWith('data:')) {
      try { out.push(await uploadDataUri(u)); }
      catch (e) { console.warn('[NSAMS] photo upload failed — keeping inline data URI', e); out.push(u); }
    } else {
      out.push(u);
    }
  }
  return out;
}

// Local calendar date (YYYY-MM-DD) in the device timezone — NOT UTC.
// new Date().toISOString() returns UTC, which is the PREVIOUS day between
// local 00:00–03:00 in Syria (UTC+3). For a date-keyed attendance system that
// silently files records under the wrong day. Always build from local parts.
function localDateISO(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const da = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
// Teachers are provisioned centrally by the principal with a USERNAME (no email).
// A username (no '@') is mapped to a synthetic email so Supabase auth — which is
// email-based — can authenticate it. Admins/directorate keep using their email.
const STAFF_EMAIL_DOMAIN = 'staff.nsams.local';
function identifierToEmail(identifier) {
  const id = (identifier || '').trim();
  return id.includes('@') ? id : `${id.toLowerCase()}@${STAFF_EMAIL_DOMAIN}`;
}

async function login(identifier, password) {
  const email = identifierToEmail(identifier);
  const { data: authData, error: authError } =
    await db.auth.signInWithPassword({ email, password });

  if (authError) throw authError;

  const userId = authData.user.id;

  const { data: profile, error: profileError } = await db
    .from("users")
    .select("role, school_id, directorate_id, full_name")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) throw new Error("لا توجد صلاحية لقراءة بيانات المستخدم.");
  if (!profile) throw new Error("المستخدم غير مسجل في النظام.");

  return {
    user: { id: userId, email: authData.user.email, fullName: profile.full_name },
    role: profile.role,
    schoolId: profile.school_id,
    directorateId: profile.directorate_id,
  };
}

async function logout() {
  const { error } = await db.auth.signOut();
  if (error) throw error;
}

async function getCurrentUser() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;

  const { data: profile, error } = await db
    .from("users")
    .select("role, school_id, directorate_id, full_name")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error || !profile) return null;

  return {
    user: { id: session.user.id, email: session.user.email, fullName: profile.full_name },
    role: profile.role,
    schoolId: profile.school_id,
    directorateId: profile.directorate_id,
  };
}

// ─── Schools ──────────────────────────────────────────────────────────────────
async function getSchools(directorateId) {
  const query = db.from("schools").select("id, name, lat, lng");
  if (directorateId) query.eq("directorate_id", directorateId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function getSchoolStatus(schoolId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;

  const [attendanceRes, reportRes] = await Promise.all([
    db.from("daily_attendance").select("id").eq("school_id", schoolId).eq("date", isoDate).limit(1),
    db.from("emergency_reports").select("id").eq("school_id", schoolId).in("status", ["open", "acknowledged"]).limit(1),
  ]);

  if (attendanceRes.error) throw attendanceRes.error;
  if (reportRes.error) throw reportRes.error;

  return {
    attendanceSubmitted: attendanceRes.data.length > 0,
    hasActiveReport: reportRes.data.length > 0,
  };
}

async function getSchoolById(schoolId) {
  // select('*') so school_type is included once the migration runs, while
  // staying safe (no "column does not exist" error) if it hasn't yet.
  const { data, error } = await db
    .from('schools')
    .select('*')
    .eq('id', schoolId)
    .single();
  if (error) throw error;
  return data;
}

// School-admin: update editable school settings (currently the minimum
// attendance % used as a promotion gate). camelCase in → snake_case column.
async function updateSchool(schoolId, patch) {
  const row = {};
  if (patch.minAttendancePct !== undefined) row.min_attendance_pct = patch.minAttendancePct;
  if (patch.workStartTime    !== undefined) row.work_start_time     = patch.workStartTime || null;
  // School identity (هوية المدرسة) + GPS — reuses the existing lat/lng columns.
  if (patch.complexName   !== undefined) row.complex_name   = patch.complexName   || null;
  if (patch.classification!== undefined) row.classification = patch.classification|| null;
  if (patch.educationType !== undefined) row.education_type = patch.educationType || null;
  if (patch.shift         !== undefined) row.shift          = patch.shift         || null;
  if (patch.studentType   !== undefined) row.student_type   = patch.studentType   || null;
  if (patch.lat           !== undefined) row.lat            = patch.lat;
  if (patch.lng           !== undefined) row.lng            = patch.lng;
  if (Object.keys(row).length === 0) return true;
  const { data, error } = await db.from('schools').update(row).eq('id', schoolId).select('id');
  if (error) throw error;
  // RLS may silently update 0 rows (no UPDATE policy) without raising an error —
  // surface that as a clear failure instead of a false success.
  if (!data || data.length === 0)
    throw new Error('لم تُحفظ التعديلات — تحقق من صلاحيات قاعدة البيانات (RLS) لجدول المدرسة.');
  return true;
}

// ─── Attendance ───────────────────────────────────────────────────────────────
async function syncAttendanceRecord(record) {
  const { localId, synced: _synced, createdAt: _c, ...payload } = record;
  const { error } = await db.from("daily_attendance").upsert(payload, {
    onConflict: "school_id,date",
    ignoreDuplicates: false,
  });
  if (error) throw error;
  return true;
}

async function saveAttendance(record) {
  const localId  = generateLocalId();
  const enriched = { ...record, localId, synced: false, createdAt: new Date().toISOString() };

  if (!isOnline()) {
    const queue = readQueue(QUEUE_ATTENDANCE);
    queue.push(enriched);
    writeQueue(QUEUE_ATTENDANCE, queue);
    return { success: true, localId, synced: false };
  }

  try {
    await syncAttendanceRecord(enriched);
    return { success: true, localId, synced: true };
  } catch {
    const queue = readQueue(QUEUE_ATTENDANCE);
    queue.push(enriched);
    writeQueue(QUEUE_ATTENDANCE, queue);
    return { success: true, localId, synced: false };
  }
}

function getPendingAttendance() {
  return readQueue(QUEUE_ATTENDANCE).filter((r) => !r.synced);
}

function markAttendanceSynced(localId) {
  const queue = readQueue(QUEUE_ATTENDANCE).map((r) =>
    r.localId === localId ? { ...r, synced: true } : r
  );
  writeQueue(QUEUE_ATTENDANCE, queue);
}

// ─── Reports ──────────────────────────────────────────────────────────────────
async function syncReportRecord(report) {
  const { localId, synced: _synced, receiptNumber: _r, createdAt: _c, ...payload } = report;
  // Upload inline photos to Storage; the row stores only URLs (or data URIs on
  // failure). Runs on both the online path and on offline-queue sync.
  payload.media_urls = await materialisePhotos(payload.media_urls);
  const { data, error } = await db
    .from("emergency_reports")
    .insert(payload)
    .select("id, receipt_number, created_at, status")
    .single();
  if (error) throw error;
  return data;
}

async function submitReport(report) {
  const localId       = generateLocalId();
  const receiptNumber = generateReceiptNumber();
  const enriched = {
    ...report, localId, receiptNumber,
    synced: false, createdAt: new Date().toISOString(), status: "open",
  };

  if (!isOnline()) {
    const queue = readQueue(QUEUE_REPORTS);
    queue.push(enriched);
    writeQueue(QUEUE_REPORTS, queue);
    return { id: localId, receiptNumber, createdAt: enriched.createdAt, status: "open" };
  }

  try {
    const result = await syncReportRecord(enriched);
    return {
      id: result.id,
      receiptNumber: result.receipt_number,
      createdAt: result.created_at,
      status: result.status,
    };
  } catch {
    const queue = readQueue(QUEUE_REPORTS);
    queue.push(enriched);
    writeQueue(QUEUE_REPORTS, queue);
    return { id: localId, receiptNumber, createdAt: enriched.createdAt, status: "open" };
  }
}

function getPendingReports() {
  return readQueue(QUEUE_REPORTS).filter((r) => !r.synced);
}

function markReportSynced(localId) {
  const queue = readQueue(QUEUE_REPORTS).map((r) =>
    r.localId === localId ? { ...r, synced: true } : r
  );
  writeQueue(QUEUE_REPORTS, queue);
}

// ─── Directorate ──────────────────────────────────────────────────────────────
async function getReportsForDirectorate(directorateId) {
  const { data, error } = await db
    .from("emergency_reports")
    .select("id, type, description, status, receipt_number, created_at, school:schools!inner(id, name)")
    .eq("schools.directorate_id", directorateId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({ ...r, schoolName: r.school?.name ?? "Unknown" }));
}

async function updateReportStatus(reportId, newStatus) {
  const allowed = ["open", "acknowledged", "resolved"];
  if (!allowed.includes(newStatus)) throw new Error(`Invalid status: ${newStatus}`);

  const patch = { status: newStatus, updated_at: new Date().toISOString() };
  if (newStatus === "resolved") {
    // Record who resolved it and when.
    const { data: auth } = await db.auth.getUser();
    patch.resolved_by = auth?.user?.id ?? null;
    patch.resolved_at = new Date().toISOString();
  } else {
    // Re-opening / acknowledging clears any prior resolution stamp.
    patch.resolved_by = null;
    patch.resolved_at = null;
  }

  const { error } = await db
    .from("emergency_reports")
    .update(patch)
    .eq("id", reportId);
  if (error) throw error;
}

async function getTodaySummary(directorateId) {
  const today = localDateISO();

  // مدارس المديرية (نحتاج المعرّفات لفلترة الحضور الفردي)
  const schoolsRes = await db.from("schools")
    .select("id")
    .eq("directorate_id", directorateId);
  if (schoolsRes.error) throw schoolsRes.error;
  const schoolIds = (schoolsRes.data || []).map((s) => s.id);

  const [dsaRes, daRes, reportsRes] = await Promise.all([
    // حضور الطلاب الفردي (المصدر الحقيقي الموحّد مع الوزارة)
    db.from("daily_student_attendance")
      .select("school_id, status")
      .eq("date", today)
      .in("school_id", schoolIds.length ? schoolIds : ["__none__"]),
    // دوام الموظفين (معلمون/إداريون/عمال) — من المجمّع daily_attendance
    db.from("daily_attendance")
      .select("school_id, teachers_present, admins_present, workers_present")
      .eq("date", today)
      .in("school_id", schoolIds.length ? schoolIds : ["__none__"]),
    // البلاغات المعلّقة (دون تغيير)
    db.from("emergency_reports")
      .select("id, type, status, created_at, school:schools!inner(name, directorate_id)")
      .in("status", ["open", "acknowledged"])
      .eq("schools.directorate_id", directorateId)
      .order("created_at", { ascending: true })
      .limit(5),
  ]);

  if (dsaRes.error)     throw dsaRes.error;
  if (daRes.error)      throw daRes.error;
  if (reportsRes.error) throw reportsRes.error;

  // تجميع الحضور الفردي
  let present = 0, late = 0, absent = 0, excused = 0;
  const reportingSchools = new Set();
  for (const r of dsaRes.data || []) {
    if (r.status === "present")      present++;
    else if (r.status === "late")    late++;
    else if (r.status === "absent")  absent++;
    else if (r.status === "excused") excused++;
    if (r.school_id) reportingSchools.add(r.school_id);
  }
  const attendingStudents = present + late + excused;   // الحاضرون (قرار موحّد)

  return {
    totalTeachersPresent: (daRes.data || []).reduce((s, r) => s + (r.teachers_present || 0), 0),
    totalAdminsPresent:   (daRes.data || []).reduce((s, r) => s + (r.admins_present  || 0), 0),
    totalWorkersPresent:  (daRes.data || []).reduce((s, r) => s + (r.workers_present || 0), 0),
    totalStudentsPresent: attendingStudents,            // الآن حضور طلاب حقيقي
    topPendingReports: (reportsRes.data || []).map((r) => ({
      id: r.id, type: r.type, status: r.status,
      createdAt: r.created_at, schoolName: r.school?.name ?? "Unknown",
    })),
    reportingSchoolsCount: reportingSchools.size,
  };
}

async function getSchoolsAttendanceStatus(directorateId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;

  const schoolsRes = await db.from("schools")
    .select("id, total_students")
    .eq("directorate_id", directorateId);
  if (schoolsRes.error) throw schoolsRes.error;

  const ids = (schoolsRes.data || []).map((s) => s.id);
  const [attendanceRes, reportsRes] = await Promise.all([
    db.from("daily_student_attendance")
      .select("school_id, status")
      .eq("date", isoDate)
      .in("school_id", ids.length ? ids : ["__none__"]),
    db.from("emergency_reports")
      .select("school_id")
      .in("status", ["open", "acknowledged"])
      .in("school_id", ids.length ? ids : ["__none__"]),
  ]);
  if (attendanceRes.error) throw attendanceRes.error;
  if (reportsRes.error)    throw reportsRes.error;

  // تجميع الحالات لكل مدرسة من السجل الفردي
  const aggBySchool = {};   // school_id → {present, late, absent, excused}
  for (const r of attendanceRes.data || []) {
    let a = aggBySchool[r.school_id];
    if (!a) a = aggBySchool[r.school_id] = { present: 0, late: 0, absent: 0, excused: 0 };
    if (r.status === "present")      a.present++;
    else if (r.status === "late")    a.late++;
    else if (r.status === "absent")  a.absent++;
    else if (r.status === "excused") a.excused++;
  }
  const activeReportSet = new Set((reportsRes.data || []).map((r) => r.school_id));

  // العتبتان (طريقة ٤)
  const LOW_ATTENDANCE_THRESHOLD = 0.75;  // أقل من 75% حضور = أحمر
  const LOW_COVERAGE_THRESHOLD   = 0.50;  // سُجّل أقل من 50% من الطلاب = تغطية ناقصة (أصفر)

  const result = {};
  for (const school of schoolsRes.data || []) {
    const a = aggBySchool[school.id];

    if (activeReportSet.has(school.id)) {
      result[school.id] = { color: "red", reason: "emergency", attendanceRate: null, coverageRate: null, enrolled: 0 };
      continue;
    }
    if (!a) {
      result[school.id] = { color: "no_data", reason: "no_data", attendanceRate: null, coverageRate: null, enrolled: 0 };
      continue;
    }

    const enrolled  = a.present + a.late + a.absent + a.excused;  // المسجّلون اليوم
    const attending = a.present + a.late + a.excused;             // الحاضرون
    const total     = school.total_students || 0;

    const attendanceRate = enrolled > 0 ? attending / enrolled : 0;
    const coverageRate   = total   > 0 ? enrolled  / total    : 0;

    let color;
    if (attendanceRate < LOW_ATTENDANCE_THRESHOLD) {
      color = "red";                      // حضور منخفض فعلي
    } else if (total > 0 && coverageRate < LOW_COVERAGE_THRESHOLD) {
      color = "amber";                    // حضور جيد لكن تغطية ناقصة
    } else {
      color = "green";                    // حضور جيد + تغطية كافية (أو total غير معروف)
    }

    result[school.id] = {
      color,
      reason: color === "red" ? "low_attendance" : (color === "amber" ? "low_coverage" : "ok"),
      attendanceRate: Math.round(attendanceRate * 100),
      coverageRate:   total > 0 ? Math.round(coverageRate * 100) : null,
      enrolled,
    };
  }
  return result;
}

// ─── Ministry ─────────────────────────────────────────────────────────────────
async function getMinistryAttendanceSummary(date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;

  const { data: directorates, error: dirErr } = await db
    .from("directorates")
    .select("id, name, governorate")
    .order("governorate");
  if (dirErr) throw dirErr;
  if (!directorates || directorates.length === 0) return [];

  const { data: schools, error: schErr } = await db
    .from("schools")
    .select("id, directorate_id");
  if (schErr) throw schErr;

  const allSchoolIds = (schools || []).map(s => s.id);

  const { data: attendance, error: attErr } = await db
    .from("daily_attendance")
    .select("school_id, students_present, teachers_present, admins_present, workers_present")
    .eq("date", isoDate)
    .in("school_id", allSchoolIds.length > 0 ? allSchoolIds : ["__none__"]);
  if (attErr) throw attErr;

  const schoolToDir  = {};
  const dirToSchools = {};
  for (const s of schools || []) {
    schoolToDir[s.id] = s.directorate_id;
    if (!dirToSchools[s.directorate_id]) dirToSchools[s.directorate_id] = new Set();
    dirToSchools[s.directorate_id].add(s.id);
  }

  const dirAgg = {};
  for (const d of directorates) {
    dirAgg[d.id] = {
      studentsPresent: 0,
      teachersPresent: 0,
      adminsPresent:   0,
      workersPresent:  0,
      schoolsReported: 0,
      totalSchools:    dirToSchools[d.id]?.size || 0,
    };
  }
  for (const rec of attendance || []) {
    const dirId = schoolToDir[rec.school_id];
    if (dirId && dirAgg[dirId]) {
      dirAgg[dirId].studentsPresent += rec.students_present || 0;
      dirAgg[dirId].teachersPresent += rec.teachers_present || 0;
      dirAgg[dirId].adminsPresent   += rec.admins_present   || 0;
      dirAgg[dirId].workersPresent  += rec.workers_present  || 0;
      dirAgg[dirId].schoolsReported++;
    }
  }

  const govMap = {};
  for (const d of directorates) {
    const gov = d.governorate || "Unknown";
    if (!govMap[gov]) {
      govMap[gov] = {
        governorate:     gov,
        studentsPresent: 0,
        teachersPresent: 0,
        adminsPresent:   0,
        workersPresent:  0,
        schoolsReported: 0,
        totalSchools:    0,
        dirCount:        0,
      };
    }
    const agg = dirAgg[d.id];
    govMap[gov].studentsPresent += agg.studentsPresent;
    govMap[gov].teachersPresent += agg.teachersPresent;
    govMap[gov].adminsPresent   += agg.adminsPresent;
    govMap[gov].workersPresent  += agg.workersPresent;
    govMap[gov].schoolsReported += agg.schoolsReported;
    govMap[gov].totalSchools    += agg.totalSchools;
    govMap[gov].dirCount++;
  }

  return Object.values(govMap).sort((a, b) => a.governorate.localeCompare(b.governorate));
}

async function getGovernoratesCount() {
  const { data, error } = await db
    .from("directorates")
    .select("governorate");
  if (error) throw error;
  const unique = new Set((data || []).map(d => d.governorate).filter(Boolean));
  return unique.size;
}

// ─── Academic year helper ─────────────────────────────────────────────────────
// Mirrors get_academic_year() SQL function.
// Rule: month >= 9 → current-next, else prev-current
function getAcademicYear(date = new Date()) {
  const month = date.getMonth() + 1;
  const year  = date.getFullYear();
  return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

// ─── Arabic grade name ────────────────────────────────────────────────────────
const GRADE_NAMES_AR = {
  1: 'الأول',    2: 'الثاني',    3: 'الثالث',
  4: 'الرابع',   5: 'الخامس',    6: 'السادس',
  7: 'السابع',   8: 'الثامن',    9: 'التاسع',
  10: 'العاشر',  11: 'الحادي عشر', 12: 'الثاني عشر',
};
function gradeNameAr(grade) {
  return GRADE_NAMES_AR[grade] ?? grade.toString();
}

// ─── Teacher: get assigned classes ───────────────────────────────────────────
async function getTeacherClasses(teacherId) {
  const academicYear = getAcademicYear();

  const { data, error } = await db
    .from('class_teacher')
    .select(`
      class_id, role, subject_ids,
      classes:class_id (
        id, grade, section, school_id,
        schools:school_id ( name, work_start_time )
      )
    `)
    .eq('teacher_id',    teacherId)
    .eq('academic_year', academicYear);

  if (error) throw error;

  return (data || []).map(row => {
    const c = row.classes;
    return {
      id:          c.id,
      grade:       c.grade,
      section:     c.section,
      schoolId:    c.school_id,
      schoolName:  c.schools?.name ?? '',
      workStartTime: c.schools?.work_start_time ?? null,
      role:        row.role ?? 'homeroom',
      subjectIds:  Array.isArray(row.subject_ids) ? row.subject_ids : [],
      academicYear,
      displayName: `الصف ${gradeNameAr(c.grade)} / شعبة ${c.section}`,
    };
  });
}

// ─── Student cache (24-hour TTL) ─────────────────────────────────────────────
const STUDENTS_CACHE_PFX = 'nsams_stu_';
const STUDENTS_CACHE_TTL = 24 * 60 * 60 * 1000;

function getCachedStudents(classId) {
  try {
    const raw = localStorage.getItem(STUDENTS_CACHE_PFX + classId);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    return (Date.now() - ts < STUDENTS_CACHE_TTL) ? data : null;
  } catch { return null; }
}

function setCachedStudents(classId, data) {
  try {
    localStorage.setItem(
      STUDENTS_CACHE_PFX + classId,
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch { /* storage quota — non-fatal */ }
}

function clearCachedStudents(classId) {
  if (!classId) return;
  try { localStorage.removeItem(STUDENTS_CACHE_PFX + classId); } catch { /* non-fatal */ }
}

// ─── Teacher: get students for a class ───────────────────────────────────────
async function getClassStudents(classId) {
  if (!isOnline()) {
    const cached = getCachedStudents(classId);
    if (cached) return cached;
    throw new Error('لا يوجد اتصال ولا توجد بيانات محفوظة لهذا الصف');
  }

  // select('*') (not an explicit column list) so the new SIS columns are
  // included once the migration runs, while staying safe if it hasn't yet —
  // same rationale as getSchoolById. Existing consumers keep reading
  // full_name / national_id / gender / seat_number unchanged.
  const { data, error } = await db
    .from('students')
    .select('*')
    .eq('class_id',  classId)
    .eq('is_active', true)
    .order('seat_number', { ascending: true,  nullsFirst: false })
    .order('full_name',   { ascending: true });

  if (error) throw error;

  const students = data ?? [];
  setCachedStudents(classId, students);
  return students;
}

// ─── Student records (SIS): create / edit / transfer / archive ───────────────
// Offline-first, mirroring saveStudentAttendance: every mutation is wrapped in
// a queue item synced by syncStudentRecord (online path + syncPendingV2). Each
// item carries an audit payload written (best-effort) to audit_log on sync.

// camelCase student object (from the form) → snake_case students row.
function studentRowFromInput(p) {
  const fullName = [p.firstName, p.fatherName, p.familyName]
    .map(s => (s ?? '').trim()).filter(Boolean).join(' ');
  return {
    id:               p.id,
    school_id:        p.schoolId,
    class_id:         p.classId ?? null,
    first_name:       (p.firstName  ?? '').trim() || null,
    father_name:      (p.fatherName ?? '').trim() || null,
    family_name:      (p.familyName ?? '').trim() || null,
    full_name:        fullName,
    gender:           p.gender || null,
    birth_date:       p.birthDate || null,
    national_id:      (p.nationalId ?? '').trim() || null,
    seat_number:      p.seatNumber === '' || p.seatNumber == null ? null : Number(p.seatNumber),
    mother_name:      (p.motherName     ?? '').trim() || null,
    mother_family:    (p.motherFamily   ?? '').trim() || null,
    grandfather_name: (p.grandfatherName?? '').trim() || null,
    card_number:      (p.cardNumber     ?? '').trim() || null,
    birth_place:      (p.birthPlace     ?? '').trim() || null,
    contact_phone:    (p.contactPhone   ?? '').trim() || null,
    res_governorate:  (p.resGovernorate ?? '').trim() || null,
    res_region:       (p.resRegion      ?? '').trim() || null,
    res_subdistrict:  (p.resSubdistrict ?? '').trim() || null,
    res_town:         (p.resTown        ?? '').trim() || null,
    res_sector:       (p.resSector      ?? '').trim() || null,
    res_block:        (p.resBlock       ?? '').trim() || null,
    res_record:       (p.resRecord      ?? '').trim() || null,
    is_active:        p.isActive !== false,
    recorded_by:      p.actorId ?? null,
    updated_at:       new Date().toISOString(),
  };
}

function newStudentId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID() : generateLocalId();
}

// Best-effort audit write (online direct path + sync path). Never throws —
// auditing must not block or fail a mutation the user already committed.
async function writeAudit({ schoolId, entity, entityId, action, changes = null, reason = null, actorId = null }) {
  try {
    if (!isOnline()) return false;
    const { error } = await db.from('audit_log').insert({
      school_id: schoolId, actor_id: actorId, entity,
      entity_id: entityId, action, changes, reason,
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('[NSAMS] writeAudit failed (non-fatal)', e);
    return false;
  }
}

// Core sync — runs the actual DB mutation for one queued student item, then
// records the audit row. Called on the online path and by syncPendingV2.
async function syncStudentRecord(item) {
  if (item.op === 'save') {
    const { error } = await db.from('students')
      .upsert(item.row, { onConflict: 'id', ignoreDuplicates: false });
    if (error) throw error;
  } else if (item.op === 'archive') {
    const { error } = await db.from('students')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (error) throw error;
  } else if (item.op === 'transfer') {
    const { error } = await db.from('students')
      .update({ class_id: item.classId, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (error) throw error;
  }
  if (item.audit) await writeAudit(item.audit);
  return true;
}

function getPendingStudents() {
  return readQueue(QUEUE_STUDENTS).filter(r => !r.synced);
}

function markStudentSynced(localId) {
  writeQueue(QUEUE_STUDENTS, readQueue(QUEUE_STUDENTS).map(r =>
    r.localId === localId ? { ...r, synced: true } : r));
}

// Shared offline-or-sync path for a single student mutation item.
async function enqueueOrSyncStudent(item) {
  [item.classId, item.fromClassId].forEach(clearCachedStudents);

  if (!isOnline()) {
    const q = readQueue(QUEUE_STUDENTS); q.push(item); writeQueue(QUEUE_STUDENTS, q);
    return { success: true, id: item.id, synced: false };
  }
  try {
    await syncStudentRecord(item);
    return { success: true, id: item.id, synced: true };
  } catch (err) {
    const q = readQueue(QUEUE_STUDENTS); q.push(item); writeQueue(QUEUE_STUDENTS, q);
    console.warn('[NSAMS] saveStudent: falling back to queue', err);
    return { success: true, id: item.id, synced: false };
  }
}

// Create or update one student. `input.id` present ⇒ update, absent ⇒ create.
async function saveStudent(input) {
  const isCreate = !input.id;
  const id  = input.id || newStudentId();
  const row = studentRowFromInput({ ...input, id });
  const item = {
    localId: generateLocalId(), op: 'save', id, classId: row.class_id,
    row,
    audit: {
      schoolId: row.school_id, entity: 'student', entityId: id,
      action: isCreate ? 'create' : 'update', changes: row,
      reason: input.reason ?? null, actorId: input.actorId ?? null,
    },
    synced: false, createdAt: new Date().toISOString(),
  };
  return enqueueOrSyncStudent(item);
}

// Soft-delete (never a hard DELETE) — keeps history & references intact.
async function archiveStudent({ id, schoolId, classId, reason, actorId }) {
  const item = {
    localId: generateLocalId(), op: 'archive', id, classId,
    audit: { schoolId, entity: 'student', entityId: id, action: 'archive',
             changes: null, reason: reason ?? null, actorId: actorId ?? null },
    synced: false, createdAt: new Date().toISOString(),
  };
  return enqueueOrSyncStudent(item);
}

// Move a student to another class/section (the official «نقل طالب»).
async function transferStudent({ id, schoolId, fromClassId, toClassId, reason, actorId }) {
  const item = {
    localId: generateLocalId(), op: 'transfer', id,
    classId: toClassId, fromClassId,
    audit: { schoolId, entity: 'student', entityId: id, action: 'transfer',
             changes: { from: fromClassId, to: toClassId },
             reason: reason ?? null, actorId: actorId ?? null },
    synced: false, createdAt: new Date().toISOString(),
  };
  return enqueueOrSyncStudent(item);
}

// Duplicate guard: is there an active student with this national_id in the
// school? Backs the unique partial index; surfaced in the form & bulk import.
async function findDuplicateStudent(schoolId, nationalId, excludeId = null) {
  const nid = (nationalId ?? '').trim();
  if (!nid) return null;
  let q = db.from('students')
    .select('id, full_name, class_id')
    .eq('school_id', schoolId).eq('national_id', nid).eq('is_active', true);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q.limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

// Bulk import a parsed/validated batch of students into one class. Requires a
// connection (large op). Inserts row-by-row so one bad row can't drop the rest;
// returns a per-row summary for the preview UI.
async function bulkImportStudents({ schoolId, classId, rows, actorId }) {
  if (!isOnline()) throw new Error('الاستيراد الجماعي يتطلّب اتصالاً بالإنترنت.');
  const summary = { inserted: 0, duplicate: 0, failed: [] };
  for (let i = 0; i < rows.length; i++) {
    const input = rows[i];
    try {
      const dup = await findDuplicateStudent(schoolId, input.nationalId);
      if (dup) { summary.duplicate++; continue; }
      const id  = newStudentId();
      const row = studentRowFromInput({ ...input, id, schoolId, classId, actorId });
      const { error } = await db.from('students').insert(row);
      if (error) throw error;
      summary.inserted++;
    } catch (err) {
      summary.failed.push({ line: i + 1, name: input.firstName || input.fullName || '—',
                            error: err?.message || 'خطأ' });
    }
  }
  clearCachedStudents(classId);
  if (summary.inserted > 0) {
    await writeAudit({ schoolId, entity: 'student', entityId: null,
      action: 'bulk_import', changes: { class_id: classId, count: summary.inserted },
      reason: null, actorId });
  }
  return summary;
}

// ─── Teacher: check submission status for a class + date ─────────────────────
async function getClassSubmissionStatus(classId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;

  const { data, error } = await db
    .from('attendance_submissions')
    .select('id, status, submitted_at, confirmed_by, confirmed_at, notes')
    .eq('class_id', classId)
    .eq('date',     isoDate)
    .maybeSingle();

  if (error) throw error;
  return data; // null = not yet submitted
}

// ─── Teacher: load existing attendance records for a class + date ─────────────
// Returns an object: { [student_id]: { status, reason } }
async function getClassAttendanceForDate(classId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;

  const { data, error } = await db
    .from('daily_student_attendance')
    .select('student_id, status, reason')
    .eq('class_id', classId)
    .eq('date',     isoDate);

  if (error) throw error;

  const map = {};
  for (const row of data ?? []) {
    map[row.student_id] = { status: row.status, reason: row.reason ?? null };
  }
  return map;
}

// ─── Teacher: get attendance report for printing ──────────────────────────────
async function getClassAttendanceReport(classId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;

  const { data, error } = await db
    .from('daily_student_attendance')
    .select(`
      status, reason,
      students:student_id ( full_name, seat_number )
    `)
    .eq('class_id', classId)
    .eq('date',     isoDate);

  if (error) throw error;

  // Sort by seat number in JS (Postgrest can't order by an embedded column).
  return (data ?? []).sort(
    (a, b) => (a.students?.seat_number ?? 999) - (b.students?.seat_number ?? 999)
  );
}

// ─── Teacher: absence log (per class, current academic year) ─────────────────
// Calls the get_class_absence_log RPC. Returns one row per student who has at
// least one absent/excused day this academic year, with counts. 'late' excluded.
// The RPC enforces that the caller teaches the class.
async function getClassAbsenceLog(classId) {
  const { data, error } = await db.rpc('get_class_absence_log', { p_class_id: classId });
  if (error) throw error;
  return (data ?? []).map(r => ({
    studentId:     r.student_id,
    fullName:      r.full_name,
    seatNumber:    r.seat_number,
    absentCount:   Number(r.absent_count)  || 0,
    excusedCount:  Number(r.excused_count) || 0,
  }));
}

// ─── School admin: cumulative absence summary for a class (this academic year) ─
// Computed CLIENT-SIDE from daily_student_attendance instead of the teacher-only
// get_class_absence_log RPC, so it runs under the dsa_read policy for a
// school_admin. Returns a map: { [studentId]: { absent, excused } } (counts of
// absent / excused days this academic year; 'present' and 'late' are ignored).
async function getClassAbsenceSummary(classId) {
  const startYear = getAcademicYear().split('-')[0];   // "2025-2026" -> "2025"
  const startISO  = `${startYear}-09-01`;

  const { data, error } = await db
    .from('daily_student_attendance')
    .select('student_id, status, date')
    .eq('class_id', classId)
    .gte('date', startISO);

  if (error) throw error;

  const map = {};
  for (const row of data ?? []) {
    if (row.status !== 'absent' && row.status !== 'excused') continue;
    const e = map[row.student_id] || (map[row.student_id] = { absent: 0, excused: 0 });
    if (row.status === 'absent')  e.absent++;
    else                          e.excused++;
  }
  return map;
}

// ─── School admin: class ↔ teacher management ────────────────────────────────
// All of these rely on the existing RLS policy school_admin_all_class_teacher
// (FOR ALL, class_belongs_to_my_school) and the schools/classes read policies.

// All classes in a school (for the management dropdown).
async function getSchoolClasses(schoolId) {
  const { data, error } = await db
    .from('classes')
    .select('id, name, grade, section')
    .eq('school_id', schoolId)
    .order('grade', { ascending: true })
    .order('section', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(c => ({
    id:      c.id,
    name:    c.name,
    grade:   c.grade,
    section: c.section,
  }));
}

// Teachers belonging to a school. If excludeClassId is given, teachers already
// assigned to that class (this academic year) are filtered OUT, so the "assign"
// dropdown only shows teachers not yet on the class.
async function getTeachersBySchool(schoolId, excludeClassId = null) {
  const { data, error } = await db
    .from('users')
    .select('id, full_name')
    .eq('role', 'teacher')
    .eq('school_id', schoolId)
    .order('full_name', { ascending: true });
  if (error) throw error;
  let teachers = (data ?? []).map(t => ({ id: t.id, fullName: t.full_name }));

  if (excludeClassId) {
    const assigned = await getClassTeachers(excludeClassId);
    const assignedIds = new Set(assigned.map(a => a.teacherId));
    teachers = teachers.filter(t => !assignedIds.has(t.id));
  }
  return teachers;
}

// Teachers currently assigned to a class (this academic year), each with their
// role (homeroom/supervisor/subject) and the subjects they may grade.
async function getClassTeachers(classId) {
  const year = getAcademicYear();
  const { data, error } = await db
    .from('class_teacher')
    .select('id, teacher_id, role, subject_ids, teacher:users!class_teacher_teacher_id_fkey(full_name)')
    .eq('class_id', classId)
    .eq('academic_year', year);
  if (error) throw error;

  // Resolve subject ids → names for display (subjects are per grade).
  let nameById = {};
  try {
    const { data: cls } = await db
      .from('classes').select('grade, school_id').eq('id', classId).single();
    if (cls) {
      const subs = await getSchoolSubjects(cls.school_id, cls.grade);
      nameById = Object.fromEntries(subs.map(s => [s.id, s.name]));
    }
  } catch { /* names are best-effort */ }

  return (data ?? []).map(r => {
    const subjectIds = Array.isArray(r.subject_ids) ? r.subject_ids : [];
    return {
      assignmentId: r.id,
      teacherId:    r.teacher_id,
      role:         r.role ?? 'homeroom',
      subjectIds,
      subjectNames: subjectIds.map(id => nameById[id]).filter(Boolean),
      fullName:     r.teacher?.full_name ?? '—',
    };
  });
}

// Assign a teacher to a class for the current academic year with a role and the
// subjects they may grade (supervisors carry no subjects).
async function assignTeacherToClass(classId, teacherId, { role = 'homeroom', subjectIds = [] } = {}) {
  const year = getAcademicYear();
  const { error } = await db
    .from('class_teacher')
    .insert({
      class_id:      classId,
      teacher_id:    teacherId,
      academic_year: year,
      role,
      subject_ids:   role === 'supervisor' ? [] : (subjectIds || []),
    });
  if (error) throw error;
  return true;
}

// Remove a teacher from a class (current academic year).
async function removeTeacherFromClass(classId, teacherId) {
  const year = getAcademicYear();
  const { error } = await db
    .from('class_teacher')
    .delete()
    .eq('class_id', classId)
    .eq('teacher_id', teacherId)
    .eq('academic_year', year);
  if (error) throw error;
  return true;
}

// Is there any student-attendance row for this class dated TODAY (local date)?
// Used to block removing a teacher from a class that already has today's records.
async function hasTodayAttendance(classId) {
  const today = localDateISO();
  const { count, error } = await db
    .from('daily_student_attendance')
    .select('id', { count: 'exact', head: true })
    .eq('class_id', classId)
    .eq('date', today);
  if (error) throw error;
  return (count ?? 0) > 0;
}

// ─── Student attendance offline queue ────────────────────────────────────────
function getPendingStudentAttendance() {
  return readQueue(QUEUE_STU_ATT).filter(r => !r.synced);
}

function markStudentAttSynced(localId) {
  const queue = readQueue(QUEUE_STU_ATT).map(r =>
    r.localId === localId ? { ...r, synced: true } : r
  );
  writeQueue(QUEUE_STU_ATT, queue);
}

// Core sync function – called both directly (online path) and by syncPendingV2.
async function syncStudentAttendanceRecord(payload) {
  const { records, classId, schoolId, date, teacherId } = payload;

  const rows = records.map(r => ({
    student_id:  r.studentId,
    class_id:    classId,
    school_id:   schoolId,
    date,
    status:      r.status,
    reason:      r.reason ?? null,
    recorded_by: teacherId,
  }));

  const { error: attErr } = await db
    .from('daily_student_attendance')
    .upsert(rows, { onConflict: 'student_id,date', ignoreDuplicates: false });

  if (attErr) throw attErr;

  const { error: subErr } = await db
    .from('attendance_submissions')
    .upsert(
      {
        class_id:     classId,
        school_id:    schoolId,
        date,
        submitted_by: teacherId,
        submitted_at: new Date().toISOString(),
        status:       'pending',
      },
      { onConflict: 'class_id,date', ignoreDuplicates: false }
    );

  if (subErr) throw subErr;
  return true;
}

async function saveStudentAttendance({ records, classId, schoolId, date, teacherId }) {
  const localId = generateLocalId();
  const payload = {
    localId, records, classId, schoolId, date, teacherId,
    synced: false, createdAt: new Date().toISOString(),
  };

  if (!isOnline()) {
    const queue = readQueue(QUEUE_STU_ATT);
    queue.push(payload);
    writeQueue(QUEUE_STU_ATT, queue);
    return { success: true, localId, synced: false };
  }

  try {
    await syncStudentAttendanceRecord(payload);
    return { success: true, localId, synced: true };
  } catch (err) {
    const queue = readQueue(QUEUE_STU_ATT);
    queue.push(payload);
    writeQueue(QUEUE_STU_ATT, queue);
    console.warn('[NSAMS] saveStudentAttendance: falling back to queue', err);
    return { success: true, localId, synced: false };
  }
}

// ─── Staff attendance (دوام الموظفين) ─────────────────────────────────────────
// Three categories roll up to the directorate/ministry: teachers (self check-in,
// "trust but verify"), admins and workers (no app login → recorded by the
// manager). The teacher's self-recorded time is kept as `check_in_original`; a
// manager correction lands in `check_in_adjusted`. Penalties are deliberately
// out of scope for now — the schema only measures (status + lateness).

function parseTimeToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Minutes a check-in is past the school's work-start time (0 if on time/early).
function computeLateMinutes(checkInISO, workStartTime) {
  if (!checkInISO) return null;
  const start = parseTimeToMinutes(workStartTime || DEFAULT_WORK_START);
  const d = new Date(checkInISO);
  const mins = d.getHours() * 60 + d.getMinutes();
  return Math.max(0, mins - start);
}

function staffStatusForLate(lateMinutes) {
  return lateMinutes && lateMinutes > 0 ? 'late' : 'present';
}

// ── Personnel roster (admins / workers — no app login) ──
async function getSchoolPersonnel(schoolId) {
  const { data, error } = await db
    .from('school_personnel')
    .select('id, full_name, kind, national_id, is_active')
    .eq('school_id', schoolId)
    .order('kind', { ascending: true })
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(p => ({
    id: p.id, fullName: p.full_name, kind: p.kind,
    nationalId: p.national_id ?? null, isActive: p.is_active !== false,
  }));
}

async function addPersonnel({ schoolId, fullName, kind, nationalId = null }) {
  const { data, error } = await db
    .from('school_personnel')
    .insert({ school_id: schoolId, full_name: fullName, kind, national_id: nationalId })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function updatePersonnel(id, patch) {
  const row = {};
  if (patch.fullName   !== undefined) row.full_name   = patch.fullName;
  if (patch.kind       !== undefined) row.kind        = patch.kind;
  if (patch.nationalId !== undefined) row.national_id = patch.nationalId;
  if (patch.isActive   !== undefined) row.is_active   = patch.isActive;
  if (Object.keys(row).length === 0) return true;
  const { error } = await db.from('school_personnel').update(row).eq('id', id);
  if (error) throw error;
  return true;
}

function setPersonnelActive(id, active) {
  return updatePersonnel(id, { isActive: active });
}

// ── Teacher self check-in / out (offline-capable, mirrors student attendance) ──
function getPendingStaffAttendance() {
  return readQueue(QUEUE_STAFF_ATT).filter(r => !r.synced);
}

function markStaffAttSynced(localId) {
  const queue = readQueue(QUEUE_STAFF_ATT).map(r =>
    r.localId === localId ? { ...r, synced: true } : r
  );
  writeQueue(QUEUE_STAFF_ATT, queue);
}

// Core sync — replays a teacher self check-in/out by upserting the stored row.
async function syncStaffAttendanceRecord(payload) {
  const { error } = await db
    .from('staff_attendance')
    .upsert(payload.row, { onConflict: 'teacher_id,date', ignoreDuplicates: false });
  if (error) throw error;
  return true;
}

async function queueOrSyncStaff(payload) {
  const localId  = generateLocalId();
  const enriched = { ...payload, localId, synced: false, createdAt: new Date().toISOString() };
  if (!isOnline()) {
    const q = readQueue(QUEUE_STAFF_ATT); q.push(enriched); writeQueue(QUEUE_STAFF_ATT, q);
    return { success: true, localId, synced: false };
  }
  try {
    await syncStaffAttendanceRecord(enriched);
    return { success: true, localId, synced: true };
  } catch (err) {
    const q = readQueue(QUEUE_STAFF_ATT); q.push(enriched); writeQueue(QUEUE_STAFF_ATT, q);
    console.warn('[NSAMS] staff attendance: falling back to queue', err);
    return { success: true, localId, synced: false };
  }
}

async function teacherCheckIn(teacherId, schoolId, workStartTime = null) {
  const now  = new Date().toISOString();
  const date = localDateISO();
  const lateMinutes = computeLateMinutes(now, workStartTime);
  const row = {
    school_id: schoolId, date, kind: 'teacher', teacher_id: teacherId,
    status: staffStatusForLate(lateMinutes),
    check_in_original: now, late_minutes: lateMinutes,
    source: 'self', recorded_by: teacherId, updated_at: now,
  };
  return queueOrSyncStaff({ op: 'checkin', row });
}

async function teacherCheckOut(teacherId, schoolId) {
  const now  = new Date().toISOString();
  const date = localDateISO();
  // Only check_out is included → an upsert ON CONFLICT keeps check_in_original.
  const row = {
    school_id: schoolId, date, kind: 'teacher', teacher_id: teacherId,
    check_out: now, updated_at: now,
  };
  return queueOrSyncStaff({ op: 'checkout', row });
}

async function getMyStaffAttendanceToday(teacherId) {
  const date = localDateISO();
  const { data, error } = await db
    .from('staff_attendance')
    .select('status, check_in_original, check_in_adjusted, check_out, late_minutes, source')
    .eq('teacher_id', teacherId)
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    status:          data.status,
    checkInOriginal: data.check_in_original,
    checkInAdjusted: data.check_in_adjusted,
    checkOut:        data.check_out,
    lateMinutes:     data.late_minutes,
    source:          data.source,
  };
}

// ── Manager view: every staff member for a date, grouped by category ──
async function getStaffAttendanceForDate(schoolId, date) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;
  const [teachers, personnel, attRes] = await Promise.all([
    getTeachersBySchool(schoolId),
    getSchoolPersonnel(schoolId),
    db.from('staff_attendance')
      .select('id, kind, teacher_id, personnel_id, status, check_in_original, check_in_adjusted, check_out, late_minutes, source, adjust_reason, note')
      .eq('school_id', schoolId)
      .eq('date', isoDate),
  ]);
  if (attRes.error) throw attRes.error;

  const byTeacher = {}, byPersonnel = {};
  for (const r of attRes.data || []) {
    if (r.teacher_id)        byTeacher[r.teacher_id]    = r;
    else if (r.personnel_id) byPersonnel[r.personnel_id] = r;
  }
  const mapRow = (rec) => rec ? {
    id: rec.id, status: rec.status,
    checkInOriginal: rec.check_in_original, checkInAdjusted: rec.check_in_adjusted,
    checkOut: rec.check_out, lateMinutes: rec.late_minutes, source: rec.source,
    adjustReason: rec.adjust_reason, note: rec.note,
  } : null;

  const teacherRows = teachers.map(t => ({
    kind: 'teacher', refId: t.id, name: t.fullName, record: mapRow(byTeacher[t.id]),
  }));
  const activePersonnel = personnel.filter(p => p.isActive);
  return {
    teachers: teacherRows,
    admins:   activePersonnel.filter(p => p.kind === 'admin')
                .map(p => ({ kind: 'admin', refId: p.id, name: p.fullName, record: mapRow(byPersonnel[p.id]) })),
    workers:  activePersonnel.filter(p => p.kind === 'worker')
                .map(p => ({ kind: 'worker', refId: p.id, name: p.fullName, record: mapRow(byPersonnel[p.id]) })),
  };
}

// Manager create/edit of a single staff row (online — like confirm/reject).
async function upsertStaffAttendance({
  schoolId, date, kind, teacherId = null, personnelId = null,
  status, checkInTime = null, checkOut = null,
  adjustReason = null, note = null, workStartTime = null, adjustedBy,
}) {
  const isoDate = date instanceof Date ? localDateISO(date) : date;
  // Teachers keep their self-recorded original; a manager edit lands in the
  // adjusted column. Personnel have no self time → the manager value IS original.
  const timeCol = kind === 'teacher' ? 'check_in_adjusted' : 'check_in_original';
  const row = {
    school_id:    schoolId,
    date:         isoDate,
    kind,
    teacher_id:   kind === 'teacher' ? teacherId   : null,
    personnel_id: kind === 'teacher' ? null        : personnelId,
    status,
    [timeCol]:    checkInTime,
    check_out:    checkOut,
    source:       'manager',
    adjusted_by:  adjustedBy,
    adjust_reason: adjustReason,
    note,
    recorded_by:  adjustedBy,
    updated_at:   new Date().toISOString(),
  };
  // Lateness: cleared for absent/leave; recomputed when a time is given;
  // otherwise omitted so a teacher's self-computed value is preserved.
  if (status === 'absent' || status === 'leave') {
    row.late_minutes = null;
  } else if (checkInTime) {
    row.late_minutes = computeLateMinutes(checkInTime, workStartTime);
  } else if (kind !== 'teacher') {
    row.late_minutes = null;
  }

  const onConflict = kind === 'teacher' ? 'teacher_id,date' : 'personnel_id,date';
  const { error } = await db
    .from('staff_attendance')
    .upsert(row, { onConflict, ignoreDuplicates: false });
  if (error) throw error;
  return true;
}

// Present/absent tallies per category, to auto-fill the daily aggregate record.
async function computeStaffDailyCounts(schoolId, date) {
  const { teachers, admins, workers } = await getStaffAttendanceForDate(schoolId, date);
  const tally = (list) => {
    let present = 0, absent = 0;
    for (const p of list) {
      const st = p.record?.status;
      if (st === 'present' || st === 'late') present++;
      else if (st === 'absent')              absent++;
    }
    return { present, absent };
  };
  return { teachers: tally(teachers), admins: tally(admins), workers: tally(workers) };
}

// ─── School admin: daily summary per class ───────────────────────────────────
async function getSchoolDailySummary(schoolId, date) {
  const isoDate      = date instanceof Date ? localDateISO(date) : date;
  const academicYear = getAcademicYear(new Date(isoDate));

  const { data: classRows, error: classErr } = await db
    .from('classes')
    .select(`
      id, grade, section,
      class_teacher!left (
        role,
        teacher_id,
        users:teacher_id ( full_name )
      )
    `)
    .eq('school_id',    schoolId)
    .eq('academic_year', academicYear);

  if (classErr) throw classErr;

  const classIds = (classRows ?? []).map(c => c.id);
  if (classIds.length === 0) return [];

  const [subRes, attRes, stuRes] = await Promise.all([
    db.from('attendance_submissions')
      .select('id, class_id, status, submitted_at, confirmed_at')
      .eq('school_id', schoolId)
      .eq('date',      isoDate)
      .in('class_id',  classIds),

    db.from('daily_student_attendance')
      .select('class_id, status')
      .eq('school_id', schoolId)
      .eq('date',      isoDate)
      .in('class_id',  classIds),

    db.from('students')
      .select('class_id')
      .eq('school_id', schoolId)
      .eq('is_active', true)
      .in('class_id',  classIds),
  ]);

  if (subRes.error) throw subRes.error;
  if (attRes.error) throw attRes.error;
  if (stuRes.error) throw stuRes.error;

  const subMap = {};
  for (const s of subRes.data ?? []) subMap[s.class_id] = s;

  const attMap = {};
  for (const a of attRes.data ?? []) {
    if (!attMap[a.class_id]) {
      attMap[a.class_id] = { present: 0, absent: 0, late: 0, excused: 0 };
    }
    attMap[a.class_id][a.status]++;
  }

  const stuCount = {};
  for (const s of stuRes.data ?? []) {
    stuCount[s.class_id] = (stuCount[s.class_id] ?? 0) + 1;
  }

  return (classRows ?? []).map(c => {
    // Only the homeroom teacher / supervisor is the attendance source — never a
    // subject teacher (أستاذ مادة), who has no attendance responsibility.
    const ct = (c.class_teacher ?? []).find(t => t.role === 'homeroom' || t.role === 'supervisor');
    return {
      classId:       c.id,
      displayName:   `الصف ${gradeNameAr(c.grade)} / شعبة ${c.section}`,
      grade:         c.grade,
      section:       c.section,
      teacherName:   ct?.users?.full_name ?? '—',
      teacherId:     ct?.teacher_id ?? null,
      submission:    subMap[c.id] ?? null,
      stats:         attMap[c.id] ?? { present: 0, absent: 0, late: 0, excused: 0 },
      totalStudents: stuCount[c.id] ?? 0,
    };
  }).sort((a, b) => a.grade - b.grade || a.section.localeCompare(b.section));
}

// ─── School admin: confirm / reject a class submission ───────────────────────
async function confirmClassSubmission(submissionId, confirmedBy, notes = null) {
  const { error } = await db
    .from('attendance_submissions')
    .update({
      status:       'confirmed',
      confirmed_by: confirmedBy,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('status', 'pending');
  if (error) throw error;
}

async function rejectClassSubmission(submissionId, confirmedBy, notes) {
  if (!notes?.trim()) throw new Error('يجب إدخال سبب الإعادة');
  const { error } = await db
    .from('attendance_submissions')
    .update({
      status:       'rejected',
      confirmed_by: confirmedBy,
      confirmed_at: new Date().toISOString(),
      notes,
    })
    .eq('id', submissionId)
    .eq('status', 'pending');
  if (error) throw error;
}

// ═════════════════════════════════════════════════════════════════════════════
// Grades & report cards (الدرجات والشهادة)
// ═════════════════════════════════════════════════════════════════════════════
// Data model (tables created in Supabase, see project SQL):
//   subjects(id, school_id, grade, name, max_total, pass_mark, is_core_arabic,
//            sort_order, is_active)
//   subject_components(id, subject_id, name, max_mark, sort_order)
//   student_grades(id, student_id, class_id, school_id, subject_id, component_id,
//                  semester, academic_year, mark, recorded_by, recorded_at)
//     UNIQUE(student_id, component_id, semester, academic_year)
// A subject's semester mark = Σ component marks; the final % = average of the two
// semesters. Per-subject pass = pass_mark (Arabic parts use 50 via is_core_arabic).

// ─── School admin: subjects catalog ──────────────────────────────────────────
async function getSchoolSubjects(schoolId, grade = null) {
  let q = db
    .from('subjects')
    .select('id, school_id, grade, name, max_total, pass_mark, is_core_arabic, is_core_math, sort_order, is_active')
    .eq('school_id', schoolId);
  if (grade != null) q = q.eq('grade', grade);
  const { data, error } = await q
    .order('grade',      { ascending: true })
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name',       { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function createSubject({ schoolId, grade, name, maxTotal = 100, passMark = 40, isCoreArabic = false, isCoreMath = false, sortOrder = null }) {
  const { data, error } = await db
    .from('subjects')
    .insert({
      school_id:      schoolId,
      grade,
      name,
      max_total:      maxTotal,
      pass_mark:      passMark,
      is_core_arabic: isCoreArabic,
      is_core_math:   isCoreMath,
      sort_order:     sortOrder,
      is_active:      true,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function updateSubject(id, patch) {
  const row = {};
  if (patch.name         !== undefined) row.name           = patch.name;
  if (patch.maxTotal     !== undefined) row.max_total       = patch.maxTotal;
  if (patch.passMark     !== undefined) row.pass_mark       = patch.passMark;
  if (patch.isCoreArabic !== undefined) row.is_core_arabic  = patch.isCoreArabic;
  if (patch.isCoreMath   !== undefined) row.is_core_math    = patch.isCoreMath;
  if (patch.sortOrder    !== undefined) row.sort_order      = patch.sortOrder;
  if (patch.isActive     !== undefined) row.is_active       = patch.isActive;
  const { error } = await db.from('subjects').update(row).eq('id', id);
  if (error) throw error;
  return true;
}

async function deleteSubject(id) {
  const { error } = await db.from('subjects').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function getSubjectComponents(subjectId) {
  const { data, error } = await db
    .from('subject_components')
    .select('id, subject_id, name, max_mark, sort_order')
    .eq('subject_id', subjectId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name',       { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Replace a subject's component set with the given list (full overwrite).
// components: [{ name, maxMark }]. Existing rows are deleted then re-inserted —
// simplest correct approach for an admin editing a short list.
async function setSubjectComponents(subjectId, components) {
  const { error: delErr } = await db
    .from('subject_components')
    .delete()
    .eq('subject_id', subjectId);
  if (delErr) throw delErr;

  const rows = (components ?? [])
    .filter(c => c.name && c.name.trim())
    .map((c, i) => ({
      subject_id: subjectId,
      name:       c.name.trim(),
      max_mark:   Number(c.maxMark) || 0,
      sort_order: i,
    }));
  if (rows.length === 0) return [];

  const { data, error } = await db
    .from('subject_components')
    .insert(rows)
    .select('id, subject_id, name, max_mark, sort_order');
  if (error) throw error;
  return data ?? [];
}

// ─── Teacher: subjects gradable in a class ───────────────────────────────────
// Returns ALL active subjects defined for the class's grade, each with its
// components — the teacher can VIEW any subject's marks. Editing is limited to
// the teacher's own subjects (class_teacher.subject_ids): the portal renders
// the rest read-only, and RLS rejects writes to subjects they aren't assigned.
async function getClassGradeSubjects(classId) {
  const { data: cls, error: clsErr } = await db
    .from('classes')
    .select('id, grade, section, name, school_id')
    .eq('id', classId)
    .single();
  if (clsErr) throw clsErr;

  const subjects = await getSchoolSubjects(cls.school_id, cls.grade);
  const active   = subjects.filter(s => s.is_active);

  const withComponents = await Promise.all(
    active.map(async (s) => ({ ...s, components: await getSubjectComponents(s.id) }))
  );
  return { class: cls, subjects: withComponents };
}

// ─── Teacher: load existing grades for a class + subject + semester ───────────
// Returns { [student_id]: { [component_id]: mark } }.
async function getClassGrades(classId, subjectId, semester) {
  const academicYear = getAcademicYear();
  const { data, error } = await db
    .from('student_grades')
    .select('student_id, component_id, mark')
    .eq('class_id',      classId)
    .eq('subject_id',    subjectId)
    .eq('semester',      semester)
    .eq('academic_year', academicYear);
  if (error) throw error;

  const map = {};
  for (const row of data ?? []) {
    (map[row.student_id] ||= {})[row.component_id] = row.mark;
  }
  return map;
}

// ─── Grades offline queue ────────────────────────────────────────────────────
function getPendingStudentGrades() {
  return readQueue(QUEUE_GRADES).filter(r => !r.synced);
}

function markStudentGradesSynced(localId) {
  const queue = readQueue(QUEUE_GRADES).map(r =>
    r.localId === localId ? { ...r, synced: true } : r
  );
  writeQueue(QUEUE_GRADES, queue);
}

// Core sync — used both online (direct) and by syncPendingV2.
async function syncStudentGradesRecord(payload) {
  const { records, classId, schoolId, subjectId, semester, academicYear, teacherId } = payload;

  const rows = records.map(r => ({
    student_id:    r.studentId,
    class_id:      classId,
    school_id:     schoolId,
    subject_id:    subjectId,
    component_id:  r.componentId,
    semester,
    academic_year: academicYear,
    mark:          r.mark,
    recorded_by:   teacherId,
    recorded_at:   new Date().toISOString(),
  }));
  if (rows.length === 0) return true;

  const { error } = await db
    .from('student_grades')
    .upsert(rows, {
      onConflict: 'student_id,component_id,semester,academic_year',
      ignoreDuplicates: false,
    });
  if (error) throw error;
  return true;
}

// Save a class+subject+semester's grades. records: [{ studentId, componentId, mark }].
async function saveStudentGrades({ records, classId, schoolId, subjectId, semester, teacherId }) {
  const localId      = generateLocalId();
  const academicYear = getAcademicYear();
  const payload = {
    localId, records, classId, schoolId, subjectId, semester, academicYear, teacherId,
    synced: false, createdAt: new Date().toISOString(),
  };

  if (!isOnline()) {
    const queue = readQueue(QUEUE_GRADES);
    queue.push(payload);
    writeQueue(QUEUE_GRADES, queue);
    return { success: true, localId, synced: false };
  }

  try {
    await syncStudentGradesRecord(payload);
    return { success: true, localId, synced: true };
  } catch (err) {
    const queue = readQueue(QUEUE_GRADES);
    queue.push(payload);
    writeQueue(QUEUE_GRADES, queue);
    console.warn('[NSAMS] saveStudentGrades: falling back to queue', err);
    return { success: true, localId, synced: false };
  }
}

// ─── Conduct (درجة السلوك) — required for grades 7+ promotion ─────────────────
// One mark (0..100) per student per academic year, entered by the class's
// attendance teacher (homeroom/supervisor). Mirrors the grades offline queue.
async function getClassConduct(classId) {
  const academicYear = getAcademicYear();
  const { data, error } = await db
    .from('student_conduct')
    .select('student_id, mark')
    .eq('class_id',      classId)
    .eq('academic_year', academicYear);
  if (error) throw error;
  const map = {};
  for (const r of data ?? []) map[r.student_id] = r.mark;
  return map;
}

function getPendingStudentConduct() {
  return readQueue(QUEUE_CONDUCT).filter(r => !r.synced);
}
function markStudentConductSynced(localId) {
  writeQueue(QUEUE_CONDUCT, readQueue(QUEUE_CONDUCT).map(r =>
    r.localId === localId ? { ...r, synced: true } : r));
}

async function syncStudentConductRecord(payload) {
  const { records, classId, schoolId, academicYear, teacherId } = payload;
  const rows = records.map(r => ({
    student_id:    r.studentId,
    class_id:      classId,
    school_id:     schoolId,
    academic_year: academicYear,
    mark:          r.mark,
    recorded_by:   teacherId,
    recorded_at:   new Date().toISOString(),
  }));
  if (rows.length === 0) return true;
  const { error } = await db
    .from('student_conduct')
    .upsert(rows, { onConflict: 'student_id,academic_year', ignoreDuplicates: false });
  if (error) throw error;
  return true;
}

// Save a class's conduct marks. records: [{ studentId, mark }].
async function saveStudentConduct({ records, classId, schoolId, teacherId }) {
  const localId      = generateLocalId();
  const academicYear = getAcademicYear();
  const payload = {
    localId, records, classId, schoolId, academicYear, teacherId,
    synced: false, createdAt: new Date().toISOString(),
  };
  if (!isOnline()) {
    const q = readQueue(QUEUE_CONDUCT); q.push(payload); writeQueue(QUEUE_CONDUCT, q);
    return { success: true, localId, synced: false };
  }
  try {
    await syncStudentConductRecord(payload);
    return { success: true, localId, synced: true };
  } catch (err) {
    const q = readQueue(QUEUE_CONDUCT); q.push(payload); writeQueue(QUEUE_CONDUCT, q);
    console.warn('[NSAMS] saveStudentConduct: falling back to queue', err);
    return { success: true, localId, synced: false };
  }
}

// ─── Grace marks (درجات المساعدة) — school-admin remediation tool ─────────────
// Pushes a failing student over the line within the official caps (≤10 per
// subject, Arabic group counts once, ≤50 total). subjectId = null means the
// grace is added to the overall total only. Stored per (student, subject[,null]).
async function getClassGrace(classId) {
  const academicYear = getAcademicYear();
  const { data, error } = await db
    .from('student_grace')
    .select('student_id, subject_id, marks')
    .eq('class_id',      classId)
    .eq('academic_year', academicYear);
  if (error) throw error;
  // map[studentId] = { bySubject: { [subjectId]: marks }, total: marks }
  const map = {};
  for (const r of data ?? []) {
    const e = map[r.student_id] ||= { bySubject: {}, total: 0 };
    if (r.subject_id == null) e.total += Number(r.marks) || 0;
    else e.bySubject[r.subject_id] = Number(r.marks) || 0;
  }
  return map;
}

// Replace a student's grace for the year. items: [{ subjectId|null, marks }].
// Rows with marks <= 0 are removed. Online-only (admin tool).
async function setStudentGrace({ studentId, classId, schoolId, items, adminId }) {
  const academicYear = getAcademicYear();
  const { error: delErr } = await db
    .from('student_grace')
    .delete()
    .eq('student_id',    studentId)
    .eq('class_id',      classId)
    .eq('academic_year', academicYear);
  if (delErr) throw delErr;

  const rows = (items ?? [])
    .filter(it => Number(it.marks) > 0)
    .map(it => ({
      student_id:    studentId,
      class_id:      classId,
      school_id:     schoolId,
      academic_year: academicYear,
      subject_id:    it.subjectId ?? null,
      marks:         Number(it.marks),
      granted_by:    adminId,
      granted_at:    new Date().toISOString(),
    }));
  if (rows.length === 0) return true;
  const { error } = await db.from('student_grace').insert(rows);
  if (error) throw error;
  return true;
}

// ─── Report-card result rule (شروط النجاح والرسوب — مديرية التربية) ───────────
// Three grade bands, result is ناجح/راسب only (no مكمّل for basic education):
//   • Band A (grades 1-4): fail if MORE THAN ONE of the core areas
//     (is_core_arabic ×2 + is_core_math) is "weak" (percent < 50).
//   • Band B (grades 5-6): pass needs ALL of — total ≥ 50%, the combined Arabic
//     unit ≥ 50%, at most TWO non-Arabic subjects below 40%, and attendance ≥
//     the school's minimum. Grace marks are applied before this check.
//   • Band C (grades 7+): same as B PLUS conduct ≥ 60%.
// ctx = { band, subjects:[{percent,isCoreArabic,isCoreMath}], totalPercent,
//         arabicPercent, conductPercent, attendancePercent, minAttendancePct }.
function promotionBand(grade) {
  if (grade <= 4) return 'A';
  if (grade <= 6) return 'B';
  return 'C'; // grades 7+ (certificate grades 9/12 treated the same for now)
}

function computeYearResult(ctx) {
  if (ctx.band === 'A') {
    const weak = ctx.subjects.filter(s =>
      (s.isCoreArabic || s.isCoreMath) && s.percent != null && s.percent < 50).length;
    return weak > 1 ? 'راسب' : 'ناجح';
  }
  // Bands B and C
  const totalOk    = ctx.totalPercent != null && ctx.totalPercent >= 50;
  const arabicOk   = ctx.arabicPercent == null || ctx.arabicPercent >= 50;
  const belowForty = ctx.subjects.filter(s =>
    !s.isCoreArabic && s.percent != null && s.percent < 40).length;
  const fortyOk    = belowForty <= 2;
  // Attendance only gates when we have both a recorded % and a configured min.
  const attOk      = ctx.attendancePercent == null || ctx.minAttendancePct == null
                     || ctx.attendancePercent >= ctx.minAttendancePct;
  let ok = totalOk && arabicOk && fortyOk && attOk;
  if (ctx.band === 'C') {
    ok = ok && (ctx.conductPercent != null && ctx.conductPercent >= 60);
  }
  return ok ? 'ناجح' : 'راسب';
}

function stageForGrade(grade) {
  if (grade <= 6)  return 'primary';     // ابتدائي
  if (grade <= 9)  return 'preparatory'; // إعدادي
  return 'secondary';                    // ثانوي
}

// ─── Report cards for a whole class ──────────────────────────────────────────
// Computes, per student, each subject's semester marks, final %, pass flag, plus
// the overall year result. Returns { class, students:[{ student, subjects:[…],
// finalPercent, result }] }. Computed client-side (like getClassAbsenceSummary)
// so it runs under the school_admin read policy.
async function getClassReportCards(classId, academicYear = getAcademicYear(), term = 'year') {
  const { data: cls, error: clsErr } = await db
    .from('classes')
    .select('id, grade, section, name, school_id')
    .eq('id', classId)
    .single();
  if (clsErr) throw clsErr;

  const stage = stageForGrade(cls.grade);
  const band  = promotionBand(cls.grade);

  const [students, subjectsRaw, gradesRes, attRes, conduct, grace, schoolRes] = await Promise.all([
    getClassStudents(classId),
    getSchoolSubjects(cls.school_id, cls.grade),
    db.from('student_grades')
      .select('student_id, subject_id, component_id, semester, mark')
      .eq('class_id',      classId)
      .eq('academic_year', academicYear),
    db.from('daily_student_attendance')
      .select('student_id, status')
      .eq('class_id', classId)
      .gte('date', `${academicYear.split('-')[0]}-09-01`),
    getClassConduct(classId).catch(() => ({})),
    getClassGrace(classId).catch(() => ({})),
    db.from('schools').select('min_attendance_pct').eq('id', cls.school_id).single(),
  ]);
  if (gradesRes.error) throw gradesRes.error;
  if (attRes.error) throw attRes.error;

  const subjects = subjectsRaw.filter(s => s.is_active);
  const minAttendancePct = Number(schoolRes?.data?.min_attendance_pct ?? 75);

  // grades[studentId][subjectId][semester] = Σ component marks
  const grades = {};
  for (const r of gradesRes.data ?? []) {
    const byStu  = grades[r.student_id]  ||= {};
    const bySub  = byStu[r.subject_id]   ||= {};
    bySub[r.semester] = (bySub[r.semester] || 0) + Number(r.mark || 0);
  }

  // attendance[studentId] = { attended, total }  (present+late vs all recorded)
  const attendance = {};
  for (const r of attRes.data ?? []) {
    const e = attendance[r.student_id] ||= { attended: 0, total: 0 };
    e.total++;
    if (r.status === 'present' || r.status === 'late') e.attended++;
  }

  const isS1 = term === 's1';

  const cards = students.map(stu => {
    const stuGrades  = grades[stu.id] || {};
    const stuGrace   = grace[stu.id]  || { bySubject: {}, total: 0 };
    const subjResults = subjects.map(sub => {
      const sem  = stuGrades[sub.id] || {};
      const s1   = sem[1] ?? null;
      const s2   = sem[2] ?? null;
      const maxTotal  = Number(sub.max_total) || 100;

      // The displayed mark depends on the certificate term:
      //  • s1   → the first-semester mark alone.
      //  • year → the equal-weight average of BOTH semesters; null until both
      //           are entered, so a year card stays "incomplete" mid-year.
      let mark;
      if (isS1) {
        mark = s1;
      } else {
        mark = (s1 != null && s2 != null) ? (s1 + s2) / 2 : null;
      }
      const percent = mark == null ? null : (mark / maxTotal) * 100;
      const passed  = percent == null ? null : percent >= Number(sub.pass_mark);
      // Grace marks (درجات المساعدة) lift the subject for the promotion check.
      const graceMk = Number(stuGrace.bySubject[sub.id]) || 0;
      const markWithGrace    = mark == null ? null : mark + graceMk;
      const percentWithGrace = markWithGrace == null ? null : (markWithGrace / maxTotal) * 100;
      return {
        subjectId:    sub.id,
        name:         sub.name,
        isCoreArabic: !!sub.is_core_arabic,
        isCoreMath:   !!sub.is_core_math,
        maxTotal,
        passMark:     Number(sub.pass_mark),
        sem1:         s1,
        sem2:         s2,
        mark,
        percent,
        passed,
        grace:            graceMk,
        markWithGrace,
        percentWithGrace,
      };
    });

    const graded = subjResults.filter(s => s.mark != null);
    const complete = subjResults.length > 0 && subjResults.every(s => s.percent != null);

    // Totals (grace-applied) for the promotion gate + displayed final %.
    const sumMax   = graded.reduce((a, s) => a + s.maxTotal, 0);
    const sumMark  = graded.reduce((a, s) => a + s.markWithGrace, 0) + (Number(stuGrace.total) || 0);
    const totalPercent = sumMax ? (sumMark / sumMax) * 100 : null;
    const arSubs   = graded.filter(s => s.isCoreArabic);
    const arMax    = arSubs.reduce((a, s) => a + s.maxTotal, 0);
    const arabicPercent = arMax ? (arSubs.reduce((a, s) => a + s.markWithGrace, 0) / arMax) * 100 : null;

    const att = attendance[stu.id];
    const attendancePercent = att && att.total ? (att.attended / att.total) * 100 : null;
    const conductMark = conduct[stu.id] ?? null;

    // First-semester certificate shows marks + average only — no year verdict.
    const result = (!isS1 && complete)
      ? computeYearResult({
          band,
          subjects: subjResults.map(s => ({
            percent: s.percentWithGrace, isCoreArabic: s.isCoreArabic, isCoreMath: s.isCoreMath,
          })),
          totalPercent, arabicPercent,
          conductPercent: conductMark, attendancePercent, minAttendancePct,
        })
      : null;

    return {
      student: stu, subjects: subjResults,
      finalPercent: totalPercent, result, complete,
      attendancePercent, conductMark,
      graceTotal: Number(stuGrace.total) || 0,
    };
  });

  return { class: cls, stage, band, term, academicYear, minAttendancePct, students: cards };
}

async function getStudentReportCard(classId, studentId, academicYear = getAcademicYear(), term = 'year') {
  const all = await getClassReportCards(classId, academicYear, term);
  const card = all.students.find(c => c.student.id === studentId) || null;
  return card
    ? { class: all.class, stage: all.stage, term: all.term, academicYear: all.academicYear, ...card }
    : null;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────
async function syncPendingV2() {
  const results = {
    attendance: { synced: 0, failed: 0 },
    reports:    { synced: 0, failed: 0 },
    studentAtt: { synced: 0, failed: 0 },
    grades:     { synced: 0, failed: 0 },
    conduct:    { synced: 0, failed: 0 },
    staffAtt:   { synced: 0, failed: 0 },
    students:   { synced: 0, failed: 0 },
  };

  for (const record of getPendingAttendance()) {
    try {
      await syncAttendanceRecord(record);
      markAttendanceSynced(record.localId);
      results.attendance.synced++;
    } catch { results.attendance.failed++; }
  }

  for (const report of getPendingReports()) {
    try {
      await syncReportRecord(report);
      markReportSynced(report.localId);
      results.reports.synced++;
    } catch { results.reports.failed++; }
  }

  for (const payload of getPendingStudentAttendance()) {
    try {
      await syncStudentAttendanceRecord(payload);
      markStudentAttSynced(payload.localId);
      results.studentAtt.synced++;
    } catch { results.studentAtt.failed++; }
  }

  for (const payload of getPendingStudentGrades()) {
    try {
      await syncStudentGradesRecord(payload);
      markStudentGradesSynced(payload.localId);
      results.grades.synced++;
    } catch { results.grades.failed++; }
  }

  for (const payload of getPendingStudentConduct()) {
    try {
      await syncStudentConductRecord(payload);
      markStudentConductSynced(payload.localId);
      results.conduct.synced++;
    } catch { results.conduct.failed++; }
  }

  for (const payload of getPendingStaffAttendance()) {
    try {
      await syncStaffAttendanceRecord(payload);
      markStaffAttSynced(payload.localId);
      results.staffAtt.synced++;
    } catch { results.staffAtt.failed++; }
  }

  for (const item of getPendingStudents()) {
    try {
      await syncStudentRecord(item);
      markStudentSynced(item.localId);
      results.students.synced++;
    } catch { results.students.failed++; }
  }

  return results;
}

// ─── Staff accounts (teacher provisioning by the principal) ──────────────────
// Account creation needs the service-role key → it runs in the admin-create-staff
// Edge Function. These wrappers invoke it (online-only) and surface its Arabic
// error messages. Credentials are read directly (RLS limits them to the school's
// own admin).
async function invokeAdminStaff(payload) {
  const { data, error } = await db.functions.invoke('admin-create-staff', { body: payload });
  if (error) {
    let msg = 'تعذّر تنفيذ العملية على الخادم.';
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function createTeacherAccount({ fullName, username, password }) {
  if (!isOnline()) throw new Error('إنشاء الحساب يتطلّب اتصالاً بالإنترنت.');
  return invokeAdminStaff({ action: 'create', fullName, username, password });
}

async function updateTeacherCredential({ userId, password, fullName }) {
  if (!isOnline()) throw new Error('التعديل يتطلّب اتصالاً بالإنترنت.');
  return invokeAdminStaff({ action: 'update', userId, password, fullName });
}

async function deactivateTeacherAccount(userId) {
  if (!isOnline()) throw new Error('التعطيل يتطلّب اتصالاً بالإنترنت.');
  return invokeAdminStaff({ action: 'deactivate', userId });
}

async function deleteTeacherAccount(userId) {
  if (!isOnline()) throw new Error('الحذف يتطلّب اتصالاً بالإنترنت.');
  return invokeAdminStaff({ action: 'delete', userId });
}

// Login info for the «معلومات تسجيل الكادر» section — RLS restricts the table to
// the school's own admin, so this only ever returns the caller's school.
async function getStaffCredentials(schoolId) {
  const { data, error } = await db
    .from('staff_credentials')
    .select('id, user_id, username, password, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id, userId: r.user_id, username: r.username,
    password: r.password, createdAt: r.created_at,
  }));
}

// ─── Notifications ───────────────────────────────────────────────────────────
// VAPID_PUBLIC_KEY: replace with the output of `npx web-push generate-vapid-keys`
// after generating your keys, also add them to Supabase Edge Function secrets.
const VAPID_PUBLIC_KEY = 'BJPKEruYPsOjR7X34522QTExr7FNilujlkD1SHgR7vWAGFswsWSnFrezgA5yQvP3gQdu_j54t20UFiR9IS4YnUw';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  const output  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function getNotifications(limit = 30) {
  const { data, error } = await db
    .from('notifications')
    .select('id, type, title, body, entity, entity_id, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function getUnreadNotificationsCount() {
  const { count, error } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

async function markAllNotificationsRead() {
  const { error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw error;
}

function subscribeNotifications(userId, onNew) {
  const ch = db.channel('notif-' + userId)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications',
      filter: `recipient_id=eq.${userId}`,
    }, (payload) => onNew(payload.new))
    .subscribe();
  return () => db.removeChannel(ch);
}

async function registerPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!VAPID_PUBLIC_KEY.startsWith('B') || VAPID_PUBLIC_KEY.includes('Replace')) return; // placeholder guard
  try {
    const reg      = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub      = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const { error } = await db.functions.invoke('save-push-subscription', {
      body: { subscription: sub.toJSON() },
    });
    if (error) console.warn('[NSAMS] push subscription save failed', error);
  } catch (e) {
    console.warn('[NSAMS] registerPushSubscription failed', e);
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────
window.NSAMS_DB = {
  // Auth
  login,
  logout,
  getCurrentUser,

  // Schools
  getSchools,
  getSchoolStatus,
  getSchoolById,
  updateSchool,

  // School-level attendance & reports
  saveAttendance,
  getPendingAttendance,
  markAttendanceSynced,
  submitReport,
  getPendingReports,
  markReportSynced,

  // Directorate
  getReportsForDirectorate,
  updateReportStatus,
  getTodaySummary,
  getSchoolsAttendanceStatus,

  // Ministry
  getMinistryAttendanceSummary,
  getGovernoratesCount,

  // Teacher layer
  getAcademicYear,
  localDateISO,
  gradeNameAr,
  stageForGrade,
  getTeacherClasses,
  getClassStudents,
  getClassSubmissionStatus,
  getClassAttendanceForDate,
  getClassAttendanceReport,
  getClassAbsenceLog,
  getClassAbsenceSummary,
  // School-admin class/teacher management
  getSchoolClasses,
  getTeachersBySchool,
  getClassTeachers,
  assignTeacherToClass,
  removeTeacherFromClass,
  hasTodayAttendance,
  saveStudentAttendance,
  getPendingStudentAttendance,

  // Student records (SIS) — create / edit / transfer / archive / import
  saveStudent,
  archiveStudent,
  transferStudent,
  findDuplicateStudent,
  bulkImportStudents,
  getPendingStudents,
  writeAudit,

  // Teacher account provisioning (principal-created logins)
  createTeacherAccount,
  updateTeacherCredential,
  deactivateTeacherAccount,
  deleteTeacherAccount,
  getStaffCredentials,

  // Staff attendance (دوام الموظفين)
  getSchoolPersonnel,
  addPersonnel,
  updatePersonnel,
  setPersonnelActive,
  teacherCheckIn,
  teacherCheckOut,
  getMyStaffAttendanceToday,
  getStaffAttendanceForDate,
  upsertStaffAttendance,
  computeStaffDailyCounts,
  getPendingStaffAttendance,

  // School admin — class management
  getSchoolDailySummary,
  confirmClassSubmission,
  rejectClassSubmission,

  // Grades & report cards
  getSchoolSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  getSubjectComponents,
  setSubjectComponents,
  getClassGradeSubjects,
  getClassGrades,
  saveStudentGrades,
  getPendingStudentGrades,
  getClassConduct,
  saveStudentConduct,
  getPendingStudentConduct,
  getClassGrace,
  setStudentGrace,
  getClassReportCards,
  getStudentReportCard,
  promotionBand,

  // Sync
  syncPending: syncPendingV2,

  // Notifications & Web Push
  getNotifications,
  getUnreadNotificationsCount,
  markAllNotificationsRead,
  subscribeNotifications,
  registerPushSubscription,
};