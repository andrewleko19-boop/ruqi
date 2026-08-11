// ─────────────────────────────────────────────────────────────────────────────
//  اختبار RLS بديل — بلا ALTER ROLE وبلا إنشاء مستخدمين، وآمن على الإنتاج.
//
//  لماذا هذا موجود: الطريقة الشائعة على الإنترنت تستعمل «ALTER ROLE …» أو ضبط
//  إعدادات على مستوى الدور، وهذا يتطلّب superuser فيرفعه Supabase بـ permission
//  denied. الحل: داخل معاملة واحدة نستعمل «SET LOCAL ROLE authenticated» (ليس
//  ALTER — الدور postgres عضو في authenticated فيُسمح به) + نضبط request.jwt.claims
//  محلياً، فتُطبَّق RLS كأننا ذلك المستخدم. كل شيء ضمن المعاملة ويُلغى بـ ROLLBACK،
//  فلا نكتب حرفاً واحداً على قاعدة الإنتاج.
//
//  يختار مستخدمَين حقيقيَّين من مدرستين مختلفتين ويتحقّق أن الأول لا يرى/يحذف صفوف
//  الثاني. لا يحتاج بذراً — يعمل على بياناتك القائمة كما هي.
// ─────────────────────────────────────────────────────────────────────────────
import pg from 'pg';
import { Report, paint, requireEnv } from './config.mjs';

const SENSITIVE = [
  'students', 'daily_student_attendance', 'classes',
  'attendance_submissions', 'staff_attendance', 'school_personnel',
  'transfer_documents', 'monthly_statements',
];

async function hasSchoolIdCol(c, t) {
  const { rows } = await c.query(
    `select 1 from information_schema.columns
     where table_schema='public' and table_name=$1 and column_name='school_id'`, [t]);
  return rows.length > 0;
}

// عدّ حقيقي متجاوز RLS (الاتصال بدور postgres ذي BYPASSRLS)
async function trueCount(c, table, schoolId) {
  const { rows } = await c.query(
    `select count(*)::int n from public.${table} where school_id=$1`, [schoolId]);
  return rows[0].n;
}

// ينفّذ استعلاماً بهويّة مستخدم عبر SET LOCAL ROLE + claims، ثمّ يُلغي كل شيء.
async function asUser(c, userId, sql, params = []) {
  await c.query('begin');
  try {
    await c.query(`set local role authenticated`);
    await c.query(`select set_config('request.jwt.claims',
      json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [userId]);
    const res = await c.query(sql, params);
    return res;
  } finally {
    await c.query('rollback'); // لا نكتب شيئاً على الإنتاج مهما حصل
  }
}

export async function runSqlRlsTests(report) {
  requireEnv(['DATABASE_URL']);
  // Supabase-hosted Postgres يفرض SSL، والـpg يطلبه بدون شهادة. أمّا
  // supabase start محلياً فيُشغّل Postgres عادياً بلا SSL، فيُفشل
  // الاتصال بـ«The server does not support SSL». نُعطّله للمضيف المحلي.
  const url = process.env.DATABASE_URL;
  const isLocal = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  const c = new pg.Client({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    statement_timeout: 20000,
  });
  await c.connect();
  const sec = report.section('١ب) عزل RLS — طريقة SQL بديلة (بلا ALTER ROLE، آمنة/مُلغاة)');

  try {
    // تحقّق أن SET LOCAL ROLE authenticated مسموح على هذا الاتصال
    try {
      await c.query('begin'); await c.query('set local role authenticated'); await c.query('rollback');
    } catch (e) {
      await c.query('rollback').catch(() => {});
      sec.rows.push(Report.row('warn', 'الاتصال لا يسمح بـ SET ROLE authenticated', e.message + ' — استعمل مستخدم postgres مباشرةً عبر Session pooler'));
      return sec;
    }

    // اختر مستخدمَين من مدرستين مختلفتين
    const { rows: users } = await c.query(`
      select distinct on (school_id) id, school_id, full_name
      from public.users
      where role='school_admin' and school_id is not null
      order by school_id, created_at
      limit 2`);
    if (users.length < 2) {
      sec.rows.push(Report.row('info', 'لا يكفي مديرو مدارس من مدرستين مختلفتين',
        'أنشئ حساب مدير في مدرستين على الأقل، أو استعمل seed في rls-test.mjs'));
      return sec;
    }
    const [A, B] = users;
    sec.rows.push(Report.row('info', 'المستخدمان المختبَران',
      `A=${(A.full_name || A.id).slice(0, 20)} (school ${A.school_id.slice(0, 8)}) ضدّ B (school ${B.school_id.slice(0, 8)})`));

    // ضابط موجب: A يرى طلاب مدرسته
    const own = await asUser(c, A.id, `select count(*)::int n from public.students where school_id=$1`, [A.school_id]);
    sec.rows.push(own.rows[0].n > 0
      ? Report.row('pass', 'ضابط موجب: A يقرأ طلاب مدرسته', `${own.rows[0].n} صف مرئي`)
      : Report.row('warn', 'ضابط موجب فشل: A لا يرى حتى طلاب مدرسته', 'قد تكون claims/الدالة مختلفة — النتائج أدناه قد تكون مضلِّلة'));

    for (const table of SENSITIVE) {
      if (!(await hasSchoolIdCol(c, table))) continue;
      const baseline = await trueCount(c, table, B.school_id);
      if (baseline === 0) {
        sec.rows.push(Report.row('info', `${table}`, 'لا صفوف لمدرسة B — لا يمكن الحكم (زد بيانات أو استعمل seed)'));
        continue;
      }
      // (أ) قراءة صفوف B بهوية A
      const seen = await asUser(c, A.id, `select count(*)::int n from public.${table} where school_id=$1`, [B.school_id]);
      if (seen.rows[0].n > 0) {
        sec.rows.push(Report.row('fail', `${table} · SELECT بيانات B بهوية A`,
          `⚠ تسريب قراءة: A يرى ${seen.rows[0].n} من ${baseline} صف يخصّ B`));
      } else {
        sec.rows.push(Report.row('pass', `${table} · SELECT بيانات B`, `محجوب (0 من ${baseline}) — العزل سليم`));
      }
      // (ب) حذف صفوف B بهوية A (يُلغى بـ ROLLBACK — لا يكتب فعلياً)
      try {
        const del = await asUser(c, A.id,
          `with d as (delete from public.${table} where school_id=$1 returning 1) select count(*)::int n from d`, [B.school_id]);
        if (del.rows[0].n > 0) {
          sec.rows.push(Report.row('fail', `${table} · DELETE بيانات B بهوية A`,
            `⚠ تسريب كتابة: RLS سمح بحذف ${del.rows[0].n} صف يخصّ B (أُلغي)`));
        } else {
          sec.rows.push(Report.row('pass', `${table} · DELETE بيانات B`, 'محجوب — العزل سليم'));
        }
      } catch (e) {
        sec.rows.push(Report.row('pass', `${table} · DELETE بيانات B`, `مرفوض (${(e.message || '').slice(0, 40)})`));
      }
    }
    return sec;
  } finally {
    await c.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = new Report();
  await runSqlRlsTests(report);
  report.print();
  const cts = report.counts();
  console.log(`\n${paint.bold('الحصيلة:')} ${paint.pass(cts.pass + ' ✓')}  ${paint.fail(cts.fail + ' ✗')}  ${paint.warn(cts.warn + ' ⚠')}`);
  process.exit(cts.fail > 0 ? 1 : 0);
}
