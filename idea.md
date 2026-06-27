# Lib2 Idea

Goal: create `lib2`, a clearer TypeScript-standard entrypoint for tiny
hypergraph solving while preserving current benchmark behavior.

The first version keeps the current hot solver as the execution engine. That is
intentional: the existing A* loop, intersection counting, typed-array state, and
rerip policy are performance-sensitive and already covered by regression tests.
`lib2` starts by making the boundary cleaner:

- typed `Result` values for expected parse/solve failures
- explicit serialized-graph parsing at the edge
- a named `TinyHyperGraphSolver2` facade that can be benchmarked separately
- benchmark flags for raw core comparisons
- a small vocabulary documented in `dictionary.md`

Next improvement target after this slice: move one cohesive hot module at a time
behind lib2 names, starting with region cache operations. That module has a good
chance to improve both readability and performance because the current append
path reallocates several typed arrays per committed segment.

Success rule for this slice:

- original test suite stays green
- new lib2 tests pass
- SRJ13 and CM5IO raw benchmarks can run with `--solver lib2`
- representative lib2 benchmark stats are the same as core within normal local
  noise because the engine is still shared
