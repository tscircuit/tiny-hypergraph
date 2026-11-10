import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

test("shared-port loading preserves filtered obstacles, empty inputs and invalid-region errors", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      { regionId: "a", pointIds: ["kept", "removed"], d: {} },
      { regionId: "b", pointIds: ["kept"], d: {} },
      {
        regionId: "blocked",
        pointIds: ["removed"],
        d: { _containsObstacle: true },
      },
    ],
    ports: [
      {
        portId: "kept",
        region1Id: "a",
        region2Id: "b",
        d: { x: 0, y: 0, z: 0 },
      },
      {
        portId: "removed",
        region1Id: "a",
        region2Id: "blocked",
        d: { x: 1, y: 0, z: 0 },
      },
    ],
    connections: [
      { connectionId: "direct", startRegionId: "a", endRegionId: "b" },
    ],
  }
  const original = structuredClone(graph)
  const loaded = loadSerializedHyperGraph(graph)

  expect(loaded.topology.regionCount).toBe(2)
  expect(loaded.topology.portCount).toBe(1)
  expect(loaded.topology.regionIncidentPorts).toEqual([[0], [0]])
  expect(loaded.problem.routeCount).toBe(0)
  expect(loaded.solution.solvedRoutePathSegments).toEqual([])
  expect(graph).toEqual(original)
  expect(
    loadSerializedHyperGraph({ regions: [], ports: [], connections: [] })
      .problem.routeCount,
  ).toBe(0)

  const missingPortRegion = structuredClone(graph)
  missingPortRegion.ports[0].region2Id = "missing"
  expect(() => loadSerializedHyperGraph(missingPortRegion)).toThrow(
    'Port "kept" references missing regions "a" or "missing"',
  )
  const missingConnectionRegion = structuredClone(graph)
  missingConnectionRegion.connections![0].endRegionId = "missing"
  expect(() => loadSerializedHyperGraph(missingConnectionRegion)).toThrow(
    'Connection references missing region "missing"',
  )
})
