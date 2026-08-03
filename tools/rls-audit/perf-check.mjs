// ─────────────────────────────────────────────────────────────────────────────
//  فحص الأداء (يتطلّب DATABASE_URL). ثلاث زوايا:
//   (١) أبطأ الاستعلامات فعلياً من pg_stat_statements (إن كان الامتداد مفعّلاً).
//   (٢) الجداول التي تُمسح تسلسلياً (seq scan) في الإنتاج — كشف من الإحصاءات الحيّة.
//   (٣) فهارس ناقصة على أعمدة العزل/المفاتيح الحسّاسة + EXPLAIN ANALYZE لاستعلام
//       COUNT(*) تجميعي واقعي (أثقل مسار: تجميع حضور مدرسة على مدى فترة).
// ─────────────────────────────────────────────────────────────────────────────
import pg from 'pg';
import { Report, paint, requireEnv } from './config.mjs';

// أعمدة يجب أن تكون مفهرسة على الجداول الساخنة (جدول → أعمدة العزل/الترشيح)
const EXPECTED_INDEXES = [
  ['daily_student_attendance', ['school_id', 'date', 'student_id', 'class_id']],
  ['students',                 ['school_id', 'class_id']],
  ['attendance_submissions',   ['school_id', 'date', 'class_id']],
  ['staff_attendance',         ['school_id', 'date']],
  ['notifications',            ['recipient_id']],
  ['push_subscriptions',       ['user_id']],
];

async function tableExists(client, name) {
  const { rows } = await client.query(
    `select to_regclass($1) is not null as ok`, [`public.${name}`]);
  return rows[0]?.ok === true;
}

export async function runPerfChecks(report) {
  if (!process.env.DATABASE_URL) {
    const sec = report.section('٣) الأداء');
    sec.rows.push(Report.row('info', 'تخطّي فحص الأداء', 'DATABASE_URL غير مضبوط في .env — هذا القسم اختياري'));
    return [sec];
  }
  requireEnv(['DATABASE_URL']);
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 30000,
  });
  await client.connect();

  try {
    // ── (١) pg_stat_statements ────────────────────────────────────────────────
    const sec1 = report.section('٣أ) أبطأ الاستعلامات (pg_stat_statements)');
    try {
      const { rows } = await client.query(`
        select calls,
               round(mean_exec_time::numeric, 1)  as mean_ms,
               round(total_exec_time::numeric, 0) as total_ms,
               left(regexp_replace(query, '\\s+', ' ', 'g'), 120) as q
        from pg_stat_statements
        where query not ilike '%pg_stat_statements%'
        order by mean_exec_time desc
        limit 8`);
      if (!rows.length) {
        sec1.rows.push(Report.row('info', 'لا بيانات بعد', 'الامتداد مفعّل لكن لا إحصاءات مُجمّعة'));
      } else {
        for (const r of rows) {
          const status = r.mean_ms > 200 ? 'warn' : 'info';
          sec1.rows.push(Report.row(status, `${r.mean_ms}ms وسطياً · ${r.calls} استدعاء`, r.q));
        }
      }
    } catch {
      sec1.rows.push(Report.row('info', 'pg_stat_statements غير مفعّل',
        'فعّله من Dashboard → Database → Extensions لرؤية أبطأ الاستعلامات الحقيقية'));
    }

    // ── (٢) المسح التسلسلي في الإنتاج ─────────────────────────────────────────
    const sec2 = report.section('٣ب) جداول تُمسح تسلسلياً (seq scan) في الإنتاج');
    const { rows: scans } = await client.query(`
      select relname,
             seq_scan, idx_scan,
             n_live_tup as rows
      from pg_stat_user_tables
      where seq_scan > 0
      order by seq_scan desc
      limit 10`);
    if (!scans.length) {
      sec2.rows.push(Report.row('info', 'لا إحصاءات مسح بعد', 'القاعدة جديدة أو أُعيد ضبط الإحصاءات'));
    } else {
      for (const r of scans) {
        const idx = Number(r.idx_scan || 0), seq = Number(r.seq_scan || 0);
        const ratioBad = seq > idx && Number(r.rows) > 500;
        sec2.rows.push(Report.row(ratioBad ? 'warn' : 'info',
          `${r.relname}: ${seq} مسح تسلسلي مقابل ${idx} فهرسي (${r.rows} صف)`,
          ratioBad ? 'يُرجَّح فهرس ناقص على عمود ترشيح ساخن' : ''));
      }
    }

    // ── (٣) فهارس ناقصة على أعمدة حسّاسة ──────────────────────────────────────
    const sec3 = report.section('٣ج) فهارس ناقصة على أعمدة العزل/المفاتيح');
    for (const [table, cols] of EXPECTED_INDEXES) {
      if (!(await tableExists(client, table))) continue;
      const { rows: idxRows } = await client.query(
        `select indexdef from pg_indexes where schemaname='public' and tablename=$1`, [table]);
      const defs = idxRows.map((r) => r.indexdef.toLowerCase());
      for (const col of cols) {
        const covered = defs.some((d) => d.includes(`(${col}`) || d.includes(`, ${col}`) || d.includes(` ${col})`));
        sec3.rows.push(covered
          ? Report.row('pass', `${table}.${col} مفهرس`)
          : Report.row('warn', `${table}.${col} بلا فهرس`, 'ترشيح على هذا العمود سيُجبر مسحاً تسلسلياً عند الحجم'));
      }
    }

    // ── EXPLAIN ANALYZE لاستعلام COUNT تجميعي واقعي ──────────────────────────
    const sec4 = report.section('٣د) EXPLAIN ANALYZE — أثقل مسار تجميعي (حضور مدرسة على فترة)');
    if (await tableExists(client, 'daily_student_attendance')) {
      const { rows: pick } = await client.query(
        `select school_id from public.daily_student_attendance
         where school_id is not null limit 1`);
      if (!pick.length) {
        sec4.rows.push(Report.row('info', 'لا بيانات حضور بعد', 'لا يمكن قياس مسار التجميع على قاعدة فارغة'));
      } else {
        const schoolId = pick[0].school_id;
        // السطر الواحد الذي طلبتَه صراحةً — تجميع بلا فهرس مركّب على (school_id,date):
        const sql = `SELECT COUNT(*) FROM public.daily_student_attendance
                     WHERE school_id = $1 AND date >= current_date - interval '30 days'`;
        const { rows: plan } = await client.query(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, [schoolId]);
        const p = plan[0]['QUERY PLAN'][0];
        const execMs = p['Execution Time'];
        const planStr = JSON.stringify(p.Plan);
        const seqScan = planStr.includes('"Node Type":"Seq Scan"') || planStr.includes('"Seq Scan"');
        sec4.rows.push(Report.row(execMs > 100 || seqScan ? 'warn' : 'pass',
          `زمن التنفيذ ${execMs.toFixed(1)}ms ${seqScan ? '(Seq Scan!)' : '(فهرسي)'}`,
          'الاستعلام: COUNT(*) daily_student_attendance WHERE school_id=? AND date≥اليوم-30'));
        sec4.rows.push(Report.row('info', 'السطر القابل للتشغيل يدوياً',
          `SELECT COUNT(*) FROM daily_student_attendance WHERE school_id='${schoolId}' AND date >= current_date - interval '30 days';`));
      }
    }
    return [sec1, sec2, sec3, sec4];
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = new Report();
  await runPerfChecks(report);
  report.print();
}
