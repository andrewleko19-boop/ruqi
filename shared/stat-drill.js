// ─────────────────────────────────────────────────────────────────────────────
//  شبكةُ أرقامٍ قابلة للضغط، ونافذةُ تفصيلٍ تعرض ما وراء الرقم.
//
//  «٤٢ مدرسة ابتدائية» رقمٌ لا يُصدَّق ولا يُراجَع: لا يعرف المسؤول أيَّ مدارس
//  هي، ولا يكتشف أنّ إحداها مكرّرة أو مغلقة منذ سنة. فكلّ رقمٍ هنا بابٌ:
//  ضغطُه يفتح قائمة ما عُدّ، بالأسماء.
//
//  الوحدة مشتركة بين لوحتَي المديرية والوزارة، وهما تتشاركان اللوحة اللونية
//  الخام (paper/line/ink) وإن اختلفت أسماء مشتقّاتها. فتُستعمل الخام مباشرةً
//  مع بدائل صريحة: لو حُمِّلت الوحدة في صفحةٍ لا تعرّفها بقيت مقروءة.
//
//  التنسيق يُحقن مرّةً واحدة عند أوّل استعمال: وحدةٌ تحمل مظهرها معها لا تفرض
//  على كل بوّابةٍ تكرار ثمانين سطراً من CSS ثم إبقاءها متطابقة يدوياً.
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
.sd-grid { display:grid; gap:14px; }
.sd-group { border:1px solid var(--line,#2b3557); border-radius:12px;
  background:var(--paper-2,#182140); padding:12px 14px; }
.sd-group-title { font-size:.78rem; font-weight:800; color:var(--ink-soft,#aab3c8);
  margin:0 0 10px; letter-spacing:.02em; }
.sd-chips { display:flex; flex-wrap:wrap; gap:8px; }
.sd-chip { display:flex; flex-direction:column; align-items:flex-start; gap:2px;
  min-width:104px; padding:9px 12px; border-radius:10px; border:1px solid var(--line,#2b3557);
  background:var(--paper,#11182b); color:var(--ink,#eef1f8);
  font:inherit; text-align:start; cursor:pointer; transition:border-color .15s, background .15s; }
.sd-chip:hover:not(:disabled), .sd-chip:focus-visible {
  border-color:var(--accent,#35b3ac); background:var(--line-soft,#202a48); outline:none; }
.sd-chip:disabled { cursor:default; opacity:.62; }
.sd-chip-val { font-size:1.32rem; font-weight:800; line-height:1.1; font-variant-numeric:tabular-nums; }
.sd-chip-lbl { font-size:.72rem; color:var(--ink-soft,#aab3c8); }
.sd-chip.is-good .sd-chip-val { color:var(--good,#3fbd80); }
.sd-chip.is-warn .sd-chip-val { color:var(--warn,#e0a83f); }
.sd-chip.is-bad  .sd-chip-val { color:var(--bad,#e2685a); }

.sd-overlay { position:fixed; inset:0; z-index:1200; display:flex; align-items:center;
  justify-content:center; padding:16px; background:rgba(3,6,15,.72); }
.sd-overlay[hidden] { display:none; }
.sd-modal { width:min(680px,100%); max-height:min(78vh,720px); display:flex; flex-direction:column;
  background:var(--paper-2,#182140); border:1px solid var(--line,#2b3557);
  border-radius:14px; box-shadow:0 24px 60px rgba(0,0,0,.5); overflow:hidden; }
.sd-hdr { display:flex; align-items:flex-start; gap:12px; padding:14px 16px;
  border-bottom:1px solid var(--line,#2b3557); }
.sd-hdr-txt { flex:1; min-width:0; }
.sd-title { font-size:.98rem; font-weight:800; color:var(--ink,#eef1f8); margin:0; }
.sd-sub { font-size:.75rem; color:var(--ink-faint,#75809c); margin:3px 0 0; }
.sd-close { flex-shrink:0; width:30px; height:30px; border-radius:8px; cursor:pointer;
  border:1px solid var(--line,#2b3557); background:transparent; color:var(--ink-soft,#aab3c8);
  font-size:1.1rem; line-height:1; }
.sd-close:hover { background:var(--line-soft,#202a48); color:var(--ink,#eef1f8); }
.sd-body { overflow:auto; padding:6px 0; }
.sd-row { display:flex; align-items:center; gap:10px; padding:9px 16px;
  border-bottom:1px solid var(--line-soft,#202a48); }
.sd-row:last-child { border-bottom:0; }
.sd-row-n { flex-shrink:0; width:26px; font-size:.72rem; color:var(--ink-faint,#75809c);
  font-variant-numeric:tabular-nums; }
.sd-row-main { flex:1; min-width:0; }
.sd-row-lbl { font-size:.84rem; color:var(--ink,#eef1f8); overflow-wrap:anywhere; }
.sd-row-sub { font-size:.71rem; color:var(--ink-faint,#75809c); margin-top:1px; }
.sd-row-val { flex-shrink:0; font-size:.86rem; font-weight:700; color:var(--ink,#eef1f8);
  font-variant-numeric:tabular-nums; }
.sd-empty { padding:26px 16px; text-align:center; font-size:.82rem; color:var(--ink-faint,#75809c); }
.sd-foot { padding:9px 16px; border-top:1px solid var(--line,#2b3557);
  font-size:.74rem; color:var(--ink-soft,#aab3c8); display:flex; justify-content:space-between; gap:10px; }
@media (max-width:520px) { .sd-chip { flex:1 1 calc(50% - 8px); min-width:0; } }
`;

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// أرقامٌ لاتينية عمداً: القيم تصل جاهزةً من البوّابتين مصوغةً بـen-US، فلو
// صيغت أرقام الوحدة بـar-SY ظهر «العدد: ٣» تحت قائمةٍ قيمُها 120 و80 — نظامان
// للأرقام في نافذةٍ واحدة.
const num = (n) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : '—';

export const StatDrill = (() => {
  let overlay = null, titleEl = null, subEl = null, bodyEl = null, footEl = null;
  let lastFocus = null;

  function ensure() {
    if (overlay) return;
    const style = document.createElement('style');
    style.id = 'sd-styles';
    style.textContent = CSS;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.className = 'sd-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="sd-modal">
        <div class="sd-hdr">
          <div class="sd-hdr-txt">
            <p class="sd-title"></p>
            <p class="sd-sub"></p>
          </div>
          <button type="button" class="sd-close" aria-label="إغلاق">✕</button>
        </div>
        <div class="sd-body"></div>
        <div class="sd-foot"></div>
      </div>`;
    document.body.appendChild(overlay);

    titleEl = overlay.querySelector('.sd-title');
    subEl   = overlay.querySelector('.sd-sub');
    bodyEl  = overlay.querySelector('.sd-body');
    footEl  = overlay.querySelector('.sd-foot');

    overlay.querySelector('.sd-close').addEventListener('click', close);
    // الضغط على الخلفية يُغلق، لا على المحتوى — وإلا أُغلقت النافذة كلّما
    // حاول المستخدم تحديد نصٍّ داخلها.
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.hidden) close();
    });
  }

  /** يفتح نافذة التفصيل. rows: [{ label, value?, sub? }] */
  function open(title, subtitle, rows) {
    ensure();
    lastFocus = document.activeElement;
    titleEl.textContent = title || '';
    subEl.textContent   = subtitle || '';
    subEl.hidden        = !subtitle;

    const list = Array.isArray(rows) ? rows : [];
    bodyEl.innerHTML = list.length
      ? list.map((r, i) => `
          <div class="sd-row">
            <span class="sd-row-n">${num(i + 1)}</span>
            <div class="sd-row-main">
              <div class="sd-row-lbl">${esc(r.label)}</div>
              ${r.sub ? `<div class="sd-row-sub">${esc(r.sub)}</div>` : ''}
            </div>
            ${r.value != null && r.value !== '' ? `<span class="sd-row-val">${esc(r.value)}</span>` : ''}
          </div>`).join('')
      : '<p class="sd-empty">لا توجد عناصر لعرضها.</p>';

    // المجموع يُعلَن صراحةً: قائمةٌ طويلة تُقرأ بالتمرير، والعدد يُطمئن أنّ
    // ما ظهر هو كلّ ما عُدّ لا أوّله.
    footEl.innerHTML = `<span>العدد: <strong>${num(list.length)}</strong></span>`;
    footEl.hidden = !list.length;

    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    overlay.querySelector('.sd-close')?.focus();
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus?.isConnected) lastFocus.focus();
    lastFocus = null;
  }

  /**
   * يرسم شبكة المجموعات في حاوية.
   * groups: [{ title, items: [{ label, value, tone?, drill?: {title, subtitle, rows} }] }]
   * البند بلا drill يُعرض معطّلاً — رقمٌ لا يُفتح خلفه شيء يجب ألّا يوهم بأنه زرّ.
   */
  function grid(container, groups) {
    if (!container) return;
    ensure();
    const gs = (groups || []).filter(g => g && (g.items || []).length);
    container.innerHTML = gs.map((g, gi) => `
      <section class="sd-group">
        <p class="sd-group-title">${esc(g.title)}</p>
        <div class="sd-chips">
          ${g.items.map((it, ii) => `
            <button type="button" class="sd-chip${it.tone ? ' is-' + esc(it.tone) : ''}"
                    data-g="${gi}" data-i="${ii}"${it.drill ? '' : ' disabled'}>
              <span class="sd-chip-val">${esc(it.value)}</span>
              <span class="sd-chip-lbl">${esc(it.label)}</span>
            </button>`).join('')}
        </div>
      </section>`).join('');
    container.className = 'sd-grid';

    container.querySelectorAll('.sd-chip[data-g]').forEach(btn => {
      btn.addEventListener('click', () => {
        const it = gs[+btn.dataset.g]?.items[+btn.dataset.i];
        const d = it?.drill;
        if (!d) return;
        // rows قد تكون دالةً: التفصيل يُجلب عند الضغط لا مسبقاً، فلا تُحمَّل
        // قوائمُ لن يفتحها أحد.
        const rows = typeof d.rows === 'function' ? d.rows() : d.rows;
        open(d.title ?? it.label, d.subtitle ?? '', rows);
      });
    });
  }

  return { grid, open, close };
})();
