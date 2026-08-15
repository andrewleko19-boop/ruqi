// ─────────────────────────────────────────────────────────────────────────────
//  عزل نطاق دوال الإحصاء والدليل (SECURITY DEFINER).
//
//  لماذا لا يكفي rls-sql-test.mjs: ذاك يفحص RLS على الجداول، وهذه الدوال
//  **تتجاوز RLS بالتصميم** — فهي SECURITY DEFINER تقرأ سجلات كلّ المدارس ثم
//  تُصفّيها بنفسها. فالفحص المكتوب داخلها هو الحارس الوحيد، ولا شيء وراءه.
//  خطأٌ في سطرٍ واحدٍ منه يعني مديريةً تقرأ كادر مديريةٍ أخرى بأسمائهم وأرقامهم
//  الوطنية — ولن يُنبّه RLS لأنه مُتجاوَز أصلاً.
//
//  المبدأ المختبَر: **النطاق يُشتقّ من دور المستدعي لا من معاملاته.** فتمرير
//  معرّف مدرسةٍ أجنبية يجب أن يُفرِغ النتيجة لا أن يوسّعها. هذه هي النقطة التي
//  تنكسر عادةً حين يُضاف معاملٌ جديد بعد أشهر.
//
//  الطريقة كطريقة الملفّ الجار: SET LOCAL ROLE + request.jwt.claims داخل معاملة
//  تنتهي بـ ROLLBACK دائماً. تُنشأ مديريةٌ ومدرسةٌ وكادرٌ «أجانب» داخل المعاملة
//  ثم يُلغى كلّ شيء — فلا يُكتب حرفٌ على أيّ قاعدة، إنتاجاً كانت أو محلّية.
// ─────────────────────────────────────────────────────────────────────────────
import pg from 'pg';
import { Report, paint, requireEnv } from './config.mjs';

const FOREIGN_GOV    = '__محافظة اختبار العزل__';
const FOREIGN_SCHOOL = '__مدرسة أجنبية للاختبار__';
const FOREIGN_STAFF  = '__كادر أجنبي للاختبار__';

/** يفتح معاملةً، يُشغّل fn، ثم يُلغي دائماً. */
async function inTx(c, fn) {
  await c.query('begin');
  try { return await fn(); }
  finally { await c.query('rollback').catch(() => {}); }
}

