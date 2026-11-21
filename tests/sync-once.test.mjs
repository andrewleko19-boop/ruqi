// ─────────────────────────────────────────────────────────────────────────────
//  كلُّ عنصرٍ يصل الخادم مرّةً واحدة — مهما تزاحمت مُطلِقاتُ المزامنة.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadDb, fakeFrom } from './helpers/db-harness.mjs';

const report = () => ({
  school_id: 's1', submitted_by: 'u1', type: 'other',
  description: 'وصفٌ كافٍ للحالة', severity: 2, media_urls: [],
});
const reportServer = () => fakeFrom((c) => (c.table === 'emergency_reports'
  ? { data: { id: 'r1', receipt_number: 'RPT-1', created_at: 'now', status: 'open' }, error: null }
  : { data: null, error: null }));

describe('مزامنةٌ واحدة في كلّ لحظة', () => {
  test('نداءان متزامنان في الصفحة نفسها ← إرسالٌ واحد ونتيجةٌ واحدة', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: false });
    await DB.submitReport(report());
    const srv = reportServer();
    supabase.from = srv.from;
    env.online = true;

    const [a, b] = await Promise.all([DB.syncPending(), DB.syncPending()]);
    assert.equal(srv.calls.filter(c => c.table === 'emergency_reports' && c.op !== 'select').length, 1, 'بلاغٌ مكرَّر');
    assert.equal(a, b);
  });

  test('تبويبٌ آخر يحمل القفل ← لا إرسال، و busy:true', async () => {
    const { DB, supabase, env } = await loadDb({ layer: 'school', online: false });
    await DB.submitReport(report());
    const srv = reportServer();
    supabase.from = srv.from;
    env.online = true;
    navigator.locks = { request: async (_n, _o, cb) => cb(null) };   // القفل مأخوذ

    const r = await DB.syncPending();
    assert.equal(r.busy, true);
    assert.equal(srv.calls.length, 0);
    assert.equal(r.reports.synced, 0);
  });

  test('هجرة الطوابير القديمة لا تُرسل العنصر مرّتين', async () => {
    const legacy = [{ school_id: 's1', type: 'other', description: 'وصفٌ قديمٌ كافٍ', severity: 1,
                      status: 'open', media_urls: [], localId: 'local_1', synced: false,
                      createdAt: '2026-01-01T00:00:00Z' }];
    const { DB, supabase, ls } = await loadDb({
      layer: 'school', online: true,
      storage: { nsams_pending_reports: JSON.stringify(legacy) },   // بلا علم الهجرة
    });
    const srv = reportServer();
    supabase.from = srv.from;

    const r = await DB.syncPending();
    assert.equal(srv.calls.filter(c => c.table === 'emergency_reports' && c.op !== 'select').length, 1, 'أُرسل مرّتين: من IDB ومن localStorage');
    assert.equal(r.reports.synced, 1);
    assert.equal(JSON.parse(ls.getItem('nsams_pending_reports')).length, 0);
  });
});
