# Outside-in partial-rip experiments

All timings are from the same Apple Silicon workstation and the committed
SRJ18 Pipeline7 inputs used by `./benchmark.sh`. Benchmark runs use the default
concurrency reported by the harness. Region-cost comparisons use the harness'
average maximum region cost.

## Acceptance target

- At least 1.5x faster than unmodified `main`.
- Prefer 5-10x if correctness and cost remain stable.
- Average maximum region cost no more than roughly 20% above the original
  score (2.333), i.e. at most about 2.800.
- All 8 SRJ18 cases and all 2,001 routes must complete.

## Trial 0 - unmodified main (`b617b67`)

Command: `./benchmark.sh`

- Result directory: `results/run001`
- Success: 8/8 cases, 2,001/2,001 routes.
- Total completion time: 95.441 s.
- Average duration: 11.930 s; P50 11.000 s; P95 18.759 s.
- Average maximum region cost: 2.333.
- Average solver iterations: 1,335,770.1.
- Per-case duration: 8.129, 5.359, 6.061, 15.945, 12.904, 11.000,
  17.283, and 18.759 s.

The solver performs ten full-graph rerips on these committed inputs. A focused
sample001 diagnostic measured 1,390,418 iterations, 10 rerips, and 8.049 s.

## Diagnostic - accept the first complete route set

This was a read-only parameter probe (`RIP_THRESHOLD_RAMP_ATTEMPTS=0`), not an
implementation trial. It establishes the optimization ceiling by removing all
post-solve rerips while leaving initial routing unchanged.

- Aggregate solve time across all eight cases: 7.285 s (13.10x faster).
- Average maximum region cost: 1.910 (18.1% better than the main baseline).
- All eight cases completed.

This confirms that repeated whole-trace rerouting is both the dominant runtime
cost and unnecessary for preserving the benchmark's region-cost envelope.

## Trial 1 - bounded central partial rip (12 mm per retained end)

Implementation: retain every unaffected prefix/suffix, select the hottest
segment on each affected route, reopen at most 12 mm of its old path on either
side, and route only between the resulting temporary endpoints. Restore the
best completed state at termination.

Command: `./benchmark.sh`

- Success: 8/8 cases, 2,001/2,001 routes.
- Total completion time: 48.460 s (1.97x faster).
- Average duration: 6.057 s; P50 4.497 s; P95 14.112 s.
- Average maximum region cost: 1.701 (27.1% better than main).
- Average solver iterations: 676,204.1 (49.4% fewer than main).
- Per-case duration: 3.335, 3.053, 2.141, 8.779, 14.112, 4.497,
  7.229, and 5.314 s.

This clears the minimum speed target with substantial aggregate cost headroom.
The remaining issues are sample008 reaching its two-million-iteration cap and
sample011 ending at 5.117 versus main's 3.217. The next trials target those two
tails and add the required two-ended search.

## Trial 2 - outside-in partial spans, 24 post-meeting expansions

Implementation: initial whole routes retain the established one-ended A* for
quality. Every partially reopened span receives two independent frontiers, one
from each retained end. Each frontier has a hard 24 mm travel limit. Once the
frontiers meet, the solver considers 24 additional expansions and commits the
lowest-cost valid join. A span that cannot meet within the bound falls back to
the regular route search. Live region caches are canonicalized to the same
route order used during output replay, eliminating score drift after
serialization.

Command: `./benchmark.sh`

- Success: 8/8 cases, 2,001/2,001 routes.
- Total completion time: 17.792 s (5.36x faster).
- Average duration: 2.224 s; P50 1.707 s; P95 5.166 s.
- Average maximum region cost: 1.488 (36.2% better than main).
- Average solver iterations: 260,978.9 (80.5% fewer than main).
- Per-case duration: 1.389, 0.926, 0.788, 2.745, 5.166, 1.707,
  1.924, and 3.146 s.
- Per-case max cost: 1.237, 1.543, 0.797, 1.133, 2.834, 1.492,
  1.278, and 1.590.

This reaches the requested 5-10x range while improving the aggregate region
score. Focused sample008 and sample011 checks also eliminated Trial 1's cost
tails (2.834 and 1.590 respectively).

## Trial 3 - reduce post-meeting search from 24 to 16 (rejected)

Focused command: `./benchmark.sh --sample NAME --concurrency 1` for samples
001, 007, 008, and 011.

- sample001: 2.938 s, cost 1.375, 453,560 iterations.
- sample007: 3.140 s, cost 1.133, 220,971 iterations.
- sample008: 10.138 s, cost 3.285, 1,567,708 iterations.
- sample011: 3.594 s, cost 1.835, 367,853 iterations.

Although each individual join did less work, the weaker join choices caused
substantially more work in later partial-rip rounds. Reverted to 24.

## Trial 4 - raise per-frontier travel limit from 24 mm to 32 mm (rejected)

The same four focused cases produced identical costs and iteration counts to
Trial 2. No selected route needed the additional frontier reach; elapsed time
was slightly noisier/slower. Reverted to 24 mm.

## Trial 5 - partial-rip window sweep (8, 14, and 16 mm; rejected)

Focused samples 001/007/008/011 were run at each distance.

- 8 mm was faster on some cases but regressed costs to 3.130 on sample001 and
  3.400 on sample008.
- 14 mm regressed sample001 to 1.746 and sample008 to 3.400.
- 16 mm improved costs (0.963/0.764/2.224/1.590) but increased the four-case
  iteration total by roughly 24% versus 12 mm and dropped the projected suite
  speed below the requested 5x range.

