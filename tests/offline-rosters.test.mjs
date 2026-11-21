// ─────────────────────────────────────────────────────────────────────────────
//  القوائم التي يحتاجها الحضورُ اليوميّ متاحةٌ دون اتصال — ولو كانت قديمة.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadDb, fakeFrom } from './helpers/db-harness.mjs';

const WEEK = 7 * 24 * 3600 * 1000;

describe('كشفُ طلاب الصفّ دون اتصال', () => {
  test('مخبأٌ عمرُه أسبوع يُعاد — لا «لا توجد بيانات محفوظة»', async () => {
    const roster = [{ id: 'st1', full_name: 'أحمد' }];
    const { DB } = await loadDb({
      online: false,
      storage: { nsams_stu_c1: JSON.stringify({ ts: Date.now() - WEEK, data: roster }) },
    });
    assert.deepEqual(await DB.getClassStudents('c1'), roster);
  });

  test('شبكةٌ ميتة (خطأ) + مخبأٌ قديم ← المخبأ', async () => {
    const roster = [{ id: 'st1', full_name: 'أحمد' }];
    const { DB, supabase } = await loadDb({
      online: true,
      storage: { nsams_stu_c1: JSON.stringify({ ts: Date.now() - WEEK, data: roster }) },
    });
    supabase.from = fakeFrom(() => ({ data: null, error: { message: 'Failed to fetch' } })).from;
    assert.deepEqual(await DB.getClassStudents('c1'), roster);
  });

  test('لا مخبأ دون اتصال ← خطأٌ صريح لا قائمةٌ فارغة', async () => {
    const { DB } = await loadDb({ online: false });
    await assert.rejects(DB.getClassStudents('c1'));
  });
});

describe('سجلُّ الكادر (قائمة الغائبين) دون اتصال', () => {
  test('جلبٌ ناجح يُخبَّأ، ثمّ يُقرأ دون اتصال', async () => {
    const rows = [{ id: 'r1', full_name: 'سناء', staff_type: 'teacher' }];
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: true });
    supabase.from = fakeFrom(() => ({ data: rows, error: null })).from;
    assert.deepEqual(await DB.getStaffRecords('s1'), rows);

    env.online = false;
    supabase.from = () => { throw new Error('لا يجوز لمس الشبكة دون اتصال'); };
    assert.deepEqual(await DB.getStaffRecords('s1'), rows);
  });

  test('المخبأ يُمحى عند الخروج (بادئة مستأجِر)', async () => {
    const { DB, ls } = await loadDb({
      layer: 'school', online: false,
      storage: { nsams_srec_s1: JSON.stringify([{ id: 'r1' }]) },
    });
    await DB.purgeTenantCaches();
    assert.equal(ls.getItem('nsams_srec_s1'), null);
  });
});
