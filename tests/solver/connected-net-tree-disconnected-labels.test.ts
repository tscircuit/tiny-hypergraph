import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"
import { createConnectedNetTreeFixture } from "tests/fixtures/connected-net-tree.fixture"

test("same-net terminal assignments and coincident XY ports cannot create connected goals", () => {
  const { topology, problem } = createConnectedNetTreeFixture()
  problem.initialAssignments = undefined
  problem.routeCount = 1
  problem.routeStartPort = new Int32Array([0])
  problem.routeEndPort = new Int32Array([3])
  problem.routeNet = new Int32Array([7])
  topology.regionIncidentPorts[1] = [1]
  topology.regionIncidentPorts[4] = [2, 3]
  topology.incidentPortRegion[2] = [2, 4]
  topology.portX[1] = topology.portX[3]!
  topology.portZ[1] = 1
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    DYNAMIC_CONNECTED_NET_TREES: true, STATIC_REACHABILITY_PRECHECK: false,
  })
  solver._setup()
  solver.state.portAssignment.fill(7)
  solver._step()
  solver._step()
  expect(solver.solved).toBe(false)
  expect(solver.state.currentRouteId).toBe(0)
  expect(solver.state.regionSegments.flat()).toHaveLength(0)
  expect(solver.stats.connectedTreeGoalPortCount).toBe(1)
})
