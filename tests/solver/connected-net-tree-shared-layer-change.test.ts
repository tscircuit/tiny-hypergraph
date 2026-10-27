import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"
import { createConnectedNetTreeFixture } from "tests/fixtures/connected-net-tree.fixture"

test("a copied preloaded tail preserves explicit port and layer transitions", () => {
  const { topology, problem } = createConnectedNetTreeFixture()
  topology.portZ[2] = 1
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    DYNAMIC_CONNECTED_NET_TREES: true, STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_START: 100, RIP_THRESHOLD_END: 100, RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.connectedTreeCopiedLayerChangeCount).toBe(2)
  expect(solver.stats.connectedTreeCopiedSegmentCount).toBe(2)
  const replay = loadSerializedHyperGraph(solver.getOutput())
  expect([...replay.topology.portZ]).toEqual([0, 0, 1, 0, 0])
  expect(replay.solution.solvedRoutePathSegments[1]).toEqual([[0, 1], [1, 2], [2, 3]])
})
