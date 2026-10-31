import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "lib/DuplicateCongestedPortSolver"

class UnorderedBoundaryTestSolver extends DuplicateCongestedPortSolver {
  duplicatePorts(portUseCounts: Map<string, number>): SerializedHyperGraph {
    return this.duplicateCongestedPorts(portUseCounts)
  }
}

test("reversing the boundary owners keeps duplicates on the same side of fixed copper", () => {
  const positions: unknown[] = []
  for (const [region1Id, region2Id] of [
    ["left", "right"],
    ["right", "left"],
  ]) {
    const solver = new UnorderedBoundaryTestSolver({
      regions: [-1, 1].map((x, index) => ({
        regionId: index === 0 ? "left" : "right",
        pointIds: ["fixed-crossing"],
        d: { center: { x, y: 0 }, width: 2, height: 2 },
      })),
      ports: [
        {
          portId: "fixed-crossing",
          region1Id,
          region2Id,
          d: { x: 0, y: 0, z: 0, _preloadedFixedNetIds: ["fixed-net"] },
        },
      ],
      connections: [],
    })
    const duplicate = solver.duplicatePorts(new Map([["fixed-crossing", 2]]))
      .ports[1]
    positions.push({ x: duplicate.d?.x, y: duplicate.d?.y })
  }
  expect(positions[0]).toEqual(positions[1])
})