The 12 mm window remains the best speed/quality balance.

## Trial 6 - cap partial-rip exploration at six rounds (accepted)

Command: `./benchmark.sh`

- Success: 8/8 cases, 2,001/2,001 routes.
- Total completion time: 16.871 s (5.66x faster).
- Average duration: 2.109 s; P50 1.598 s; P95 4.065 s.
- Average maximum region cost: 1.530 (34.4% better than main and 45.4%
  below the allowed 2.800 aggregate ceiling).
- Average solver iterations: 219,249.0 (83.6% fewer than main).
- Per-case duration: 1.387, 1.598, 0.858, 2.495, 4.065, 1.456,
  1.741, and 3.271 s.
- Per-case max cost: 1.237, 1.543, 0.797, 1.133, 3.313, 1.267,
  1.359, and 1.590.

The sample008 score is 18.1% above its original 2.806 and therefore remains
inside the requested per-case tolerance as well as the aggregate tolerance.

## Trial 7 - cap partial-rip exploration at five rounds (rejected)

Focused samples were slightly faster, but sample001 regressed to 1.461, 33.9%
above its original 1.091 score. Reverted to six rounds.

## Trial 8 - bounded connector distance (accepted aggregate setting)

Added an explicit combined-distance check to ensure that a joined path can be
split between the two frontiers without either side exceeding its 24 mm travel
budget. A deliberately over-budget regression fixture confirms that the solver
falls back safely to its established one-ended search.

Command: `./benchmark.sh`

- Success: 8/8 cases, 2,001/2,001 routes.
- Total completion time: 15.725 s (6.07x faster than main's 95.441 s).
- Average duration: 1.966 s; P50 1.396 s; P95 4.138 s.
- Average maximum region cost: 1.530 (34.4% better than main's 2.333 and
  45.4% below the allowed 2.800 aggregate ceiling).
- Average solver iterations: 219,249.0 (83.6% fewer than main's 1,335,770.1).
- Per-case duration: 1.376, 1.396, 0.687, 2.416, 4.138, 1.273,
  1.534, and 2.906 s.
- Per-case max cost: 1.237, 1.543, 0.797, 1.133, 3.313, 1.267,
  1.359, and 1.590.

Verification: `bun run typecheck`, `bun run build`, `git diff --check`, and
all 100 non-image-snapshot tests pass. The repository's three image-snapshot
files remain unavailable in this environment because the pre-existing optional
Sharp Darwin ARM64 native binary is absent; the failures occur while importing
the snapshot helper, before solver code executes.

## Trial 9 - strict per-case quality sweep

Although Trial 8 exceeded the aggregate quality target, sample007's 1.133 cost
was more than 20% above its original 0.527. Additional focused trials treated
the tolerance as a per-case requirement:

- Fixed 20 mm partial windows: sample007 cost 0.838 in 2.682 s.
- Fixed 24 mm partial windows: sample007 cost 0.775 in 2.877 s.
- Fixed 32 mm partial windows: sample007 cost 0.834 in 3.016 s (rejected).
- Fixed 24 mm windows with ten rounds: sample007 cost 0.629 in 3.121 s,
  inside its 0.632 tolerance ceiling. Across the suite this took 21.294 s
  (4.48x faster) and averaged 1.404, but sample001 regressed to 1.685, so the
  fixed setting was rejected.
- Staging 12 mm windows before switching to 24 mm preserved sample001 but left
  sample007 between 0.717 and 0.730, outside its strict ceiling (rejected).

The useful signal was the first completed solution's relationship to the final
rip threshold: sample007 begins near the target and needs a wider repair from
the first round, while highly congested cases benefit from local repairs.

## Final verification - threshold-relative quality recovery

Implementation: latch a 24 mm quality-recovery window when the first completed
solution's maximum hot-region cost is no more than 1.5 times the configured
final rip threshold. Otherwise retain the fast 12 mm window. Both modes use at
most ten partial-rip rounds and always restore the best complete snapshot.

Command: `./benchmark.sh`

- Success: 8/8 cases, 2,001/2,001 routes.
- Total completion time: 18.717 s (5.10x faster than main's 95.441 s).
- Average duration: 2.340 s; P50 1.473 s; P95 5.364 s.
- Average maximum region cost: 1.425 (38.9% better than main's 2.333).
- Average solver iterations: 270,910.0 (79.7% fewer than main's 1,335,770.1).
- Per-case duration: 1.465, 0.984, 1.021, 3.369, 5.364, 1.473,
  1.716, and 3.326 s.

| Sample | Original cost | Final cost | Change |
| --- | ---: | ---: | ---: |
| sample001 | 1.091 | 1.237 | +13.4% |
| sample003 | 6.353 | 1.543 | -75.7% |
| sample005 | 1.492 | 0.797 | -46.6% |
| sample007 | 0.527 | 0.629 | +19.4% |
| sample008 | 2.806 | 2.834 | +1.0% |
| sample009 | 1.492 | 1.492 | 0.0% |
| sample010 | 1.686 | 1.278 | -24.2% |
| sample011 | 3.217 | 1.590 | -50.6% |

Every case is now within 20% of its own original score or better, in addition
to the stronger aggregate result.

Verification: `bun run typecheck`, `bun run build`, `git diff --check`, and all
101 non-image-snapshot tests pass. As noted in Trial 8, the three remaining
snapshot files cannot import their pre-existing optional Sharp native binary in
this environment; they fail before any solver code runs.
