// ─────────────────────────────────────────────────────────────────────────────
//  إعداد مشترك: تحميل البيئة، صناعة عملاء Supabase، أدوات الطباعة والتقرير.
//  لا يحتوي هذا الملف على أي سرّ — كل القيم من متغيّرات البيئة (.env).
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ── علامة تُوسم بها كل بيانات الاختبار حتى يكون التنظيف مؤكّداً ──────────────
export const MARK = '__RLS_AUDIT__';
export const ACADEMIC_YEAR = process.env.AUDIT_ACADEMIC_YEAR || '2025-2026';

// ── ANSI بلا اعتماديات ───────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
export const paint = {
  pass:  (s) => `${C.green}${s}${C.reset}`,
  fail:  (s) => `${C.red}${C.bold}${s}${C.reset}`,
  warn:  (s) => `${C.yellow}${s}${C.reset}`,
  info:  (s) => `${C.cyan}${s}${C.reset}`,
  dim:   (s) => `${C.gray}${s}${C.reset}`,
  bold:  (s) => `${C.bold}${s}${C.reset}`,
  head:  (s) => `\n${C.bold}${C.blue}${s}${C.reset}`,
};

export function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(paint.fail(`\n✗ متغيّرات بيئة ناقصة: ${missing.join(', ')}`));
    console.error(paint.dim('   انسخ .env.example إلى .env وعبّئ القيم، ثمّ أعد التشغيل.\n'));
    process.exit(2);
  }
}

// عميل الخدمة: يتجاوز RLS — للبذر والتنظيف وقراءة الحقيقة الأرضية فقط.
export function serviceClient() {
  requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// عميل «متصفّح» جديد بمفتاح anon — نُسجّل الدخول به كمستخدم اختبار فيُطبَّق RLS
// عليه تماماً كما في التطبيق الحقيقي.
export function anonClient() {
  requireEnv(['SUPABASE_URL', 'SUPABASE_ANON_KEY']);
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ── مُجمِّع النتائج → تقرير موحّد (stdout + report.json) ─────────────────────
export class Report {
  constructor() { this.sections = []; }
  section(title) { const s = { title, rows: [] }; this.sections.push(s); return s; }
  static row(status, label, detail = '') { return { status, label, detail }; }

  print() {
    for (const s of this.sections) {
      console.log(paint.head(`━━ ${s.title} ━━`));
      for (const r of s.rows) {
        const tag = r.status === 'pass' ? paint.pass('✓ PASS')
                  : r.status === 'fail' ? paint.fail('✗ FAIL')
                  : r.status === 'warn' ? paint.warn('⚠ WARN')
                  :                        paint.info('• INFO');
        console.log(`  ${tag}  ${r.label}${r.detail ? paint.dim('  — ' + r.detail) : ''}`);
      }
    }
  }
  counts() {
    const c = { pass: 0, fail: 0, warn: 0, info: 0 };
    for (const s of this.sections) for (const r of s.rows) c[r.status]++;
    return c;
  }
}

export const uid = (n = 6) => Math.random().toString(36).slice(2, 2 + n);
export const nowIso = () => new Date().toISOString();
