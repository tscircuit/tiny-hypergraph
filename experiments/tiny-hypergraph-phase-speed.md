# Tiny-hypergraph phase speed experiments

Date: 2026-08-10

Goal: reduce tiny-hypergraph solve time without changing route completion or
region costs. All trials use concurrency 1. `bugreport88` is not present in
this repository and was not run.

## Clean baseline

Command:

```sh
./benchmark.sh --concurrency 1
```

Untouched `main` (`99c7aeb`):

- 8/8 successful, with 100% route completion
- total duration: 23.588 s
- average solveGraph: 2.629 s
- P50 / P95 duration: 1.568 s / 8.318 s
- average max region cost: 1.739
- sample008: 1,197,418 iterations and 8.318 s total
- every final region cost matched the committed input baseline

A sample008 CPU profile identified candidate scoring (`computeG`),
two-dimensional `Math.hypot`, indexed-heap sifting, outside-in expansion, and
selective blocker search as the main actionable costs.

## Retained changes

### 1. Use direct two-dimensional distance arithmetic

Replace two-argument `Math.hypot(dx, dy)` with
`Math.sqrt(dx * dx + dy * dy)` throughout routing. PCB coordinates are finite
and small, so variadic overflow/underflow scaling is unnecessary.

Three-run sample008 median for the first hot-path conversion:

| Variant | solveGraph | Total | Iterations | Final cost |
| --- | ---: | ---: | ---: | ---: |
| `Math.hypot` baseline | 6.923 s | 7.289 s | 1,197,418 | 3.391 |
| direct square root | 6.276 s | 6.645 s | 1,197,441 | 3.391 |

Result: 10.3% faster solveGraph, with identical completion, hops, and region
cost. The 23-iteration floating-point tie difference is 0.002% of the search.

### 2. Reject already-closed hops before scoring

Expose the indexed frontier's closed-hop lookup to the core expansion loop.
The queue already discarded these candidates; the earlier check only avoids
intersection counting and region-cost work.

Three-run sample008 median solveGraph improved from 6.276 s to 6.051 s
(3.6%), with unchanged search output.

### 3. Inline distance-aware cost composition

Move optional segment-distance addition into the core scoring function behind
a per-instance flag. This removes a derived `computeG` and `super.computeG`
pair for distance-aware solvers while preserving base-solver behavior.

Three-run sample008 median solveGraph improved from 6.051 s to 5.859 s
(3.2%), with unchanged output.

### 4. Index committed route segments once per partial-rip round

Build route-indexed committed segment lists in one region scan before
reconstructing partial routes. The scan changes from
`O(routeCount * regionCount)` to `O(regionCount + segmentCount)` per repair
round. Ordering and partial-rip selection are unchanged.

### 5. Reuse segment geometry already resolved by expansion

Resolve the expanded port angle once, reuse neighbor incidence to choose the
neighbor angle, and pass both to scoring. Outside-in expansion also reuses its
travel-cap distance in `computeG`, and connector joins reuse their first cost
calculation.

Representative sample008 medians:

- current-port angle reuse: 5.465 s solveGraph, about 3.2% faster
- neighbor incidence/angle reuse: 5.381 s, about 1.5% faster
- outside-in distance/connector reuse: 4.869 s versus 4.965 s, about 1.9%

All runs retained 1,197,441 iterations, 361/361 routes, and cost 3.391.

### 6. Sift the indexed heap with a hole

Move one candidate through the heap while shifting parents or children into
the hole. This cuts index-map writes from two per heap level to roughly one
without changing comparison or close semantics.

Three-run sample008 median solveGraph improved from about 5.381 s to 5.129 s
(4.7%), with identical output.

### 7. Hoist immutable reservation state per expansion

Endpoint reservation arrays, region reservation arrays, and the current net
are fixed during an expansion. Load them once in core, outside-in, and relaxed
selective searches instead of repeatedly calling through the lazy setup getter.

Three-run sample008 median solveGraph improved from 4.869 s to 4.656 s
(4.4%), with identical output.

### 8. Remove selective-rerip temporary allocations

Build blocker-owner sets without `flatMap`, replace callback-based forbidden
owner checks with loops, update port ownership without two-element temporary
arrays, and compare segment geometry by copied scalars instead of spread
objects.

Focused tests pass and three sample008 runs retained identical output. The
observed median was 4.734 s under a different generational-map configuration;
the host became too contended for a clean isolated percentage comparison.

## Rejected trials

| Trial | Outcome |
| --- | --- |
| Lazy heuristic distances | Lowered the dense heuristic table by about 64 MiB on sample008 but regressed solveGraph to 6.771-7.461 s. |
| Packed intersection counts | Avoided a tuple but was 3.1% slower. |
| Precomputed region-cost inputs | Extra typed-array loads regressed solveGraph to 6.319-6.723 s. |
| One map with a closed-hop sentinel | Mixed map values regressed the indexed heap. |
| Clear sparse best-cost maps every route | About 1.9% faster initially, but repeated hash-table churn raised measured RSS; restored generational reuse. |
| Specialized sparse/dense branches | Slower than JSC's `instanceof Map` specialization. |
| Empty-region scoring fast path | Its extra branch and code size were slower. |
| Check best cost before candidate allocation | Source-level work fell, but JSC optimized the reordered loop worse. |
| Pre-score joins before materializing paths | Larger, branchier join code was slightly slower. |
| Indexed outside-in frontier | Hit the 2,000,004-iteration limit and worsened sample008 cost from 3.391 to 4.432; reverted immediately. |
| Inline intersection counting into `computeG` | Regressed median solveGraph from about 5.13 s to about 5.61 s. |
| Parallel heap hop-key array | Small speed signal, but added frontier-proportional storage and recovered about 73 MiB when removed. |

## Memory observations

RSS was sampled every 100 ms at concurrency 1:

- untouched sample008: 1,137,680 KiB and 1,574,576 KiB on repeat runs
- optimized sample008 after memory-sensitive rollbacks: 1,521,536 KiB
- full optimized suite with a safety cutoff: 4,123,728 KiB peak
- an earlier full run with sparse-map clearing and the parallel hop-key cache:
  7,577,920 KiB peak

The repeated untouched runs varied from 1.09 to 1.50 GiB, so the retained
single-board result is within observed baseline variance. The two changes with
clear memory costs were removed.

Full-suite timing later became unreliable because unrelated `tsci` jobs used
about 9.7 GiB RSS and roughly 270% CPU concurrently. Their paths were outside
this worktree, so they were monitored but not terminated.

## Validation

- `bunx tsc --noEmit`: pass
- focused core/outside-in/selective/heap/region-cost tests: pass
- full suite at concurrency 1: 108 pass; 3 files fail before test execution
  because the checkout lacks `sharp-darwin-arm64v8.node`
- attempted local `sharp` rebuild: blocked by `ENOSPC`; its temporary 1.8 GiB
  npm cache was removed, recovering disk space
- benchmark completion and all eight reported region costs: unchanged

The last low-contention full retained-variant run before the two
memory-sensitive rollbacks was 14.861 s (1.59x the clean baseline). A final
clean measurement of the memory-neutral set is pending lower host load.
