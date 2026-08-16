// ─────────────────────────────────────────────────────────────────────────────
//  المراسلات الإدارية — بطاقةٌ واحدة تخدم البوّابات الثلاث.
//
//  الوزارة والمديرية والمدرسة تحتاج الشاشةَ نفسها: قائمةُ خيوطٍ بموضوعاتها،
//  ونافذةُ خيطٍ بردٍّ. والفرقُ بينها معاملان: جانبُ المستخدم (side) ومَن يجوز
//  أن يفتح معه خيطاً. فنُسخُ الشيفرة ثلاثاً كان يعني أن يُصلَح عيبٌ في واحدةٍ
//  ويبقى في اثنتين — وهو ما وقع في هذا المستودع مرّاتٍ (مرشِّح الشهر، شارات
//  الأرقام). فوحدةٌ واحدة تُستدعى بمعاملاتها.
//
//  الوسمُ يُبنى هنا لا في كلّ index.html: صفحةٌ تُضيف البطاقةَ بسطرٍ واحد.
//
//  الـ overlays تُلصق بـ document.body لا بـ mount: position:fixed لا يعمل
//  بصورة موثوقة داخل حاوياتٍ قد يكون لها transform أو overflow، وموضعُ
//  الغطاء الصحيح دائماً هو جذرُ الوثيقة.
// ─────────────────────────────────────────────────────────────────────────────

import { CustomSelect } from './csel.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SIDE_AR = { ministry: 'الوزارة', directorate: 'المديرية', school: 'المدرسة' };

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit', hour12: true })
    : d.toLocaleDateString('ar-SY', { day: 'numeric', month: 'short' });
}

/**
 * يركّب بطاقةَ المراسلات داخل عنصرٍ مضيف.
 *
 * @param {object}   o
 * @param {Element}  o.mount     العنصر المضيف (تُكتب فيه البطاقة كاملةً).
 * @param {string}   o.side      'ministry' | 'directorate' | 'school'
 * @param {object}   o.db        window.RUQI_DB
 * @param {Function} o.peers     () => Promise<[{id, name, directorateId?}]>
 *                               الجهاتُ التي يجوز فتحُ خيطٍ معها. فارغةٌ ⇒ لا زرَّ فتح.
 * @param {string}   o.peerLabel نصُّ حقل الجهة («المدرسة» أو «المديرية»).
 * @returns {{ refresh: Function, unreadCount: Function }}
 */
