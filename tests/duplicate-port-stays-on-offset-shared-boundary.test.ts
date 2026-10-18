import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "../lib/DuplicateCongestedPortSolver"

class KnownSharedBoundaryCongestion extends DuplicateCongestedPortSolver {
  duplicateSharedPort(): SerializedHyperGraph {
    return this.duplicateCongestedPorts(new Map([["shared", 2]]))
  }
}

test("offset region centers do not move duplicated ports off their shared edge", (): void => {
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
        d: { center: { x: 0.5, y: 0.5 }, width: 1, height: 1 },
      },
    ],
    ports: [
      {
        portId: "shared",
        region1Id: "left",
        region2Id: "right",
        d: { x: 0, y: 0.5, z: 0 },
      },
    ],
    connections: [],
  }
  for (const horizontal of [false, true]) {
    for (const reversed of [false, true]) {
      const input = structuredClone(graph)
      if (horizontal) {
        for (const region of input.regions) {
          const { center, width, height } = region.d
          region.d = {
            center: { x: center.y, y: center.x },
            width: height,
            height: width,
          }
        }
        input.ports[0]!.d = { x: 0.5, y: 0, z: 0 }
      }
      if (reversed) {
        input.ports[0]!.region1Id = "right"
        input.ports[0]!.region2Id = "left"
      }
      const output = new KnownSharedBoundaryCongestion(input).duplicateSharedPort()
      const duplicate = output.ports.find((port) => port.d.duplicatedFromPortId)!
      expect(horizontal ? duplicate.d.y : duplicate.d.x).toBe(0)
      expect(horizontal ? duplicate.d.x : duplicate.d.y).toBeGreaterThan(0.5)
      expect(horizontal ? duplicate.d.x : duplicate.d.y).toBeLessThanOrEqual(1)
    }
  }
})
