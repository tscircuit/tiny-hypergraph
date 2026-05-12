import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

const createRegion = (
  regionId: string,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  pointIds: string[],
): NonNullable<SerializedHyperGraph["regions"]>[number] => ({
  regionId,
  pointIds,
  d: {
    center: { x: centerX, y: centerY },
    width,
    height,
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
  d: { x, y, z },
})

export const portChokepointFixture: SerializedHyperGraph = {
  regions: [
    createRegion("a-start", 0, 6, 4, 4, ["a-start-port", "left-top-mid"]),
    createRegion("left-middle", 0, 2, 4, 4, [
      "left-top-mid",
      "left-mid-bottom",
      "left-center-choke",
    ]),
    createRegion("b-start", 0, -2, 4, 4, ["left-mid-bottom", "b-start-port"]),
    createRegion("center-middle", 4, 2, 4, 4, [
      "left-center-choke",
      "center-right-choke",
    ]),
    createRegion("a-end", 8, 6, 4, 4, ["a-end-port", "right-top-mid"]),
    createRegion("right-middle", 8, 2, 4, 4, [
      "right-top-mid",
      "center-right-choke",
      "right-mid-bottom",
    ]),
    createRegion("b-end", 8, -2, 4, 4, ["right-mid-bottom", "b-end-port"]),
  ],
  ports: [
    createPort("a-start-port", "a-start", "left-middle", 0, 8),
    createPort("left-top-mid", "a-start", "left-middle", 0, 4),
    createPort("left-mid-bottom", "left-middle", "b-start", 0, 0),
    createPort("b-start-port", "b-start", "left-middle", 0, -4),
    createPort("left-center-choke", "left-middle", "center-middle", 2, 2),
    createPort("center-right-choke", "center-middle", "right-middle", 6, 2),
    createPort("a-end-port", "a-end", "right-middle", 8, 8),
    createPort("right-top-mid", "a-end", "right-middle", 8, 4),
    createPort("right-mid-bottom", "right-middle", "b-end", 8, 0),
    createPort("b-end-port", "b-end", "right-middle", 8, -4),
  ],
  connections: [
    {
      connectionId: "connection-a",
      startRegionId: "a-start",
      endRegionId: "a-end",
      mutuallyConnectedNetworkId: "net-a",
    },
    {
      connectionId: "connection-b",
      startRegionId: "b-start",
      endRegionId: "b-end",
      mutuallyConnectedNetworkId: "net-b",
    },
  ],
}
