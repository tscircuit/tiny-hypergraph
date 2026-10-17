import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"

test("a physical via cannot skip a blocked intermediate layer", (): void => {
  for (const availableZ of [[0, 2], [0, 1, 2]]) {
    const graph: SerializedHyperGraph = {
      regions: [
        {
          regionId: "center",
          pointIds: ["a", "b"],
          d: { center: { x: 0, y: 0 }, width: 1, height: 1, availableZ },
        },
        ...[0, 2].map((z) => ({
          regionId: `terminal-${z}`,
          pointIds: [z === 0 ? "a" : "b"],
          d: { center: { x: 0, y: 0 }, width: 0.001, height: 0.001, availableZ: [z] },
        })),
      ],
      ports: [0, 2].map((z) => ({
        portId: z === 0 ? "a" : "b",
        region1Id: "center",
        region2Id: `terminal-${z}`,
        d: { x: 0, y: 0, z },
      })),
      connections: [{ connectionId: "signal", startRegionId: "terminal-0", endRegionId: "terminal-2" }],
    }
    const { topology, problem } = loadSerializedHyperGraph(graph)
    problem.enforceViaFit = true
    const solver = new TinyHyperGraphSolver(topology, problem, {
      minViaPadDiameter: 0.2032,
      MAX_ITERATIONS: 100,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    })
    solver.solve()
    expect(solver.solved).toBe(availableZ.length === 3)
    expect(solver.failed).toBe(availableZ.length === 2)
  }
})
