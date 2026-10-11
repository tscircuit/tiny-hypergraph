# Checked topology and transition model

This is a bounded-scope Lean 4 verification of a model derived from
`lib/core.ts` at repository revision
`c60c55266323974507ca3de06ff6ff3c4860436d`. It does **not** establish full
TypeScript solver correctness. Lean 4.19.0 is pinned and only `Std` is imported.

## Reproduce

From this `verification` directory, with elan installed:

```sh
~/.elan/bin/lake build
~/.elan/bin/lake env lean TinyHypergraph.lean
~/.elan/bin/lake env lean --run Main.lean
```

The first two commands check the proofs; the second also prints every exported
theorem's axiom dependencies. The final command emits CSV with header
`first,second,current,next`: all 24 transitions for distinct incidence endpoints
in `[0,4)` with current equal to an endpoint. This stream supports independent
TypeScript cross-checks without hand-transcribing Lean results. Use the
interpreter command above: on this macOS host the native executable built by
`lake exe transition-fixtures` failed at launch with a dyld `SG_READ_ONLY` flag
error; the interpreter and proof checks succeeded.

Every theorem checked with no `sorry`, `admit`, or custom axiom. Axiom output is
either empty or `[propext]` (Lean's standard propositional extensionality).
`neighbor_segment_valid`, `path_final_valid`, `path_extension_segment_valid`,
and `reset_segments_valid` have no axiom dependencies. No classical choice,
quotient soundness, or native-decide axiom is used by these final proofs.

## Contract and exact implementation mapping

| Model | Source at recorded revision | Obligation/result |
| --- | --- | --- |
| `Topology`, `WellFormed` | `TinyHyperGraphTopology`, lines 90–121 | Bounded port/region IDs and reciprocal incidence are explicit **premises**, not established input validation. |
| `opposite` | neighbor selection, lines 765–769 | Exactly `first === current ? second : first` for defined nonnegative integer entries. Selected endpoint is incident and bounded. Distinct endpoints plus current incidence imply crossing to a different region. |
| `neighbor_candidate_valid` | lines 745–808 | A neighbor in the current region and two actual incidence endpoints give a valid next candidate; reservations/cost filters only remove transitions. |
| `reciprocal_two_endpoint_crossing` | same loop | With incidence row exactly `[first, second]`, reciprocity establishes the current-region premise; distinct endpoints establish a different next region. |
| `neighbor_segment_valid` | goal branch, lines 752–759 | Both candidate port and discovered goal/neighbor share the expanded region. |
| `CandidatePath`, `path_extension_segment_valid` | predecessor reconstruction, lines 1068–1109 | A valid modeled predecessor edge yields a valid segment. Finite acyclic chain correspondence is an assumption. |
| `append_segments_preserves` | `onPathFound`, lines 1581–1600 | Appending valid segments preserves segment validity in a flat abstraction of region-indexed storage. |
| `reset_segments_valid` | `resetRoutingStateForRerip`, lines 1113 onward | Clearing all segment lists preserves validity. |
| `filter_segments_preserves` | abstract auxiliary result only | Removing elements preserves validity. The actual rerip currently clears everything; this does not assert selective removal exists. |

A valid segment has a bounded route and region, bounded endpoint ports, and
both endpoints in that region. A valid candidate's port is incident to its
bounded next region. These are structural invariants. They do not imply
collision freedom, optimality, endpoint reachability, or eventual progress.

The model intentionally uses adjacency **lists**, not mathematical sets; it
makes no global uniqueness claim. Reciprocity is membership equivalence.
Distinct endpoints are required only for the crossing theorem. The two-slot
conditional is modeled exactly; generalized incidence rows with more than two
regions are not claimed to have complete exploration. In particular, incident
endpoint selection is weaker than proving all possible transitions are explored.

## Representation and numerical assumptions

* IDs are mathematical natural numbers in Lean. Correspondence requires actual
  JS values to be finite integers in range, with array shapes matching counts.
  Values stored in signed `Int32Array` must also fit `0..2147483647`; reserved
  negative sentinels must be handled outside the ID model. JS undefined,
  fractional IDs, wrapping on typed-array writes, and out-of-range reads are
  not equivalent to these naturals.
* Costs, coordinates, angle quantization, bit masks, geometric intersections,
  `Float64Array`, overflow, NaN, infinity, and queue ordering are not modeled.
  The structural theorem applies to any transition that survives the actual
  filters; it does not establish that those filters accept all legal paths.
* Assignment/cache updates, snapshot copying, serializer round trips, net
  ownership, array mutation aliasing, and endpoint reservation correctness are
  not proved by flat-list append/reset facts.
* A Lean inductive path is finite by construction. This is not a termination
  argument for the solver, its rerip loop, or reconstruction of arbitrary
  external/mutated JavaScript candidate objects. The model does not claim
  progress or completeness from local transition validity.

Implementation tests and concrete counterexamples are separate evidence for
correspondence. Even an exhaustive test over a small finite topology domain is
not a proof about all JavaScript executions. The shared serialized interface
must establish IDs, references and incidence before these assumptions can be
used across the autorouter boundary.

## Executable implementation bridge

From the repository root:

```sh
LEAN_LAKE="$HOME/.elan/bin/lake" bun scripts/verification-cross-check.ts
bun test tests/verification/transition-contract.test.ts
```

The bridge runs the Lean CSV emitter and compares all 24 fixture rows to actual
solver candidate queues. The TypeScript suite exercises 252 chain solver runs
(lengths 2–7 and endpoint orientations), rerip resets and serialization round
trips with 13,074 assertions. These finite checks complement the conditional
model proofs. The path theorem establishes a **local extension's segment
validity**, not a theorem equating the full JavaScript reconstruction output
with a global continuous Lean path.
