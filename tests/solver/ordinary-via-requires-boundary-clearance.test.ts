import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"

test("ordinary vias reserve boundary clearance while explicit via sites retain their checked diameter", (): void => {
  for (const isLayerTransition of [false, true]) {
    const graph: SerializedHyperGraph = {
      regions: [
        { regionId: "center", pointIds: ["a", "b"], d: { center: { x: 0, y: 0 }, width: 0.21, height: 1, availableZ: [0, 1], isLayerTransition } },
        ...[0, 1].map(z => ({ regionId: `t${z}`, pointIds: [z === 0 ? "a" : "b"], d: { center: { x: 0, y: 0 }, width: 0.001, height: 0.001, availableZ: [z] } })),
      ],
      ports: [0, 1].map(z => ({ portId: z === 0 ? "a" : "b", region1Id: "center", region2Id: `t${z}`, d: { x: 0, y: 0, z } })),
      connections: [{ connectionId: "signal", startRegionId: "t0", endRegionId: "t1" }],
    }
    const { topology, problem } = loadSerializedHyperGraph(graph)
    problem.enforceViaFit = true
    problem.viaBoundaryClearance = 0.1524 / 2 + 0.1
    const solver = new TinyHyperGraphSolver(topology, problem, { minViaPadDiameter: 0.2032, MAX_ITERATIONS: 100, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true })
    solver.solve()
    expect(solver.solved).toBe(isLayerTransition)
    expect(solver.failed).toBe(!isLayerTransition)
  }
})
