// makefun-site's template dialect (the reference's lib/template.js): {{ path }} escaped, {{{ path }}} raw,
// {% for %}, {% if %}/{% if not %}, {% include "name" %} at most 8 deep, and a {% %} tag alone on its
// line takes the whole line with it. Parsing is the reference's own (same tokens, same tree, same
// TemplateError messages); rendering is compiled: each parsed tree becomes a generated function that
// pushes into an output array, instead of a walk over nodes per render.

/** The deepest an include nests: one past it renders nothing. */
export const INCLUDE_DEPTH = 8;

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

/** A template that does not parse: its name and why. */
export class TemplateError extends Error {}

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
export function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** The value at `path` in the scope chain: its first name from the nearest scope holding it, then own properties. */
export function lookup(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
export function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
export function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** The key part for one name's binding in `scope`: its value's identity, or its primitive value. */
function bindingKey(ctx, scope, name) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, name)) s = s.parent;
  if (s === null) return 'u';
  const v = s.vars[name];
  if (v === undefined || v === null) return 'u';
  if (typeof v === 'object' || typeof v === 'function') {
    let id = ctx.ids.get(v);
    if (id === undefined) {
      id = ctx.nextId++;
      ctx.ids.set(v, id);
    }
    return `o${id}`;
  }
  return `p${typeof v}:${String(v)}`;
}

/**
 * An {% include %} rendered: when the included template's output can only depend on the bindings its
 * free reads name (the analyzer proved the list) and the include-depth cap cannot bind anywhere inside
 * it at this depth, the rendered text is memoised on those bindings' identities for the whole build —
 * a card partial inside a posts loop is rendered once per post, not once per appearance. Anything else
 * renders directly, exactly as the reference's renderNodes renders it.
 */
function include(ctx, name, scope, depth, out, freeReads) {
  const t = ctx.templates.get(name);
  if (t === undefined || depth >= INCLUDE_DEPTH) return;
  if (freeReads !== null && depth + (ctx.heights.get(name) ?? 0) <= INCLUDE_DEPTH) {
    let key = name;
    for (let i = 0; i < freeReads.length; i++) key += `\x00${bindingKey(ctx, scope, freeReads[i])}`;
    let hit = ctx.memo.get(key);
    if (hit === undefined) {
      const tmp = [];
      t(scope, ctx, depth + 1, tmp);
      hit = tmp.join('');
      ctx.memo.set(key, hit);
    }
    out.push(hit);
    return;
  }
  t(scope, ctx, depth + 1, out);
}

const RT = Object.freeze({ lookup, textOf, truthy, include });

/** The generated statements for one node list, reading variables through the scope variable `sv`. */
function genNodes(nodes, sv, depth, lines, counter, bound, resolveInclude) {
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        lines.push(`out.push(${JSON.stringify(n.text)});`);
        break;
      case 'var':
        lines.push(`out.push(ctx.escape(rt.textOf(rt.lookup(${sv}, ${JSON.stringify(n.path)}))));`);
        break;
      case 'raw':
        lines.push(`out.push(rt.textOf(rt.lookup(${sv}, ${JSON.stringify(n.path)})));`);
        break;
      case 'if': {
        lines.push(`if (rt.truthy(rt.lookup(${sv}, ${JSON.stringify(n.path)})) !== ${n.not}) {`);
        genNodes(n.then, sv, depth, lines, counter, bound, resolveInclude);
        if (n.else !== null) {
          lines.push('} else {');
          genNodes(n.else, sv, depth, lines, counter, bound, resolveInclude);
        }
        lines.push('}');
        break;
      }
      case 'for': {
        const id = counter.n++;
        const xs = `xs${id}`;
        const child = `s${depth + 1}_${id}`;
        const innerBound = new Set(bound);
        innerBound.add(n.name);
        innerBound.add('loop');
        lines.push(`{ const ${xs} = rt.lookup(${sv}, ${JSON.stringify(n.path)});`);
        lines.push(`if (Array.isArray(${xs})) {`);
        lines.push(`for (let k${id} = 0; k${id} < ${xs}.length; k${id}++) {`);
        lines.push(`const vars${id} = {}; vars${id}[${JSON.stringify(n.name)}] = ${xs}[k${id}]; vars${id}.loop = { index: k${id} + 1, first: k${id} === 0, last: k${id} === ${xs}.length - 1, length: ${xs}.length };`);
        lines.push(`const ${child} = { vars: vars${id}, parent: ${sv} };`);
        genNodes(n.body, child, depth + 1, lines, counter, innerBound, resolveInclude);
        lines.push('}}}');
        break;
      }
      case 'include': {
        // The dependency list is a property of the included template alone (its reads that no loop
        // inside it binds); what the enclosing template's loops bind at this site are runtime inputs
        // whose identities the memo key reads from the scope, not compile-time satisfactions.
        const reads = resolveInclude(n.name);
        if (reads === null) lines.push(`{ const f = ctx.templates.get(${JSON.stringify(n.name)}); if (f !== undefined && depth < ${INCLUDE_DEPTH}) f(${sv}, ctx, depth + 1, out); }`);
        else lines.push(`rt.include(ctx, ${JSON.stringify(n.name)}, ${sv}, depth, out, ${JSON.stringify(reads)});`);
        break;
      }
    }
  }
}

