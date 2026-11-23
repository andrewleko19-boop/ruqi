// حرّاس مصدريّة لهجرة notify_user (2د): المفتاح من Vault حصراً، بلا مفتاح مضمَّن،
// والفشل مرئيّ (raise warning) لا صامت. لا يتّصل بقاعدة بيانات.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(new URL('../supabase/migrations/20261123000300_codify_notify_user.sql', import.meta.url), 'utf8');
// الشيفرة بلا تعليقات السطر (-- …) كي لا تُحسب الإشارات في الشروح.
const CODE = SQL.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

test('create or replace بنفس التوقيع (idempotent)', () => {
  assert.match(CODE, /create or replace function public\.notify_user\(\s*p_recipient_id uuid,\s*p_type\s+text,\s*p_title\s+text,\s*p_body\s+text,\s*p_entity\s+text default null,\s*p_entity_id\s+uuid default null\s*\) returns void/);
  assert.match(CODE, /security definer\s+set search_path to 'public', 'pg_temp'/);
});

test('المفتاح من vault.decrypted_secrets باسم service_role_key', () => {
  assert.match(CODE, /from vault\.decrypted_secrets\s+where name = 'service_role_key'/);
});

test('لا قراءة من app.settings ولا مفتاح مضمَّن', () => {
  assert.doesNotMatch(CODE, /current_setting\s*\(/);
  assert.doesNotMatch(CODE, /app\.settings/);
  assert.doesNotMatch(CODE, /eyJ[A-Za-z0-9_-]{10,}/, 'نمط JWT');
  assert.doesNotMatch(CODE, /sb_secret_/);
});

test('الفشل مرئيّ: raise warning في غياب المفتاح وفي معالج الاستثناء، وبلا «null;» صامت', () => {
  assert.ok((CODE.match(/raise warning/g) || []).length >= 2);
  assert.match(CODE, /exception when others then\s+raise warning/);
  assert.doesNotMatch(CODE, /exception when others then\s+null;/);
});

test('نصّ الخطأ يُنقَّى من المفتاح ولا يُطبع v_key', () => {
  assert.match(CODE, /replace\(sqlerrm, v_key, '\*\*\*'\)/);
  const warnings = CODE.match(/raise warning[^;]*;/g) || [];
  // شرطُ case وحده يذكر v_key (للتنقية)؛ فيُحذف قبل التأكّد أنّه ليس وسيطاً مطبوعاً.
  for (const w of warnings) assert.doesNotMatch(w.replace(/case when v_key[\s\S]*? end(?=;)/, ''), /\bv_key\b/);
});

test('net.http_post لا يُستدعى إلا حين يوجد مفتاح', () => {
  assert.match(CODE, /if v_key is null or v_key = '' then[\s\S]*?else\s+perform net\.http_post/);
});
