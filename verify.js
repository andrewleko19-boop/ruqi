// verify.js — public certificate verification (no login).
//
// Reads ?t=<studentId>&y=<academicYear> from the QR link printed on the
// الجلاء المدرسي and renders a minimal summary via the verify_certificate RPC.
// The RPC is SECURITY DEFINER and returns only the fields already printed on
// the paper certificate; student ids are unguessable UUIDs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = "https://xocrzpjfvizgnsybegwr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_HCVzNgEJmov38FWXRO1uFw_DG1d87Y4";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const $ = (id) => document.getElementById(id);

function showError(msg) {
  $('loading').hidden = true;
  $('result').hidden  = true;
  const e = $('error');
  e.textContent = msg;
  e.hidden = false;
}

function row(dl, label, value) {
  if (value == null || value === '') return;
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = String(value);       // textContent → no HTML injection
  dl.append(dt, dd);
}

function fmtPct(n) {
  if (n == null) return null;
  return (Math.round(Number(n) * 10) / 10) + '٪';
}

(async () => {
  const params    = new URLSearchParams(location.search);
  const studentId = (params.get('t') || '').trim();
  const year      = (params.get('y') || '').trim();

  if (!studentId) {
    showError('رابط غير صالح — لا يحتوي على معرّف الشهادة.');
    return;
  }

  let data;
  try {
    const res = await db.rpc('verify_certificate', {
      p_student: studentId,
      p_year:    year || null,
    });
    if (res.error) throw res.error;
    data = Array.isArray(res.data) ? res.data[0] : res.data;
  } catch (err) {
    console.error('[verify]', err);
    showError('تعذّر الاتصال بالنظام. حاول لاحقاً.');
    return;
  }

  if (!data) {
    showError('لا توجد شهادة مطابقة لهذا الرمز.');
    return;
  }

  const verdict = $('verdict');
  const result  = data.result || null;
  if (result === 'ناجح')      { verdict.textContent = 'ناجح'; verdict.className = 'badge pass'; }
  else if (result === 'راسب') { verdict.textContent = 'راسب'; verdict.className = 'badge fail'; }
  else                         { verdict.textContent = 'النتيجة غير صادرة بعد'; verdict.className = 'badge none'; }

  const dl = $('fields');
  dl.innerHTML = '';
  row(dl, 'اسم الطالب',    data.student_name);
  row(dl, 'المدرسة',       data.school_name);
  row(dl, 'المديرية',      data.directorate_name);
  row(dl, 'الصف',          data.class_label);
  row(dl, 'العام الدراسي', data.academic_year);
  row(dl, 'النسبة النهائية', fmtPct(data.final_percent));
  row(dl, 'حالة الجلاء',   data.issued ? 'صادر ومعتمد ✓' : 'غير صادر رسميّاً بعد');

  $('loading').hidden = true;
  $('result').hidden  = false;
})();
