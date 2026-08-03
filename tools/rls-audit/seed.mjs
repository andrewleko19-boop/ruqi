// ─────────────────────────────────────────────────────────────────────────────
//  البذر والتنظيف: ينشئ مديريةً واحدة + مدرستين (A، B) تحتها + مدير مدرسة لكلٍّ
//  منهما + صفّاً وطالباً وسجلّ حضور لكل مدرسة. كل شيء موسوم بـ MARK والبريد على
//  نطاق @ruqi-audit.test حتى يكون التنظيف مؤكّداً حتى لو انقطع التشغيل.
//
//  وضع «مدرستان تحت نفس المديرية» مقصود: يجعل اختبار العزل أقوى — يجب أن يبقى
//  مدير A عاجزاً عن رؤية بيانات B رغم أنهما في المديرية ذاتها.
// ─────────────────────────────────────────────────────────────────────────────
import { serviceClient, MARK, ACADEMIC_YEAR, uid, nowIso, paint } from './config.mjs';

const EMAIL_DOMAIN = 'ruqi-audit.test';
const PASSWORD     = 'Rls-Audit-' + uid(10) + '!9';

async function insTag(svc, table, row, select = 'id') {
  const { data, error } = await svc.from(table).insert(row).select(select).single();
  if (error) throw new Error(`إدراج ${table} فشل: ${error.message} (${error.code || ''})`);
  return data;
}

async function makeSchool(svc, directorateId, tag) {
  const school = await insTag(svc, 'schools', {
    name: `${MARK} ${tag}`,
    directorate_id: directorateId,
    total_students: 50,
    total_teachers: 8,
    school_type: 'primary',
  });

  const email = `rls-audit-${tag.toLowerCase()}-${uid(6)}@${EMAIL_DOMAIN}`;
  const { data: created, error: aErr } = await svc.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { rls_audit: true },
  });
  if (aErr) throw new Error(`إنشاء مستخدم auth (${tag}) فشل: ${aErr.message}`);
  const adminId = created.user.id;

  await insTag(svc, 'users', {
    id: adminId,
    full_name: `${MARK} مدير ${tag}`,
    role: 'school_admin',
    school_id: school.id,
    created_at: nowIso(),
  }, 'id');

  const cls = await insTag(svc, 'classes', {
    school_id: school.id,
    name: `${MARK} الصف الأول`,
    grade: 1,
    section: 'أ',
    academic_year: ACADEMIC_YEAR,
  });

  const student = await insTag(svc, 'students', {
    school_id: school.id,
    class_id: cls.id,
    full_name: `${MARK} طالب ${tag}`,
    is_active: true,
    created_at: nowIso(),
  });

  const today = new Date().toISOString().slice(0, 10);
  const att = await insTag(svc, 'daily_student_attendance', {
    student_id: student.id,
    class_id: cls.id,
    school_id: school.id,
    date: today,
    status: 'present',
  });

  return {
    tag, id: school.id, adminId, adminEmail: email, password: PASSWORD,
    classId: cls.id, studentId: student.id, attendanceId: att.id,
  };
}

export async function createFixtures(svc = serviceClient()) {
  console.log(paint.dim('  … بذر بيانات الاختبار (مديرية + مدرستان + مديران + طلاب + حضور)'));
  const dir = await insTag(svc, 'directorates', {
    name: `${MARK} مديرية الاختبار`,
    governorate: 'اختبار',
  });
  const A = await makeSchool(svc, dir.id, 'SchoolA');
  const B = await makeSchool(svc, dir.id, 'SchoolB');
  console.log(paint.dim(`  … تمّ: A=${A.id.slice(0, 8)}  B=${B.id.slice(0, 8)}`));
  return { directorateId: dir.id, A, B, password: PASSWORD };
}

// ── التنظيف: يحذف كل شيء موسوم، مباشرةً عبر مفتاح الخدمة (يتجاوز RLS) ─────────
export async function teardown(svc = serviceClient()) {
  console.log(paint.dim('  … تنظيف بيانات الاختبار'));
  // 1) المدارس الموسومة → نحذف أبناءها أولاً ثم المدارس
  const { data: schools } = await svc.from('schools').select('id').like('name', `${MARK}%`);
  const schoolIds = (schools || []).map((s) => s.id);
  if (schoolIds.length) {
    for (const t of ['daily_student_attendance', 'students', 'classes']) {
      await svc.from(t).delete().in('school_id', schoolIds);
    }
    await svc.from('users').delete().in('school_id', schoolIds);
    await svc.from('schools').delete().in('id', schoolIds);
  }
  await svc.from('directorates').delete().like('name', `${MARK}%`);

  // 2) مستخدمو auth على نطاق الاختبار (نمرّ على الصفحات)
  let removed = 0;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    const mine = data.users.filter((u) => (u.email || '').endsWith('@' + EMAIL_DOMAIN));
    for (const u of mine) { await svc.auth.admin.deleteUser(u.id); removed++; }
    if (data.users.length < 200) break;
  }
  console.log(paint.dim(`  … حُذف ${schoolIds.length} مدرسة و${removed} مستخدم اختبار`));
}

// تشغيل مباشر: node seed.mjs --teardown-only
if (import.meta.url === `file://${process.argv[1]}`) {
  const svc = serviceClient();
  if (process.argv.includes('--teardown-only')) {
    await teardown(svc);
  } else {
    const fx = await createFixtures(svc);
    console.log(JSON.stringify(fx, null, 2));
    console.log(paint.warn('\nملاحظة: بيانات الاختبار ما زالت قائمة. للتنظيف: npm run teardown'));
  }
}
