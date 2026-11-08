import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"

test("serialized clearance conflicts are symmetric and reject invalid references", (): void => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "a",
        pointIds: ["p", "q"],
        d: { center: { x: 0, y: 0 }, width: 1, height: 1 },
      },
      {
        regionId: "b",
        pointIds: ["p", "q"],
        d: { center: { x: 1, y: 0 }, width: 1, height: 1 },
      },
    ],
    ports: [
      {
        portId: "p",
        region1Id: "a",
        region2Id: "b",
        d: { x: 0.5, y: 0, z: 0, clearanceConflictPortIds: ["q"] },
      },
      {
        portId: "q",
        region1Id: "a",
        region2Id: "b",
        d: { x: 0.5, y: 0.05, z: 0 },
      },
    ],
    connections: [],
  }
  const original = JSON.stringify(graph)
  expect(
    loadSerializedHyperGraph(graph).topology.portClearanceConflicts,
  ).toEqual([[1], [0]])
  expect(JSON.stringify(graph)).toBe(original)
  graph.ports[0]!.d!.clearanceConflictPortIds = ["missing"]
  expect(() => loadSerializedHyperGraph(graph)).toThrow(
    "Invalid clearance conflict",
  )
})
