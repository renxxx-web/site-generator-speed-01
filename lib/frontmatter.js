// makefun-site's front matter (the reference's lib/frontmatter.js): a strict subset of YAML's block
// mappings. Seven keys are known, each with its own value grammar, and anything else refuses the file
// with the first reason met, line by line. The reference's regular expressions are replaced by hand
// scanners with the same accept/reject behaviour on every line, and the text is walked by line offsets
// instead of being split into an array of lines whose tail is then joined back into the body.

/** The keys a source's front matter may give. */
export const KEYS = Object.freeze(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);

/** The days of month `m` (1-12) of year `y`, by the Gregorian rule. */
function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** Whether `line` is blank: spaces and tabs only (the reference's /^[ \t]*$/). */
function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/**
 * A "key: value" line split as the reference's /^([a-z_]+):(?: (.*))?$/ splits it: { key, raw } with raw
 * undefined when the line ends at the colon, or null when the line is not of that shape.
 */
function splitKeyLine(line) {
  let i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 97 && c <= 122) || c === 95) i++;
    else break;
  }
  if (i === 0 || line[i] !== ':') return null;
  if (i + 1 === line.length) return { key: line.slice(0, i), raw: undefined };
  if (line[i + 1] !== ' ') return null;
  return { key: line.slice(0, i), raw: line.slice(i + 2) };
}

/** A string value: "..." with \" and \\ its only escapes, or bare, the rest of the line (never opening on " or [). */
function stringOf(raw) {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.startsWith('[')) return { error: 'a bare string opens on [' };
  return { value: raw };
}

/** A date's parts when `raw` is exactly YYYY-MM-DD in digits and dashes, else null. */
function dateParts(raw) {
  if (raw.length !== 10 || raw[4] !== '-' || raw[7] !== '-') return null;
  for (const i of [0, 1, 2, 3, 5, 6, 8, 9]) {
    const c = raw.charCodeAt(i);
    if (c < 48 || c > 57) return null;
  }
  return [Number(raw.slice(0, 4)), Number(raw.slice(5, 7)), Number(raw.slice(8, 10))];
}

/** Whether `raw` is a template name: a-z, 0-9 and "-" only, non-empty (the reference's /^[a-z0-9-]+$/). */
function isTemplateName(raw) {
  if (raw.length === 0) return false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) return false;
  }
  return true;
}

/** Whether `raw` is a slug: runs of a-z and 0-9 joined by single "-" (the reference's /^[a-z0-9]+(?:-[a-z0-9]+)*$/). */
function isSlugValue(raw) {
  if (raw.length === 0) return false;
  let run = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) run++;
    else if (c === 45 && run > 0 && i + 1 < raw.length) run = 0;
    else return false;
  }
  return run > 0;
}

/** Whether a tag name holds none of " [ ] and is non-empty (the reference's /^[^"[\]]+$/). */
function isTagName(t) {
  if (t.length === 0) return false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"' || c === '[' || c === ']') return false;
  }
  return true;
}

/** One key's value, or why it is refused. */
function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const p = dateParts(raw);
      if (p === null || p[0] < 1970 || p[0] > 2099 || p[1] < 1 || p[1] > 12 || p[2] < 1 || p[2] > daysIn(p[0], p[1])) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => !isTagName(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return isTemplateName(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return isSlugValue(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

/**
 * A source's front matter and body: { data, body }, or { error } with the first reason it is refused. `text` has "\n"
 * line ends. Lines are visited by offset: line 0 is the text up to the first "\n", and the body is the
 * text after the closing line's "\n" (or "" when there is none) — the same strings the reference's
 * split and join produce.
 */
export function parseFrontMatter(text) {
  const firstNl = text.indexOf('\n');
  const firstLine = firstNl === -1 ? text : text.slice(0, firstNl);
  if (firstLine !== '---') return { error: 'no front matter' };
  // The reference first finds the closing line over the whole text: with none, the refusal is "not
  // closed" even when an earlier line is malformed, so the close is located before any line is judged.
  let pos = firstNl === -1 ? text.length : firstNl + 1;
  let closeStart = -1;
  let bodyStart = -1;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    if (end - pos === 3 && text.startsWith('---', pos)) {
      closeStart = pos;
      bodyStart = nl === -1 ? text.length : nl + 1;
      break;
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (closeStart === -1) return { error: 'the front matter is not closed' };
  const data = {};
  let lineNo = 1; // the current line's number, 1-based as the reference counts from the opening ---
  pos = firstNl === -1 ? text.length : firstNl + 1;
  while (pos < closeStart) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(pos, end);
    lineNo++;
    if (!isBlankLine(line) && !line.startsWith('#')) {
      const m = splitKeyLine(line);
      if (m === null) return { error: `line ${lineNo} is not "key: value"` };
      const key = m.key;
      const raw = (m.raw ?? '').replace(/[ \t]+$/, '');
      if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = valueOf(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
    pos = nl + 1;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: text.slice(bodyStart) };
}
