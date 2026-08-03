// ─────────────────────────────────────────────────────────────────────────────
//  اختبار عزل المستأجر (RLS): مدير مدرسة A يحاول قراءة/تعديل/إدراج/حذف بيانات
//  مدرسة B عبر مسار PostgREST نفسه الذي يستعمله المتصفّح — فتُطبَّق RLS تماماً
//  كما في الإنتاج (لا نستعمل مفتاح الخدمة هنا لأنه يتجاوز RLS).
//
//  لكل جدول حسّاس نُجري مصفوفة:
//    SELECT صفّ B   → يجب أن يعود فارغاً        (وإلّا تسريب قراءة)
//    UPDATE صفّ B   → يجب أن يُصيب 0 صفوف         (نتحقّق بالخدمة أنه لم يتغيّر)
//    INSERT بـ B    → يجب أن يُرفَض (خطأ RLS)      (وإلّا تسريب كتابة)
//    DELETE صفّ B   → يجب أن يُصيب 0 صفوف          (نتحقّق بالخدمة أنه ما زال موجوداً)
//  + ضابط موجب: SELECT صفّ A نفسه → يجب أن يعود بصفّ واحد (يُثبت أن الأداة تعمل).
// ─────────────────────────────────────────────────────────────────────────────
import { serviceClient, anonClient, Report, paint } from './config.mjs';
import { createFixtures, teardown } from './seed.mjs';

// الجداول التي نبذرها ونعرف بنيتها → اختبار قاطع (conclusive)
function tableMatrix(A, B) {
  return [
    {
      table: 'students', pii: 'أسماء الطلاب وبياناتهم',
      rowIdA: A.studentId, rowIdB: B.studentId,
      updatePatch: { full_name: 'HACKED_BY_A' },
      insertRow: { school_id: B.id, class_id: B.classId, full_name: 'INJECTED', is_active: true, created_at: new Date().toISOString() },
    },
    {
      table: 'daily_student_attendance', pii: 'سجلّات الحضور اليومي',
      rowIdA: A.attendanceId, rowIdB: B.attendanceId,
      updatePatch: { status: 'absent' },
      insertRow: { student_id: B.studentId, class_id: B.classId, school_id: B.id, date: '2000-01-01', status: 'present' },
    },
    {
      table: 'classes', pii: 'بنية الصفوف',
      rowIdA: A.classId, rowIdB: B.classId,
      updatePatch: { name: 'HACKED_CLASS' },
      insertRow: { school_id: B.id, name: 'INJECTED', grade: 9, section: 'ز', academic_year: A.password ? '2025-2026' : '2025-2026' },
    },
    {
      table: 'schools', pii: 'سجلّ المدرسة نفسه', idCol: 'id',
      rowIdA: A.id, rowIdB: B.id,
      updatePatch: { name: 'HACKED_SCHOOL' },
      insertRow: null, // إنشاء مدرسة عبر مدير مدرسة يجب أن يُرفض أصلاً
    },
    {
      table: 'users', pii: 'دليل المستخدمين وأدوارهم', idCol: 'id', tenantCol: 'school_id',
      rowIdA: A.adminId, rowIdB: B.adminId,
      updatePatch: { full_name: 'HACKED_USER' },
      insertRow: null,
    },
  ];
}

async function signIn(email, password) {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`تسجيل دخول مدير الاختبار فشل: ${error.message}`);
  return c;
}

