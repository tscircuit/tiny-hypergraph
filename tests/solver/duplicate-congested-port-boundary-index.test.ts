import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "lib/DuplicateCongestedPortSolver"

type SerializedPort = SerializedHyperGraph["ports"][number]
type SerializedPortId = SerializedPort["portId"]

class BoundaryIndexTestSolver extends DuplicateCongestedPortSolver {
  duplicatePorts(
    portUseCounts: Map<SerializedPortId, number>,
  ): SerializedHyperGraph {
    return this.duplicateCongestedPorts(portUseCounts)
  }
}

const createPort = ({
  portId,
  x,
  y,
  region1Id = "left",
  region2Id = "right",
}: {
  portId: string
  x: number
  y: number
  region1Id?: string
  region2Id?: string
}): SerializedPort => ({
  portId,
  region1Id,
  region2Id,
  d: { x, y, z: 0 },
})

const duplicateSourcePort = (ports: SerializedPort[]) => {
  const regions = ["left", "right", "foreign"].map((regionId, index) => ({
    regionId,
    pointIds: ports
      .filter(
        (port) => port.region1Id === regionId || port.region2Id === regionId,
      )
      .map((port) => port.portId),
    d: { center: { x: index * 2, y: 0 }, width: 2, height: 10 },
  }))
  const solver = new BoundaryIndexTestSolver(
    { regions, ports, connections: [] },
    { duplicatePortProximity: 0.2 },
  )

  return solver
    .duplicatePorts(new Map([["source", 2]]))
    .ports.find((port) => port.d?.duplicatedFromPortId === "source")
}

test("indexes only ports on the same unordered region boundary", () => {
  const source = createPort({ portId: "source", x: 0, y: 0 })
  const foreign = createPort({
    portId: "foreign",
    x: 0.01,
    y: 0,
    region1Id: "left",
    region2Id: "foreign",
  })
  const reversedBoundary = createPort({
    portId: "reversed",
    x: 0,
    y: 1,
    region1Id: "right",
    region2Id: "left",
  })
  const fartherOnBoundary = createPort({
    portId: "farther",
    x: 0,
    y: -2,
  })

  expect(
    duplicateSourcePort([source, foreign, reversedBoundary, fartherOnBoundary])
      ?.d,
  ).toMatchObject({ x: 0, y: 0.1 })

  expect(
    duplicateSourcePort([source, foreign, fartherOnBoundary, reversedBoundary])
      ?.d,
  ).toMatchObject({ x: 0, y: 0.1 })

  const belowSource = createPort({ portId: "below", x: 0, y: -1 })
  expect(
    duplicateSourcePort([source, reversedBoundary, belowSource])?.d,
  ).toMatchObject({ x: 0, y: 0.1 })
  expect(
    duplicateSourcePort([source, belowSource, reversedBoundary])?.d,
  ).toMatchObject({ x: 0, y: 0.1 })
})
