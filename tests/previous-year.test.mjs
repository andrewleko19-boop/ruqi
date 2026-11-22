// ─────────────────────────────────────────────────────────────────────────────
//  إسنادات العام السابق: ثلاث شاشات تقرأ السؤال نفسه، والنقصُ يُرى لا يُخفى.
//
//  «إدارة الصفوف» وتبويبُ المعلّم تقرآن class_teacher للعام الحاليّ وحده؛
//  والرئيسية كانت تقرؤه بلا قيدٍ عام فتعرض معلّماً من عامٍ سابق. هنا نتحقّق أنّ
//  الرئيسية تُقيَّد بالعام نفسه، وأنّ اختيار الاسم ثابت، وأنّ ما يُسقطه العامُ
//  يظهر في إشعارٍ بدل أن يختفي.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadDb, fakeFrom } from './helpers/db-harness.mjs';

const TODAY = '2026-11-22';
const classRow = (id, ct = []) => ({ id, grade: 1, section: id, academic_year: '2026-2027', class_teacher: ct });
const ct = (role, name, id = name) => ({ role, teacher_id: id, users: { full_name: name } });

// خادمٌ مُزيَّف للمُلخّص: صفوف + كشوف + طلاب + مستخدمون
function summaryServer({ classes, subs = [], users = [] }) {
  return fakeFrom((c) => {
    if (c.table === 'classes')                     return { data: classes, error: null };
    if (c.table === 'attendance_submissions')      return { data: subs, error: null };
    if (c.table === 'daily_student_attendance')    return { data: [], error: null };
    if (c.table === 'students')                    return { data: [], error: null };
    if (c.table === 'users')                       return { data: users, error: null };
    return { data: null, error: null };
  });
}

describe('مُلخّص الرئيسية (getSchoolDailySummary)', () => {
  test('تضمينُ class_teacher مقيَّدٌ بالعام الحاليّ — كما شاشتا الإسناد', async () => {
    const { DB, supabase } = await loadDb({ layer: 'school', online: true });
    const srv = summaryServer({ classes: [classRow('a')] });
    supabase.from = srv.from;
    await DB.getSchoolDailySummary('s1', TODAY);
    const q = srv.calls.find(c => c.table === 'classes');
    assert.ok(q.filters.some(f => f[0] === 'eq' && f[1] === 'class_teacher.academic_year' && f[2] === DB.getAcademicYear()),
      'لا قيدَ عامٍ على التضمين — تظهر أسماءُ أعوامٍ سابقة');
  });

  test('اختيارٌ ثابت: معلّم الصفّ قبل الموجّه، ثمّ بالاسم', async () => {
    const { DB, supabase } = await loadDb({ layer: 'school', online: true });
    supabase.from = summaryServer({ classes: [
      classRow('a', [ct('supervisor', 'أمل'), ct('homeroom', 'زياد'), ct('homeroom', 'باسل')]),
      classRow('b', [ct('subject', 'مدرّس مادة')]),
    ] }).from;
    const r = await DB.getSchoolDailySummary('s1', TODAY);
    assert.equal(r.find(x => x.classId === 'a').teacherName, 'باسل');
    assert.equal(r.find(x => x.classId === 'b').teacherName, '—', 'مدرّس المادة ليس مصدر حضور');
  });

  test('كشفٌ وصل لصفٍّ بلا إسنادٍ حاليّ: يُسمّى صاحبُه ويُعلَّم «غير مُسنَد»', async () => {
    const { DB, supabase } = await loadDb({ layer: 'school', online: true });
    const srv = summaryServer({
      classes: [classRow('a', [])],
      subs: [{ id: 'sub1', class_id: 'a', status: 'pending', submitted_by: 'u9', submitted_at: TODAY }],
      users: [{ id: 'u9', full_name: 'رنا يحيى' }],
    });
    supabase.from = srv.from;
    const [row] = await DB.getSchoolDailySummary('s1', TODAY);
    assert.equal(row.teacherName, 'رنا يحيى');
    assert.equal(row.teacherUnassigned, true);
  });

  test('صفٌّ بإسنادٍ حاليّ لا يُعلَّم، ولا يُسأل عن مستخدمين', async () => {
    const { DB, supabase } = await loadDb({ layer: 'school', online: true });
    const srv = summaryServer({
      classes: [classRow('a', [ct('homeroom', 'منى')])],
      subs: [{ id: 'sub1', class_id: 'a', status: 'pending', submitted_by: 'u9', submitted_at: TODAY }],
    });
    supabase.from = srv.from;
    const [row] = await DB.getSchoolDailySummary('s1', TODAY);
    assert.equal(row.teacherName, 'منى');
    assert.ok(!row.teacherUnassigned);
    assert.equal(srv.calls.filter(c => c.table === 'users').length, 0);
  });
});

