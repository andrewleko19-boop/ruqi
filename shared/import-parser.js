/* Ruqi — محرّك الاستيراد المشترك: قراءة ملفّ، مطابقة أعمدة، تحليل متسامح.
 *
 * سكربت كلاسيكي (لا وحدة ES) على نمط shared/qr.js، يُصدِّر
 * window.RUQI_ImportParser. لا يعتمد على DOM ولا على Supabase ولا يعرف من
 * سيكتب البيانات لاحقاً — يبني فقط صفوفاً مُطابَقة جاهزة للتحقّق، فيصلح لأي
 * بوابة تستدعيه.
 *
 * لماذا التسامح كلّه هنا لا في الواجهة: الملفّات تأتي من مدارس مختلفة بعناوين
 * غير موحّدة (اسم الطالب / الاسم / الاسم الأول)، وبأرقام عربية-هندية، وبصيغ
 * تاريخ متعدّدة. من يستعمل الأداة موظّف غير تقنيّ، فالمطلوب أن يقرأ النظام
 * ملفّه كما هو لا أن يطالبه بإعادة تنسيقه.
 */
(function () {
  'use strict';

  // ── تطبيع النصّ ──────────────────────────────────────────────────────────

  const AR_DIGITS = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
                      '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9' };

  function normalizeArabicDigits(s) {
    return String(s ?? '').replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] ?? d);
  }

  /* تطبيع **للمطابقة فقط**: يُوحّد أشكال الألف والتاء المربوطة ويحذف التشكيل
     والتطويل. لا يُستعمل أبداً على قيمة تُحفَظ في القاعدة — «هبة» و«هبه» اسمان
     مختلفان وإن تطابقا هنا. */
  function normalizeArabicText(s) {
    return String(s ?? '')
      .replace(/[ً-ْـ]/g, '')     // تشكيل + تطويل
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[()（）\[\]{}«»"'.,:;_\-–—/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normGender(v) {
    const s = normalizeArabicText(normalizeArabicDigits(v));
    if (!s) return '';
    if (['male', 'm', 'ذكر', 'ولد', 'ذ'].includes(s)) return 'male';
    if (['female', 'f', 'انثي', 'انثه', 'بنت', 'ا'].includes(s)) return 'female';
    // «أنثى» بعد التطبيع تصير «انثي»؛ نُبقي فحصاً احتياطياً على النصّ الخام.
    const raw = String(v ?? '').trim();
    if (['أنثى', 'انثى', 'أنثي'].includes(raw)) return 'female';
    if (raw === 'ذكر') return 'male';
    return '';
  }

  const ORDINALS = {
    'تحضيري': 0, 'روضه': 0, 'رياض': 0,
    'الاول': 1, 'اول': 1, 'الثاني': 2, 'ثاني': 2, 'الثالث': 3, 'ثالث': 3,
    'الرابع': 4, 'رابع': 4, 'الخامس': 5, 'خامس': 5, 'السادس': 6, 'سادس': 6,
    'السابع': 7, 'سابع': 7, 'الثامن': 8, 'ثامن': 8, 'التاسع': 9, 'تاسع': 9,
    'العاشر': 10, 'عاشر': 10,
    'الحادي عشر': 11, 'حادي عشر': 11, 'الثاني عشر': 12, 'ثاني عشر': 12,
  };

  function ordinalWordToNumber(s) {
    const k = normalizeArabicText(s).replace(/^الصف\s+/, '');
    return Object.prototype.hasOwnProperty.call(ORDINALS, k) ? ORDINALS[k] : null;
  }

  // ── تحليل التاريخ ────────────────────────────────────────────────────────

  function pad2(n) { return String(n).padStart(2, '0'); }

  function fromParts(y, m, d) {
    const yr = Number(y), mo = Number(m), dy = Number(d);
    const nowYear = new Date().getFullYear();
    if (!(yr >= 1900 && yr <= nowYear)) return null;
    if (!(mo >= 1 && mo <= 12) || !(dy >= 1 && dy <= 31)) return null;
    /* فحص التقويم الحقيقي: «٣١ شباط» يجتاز فحص المدى أعلاه لكنه ليس تاريخاً.
       بدونه يمرّ الصفّ إلى القاعدة فيفشل الإدراج بخطأ Postgres غامض على الدفعة
       كلّها، بدل رسالةٍ عربية تشير إلى السطر وتُصلَح في ثانية. */
    const probe = new Date(Date.UTC(yr, mo - 1, dy));
    if (probe.getUTCFullYear() !== yr || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== dy) {
      return null;
    }
    return `${yr}-${pad2(mo)}-${pad2(dy)}`;
  }

  /* يُرجِع { value, error }. الخطأ نصّ عربي جاهز للعرض لا استثناء — السطر
     الواحد الفاسد لا يوقف الملفّ، يُعرض سببه ويُصلحه المستخدم. */
  function parseTolerantDate(v) {
    if (v == null || v === '') return { value: null, error: null };

    // ExcelJS يُرجِع Date حقيقياً للخلايا المنسَّقة كتاريخ — أوثق من أي نصّ.
    if (v instanceof Date && !isNaN(v)) {
      const out = fromParts(v.getFullYear(), v.getMonth() + 1, v.getDate());
      return out ? { value: out, error: null }
                 : { value: null, error: `تاريخ خارج المدى: «${v.toISOString().slice(0, 10)}»` };
    }

    const s = normalizeArabicDigits(String(v)).trim();
    if (!s) return { value: null, error: null };

    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
      const out = fromParts(m[1], m[2], m[3]);
      return out ? { value: out, error: null } : { value: null, error: `تاريخ غير صالح: «${s}»` };
    }
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
      const out = fromParts(m[3], m[2], m[1]);
      return out ? { value: out, error: null } : { value: null, error: `تاريخ غير صالح: «${s}»` };
    }
    return { value: null, error: `صيغة التاريخ غير مفهومة: «${s}» — استعمل مثلاً 2010-05-21` };
  }

  // ── مطابقة العناوين ──────────────────────────────────────────────────────

  function levenshtein(a, b) {
    a = String(a); b = String(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /* ثلاث درجات: تطابق تام → احتواء → تقريبي.
     التقريبي **لا يُقبل تلقائياً أبداً** — يُعرض اقتراحاً في خطوة المطابقة
     اليدوية ليؤكّده إنسان. مطابقة خاطئة صامتة أسوأ بكثير من نقرة تأكيد. */
  function matchHeaders(headers, schema) {
    const norm = headers.map(normalizeArabicText);
    const mapping = {}, confidence = {};
    const missingRequired = [], ambiguous = [];

    for (const field of schema) {
      const aliases = field.aliases.map(normalizeArabicText);
      const exact = [], contains = [], fuzzy = [];

      norm.forEach((h, i) => {
        if (!h) return;
        if (aliases.includes(h)) { exact.push(i); return; }
        if (aliases.some(a => a.length >= 3 && (h.includes(a) || a.includes(h)))) {
          contains.push(i); return;
        }
        const best = Math.min(...aliases.map(a => levenshtein(h, a) / Math.max(h.length, a.length)));
        if (best <= 0.25) fuzzy.push(i);
      });

      if (exact.length === 1)          { mapping[field.key] = exact[0];    confidence[field.key] = 'exact'; }
      else if (exact.length > 1)       { mapping[field.key] = exact[0];    confidence[field.key] = 'exact'; ambiguous.push(field.key); }
      else if (contains.length === 1)  { mapping[field.key] = contains[0]; confidence[field.key] = 'contains'; }
      else if (contains.length > 1)    { mapping[field.key] = contains[0]; confidence[field.key] = 'contains'; ambiguous.push(field.key); }
      else if (fuzzy.length >= 1)      { mapping[field.key] = fuzzy[0];    confidence[field.key] = 'fuzzy'; ambiguous.push(field.key); }
      else                             { mapping[field.key] = null;        confidence[field.key] = null; }

      if (field.required && mapping[field.key] == null) missingRequired.push(field.key);
    }

    // عمود واحد لا يخدم حقلين — الأعلى ثقةً يحتفظ به والباقي يُفرَّغ للمطابقة اليدوية.
    const RANK = { exact: 3, contains: 2, fuzzy: 1 };
    const byCol = {};
    for (const k of Object.keys(mapping)) {
      const c = mapping[k];
      if (c == null) continue;
      (byCol[c] = byCol[c] || []).push(k);
    }
    for (const col of Object.keys(byCol)) {
      const keys = byCol[col];
      if (keys.length < 2) continue;
      keys.sort((x, y) => (RANK[confidence[y]] || 0) - (RANK[confidence[x]] || 0));
      keys.slice(1).forEach(k => {
        mapping[k] = null; confidence[k] = null;
        if (!ambiguous.includes(k)) ambiguous.push(k);
      });
    }
    for (const field of schema) {
      if (field.required && mapping[field.key] == null && !missingRequired.includes(field.key)) {
        missingRequired.push(field.key);
      }
    }

    return { mapping, confidence, missingRequired, ambiguous };
  }

  function applyMapping(headers, rows, mapping) {
    const keys = Object.keys(mapping);
    return rows.map(r => {
      const o = {};
      for (const k of keys) {
        const i = mapping[k];
        o[k] = (i == null) ? '' : (r[i] ?? '');
      }
      return o;
    });
  }

  // ── قراءة الملفّ ─────────────────────────────────────────────────────────

  /* محلّل CSV يدوي (منقول كما هو من school/script.js): يتعامل مع الحقول
     المُقتبَسة والفواصل داخلها و CRLF. لا مكتبة — الحاجة أبسط من إضافة تبعية. */
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  let _excelJs = null;
  function loadExcelJS() {
    if (_excelJs) return _excelJs;
    _excelJs = new Promise((resolve, reject) => {
      if (window.ExcelJS) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      /* SRI: شيفرةٌ من طرفٍ ثالث تُحقن في صفحةٍ فيها جلسةُ المستخدم. بلا بصمةٍ
         يكفي اختراقُ الـCDN — أو نشرُ نسخةٍ خبيثةٍ تحت الوسم نفسه — ليُنفَّذ
         عندنا ما شاء. مع البصمة يُرفض المحتوى المخالف قبل تنفيذ حرفٍ منه. */
      s.integrity   = 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz';
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = () => resolve();
      s.onerror = () => { _excelJs = null; reject(new Error('تعذّر تحميل مكتبة قراءة Excel — تحقّق من الاتصال.')); };
      document.head.appendChild(s);
    });
    return _excelJs;
  }

  function cellToString(v) {
    if (v == null) return '';
    if (v instanceof Date) {
      return isNaN(v) ? '' : `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
    }
    if (typeof v === 'object') {
      if (Array.isArray(v.richText)) return v.richText.map(t => t.text ?? '').join('');
      if ('result' in v) return cellToString(v.result);      // خلية صيغة
      if ('text' in v)   return String(v.text);              // ارتباط تشعّبي
      return '';
    }
    return String(v);
  }

  async function readFile(file) {
    const name = (file?.name || '').toLowerCase();
    let rows;

    if (name.endsWith('.csv')) {
      rows = parseCSV(await file.text());
    } else {
      // التفرّع على الامتداد لا على file.type: المتصفّحات غير متّسقة في نوع
      // ملفّات xlsx، وبعضها يُرجِعه فارغاً.
      await loadExcelJS();
      const wb = new window.ExcelJS.Workbook();
      try {
        await wb.xlsx.load(await file.arrayBuffer());
      } catch {
        throw new Error('تعذّرت قراءة الملفّ — تأكّد أنه ملفّ Excel أو CSV صالح.');
      }
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('الملفّ لا يحتوي أي ورقة بيانات.');
      rows = [];
      ws.eachRow({ includeEmpty: false }, (r) => {
        const out = [];
        // r.values مصفوفة بفهرسة تبدأ من ١ — العنصر ٠ دائماً فارغ.
        const vals = r.values || [];
        for (let i = 1; i < vals.length; i++) out.push(cellToString(vals[i]));
        if (out.some(c => c.trim() !== '')) rows.push(out);
      });
    }

    if (!rows.length) throw new Error('الملفّ فارغ.');
    if (rows.length < 2) throw new Error('الملفّ يحتوي صفّ العناوين فقط — لا بيانات بعده.');

    const headers = rows[0].map(h => String(h ?? '').trim());
    return { headers, rows: rows.slice(1) };
  }

  window.RUQI_ImportParser = {
    readFile, parseCSV, loadExcelJS,
    matchHeaders, applyMapping,
    normalizeArabicDigits, normalizeArabicText, normGender,
    parseTolerantDate, ordinalWordToNumber, levenshtein,
  };
})();
