# Boundary bugs and implementation evidence

Current-base audit: fetched and merged `origin/main` at
`0750fa4c95e25a61d0e9e7250aa08c2046e671d8` on 2026-09-28. The loader is
unchanged between the historical baseline below and that main revision, so
both defects still apply. Main adds trace-density costs and closed-route
serialization support; the modeled incidence/neighbor/commit/reset operations
are unchanged. Focused round-trip tests cover the refreshed serializer. The
proof source line references remain explicitly tied to the historical baseline;
they are not current line numbers. No performance improvement is claimed, and
no consumer dependency is bumped by this PR.

Inspected baseline: `c60c55266323974507ca3de06ff6ff3c4860436d`.
The coordinating autorouter checkout is based on
`8e8adc693d63f89583b71862f7c39c9d82791a79`, which pins tiny-hypergraph
`c1043b3043ddf0c4d841fe5a6d9a515165960911`. These are different solver
revisions. `git diff c1043b3043ddf0c4d841fe5a6d9a515165960911
c60c55266323974507ca3de06ff6ff3c4860436d --
lib/compat/loadSerializedHyperGraph.ts` is empty: both loader bugs below also
exist in that pin. No full solver equivalence between revisions is asserted.

## False successful path from inconsistent incidence

Use regions `s:[p]`, `a:[p,q]`, `b:[q]`, `t:[q]`, ports `p=(s,a)` and
`q=(b,t)`, and a connection `s -> t`. The endpoint graph has two disconnected
components. Before this fix, loading and solving reports success with `p -> q`
through `a`, even though `q` does not touch `a`.

The loader independently built `regionIncidentPorts` from `pointIds` and
`incidentPortRegion` from endpoint fields. The early goal branch in `core.ts`
trusted the former. This violates the reciprocal-incidence premise of the Lean
model. The loader now rejects both directions of disagreement, dangling point
references, duplicate region/port/connection IDs, and repeated point IDs.
Input rejection is deliberate; it does not guess which incidence view to trust.

The first test in `tests/compat/incidence-validation.test.ts` is the minimal
reproduction. Against the baseline loader it fails because the expected error
is not thrown. Its valid disconnected counterpart still fails routing.
An exhaustive test enumerates all 256 region-side incidence tables for the
fixed four-region/two-port endpoint graph; only the reciprocal table loads.

## Obstacle filtering leaves an invalid route endpoint candidate

Use source point IDs `[blocked,p]`, with `blocked` touching a full obstacle,
and a valid source-middle-target path through `p,q`. Filtering removed the
obstacle and its port but retained `blocked` in source `pointIds`. Endpoint
selection could choose that absent port and throw `could not be mapped to route
endpoints`. The filter now prunes removed port IDs from retained regions,
without mutating input. The regression loads and solves this graph successfully.

## Shared contract and reproducible checks

The sibling verification owns the autorouter adapter/legacy pathing solver;
this project owns tiny-hypergraph loading and numeric transition invariants.
`tests/verification/fixtures/chain.json` is the shared serialized fixture:
unique string IDs, reciprocal two-ended port incidence, existing connection
endpoints, and a named network. The sibling copied this exact fixture to test
the pinned adapter. Its independent results belong to its PR, not this Lean
proof claim.

From the repository root:

```sh
bun test tests/compat tests/verification tests/solver/get-output-roundtrip.test.ts
bun run typecheck
cd verification
~/.elan/bin/lake build
~/.elan/bin/lake env lean TinyHypergraph.lean
cd ..
LEAN_LAKE="$HOME/.elan/bin/lake" bun scripts/verification-cross-check.ts
```

The cross-check consumes 24 CSV rows emitted by Lean and compares each with
the actual solver's queued candidate. Separately, 252 chain configurations
cover lengths 2–7, all endpoint orientations, reversed region indexing,
segment commit ownership/incidence, reset, and serialization/reload. These
tests are finite correspondence evidence, not universal TypeScript proofs.

The dataset loader test previously swallowed unexpected errors. It now checks
104 successful hg07 samples and explicitly records the one existing baseline
failure: sample014, connection `source_trace_69`, cannot map route endpoints.
This change does not fix that unrelated input/endpoint limitation.

Final checks on this change: 129 Bun tests pass (14,401 assertions and one SVG
snapshot), TypeScript typecheck passes, all 11 Lean theorems check, and all 24
Lean-to-TypeScript transition comparisons pass. The existing chokepoint fixture
needed four omitted reciprocal port references restored. Its routing failure
assertions remain unchanged; the snapshot's final search candidate changes due
to the additional neighbor entries.

## Remaining scope

The runtime validator is for serialized topology. Direct numeric construction
can bypass it. It is not a complete JSON schema validator, geometry validator,
or solved-route validator. Self-loop endpoint pairs remain accepted; the Lean
different-region crossing theorem explicitly assumes distinct endpoints.
Finite coordinate/layer constraints are shared interface expectations, not
newly enforced guarantees here. Initial assignments, net indexing, cached
costs, output metadata, optimality and termination have not been universally
verified. Nat IDs require range and Int32 representation assumptions; all
floating-point cost/geometry semantics remain outside the Lean proofs.
