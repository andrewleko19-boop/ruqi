// ─────────────────────────────────────────────────────────────────────────────
//  فحص الباغَين المعروفَين على البيانات الحيّة:
//   (١) notificationclick → هل يفتح الرابط الصحيح أم 404؟
//       نُعيد بناء نفس الرابط الذي يُنتجه send-push + الـSW لكل إشعار حقيقي.
//   (٢) اشتراكات Push للمديرية/الوزارة → هل هي موجودة فعلاً لكل دور؟
// ─────────────────────────────────────────────────────────────────────────────
import { serviceClient, Report, paint } from './config.mjs';

// مطابق لِـ supabase/functions/send-push/index.ts (المصدر الوحيد للحقيقة)
const PORTAL_BY_ROLE = {
  school_admin:     'school/',
  directorate_user: 'directorate/',
  ministry_user:    'ministry/',
  teacher:          'teacher/',
};
const DEEP_LINKED = new Set(['grace_proposed']);

function reconstructPath(role, type, entityId) {
  let path = PORTAL_BY_ROLE[role] ?? (type === 'student_absent' ? 'parent/' : '');
  if (path && entityId && DEEP_LINKED.has(type)) {
    path += `?n=${encodeURIComponent(type)}&e=${encodeURIComponent(entityId)}`;
  }
  return path;
}

export async function runBugChecks(report) {
  const svc = serviceClient();

  // ══ الباغ ١: مسار الإشعار ══════════════════════════════════════════════════
  const sec1 = report.section('٢أ) الباغ المعروف #1 — notificationclick يفتح الصفحة الصحيحة؟');
  const { data: notifs, error: nErr } = await svc
    .from('notifications')
    .select('id,type,recipient_id,entity_id,created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (nErr) {
    sec1.rows.push(Report.row('warn', 'تعذّرت قراءة جدول notifications', nErr.message));
  } else if (!notifs?.length) {
    sec1.rows.push(Report.row('info', 'لا إشعارات بعد', 'أنشئ إشعاراً (بلاغ/اقتراح) ثمّ أعد الفحص'));
  } else {
    const roleIds = [...new Set(notifs.map((n) => n.recipient_id).filter(Boolean))];
    const { data: users } = await svc.from('users').select('id,role').in('id', roleIds);
    const roleOf = Object.fromEntries((users || []).map((u) => [u.id, u.role]));

    let ok = 0, root = 0, absolute = 0;
    const perType = {};
    for (const n of notifs) {
      const role = roleOf[n.recipient_id]; // غير موجود = ولي أمر (auth.users فقط)
      const path = reconstructPath(role, n.type, n.entity_id);
      perType[n.type] = perType[n.type] || { ok: 0, root: 0 };
      if (path.startsWith('/')) { absolute++; }               // ← سبب 404 الكلاسيكي
      else if (path === '') { root++; perType[n.type].root++; } // يفتح الجذر (لا 404، لكن بلا وجهة)
      else { ok++; perType[n.type].ok++; }
    }

    if (absolute > 0) {
      sec1.rows.push(Report.row('fail', 'مسارات مطلقة تسبّب 404',
        `${absolute} إشعار مساره يبدأ بـ«/» → يتجاهل نطاق /ruqi/`));
    } else {
      sec1.rows.push(Report.row('pass', 'لا مسارات مطلقة',
        'كل المسارات نسبيّة → appUrl() يحلّها تحت /ruqi/ بلا 404'));
    }
    sec1.rows.push(Report.row(ok > 0 ? 'pass' : 'info', `${ok} إشعار يفتح بوابته الصحيحة مباشرةً`,
      Object.entries(perType).filter(([, v]) => v.ok).map(([k, v]) => `${k}:${v.ok}`).join('، ')));
    if (root > 0) {
      sec1.rows.push(Report.row('warn', `${root} إشعار يفتح الجذر بلا وجهة محدّدة`,
        'دور المستلِم غير معروف في public.users (غالباً ولي أمر) — يفتح الصفحة الرئيسية، ليس 404'));
    }
  }

  // ══ الباغ ٢: تغطية اشتراكات Push حسب الدور ═════════════════════════════════
  const sec2 = report.section('٢ب) الباغ المعروف #2 — اشتراكات Push للمديرية/الوزارة');
  const { data: allUsers, error: uErr } = await svc.from('users').select('id,role');
  const { data: subs, error: sErr } = await svc.from('push_subscriptions').select('user_id');

  if (uErr || sErr) {
    sec2.rows.push(Report.row('warn', 'تعذّرت قراءة users/push_subscriptions', (uErr || sErr).message));
  } else {
    const subscribed = new Set((subs || []).map((s) => s.user_id));
    const byRole = {};
    for (const u of allUsers || []) {
      byRole[u.role] = byRole[u.role] || { total: 0, withPush: 0 };
      byRole[u.role].total++;
      if (subscribed.has(u.id)) byRole[u.role].withPush++;
    }
    for (const role of ['directorate_user', 'ministry_user', 'school_admin', 'teacher']) {
      const r = byRole[role];
      if (!r || r.total === 0) {
        sec2.rows.push(Report.row('info', `الدور ${role}`, 'لا مستخدمين بهذا الدور بعد'));
        continue;
      }
      const critical = role === 'directorate_user' || role === 'ministry_user';
      if (r.withPush === 0) {
        sec2.rows.push(Report.row(critical ? 'fail' : 'warn', `الدور ${role}: 0 من ${r.total} مشترك في Push`,
          critical ? 'مؤكَّد: لن يصل أي إشعار فوري لهذا الدور' : 'لا اشتراكات — الإشعارات الفورية معطّلة لهم'));
      } else if (r.withPush < r.total) {
        sec2.rows.push(Report.row('warn', `الدور ${role}: ${r.withPush} من ${r.total} فقط مشترك`,
          'بعض المستخدمين لن تصلهم إشعارات فورية'));
      } else {
        sec2.rows.push(Report.row('pass', `الدور ${role}: كلّهم (${r.total}) مشتركون في Push`));
      }
    }
  }
  return [sec1, sec2];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = new Report();
  await runBugChecks(report);
  report.print();
}
