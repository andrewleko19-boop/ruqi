// ─────────────────────────────────────────────────────────────────────────────
//  إعادةُ الإرسال لا تُكرّر ولا تكتب القديمَ فوق الأحدث.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadDb, fakeFrom } from './helpers/db-harness.mjs';

const report = () => ({
  school_id: 's1', submitted_by: 'u1', type: 'other',
  description: 'وصفٌ كافٍ للحالة', severity: 2, media_urls: [],
});

// خادمٌ يحفظ البلاغات بمفتاح receipt_number الفريد ويحاكي ON CONFLICT DO NOTHING.
function reportsServer({ loseFirstResponse = false } = {}) {
  const rows = new Map();
  let lost = loseFirstResponse;
  const srv = fakeFrom((c) => {
    if (c.table !== 'emergency_reports') return { data: null, error: null };
    if (c.op === 'upsert') {
      const r = c.values;
      if (rows.has(r.receipt_number)) return { data: [], error: null };      // DO NOTHING
      rows.set(r.receipt_number, { id: `id${rows.size}`, ...r, created_at: 'now' });
      if (lost) { lost = false; return { data: null, error: { message: 'TypeError: Failed to fetch' } }; }
      return { data: [rows.get(r.receipt_number)], error: null };
    }
    if (c.op === 'select') {
      const rn = c.filters.find(f => f[1] === 'receipt_number')?.[2];
      return { data: rows.get(rn) ?? null, error: null };
    }
    return { data: null, error: null };
  });
  return { ...srv, rows };
}

describe('البلاغ لا يتكرّر', () => {
  test('وصل ثمّ ضاع الردّ ← الإعادة لا تُنشئ بلاغاً ثانياً', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: false });
    const shown = await DB.submitReport(report());
    const srv = reportsServer({ loseFirstResponse: true });
    supabase.from = srv.from;
    env.online = true;

    assert.equal((await DB.syncPending()).retrying, 1);
    const r = await DB.syncPending({ force: true });
    assert.equal(r.reports.synced, 1);
    assert.equal(srv.rows.size, 1, 'بلاغان عن حادثةٍ واحدة');
    assert.ok(srv.rows.has(shown.receiptNumber), 'الرقم الذي رآه المدير ليس رقمَ البلاغ في القاعدة');
  });

  test('رقمُ البلاغ بصيغة الخادم: RPT-YYYYMMDD-XXXXXXXXXX', async () => {
    const { DB } = await loadDb({ layer: 'school', online: false });
    const { receiptNumber } = await DB.submitReport(report());
    assert.match(receiptNumber, /^RPT-\d{8}-[0-9A-F]{10}$/);
  });
});

const sheet = (status) => ({ records: [{ studentId: 'st1', status }], classId: 'c1', schoolId: 's1',
                             date: '2026-11-21', teacherId: 'u1' });

describe('كشفٌ أحدث يُلغي الأقدم', () => {
  test('حفظان دون اتصال ← عنصرٌ واحد، ويُرسَل الأحدث', async () => {
    const { DB, supabase, env } = await loadDb({ online: false });
    await DB.saveStudentAttendance(sheet('absent'));
    await new Promise(r => setTimeout(r, 2));
    await DB.saveStudentAttendance(sheet('present'));
    assert.equal((await DB.getOutboxSummary({ ownerId: 'u1' })).total, 1);

    const srv = fakeFrom();
    supabase.from = srv.from;
    env.online = true;
    await DB.syncPending();
    const up = srv.calls.filter(c => c.table === 'daily_student_attendance');
    assert.equal(up.length, 1);
    assert.equal(up[0].values[0].status, 'present');
  });

  test('إرسالٌ مباشر ناجح ← النسخة الأقدم العالقة لا تُكتب فوقه', async () => {
    const { DB, supabase, env } = await loadDb({ online: false });
    await DB.saveStudentAttendance(sheet('absent'));
    await new Promise(r => setTimeout(r, 2));
    env.online = true;
    supabase.from = fakeFrom().from;
    assert.equal((await DB.saveStudentAttendance(sheet('present'))).synced, true);

    const srv = fakeFrom();
    supabase.from = srv.from;
    await DB.syncPending({ force: true });
    assert.equal(srv.calls.filter(c => c.table === 'daily_student_attendance').length, 0,
      'القديم كتب فوق التصحيح');
  });

  test('البيانُ اليوميّ للمدرسة كذلك', async () => {
    const day = (n) => ({ school_id: 's1', date: '2026-11-21', students_present: n, submitted_by: 'u1' });
    const { DB } = await loadDb({ layer: 'school', online: false });
    await DB.saveAttendance(day(100));
    await new Promise(r => setTimeout(r, 2));
    await DB.saveAttendance(day(120));
    assert.equal((await DB.getOutboxSummary({ ownerId: 'u1' })).total, 1);
  });

  test('كشفا صفّين مختلفين لا يُلغي أحدُهما الآخر', async () => {
    const { DB } = await loadDb({ online: false });
    await DB.saveStudentAttendance(sheet('absent'));
    await DB.saveStudentAttendance({ ...sheet('absent'), classId: 'c2' });
    assert.equal((await DB.getOutboxSummary({ ownerId: 'u1' })).total, 2);
  });
});

describe('وقتُ الكشف', () => {
  test('submitted_at هو وقت أخذ الكشف دون اتصال لا وقت وصوله', async () => {
    const { DB, supabase, env } = await loadDb({ online: false });
    const before = new Date().toISOString();
    await DB.saveStudentAttendance(sheet('absent'));
    await new Promise(r => setTimeout(r, 15));
    const srv = fakeFrom();
    supabase.from = srv.from;
    env.online = true;
    await DB.syncPending();
    const sub = srv.calls.find(c => c.table === 'attendance_submissions');
    assert.ok(sub.values.submitted_at >= before);
    assert.ok(sub.values.submitted_at < new Date(Date.now() - 10).toISOString(), 'سُجّل وقتُ المزامنة');
  });
});
