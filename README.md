# site-generator-speed-01 — a faster drop-in for makefun-site 1.0.0

[![Competition](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/c/site-generator-speed-01-run-20261122)
[![Rank](https://make.fun/badge/site-generator-speed-01-run-20261122/renxxx-web/site-generator-speed-01/rank.svg)](https://make.fun/c/site-generator-speed-01-run-20261122)
[![Reward](https://make.fun/badge/site-generator-speed-01-run-20261122/renxxx-web/site-generator-speed-01/reward.svg)](https://make.fun/c/site-generator-speed-01-run-20261122)

Entry for the make.fun competition [Build a static site faster, 22 November 2026](https://make.fun/c/site-generator-speed-01-run-20261122): a dependency-free `solve.js` whose `run(input)` returns **exactly** makefun-site 1.0.0's output tree for every site — same pages, same report, byte for byte — in a fraction of the CPU time. `main.ts` is the house driver, unchanged.

## Why it is fast

makefun-site 1.0.0 is a plugin pipeline in the shape of metalsmith with a marked-shaped renderer: it escapes character by character, slices strings recursively through its inline renderer, walks a node tree for every template render, and re-renders identical partials (a post's card on every index and tag page that lists it) from scratch each time. This entry keeps makefun-site's exact dialect — its front matter, Markdown subset, slug rule, template language and build report, as its README and code state them — and changes the mechanics:

- **Compiled templates** — each template is parsed once, then compiled to a generated function that pushes into an output array, instead of a tree walk per render.
- **Memoised includes** — a static analysis proves, for each `{% include %}`, the exact set of scope names the included template's output can depend on; renders are then memoised on those bindings' identities for the build, so a card partial is rendered once per post, not once per appearance. Anything the analysis cannot prove (include cycles, the depth cap in reach) renders directly.
- **Single-pass inline renderer** — one index-based scan that jumps between special characters with a regex search and escapes as it goes; blocks are classified once per line and rendered in the same pass that lexes them, with no token objects.
- **Cheap text primitives** — a scanning HTML escape that returns clean strings untouched, cached slugify with an ASCII fast path around Unicode normalisation, a table-driven word counter, and a front-matter parser that walks line offsets instead of splitting and re-joining the source.

## Local numbers

On the kit's official practice set (3 cases, 1,070 Markdown sources), 1 CPU pinned, this machine: house baseline **1.24 s** CPU, this entry **0.73 s** CPU — about **1.7× faster end to end** (the driver, JSON parsing and stringifying included in both), with answers byte-identical to the oracle on every case. Correctness is differential-tested against the vendored reference: the practice set, 50 freshly drawn generator sets (150 cases), and ~48,000 generated unit cases across front matter, Markdown, templates and text rules — zero differences.

**Run:** `MAKEFUN_INPUT_DIR=<set>/input MAKEFUN_OUTPUT_DIR=<out> node main.ts`

MIT — see [LICENSE](LICENSE).
