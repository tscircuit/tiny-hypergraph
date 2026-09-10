# RV1106 full-board graph reproduction

This is the full remaining-phase input of the 50 × 50 mm, four-layer RV1106G2
board. Components are on top, and the schematic uses automatic layout and
sections without manual coordinates.

The graph contains 9,434 ports, 2,527 regions, 244 internal routes, and 90
preloaded segment assignments from the completed clock and flash phases.
It was captured before iteration 1 using autorouter commit
`2d4ebf7548dbaea30ed39178d2a187b40515bbf8` and its tiny-hypergraph dependency
`c1043b3043ddf0c4d841fe5a6d9a515165960911`. The replay uses this checkout's solver.

Run from the repository root:

```sh
RV1106_FULL_REPRO=1 bun test tests/solver/rv1106-full-board.test.ts
```

In the repro PR, the shared snapshot shows the initial graph. The stacked fix PR
refreshes that same snapshot after running the solver. The test is opt-in because
the full search can take many minutes. The [full-board SVG](../../solver/__snapshots__/rv1106-full-board.snap.svg) is the single graph snapshot.
`partial-board.png` provides PCB component context; it is not a completed PCB.

The fixture preserves typed arrays and non-finite numeric options. Its helper
preserves the autorouter's initial-assignment behavior without adding an autorouter
dependency. The original board source and remaining-phase SRJ are included here.

Graph acceptance is not proof of completed, DRC-validated PCB routing. The
owner-mask optimization preserves route-selection behavior; an initial-to-final
snapshot is not an unoptimized-versus-optimized speed comparison.
