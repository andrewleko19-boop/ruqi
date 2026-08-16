// ─────────────────────────────────────────────────────────────────────────────
//  مراجعُ غير مُعرَّفة — فحصُ no-undef واعٍ بالنطاقات.
//
//  العلّة المتكرّرة: تُنسخ كتلةُ شيفرةٍ من بوّابةٍ إلى أخرى، فتنتقل الدوالُّ
//  ويبقى ثابتٌ تعتمد عليه خلفها. ثلاث طبقاتٍ من الفحص تمرّ عليها بلا شكوى:
//    • node --check يحلّل نحوياً فقط، والملفّ سليمٌ نحوياً.
//    • اختباراتُ الوحدة تستخرج التوابع نصّياً ثمّ تحقن الثابت بنفسها.
//    • الفحصُ الدخانيّ يفتح الصفحة، والدالّةُ لا تُنفَّذ إلا بعد تسجيل دخول.
//  فتصل العلّة إلى المستخدم كـReferenceError عند أوّل استعمالٍ حقيقيّ. وهذا
//  ما وقع بـSTAFF_TYPE_AR في لوحة الوزارة: شُحن أخضرَ، وسقط دليلُ الكادر.
//
//  المحاولة الأولى كانت بالتعابير النمطية فأطلقت عشرة إنذاراتٍ كاذبة وصفراً
//  حقيقية — ألوانٌ داخل سلاسل، وأنماطٌ داخل regex، وتصريحاتٌ لم يلتقطها
//  النمط. وحارسٌ يُنذر كذباً يُعطَّل، فيصير أسوأ من غيابه. فاستُبدل بمحلّلٍ
//  نحويّ حقيقيّ (acorn) يبني سلسلة النطاقات ويحلّ كلّ مرجعٍ فيها.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'acorn';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'school/script.js', 'teacher/script.js', 'directorate/script.js',
  'directorate/school.js', 'ministry/script.js', 'admin/script.js',
  'parent/script.js', 'verify.js',
  'shared/db.js', 'shared/stat-drill.js', 'shared/data-alerts.js',
  'shared/date-fields.js', 'shared/csel.js', 'shared/permissions.js',
  'shared/import-parser.js', 'shared/pw-toggle.js', 'shared/sw-register.js',
];

/* عوالمُ المتصفّح والمعيار. القائمة صريحةٌ لا مُستوردة: إضافةُ حزمةِ globals
   لأجل أسماء معدودة كلفةٌ بلا مقابل، والنقصُ هنا يظهر إنذاراً يُصلَح بسطر. */
const GLOBALS = new Set([
  // JS
  'globalThis','undefined','NaN','Infinity','Object','Array','String','Number','Boolean',
  'Symbol','BigInt','Math','JSON','Date','RegExp','Error','TypeError','RangeError',
  'SyntaxError','Promise','Map','Set','WeakMap','WeakSet','Proxy','Reflect','Intl',
  'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent',
  'encodeURI','decodeURI','structuredClone','queueMicrotask','Function','ArrayBuffer',
  'Uint8Array','Int8Array','Uint16Array','Uint32Array','Float32Array','Float64Array','DataView',
  // DOM / BOM
  'window','document','navigator','location','history','screen','console','alert','confirm','prompt',
  'setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame',
  'cancelAnimationFrame','fetch','Headers','Request','Response','AbortController','AbortSignal',
  'FormData','URL','URLSearchParams','Blob','File','FileReader','FileList','Image','Audio',
  'Event','CustomEvent','EventTarget','MutationObserver','IntersectionObserver','ResizeObserver',
  'localStorage','sessionStorage','indexedDB','IDBKeyRange','crypto','performance','matchMedia',
  'getComputedStyle','scrollTo','open','close','postMessage','atob','btoa','TextEncoder','TextDecoder',
  'Node','Element','HTMLElement','HTMLInputElement','HTMLSelectElement','DocumentFragment',
  'DOMParser','XMLSerializer','CSS','Notification','ServiceWorker','ServiceWorkerRegistration',
  'createImageBitmap','ImageBitmap','OffscreenCanvas',
  'BroadcastChannel','Worker','WebSocket','MessageChannel','ReadableStream','TransformStream',
  // Service-worker
  'self','caches','clients','skipWaiting','registration','importScripts',
  'Option','HTMLOptionElement','HTMLTableElement','HTMLFormElement','HTMLImageElement',
  // مكتبات خارجية تُحمَّل بوسم <script> قبل ملفّاتنا
  'L','Chart','XLSX','ExcelJS','supabase',
  /* عوالمُ التطبيق نفسه: shared/db.js وshared/permissions.js تُحمَّلان كوحدتين
     وتنشران واجهتَيهما على window، فتراهما البوّاباتُ أسماءً عامّة. */
  'RUQI_DB','RUQI_PERMISSIONS',
]);

