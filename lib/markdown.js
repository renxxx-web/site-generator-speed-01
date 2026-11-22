// makefun-site's Markdown (the reference's lib/markdown.js): its own subset — ATX headings, fenced code,
// thematic breaks, blockquotes, flat lists and paragraphs; inline code spans, strong, emphasis, links and
// backslash escapes. Written as one fused pass over the body's lines (no token list, no intermediate
// objects), with the reference's per-line regular expressions replaced by hand scanners of the same
// accept/reject behaviour, and the inline renderer a single index-based pass that escapes as it goes
// instead of slicing and re-scanning plain runs.

import { escapeHtml, slugify, uniqueSlug } from './text.js';

/** Whether `line` is blank: spaces and tabs only. */
function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** The language of a fence-opening line ("" when it has none), or null when the line opens no fence. */
function fenceLang(line) {
  if (!line.startsWith('```')) return null;
  let i = 3;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  const lang = line.slice(3, i);
  for (; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return null;
  }
  return lang;
}

/** Whether `line` closes a fence: three backticks, then spaces or tabs only. */
function isFenceClose(line) {
  if (!line.startsWith('```')) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A heading line's level and text, or null (a heading's text is never empty). */
function headingOf(line) {
  let n = 0;
  while (n < line.length && line[n] === '#') n++;
  if (n === 0 || n > 6) return null;
  if (n >= line.length || (line[n] !== ' ' && line[n] !== '\t')) return null;
  let start = n;
  while (start < line.length && (line[start] === ' ' || line[start] === '\t')) start++;
  let end = line.length;
  while (end > start && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;
  if (end === start) return null;
  return { depth: n, text: line.slice(start, end) };
}

/** Whether `line` is a thematic break: "---" or "***", then spaces or tabs only. */
function isHr(line) {
  if (!line.startsWith('---') && !line.startsWith('***')) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A bullet item's text when `line` opens one ("- " or "* "), else null. */
function bulletText(line) {
  return (line[0] === '-' || line[0] === '*') && line[1] === ' ' ? line.slice(2) : null;
}

/** An ordered item's { number, text } when `line` opens one (1-9 digits, ". "), else null. */
function orderedText(line) {
  let i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c >= 48 && c <= 57) i++;
    else break;
  }
  if (i === 0 || i > 9) return null;
  if (line[i] !== '.' || line[i + 1] !== ' ') return null;
  return { number: Number(line.slice(0, i)), text: line.slice(i + 2) };
}

/** Whether `line` continues a list item: two or more spaces, then a non-space character. */
function isContinued(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  if (i < 2 || i >= line.length) return false;
  const c = line.charCodeAt(i);
  return !(c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff);
}

/** Whether `line` ends a paragraph: a blank line, a fence, a heading or a thematic break. */
function endsParagraph(line) {
  return isBlank(line) || fenceLang(line) !== null || headingOf(line) !== null || isHr(line);
}

/** A paragraph line as it is rendered: spaces and tabs at either end dropped. */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line[a] === ' ' || line[a] === '\t')) a++;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b--;
  return line.slice(a, b);
}

/** The characters a backslash escapes. */
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

const WS = /\s/;
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** The characters where the reference's per-character walk can emit something other than the character. */
const INLINE_SPECIAL = /[\\`*&<>"'\[]/g;

/**
 * `s` rendered inline; `env.link(target)` is a link's href. The scan jumps from one special character
 * to the next (the engine's regex search skips the plain runs between them); a plain run is copied
 * verbatim, and a special character is handled exactly as the reference's walk handles it — a failed
 * construct leaves its characters in the run and the scan moves past them.
 */
export function inline(s, env) {
  const out = [];
  const n = s.length;
  let i = 0;
  let seg = 0;
  const flush = (upto) => {
    if (upto > seg) out.push(s.slice(seg, upto));
  };
  while (i < n) {
    INLINE_SPECIAL.lastIndex = i;
    const m = INLINE_SPECIAL.exec(s);
    if (m === null) break;
    const j = m.index;
    const c = m[0];
    if (c === '\\') {
      if (j + 1 < n && ESCAPABLE.has(s[j + 1])) {
        flush(j);
        out.push(ENTITIES[s[j + 1]] ?? s[j + 1]);
        i = j + 2;
        seg = i;
      } else i = j + 1;
      continue;
    }
    if (c === '`') {
      const k = s.indexOf('`', j + 1);
      if (k > j + 1) {
        flush(j);
        out.push('<code>', escapeHtml(s.slice(j + 1, k)), '</code>');
        i = k + 1;
        seg = i;
      } else i = j + 1;
      continue;
    }
    if (c === '*') {
      if (s[j + 1] === '*') {
        const k = findUnescaped(s, '**', j + 2);
        if (k > j + 2) {
          flush(j);
          out.push('<strong>', inline(s.slice(j + 2, k), env), '</strong>');
          i = k + 2;
          seg = i;
        } else i = j + 2;
        continue;
      }
      const k = findSingleStar(s, j + 1);
      if (k > j + 1) {
        flush(j);
        out.push('<em>', inline(s.slice(j + 1, k), env), '</em>');
        i = k + 1;
        seg = i;
      } else i = j + 1;
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', j + 1);
      const e = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = e === -1 ? '' : s.slice(k + 2, e);
      if (target !== '' && !WS.test(target)) {
        flush(j);
        out.push('<a href="', escapeHtml(env.link(target)), '">', inline(s.slice(j + 1, k), env), '</a>');
        i = e + 1;
        seg = i;
      } else i = j + 1;
      continue;
    }
    // One of & < > " ': escaped, and the run restarts after it.
    flush(j);
    out.push(ENTITIES[c]);
    i = j + 1;
    seg = i;
  }
  flush(n);
  return out.join('');
}

