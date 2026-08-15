// ─────────────────────────────────────────────────────────────────────────────
//  مصفوفةٌ فارغة ليست «لا وحدة مفعّلة» بل «لا أعرف».
//
//  get_my_module_permissions() تُرجع صفوف role_module_permissions لمفتاح دور
//  المستخدم. والوحدات الأساسية (attendance-core، student-records،
//  sysadmin-console) مزروعةٌ لكلّ مفتاحٍ في المصفوفة، وزنادُ
//  enforce_core_module_enabled يمنع تعطيلها — فدورٌ معرَّفٌ فعلاً لا يمكن أن
//  يُرجع صفراً. والصفرُ يعني مفتاحَ دورٍ لا صفوف له، أي خللَ إعداد.
//
//  وثمنُ الخطأ غير متكافئ: new Set([]) قيمةٌ صادقة في JavaScript، فتمرّ من
//  `if (!_enabled)` ثمّ يُخفي applyToDom كلَّ عنصرٍ يحمل data-module — لوحةٌ
//  بيضاء لا تبويب فيها ولا زرّ، ولا يجد صاحبُها ما يضغطه ليُبلّغ عمّا يرى.
//
//  وقد كان الطريق إلى ذلك مفتوحاً فعلاً: القيمةُ التقنية 'directorate_user'
//  ليست مفتاحاً في المصفوفة (المفتاح 'directorate_staff')، وأيّ حسابٍ يُنشأ بلا
//  permission_role كان يسقط إليها.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('طبقة العرض تفشل مفتوحةً على المصفوفة الفارغة', () => {
  const src = read('shared/permissions.js');

  test('الفارغة تُعامَل مجهولةً لا محظورة', () => {
    assert.match(src, /if \(keys\.length === 0\) \{ _enabled = null; return null; \}/,
      'مصفوفةٌ فارغة تصير Set فارغة — و applyToDom تُخفي كلّ الواجهة.');
  });

  test('الفارغة لا تُخبَّأ — وإلّا بقيت اللوحة بيضاء أوفلاين بعد إصلاح الإعداد', () => {
    const i = src.indexOf('if (keys.length === 0)');
    const j = src.indexOf('_cacheModules(uid, keys)');
    assert.ok(i > 0 && j > i,
      'التخبئة تسبق حارس الفراغ — فتُحفظ الفارغة ويُقرأها الإقلاع التالي.');
  });

  test('isEnabled و applyToDom يعاملان null إظهاراً لا إخفاء', () => {
    assert.match(src, /if \(!_enabled\) return true;/);
    assert.match(src, /if \(!_enabled\) return hiddenKeys;/);
  });
});

describe('الدور الافتراضيّ يوافق مفاتيح المصفوفة', () => {
  const migs = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter(f => f.endsWith('.sql'))
    .map(f => read(join('supabase/migrations', f)))
    .join('\n');

  // آخر تعريفٍ للدالّة هو الفعّال — الهجرات تُطبَّق بالترتيب.
  const defs = migs.match(/create or replace function public\.current_user_permission_role\(\)[\s\S]*?\$\$;/g);
  const last = defs?.[defs.length - 1];

  test('السقوط الاحتياطيّ يترجم الدور التقنيّ لا يمرّره خاماً', () => {
    assert.ok(last, 'لم يُعثر على current_user_permission_role');
    assert.match(last, /when 'directorate_user' then 'directorate_staff'/,
      "'directorate_user' ليس مفتاحاً في المصفوفة — يُرجع صفر وحدات ولوحةً بيضاء.");
    assert.match(last, /when 'ministry_user'\s+then 'ministry_staff'/);
  });
});

describe('مسارات إنشاء الحسابات تضبط permission_role', () => {
  const cases = [
    ['supabase/functions/admin-create-user/index.ts',  'school_admin',      'school_admin'],
    ['supabase/functions/admin-create-user/index.ts',  'directorate_user',  'directorate_staff'],
    ['supabase/functions/admin-create-staff/index.ts', 'teacher',           'teacher'],
  ];
  for (const [file, role, perm] of cases) {
    test(`${role} ← permission_role: ${perm}`, () => {
      const src = read(file);
      const re = new RegExp(`role: "${role}", permission_role: "${perm}"`);
      assert.match(src, re,
        `حسابُ ${role} يُنشأ بلا permission_role — يعتمد على السقوط الاحتياطيّ، `
        + 'ولوحةُ المشرف تعرض خياراً محدَّداً لقيمةٍ فارغة فعلاً.');
    });
  }
});
