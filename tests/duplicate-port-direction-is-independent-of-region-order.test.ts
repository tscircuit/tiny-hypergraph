import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "../lib/DuplicateCongestedPortSolver"

class KnownCongestionSolver extends DuplicateCongestedPortSolver {
  duplicateSharedBoundaryPorts(): SerializedHyperGraph {
    return this.duplicateCongestedPorts(new Map([
      ["left", 2],
      ["right", 2],
    ]))
  }
}

test("duplicate direction does not depend on the ordering of adjacent regions", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      { regionId: "west", pointIds: ["left"], d: { center: { x: -2, y: 0 }, width: 2, height: 2, availableZ: [0] } },
      { regionId: "center", pointIds: ["left", "right"], d: { center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0] } },
      { regionId: "east", pointIds: ["right"], d: { center: { x: 2, y: 0 }, width: 2, height: 2, availableZ: [0] } },
    ],
    ports: [
      { portId: "left", region1Id: "center", region2Id: "west", d: { x: -1, y: 0, z: 0 } },
      { portId: "right", region1Id: "center", region2Id: "east", d: { x: 1, y: 0, z: 0 } },
    ],
    connections: ["a", "b"].map((connectionId) => ({ connectionId, mutuallyConnectedNetworkId: connectionId, startRegionId: "west", endRegionId: "east" })),
  }
  const solver = new KnownCongestionSolver(graph)
  const reversed = new KnownCongestionSolver({
    ...graph,
    ports: graph.ports.map((port) => ({ ...port, region1Id: port.region2Id, region2Id: port.region1Id })),
  })
  const duplicates = solver.duplicateSharedBoundaryPorts().ports.filter((port) => port.d.duplicatedFromPortId)
  const reversedDuplicates = reversed.duplicateSharedBoundaryPorts().ports.filter((port) => port.d.duplicatedFromPortId)
  expect(duplicates).toHaveLength(2)
  expect(duplicates.every((port) => port.d.y > 0)).toBeTrue()
  expect(duplicates.map((port) => [port.d.x, port.d.y])).toEqual(reversedDuplicates.map((port) => [port.d.x, port.d.y]))
})
