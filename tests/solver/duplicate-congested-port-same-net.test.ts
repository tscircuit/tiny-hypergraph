import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "lib/index"

test("same-net routes share a crossing without allocating duplicate ports", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "start",
        pointIds: ["left"],
        d: { center: { x: -2, y: 0 }, width: 2, height: 2 },
      },
      {
        regionId: "middle",
        pointIds: ["left", "right"],
        d: { center: { x: 0, y: 0 }, width: 2, height: 2 },
      },
      {
        regionId: "end",
        pointIds: ["right"],
        d: { center: { x: 2, y: 0 }, width: 2, height: 2 },
      },
    ],
    ports: [
      {
        portId: "left",
        region1Id: "start",
        region2Id: "middle",
        d: { x: -1, y: 0, z: 0 },
      },
      {
        portId: "right",
        region1Id: "middle",
        region2Id: "end",
        d: { x: 1, y: 0, z: 0 },
      },
    ],
    connections: [
      {
        connectionId: "ground-a",
        startRegionId: "start",
        endRegionId: "end",
        mutuallyConnectedNetworkId: "ground",
      },
      {
        connectionId: "ground-b",
        startRegionId: "start",
        endRegionId: "end",
        mutuallyConnectedNetworkId: "ground",
      },
    ],
  }
  const solver = new DuplicateCongestedPortSolver(graph)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.report.portUseCounts).toEqual({ left: 1, right: 1 })
  expect(solver.report.duplicatedPorts).toHaveLength(0)
  expect(solver.getOutput().ports).toEqual(graph.ports)
})