/** أسماء المُعرِّفات داخل نمطِ ربطٍ (تفكيك، افتراضي، بقيّة…). */
function patternNames(node, out = []) {
  if (!node) return out;
  switch (node.type) {
    case 'Identifier': out.push(node.name); break;
    case 'ObjectPattern': node.properties.forEach(p =>
      patternNames(p.type === 'RestElement' ? p.argument : p.value, out)); break;
    case 'ArrayPattern': node.elements.forEach(e => patternNames(e, out)); break;
    case 'AssignmentPattern': patternNames(node.left, out); break;
    case 'RestElement': patternNames(node.argument, out); break;
  }
  return out;
}

const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const isScope = (n) => FN.has(n.type) || n.type === 'Program' ||
  n.type === 'BlockStatement' || n.type === 'ForStatement' ||
  n.type === 'ForInStatement' || n.type === 'ForOfStatement' ||
  n.type === 'CatchClause' || n.type === 'ClassBody';

/** يجمع الروابط المُصرَّح بها مباشرةً في نطاقٍ (بلا نزولٍ إلى نطاقٍ متداخل). */
function declaredIn(scopeNode) {
  const names = new Set();
  const add = (n) => n && names.add(n);

  if (FN.has(scopeNode.type)) {
    scopeNode.params.forEach(p => patternNames(p).forEach(add));
    if (scopeNode.id) add(scopeNode.id.name);
  }
  if (scopeNode.type === 'CatchClause') patternNames(scopeNode.param).forEach(add);

  const body = scopeNode.type === 'Program' ? scopeNode.body
    : FN.has(scopeNode.type) ? (scopeNode.body.type === 'BlockStatement' ? scopeNode.body.body : [])
    : scopeNode.body ?? [];
  const stmts = Array.isArray(body) ? body : [body];

  // var يرتفع إلى أقرب نطاق دالّة، فيُجمع بمسحٍ عميقٍ يتوقّف عند حدود الدوالّ.
  const hoistVars = (nodes) => {
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue;
      if (FN.has(n.type)) { if (n.id) add(n.id.name); continue; }
      if (n.type === 'VariableDeclaration' && n.kind === 'var')
        n.declarations.forEach(d => patternNames(d.id).forEach(add));
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) hoistVars(v.filter(x => x && typeof x.type === 'string'));
        else if (v && typeof v.type === 'string') hoistVars([v]);
      }
    }
  };
  if (FN.has(scopeNode.type) || scopeNode.type === 'Program') hoistVars(stmts);

  for (let n of stmts) {
    if (!n) continue;
    // export const X = … يلفّ التصريحَ، فبدون فكّ اللفّ يبدو X غيرَ مُعرَّف.
    if (n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') {
      if (!n.declaration) continue;
      n = n.declaration;
    }
    if (n.type === 'VariableDeclaration') n.declarations.forEach(d => patternNames(d.id).forEach(add));
    else if (n.type === 'FunctionDeclaration' && n.id) add(n.id.name);
    else if (n.type === 'ClassDeclaration' && n.id) add(n.id.name);
    else if (n.type === 'ImportDeclaration') n.specifiers.forEach(s => add(s.local.name));
  }

  /* حلقةُ for تُصرّح في init لا في left — وleft لحلقتَي for-of/for-in وحدهما.
     الخلطُ بينهما كان يُظهر كلّ عدّادٍ (i، j، d) مرجعاً بلا تعريف. */
  if (scopeNode.type === 'ForStatement' && scopeNode.init?.type === 'VariableDeclaration')
    scopeNode.init.declarations.forEach(d => patternNames(d.id).forEach(add));
  if ((scopeNode.type === 'ForOfStatement' || scopeNode.type === 'ForInStatement')
      && scopeNode.left?.type === 'VariableDeclaration')
    scopeNode.left.declarations.forEach(d => patternNames(d.id).forEach(add));

  return names;
}