/**
 * A parsed template compiled to a render function (scope, ctx, depth, out): the same output as walking
 * the tree with the reference's renderNodes, with the walk unrolled into straight-line code.
 * `resolveInclude(name, bound)` gives an include site's free reads for memoisation, or null to render
 * the include directly.
 */
export function compileTemplate(nodes, resolveInclude) {
  const lines = [];
  genNodes(nodes, 'scope', 0, lines, { n: 0 }, new Set(), resolveInclude);
  const fn = new Function('scope', 'ctx', 'depth', 'out', 'rt', lines.join('\n'));
  return (scope, ctx, depth, out) => fn(scope, ctx, depth, out, RT);
}

/** One node list's reads and include sites, given the names its enclosing loops bind. */
function analyzeNodes(nodes, bound, info) {
  for (const n of nodes) {
    switch (n.kind) {
      case 'var':
      case 'raw':
        if (!bound.has(n.path[0])) info.reads.add(n.path[0]);
        break;
      case 'if':
        if (!bound.has(n.path[0])) info.reads.add(n.path[0]);
        analyzeNodes(n.then, bound, info);
        if (n.else !== null) analyzeNodes(n.else, bound, info);
        break;
      case 'for': {
        if (!bound.has(n.path[0])) info.reads.add(n.path[0]);
        const inner = new Set(bound);
        inner.add(n.name);
        inner.add('loop');
        analyzeNodes(n.body, inner, info);
        break;
      }
      case 'include':
        info.includes.push({ name: n.name, bound });
        break;
      default:
        break;
    }
  }
}

/**
 * The include analysis over all of a build's parsed templates: for each template, its include height
 * (the deepest an include inside it can nest; Infinity when includes cycle), and a resolver giving the
 * free reads of an included template at a site whose enclosing loops bind `bound` — the names whose
 * bindings, together with the build-constant root values, decide the included template's output — or
 * null when the include graph cycles there and no such list exists.
 */
export function makeAnalyzer(parsed) {
  const readsMemo = new Map();
  const heightMemo = new Map();

  function freeReads(name, bound, stack) {
    if (stack.has(name)) return null;
    const key = `${name}\x00${[...bound].sort().join('\x00')}`;
    if (readsMemo.has(key)) return readsMemo.get(key);
    const nodes = parsed.get(name);
    if (nodes === undefined) return [];
    const info = { reads: new Set(), includes: [] };
    analyzeNodes(nodes, bound, info);
    const reads = new Set(info.reads);
    let ok = true;
    stack.add(name);
    for (const site of info.includes) {
      const sub = freeReads(site.name, site.bound, stack);
      if (sub === null) {
        ok = false;
        break;
      }
      for (const r of sub) reads.add(r);
    }
    stack.delete(name);
    const out = ok ? [...reads] : null;
    readsMemo.set(key, out);
    return out;
  }

  function directIncludes(nodes) {
    const info = { reads: new Set(), includes: [] };
    analyzeNodes(nodes, new Set(), info);
    return info.includes.map((s) => s.name);
  }

  function heightOf(name, stack) {
    if (!parsed.has(name)) return 0;
    if (heightMemo.has(name)) return heightMemo.get(name);
    if (stack.has(name)) return Infinity;
    stack.add(name);
    let h = 0;
    for (const inc of directIncludes(parsed.get(name))) h = Math.max(h, 1 + heightOf(inc, stack));
    stack.delete(name);
    heightMemo.set(name, h);
    return h;
  }

  const heights = new Map();
  for (const name of parsed.keys()) heights.set(name, heightOf(name, new Set()));

  return {
    heights,
    resolveInclude: (name) => freeReads(name, new Set(), new Set()),
  };
}
