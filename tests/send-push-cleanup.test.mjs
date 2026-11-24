// حرّاس مصدريّة لتنظيف الاشتراكات الميّتة في send-push: 410 و404 فقط تُحذف،
// وكلُّ خطأٍ عابرٍ أو خطؤنا (400/401/403/413/429/5xx/شبكة) يُبقي الاشتراك. والحذفُ مقيَّدٌ بالمستلم.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC  = readFileSync(new URL('../supabase/functions/send-push/index.ts', import.meta.url), 'utf8');
const CODE = SRC.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

// الشرط الحاكم: سطر `if (sc === … ) gone.push(…)` — نستخرجه ونُقيّمه فعليّاً.
const m = CODE.match(/const sc = \(r\.reason as any\)\?\.statusCode;\s*if \(([^)]*)\) gone\.push\(subs\[i\]\.endpoint\);/);

test('شرط gone مستخرَج وبصيغة الـallow-list', () => {
  assert.ok(m, 'لم يُعثر على const sc + if (...) gone.push');
  assert.match(m[1], /^sc === 410 \|\| sc === 404$/);
});

const decide = (sc) => new Function('sc', `return (${m[1]});`)(sc);

test('410 و404 فقط تدخلان gone', () => {
  assert.equal(decide(410), true);
  assert.equal(decide(404), true);
});

test('400/401/403/413/429 و5xx والشبكة لا تدخل gone', () => {
  for (const sc of [400, 401, 403, 413, 429, 500, 502, 503, 504, 408, 201, undefined, null, '410', NaN]) {
    assert.equal(decide(sc), false, `الحالة ${String(sc)} يجب ألّا تُحذف`);
  }
});

test('statusCode يُضبط من استجابة HTTP فعليّة فقط', () => {
  assert.match(CODE, /\(err as any\)\.statusCode = res\.status;/);
  assert.equal((CODE.match(/\.statusCode\s*=/g) || []).length, 1);
});

test('لا يبقى فحص 410 المنفرد القديم', () => {
  assert.doesNotMatch(CODE, /statusCode\s*===\s*410/);
});

test('الحذف مقيَّد بالمستلم: .in("endpoint", gone).eq("user_id", recipientId)', () => {
  assert.match(CODE, /\.from\("push_subscriptions"\)\s*\.delete\(\)\s*\.in\("endpoint", gone\)\s*\.eq\("user_id", recipientId\)/);
});

test('recipientId هو مستلم الإشعار (من جسم الطلب) ويُستعمل في جلب الاشتراكات نفسها', () => {
  assert.match(CODE, /const \{ notificationId, recipientId \} = await req\.json\(\);/);
  assert.match(CODE, /from\("push_subscriptions"\)\.select\("endpoint,p256dh,auth_key"\)\.eq\("user_id", recipientId\)/);
});

test('delete يُنفَّذ فقط داخل if (gone.length) ولا حذف آخر من الجدول', () => {
  assert.match(CODE, /if \(gone\.length\) \{[\s\S]*?\.delete\(\)/);
  assert.equal((CODE.match(/\.delete\(\)/g) || []).length, 1);
});

test('سلوكٌ آخر لم يتغيّر: push_sent_at وشكل الاستجابة وallSettled', () => {
  assert.match(CODE, /Promise\.allSettled\(/);
  assert.match(CODE, /update\(\{ push_sent_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(CODE, /return json\(\{ ok: true, sent, total: subs\.length, errors, cleaned: gone\.length \}\);/);
});
