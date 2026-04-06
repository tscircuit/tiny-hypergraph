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

export const yPreExitFixture: SerializedHyperGraph = {
  regions: [
    createRegion("start-a", 0, 2, ["a-in"]),
    createRegion("start-b", 0, 0, ["b-in"]),
    createRegion("junction", 1, 1, ["a-in", "b-in", "shared-x"]),
    createRegion("trunk", 2, 1, ["shared-x", "trunk-out"]),
    createRegion("exit-obstacle", 3, 1, ["trunk-out", "a-out", "b-out"]),
    createRegion("end-a", 4, 2, ["a-out"]),
    createRegion("end-b", 4, 0, ["b-out"]),
  ],
  ports: [
    createPort("a-in", "start-a", "junction", 0.5, 1.75),
    createPort("b-in", "start-b", "junction", 0.5, 0.25),
    createPort("shared-x", "junction", "trunk", 1.5, 1),
    createPort("trunk-out", "trunk", "exit-obstacle", 2.5, 1),
    createPort("a-out", "exit-obstacle", "end-a", 3.5, 1.75),
    createPort("b-out", "exit-obstacle", "end-b", 3.5, 0.25),
  ],
  connections: [routeA, routeB],
}
