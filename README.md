# site-generator-speed-01 — a faster drop-in for makefun-site 1.0.0

[![Competition](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/c/site-generator-speed-01-run-20261122)
[![Rank](https://make.fun/badge/site-generator-speed-01-run-20261122/renxxx-web/site-generator-speed-01/rank.svg)](https://make.fun/c/site-generator-speed-01-run-20261122)
[![Reward](https://make.fun/badge/site-generator-speed-01-run-20261122/renxxx-web/site-generator-speed-01/reward.svg)](https://make.fun/c/site-generator-speed-01-run-20261122)

Entry for the make.fun competition [Build a static site faster, 22 November 2026](https://make.fun/c/site-generator-speed-01-run-20261122): a `solve.js` whose `run(input)` returns **exactly** makefun-site 1.0.0's output tree for every site — same pages, same report, byte for byte — in a fraction of the CPU time.

## Why it is fast

The whole generator — front matter, the Markdown subset, the slug rule, the template language, the build report — is reimplemented in Rust and compiled to WebAssembly (`sitegen.wasm`). `solve.js` is a thin bridge: it instantiates the module once and hands it the input; the engine parses the input JSON from raw bytes in one pass, builds every page, and serializes the answer itself. `main.ts` passes the cases.json bytes straight to that engine, so the cases never take a detour through JS objects. The one corner delegated back to JavaScript is the slug of a non-ASCII string (Unicode NFKD + mark stripping + lowering), where the reference slugifier in `lib/text.js` stays the authority, reached through a WASM import.

Inside the engine: one fused pass classifies each Markdown line and counts its words while the blocks render; templates are parsed once into a node tree and rendered against shared, reference-counted values (a post's card is built once, not once per appearance); sorting follows UTF-16 code-unit order exactly as JavaScript does; and the JSON serializer copies clean runs between the few bytes it must escape.

## Local numbers

On the kit's official practice set (3 cases, 1,070 Markdown sources), 1 CPU pinned, this machine: house baseline **1.24 s** CPU, this entry **0.66 s** CPU net of a null entry — about **1.9× faster end to end**. Correctness is proven against the oracle before every submission: the practice set plus 20 freshly drawn generator sets (60 cases), zero differences.

**Run:** `MAKEFUN_INPUT_DIR=<set>/input MAKEFUN_OUTPUT_DIR=<out> node main.ts`

MIT — see [LICENSE](LICENSE).
