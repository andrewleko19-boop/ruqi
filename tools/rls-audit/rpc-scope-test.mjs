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
         values ($1, $2, '2025-2026', 'year', 'issued', $3::jsonb)`,
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

    // ── ٩) ربطُ وليّ الأمر يُسحب حين يتغيّر الرقم ───────────────────────────
    //  الوصول مشتقٌّ من رقمٍ يتغيّر، وكلُّ مسارات الربط كانت إدراجاً فقط — فمن
    //  كان رقمه مسجَّلاً لحظةَ التسجيل يبقى له سجلُّ الطفل بعد تصحيح الرقم.
    await inTx(c, async () => {
      const f = await seedForeign(c);
      const { rows: [cls] } = await c.query(
        `insert into public.classes (school_id, name, grade, section, academic_year)
         values ($1, 'اختبار', '5', 'A', '2025-2026') returning id`, [f.schoolId]);

      // حسابُ وليّ أمرٍ حقيقيّ: الزناد يقرأ auth.users.email لاشتقاق الرقم.
      let parentId;
      try {
        const { rows: [p] } = await c.query(
          `insert into auth.users (id, email)
           values (gen_random_uuid(), '+963911111111@parent.nsams.local') returning id`);
        parentId = p.id;
      } catch (e) {
        sec.rows.push(Report.row('warn', 'سحب ربط وليّ الأمر',
          `تعذّر زرع حساب وليّ أمر: ${(e.message || '').slice(0, 70)}`));
        return;
      }

      const { rows: [st] } = await c.query(
        `insert into public.students (school_id, class_id, full_name, parent_phone)
         values ($1, $2, '__طالب اختبار الربط__', '0911111111') returning id`,
        [f.schoolId, cls.id]);
      await c.query(
        `insert into public.parent_links (user_id, student_id) values ($1, $2)`,
        [parentId, st.id]);

      const linksNow = async () => (await c.query(
        'select count(*)::int as n from public.parent_links where user_id = $1 and student_id = $2',
        [parentId, st.id])).rows[0].n;

      // (أ) تغييرُ الصيغة وحدها ليس تغييرَ شخص — سحبٌ هنا يعني أباً يفقد سجلّ
      //     ابنه بلا سبب، وهو خطأٌ أقسى من العلّة نفسها.
      await c.query(`update public.students set parent_phone = '+963911111111' where id = $1`, [st.id]);
      sec.rows.push(await linksNow() === 1
        ? Report.row('pass', 'ربط وليّ الأمر · تغيّر صيغة الرقم', 'الربط باقٍ — الرقم نفسه')
        : Report.row('fail', 'ربط وليّ الأمر · تغيّر صيغة الرقم',
            '⚠ سُحب الربط لمجرّد اختلاف الصيغة — الأهل يفقدون سجلّ أبنائهم'));

      // (ب) رقمٌ آخر فعلاً: يُسحب فوراً عند مصدر التغيير.
      await c.query(`update public.students set parent_phone = '0922222222' where id = $1`, [st.id]);
      sec.rows.push(await linksNow() === 0
        ? Report.row('pass', 'ربط وليّ الأمر · تغيّر الرقم فعلاً', 'سُحب الربط فور التغيير')
        : Report.row('fail', 'ربط وليّ الأمر · تغيّر الرقم فعلاً',
            '⚠ صاحبُ الرقم القديم ما زال يقرأ علامات الطفل ودوامَه وحالة قيده'));

      // (ج) رقمُ التواصل يكفي: تغييرُ أحد الحقلين لا يسحب ما يُثبته الآخر.
      await c.query(
        `update public.students set parent_phone = '0911111111', contact_phone = '0911111111' where id = $1`,
        [st.id]);
      await c.query(`insert into public.parent_links (user_id, student_id) values ($1, $2)
                     on conflict do nothing`, [parentId, st.id]);
      await c.query(`update public.students set parent_phone = '0933333333' where id = $1`, [st.id]);
      sec.rows.push(await linksNow() === 1
        ? Report.row('pass', 'ربط وليّ الأمر · رقم التواصل ما زال مطابقاً', 'الربط باقٍ')
        : Report.row('fail', 'ربط وليّ الأمر · رقم التواصل ما زال مطابقاً',
            '⚠ سُحب الربط رغم مطابقة رقم التواصل'));
    });

    // ── ١٠) الطلاب المغادرون: النطاق يُشتقّ من الدور لا من المعامل ──────────
    await inTx(c, async () => {
      const f = await seedForeign(c);
      // نُلحق فصلاً وطالباً منقولاً بالمدرسة الأجنبية
      const { rows: [cls] } = await c.query(
        `insert into public.classes (school_id, name, grade, section, academic_year)
         values ($1, 'خ', '5', 'A', '2025-2026') returning id`, [f.schoolId]);
      await c.query(
        `insert into public.students (school_id, class_id, full_name, status, status_reason)
         values ($1, $2, '__طالب__', 'transferred', 'اختبار العزل')`, [f.schoolId, cls.id]);

      if (need('school_admin')) {
        await become(c, by.school_admin.id);
        const r = await callRpc(c,
          'select full_name from public.get_departed_students($1, null)', [f.schoolId]);
        sec.rows.push(!r.ok
          ? Report.row('warn', 'get_departed_students · مدير مدرسة يمرّر مدرسة أجنبية', r.err.slice(0, 90))
          : r.rows.length === 0
            ? Report.row('pass', 'get_departed_students · مدير مدرسة يمرّر مدرسة أجنبية',
                'نتيجةٌ فارغة — المعامل لا يوسّع النطاق')
            : Report.row('fail', 'get_departed_students · مدير مدرسة يمرّر مدرسة أجنبية',
                `⚠ تسريب: ${r.rows.length} طالباً`));
      }

      if (need('directorate_user') && by.directorate_user.directorate_id !== f.dirId) {
        await become(c, by.directorate_user.id);
        const r = await callRpc(c, 'select school_name from public.get_directorate_departures()');
        if (r.ok) {
          const leaked = r.rows.some(x => x.school_name === '__مدرسة أجنبية للاختبار__');
          sec.rows.push(leaked
            ? Report.row('fail', 'get_directorate_departures · مدرسة أجنبية',
                '⚠ تسريب: كشف المديرية يحوي مدرسة خارج نطاقها')
            : Report.row('pass', 'get_directorate_departures · مدرسة أجنبية',
                'محجوبة (المديرية ترى مدارسها وحدها)'));
        }
      }
    });

    // ── ١١) الفصل الحاليّ: قراءةٌ للكلّ، كتابةٌ للوزارة وحدها ────────────────
    await inTx(c, async () => {
      if (need('school_admin')) {
        await become(c, by.school_admin.id);
        const r = await callRpc(c, 'select public.current_term() as t');
        sec.rows.push(r.ok && r.rows[0]?.t
          ? Report.row('pass', 'current_term · مدير المدرسة يقرأ', `القيمة: ${r.rows[0].t}`)
          : Report.row('fail', 'current_term · مدير المدرسة يقرأ',
              r.ok ? 'قيمةٌ فارغة' : r.err.slice(0, 90)));
        const w = await callRpc(c, `update public.app_settings set current_term = 's2' where id returning current_term`);
        sec.rows.push(w.ok && w.rows.length === 0
          ? Report.row('pass', 'app_settings · مدير المدرسة لا يكتب', 'صفوف مكتوبة: 0')
          : Report.row('fail', 'app_settings · مدير المدرسة لا يكتب',
              w.ok ? `⚠ كتب ${w.rows.length} صفّاً` : w.err.slice(0, 90)));
      }
      if (need('ministry_user')) {
        await become(c, by.ministry_user.id);
        const w = await callRpc(c, `update public.app_settings set current_term = 's2' where id returning current_term`);
        sec.rows.push(w.ok && w.rows.length === 1
          ? Report.row('pass', 'app_settings · الوزارة تكتب', 'تغيّرت القيمة إلى s2')
          : Report.row('fail', 'app_settings · الوزارة تكتب',
              w.ok ? '⚠ لم يُكتب صفّ' : w.err.slice(0, 90)));
      }
    });

    /* ── ١٢) دوالُّ المزامنة: أخطرُ سطحٍ في النظام ─────────────────────────
       pull_*_delta تتجاوز RLS بالتصميم، و pull_students_delta تُرجع صفَّ
       students كاملاً: الرقم الوطنيّ واسم الأمّ وهاتف الأهل والعنوان. كانت بلا
       أيّ فحصِ صلاحية، فأيُّ حسابٍ مصادَق يقرأ سجلَّ أيّ صفٍّ في القطر بمعرّفه.
       الحارسُ هنا يمنع عودتَها: مهاجمٌ يُرَدّ صفراً، وضابطٌ موجب يمنع أن يمرّ
       الفحصُ لأنّ الدالّة عطبت وصارت تُرجع فراغاً للجميع. */
    await inTx(c, async () => {
      const f = await seedForeign(c);
      const { rows: [cls] } = await c.query(
        `insert into public.classes (school_id, name, grade, section, academic_year)
         values ($1, 'خ', '5', 'A', '2025-2026') returning id`, [f.schoolId]);
      await c.query(
        `insert into public.students (school_id, class_id, full_name, national_id)
         values ($1, $2, '__طالب__', '09999999999')`, [f.schoolId, cls.id]);

      const DELTAS = ['pull_students_delta', 'pull_grades_delta',
                      'pull_attendance_delta', 'pull_conduct_delta'];

      // المهاجم: مدير مدرسةٍ أخرى تماماً (أدنى امتيازاً من اللازم لهذا الصفّ).
      if (need('school_admin')) {
        await become(c, by.school_admin.id);
        for (const fn of DELTAS) {
          const r = await callRpc(c,
            `select 1 from public.${fn}($1, '2000-01-01'::timestamptz)`, [cls.id]);
          sec.rows.push(!r.ok
            ? Report.row('warn', `${fn} · صفٌّ أجنبيّ`, r.err.slice(0, 90))
            : r.rows.length === 0
              ? Report.row('pass', `${fn} · صفٌّ أجنبيّ`, 'نتيجةٌ فارغة — المعامل لا يوسّع النطاق')
              : Report.row('fail', `${fn} · صفٌّ أجنبيّ`,
                  `⚠ تسريب: ${r.rows.length} صفّاً من مدرسةٍ أخرى (RLS متجاوَز)`));
        }
      }

      // ضابطٌ موجب: معلّمُ الصفّ يقرأ فعلاً.
      // reset role أوّلاً: الفحص أعلاه تقمّص مدير مدرسة، والزرعُ يحتاج postgres.
      await c.query('reset role');
      const { rows: [tu] } = await c.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), 'sync-probe@t.local') returning id`);
      await c.query(
        `insert into public.users (id, role, permission_role, school_id, full_name, is_active)
         values ($1, 'teacher', 'teacher', $2, '__معلّم__', true)`, [tu.id, f.schoolId]);
      await c.query(
        `insert into public.class_teacher (class_id, teacher_id, academic_year, role)
         values ($1, $2, '2025-2026', 'homeroom')`, [cls.id, tu.id]);
      await become(c, tu.id);
      const ok = await callRpc(c,
        `select 1 from public.pull_students_delta($1, '2000-01-01'::timestamptz)`, [cls.id]);
      sec.rows.push(ok.ok && ok.rows.length === 1
        ? Report.row('pass', 'ضابط موجب: معلّم الصفّ يزامن صفَّه',
            'سطرٌ واحد — الحارس لا يمنع العمل المشروع')
        : Report.row('fail', 'ضابط موجب: معلّم الصفّ يزامن صفَّه',
            ok.ok ? `⚠ ${ok.rows.length} سطراً — المزامنة معطوبة والفحوص أعلاه مضلِّلة`
                  : ok.err.slice(0, 90)));
    });

    /* ── ١٣) سجلّ دوام الكادر: المعلّم يكتب داتَه لا حكمَ مديره ─────────────
       كانت على staff_attendance سياستان لكلّ أمر: محكمةٌ على authenticated
       وتوأمٌ أرخى على PUBLIC. وسياساتُ الأمر الواحد تُجمَع بـ OR، فالأرخى هي
       النافذة. النتيجة أنّ معلّماً سجّل عليه مديرُه «غائب» بعذرٍ موثَّق و٤٥
       دقيقة تأخّر، كان يقلبه إلى «حاضر» ويمحو أثرَ التعديل — بلا إشعار، لأنّ
       زناد trg_duty_adjusted يشترط adjusted_by وقد فرّغه.

       هذه الفحوص تحرس الطبقتين معاً: RLS تحسم مَن يكتب وأين، والزنادُ
       trg_staff_att_self_guard يحسم أيَّ عمود. وفيها ضابطان موجبان: تسجيلُ
       الانصراف يبقى ممكناً، وإلّا كان «الأمان» تعطيلاً للبوّابة. */
    await inTx(c, async () => {
      const f = await seedForeign(c);
      const { rows: [s2] } = await c.query(
        `insert into public.schools (directorate_id, name, school_type)
         values ($1, '__مدرسة ثانية للاختبار__', 'primary') returning id`, [f.dirId]);
      const otherSchoolId = s2.id;
      const { rows: [au] } = await c.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), 'att-probe@t.local') returning id`);
      const { rows: [tu] } = await c.query(
        `insert into public.users (id, role, permission_role, school_id, full_name, is_active)
         values ($1, 'teacher', 'teacher', $2, '__معلّم دوام__', true) returning id`, [au.id, f.schoolId]);
      const { rows: [ad] } = await c.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), 'att-adm@t.local') returning id`);
      await c.query(
        `insert into public.users (id, role, permission_role, school_id, full_name, is_active)
         values ($1, 'school_admin', 'school_admin', $2, '__مدير دوام__', true)`, [ad.id, f.schoolId]);

      // حكمُ المدير: غائبٌ بعذرٍ موثَّق وتأخّرٌ محسوب.
      const { rows: [rec] } = await c.query(
        `insert into public.staff_attendance
           (school_id, date, kind, teacher_id, status, source,
            adjusted_by, adjust_reason, late_minutes, recorded_by)
         values ($1, current_date, 'teacher', $2, 'absent', 'manager', $3, 'تغيّب بلا عذر', 45, $3)
         returning id`, [f.schoolId, tu.id, ad.id]);

      await become(c, tu.id);

      /** ينفّذ داخل نقطة حفظ فلا يُجهض الفحوصَ التالية عند الرفض. */
      const attempt = async (sql, params) => {
        await c.query('savepoint sa');
        try { const r = await c.query(sql, params); await c.query('release savepoint sa'); return { ok: true, n: r.rowCount }; }
        catch (e) { await c.query('rollback to savepoint sa'); return { ok: false, err: e.message }; }
      };

      // أ) المصدر يُحسم من هويّة الكاتب لا من حمولته.
      const forged = await attempt(
        `insert into public.staff_attendance (school_id, date, kind, teacher_id, status, source)
         values ($1, current_date - 1, 'teacher', $2, 'present', 'manager')`, [f.schoolId, tu.id]);
      if (!forged.ok) {
        sec.rows.push(Report.row('warn', 'دوام · انتحال المصدر', forged.err.slice(0, 90)));
      } else {
        const { rows: [g] } = await c.query(
          `select source, recorded_by from public.staff_attendance
            where teacher_id = $1 and date = current_date - 1`, [tu.id]);
        sec.rows.push(g.source === 'self' && g.recorded_by === tu.id
          ? Report.row('pass', 'دوام · انتحال المصدر',
              "أُرسل source='manager' فصُحِّح إلى 'self' — النسبة لا تُدّعى")
          : Report.row('fail', 'دوام · انتحال المصدر',
              `⚠ ثبت source='${g.source}' — تسجيلةُ المعلّم تظهر منسوبةً إلى المدير`));
      }

      // ب) العزل: لا كتابةَ في مدرسةٍ أجنبية. (مدرسةٌ ثانيةٌ مزروعةٌ في المعاملة
      //    نفسها — لا نتّكل على بذرةٍ قد لا تكون موجودة.)
      const cross = await attempt(
        `insert into public.staff_attendance (school_id, date, kind, teacher_id, status)
         values ($1, current_date - 2, 'teacher', $2, 'present')`, [otherSchoolId, tu.id]);
      sec.rows.push(!cross.ok
        ? Report.row('pass', 'دوام · كتابةٌ عابرةٌ للمدارس', 'مرفوضة — المدرسة تُشتقّ من الحساب')
        : Report.row('fail', 'دوام · كتابةٌ عابرةٌ للمدارس',
            '⚠ أُدرج صفٌّ في مدرسةٍ ليست مدرسةَ الكاتب'));

      // جـ) لا تسجيلَ دوامٍ بتاريخٍ مستقبليّ.
      const future = await attempt(
        `insert into public.staff_attendance (school_id, date, kind, teacher_id, status)
         values ($1, current_date + 9, 'teacher', $2, 'present')`, [f.schoolId, tu.id]);
      sec.rows.push(!future.ok
        ? Report.row('pass', 'دوام · تاريخٌ مستقبليّ', 'مرفوض')
        : Report.row('fail', 'دوام · تاريخٌ مستقبليّ', '⚠ قُبل حضورٌ لم يقع بعد'));

      // د) [الأشدّ] محوُ حكم المدير — يمرّ التحديثُ ولا يمسّ عموداً واحداً منه.
      await attempt(
        `update public.staff_attendance
            set status='present', late_minutes=0, adjusted_by=null,
                adjust_reason=null, source='self'
          where id = $1`, [rec.id]);
      // هـ) ضابطٌ موجب: الانصراف المشروع يمرّ فعلاً.
      const out = await attempt(
        `update public.staff_attendance set check_out = now() where id = $1`, [rec.id]);

      await c.query('reset role');
      const { rows: [a] } = await c.query(
        `select status, late_minutes, adjusted_by, adjust_reason, source,
                check_out is not null as checked_out
           from public.staff_attendance where id = $1`, [rec.id]);
      sec.rows.push(a.status === 'absent' && a.late_minutes === 45
                 && a.adjusted_by === ad.id && a.source === 'manager'
                 && a.adjust_reason === 'تغيّب بلا عذر'
        ? Report.row('pass', 'دوام · محوُ حكم المدير',
            'الحالةُ والتأخّرُ والمعدِّلُ والعذرُ كما تركها المدير')
        : Report.row('fail', 'دوام · محوُ حكم المدير',
            `⚠ الحكمُ تبدّل: ${a.status} · تأخّر ${a.late_minutes} · معدِّل ${a.adjusted_by ?? 'فارغ'}`));
      sec.rows.push(out.ok && a.checked_out
        ? Report.row('pass', 'ضابط موجب: تسجيل الانصراف',
            'المعلّم يكتب عمودَه — الحارس لا يعطّل البوّابة')
        : Report.row('fail', 'ضابط موجب: تسجيل الانصراف',
            out.ok ? '⚠ مرّ التحديث ولم يُكتب check_out' : out.err.slice(0, 90)));
    });

    /* ── ١٤) «إجازاتي»: الضابط الموجب أوّلاً، فالميزة كانت ميتةً وهي خضراء ──
       سياسة staff_leaves_own_read كانت تستعلم من staff_records داخل تعبير
       USING. وتعبيرُ USING يُنفَّذ بصلاحيات المستدعي، و staff_records سياستُه
       الوحيدة لمدير المدرسة — فقرأ المعلّمُ صفراً، وقُيّم EXISTS كاذباً دائماً
       ولو تطابق الاسمان حرفاً بحرف. الاختبارُ السابق فحص ar_norm ولم يفحص
       القراءةَ من حسابٍ حقيقيّ، فمرّت السياسةُ وهي معطَّلة بالكامل.

       الدرس مكتوبٌ في ترتيب الفحوص: الضابطُ الموجب أوّلاً. حارسٌ يفحص المنعَ
       وحده يبقى أخضرَ على ميزةٍ لا تعمل لأحد. */
    await inTx(c, async () => {
      const f = await seedForeign(c);
      const { rows: [s2] } = await c.query(
        `insert into public.schools (directorate_id, name, school_type)
         values ($1, '__مدرسة جارة للإجازات__', 'primary') returning id`, [f.dirId]);

      const NAME = '__صاحبة الإجازة__';
      const mk = async (email, name, school) => {
        const { rows: [a] } = await c.query(
          `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email]);
        await c.query(
          `insert into public.users (id, full_name, role, permission_role, school_id, is_active)
           values ($1, $2, 'teacher', 'teacher', $3, true)`, [a.id, name, school]);
        return a.id;
      };
      const owner  = await mk('lv-own@t.local',  NAME,              f.schoolId);
      const peer   = await mk('lv-peer@t.local', '__زميل__',        f.schoolId);
      const abroad = await mk('lv-far@t.local',  NAME,              s2.id);
      const byAsn  = await mk('lv-asn@t.local',  '__اسم مغاير__',   f.schoolId);

      const { rows: [sr] } = await c.query(
        `insert into public.staff_records (school_id, full_name, staff_type, active)
         values ($1, $2, 'teaching', true) returning id`, [f.schoolId, NAME]);
      await c.query(
        `insert into public.staff_leaves (staff_id, school_id, leave_type, leave_days, month, year)
         values ($1, $2, 'صحية', 5, 8, 2026)`, [sr.id, f.schoolId]);
      // الربط الصريح الذي تكتبه upsert_staff_assignment عند التكليف.
      await c.query(
        `insert into public.staff_assignments
           (school_id, staff_id, user_id, assignment_kind, job_title, academic_year)
         values ($1, $2, $3, 'technical', 'معلّم', '2025-2026')`, [f.schoolId, sr.id, byAsn]);

      const seen = async (uid) => {
        await become(c, uid);
        const r = await c.query(
          `select 1 from public.staff_leaves where school_id = $1`, [f.schoolId]);
        await c.query('reset role');
        return r.rowCount;
      };

      const nOwner = await seen(owner);
      sec.rows.push(nOwner === 1
        ? Report.row('pass', 'إجازاتي · ضابط موجب: صاحبتُها تقرؤها',
            'سطرٌ واحد — الميزة حيّةٌ فعلاً لا خضراءَ على فراغ')
        : Report.row('fail', 'إجازاتي · ضابط موجب: صاحبتُها تقرؤها',
            `⚠ ${nOwner} صفّاً — إجازةٌ تُسجَّل على معلّمة ولا تصلها`));

      const nAsn = await seen(byAsn);
      sec.rows.push(nAsn === 1
        ? Report.row('pass', 'إجازاتي · الربط بالتكليف',
            'اسمٌ مغايرٌ والتكليفُ يربط — لا تُشترط مطابقةُ الإملاء')
        : Report.row('fail', 'إجازاتي · الربط بالتكليف',
            `⚠ ${nAsn} صفّاً — الرابط الصريح مهمَل`));

      const nPeer = await seen(peer);
      sec.rows.push(nPeer === 0
        ? Report.row('pass', 'إجازاتي · زميلٌ في المدرسة نفسها', 'محجوبة')
        : Report.row('fail', 'إجازاتي · زميلٌ في المدرسة نفسها',
            `⚠ ${nPeer} صفّاً — معلّمٌ يقرأ إجازات زميله`));

      const nFar = await seen(abroad);
      sec.rows.push(nFar === 0
        ? Report.row('pass', 'إجازاتي · اسمٌ مطابق في مدرسةٍ أخرى',
            'محجوبة — التطابق مقيَّدٌ بالمدرسة')
        : Report.row('fail', 'إجازاتي · اسمٌ مطابق في مدرسةٍ أخرى',
            `⚠ ${nFar} صفّاً — الاسمُ وحده يفتح إجازاتِ غريب`));
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
