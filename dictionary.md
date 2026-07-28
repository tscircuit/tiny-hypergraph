# Tiny Hypergraph Vocabulary

The `lib2` code uses a small vocabulary so names stay predictable. New names
should be built from these roots unless the domain clearly needs a new word.

1. `graph` - the full hypergraph input, loaded model, or output.
2. `region` - a traversable area in the graph.
3. `port` - a boundary point connecting regions.
4. `route` - one connection to solve from start port to end port.
5. `net` - electrical ownership for routes, ports, and reserved regions.
6. `hop` - one searchable state of port plus next region.
7. `path` - the ordered ports and regions chosen for a route.
8. `segment` - one routed edge inside a region.
9. `cost` - routing penalty or quality score.
10. `state` - mutable solver working data.
11. `queue` - frontier used by route search.
12. `cache` - stored derived data reused during solving.
13. `solve` - run routing work to completion or failure.
14. `parse` - convert boundary input into a trusted shape.
15. `load` - adapt serialized graph data to solver topology/problem data.
16. `result` - explicit success or failure value.
17. `error` - typed expected failure information.
18. `section` - a selected subgraph span optimized after full-graph routing.
19. `candidate` - one option considered during route or section search.
20. `srj` - simple route JSON style dataset/input family.

Example: `srjGraphResult` is acceptable because it combines `srj`, `graph`,
and `result`. Avoid inventing synonyms like `node`, `vertex`, `task`,
`payload`, or `manager` when one of these roots fits. `lib2` is allowed as the
version boundary name; it is not a domain root.
