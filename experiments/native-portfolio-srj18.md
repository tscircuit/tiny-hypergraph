# Native portfolio srj18 measurements

Measured on GitHub Actions run [38492636565](https://github.com/tscircuit/tiny-hypergraph/actions/runs/38492636565), source commit `7adc644bc8852a251af39d048367e02029385271`. The report records the PR merge checkout `c48e48d7cd4ed05829d2ded0d0f3eab1c12c3d4b`. Bun 1.4.0, Blacksmith ARM runner constrained to eight distinct physical cores (affinity 0–7), without a detected CPU quota.

All 16 graphs run sequentially. Eight workers evaluate the fixed eight candidates for each individual graph. A persistent pool includes startup and shutdown once per suite. Three isolated-process trials per mode; parsing, original-core warmups and output hashes are outside the timed window. Native initialization, input conversion, all searches, selection, quality checks and output conversion are timed.

| Mode | Median wall seconds | Median total CPU seconds | Median peak RSS MiB | Completed / model-valid |
| --- | ---: | ---: | ---: | --- |
| Original solver, 1M iterations | 65.823 | 67.223 | 991.7 | 15 / 11 |
| Native portfolio, 1 worker | 82.971 | 107.303 | 1038.4 | 15 / 11 |
| Native portfolio, 8 workers | 18.465 | 100.464 | 1527.0 | 15 / 11 |

The eight-worker portfolio is **3.56× faster than the original solver** and **4.49× faster than the same portfolio with one worker**. On one worker the portfolio takes 26.0% more wall time than the original. Eight workers consume 49.4% more total CPU time than the original, and the measured median peak RSS rises by 54.0%. RSS includes parsed inputs, warmups and hashing. These are suite-level ratios; individual graphs do not all exceed 3×.

Every selected output and candidate-state fingerprint matches between one and eight workers and across all three repeats. This guarantees repeatability of the new algorithm on these inputs; the new portfolio may choose different routes from the original algorithm. The separate serial-equivalent parallel API remains available.

The fast portfolio gives each candidate 250k iterations; candidate zero also retains the legacy greedy tail. The original control uses 1M iterations. Total work is deliberately spread over eight fixed candidates. The fast mode does not guarantee non-regressing congestion quality. The optional full-budget reference mode retains the original 1M search as candidate zero and is measured separately.

Both modes complete 15/16 graphs. Only 11 completions satisfy the known-single-layer intersection audit; samples 006, 012, 013 and 015 violate it in both modes, and sample 014 fails in both. This audit is a hypergraph model check, not PCB DRC.

| Sample | Original max congestion | Portfolio max congestion | Original / portfolio known-single-layer intersections |
| --- | ---: | ---: | --- |
| sample001 | 1.28059 | 1.04048 | 0 / 0 |
| sample002 | 1.2915 | 2.57511 | 0 / 0 |
| sample003 | 0.890233 | 0.741861 | 0 / 0 |
| sample004 | 2.35826 | 1.08 | 0 / 0 |
| sample005 | 0.397878 | 0.332049 | 0 / 0 |
| sample006 | 102996 | 30899.8 | 268 / 276 |
| sample007 | 0.624699 | 0.644874 | 0 / 0 |
| sample008 | 3.03226 | 2.60878 | 0 / 0 |
| sample009 | 2.03413 | 0.790204 | 0 / 0 |
| sample010 | 0.82253 | 0.681249 | 0 / 0 |
| sample011 | 0.92848 | 0.891795 | 0 / 0 |
| sample012 | 3854.32 | 3854.32 | 42 / 43 |
| sample013 | 260.102 | 73.6641 | 102 / 83 |
| sample014 | 0.342124 | 0.121318 | 0 / 0 |
| sample015 | 3805.61 | 3805.61 | 143 / 157 |
| sample016 | 0.814839 | 1.8337 | 0 / 0 |

Notable valid-route regressions: sample002 max congestion 1.2915 → 2.5751 and sample016 0.81484 → 1.8337. Sample007 also rises slightly. Completion counts alone do not establish equal routing quality.

Inputs are the frozen checksummed Pipeline7 MultiGraph hypergraphs extracted with published autorouter 0.0.979 (effort 0.1) from srj18 commit `100e8957ce789b5b288e14c476dc83f4efc5214b`. Current tscircuit-autorouter main (0.0.983) was checked on 2026-10-14 and pins that same dataset commit. Raw trials and all per-input hashes are in [native-portfolio-srj18-results.json.gz](native-portfolio-srj18-results.json.gz).

Reproduce with the pinned compressed snapshot and the commands in [PORTFOLIO.txt](../PORTFOLIO.txt). The benchmark workflow rebuilds the WASM artifact and verifies byte-for-byte reproducibility before timing.

Two additional one-trial controls make the limits explicit:

| Control | Original seconds | Portfolio one-worker seconds | Portfolio eight-worker seconds | Speedup over original |
| --- | ---: | ---: | ---: | ---: |
| Fresh workers per graph | 68.194 | 84.139 | 23.222 | 2.94× |
| Persistent pool, full 1M baseline candidate | 65.305 | 98.605 | 32.351 | 2.02× |

The cold-start control includes a new worker pool for every graph. The 3× target is exceeded by the reusable-pool API, not this one-shot lifecycle. Both controls pass one/eight-worker determinism checks and retain 15/16 completions. The full-budget reference also retains 11 model-valid completions, and its candidate-zero statistics and quality match the original solver on all 16 inputs. Selected routes never rank worse than that reference on intersection count, maximum congestion, then total congestion. This ranking does not guarantee improvement in every individual metric, wire length or final PCB DRC.

Raw controls: [cold worker-startup trials](native-cold-portfolio-srj18-results.json.gz) and [full-budget reference trials](native-reference-srj18-results.json.gz).
