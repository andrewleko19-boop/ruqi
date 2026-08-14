// ─────────────────────────────────────────────────────────────────────────────
//  المُنسِّق: يشغّل الفحوصات الثلاثة، يطبع تقريراً موحّداً، ويكتب REPORT.md +
//  report.json. يضمن تنظيف بيانات الاختبار حتى لو فشل أي فحص في المنتصف.
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from 'node:fs';
import { Report, paint, nowIso } from './config.mjs';
import { createFixtures, teardown } from './seed.mjs';
import { runRlsTests } from './rls-test.mjs';
import { runSqlRlsTests } from './rls-sql-test.mjs';
import { runRpcScopeTests } from './rpc-scope-test.mjs';
import { runBugChecks } from './bug-check.mjs';
import { runPerfChecks } from './perf-check.mjs';

function toMarkdown(report, counts) {
  const icon = { pass: '✅', fail: '🔴', warn: '⚠️', info: 'ℹ️' };
  let md = `# تقرير تدقيق رقي (RLS + الباغات + الأداء)\n\n`;
  md += `**التاريخ:** ${nowIso()}  \n`;
  md += `**الحصيلة:** ✅ ${counts.pass} ناجح · 🔴 ${counts.fail} فشل · ⚠️ ${counts.warn} تحذير\n\n`;
  if (counts.fail > 0) {
    md += `> 🔴 **يوجد ${counts.fail} فشل — راجع البنود المعلّمة أدناه قبل أي توسّع.**\n\n`;
  } else {
    md += `> ✅ **لا تسريبات مؤكَّدة في الجداول المُختبَرة.**\n\n`;
  }
  for (const s of report.sections) {
    md += `## ${s.title}\n\n`;
    for (const r of s.rows) {
      md += `- ${icon[r.status]} **${r.label}**${r.detail ? ` — ${r.detail}` : ''}\n`;
    }
    md += `\n`;
  }
  md += `---\n_وُلِّد آلياً عبر \`tools/rls-audit\`._\n`;
  return md;
}

const report = new Report();
let fx;
console.log(paint.bold('\n🔍 تدقيق رقي المباشر — RLS + الباغات + الأداء\n'));

try {
  // ١) RLS — الطريقة الأساسية (بذر مستخدمين حقيقيين + مسار PostgREST)
  let rlsRan = false;
  try {
    fx = await createFixtures();
    await runRlsTests(report, fx);
    rlsRan = true;
  } catch (e) {
    report.section('١) عزل المستأجر (RLS)').rows.push(
      Report.row('warn', 'تعذّرت طريقة البذر — سنجرّب الطريقة البديلة (SQL)', e.message));
  } finally {
    if (fx) await teardown().catch((e) => console.error(paint.warn('تنظيف جزئي: ' + e.message)));
  }

  // ١ب) طريقة SQL البديلة — تعمل بلا بذر إن توفّر DATABASE_URL (وتفيد كتحقّق ثانٍ
  //     أو كبديل كامل حين يفشل إنشاء المستخدمين).
  if (process.env.DATABASE_URL && (!rlsRan || process.env.AUDIT_RUN_SQL_RLS)) {
    try { await runSqlRlsTests(report); }
    catch (e) { report.section('١ب) عزل RLS — طريقة SQL').rows.push(Report.row('warn', 'تعذّرت طريقة SQL', e.message)); }
  }

  // ١ج) نطاق دوال SECURITY DEFINER — لا يغطّيها ١ب لأنها تتجاوز RLS بالتصميم.
  if (process.env.DATABASE_URL) {
    try { await runRpcScopeTests(report); }
    catch (e) { report.section('١ج) نطاق الدوال').rows.push(Report.row('warn', 'تعذّر فحص نطاق الدوال', e.message)); }
  }

  // ٢) الباغات (على البيانات الحيّة، بلا بذر)
  try { await runBugChecks(report); }
  catch (e) { report.section('٢) الباغات').rows.push(Report.row('warn', 'تعذّر فحص الباغات', e.message)); }

  // ٣) الأداء (اختياري — يحتاج DATABASE_URL)
  try { await runPerfChecks(report); }
  catch (e) { report.section('٣) الأداء').rows.push(Report.row('warn', 'تعذّر فحص الأداء', e.message)); }
} finally {
  report.print();
  const counts = report.counts();
  console.log(`\n${paint.bold('═══ الحصيلة النهائية ═══')}`);
  console.log(`  ${paint.pass(counts.pass + ' ✓ ناجح')}   ${paint.fail(counts.fail + ' ✗ فشل')}   ${paint.warn(counts.warn + ' ⚠ تحذير')}`);

  writeFileSync(new URL('./REPORT.md', import.meta.url), toMarkdown(report, counts));
  writeFileSync(new URL('./report.json', import.meta.url),
    JSON.stringify({ at: nowIso(), counts, sections: report.sections }, null, 2));
  console.log(paint.dim('\n  📄 REPORT.md و report.json كُتبا في tools/rls-audit/'));
  process.exit(counts.fail > 0 ? 1 : 0);
}
