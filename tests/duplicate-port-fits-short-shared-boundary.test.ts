import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "../lib/DuplicateCongestedPortSolver"

class ShortBoundaryCongestion extends DuplicateCongestedPortSolver {
  duplicateSharedPort(): SerializedHyperGraph {
    return this.duplicateCongestedPorts(new Map([["shared", 3]]))
  }
}

test("duplicate slots fit the shared interval even at its endpoint", (): void => {
  for (const y of [0, 0.01, 0.02]) {
    const graph: SerializedHyperGraph = {
      regions: [
        {
          regionId: "left",
          pointIds: ["shared"],
          d: { center: { x: -0.5, y: 0 }, width: 1, height: 2 },
        },
        {
          regionId: "right",
          pointIds: ["shared"],
          d: { center: { x: 0.5, y: 0.01 }, width: 1, height: 0.02 },
        },
      ],
      ports: [
        {
          portId: "shared",
          region1Id: "left",
          region2Id: "right",
          d: { x: 0, y, z: 0 },
        },
      ],
      connections: [],
    }
    const output = new ShortBoundaryCongestion(graph).duplicateSharedPort()
    const duplicates = output.ports.filter((port) => port.d.duplicatedFromPortId)
    expect(duplicates).toHaveLength(2)
    expect(new Set(output.ports.map((port) => port.d.y)).size).toBe(3)
    for (const duplicate of duplicates) {
      expect(duplicate.d.x).toBe(0)
      expect(duplicate.d.y).toBeGreaterThanOrEqual(0)
      expect(duplicate.d.y).toBeLessThanOrEqual(0.02)
    }
  }
})
