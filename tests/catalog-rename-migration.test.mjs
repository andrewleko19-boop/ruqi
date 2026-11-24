// حرّاسٌ مصدريّة لهجرة 20261124000000: إعادةُ تسمية الفهرس تصل النسخ غير المُعدَّلة محلّياً فقط.
// السلوك الفعليّ جُرّب على PostgreSQL 16 (انظر رسالة الالتزام)؛ هنا ما لا يجوز أن يتبدّل صدفةً.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SQL  = readFileSync(new URL('../supabase/migrations/20261124000000_catalog_rename_propagates_to_subjects.sql', import.meta.url), 'utf8');
const CODE = SQL.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

test('التحديث مقيَّدٌ بالمعرّف وباسمٍ يساوي الاسم القديم (لا يمسّ التسمية المحلّية)', () => {
  assert.match(CODE, /where s\.catalog_id = new\.id\s+and btrim\(s\.name\) = btrim\(old\.name\)/);
});

test('لا حذفَ ولا قيدَ فريد ولا لمسَ لجداول الدرجات', () => {
  assert.doesNotMatch(CODE, /\bdelete\b|unique|student_grades|alter table/i);
});

test('SECURITY DEFINER بـsearch_path مثبَّت، وبلا صلاحيّة تنفيذ لأحد', () => {
  assert.match(CODE, /security definer\s+set search_path to 'public', 'pg_temp'/);
  assert.match(CODE, /revoke all on function public\.propagate_catalog_rename\(\) from public, anon, authenticated/);
});

test('الزناد بعد تحديث name فقط وعند التغيّر الفعليّ، وidempotent', () => {
  assert.match(CODE, /drop trigger if exists trg_catalog_rename_propagate on public\.subject_catalog/);
  assert.match(CODE, /after update of name on public\.subject_catalog\s+for each row\s+when \(old\.name is distinct from new\.name\)/);
  assert.match(CODE, /create or replace function public\.propagate_catalog_rename\(\)/);
});
