# Full-connection reroute performance

A reroute attempt fixes every connection except one with initial assignments.
The ordinary solver's eager heuristic builds a `Float64Array` containing a
Euclidean distance for every port/connection pair. Rebuilding that table for
up to 64 attempts wastes work on the fixed connections.

Reroute attempts now default to the existing lazy heuristic. They calculate
exactly the same distance when expanding a candidate, without allocating the
`8 * portCount * routeCount` byte distance table on each attempt. Explicit
`USE_LAZY_ROUTE_HEURISTIC: false` remains supported for comparisons. Other
pipeline stages retain their configured heuristic behavior.

This changes computation, not the search policy: hot-region ordering, attempt
limits, per-attempt iteration limits, endpoint handling, and serialized
whole-graph acceptance checks remain unchanged. Regression tests compare exact
serialized routes, accepted counts, and final scores against eager mode.

The tradeoff is repeated distance calculations when a port is revisited.
Small graphs or searches with many expansions may see little benefit or even
extra arithmetic. Candidate construction, fixed-assignment replay, and full
serialization/reload also still cost time. The latter must preserve the
caller's metadata and policies and must not be removed based on in-memory
scores alone.

For downstream validation, use an autorouter PR stacked on the original
reroute integration and comment `/benchmark-all --same-machine`. Its workflow
resolves the PR base branch and runs base/head sequentially on one Blacksmith
runner. Although its report labels the base as “main,” this stack compares
against the parent reroute PR. Inspect port-point pathing time as well as
whole-pipeline time, completion, and route quality. End-to-end timing also
includes unrelated stages and normal runner variability.
