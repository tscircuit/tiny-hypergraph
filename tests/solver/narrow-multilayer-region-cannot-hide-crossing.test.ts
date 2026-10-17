import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"

test("a multilayer region without via clearance cannot accept a same-layer crossing", (): void => {
  for (const width of [0.21, 1]) {
    const points = [{ x: -width / 2, y: 0 }, { x: width / 2, y: 0 }, { x: 0, y: -0.5 }, { x: 0, y: 0.5 }]
    const graph: SerializedHyperGraph = {
      regions: [
        { regionId: "center", pointIds: ["p0", "p1", "p2", "p3"], d: { center: { x: 0, y: 0 }, width, height: 1, availableZ: [0, 1] } },
        ...points.map((point, i) => ({ regionId: `t${i}`, pointIds: [`p${i}`], d: { center: point, width: 0.001, height: 0.001, availableZ: [0] } })),
      ],
      ports: points.map((point, i) => ({ portId: `p${i}`, region1Id: "center", region2Id: `t${i}`, d: { ...point, z: 0 } })),
      connections: [{ connectionId: "horizontal", startRegionId: "t0", endRegionId: "t1" }, { connectionId: "vertical", startRegionId: "t2", endRegionId: "t3" }],
    }
    const { topology, problem } = loadSerializedHyperGraph(graph)
    problem.enforceViaFit = true
    problem.viaBoundaryClearance = 0.1524 / 2 + 0.1
    const solver = new TinyHyperGraphSolver(topology, problem, { minViaPadDiameter: 0.2032, MAX_ITERATIONS: 100, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true })
    solver.solve()
    expect(solver.solved).toBe(width === 1)
    expect(solver.failed).toBe(width === 0.21)
  }
})
