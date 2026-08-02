import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "lib/index"

const createRegion = (
  regionId: string,
  center: { x: number; y: number },
  width: number,
  height: number,
  pointIds: string[],
): SerializedHyperGraph["regions"][number] => ({
  regionId,
  pointIds,
  d: { center, width, height },
})

const createPort = (
  portId: string,
  region1Id: string,
  region2Id: string,
  x: number,
  y: number,
): SerializedHyperGraph["ports"][number] => ({
  portId,
  region1Id,
  region2Id,
  d: { x, y, z: 0 },
})

const createFixture = (): SerializedHyperGraph => ({
  regions: [
    createRegion("start-a", { x: -4, y: 0 }, 2, 2, ["start-a-port"]),
    createRegion("start-b", { x: -4, y: -0.2 }, 2, 2, ["start-b-port"]),
    createRegion("left", { x: -1, y: 0 }, 2, 10, [
      "start-a-port",
      "start-b-port",
      "shared",
      "neighbor",
    ]),
    createRegion("right", { x: 1, y: 0 }, 2, 10, [
      "shared",
      "neighbor",
      "end-a-port",
      "end-b-port",
    ]),
    createRegion("end-a", { x: 4, y: 0 }, 2, 2, ["end-a-port"]),
    createRegion("end-b", { x: 4, y: -0.2 }, 2, 2, ["end-b-port"]),
  ],
  ports: [
    createPort("start-a-port", "start-a", "left", -3, 0),
    createPort("start-b-port", "start-b", "left", -3, -0.2),
    createPort("shared", "left", "right", 0, 0),
    createPort("neighbor", "left", "right", 0, 4),
    createPort("end-a-port", "right", "end-a", 3, 0),
    createPort("end-b-port", "right", "end-b", 3, -0.2),
  ],
  connections: [
    {
      connectionId: "connection-a",
      startRegionId: "start-a",
      endRegionId: "end-a",
      mutuallyConnectedNetworkId: "net-a",
    },
    {
      connectionId: "connection-b",
      startRegionId: "start-b",
      endRegionId: "end-b",
      mutuallyConnectedNetworkId: "net-b",
    },
  ],
})

test("preserves legacy duplicate placement when the boundary has enough capacity", () => {
  const legacySolver = new DuplicateCongestedPortSolver(createFixture())
  const capacityAwareSolver = new DuplicateCongestedPortSolver(createFixture(), {
    minimumDuplicatePortSpacing: 0.2,
    duplicatePortWidth: 0.1,
  })

  legacySolver.solve()
  capacityAwareSolver.solve()

  expect(capacityAwareSolver.getOutput()).toEqual(legacySolver.getOutput())
})
