import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

const REGION_SIZE = 1.6
export const busOrderingVector = { x: 0, y: 1 } as const

const gridPoint = (x: number, y: number) => ({ x: x * 2, y: y * 2 })

const createRegion = (
  regionId: string,
  x: number,
  y: number,
  pointIds: string[],
  busCapacity: number,
): NonNullable<SerializedHyperGraph["regions"]>[number] => ({
  regionId,
  pointIds,
  d: {
    center: gridPoint(x, y),
    width: REGION_SIZE,
    height: REGION_SIZE,
    busCapacity,
  },
})

const createPort = (
  portId: string,
  region1Id: string,
  region2Id: string,
  x: number,
  y: number,
  busCapacity = 1,
): NonNullable<SerializedHyperGraph["ports"]>[number] => ({
  portId,
  region1Id,
  region2Id,
  d: {
    ...gridPoint(x, y),
    z: 0,
    busCapacity,
  },
})

const createBusConnection = (
  connectionId: string,
  startRegionId: string,
  endRegionId: string,
  mutuallyConnectedNetworkId: string,
): NonNullable<SerializedHyperGraph["connections"]>[number] =>
  ({
    connectionId,
    startRegionId,
    endRegionId,
    mutuallyConnectedNetworkId,
    d: {
      busId: "data-bus",
      orderingVector: busOrderingVector,
    },
  }) as NonNullable<SerializedHyperGraph["connections"]>[number]

export const busRoutingFixture: SerializedHyperGraph = {
  regions: [
    createRegion("start-0", 0, 4, ["in-0"], 1),
    createRegion("start-1", 0, 3, ["in-1"], 1),
    createRegion("start-2", 0, 2, ["in-2"], 1),
    createRegion(
      "fanout-left",
      2,
      3,
      ["in-0", "in-1", "in-2", "lt-0", "lt-1", "lb-0"],
      3,
    ),
    createRegion("lane-top-left", 4, 4, ["lt-0", "lt-1", "tt-0", "tt-1"], 2),
    createRegion("lane-bottom-left", 4, 2, ["lb-0", "bb-0"], 1),
    createRegion("lane-top-right", 6, 4, ["tt-0", "tt-1", "rt-0", "rt-1"], 2),
    createRegion("lane-bottom-right", 6, 2, ["bb-0", "rb-0"], 1),
    createRegion(
      "fanout-right",
      8,
      3,
      ["rt-0", "rt-1", "rb-0", "out-0", "out-1", "out-2"],
      3,
    ),
    createRegion("end-0", 10, 4, ["out-0"], 1),
    createRegion("end-1", 10, 3, ["out-1"], 1),
    createRegion("end-2", 10, 2, ["out-2"], 1),
  ],
  ports: [
    createPort("in-0", "start-0", "fanout-left", 0.5, 4),
    createPort("in-1", "start-1", "fanout-left", 0.5, 3),
    createPort("in-2", "start-2", "fanout-left", 0.5, 2),
    createPort("lt-0", "fanout-left", "lane-top-left", 2.5, 4.25),
    createPort("lt-1", "fanout-left", "lane-top-left", 2.5, 3.75),
    createPort("lb-0", "fanout-left", "lane-bottom-left", 2.5, 2.25),
    createPort("tt-0", "lane-top-left", "lane-top-right", 4.5, 4.25),
    createPort("tt-1", "lane-top-left", "lane-top-right", 4.5, 3.75),
    createPort("bb-0", "lane-bottom-left", "lane-bottom-right", 4.5, 2.25),
    createPort("rt-0", "lane-top-right", "fanout-right", 6.5, 4.25),
    createPort("rt-1", "lane-top-right", "fanout-right", 6.5, 3.75),
    createPort("rb-0", "lane-bottom-right", "fanout-right", 6.5, 2.25),
    createPort("out-0", "fanout-right", "end-0", 8.5, 4),
    createPort("out-1", "fanout-right", "end-1", 8.5, 3),
    createPort("out-2", "fanout-right", "end-2", 8.5, 2),
  ],
  connections: [
    createBusConnection("route-0", "start-0", "end-0", "net-0"),
    createBusConnection("route-1", "start-1", "end-1", "net-1"),
    createBusConnection("route-2", "start-2", "end-2", "net-2"),
  ],
}
