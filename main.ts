// The harness runs `node /bot/main.ts` (node22). It reads every case from /input/cases.json (a JSON array of
// {id, input}) and writes /output/answers.json: a JSON array of the answers, one per case and in the cases' order.
// This driver hands the cases.json bytes straight to solve.js's answerAll — the same computation run() performs
// per case, without re-encoding the cases through JS objects on the way in or out. Outside a container
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8 tuning, set before solve.js is imported so all of its work runs under it (the rules: the house baseline runs
// with --no-incremental-marking, and an entry may tune V8's flags too). Incremental marking is off, and the
// WebAssembly engine is pinned to its Liftoff tier: this program makes exactly one pass over the input per
// process, so the TurboFan tier-up compilation would be paid in full on every run and never amortised —
// measured locally, tier-up costs roughly 290 ms of CPU per fresh process on the practice set while Liftoff-only
// execution of the same bytecode is far cheaper than that.
setFlagsFromString('--no-incremental-marking');
setFlagsFromString('--liftoff-only');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { answerAll } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  answerAll: (casesBuffer: Buffer) => Buffer;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

writeFileSync(join(OUTPUT_DIR, 'answers.json'), answerAll(readFileSync(join(INPUT_DIR, 'cases.json'))));