export async function runRlsTests(report, fx) {
  const svc = serviceClient();
  const sec = report.section('١) عزل المستأجر (RLS) — هل ترى مدرسةٌ بيانات أخرى؟');
  const attacker = await signIn(fx.A.adminEmail, fx.A.password); // مدير A هو «المهاجم»

  // ── ضابط موجب: مدير A يرى صفّه هو ─────────────────────────────────────────
  {
    const { data } = await attacker.from('students').select('id').eq('id', fx.A.studentId);
    if (data && data.length === 1) {
      sec.rows.push(Report.row('pass', 'ضابط موجب: مدير A يقرأ طالب مدرسته', 'الأداة تعمل — القراءة المشروعة تنجح'));
    } else {
      sec.rows.push(Report.row('warn', 'ضابط موجب فشل: مدير A لا يرى حتى بيانات مدرسته',
        'قد تكون RLS أشدّ من اللازم أو الـseed لم يُربط بالمستخدم — النتائج أدناه قد تكون مضلِّلة'));
    }
  }

  for (const t of tableMatrix(fx.A, fx.B)) {
    const idCol = t.idCol || 'id';

    // (أ) SELECT صفّ B
    try {
      const { data, error } = await attacker.from(t.table).select('*').eq(idCol, t.rowIdB);
      if (error) {
        sec.rows.push(Report.row('pass', `${t.table} · SELECT بيانات B`, 'مرفوض بخطأ RLS'));
      } else if ((data || []).length === 0) {
        sec.rows.push(Report.row('pass', `${t.table} · SELECT بيانات B`, 'عاد فارغاً — العزل سليم'));
      } else {
        sec.rows.push(Report.row('fail', `${t.table} · SELECT بيانات B (${t.pii})`,
          `⚠ تسريب قراءة: عادت ${data.length} صف — مدير A يرى بيانات B`));
      }
    } catch (e) { sec.rows.push(Report.row('warn', `${t.table} · SELECT`, e.message)); }

    // (ب) UPDATE صفّ B — نتحقّق فعلياً بالخدمة أنه لم يتغيّر
    try {
      const patchKey = Object.keys(t.updatePatch)[0];
      const before = await svc.from(t.table).select(patchKey).eq(idCol, t.rowIdB).single();
      await attacker.from(t.table).update(t.updatePatch).eq(idCol, t.rowIdB);
      const after = await svc.from(t.table).select(patchKey).eq(idCol, t.rowIdB).single();
      const changed = JSON.stringify(before.data?.[patchKey]) !== JSON.stringify(after.data?.[patchKey]);
      if (changed) {
        sec.rows.push(Report.row('fail', `${t.table} · UPDATE بيانات B (${t.pii})`,
          `⚠ تسريب كتابة: تغيّر ${patchKey} فعلياً في مدرسة B`));
        await svc.from(t.table).update({ [patchKey]: before.data[patchKey] }).eq(idCol, t.rowIdB); // استرجاع
      } else {
        sec.rows.push(Report.row('pass', `${t.table} · UPDATE بيانات B`, 'لم يتغيّر شيء — العزل سليم'));
      }
    } catch (e) { sec.rows.push(Report.row('warn', `${t.table} · UPDATE`, e.message)); }

    // (ج) INSERT بصفّ يخصّ B
    if (t.insertRow) {
      try {
        const { data, error } = await attacker.from(t.table).insert(t.insertRow).select(idCol);
        if (error) {
          sec.rows.push(Report.row('pass', `${t.table} · INSERT في مدرسة B`, `مرفوض (${error.code || 'RLS'})`));
        } else if (data && data.length) {
          sec.rows.push(Report.row('fail', `${t.table} · INSERT في مدرسة B (${t.pii})`,
            '⚠ تسريب كتابة: أُدرج صفّ منسوب لمدرسة B'));
          await svc.from(t.table).delete().eq(idCol, data[0][idCol]); // تنظيف
        } else {
          sec.rows.push(Report.row('pass', `${t.table} · INSERT في مدرسة B`, 'لم يُدرَج شيء'));
        }
      } catch (e) { sec.rows.push(Report.row('warn', `${t.table} · INSERT`, e.message)); }
    }

    // (د) DELETE صفّ B — نتحقّق أنه ما زال موجوداً
    try {
      await attacker.from(t.table).delete().eq(idCol, t.rowIdB);
      const still = await svc.from(t.table).select(idCol).eq(idCol, t.rowIdB);
      if ((still.data || []).length === 0) {
        sec.rows.push(Report.row('fail', `${t.table} · DELETE بيانات B (${t.pii})`,
          '⚠ تسريب حذف: اختفى صفّ مدرسة B — قابل لإتلاف بيانات مدرسة أخرى'));
      } else {
        sec.rows.push(Report.row('pass', `${t.table} · DELETE بيانات B`, 'ما زال موجوداً — العزل سليم'));
      }
    } catch (e) { sec.rows.push(Report.row('warn', `${t.table} · DELETE`, e.message)); }
  }

  await attacker.auth.signOut().catch(() => {});
  return sec;
}

// تشغيل مستقلّ: node rls-test.mjs  (يبذر، يختبر، ينظّف)
if (import.meta.url === `file://${process.argv[1]}`) {
  const report = new Report();
  let fx;
  try {
    fx = await createFixtures();
    await runRlsTests(report, fx);
  } finally {
    if (fx) await teardown().catch((e) => console.error(paint.warn('تنظيف جزئي: ' + e.message)));
  }
  report.print();
  const c = report.counts();
  console.log(`\n${paint.bold('الحصيلة:')} ${paint.pass(c.pass + ' ✓')}  ${paint.fail(c.fail + ' ✗')}  ${paint.warn(c.warn + ' ⚠')}`);
  process.exit(c.fail > 0 ? 1 : 0);
}
