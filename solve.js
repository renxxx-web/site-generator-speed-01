// solve.js — the site generator computed by a Rust engine compiled to WebAssembly.
//
// The engine in sitegen.wasm is a one-pass port of the reference makefun-site 1.0.0
// semantics: it parses the input JSON from raw bytes, builds every page, and serializes
// the answer itself. run(input) below is the contract the house driver uses; answerAll()
// is the same computation for a whole cases.json byte string at once, which main.ts uses
// so the cases never take a detour through JS objects. A string with a byte >= 0x80 that
// needs a slug is handed back to the reference slugifier in lib/text.js through the
// slug_non_ascii import — the one corner (non-ASCII slugs) where the JS original is kept
// as the authority.

import { readFileSync } from 'node:fs';
import { slugify } from './lib/text.js';

const bytes = readFileSync(new URL('./sitegen.wasm', import.meta.url));
const decoder = new TextDecoder();
const encoder = new TextEncoder();

let memory = null;
const imports = {
  env: {
    slug_non_ascii(inPtr, inLen, outPtr, outCap) {
      const text = decoder.decode(new Uint8Array(memory.buffer, inPtr, inLen));
      const encoded = encoder.encode(slugify(text));
      if (encoded.length > outCap) return -encoded.length;
      new Uint8Array(memory.buffer, outPtr, encoded.length).set(encoded);
      return encoded.length;
    },
  },
};

const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), imports);
memory = instance.exports.memory;
const { wg_alloc, wg_free, run_one, answer_all } = instance.exports;

function call(fn, buf) {
  const ptr = wg_alloc(buf.length);
  new Uint8Array(memory.buffer, ptr, buf.length).set(buf);
  const packed = fn(ptr, buf.length);
  const outPtr = Number(packed >> 32n);
  const outLen = Number(packed & 0xffffffffn);
  const out = Buffer.from(new Uint8Array(memory.buffer, outPtr, outLen));
  wg_free(ptr, buf.length);
  wg_free(outPtr, outLen);
  return out;
}

/** The answer for one input, exactly as the reference computes it. */
export function run(input) {
  return JSON.parse(call(run_one, Buffer.from(JSON.stringify(input), 'utf8')).toString('utf8'));
}

/** The answers for a whole cases.json, as the bytes of the answers array. */
export function answerAll(casesBuffer) {
  return call(answer_all, casesBuffer);
}
