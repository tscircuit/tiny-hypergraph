import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"

test("non-crossing paths still cannot occupy physically overlapping ports", () => {
  const points = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0.05 }, { x: 1, y: 0.05 }]
  const graph: SerializedHyperGraph = {
    regions: [
      { regionId: "center", pointIds: points.map((_, i) => `p${i}`), d: { center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0] } },
      ...points.map((point, i) => ({ regionId: `t${i}`, pointIds: [`p${i}`], d: { center: point, width: 0.001, height: 0.001, availableZ: [0] } })),
    ],
    ports: points.map((point, i) => ({ portId: `p${i}`, region1Id: "center", region2Id: `t${i}`, d: { ...point, z: 0 } })),
    connections: [0, 1].map((i) => ({ connectionId: `net${i}`, mutuallyConnectedNetworkId: `net${i}`, startRegionId: `t${i * 2}`, endRegionId: `t${i * 2 + 1}` })),
  }
  for (const Solver of [TinyHyperGraphSolver, SelectiveReripTinyHyperGraphSolver]) {
    for (const physicalConflicts of [false, true]) {
      const { topology, problem } = loadSerializedHyperGraph(graph)
      if (physicalConflicts) problem.portConflicts = [[2], [3], [0], [1]]
      const solver = new Solver(topology, problem, { MAX_ITERATIONS: 100, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true })
      solver.solve()
      expect(solver.solved).toBe(!physicalConflicts)
      expect(solver.failed).toBe(physicalConflicts)
    }
  }
})
