// ─────────────────────────────────────────────────────────────────────────────
//  ما يُحفظ دون اتصال يصل الخادمَ عند عودة الاتصال — مرّةً واحدة.
//
//  الخادم المزيّف هنا يتصرّف كـPostgREST في النقطة التي كسرت المزامنة: يرفض
//  أيَّ عمودٍ ليس في الجدول. فإن تسرّب حقلٌ داخليّ للطابور (table، localTs،
//  deviceId…) فشلت المزامنة كما تفشل في الإنتاج.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadDb, fakeFrom } from './helpers/db-harness.mjs';

const TABLE_COLS = {
  daily_attendance: new Set(['id', 'school_id', 'date', 'teachers_present', 'teachers_absent',
    'students_present', 'students_absent', 'notes', 'submitted_by', 'submitted_at', 'updated_at',
    'admins_present', 'admins_absent', 'workers_present', 'workers_absent']),
  emergency_reports: new Set(['id', 'school_id', 'submitted_by', 'type', 'description', 'severity',
    'status', 'receipt_number', 'media_urls', 'resolved_by', 'resolved_at', 'created_at',
    'updated_at', 'row_version', 'deleted_at']),
};

// PostgREST: عمودٌ مجهول ← PGRST204.
function strictServer(onRow = () => ({ data: null, error: null })) {
  return fakeFrom((call) => {
    const cols = TABLE_COLS[call.table];
    if (cols && call.values) {
      for (const row of [].concat(call.values)) {
        for (const k of Object.keys(row)) {
          if (!cols.has(k)) {
            return { data: null, error: { code: 'PGRST204', message: `Could not find the '${k}' column of '${call.table}'` } };
          }
        }
      }
    }
    return onRow(call);
  });
}

const attendance = () => ({
  school_id: 's1', date: '2026-11-21',
  teachers_present: 10, teachers_absent: 1, admins_present: 2, admins_absent: 0,
  workers_present: 3, workers_absent: 0, students_present: 200,
  notes: null, submitted_by: 'u1', submitted_at: '2026-11-21T05:10:00.000Z',
});

describe('البيانُ اليوميّ للمدرسة المحفوظ دون اتصال', () => {
  test('يصل الخادم عند المزامنة ولا يبقى في الطابور', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: false });
    const srv = strictServer();
    supabase.from = srv.from;

    const r = await DB.saveAttendance(attendance());
    assert.equal(r.synced, false);
    assert.equal(srv.calls.length, 0, 'لا شبكة دون اتصال');

    env.online = true;
    const res = await DB.syncPending();
    assert.equal(res.attendance.failed, 0, 'رُفض الصفّ — حقلٌ داخليّ تسرّب إلى الخادم');
    assert.equal(res.attendance.synced, 1);

    const up = srv.calls.filter(c => c.table === 'daily_attendance' && c.op === 'upsert');
    assert.equal(up.length, 1);
    assert.equal(up[0].opts.onConflict, 'school_id,date');
    assert.equal(up[0].values.students_present, 200);

    // مزامنةٌ ثانية لا تُعيد الإرسال.
    const again = await DB.syncPending();
    assert.equal(again.attendance.synced, 0);
    assert.equal(srv.calls.filter(c => c.table === 'daily_attendance').length, 1);
  });
});

describe('البلاغ الطارئ المحفوظ دون اتصال', () => {
  test('يصل الخادم عند المزامنة', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: false });
    const srv = strictServer((call) => (call.table === 'emergency_reports'
      ? { data: { id: 'r1', receipt_number: call.values.receipt_number ?? 'RPT-x', created_at: 'now', status: 'open' }, error: null }
      : { data: null, error: null }));
    supabase.from = srv.from;

    await DB.submitReport({
      school_id: 's1', submitted_by: 'u1', type: 'other',
      description: 'وصفٌ كافٍ للحالة', severity: 2, media_urls: [],
    });

    env.online = true;
    const res = await DB.syncPending();
    assert.equal(res.reports.failed, 0, 'رُفض البلاغ — حقلٌ داخليّ تسرّب إلى الخادم');
    assert.equal(res.reports.synced, 1);
  });
});
