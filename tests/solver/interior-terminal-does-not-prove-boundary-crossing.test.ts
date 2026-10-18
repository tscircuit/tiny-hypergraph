import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"

test("interior pins do not force boundary crossings", (): void => {
  const points = [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 0.5 },
  ]
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "center",
        pointIds: ["p0", "p1", "p2", "p3"],
        d: {
          center: { x: 0, y: 0 },
          width: 2,
          height: 2,
          availableZ: [0],
        },
      },
      ...points.map((point, index) => ({
        regionId: `terminal${index}`,
        pointIds: [`p${index}`],
        d: {
          center: point,
          width: 0.001,
          height: 0.001,
          availableZ: [0],
        },
      })),
    ],
    ports: points.map((point, index) => ({
      portId: `p${index}`,
      region1Id: "center",
      region2Id: `terminal${index}`,
      d: { ...point, z: 0 },
    })),
    connections: [
      {
        connectionId: "left-to-right",
        mutuallyConnectedNetworkId: "horizontal-net",
        startRegionId: "terminal0",
        endRegionId: "terminal1",
      },
      {
        connectionId: "bottom-to-interior",
        mutuallyConnectedNetworkId: "vertical-net",
        startRegionId: "terminal2",
        endRegionId: "terminal3",
      },
    ],
  }
  // The left-to-right path may bend above the interior endpoint. Only four
  // boundary endpoints with alternating order force a topological crossing.
  for (const Solver of [
    TinyHyperGraphSolver,
    SelectiveReripTinyHyperGraphSolver,
  ]) {
    for (const ownedFrontier of [false, true]) {
      const loaded = loadSerializedHyperGraph(graph)
      const solver = new Solver(loaded.topology, loaded.problem, {
        MAX_ITERATIONS: 100,
        OWNED_REGIONAL_HOP_FRONTIER: ownedFrontier,
      })
      solver.solve()
      expect(solver.failed, solver.error ?? "").toBeFalse()
      expect(solver.solved).toBeTrue()
      expect(
        solver.state.regionIntersectionCaches[0]!.existingSameLayerIntersections,
      ).toBe(1)
    }
  }
})
