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
//
// Two builds of the same engine ship side by side: sitegen.wasm (SIMD128 + bulk memory)
// and sitegen-scalar.wasm (no SIMD). A WebAssembly.validate probe on a minimal SIMD
// module picks the SIMD build where the runtime supports it and the scalar build
// otherwise; both compute byte-identical answers.

import { readFileSync } from 'node:fs';
import { slugify } from './lib/text.js';

// Minimal module whose only function splats an i32 into an i8x16: it validates only
// where the SIMD128 feature is available.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, // \0asm, version 1
  1, 5, 1, 96, 0, 1, 123, // type: () -> v128
  3, 2, 1, 0, // function 0 : type 0
  10, 8, 1, 6, 0, 65, 0, 253, 15, 11, // code: i32.const 0; i8x16.splat; end
]);
const engineFile = WebAssembly.validate(SIMD_PROBE) ? './sitegen.wasm' : './sitegen-scalar.wasm';

const bytes = readFileSync(new URL(engineFile, import.meta.url));
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
