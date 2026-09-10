# RV1106 full-board graph reproduction

This captures the entire remaining-net graph of the revised 50 × 50 mm,
four-layer RV1106G2 board. All components are on top. The schematic uses
automatic layout and schematic sections, without manual schematic coordinates.

The clock and flash phases completed first (21 cumulative PCB traces).
`partial-board.png` shows that state. It is **not a completed routed board**.

The full graph fixture contains 9,434 ports, 2,527 regions, 244 internal routes,
and 90 initial segment assignments. It was captured at solver iteration zero
from autorouter commit `2d4ebf7548dbaea30ed39178d2a187b40515bbf8`, using the
saved remaining-phase SRJ. Tiny-hypergraph baseline:
`c1043b3043ddf0c4d841fe5a6d9a515165960911`.

The fixture preserves typed arrays and non-finite numeric options. The test
helper reproduces the autorouter's initial-assignment preservation behavior.
No autorouter dependency is needed to replay the captured graph.

Run from the tiny-hypergraph repository root:

```sh
bun test tests/solver/rv1106-full-board.test.ts
bun scripts/rv1106-full-board.ts 50000
bun scripts/rv1106-full-board.ts
RV1106_FULL_REPRO=1 bun test tests/solver/rv1106-full-board-completed.test.ts
```

The test stops at 50,000 iterations and checks the routing-state hash against
the original autorouter instance, plus 15 selective rip-ups removing 22 routes.
Its SVG shows the initial and incomplete search states. It does not assert
successful routing. The last command runs to completion or the configured
2,000,000-iteration solver limit; individual steps may take a long time.
The script writes `rv1106-result.svg` when it finishes.
The opt-in completed-graph test compares with the actual optimized full-run SVG.
It checks graph acceptance, not downstream PCB DRC.
The expected SVG was produced by the completed full-run script; the opt-in test
was not repeated for another ten-minute run and is skipped in normal CI.

`before-full-graph.png` and `optimized-full-graph.png` show the initial and
accepted final graph states. These are not an unoptimized-versus-optimized A/B
comparison. The optimized run accepted a graph solution at 2,000,000 iterations
after 641,001 ms. The integrated autorouter then reached route repair but was
stopped at a 900-second external deadline. The PCB is not fully routed or
DRC-validated. The result JSON and pipeline log are included beside the images.

The owner-mask optimization under test is commit
`282faddb610e863219ab7579f1ebe0e38cb11fbf` (tiny-hypergraph PR #181).
It changes owner-subset comparison cost, not the route-selection rules.
Passing the short snapshot test does not prove that this optimization completes
the board. Even a solved tiny-hypergraph graph requires the downstream PCB
routing stages before it can be called a completed board.

`cli-timeout.json.gz` records the earlier stock CLI run: it timed out after
1,071,893 ms with a configured 15-minute timeout. That CLI run is separate from
the local optimized-solver experiment. The late timeout is consistent with a
synchronous search step delaying the timeout check.
