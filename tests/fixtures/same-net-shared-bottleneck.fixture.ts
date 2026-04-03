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
): NonNullable<SerializedHyperGraph["ports"]>[number] => ({
  portId,
  region1Id,
  region2Id,
  d: {
    ...gridPoint(x, y),
    z: 0,
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

export const sameNetSharedBottleneckFixture: SerializedHyperGraph = {
  regions: [
    createRegion("start-a", 0, 2, ["a-in"]),
    createRegion("start-b", 0, 1, ["b-in"]),
    createRegion("left-shared", 1, 1.5, ["a-in", "b-in", "shared-x"]),
    createRegion("right-shared", 2, 1.5, ["shared-x", "a-out", "b-out"]),
    createRegion("end-a", 3, 2, ["a-out"]),
    createRegion("end-b", 3, 1, ["b-out"]),
  ],
  ports: [
    createPort("a-in", "start-a", "left-shared", 0.5, 1.75),
    createPort("b-in", "start-b", "left-shared", 0.5, 1.25),
    createPort("shared-x", "left-shared", "right-shared", 1.5, 1.5),
    createPort("a-out", "right-shared", "end-a", 2.5, 1.75),
    createPort("b-out", "right-shared", "end-b", 2.5, 1.25),
  ],
  connections: [routeA, routeB],
}
