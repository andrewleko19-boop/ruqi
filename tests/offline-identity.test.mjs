// ─────────────────────────────────────────────────────────────────────────────
//  الدخولُ إلى البوّابة على واي‑فاي بلا إنترنت.
//
//  navigator.onLine يبقى true على شبكةٍ محلّية بلا خطّ (الحالة الأشيع في
//  المدارس). فإن كان التوكن منتهياً (عمرُه ساعة) فشل تجديدُه فوراً وأعاد
//  getSession جلسةً فارغة بلا رمي — وكانت getCurrentUser تُعيد null فيُرمى
//  المعلّمُ إلى شاشة دخولٍ لا تعمل دون اتصال.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadDb } from './helpers/db-harness.mjs';

const UID = '11111111-2222-3333-4444-555555555555';
const cachedIdentity = {
  'nsams_lastuser_teacher': JSON.stringify({ id: UID, email: 't@x' }),
  [`nsams_profile_teacher_${UID}`]: JSON.stringify({
    role: 'teacher', school_id: 's1', directorate_id: 'd1', full_name: 'معلّم',
  }),
};

describe('هويةٌ مخبّأة حين يتعذّر تجديد الجلسة', () => {
  test('شبكةٌ «متّصلة» بلا إنترنت + فشلُ تجديدٍ شبكيّ ← دخولٌ بالمخبأ لا شاشة الدخول', async () => {
    const { DB, supabase } = await loadDb({ online: true, storage: cachedIdentity });
    supabase.auth.getSession = async () => ({
      data: { session: null },
      error: { name: 'AuthRetryableFetchError', status: 0, message: '{}' },
    });
    const u = await DB.getCurrentUser();
    assert.ok(u, 'أُعيد null فتظهر شاشة الدخول لمستخدمٍ داخلٍ فعلاً');
    assert.equal(u.user.id, UID);
    assert.equal(u.role, 'teacher');
    assert.equal(u.offline, true);
  });

  test('رفضٌ صريح للرمز (أُبطل) ← شاشة الدخول، لا هويةٌ مخبّأة', async () => {
    const { DB, supabase } = await loadDb({ online: true, storage: cachedIdentity });
    supabase.auth.getSession = async () => ({
      data: { session: null },
      error: { name: 'AuthApiError', status: 400, message: 'Invalid Refresh Token: Refresh Token Not Found' },
    });
    assert.equal(await DB.getCurrentUser(), null);
  });

  test('لا جلسة ولا خطأ وأونلاين ← خروجٌ حقيقي', async () => {
    const { DB, supabase } = await loadDb({ online: true, storage: cachedIdentity });
    supabase.auth.getSession = async () => ({ data: { session: null }, error: null });
    assert.equal(await DB.getCurrentUser(), null);
  });

  test('أوفلاين صريح (navigator.onLine=false) ← دخولٌ بالمخبأ كما كان', async () => {
    const { DB, supabase } = await loadDb({ online: false, storage: cachedIdentity });
    supabase.auth.getSession = async () => ({ data: { session: null }, error: null });
    const u = await DB.getCurrentUser();
    assert.equal(u?.user.id, UID);
  });

  test('لا هويةَ مخبّأة ← null مهما كانت الشبكة (لا دخول أوّل دون اتصال)', async () => {
    const { DB, supabase } = await loadDb({ online: true, userId: null });
    supabase.auth.getSession = async () => ({
      data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0 },
    });
    assert.equal(await DB.getCurrentUser(), null);
  });
});

describe('شبكةٌ ميتة عرفها تجديدُ الجلسة', () => {
  test('بعد فشل التجديد الشبكيّ: الكتابة إلى الطابور مباشرةً بلا انتظار شبكة', async () => {
    const { DB, supabase } = await loadDb({ online: true, storage: cachedIdentity });
    supabase.auth.getSession = async () => ({
      data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0 },
    });
    assert.ok(await DB.getCurrentUser());
    supabase.from = () => { throw new Error('لُمست الشبكة والجلسةُ تقول إنّها ميتة'); };
    const r = await DB.saveStudentAttendance({
      records: [{ studentId: 'st1', status: 'absent' }], classId: 'c1', schoolId: 's1',
      date: '2026-11-21', teacherId: UID,
    });
    assert.equal(r.synced, false);
    assert.equal(DB.isOnline(), false);
  });
});
