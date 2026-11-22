// tests/correspondence-offline.test.mjs
//
// بطاقة المراسلات دون اتصال (بوّابة المدرسة): رسالةٌ هادئة «لا يوجد اتصال…» بدل «تعذّر تحميل
// المراسلات.» — عبر معاملٍ اختياريّ offlineText تمرّره المدرسةُ وحدها. المديريةُ والوزارة
// تستعملان الملفّ المشترك نفسه وتبقيان كما كانتا. تُركَّب الوحدة الحقيقيّة على jsdom.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const OFFLINE = 'لا يوجد اتصال. المراسلات تتوفر عند الاتصال.';
const OLD_ERR = 'تعذّر تحميل المراسلات.';

let mountCorrespondence;
before(async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.HTMLElement = dom.window.HTMLElement;
  ({ mountCorrespondence } = await import('../shared/correspondence.js'));
});

/** يركّب البطاقة ويتحقّق من حالة العناصر بعد أوّل refresh. */
async function mountWith({ offlineText, getThreads, isOnline }) {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const db = { getCorrespondenceThreads: getThreads };
  if (isOnline !== undefined) db.isOnline = isOnline;
  const api = mountCorrespondence({ mount, side: 'school', db, ...(offlineText !== undefined ? { offlineText } : {}) });
  await api.refresh();
  const el = (n) => mount.querySelector(`[data-el="${n}"]`);
  return { mount, api, el };
}
const fail = async () => { throw new Error('network'); };

describe('offlineText ممرَّر', () => {
  test('فشل + isOnline()=false ← النصّ الحرفيّ ظاهر، والخطأ مخفيّ', async () => {
    const { el } = await mountWith({ offlineText: OFFLINE, getThreads: fail, isOnline: () => false });
    assert.equal(el('offline').hidden, false);
    assert.equal(el('offline').textContent.trim(), OFFLINE);
    assert.equal(el('error').hidden, true);
  });

  test('فشل + isOnline()=true ← «تعذّر تحميل المراسلات.» القديم، والإشعار مخفيّ', async () => {
    const { el } = await mountWith({ offlineText: OFFLINE, getThreads: fail, isOnline: () => true });
    assert.equal(el('error').hidden, false);
    assert.equal(el('error').textContent.trim(), OLD_ERR);
    assert.equal(el('offline').hidden, true);
  });

  test('db.isOnline غير معرَّفة ← يسقط إلى الخطأ القديم بلا استثناء', async () => {
    const { el } = await mountWith({ offlineText: OFFLINE, getThreads: fail });
    assert.equal(el('error').hidden, false);
    assert.equal(el('offline').hidden, true);
  });

  test('العنصر ليس خطأً: لا صنفَ corr-error ولا لون أحمر', async () => {
    const { el } = await mountWith({ offlineText: OFFLINE, getThreads: fail, isOnline: () => false });
    assert.ok(!el('offline').classList.contains('corr-error'));
    assert.ok(el('offline').classList.contains('corr-offline'));
    const css = read('shared/correspondence.css');
    const rule = css.match(/\.corr-offline[^{]*\{[^}]*\}/g)?.join('\n') ?? '';
    assert.ok(!/#dc2626|red/i.test(rule), 'قاعدةُ .corr-offline يجب ألّا تحمل أحمر');
    const school = read('school/style.css').match(/#corr-card \.corr-offline[^{]*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(school && !/#dc2626|red/i.test(school));
  });

  test('نجاحٌ بعد فشلٍ دون اتصال ← يختفي الإشعار (لا إعادةَ تلقائيّة: refresh يدويّ)', async () => {
    let online = false;
    const { api, el } = await mountWith({ offlineText: OFFLINE, getThreads: async () => { if (!online) throw new Error('x'); return []; }, isOnline: () => online });
    assert.equal(el('offline').hidden, false);
    online = true;
    await api.refresh();
    assert.equal(el('offline').hidden, true);
    assert.equal(el('error').hidden, true);
    assert.equal(el('empty').hidden, false);
  });

  test('النصّ يُهرَّب (لا HTML)', async () => {
    const { el } = await mountWith({ offlineText: '<b>x</b>', getThreads: fail, isOnline: () => false });
    assert.equal(el('offline').querySelector('b'), null);
    assert.equal(el('offline').textContent, '<b>x</b>');
  });
});

describe('بلا offlineText (المديرية والوزارة) ← السلوك القديم تماماً', () => {
  test('فشل + دون اتصال ← «تعذّر تحميل المراسلات.» ولا عنصرَ offline في الـDOM', async () => {
    const { mount, el } = await mountWith({ getThreads: fail, isOnline: () => false });
    assert.equal(el('error').hidden, false);
    assert.equal(el('error').textContent.trim(), OLD_ERR);
    assert.equal(mount.querySelector('.corr-offline'), null);
    assert.equal(el('offline'), null);
  });
});

describe('حرّاس مصدريّة', () => {
  test('المدرسة وحدها تمرّر offlineText، بالنصّ الحرفيّ', () => {
    assert.ok(read('school/script.js').includes(`offlineText: '${OFFLINE}'`));
  });
  test('المديرية والوزارة لا تمرّران offlineText', () => {
    assert.ok(!read('directorate/script.js').includes('offlineText'));
    assert.ok(!read('ministry/script.js').includes('offlineText'));
  });
  test('النصّ الافتراضيّ القديم ما زال في الوسم المشترك، ولا إعادةَ تحميلٍ تلقائيّة عند عودة الاتصال', () => {
    const js = read('shared/correspondence.js');
    assert.ok(js.includes(`>${OLD_ERR}</p>`));
    assert.ok(!/addEventListener\(\s*['"]online['"]/.test(js));
  });
});