export function mountCorrespondence({ mount, side, db, peers = null, peerLabel = 'الجهة' }) {
  if (!mount) return { refresh: () => {}, unreadCount: () => 0 };

  // ── قائمة الخيوط (تبقى داخل mount) ─────────────────────────────────────
  mount.innerHTML = `
    <div class="corr-head">
      <span class="corr-title">المراسلات</span>
      <button type="button" class="corr-refresh" data-act="refresh" aria-label="تحديث">↻</button>
      ${peers ? '<button type="button" class="corr-new" data-act="new">مراسلة جديدة</button>' : ''}
    </div>
    <div class="corr-loading" data-el="loading" hidden><span class="spinner"></span></div>
    <p class="corr-error" data-el="error" hidden>تعذّر تحميل المراسلات.</p>
    <ul class="corr-list" data-el="list"></ul>
    <p class="corr-empty" data-el="empty" hidden>لا مراسلات بعد.</p>`;

  // ── غطاء الخيط — يُلصق بـ body مباشرةً ─────────────────────────────────
  const threadEl = document.createElement('div');
  threadEl.className = 'corr-overlay';
  threadEl.hidden = true;
  threadEl.innerHTML = `
    <div class="corr-panel">
      <div class="corr-panel-head">
        <span data-el="th-subject"></span>
        <button type="button" class="corr-x" data-act="close">✕</button>
      </div>
      <div class="corr-msgs" data-el="th-msgs"></div>
      <div class="corr-reply">
        <textarea data-el="th-body" rows="2" maxlength="2000" placeholder="اكتب ردَّك…"></textarea>
        <button type="button" class="corr-send" data-act="send">إرسال</button>
      </div>
      <p class="corr-closed" data-el="th-closed" hidden>هذه المراسلة مغلقة.</p>
    </div>`;
  document.body.appendChild(threadEl);

  // ── غطاء التأليف — يُلصق بـ body مباشرةً ──────────────────────────────
  const composeEl = document.createElement('div');
  composeEl.className = 'corr-overlay';
  composeEl.hidden = true;
  composeEl.innerHTML = `
    <div class="corr-panel">
      <div class="corr-panel-head">
        <span>مراسلة جديدة</span>
        <button type="button" class="corr-x" data-act="cancel">✕</button>
      </div>
      <label class="corr-field"><span>${esc(peerLabel)}</span>
        <select data-el="c-peer"></select></label>
      <label class="corr-field"><span>الموضوع</span>
        <input type="text" data-el="c-subject" maxlength="120" placeholder="موضوع المراسلة"></label>
      <label class="corr-field"><span>النصّ</span>
        <textarea data-el="c-body" rows="4" maxlength="2000"></textarea></label>
      <p class="corr-error" data-el="c-error" hidden></p>
      <button type="button" class="corr-send" data-act="create">إرسال</button>
    </div>`;
  document.body.appendChild(composeEl);

  // قائمة الجهة: تُعزَّز فوراً فتظهر بواجهة التطبيق لا بواجهة النظام.
  // refresh() يُعاد استدعاؤه في fillPeers() بعد ملء الخيارات.
  if (peers) CustomSelect.enhance(composeEl.querySelector('[data-el="c-peer"]'));

  // ── مساعدات ──────────────────────────────────────────────────────────────
  function q(n) {
    return mount.querySelector(`[data-el="${n}"]`)
        || threadEl.querySelector(`[data-el="${n}"]`)
        || composeEl.querySelector(`[data-el="${n}"]`);
  }
  const show = (n) => {
    if (n === 'thread')  { threadEl.hidden  = false; return; }
    if (n === 'compose') { composeEl.hidden = false; return; }
    const e = q(n); if (e) e.hidden = false;
  };
  const hide = (n) => {
    if (n === 'thread')  { threadEl.hidden  = true; return; }
    if (n === 'compose') { composeEl.hidden = true; return; }
    const e = q(n); if (e) e.hidden = true;
  };

  let threads = [];
  let openId  = null;
  let peerRows = null;

  const unreadCount = () => threads.reduce((n, t) => n + (t.unread | 0), 0);

  async function refresh() {
    show('loading'); hide('error'); hide('empty');
    try {
      threads = await db.getCorrespondenceThreads();
      render();
    } catch (err) {
      console.warn('[corr] refresh', err);
      show('error');
    } finally { hide('loading'); }
    mount.dispatchEvent(new CustomEvent('corr:unread',
      { bubbles: true, detail: { count: unreadCount() } }));
  }

  function render() {
    const list = q('list');
    if (!threads.length) { list.innerHTML = ''; show('empty'); return; }
    hide('empty');
    list.innerHTML = threads.map(t => {
      // الطرفُ الآخر هو ما يهمّ القارئ: هو لا يحتاج أن يُذكَّر بنفسه.
      const other = t.school_id && side !== 'school' ? t.school_name
                  : side === 'school' ? t.directorate_name
                  : t.school_id ? t.directorate_name : t.directorate_name;
      return `<li class="corr-row${t.unread ? ' is-unread' : ''}" data-id="${esc(t.id)}">
        <div class="corr-row-main">
          <div class="corr-subject">${esc(t.subject)}</div>
          <div class="corr-meta">${esc(other ?? '')}${
            t.last_body ? ' · ' + esc(String(t.last_body).slice(0, 60)) : ''}</div>
        </div>
        <div class="corr-row-side">
          <span class="corr-when">${esc(fmtWhen(t.last_message_at))}</span>
          ${t.unread ? `<span class="corr-badge">${t.unread}</span>` : ''}
          ${t.status === 'closed' ? '<span class="corr-shut">مغلقة</span>' : ''}
        </div>
      </li>`;
    }).join('');
  }

  async function openThread(id) {
    const t = threads.find(x => x.id === id);
    if (!t) return;
    openId = id;
    q('th-subject').textContent = t.subject;
    q('th-msgs').innerHTML = '<div class="corr-loading"><span class="spinner"></span></div>';
    show('thread');
    const closed = t.status === 'closed';
    q('th-closed').hidden = !closed;
    q('th-body').disabled = closed;
    threadEl.querySelector('[data-act="send"]').disabled = closed;
    try {
      const msgs = await db.getCorrespondenceMessages(id);
      q('th-msgs').innerHTML = msgs.map(m => `
        <div class="corr-msg${m.sender_side === side ? ' is-mine' : ''}">
          <div class="corr-msg-who">${esc(m.sender?.full_name || SIDE_AR[m.sender_side] || '')}
            <span class="corr-msg-when">${esc(fmtWhen(m.created_at))}</span></div>
          <div class="corr-msg-body">${esc(m.body)}</div>
        </div>`).join('') || '<p class="corr-empty">لا رسائل.</p>';
      // الفتحُ هو القراءة: ختمٌ فوريّ فلا يبقى العدّادُ أحمر بعد أن قرأ.
      if (t.unread) { await db.markCorrespondenceRead(id, side).catch(() => {}); }
    } catch (err) {
      console.warn('[corr] messages', err);
      q('th-msgs').innerHTML = '<p class="corr-error">تعذّر تحميل الرسائل.</p>';
    }
  }

  async function fillPeers() {
    if (!peers) return;
    const sel = q('c-peer');
    if (peerRows) return;
    try { peerRows = await peers(); } catch { peerRows = []; }
    sel.innerHTML = peerRows.map(p =>
      `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    // يُعاد بناء قائمة الخيارات في CustomSelect بعد ملء الـ <select>.
    CustomSelect.refresh(sel);
  }

  // ── البطاقة: تحديث، مراسلة جديدة، فتح خيط ──────────────────────────────
  mount.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'refresh') { void refresh(); return; }
    if (act === 'new')     { await fillPeers(); hide('c-error'); show('compose'); return; }
    const row = e.target.closest('.corr-row');
    if (row) void openThread(row.dataset.id);
  });

  // ── غطاء الخيط: إغلاق، إرسال ردّ ───────────────────────────────────────
  threadEl.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') {
      hide('thread'); openId = null; void refresh(); return;
    }
    if (act === 'send') {
      const body = q('th-body').value.trim();
      if (!body || !openId) return;
      const btn = e.target.closest('[data-act="send"]');
      btn.disabled = true;
      try {
        await db.sendCorrespondence(openId, side, body);
        q('th-body').value = '';
        const id = openId;
        await refresh();
        await openThread(id);
      } catch (err) {
        console.warn('[corr] send', err);
      } finally { btn.disabled = false; }
    }
  });

  // ── غطاء التأليف: إلغاء، إنشاء خيط جديد ───────────────────────────────
  composeEl.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') { hide('compose'); return; }
    if (act === 'create') {
      const subject = q('c-subject').value.trim();
      const body    = q('c-body').value.trim();
      const peerId  = q('c-peer').value;
      const err     = q('c-error');
      if (!subject || !body || !peerId) {
        err.textContent = 'الموضوع والنصّ والجهة مطلوبةٌ كلُّها.';
        err.hidden = false; return;
      }
      const peer = (peerRows || []).find(p => p.id === peerId);
      const btn = e.target.closest('[data-act="create"]');
      btn.disabled = true;
      try {
        await db.openCorrespondence({
          subject, body, side,
          // المدرسةُ تفتح مع مديريتها، والمديريةُ مع مدرسةٍ أو مع الوزارة.
          directorateId: peer?.directorateId ?? peerId,
          schoolId:      peer?.directorateId ? peerId : null,
        });
        q('c-subject').value = ''; q('c-body').value = '';
        hide('compose');
        await refresh();
      } catch (e2) {
        console.warn('[corr] create', e2);
        err.textContent = 'تعذّر إرسال المراسلة.';
        err.hidden = false;
      } finally { btn.disabled = false; }
    }
  });

  void refresh();
  return { refresh, unreadCount };
}
