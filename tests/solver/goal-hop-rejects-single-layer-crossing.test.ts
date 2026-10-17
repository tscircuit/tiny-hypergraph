import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"

test("the final hop cannot cross another net in a single-layer region", () => {
  const points = [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
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
          availableZ: [7],
        },
      },
      ...points.map((point, index) => ({
        regionId: `terminal${index}`,
        pointIds: [`p${index}`],
        d: {
          center: point,
          width: 0.001,
          height: 0.001,
          availableZ: [7],
        },
      })),
    ],
    ports: points.map((point, index) => ({
      portId: `p${index}`,
      region1Id: "center",
      region2Id: `terminal${index}`,
      d: { ...point, z: 7 },
    })),
    connections: [
      {
        connectionId: "horizontal",
        mutuallyConnectedNetworkId: "horizontal",
        startRegionId: "terminal0",
        endRegionId: "terminal1",
      },
      {
        connectionId: "vertical",
        mutuallyConnectedNetworkId: "vertical",
        startRegionId: "terminal2",
        endRegionId: "terminal3",
      },
    ],
  }
  for (const Solver of [
    TinyHyperGraphSolver,
    SelectiveReripTinyHyperGraphSolver,
  ]) {
    for (const ownedFrontier of [false, true]) {
      const oneRoute = loadSerializedHyperGraph({
        ...graph,
        connections: graph.connections!.slice(0, 1),
      })
      const possible = new Solver(oneRoute.topology, oneRoute.problem, {
        MAX_ITERATIONS: 100,
        OWNED_REGIONAL_HOP_FRONTIER: ownedFrontier,
      })
      possible.solve()
      expect(possible.solved).toBeTrue()
      const bothRoutes = loadSerializedHyperGraph(graph)
      const impossible = new Solver(bothRoutes.topology, bothRoutes.problem, {
        MAX_ITERATIONS: 100,
        OWNED_REGIONAL_HOP_FRONTIER: ownedFrontier,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
      })
      impossible.solve()
      expect(impossible.solved).toBeFalse()
      expect(impossible.failed).toBeTrue()
      expect(
        impossible.state.regionIntersectionCaches[0]!
          .existingSameLayerIntersections,
      ).toBe(0)
    }
  }
})
