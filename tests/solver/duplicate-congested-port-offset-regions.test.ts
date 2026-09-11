import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "lib/index"

test("duplicated crossings stay on the shared edge of offset neighboring regions", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "start-a",
        pointIds: ["sa"],
        d: { center: { x: -3, y: 0.5 }, width: 2, height: 1 },
      },
      {
        regionId: "start-b",
        pointIds: ["sb"],
        d: { center: { x: -3, y: 1.5 }, width: 2, height: 1 },
      },
      {
        regionId: "left",
        pointIds: ["sa", "sb", "shared"],
        d: { center: { x: -1, y: 0 }, width: 2, height: 4 },
      },
      {
        regionId: "right",
        pointIds: ["shared", "ea", "eb"],
        d: { center: { x: 1, y: 1 }, width: 2, height: 2 },
      },
      {
        regionId: "end-a",
        pointIds: ["ea"],
        d: { center: { x: 3, y: 0.5 }, width: 2, height: 1 },
      },
      {
        regionId: "end-b",
        pointIds: ["eb"],
        d: { center: { x: 3, y: 1.5 }, width: 2, height: 1 },
      },
    ],
    ports: [
      {
        portId: "sa",
        region1Id: "start-a",
        region2Id: "left",
        d: { x: -2, y: 0.5, z: 0 },
      },
      {
        portId: "sb",
        region1Id: "start-b",
        region2Id: "left",
        d: { x: -2, y: 1.5, z: 0 },
      },
      {
        portId: "shared",
        region1Id: "left",
        region2Id: "right",
        d: { x: 0, y: 0.5, z: 0 },
      },
      {
        portId: "ea",
        region1Id: "right",
        region2Id: "end-a",
        d: { x: 2, y: 0.5, z: 0 },
      },
      {
        portId: "eb",
        region1Id: "right",
        region2Id: "end-b",
        d: { x: 2, y: 1.5, z: 0 },
      },
    ],
    connections: [
      {
        connectionId: "a",
        startRegionId: "start-a",
        endRegionId: "end-a",
        mutuallyConnectedNetworkId: "a",
      },
      {
        connectionId: "b",
        startRegionId: "start-b",
        endRegionId: "end-b",
        mutuallyConnectedNetworkId: "b",
      },
    ],
  }
  const solver = new DuplicateCongestedPortSolver(graph)
  solver.solve()
  const duplicate = solver
    .getOutput()
    .ports.find((port) => port.portId === "shared::dup1")
  expect(duplicate).toBeDefined()
  expect(duplicate!.d!.x).toBe(0)
  expect(duplicate!.d!.y).toBeGreaterThan(0.5)
  expect(duplicate!.d!.y).toBeLessThanOrEqual(0.55)
  expect(graph.ports).toHaveLength(5)
})
