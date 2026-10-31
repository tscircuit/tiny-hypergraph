import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "lib/DuplicateCongestedPortSolver"

class PhysicalCapacityTestSolver extends DuplicateCongestedPortSolver {
  duplicatePorts(portUseCounts: Map<string, number>): SerializedHyperGraph {
    return this.duplicateCongestedPorts(portUseCounts)
  }
}

test("limits duplicated crossings to the physical capacity on each layer", () => {
  for (const height of [0.4, 0.9]) {
    const ports = [0, 1].map((z) => ({
      portId: `source-${z}`,
      region1Id: "left",
      region2Id: "right",
      d: { x: 0, y: 0, z, cramped: true },
    }))
    const graph: SerializedHyperGraph = {
      regions: [-0.5, 0.5].map((x, index) => ({
        regionId: index === 0 ? "left" : "right",
        pointIds: ports.map((port) => port.portId),
        d: { center: { x, y: 0 }, width: 1, height },
      })),
      ports,
      connections: [],
    }
    const solver = new PhysicalCapacityTestSolver(graph, {
      minPortSpacing: 0.3,
    })
    const output = solver.duplicatePorts(
      new Map(ports.map((port) => [port.portId, 4])),
    )
    for (const z of [0, 1]) {
      const layerPorts = output.ports.filter((port) => port.d?.z === z)
      expect(layerPorts).toHaveLength(height === 0.4 ? 1 : 3)
      expect(height / layerPorts.length).toBeGreaterThanOrEqual(0.3)
    }
  }
})