/** يمشي الشجرة حاملاً سلسلة النطاقات، ويُبلغ عن كلّ مرجعٍ لا يُحَلّ. */
function findUndeclared(ast, src) {
  const problems = [];
  const walk = (node, chain, parent) => {
    if (!node || typeof node.type !== 'string') return;
    // import.meta وnew.target: كلمتاهما مفتاحيّتان لا مرجعان.
    if (node.type === 'MetaProperty') return;

    const nextChain = isScope(node) ? [...chain, declaredIn(node)] : chain;

    if (node.type === 'Identifier') {
      // مفتاحُ خاصّية، أو خاصّيةُ عضوٍ غير محسوبة، أو تسمية — ليست مرجعاً.
      const asKey = parent?.type === 'Property' && parent.key === node && !parent.computed;
      const asMember = parent?.type === 'MemberExpression' && parent.property === node && !parent.computed;
      const asLabel = parent?.type === 'LabeledStatement' || parent?.type === 'BreakStatement'
                   || parent?.type === 'ContinueStatement';
      const asImportKey = parent?.type === 'ImportSpecifier' && parent.imported === node;
      const asExportKey = parent?.type === 'ExportSpecifier';
      const asClassKey  = parent?.type === 'PropertyDefinition' && parent.key === node && !parent.computed;
      const asMethodKey = parent?.type === 'MethodDefinition' && parent.key === node && !parent.computed;
      if (!asKey && !asMember && !asLabel && !asImportKey && !asExportKey && !asClassKey && !asMethodKey) {
        const name = node.name;
        if (!GLOBALS.has(name) && !nextChain.some(s => s.has(name))) {
          problems.push({ name, line: src.slice(0, node.start).split('\n').length });
        }
      }
      return;
    }

    for (const key of Object.keys(node)) {
      if (key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach(c => walk(c, nextChain, node));
      else if (v && typeof v.type === 'string') walk(v, nextChain, node);
    }
  };
  walk(ast, [], null);
  return problems;
}

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let total = 0;

for (const rel of FILES) {
  let src;
  try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }

  let ast;
  try {
    ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  } catch (e) {
    console.log(`${RED}✗ ${rel} — تعذّر التحليل:${RESET} ${e.message.slice(0, 90)}`);
    total++; continue;
  }

  // يُبلَّغ عن كل اسمٍ مرّةً واحدة بأوّل سطرٍ ذُكر فيه — تكرارُه ضجيج.
  const seen = new Map();
  for (const p of findUndeclared(ast, src)) if (!seen.has(p.name)) seen.set(p.name, p.line);

  if (seen.size) {
    total += seen.size;
    console.log(`${RED}✗ ${rel}${RESET}`);
    for (const [name, line] of [...seen].sort((a, b) => a[1] - b[1])) {
      console.log(`   ${RED}${name}${RESET} ${DIM}— مرجعٌ بلا تعريف (سطر ${line})${RESET}`);
    }
  } else {
    console.log(`${GREEN}✓${RESET} ${DIM}${rel}${RESET}`);
  }
}

console.log(total
  ? `\n${RED}${total} مرجعاً بلا تعريف${RESET}`
  : `\n${GREEN}كل المراجع مُعرَّفة${RESET}`);
process.exit(total ? 1 : 0);
