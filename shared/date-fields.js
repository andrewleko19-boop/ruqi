// ─────────────────────────────────────────────────────────────────────────────
//  حقل تاريخٍ من ثلاث خانات: يوم · شهر · سنة.
//
//  لماذا لا <input type="date">: منتقي التاريخ الأصليّ يتبع لغة النظام، فيقرأ
//  جهازٌ مضبوطٌ على الإنجليزية «8/12/2026» شهراً/يوماً — فمن كتب ٨ كانون الأول
//  حُفظ له ١٢ آب. تاريخٌ خاطئ يُحفظ **بصمت** بلا تنبيه، ولا يُكتشف إلا بعد
//  أشهر في وثيقةٍ رسمية. والخانات الثلاث المعنونة بالعربية لا تحتمل هذا اللبس.
//
//  وهو أيضاً أسرع على الجوّال: ثلاث لمسات رقمية بدل فتح تقويمٍ والتنقّل فيه
//  إلى سنةِ مباشرةٍ قديمة — وأكثرُ حقول التكليف تواريخُ سنينَ مضت.
//
//  النمط مأخوذ من نافذة العطل في لوحة المشرف بعد أن أثبت نفسه، ومنقولٌ هنا
//  ليُستعمل في التكاليف وسجلّ الكوادر بدل نسخه خمس مرّات.
// ─────────────────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');

/**
 * يبني ثلاث خانات داخل حاوية.
 * @param {HTMLElement} host  عنصرٌ فارغ يُملأ بالخانات
 * @param {string} idBase     يُشتقّ منه معرّف كل خانة: `${idBase}-d|m|y`
 * @param {string} label      يُستعمل في aria-label لتمييز الحقل عن غيره
 */
export function buildDateFields(host, idBase, label = '') {
  if (!host) return null;
  const suffix = label ? ` — ${label}` : '';
  host.classList.add('dmy-row');
  host.innerHTML = `
    <input id="${idBase}-d" type="text" inputmode="numeric" maxlength="2"
           placeholder="يوم"  aria-label="اليوم${suffix}" />
    <input id="${idBase}-m" type="text" inputmode="numeric" maxlength="2"
           placeholder="شهر"  aria-label="الشهر${suffix}" />
    <input id="${idBase}-y" type="text" inputmode="numeric" maxlength="4"
           placeholder="سنة"  aria-label="السنة${suffix}" class="dmy-year" />`;

  const d = host.querySelector(`#${CSS.escape(idBase)}-d`);
  const m = host.querySelector(`#${CSS.escape(idBase)}-m`);
  const y = host.querySelector(`#${CSS.escape(idBase)}-y`);

  // الانتقال التلقائي وحصرُ الإدخال بالأرقام. يُطبَّق على الثلاث كي لا تتسرّب
  // حروفٌ إلى خانة السنة، وهي التي لا تنتقل بعدها.
  for (const [from, to] of [[d, m], [m, y], [y, null]]) {
    from.addEventListener('input', () => {
      from.value = from.value.replace(/[^0-9]/g, '');
      if (to && from.value.length >= 2) to.focus();
    });
  }
  return { d, m, y };
}

/** يملأ الخانات من تاريخ ISO (أو يُفرغها إن كان فارغاً). */
export function setDateFields(idBase, iso) {
  const d = document.getElementById(`${idBase}-d`);
  const m = document.getElementById(`${idBase}-m`);
  const y = document.getElementById(`${idBase}-y`);
  if (!d || !m || !y) return;
  const s = String(iso ?? '').trim();
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!parts) { d.value = ''; m.value = ''; y.value = ''; return; }
  y.value = parts[1];
  m.value = String(Number(parts[2]));
  d.value = String(Number(parts[3]));
}

/**
 * يقرأ الخانات ويعيد تاريخاً بصيغة ISO.
 * @returns {{ok:true, value:string|null} | {ok:false, error:string}}
 *   value = null يعني «تُرك فارغاً» — وهو مقبولٌ في الحقول الاختيارية،
 *   بخلاف «مملوءٌ جزئياً» الذي يُرفض: يومٌ بلا سنةٍ ليس تاريخاً ولا فراغاً.
 */
export function readDateFields(idBase, label = 'التاريخ') {
  const dEl = document.getElementById(`${idBase}-d`);
  const mEl = document.getElementById(`${idBase}-m`);
  const yEl = document.getElementById(`${idBase}-y`);
  if (!dEl || !mEl || !yEl) return { ok: true, value: null };

  const raw = [dEl.value, mEl.value, yEl.value].map(v => String(v ?? '').trim());
  if (raw.every(v => v === '')) return { ok: true, value: null };
  if (raw.some(v => v === '')) {
    return { ok: false, error: `${label}: أكمل اليوم والشهر والسنة أو اتركها فارغةً كلّها.` };
  }

  const [d, m, y] = raw.map(v => parseInt(v, 10));
  if (![d, m, y].every(Number.isInteger)) {
    return { ok: false, error: `${label}: أرقامٌ غير صالحة.` };
  }
  if (y < 1940 || y > 2100) {
    return { ok: false, error: `${label}: السنة خارج المدى المقبول (1940–2100).` };
  }
  if (m < 1 || m > 12) return { ok: false, error: `${label}: الشهر بين 1 و 12.` };
  if (d < 1 || d > 31) return { ok: false, error: `${label}: اليوم بين 1 و 31.` };

  // الفحص الحقيقيّ: JS يلتفّ على ٣١ شباط فيجعله ٣ آذار بلا اعتراض. المقارنة
  // بعد البناء تكشف الالتفاف فيُرفض التاريخ بدل أن يُحفظ يوماً آخر.
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return { ok: false, error: `${label}: لا وجود لهذا اليوم في هذا الشهر.` };
  }
  return { ok: true, value: `${y}-${pad(m)}-${pad(d)}` };
}
