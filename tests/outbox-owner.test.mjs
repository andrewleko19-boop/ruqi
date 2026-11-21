// ─────────────────────────────────────────────────────────────────────────────
//  الجهاز المشترك: كشوفُ معلّمٍ لا تُرسَل بجلسة زميله، ولا تضيع.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadDb, fakeFrom } from './helpers/db-harness.mjs';

const sheet = { records: [{ studentId: 'st1', status: 'absent' }], classId: 'c1', schoolId: 's1',
                date: '2026-11-21', teacherId: 'A' };
const asUser = (supabase, id) => {
  supabase.auth.getSession = async () => ({ data: { session: id ? { user: { id } } : null }, error: null });
};

describe('صاحبُ عنصر الطابور', () => {
  test('عنصرُ المعلّم «أ» لا يُرسَل بجلسة «ب» — ويُرسَل حين يعود «أ»', async () => {
    const { DB, supabase, env, ls } = await loadDb({ online: false, userId: 'A' });
    await DB.saveStudentAttendance(sheet);
    assert.equal((await DB.getOutboxSummary({ ownerId: 'A' })).total, 1);

    // «ب» يدخل على الجهاز نفسه.
    ls.setItem('nsams_lastuser_teacher', JSON.stringify({ id: 'B' }));
    asUser(supabase, 'B');
    const srv = fakeFrom();
    supabase.from = srv.from;
    env.online = true;
    const r1 = await DB.syncPending();
    assert.equal(srv.calls.length, 0, 'أُرسل كشفُ «أ» بجلسة «ب»');
    assert.equal(r1.studentAtt.failed, 0);
    assert.equal((await DB.getOutboxSummary({ ownerId: 'B' })).total, 0, '«ب» يرى عمل «أ» معلّقاً عليه');

    asUser(supabase, 'A');
    const r2 = await DB.syncPending();
    assert.equal(r2.studentAtt.synced, 1);
    assert.equal((await DB.getOutboxSummary({ ownerId: 'A' })).total, 0);
  });

  test('بلا جلسة: لا محاولة ولا «فشل» — بل authRequired', async () => {
    const { DB, supabase, env } = await loadDb({ online: false, userId: 'A' });
    await DB.saveStudentAttendance(sheet);
    asUser(supabase, null);
    const srv = fakeFrom();
    supabase.from = srv.from;
    env.online = true;
    const r = await DB.syncPending();
    assert.equal(r.authRequired, true);
    assert.equal(srv.calls.length, 0);
    assert.equal((await DB.getOutboxSummary({ ownerId: 'A' })).total, 1, 'العنصر باقٍ');
  });

  test('عنصرٌ قديم بلا صاحب (قبل هذا الإصلاح) يُحاوَل كما كان', async () => {
    const legacy = [{ ...sheet, localId: 'local_1', synced: false, createdAt: 'x' }];
    const { DB, supabase } = await loadDb({
      online: true, userId: 'B', idb: false,
      storage: { nsams_idb_migrated: '1', nsams_pending_stu_att: JSON.stringify(legacy) },
    });
    const srv = fakeFrom();
    supabase.from = srv.from;
    const r = await DB.syncPending();
    assert.equal(r.studentAtt.synced, 1);
  });

  test('الملخّص يعدّ الطابور الاحتياطيّ في localStorage أيضاً', async () => {
    const { DB } = await loadDb({ online: false, userId: 'A', idb: false });
    await DB.saveStudentAttendance(sheet);
    const s = await DB.getOutboxSummary({ ownerId: 'A' });
    assert.equal(s.total, 1);
    assert.equal(s.byTable.daily_student_attendance, 1);
  });
});
