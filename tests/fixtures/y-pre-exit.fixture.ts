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
    createRegion("start-a", 0, 2, ["a-port"]),
    createRegion("start-b", 0, 0, ["b-port"]),
    createRegion("shared-parent", 1, 1, ["a-port", "b-port", "shared-top", "shared-bottom"]),
    createRegion("same-end", 2, 1, ["shared-top", "shared-bottom"]),
  ],
  ports: [
    createPort("a-port", "start-a", "shared-parent", 0.5, 1.75),
    createPort("b-port", "start-b", "shared-parent", 0.5, 0.25),
    createPort("shared-top", "shared-parent", "same-end", 1.5, 1.5),
    createPort("shared-bottom", "shared-parent", "same-end", 1.5, 0.5),
  ],
  connections: [
    {
      ...routeA,
      endRegionId: "same-end",
    },
    {
      ...routeB,
      endRegionId: "same-end",
    },
  ],
}