describe('getPreviousYearAssignments', () => {
  const row = (id, cls, teacher, year, role = 'homeroom') => ({
    id, class_id: cls, teacher_id: teacher, role, academic_year: year,
    classes: { school_id: 's1', grade: 1, section: cls }, teacher: { full_name: `م-${teacher}` },
  });

  test('يُرجع ما لا مقابلَ له في العام الحاليّ فقط، لزوجٍ صفّ+معلّم', async () => {
    const { DB, supabase } = await loadDb({ layer: 'school', online: true });
    const cur = DB.getAcademicYear();
    supabase.from = fakeFrom(() => ({ data: [
      row('1', 'c1', 'rana', cur),            // حاليّ
      row('2', 'c1', 'rana', '2025-2026'),    // نفس الزوج في عامٍ سابق ← مجدَّد، لا يُعدّ
      row('3', 'c2', 'omar', '2025-2026'),    // لم يُجدَّد
      row('4', 'c3', 'lina', '2025-2026', 'supervisor'),
    ], error: null })).from;
    const r = await DB.getPreviousYearAssignments('s1');
    assert.equal(r.year, cur);
    assert.deepEqual(r.items.map(i => i.assignmentId).sort(), ['3', '4']);
    assert.equal(r.items[0].academicYear, '2025-2026');
  });

  test('يقرأ بنطاق المدرسة، ودون اتصال أو عند الخطأ يُرجع قائمةً فارغة لا رمياً', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: true });
    const srv = fakeFrom(() => ({ data: [], error: null }));
    supabase.from = srv.from;
    await DB.getPreviousYearAssignments('s1');
    assert.ok(srv.calls[0].filters.some(f => f[1] === 'classes.school_id' && f[2] === 's1'));

    supabase.from = fakeFrom(() => ({ data: null, error: { message: 'boom' } })).from;
    const bad = await DB.getPreviousYearAssignments('s1');
    assert.deepEqual(bad.items, []);
    assert.equal(bad.failed, true);

    env.online = false;
    supabase.from = () => { throw new Error('لا شبكة'); };
    assert.deepEqual((await DB.getPreviousYearAssignments('s1')).items, []);
  });
});

describe('countMyPreviousYearAssignments (تلميح المعلّم)', () => {
  test('يعدّ إسنادات المعلّم من أعوامٍ أخرى فقط', async () => {
    const { DB, supabase } = await loadDb({ online: true });
    const srv = fakeFrom(() => ({ count: 3, data: null, error: null }));
    supabase.from = srv.from;
    assert.equal(await DB.countMyPreviousYearAssignments('T1'), 3);
    const f = srv.calls[0].filters;
    assert.ok(f.some(x => x[0] === 'eq'  && x[1] === 'teacher_id' && x[2] === 'T1'));
    assert.ok(f.some(x => x[0] === 'neq' && x[1] === 'academic_year' && x[2] === DB.getAcademicYear()));
  });

  test('دون اتصال أو خطأ ← صفر (التلميحُ إضافة لا شرط)', async () => {
    const { DB, supabase, env } = await loadDb({ online: true });
    supabase.from = fakeFrom(() => ({ data: null, error: { message: 'x' } })).from;
    assert.equal(await DB.countMyPreviousYearAssignments('T1'), 0);
    env.online = false;
    assert.equal(await DB.countMyPreviousYearAssignments('T1'), 0);
  });
});
