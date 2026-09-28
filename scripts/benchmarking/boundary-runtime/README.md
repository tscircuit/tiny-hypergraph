# Reproduce the boundary-search runtime comparison

This shell-only harness runs real Chromium through CDP, without computer-use UI
automation. Bun is used to build/drive the browser; browser timings are collected
inside Chromium. A separate warmed Bun run uses the same entry logic and inputs.

Use existing installed dependencies in the autorouter checkout. Fetch the owning
repositories first. Supply the tiny-hypergraph candidate checkout, an autorouter
checkout, and a fresh output directory. `prepare.mjs` snapshots owning
`origin/main`, candidate `HEAD`, and the exact consumer package pin separately.
It never changes either checkout or the installed dependency. Candidate code
must already be committed. The package repository must contain the consumer pin.

```sh
bun scripts/benchmarking/boundary-runtime/prepare.mjs \
  /path/to/tiny-hypergraph /path/to/tscircuit-autorouter /tmp/boundary-run
```

To reuse captured inputs, pass their directory as a fourth argument. Otherwise
capture the fixed SRJ18 cases from the consumer's actual Pipeline 9 constructor:

```sh
bun /tmp/boundary-run/capture-inputs.mjs /path/to/tscircuit-autorouter /tmp/boundary-run
```

Run these **serially**, with other timing work paused. Set `CHROMIUM_PATH` to an
installed Chromium/headless-shell executable; no browser installation is done.
Each command writes its named JSONL artifact in the experiment directory.

```sh
CHROMIUM_PATH=/path/to/chrome-headless-shell bun /tmp/boundary-run/run-browser.mjs /tmp/boundary-run
bun /tmp/boundary-run/run-bun.mjs /tmp/boundary-run
CHROMIUM_PATH=/path/to/chrome-headless-shell bun /tmp/boundary-run/run-browser.mjs /tmp/boundary-run --full
CHROMIUM_PATH=/path/to/chrome-headless-shell bun /tmp/boundary-run/run-browser.mjs /tmp/boundary-run --full-lazy
```

Prepass modes: consumer-pin baseline/eager, consumer-pin lazy only, consumer-pin
boundary index only, owning-main baseline, owning-main plus boundary index. Two
warmup rounds and five measured rounds rotate mode order, with fresh solvers for
samples 1–5. Identical counter wrappers measure eager entries/bytes and heuristic
queries. Full output graph/report SHA256 values must match within each run.

The full browser check uses actual Pipeline 9 and its existing relaxed DRC
evaluator on samples 1, 3, 5. The baseline/boundary session warms both on sample 1,
then runs one measured sweep in alternating order. `--full-lazy` is a separate
session with one warmup; it compares against the saved baseline hashes. These
single-sweep full timings are observational, not evidence of a whole-pipeline
speedup. Full timers exclude output hashing and DRC evaluation; prepass timers
exclude hashing. A 60-second cooperative step-loop deadline applies to full
solves; unlike the prescribed worker benchmark it cannot interrupt one long
synchronous `step()` call.

Memory fields are observed JS heap sizes, not peak memory or RSS. Chromium uses
`performance.memory.usedJSHeapSize` with precise-memory reporting; Bun uses
`bun:jsc` heap statistics. Absolute values are not comparable across engines.
Prepass measurements collect before/after solve and after GC retaining the
solver. Full checks collect before/after solve. Explicit GC and instrumentation
are applied equally to variants. The temporary bucket index is released after
preprocessing, so retained heap alone does not quantify its transient cost.

The first recorded experiment used equivalent scratch scripts; later harness
normalization adds portable paths, navigation-readiness retry, and accurate
metadata. Raw timing rows are not regenerated or changed by normalization.
