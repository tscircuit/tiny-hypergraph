import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"

test("physical obstacles restrict ordinary and final hops to their owning net", (): void => {
  const graph: SerializedHyperGraph = {
    regions: [
      { regionId: "center", pointIds: ["a", "b"], d: { center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0] } },
      { regionId: "start", pointIds: ["a"], d: { center: { x: -1, y: 0 }, width: 0.001, height: 0.001, availableZ: [0] } },
      { regionId: "end", pointIds: ["b"], d: { center: { x: 1, y: 0 }, width: 0.001, height: 0.001, availableZ: [0] } },
    ],
    ports: [
      { portId: "a", region1Id: "center", region2Id: "start", d: { x: -1, y: 0, z: 0 } },
      { portId: "b", region1Id: "center", region2Id: "end", d: { x: 1, y: 0, z: 0 } },
    ],
    connections: [{ connectionId: "net", mutuallyConnectedNetworkId: "net", startRegionId: "start", endRegionId: "end" }],
  }
  for (const Solver of [TinyHyperGraphSolver, SelectiveReripTinyHyperGraphSolver]) {
    for (const reservation of [-1, -2, 0, 1]) {
      const { topology, problem } = loadSerializedHyperGraph(graph)
      const net = problem.routeNet[0]!
      problem.portReservedNetId = Int32Array.from([-1, reservation === 0 ? net : reservation === 1 ? net + 1 : reservation])
      const solver = new Solver(topology, problem, { MAX_ITERATIONS: 100, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true })
      solver.solve()
      expect(solver.solved).toBe(reservation === -1 || reservation === 0)
      expect(solver.failed).toBe(reservation === -2 || reservation === 1)
    }
  }
})
