// tests/school-tab-default.test.mjs
//
// علّتان في بوّابة المدرسة:
//  ١) التبويب النشط يُحمَل في العنوان (hash) و location.reload() يُبقيه، فمديرُ المدرسة
//     التالية على الجهاز المشترك كان يُفتح على التبويب الذي تركه سابقُه («الكادر»).
//  ٢) الافتراضيّ كان «أوّلَ مفتاحٍ في TABS» = «الغياب والتقارير» لا «الرئيسية».
// school/script.js لا يُستورَد في node (يلمس DOM عند التحميل)، فالاختبارات تستخرج المتونَ
// نصّياً — كما تفعل بقيّة اختبارات المستودع — وتُقيِّم الدالّة الصغيرة بجدولٍ مزيَّف.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const js = read('school/script.js');

/** يُقيِّم firstAllowedTab المستخرَجة على TABS مزيَّفة: {name: visible|null(بلا زرّ)|false(مخفيّ)}. */
function firstAllowedTabWith(visibility) {
  const a = js.indexOf('function firstAllowedTab()');
  const b = js.indexOf('\n}\n', a) + 3;
  assert.ok(a > 0 && b > a, 'لم تُوجَد firstAllowedTab');
  const TABS = {};
  for (const [name, v] of Object.entries(visibility)) TABS[name] = { tab: v === null ? null : { hidden: v === false } };
  return new Function('TABS', `${js.slice(a, b)}\nreturn firstAllowedTab();`)(TABS);
}

describe('التبويب الافتراضيّ: «الرئيسية» متى سُمح بها', () => {
  // الترتيب المزيَّف = ترتيب TABS الفعليّ: summary-reports أوّلاً.
  test('كلّ الأزرار ظاهرة ← attendance (لا أوّلُ مفتاحٍ في TABS)', () => {
    assert.equal(firstAllowedTabWith({ 'summary-reports': true, attendance: true, manage: true }), 'attendance');
  });
  test('زرّ attendance مخفيّ (وحدةٌ معطَّلة) ← أوّلُ تبويبٍ ظاهر', () => {
    assert.equal(firstAllowedTabWith({ 'summary-reports': true, attendance: false, manage: true }), 'summary-reports');
    assert.equal(firstAllowedTabWith({ 'summary-reports': false, attendance: false, manage: true }), 'manage');
  });
  test('لا زرَّ ظاهراً ← attendance (الاحتياط القديم)', () => {
    assert.equal(firstAllowedTabWith({ 'summary-reports': false, attendance: false }), 'attendance');
  });
  test('تبويبٌ بلا زرّ (إعدادات المدرسة: tab=null) لا يكون الافتراضيّ', () => {
    assert.equal(firstAllowedTabWith({ staff: null, 'summary-reports': true, attendance: false }), 'summary-reports');
  });
  test('ترتيبُ TABS لم يُمسّ: summary-reports أوّلُ مفاتيحه (فالإصلاح في الدالّة لا في الترتيب)', () => {
    const i = js.indexOf('const TABS = {');
    assert.match(js.slice(i, i + 120), /'summary-reports': \{ tab: tabSummaryReports/);
  });
});

describe('الخروج يمحو العنوان قبل إعادة التحميل', () => {
  const a = js.indexOf("btnLogoutOk.addEventListener('click'");
  const body = js.slice(a, js.indexOf('// ── In-app confirm', a));
  test('بين purgeTenantCaches وlocation.reload() استدعاءُ replaceState يُبقي search ويُسقط hash', () => {
    const p = body.indexOf('purgeTenantCaches');
    const r = body.indexOf("history.replaceState(null, '', location.pathname + location.search)");
    const l = body.lastIndexOf('location.reload();');
    assert.ok(p > 0 && r > p && l > r, 'الترتيب المطلوب: تنظيف المخابئ ← محو الـhash ← إعادة التحميل');
  });
  test('لا مفتاحَ تخزينٍ جديد للتبويب (الحاملُ الوحيد هو الـhash)', () => {
    assert.ok(!/(localStorage|sessionStorage)\.[sg]etItem\([^)]*[tT]ab/.test(js));
  });
});

describe('الاستعادة من العنوان باقية (التحديث والمفضّلة)', () => {
  test('الإقلاع ما زال يقرأ العنوان بـrestoreTab ثم يستعمل firstAllowedTab احتياطاً', () => {
    assert.match(js, /restoreTab\(_allowedTabs, firstAllowedTab\(\)\)/);
  });
  test('احتياطُ switchTab للتبويب الممنوع ما زال firstAllowedTab()', () => {
    assert.match(js, /const fallback = firstAllowedTab\(\);/);
  });
});

describe('بوّابة المعلّم لا تتأثّر (توثيقٌ لسبب عدم لمسها)', () => {
  test('يُكتب #home قبل أيّ restoreTab فلا يُفتح وضعٌ من جلسةٍ سابقة', () => {
    const t = read('teacher/script.js');
    const w = t.indexOf("history.replaceState({ view: 'home'");
    const r = t.indexOf('restoreTab(');
    assert.ok(w > 0 && r > w, 'يجب أن يسبق replaceState(#home) كلَّ restoreTab');
  });
});
