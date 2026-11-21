// ─────────────────────────────────────────────────────────────────────────────
//  الفشلُ لا يُنسى ولا يُكرَّر بلا نهاية: عابرٌ يُعاد بتأجيل، ودائمٌ يبقى ظاهراً.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadDb, fakeFrom } from './helpers/db-harness.mjs';

const sheet = { records: [{ studentId: 'st1', status: 'absent' }], classId: 'c1', schoolId: 's1',
                date: '2026-11-21', teacherId: 'u1' };

async function queuedSheet() {
  const h = await loadDb({ online: false });
  await h.DB.saveStudentAttendance(sheet);
  h.env.online = true;
  return h;
}
const outbox = async (DB) => (await DB.getOutboxSummary({ ownerId: 'u1' })).total;

describe('فشلٌ عابر (شبكة)', () => {
  test('يبقى، ويُؤجَّل، ولا يُعاد قبل موعده — والزرّ اليدويّ يتجاوز التأجيل', async () => {
    const { DB, supabase } = await queuedSheet();
    let srv = fakeFrom(() => ({ data: null, error: { message: 'TypeError: Failed to fetch' } }));
    supabase.from = srv.from;

    const r1 = await DB.syncPending();
    assert.equal(r1.retrying, 1);
    assert.equal(r1.stuck, 0);
    assert.equal(await outbox(DB), 1);

    srv = fakeFrom();
    supabase.from = srv.from;
    const r2 = await DB.syncPending();
    assert.equal(r2.deferred, 1, 'أُعيد قبل موعده — طرقٌ متواصل على شبكةٍ عائدة');
    assert.equal(srv.calls.length, 0);

    const r3 = await DB.syncPending({ force: true });
    assert.equal(r3.studentAtt.synced, 1);
    assert.equal(await outbox(DB), 0);
  });

  test('خطأٌ بلا رمزٍ معروف يُعدّ عابراً — إعادةٌ زائدة أرخصُ من بيانٍ معلَّق', async () => {
    const { DB, supabase } = await queuedSheet();
    supabase.from = fakeFrom(() => ({ data: null, error: { message: 'Bad Gateway' } })).from;
    assert.equal((await DB.syncPending()).retrying, 1);
  });
});

describe('فشلٌ دائم (رفض الخادم)', () => {
  test('RLS 42501 ← يبقى مُعلَّماً، لا يُعاد تلقائياً، والزرّ يُعيده', async () => {
    const { DB, supabase } = await queuedSheet();
    supabase.from = fakeFrom(() => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })).from;

    const r1 = await DB.syncPending();
    assert.equal(r1.stuck, 1);
    assert.equal(r1.retrying, 0);
    assert.equal(await outbox(DB), 1, 'حُذف عنصرٌ لم يصل الخادم — فقدُ بيانات');

    const srv = fakeFrom();
    supabase.from = srv.from;
    const r2 = await DB.syncPending();
    assert.equal(srv.calls.length, 0, 'يُعاد المرفوض بلا نهاية');
    assert.equal(r2.stuck, 1);

    const r3 = await DB.syncPending({ force: true });
    assert.equal(r3.studentAtt.synced, 1);
  });

  test('تعارضٌ مؤقّت في القاعدة (40001) عابرٌ لا دائم', async () => {
    const { DB, supabase } = await queuedSheet();
    supabase.from = fakeFrom(() => ({ data: null, error: { code: '40001', message: 'could not serialize' } })).from;
    assert.equal((await DB.syncPending()).retrying, 1);
  });
});

describe('عنصرٌ يُستبدَل أثناء إرساله', () => {
  test('نجاحُ القديم لا يحذف الأحدث الذي حُفظ أثناء الإرسال', async () => {
    const who = { nsams_lastuser_school: JSON.stringify({ id: 'u1' }) };
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: false, storage: who });
    await DB.saveDailyAbsentStaff('s1', '2026-11-21', [{ staffId: 'a', name: 'سناء', kind: 'teaching' }]);
    env.online = true;

    let swapped = false;
    supabase.from = fakeFrom(async (c) => {
      if (c.op === 'insert' && !swapped) {
        swapped = true;
        env.online = false;   // المدير يحفظ قائمةً جديدة والشبكة تتعثّر
        await DB.saveDailyAbsentStaff('s1', '2026-11-21', [{ staffId: 'b', name: 'عمر', kind: 'worker' }]);
        env.online = true;
      }
      return { data: null, error: null };
    }).from;

    await DB.syncPending();
    const left = await DB.getDailyAbsentStaff('s1', '2026-11-21');
    assert.deepEqual(left.map(x => x.name), ['عمر'], 'ضاعت القائمة الأحدث');
    assert.equal((await DB.getOutboxSummary({ ownerId: 'u1' })).total, 1);
  });
});

describe('Background Sync', () => {
  test('الصفحة تُجيب عامل الخدمة: ok=false عند فشلٍ عابر، ok=true بعد النجاح', async () => {
    const { DB, supabase, env } = await loadDb({ online: false, sw: true });
    await DB.saveStudentAttendance(sheet);
    env.online = true;
    const ask = () => new Promise((resolve) => {
      const ev = { data: { type: 'BG_SYNC' }, ports: [{ postMessage: resolve }] };
      for (const fn of env.swListeners) fn(ev);
    });

    supabase.from = fakeFrom(() => ({ data: null, error: { message: 'Failed to fetch' } })).from;
    assert.deepEqual(await ask(), { ok: false });

    supabase.from = fakeFrom().from;
    await DB.syncPending({ force: true });
    assert.deepEqual(await ask(), { ok: true });
  });
});
