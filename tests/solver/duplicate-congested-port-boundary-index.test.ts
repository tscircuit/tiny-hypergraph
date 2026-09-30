import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "lib/DuplicateCongestedPortSolver"

type Port = SerializedHyperGraph["ports"][number]

class BoundaryIndexTestSolver extends DuplicateCongestedPortSolver {
  duplicateWithPortUseCounts(
    portUseCounts: Map<string, number>,
  ): SerializedHyperGraph {
    return this.duplicateCongestedPorts(portUseCounts)
  }
}

const port = (
  portId: string,
  x: number,
  y: number,
  region1Id = "left",
  region2Id = "right",
): Port => ({ portId, region1Id, region2Id, d: { x, y, z: 0 } })

const duplicate = (
  ports: Port[],
  sourceIds = ["source"],
  duplicatePortProximity = 0.2,
) => {
  const graph: SerializedHyperGraph = {
    regions: ["left", "right", "other"].map((regionId, index) => ({
      regionId,
      pointIds: ports
        .filter((p) => p.region1Id === regionId || p.region2Id === regionId)
        .map((p) => p.portId),
      d: { center: { x: index * 2, y: 0 }, width: 2, height: 10 },
    })),
    ports,
    connections: [],
  }
  const solver = new BoundaryIndexTestSolver(graph, {
    duplicatePortProximity,
  })
  // Isolate geometric duplication from independent route solving so each
  // deliberately chosen neighbor arrangement reaches the lookup unchanged.
  const output = solver.duplicateWithPortUseCounts(
    new Map(sourceIds.map((id) => [id, 2])),
  )
  return output.ports.filter((p) => p.d?.duplicatedFromPortId !== undefined)
}

test("equal-distance neighbors retain original input order", () => {
  const source = port("source", 0, 0)
  const above = port("above", 0, 1)
  const below = port("below", 0, -1)
  expect(duplicate([source, above, below])[0]?.d).toMatchObject({
    x: 0,
    y: -0.1,
  })
  expect(duplicate([source, below, above])[0]?.d).toMatchObject({
    x: 0,
    y: 0.1,
  })
})

test("reversed boundary endpoints match and closer foreign boundaries do not", () => {
  const result = duplicate([
    port("source", 0, 0),
    port("foreign", 0.01, 0, "left", "other"),
    port("reversed", 0, 1, "right", "left"),
    port("farther", 0, -2),
  ])
  expect(result[0]?.d).toMatchObject({ x: 0, y: -0.1 })
})

test("coincident and epsilon-distance neighbors do not determine direction", () => {
  const result = duplicate([
    port("source", 0, 0),
    port("coincident", 0, 0),
    port("inside-epsilon", 0, -0.5e-9),
    port("at-epsilon", 0, -1e-9),
    port("usable", 1, 0),
  ])
  expect(result[0]?.d).toMatchObject({ x: -0.1, y: 0 })
})

test("later sources ignore ports duplicated earlier in the same operation", () => {
  const result = duplicate(
    [port("a", 0, 0), port("anchor", -0.1, 0), port("b", 1.5, 0)],
    ["b", "a"],
    4,
  )
  // a's duplicate at x=2 would be b's nearest neighbor and reverse b's
  // direction if newly generated ports entered the boundary index.
  expect(result.map((p) => [p.portId, p.d?.x, p.d?.y])).toEqual([
    ["a::dup1", 2, 0],
    ["b::dup1", 3.5, 0],
  ])
})
