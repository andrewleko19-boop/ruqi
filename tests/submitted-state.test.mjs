// ─────────────────────────────────────────────────────────────────────────────
//  حالةُ «أُرسل البيان» بعد إعادة فتح الصفحة دون اتصال — حالتان:
//    ١) إرسالٌ دون اتصال ← مزامنة ← إعادة فتح دون اتصال
//    ٢) إرسالٌ مباشر ناجح ← إعادة فتح دون اتصال
//  كان الأثرُ المحلّيّ الوحيد عنصرَ الطابور، والمزامنة تحذفه؛ وgetDailyAttendance
//  خادمٌ صرف — فيعود النموذجُ القابل للتحرير.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadDb, fakeFrom } from './helpers/db-harness.mjs';

const TODAY = '2026-11-22';
const YESTERDAY = '2026-11-21';
const day = (date, n = 10, school = 's1') => ({
  school_id: school, date, teachers_present: n, teachers_absent: 1,
  admins_present: 2, admins_absent: 0, workers_present: 3, workers_absent: 0,
  students_present: 200, notes: 'ملاحظة', submitted_by: 'u1',
  submitted_at: `${date}T05:10:00.000Z`,
});
const ok = () => fakeFrom();

describe('أثر البيان اليوميّ المُرسَل', () => {
  test('حالة ٢: إرسالٌ مباشر ناجح ثمّ دون اتصال ← يُعاد السجلّ لا النموذج', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: true });
    supabase.from = ok().from;
    assert.equal((await DB.saveAttendance(day(TODAY))).synced, true);

    env.online = false;
    supabase.from = () => { throw new Error('لا شبكة'); };
    const rec = await DB.getDailyAttendance('s1', TODAY);
    assert.ok(rec, 'عاد null ← يُرسَم النموذج القابل للتحرير');
    assert.equal(rec.teachers_present, 10);
    assert.equal(rec.notes, 'ملاحظة');
  });

  test('حالة ١: دون اتصال ← مزامنة ← دون اتصال: الأثر موجودٌ والطابور فارغ', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: false });
    assert.equal((await DB.saveAttendance(day(TODAY, 12))).synced, false);

    env.online = true;
    supabase.from = ok().from;
    assert.equal((await DB.syncPending()).attendance.synced, 1);
    assert.equal(await DB.getQueuedDailyAttendance('s1', TODAY), null);

    env.online = false;
    const rec = await DB.getDailyAttendance('s1', TODAY);
    assert.equal(rec?.teachers_present, 12);
  });

  test('قراءةٌ ناجحة تُعيد صفّاً ← تُكتب أثراً يُقرأ دون اتصال', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: true });
    const row = { teachers_present: 7, notes: null, submitted_at: `${TODAY}T06:00:00Z` };
    supabase.from = fakeFrom(() => ({ data: row, error: null })).from;
    assert.deepEqual(await DB.getDailyAttendance('s1', TODAY), row);
    env.online = false;
    assert.deepEqual(await DB.getDailyAttendance('s1', TODAY), row);
  });

  test('الخادم يحكم: قراءةٌ ناجحة تُرجع «لا بيان» تمحو الأثر (صفٌّ حُذف بـSQL)', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: true });
    supabase.from = ok().from;
    await DB.saveAttendance(day(TODAY));

    supabase.from = fakeFrom(() => ({ data: null, error: null })).from;     // الخادم: لا شيء
    assert.equal(await DB.getDailyAttendance('s1', TODAY), null);

    env.online = false;
    assert.equal(await DB.getDailyAttendance('s1', TODAY), null, 'بقي «مُرسَلاً» على الجهاز بعد حذفه من القاعدة');
  });

  test('فشلٌ شبكيّ والاتصال «قائم»: يُجاب من الأثر لا من نموذجٍ فارغ', async () => {
    const { DB, supabase } = await loadDb({ layer: 'school', online: true });
    supabase.from = ok().from;
    await DB.saveAttendance(day(TODAY, 9));
    supabase.from = fakeFrom(() => ({ data: null, error: { message: 'TypeError: Failed to fetch' } })).from;
    assert.equal((await DB.getDailyAttendance('s1', TODAY))?.teachers_present, 9);
  });

  test('خطأٌ غير شبكيّ (RLS) لا يُموَّه بالأثر', async () => {
    const { DB, supabase } = await loadDb({ layer: 'school', online: true });
    supabase.from = ok().from;
    await DB.saveAttendance(day(TODAY));
    supabase.from = fakeFrom(() => ({ data: null, error: { code: '42501', message: 'row-level security' } })).from;
    await assert.rejects(DB.getDailyAttendance('s1', TODAY));
  });

  test('أثرٌ بتاريخٍ آخر يُتجاهل', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: true });
    supabase.from = ok().from;
    await DB.saveAttendance(day(YESTERDAY));
    env.online = false;
    assert.equal(await DB.getDailyAttendance('s1', TODAY), null);
    assert.equal((await DB.getDailyAttendance('s1', YESTERDAY))?.teachers_present, 10);
  });

  test('مزامنةُ سجلٍّ أقدم متأخّرة لا تكتب فوق أثر اليوم', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: false });
    await DB.saveAttendance(day(YESTERDAY, 5));              // عالقٌ في الطابور
    env.online = true;
    supabase.from = ok().from;
    await DB.saveAttendance(day(TODAY, 11));                  // اليوم: ناجح مباشرةً
    await DB.syncPending({ force: true });                    // الأقدم يصل الآن
    env.online = false;
    assert.equal((await DB.getDailyAttendance('s1', TODAY))?.teachers_present, 11,
      'الأقدم كتب فوق أثر اليوم فعاد النموذج');
  });

  test('الأثر لكلّ مدرسة، ويُمحى عند الخروج', async () => {
    const { DB, supabase, env, ls } = await loadDb({ layer: 'school', online: true });
    supabase.from = ok().from;
    await DB.saveAttendance(day(TODAY, 10, 's1'));
    env.online = false;
    assert.equal(await DB.getDailyAttendance('s2', TODAY), null);
    assert.ok(ls.getItem('nsams_dsub_s1'));
    await DB.purgeTenantCaches();
    assert.equal(ls.getItem('nsams_dsub_s1'), null);
    assert.equal(await DB.getDailyAttendance('s1', TODAY), null);
  });

  test('دون اتصال بلا أثر ← null (النموذج) لا رمي', async () => {
    const { DB } = await loadDb({ layer: 'school', online: false });
    assert.equal(await DB.getDailyAttendance('s1', TODAY), null);
  });
});