/** يتقمّص مستخدماً داخل معاملةٍ مفتوحة. يُستدعى بعد تجهيز البيانات. */
async function become(c, userId) {
  await c.query('set local role authenticated');
  await c.query(`select set_config('request.jwt.claims',
    json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [userId]);
}

/** يزرع مديريةً ومدرسةً وكادراً أجانب داخل المعاملة. يعيد معرّفاتها. */
async function seedForeign(c) {
  const { rows: [d] } = await c.query(
    `insert into public.directorates (name, governorate) values ($1, $1) returning id`,
    [FOREIGN_GOV]);
  const { rows: [s] } = await c.query(
    `insert into public.schools (directorate_id, name, school_type)
     values ($1, $2, 'primary') returning id`, [d.id, FOREIGN_SCHOOL]);
  await c.query(
    `insert into public.staff_records (school_id, full_name, staff_type, active)
     values ($1, $2, 'teaching', true)`, [s.id, FOREIGN_STAFF]);
  return { dirId: d.id, schoolId: s.id };
}

/** ينادي دالّةً ويعيد {ok, rows} أو {ok:false, err} إن رُفض النداء. */
async function callRpc(c, sql, params = []) {
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, err: e.message || String(e) }; }
}

export async function runRpcScopeTests(report) {
  requireEnv(['DATABASE_URL']);
  const url = process.env.DATABASE_URL;
  const isLocal = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  const c = new pg.Client({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    statement_timeout: 20000,
  });
  await c.connect();
  const sec = report.section('١ج) نطاق دوال الإحصاء والدليل (SECURITY DEFINER)');

  try {
    // مستخدمٌ واحد من كل دور. غيابُ أحدهم يُعطّل ما يعتمد عليه لا الفحص كلّه.
    const { rows: users } = await c.query(`
      select distinct on (role) role::text as role, id, school_id, directorate_id
      from public.users
      where role in ('directorate_user','ministry_user','school_admin','teacher')
        and is_active
      order by role, created_at`);
    const by = Object.fromEntries(users.map(u => [u.role, u]));

    const need = (role) => {
      if (!by[role]) {
        sec.rows.push(Report.row('info', `لا يوجد مستخدم بدور ${role}`,
          'شغّل supabase/seed.sql لتتوفّر حسابات كل الأدوار'));
        return false;
      }
      return true;
    };

    // ── ١) المديرية لا ترى مدرسةً خارج مديريتها ─────────────────────────────
    if (need('directorate_user')) {
      await inTx(c, async () => {
        const f = await seedForeign(c);
        await become(c, by.directorate_user.id);
        const r = await callRpc(c, 'select school_id from public.get_directorate_school_stats()');
        if (!r.ok) {
          sec.rows.push(Report.row('warn', 'get_directorate_school_stats · نداء المديرية', r.err.slice(0, 90)));
        } else {
          const leaked = r.rows.some(x => x.school_id === f.schoolId);
          sec.rows.push(leaked
            ? Report.row('fail', 'get_directorate_school_stats · مدرسة أجنبية',
                '⚠ تسريب: المديرية ترى مدرسةً خارج نطاقها')
            : Report.row('pass', 'get_directorate_school_stats · مدرسة أجنبية',
                `محجوبة (${r.rows.length} مدرسة مرئية، كلّها ضمن النطاق)`));
        }
      });

      // ── ٢) دوال الوزارة مرفوضةٌ على المديرية ──────────────────────────────
      for (const [label, sql] of [
        ['get_ministry_school_stats',      'select 1 from public.get_ministry_school_stats(null) limit 1'],
        ['get_ministry_governorate_stats', 'select 1 from public.get_ministry_governorate_stats() limit 1'],
      ]) {
        await inTx(c, async () => {
          await become(c, by.directorate_user.id);
          const r = await callRpc(c, sql);
          sec.rows.push(r.ok
            ? Report.row('fail', `${label} · نداء المديرية`, '⚠ نُفِّذت لدورٍ غير مخوَّل')
            : Report.row('pass', `${label} · نداء المديرية`, 'مرفوض — الدالة للوزارة وحدها'));
        });
      }

      // ── ٣) الدليل: المديرية لا ترى كادراً أجنبياً ولو مرّرت معرّفه ─────────
      await inTx(c, async () => {
        const f = await seedForeign(c);
        await become(c, by.directorate_user.id);
        const r = await callRpc(c,
          'select full_name from public.get_staff_directory($1, null, null, 500, 0, null)',
          [f.schoolId]);
        if (!r.ok) {
          sec.rows.push(Report.row('warn', 'get_staff_directory · نداء المديرية', r.err.slice(0, 90)));
        } else {
          sec.rows.push(r.rows.length === 0
            ? Report.row('pass', 'get_staff_directory · معرّف مدرسة أجنبية',
                'نتيجةٌ فارغة — المعامل لا يوسّع النطاق')
            : Report.row('fail', 'get_staff_directory · معرّف مدرسة أجنبية',
                `⚠ تسريب: ${r.rows.length} صفّاً من خارج المديرية`));
        }
      });

      // ── ٤) نصاب التدريس: المعامل لا يوسّع النطاق كذلك ────────────────────
      await inTx(c, async () => {
        const f = await seedForeign(c);
        await become(c, by.directorate_user.id);
        const r = await callRpc(c,
          'select full_name from public.get_teaching_load($1)', [f.schoolId]);
        sec.rows.push(!r.ok
          ? Report.row('warn', 'get_teaching_load · نداء المديرية', r.err.slice(0, 90))
          : r.rows.length === 0
            ? Report.row('pass', 'get_teaching_load · معرّف مدرسة أجنبية', 'نتيجةٌ فارغة')
            : Report.row('fail', 'get_teaching_load · معرّف مدرسة أجنبية',
                `⚠ تسريب: ${r.rows.length} معلّماً من خارج المديرية`));
      });
    }

    // ── ٥) مدير المدرسة محبوسٌ في مدرسته ولو مرّر غيرها ────────────────────
    if (need('school_admin')) {
      await inTx(c, async () => {
        const f = await seedForeign(c);
        await become(c, by.school_admin.id);
        const r = await callRpc(c,
          'select full_name from public.get_staff_directory($1, null, null, 500, 0, null)',
          [f.schoolId]);
        sec.rows.push(!r.ok
          ? Report.row('warn', 'get_staff_directory · نداء مدير المدرسة', r.err.slice(0, 90))
          : r.rows.length === 0
            ? Report.row('pass', 'get_staff_directory · مدير مدرسة يمرّر مدرسةً أخرى', 'نتيجةٌ فارغة')
            : Report.row('fail', 'get_staff_directory · مدير مدرسة يمرّر مدرسةً أخرى',
                `⚠ تسريب: ${r.rows.length} صفّاً`));
      });

      await inTx(c, async () => {
        await become(c, by.school_admin.id);
        const r = await callRpc(c, 'select 1 from public.get_directorate_school_stats() limit 1');
        sec.rows.push(r.ok
          ? Report.row('fail', 'get_directorate_school_stats · نداء مدير المدرسة',
              '⚠ نُفِّذت لدورٍ غير مخوَّل')
          : Report.row('pass', 'get_directorate_school_stats · نداء مدير المدرسة', 'مرفوض'));
      });
    }

    // ── ٦) المعلّم لا يدخل الدليل أصلاً ────────────────────────────────────
    if (need('teacher')) {
      await inTx(c, async () => {
        await become(c, by.teacher.id);
        const r = await callRpc(c,
          'select 1 from public.get_staff_directory(null, null, null, 10, 0, null) limit 1');
        sec.rows.push(r.ok
          ? Report.row('fail', 'get_staff_directory · نداء المعلّم',
              '⚠ نُفِّذت لدورٍ غير مخوَّل — سجلّات زملائه المهنية مكشوفة')
          : Report.row('pass', 'get_staff_directory · نداء المعلّم', 'مرفوض'));
      });
    }

    // ── ٧) ضابط موجب: الوزارة ترى الأجنبيّ فعلاً ──────────────────────────
    //  بدونه قد تمرّ كلُّ الفحوص أعلاه لأن الدوال لا تُرجع شيئاً لأحد.
    if (need('ministry_user')) {
      await inTx(c, async () => {
        const f = await seedForeign(c);
        await become(c, by.ministry_user.id);
        const r = await callRpc(c, 'select school_id from public.get_ministry_school_stats(null)');
        sec.rows.push(!r.ok
          ? Report.row('warn', 'get_ministry_school_stats · نداء الوزارة', r.err.slice(0, 90))
          : r.rows.some(x => x.school_id === f.schoolId)
            ? Report.row('pass', 'ضابط موجب: الوزارة ترى كلّ المدارس',
                `${r.rows.length} مدرسة — بما فيها الأجنبية`)
            : Report.row('fail', 'ضابط موجب: الوزارة ترى كلّ المدارس',
                '⚠ الوزارة لا ترى مدرسةً موجودة — الفحوص أعلاه قد تكون مضلِّلة'));
      });

      await inTx(c, async () => {
        const f = await seedForeign(c);
        await become(c, by.ministry_user.id);
        const r = await callRpc(c,
          'select full_name from public.get_staff_directory(null, null, null, 500, 0, $1)',
          [FOREIGN_GOV]);
        sec.rows.push(!r.ok
          ? Report.row('warn', 'get_staff_directory · ترشيح المحافظة', r.err.slice(0, 90))
          : r.rows.length > 0
            ? Report.row('pass', 'ترشيح المحافظة يعمل للوزارة', `${r.rows.length} صفّاً في المحافظة المطلوبة`)
            : Report.row('fail', 'ترشيح المحافظة يعمل للوزارة',
                '⚠ الترشيح أفرغ النتيجة رغم وجود كادرٍ فيها'));
      });
    }

    // ── ٨) صفحةُ التحقّق العامّة: تعمل، ولا تُفشي أكثر ممّا على الورقة ──────
    //  المسار الوحيد في النظام الذي يُنفَّذ بلا جلسة (verify.js بمفتاح anon).
    //  ولذلك لا يمرّ به أحدٌ منّا يومياً: عطلُه صامتٌ تماماً — من يمسح رمزاً
    //  مطبوعاً ويرى «تعذّر التحقّق» ليس مستخدماً يفتح تذكرة.
    await inTx(c, async () => {
      const f = await seedForeign(c);
      const { rows: [cls] } = await c.query(
        `insert into public.classes (school_id, name, grade, section, academic_year)
         values ($1, 'اختبار', '5', 'A', '2025-2026') returning id`, [f.schoolId]);
      const { rows: [st] } = await c.query(
        `insert into public.students (school_id, class_id, full_name)
         values ($1, $2, '__طالب اختبار التحقّق__') returning id`, [f.schoolId, cls.id]);

      // (أ) طالبٌ بلا أيّ جلاء: لا شيء يُعاد لغير المسجَّل. قبل الإصلاح كان
      //     فرعُ الاحتياط يُعيد اسمه ومدرستَه ومديريّتَه وصفَّه لأيّ حاملِ معرّف.
      await c.query('set local role anon');
      const bare = await callRpc(c,
        'select student_name, school_name, class_label from public.verify_certificate($1, null)',
        [st.id]);
      if (!bare.ok) {
        sec.rows.push(Report.row('fail', 'verify_certificate · نداء anon',
          `⚠ مرفوض لغير المسجَّل — كلُّ رمز QR مطبوع لا يعمل: ${bare.err.slice(0, 70)}`));
      } else {
        sec.rows.push(bare.rows.length === 0
          ? Report.row('pass', 'verify_certificate · طالبٌ بلا جلاء',
              'نتيجةٌ فارغة — لا مسارَ إلى students من غير مسجَّل')
          : Report.row('fail', 'verify_certificate · طالبٌ بلا جلاء',
              `⚠ تسريب: اسمُ الطفل ومدرستُه الحاليّة مكشوفة بلا تسجيل دخول (${JSON.stringify(bare.rows[0])})`));
      }
      await c.query('reset role');

      // (ب) ضابط موجب: جلاءٌ صادر يُعيد الصفَّ فعلاً. بدونه قد ينجح (أ) لأنّ
      //     الدالّة لا تُرجع شيئاً لأحد — فيبدو الأمانُ عطلاً متنكّراً.
      await c.query(
        `insert into public.result_sheets (school_id, class_id, academic_year, term, status, snapshot_data)
         values ($1, $2, '2025-2026', 'final', 'issued', $3::jsonb)`,
        [f.schoolId, cls.id, JSON.stringify({
          classLabel: 'الصف 5 / A',
          students: [{ studentId: st.id, name: '__طالب اختبار التحقّق__', result: 'ناجح', finalPercent: 88.5 }],
        })]);
      await c.query('set local role anon');
      const issued = await callRpc(c,
        'select student_name, result, issued from public.verify_certificate($1, null)', [st.id]);
      sec.rows.push(!issued.ok
        ? Report.row('fail', 'ضابط موجب: جلاءٌ صادر يُقرأ', issued.err.slice(0, 90))
        : issued.rows.length === 1 && issued.rows[0].issued === true && issued.rows[0].result === 'ناجح'
          ? Report.row('pass', 'ضابط موجب: جلاءٌ صادر يُقرأ',
              'الشهادة الصادرة تُعرَض — الفحص (أ) ليس أعمى')
          : Report.row('fail', 'ضابط موجب: جلاءٌ صادر يُقرأ',
              `⚠ الشهادة الصادرة لا تُقرأ: ${JSON.stringify(issued.rows)}`));
      await c.query('reset role');

      // (ج) جلاءٌ مُرسَل لم يُعتمد: يُثبَت وجودُه ولا تُعلَن نتيجتُه — قرارُ
      //     النجاح أو الرسوب لا يُنشر قبل اعتماد المديرية.
      await c.query(`update public.result_sheets set status = 'submitted' where class_id = $1`, [cls.id]);
      await c.query('set local role anon');
      const draft = await callRpc(c,
        'select result, final_percent, issued from public.verify_certificate($1, null)', [st.id]);
      sec.rows.push(!draft.ok
        ? Report.row('warn', 'verify_certificate · جلاءٌ غير صادر', draft.err.slice(0, 90))
        : draft.rows.length === 1 && draft.rows[0].issued === false
            && draft.rows[0].result === null && draft.rows[0].final_percent === null
          ? Report.row('pass', 'verify_certificate · جلاءٌ غير صادر',
              'issued=false بلا نتيجةٍ ولا نسبة')
          : Report.row('fail', 'verify_certificate · جلاءٌ غير صادر',
              `⚠ نتيجةٌ تُعلَن قبل اعتماد المديرية: ${JSON.stringify(draft.rows)}`));
      await c.query('reset role');
    });

    return sec;
  } finally {
    await c.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = new Report();
  await runRpcScopeTests(report);
  report.print();
  const cts = report.counts();
  console.log(`\n${paint.bold('الحصيلة:')} ${paint.pass(cts.pass + ' ✓')}  ${paint.fail(cts.fail + ' ✗')}  ${paint.warn(cts.warn + ' ⚠')}`);
  process.exit(cts.fail > 0 ? 1 : 0);
}
