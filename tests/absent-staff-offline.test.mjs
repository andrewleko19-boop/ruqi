// ─────────────────────────────────────────────────────────────────────────────
//  أسماءُ الغائبين من الكادر لا تضيع حين يُرسَل البيان دون اتصال.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadDb, fakeFrom } from './helpers/db-harness.mjs';

const DATE = '2026-11-21';
const UID  = 'u-admin';
const who  = { 'nsams_lastuser_school': JSON.stringify({ id: UID, email: 'a@x' }) };
const sana = [{ staffId: 'sr1', name: 'سناء', kind: 'teaching' }];
const omar = [{ staffId: 'sr2', name: 'عمر',  kind: 'worker' }];

describe('غائبو الكادر دون اتصال', () => {
  test('الحفظ دون اتصال لا يلمس الشبكة، ويُقرأ بعد إعادة التحميل', async () => {
    const { DB, supabase } = await loadDb({ layer: 'school', online: false, storage: who });
    supabase.from = () => { throw new Error('لا شبكة'); };
    supabase.auth.getUser = () => { throw new Error('auth.getUser شبكيّ — لا يجوز هنا'); };

    const r = await DB.saveDailyAbsentStaff('s1', DATE, sana);
    assert.equal(r.synced, false);
    assert.deepEqual(await DB.getDailyAbsentStaff('s1', DATE), sana);
  });

  test('حفظٌ ثانٍ يستبدل الأوّل في الطابور، والمزامنة تُرسل الأحدث مرّةً واحدة', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: false, storage: who });
    await DB.saveDailyAbsentStaff('s1', DATE, sana);
    await DB.saveDailyAbsentStaff('s1', DATE, omar);

    const srv = fakeFrom();
    supabase.from = srv.from;
    env.online = true;
    const res = await DB.syncPending();
    assert.equal(res.absentStaff.synced, 1);
    assert.equal(res.absentStaff.failed, 0);

    const inserts = srv.calls.filter(c => c.table === 'daily_absent_staff' && c.op === 'insert');
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0].values.map(r => r.staff_name), ['عمر']);
    assert.equal(inserts[0].values[0].created_by, UID);

    const again = await DB.syncPending();
    assert.equal(again.absentStaff.synced, 0, 'أُعيد الإرسال — العنصر لم يغادر الطابور');
  });

  test('فشلُ الإدراج بعد الحذف يُبقي العنصر في الطابور فيُصحَّح لاحقاً', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: false, storage: who });
    await DB.saveDailyAbsentStaff('s1', DATE, sana);
    env.online = true;

    supabase.from = fakeFrom(c => (c.op === 'insert'
      ? { data: null, error: { message: 'Failed to fetch' } } : { data: null, error: null })).from;
    assert.equal((await DB.syncPending()).absentStaff.failed, 1);

    const srv = fakeFrom();
    supabase.from = srv.from;
    assert.equal((await DB.syncPending()).absentStaff.synced, 1);
    assert.ok(srv.calls.some(c => c.op === 'insert'));
  });

  test('الحفظ المباشر الناجح يحذف نسخةً أقدم عالقة — لا تُعاد فوقه', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: false, storage: who });
    await DB.saveDailyAbsentStaff('s1', DATE, sana);           // عالق
    env.online = true;
    supabase.from = fakeFrom().from;
    assert.equal((await DB.saveDailyAbsentStaff('s1', DATE, omar)).synced, true);

    const srv = fakeFrom();
    supabase.from = srv.from;
    await DB.syncPending();
    assert.equal(srv.calls.filter(c => c.table === 'daily_absent_staff').length, 0);
  });

  test('بلا IndexedDB: الطابور الاحتياطيّ في localStorage يُزامَن ولا يسقط في طابور الطلاب', async () => {
    const { DB, supabase, env, ls } = await loadDb({ layer: 'school', online: false, storage: who, idb: false });
    await DB.saveDailyAbsentStaff('s1', DATE, sana);
    assert.equal(ls.getItem('nsams_pending_students'), null);

    const srv = fakeFrom();
    supabase.from = srv.from;
    env.online = true;
    const res = await DB.syncPending();
    assert.equal(res.absentStaff.synced, 1);
    assert.equal((await DB.syncPending()).absentStaff.synced, 0);
  });
});
