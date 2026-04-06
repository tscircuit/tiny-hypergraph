import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

const REGION_SIZE = 1.6

const gridPoint = (x: number, y: number) => ({ x: x * 2, y: y * 2 })

const createRegion = (
  regionId: string,
  x: number,
  y: number,
  pointIds: string[],
): NonNullable<SerializedHyperGraph["regions"]>[number] => ({
  regionId,
  pointIds,
  d: {
    center: gridPoint(x, y),
    width: REGION_SIZE,
    height: REGION_SIZE,
  },
})

const createPort = (
  portId: string,
  region1Id: string,
  region2Id: string,
  x: number,
  y: number,
  z = 0,
): NonNullable<SerializedHyperGraph["ports"]>[number] => ({
  portId,
  region1Id,
  region2Id,
  d: {
    ...gridPoint(x, y),
    z,
  },
})

const routeA = {
  connectionId: "route-a",
  startRegionId: "start-a",
  endRegionId: "end-a",
  mutuallyConnectedNetworkId: "net-0",
}

const routeB = {
  connectionId: "route-b",
  startRegionId: "start-b",
  endRegionId: "end-b",
  mutuallyConnectedNetworkId: "net-0",
}

export const yPreExitFixture: SerializedHyperGraph = {
  regions: [
    createRegion("start-a", 0, 2, ["a-in"]),
    createRegion("start-b", 0, 0, ["b-in"]),
    createRegion("shared-parent", 1, 1, ["a-in", "b-in", "shared-point-top", "shared-point-bottom"]),
    createRegion("exit-a", 2, 2, ["shared-point-top", "a-out"]),
    createRegion("exit-b", 2, 0, ["shared-point-bottom", "b-out"]),
    createRegion("end-a", 3, 2, ["a-out"]),
    createRegion("end-b", 3, 0, ["b-out"]),
  ],
  ports: [
    createPort("a-in", "start-a", "shared-parent", 0.5, 1.75),
    createPort("b-in", "start-b", "shared-parent", 0.5, 0.25),
    createPort("shared-point-top", "shared-parent", "exit-a", 1.5, 1.5),
    createPort("shared-point-bottom", "shared-parent", "exit-b", 1.5, 0.5),
    createPort("a-out", "exit-a", "end-a", 2.5, 1.75),
    createPort("b-out", "exit-b", "end-b", 2.5, 0.25),
  ],
  connections: [routeA, routeB],
}
