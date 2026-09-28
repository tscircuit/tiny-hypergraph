# Stable boundary buckets for nearest-port search

Check with Lean 4.28.0 (only its bundled `Std` library is required):

```sh
~/.elan/bin/lean +leanprover/lean4:v4.28.0 proofs/BoundaryNearest.lean
```

The target is `DuplicateCongestedPortSolver.ts`: repeated
`findNearestPortOnSameBoundary` queries previously traversed every original port
and recomputed boundary keys. Building boundary buckets once permits each query
to visit just its boundary, in the original order.

## Correspondence

- `Port` denotes the original serialized ports, including duplicate IDs if present.
  `Key` is the exact string returned by `getBoundaryKey`; the implementation keeps
  its existing sorted region IDs joined with NUL. The proof does **not** assume
  this encoding is injective. Any pre-existing key collisions remain collisions.
- `appendPort` models a `Map` lookup followed by array `push`. `buildBuckets`
  models the one forward grouping pass. Its function-valued map is an abstract
  lookup model, not a proof of the JavaScript engine's `Map` implementation.
- `bucket_eq_filter` proves each constructed bucket equals the corresponding
  stable filter, as a list, not merely as a set. Duplicate entries and their order
  are preserved. Bucket construction uses `this.serializedHyperGraph.ports`,
  never the output array to which generated duplicates are appended.
- `State` includes `nearestPort` and `nearestDistance`. `step` is the unchanged
  same-ID check, `getPortPoint` and `Math.hypot` calculation, rejection on
  `distance <= EPSILON || distance >= nearestDistance`, and accumulator update.
  `bucket_scan_eq` proves equality of the complete final accumulator for **every**
  transition function and initial state. `same_id_guard_order` separately covers
  the original same-ID check preceding the boundary-key check.
- `guardedStep` and `rejected_port_preserves_state` describe the unchanged guard:
  whenever the JavaScript rejection Boolean is true the previous winner remains.
  Consequently equal finite distances still keep the first eligible port. The
  stronger arbitrary-transition theorem also preserves other cases without
  assuming a total ordering of floating-point values.

## Floating point and determinism

No arithmetic expression is rearranged or approximated. The equivalence does
not use real-number distance laws, a triangle inequality, transitivity of a
floating-point comparison, or finiteness assumptions. The unchanged JavaScript
transition can be instantiated even with NaNs, infinities, signed zeros, and
its original comparison results. Removing other-boundary entries removes only
identity transitions. Stable bucket order retains all same-boundary computations
in the original order and therefore retains tie handling and the selected port.

The source input and key fields must remain unchanged between grouping and
queries. This is the synchronous `duplicateCongestedPorts` invocation: generated
ports go into a separate output array. As with the existing code, the scope is
ordinary serialized data; custom accessor side effects, concurrent mutation,
and monkey-patched JavaScript built-ins are not modeled. Lean checks the
algorithmic refinement; it does not mechanically translate the TypeScript or
verify JavaScript runtime internals. The implementation/proof mapping must still
be reviewed and covered by differential tests.

## Search effort

`bucket_length_le` proves that each query visits no more entries than the full
scan. `query_visits_le` sums this bound across any list of queries.
`full_visits_decomposition` gives the exact accounting:

```text
Q*N = retained bucket visits + off-boundary omitted visits
```

`preprocessing_pays_iff` proves that grouping plus bucket scans have strictly
fewer entry visits **if and only if** total omitted visits exceed `N`, the cost
of the one grouping pass. This measurable effort condition is not an assumption
of correctness; `bucket_scan_eq` is unconditional. Entry visits count even ports
rejected by the same-ID guard. They must not be confused with distance calls or
boundary-key computations.

The baseline computes one source key per query and repeats key sort/join for
original ports except those rejected by the same-ID check. The candidate
computes `N + Q` keys: once per original port during grouping, then once per
query. Both versions perform the same distance evaluations on retained ports
that pass the same-ID check, in the same order. Thus the reduction removes
repeated full-array traversal and boundary-key construction; it does not depend
on Bun, browser JIT behavior, or an arithmetic shortcut.

The proof does not claim that map lookups are constant time, that preprocessing
is free, or that every input becomes faster. Runtime and memory measurements
must supplement the exact visit reduction on the selected workload. Historical
runs with unmatched revisions or environments do not establish a speedup.

No custom axioms, `sorry`, or `admit` are used.