const KIND_BLANK = Object.freeze({ t: 'blank' });
const KIND_HR = Object.freeze({ t: 'hr' });
const KIND_QUOTE = Object.freeze({ t: 'quote' });
const KIND_TEXT = Object.freeze({ t: 'text' });

/**
 * A line's block kind, in the order the reference's lexer tries them: blank, fence, heading, break,
 * quote, list item, else paragraph text. Classified once per line per body, so a paragraph's lines are
 * not re-tested as it gathers them.
 */
function classify(line) {
  if (isBlank(line)) return KIND_BLANK;
  const lang = fenceLang(line);
  if (lang !== null) return { t: 'fence', lang };
  const heading = headingOf(line);
  if (heading !== null) return { t: 'heading', depth: heading.depth, text: heading.text };
  if (isHr(line)) return KIND_HR;
  if (line[0] === '>') return KIND_QUOTE;
  const bullet = bulletText(line);
  if (bullet !== null) return { t: 'bullet', text: bullet };
  const ordered = orderedText(line);
  if (ordered !== null) return { t: 'ordered', number: ordered.number, text: ordered.text };
  return KIND_TEXT;
}

/** The kinds that end a paragraph: a blank line, a fence, a heading or a thematic break. */
function endsParagraphKind(t) {
  return t === 'blank' || t === 'fence' || t === 'heading' || t === 'hr';
}

/**
 * `src` rendered: its HTML (each block on its own lines, a "\n" after the last), its table of contents (every level 2
 * and 3 heading: level, id and its inline HTML) and its excerpt (the first paragraph's inline HTML, or "").
 */
export function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const kinds = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) kinds[i] = classify(lines[i]);
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  while (i < lines.length) {
    const kind = kinds[i];
    const line = lines[i];
    if (kind.t === 'blank') {
      i++;
      continue;
    }
    if (kind.t === 'fence') {
      const body = [];
      i++;
      while (i < lines.length && !isFenceClose(lines[i])) body.push(lines[i++]);
      i++;
      const cls = kind.lang === '' ? '' : ` class="language-${escapeHtml(kind.lang)}"`;
      blocks.push(`<pre><code${cls}>${body.length === 0 ? '' : `${escapeHtml(body.join('\n'))}\n`}</code></pre>\n`);
      continue;
    }
    if (kind.t === 'heading') {
      const id = uniqueSlug(slugify(kind.text), ids);
      const html = inline(kind.text, env);
      blocks.push(`<h${kind.depth} id="${id}">${html}</h${kind.depth}>\n`);
      if (kind.depth === 2 || kind.depth === 3) toc.push({ level: kind.depth, id, html });
      i++;
      continue;
    }
    if (kind.t === 'hr') {
      blocks.push('<hr>\n');
      i++;
      continue;
    }
    if (kind.t === 'quote') {
      const body = [];
      while (i < lines.length && lines[i][0] === '>') {
        const l = lines[i++];
        body.push(trimLine(l.startsWith('> ') ? l.slice(2) : l.slice(1)));
      }
      const kept = body.filter((l) => l !== '');
      blocks.push(kept.length === 0 ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(kept.join('\n'), env)}</p>\n</blockquote>\n`);
      continue;
    }
    if (kind.t === 'bullet' || kind.t === 'ordered') {
      const isOrdered = kind.t === 'ordered';
      const items = [];
      while (i < lines.length) {
        const text = isOrdered ? orderedText(lines[i])?.text ?? null : bulletText(lines[i]);
        if (text !== null) {
          items.push([trimLine(text)]);
          i++;
        } else if (isContinued(lines[i])) {
          items[items.length - 1].push(trimLine(lines[i]));
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && kind.number !== 1 ? `<ol start="${kind.number}">` : `<${tag}>`;
      let html = `${open}\n`;
      for (const parts of items) html += `<li>${inline(parts.join('\n'), env)}</li>\n`;
      blocks.push(`${html}</${tag}>\n`);
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < lines.length && !endsParagraphKind(kinds[i].t)) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>\n`);
  }
  return { html: blocks.join(''), toc, excerpt: excerpt ?? '' };
}
