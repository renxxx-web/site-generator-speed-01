// makefun-site's text rules (the reference's lib/text.js): the HTML escape table, the slug rule and the long
// date, reimplemented for speed — a scanning escape that returns clean strings untouched, a slug cache and
// an ASCII fast path around Unicode normalisation, and a linear word counter. The caches live for one
// build only: build() calls resetTextCaches() before anything reads them.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function isEscapableCode(c) {
  return c === 38 || c === 60 || c === 62 || c === 34 || c === 39; // & < > " '
}

const ESCAPE_RE = /[&<>"']/g;

/** `text` with & < > " and ' escaped. */
export function escapeHtml(text) {
  ESCAPE_RE.lastIndex = 0;
  const m = ESCAPE_RE.exec(text);
  if (m === null) return text;
  let out = text.slice(0, m.index) + ESCAPES[m[0]];
  let seg = m.index + 1;
  ESCAPE_RE.lastIndex = seg;
  let n;
  while ((n = ESCAPE_RE.exec(text)) !== null) {
    out += text.slice(seg, n.index) + ESCAPES[n[0]];
    seg = n.index + 1;
  }
  return out + text.slice(seg);
}

export const SLUG_MAX = 64;

let slugCache = new Map();
let dateCache = new Map();

/** Forget every cached slug and long date: called at the start of each build, so no case sees another's. */
export function resetTextCaches() {
  slugCache = new Map();
  dateCache = new Map();
}

/** The slug of `text`, uncached: NFKD, marks dropped, lowered, runs of other characters one "-". */
function slugifyRaw(text) {
  let plain = text;
  let nonAscii = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) >= 128) {
      nonAscii = true;
      break;
    }
  }
  // A pure-ASCII text is unchanged by NFKD and holds no combining mark, so both steps can be skipped.
  if (nonAscii) plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  // Lowercase, each run of characters other than a-z and 0-9 one "-", none at either end: the same
  // string the reference's per-character walk builds, cut to SLUG_MAX with a "-" left at the cut dropped.
  let out = plain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

/**
 * The slug of `text`: NFKD, combining marks dropped, A-Z lowered, every run of characters other than a-z
 * and 0-9 one "-", none at either end, at most SLUG_MAX characters (a "-" left at the cut dropped), and
 * "untitled" when nothing is left.
 */
export function slugify(text) {
  let out = slugCache.get(text);
  if (out === undefined) {
    out = slugifyRaw(text);
    slugCache.set(text, out);
  }
  return out;
}

/** `slug` made unique against `taken` (and added to it): the first of slug, slug-2, slug-3 ... not taken. */
export function uniqueSlug(slug, taken) {
  let out = slug;
  for ( let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone: "2026-11-09" is "9 November 2026". */
export function longDate(date) {
  let out = dateCache.get(date);
  if (out === undefined) {
    const [y, m, d] = date.split('-');
    out = `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
    dateCache.set(date, out);
  }
  return out;
}

/** JavaScript's \s class for code units 0-255 (only \u00a0 lies above the ASCII controls there). */
const WS_TABLE = new Uint8Array(256);
for (const c of [9, 10, 11, 12, 13, 32, 0xa0]) WS_TABLE[c] = 1;

/** The words of a body: its runs of characters other than whitespace (the reference's /\S+/g count). */
export function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 256) {
      if (WS_TABLE[c] === 1) inWord = false;
      else if (!inWord) {
        inWord = true;
        n++;
      }
    } else if (c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff) inWord = false;
    else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}
