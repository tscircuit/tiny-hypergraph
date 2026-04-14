import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

export const BUS_REGION_SPAN_ROUTE_COUNT = 6
export const BUS_REGION_SPAN_SHARED_PORTS_PER_MIDDLE_EDGE = 4

const START_END_XS = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5] as const
const MID_LEFT_XS = [-6.5, -5.0, -3.5, -2.0] as const
const MID_RIGHT_XS = [2.0, 3.5, 5.0, 6.5] as const

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
): NonNullable<SerializedHyperGraph["ports"]>[number] => ({
  portId,
  region1Id,
  region2Id,
  d: {
    x,
    y,
    z: 0,
  },
})

const createConnection = (
  routeIndex: number,
): NonNullable<SerializedHyperGraph["connections"]>[number] => ({
  connectionId: `route-${routeIndex}`,
  startRegionId: `start-${routeIndex}`,
  endRegionId: `end-${routeIndex}`,
  mutuallyConnectedNetworkId: `net-${routeIndex}`,
})

const topStartPortIds = START_END_XS.map(
  (_, routeIndex) => `start-port-${routeIndex}`,
)
const bottomChainPortIds = START_END_XS.map(
  (_, routeIndex) => `bottom-chain-port-${routeIndex}`,
)
const bottomExitPortIds = START_END_XS.map(
  (_, routeIndex) => `bottom-exit-port-${routeIndex}`,
)
const endPortIds = START_END_XS.map((_, routeIndex) => `end-port-${routeIndex}`)
const topLeftMidPortIds = MID_LEFT_XS.map((_, portIndex) => `tl-${portIndex}`)
const bottomLeftMidPortIds = MID_LEFT_XS.map(
  (_, portIndex) => `bl-${portIndex}`,
)
const topRightMidPortIds = MID_RIGHT_XS.map((_, portIndex) => `tr-${portIndex}`)
const bottomRightMidPortIds = MID_RIGHT_XS.map(
  (_, portIndex) => `br-${portIndex}`,
)

export const busRegionSpanFixture: SerializedHyperGraph = {
  regions: [
    ...START_END_XS.flatMap((x, routeIndex) => [
      createRegion(`start-${routeIndex}`, x, 12, 1.2, 1.2, [
        `start-port-${routeIndex}`,
      ]),
      createRegion(`end-${routeIndex}`, x, -16, 1.2, 1.2, [
        `end-port-${routeIndex}`,
      ]),
    ]),
    createRegion("top-main", 0, 7.5, 18, 3, [
      ...topStartPortIds,
      ...topLeftMidPortIds,
      ...topRightMidPortIds,
    ]),
    createRegion("mid-left", -4, 2.5, 6, 7, [
      ...topLeftMidPortIds,
      ...bottomLeftMidPortIds,
    ]),
    createRegion("mid-right", 4, 2.5, 6, 7, [
      ...topRightMidPortIds,
      ...bottomRightMidPortIds,
    ]),
    createRegion("bottom-main", 0, -3.5, 18, 3, [
      ...bottomLeftMidPortIds,
      ...bottomRightMidPortIds,
      ...bottomChainPortIds,
    ]),
    createRegion("bottom-buffer", 0, -9.5, 18, 3, [
      ...bottomChainPortIds,
      ...bottomExitPortIds,
    ]),
    createRegion("bottom-exit", 0, -13, 18, 2.5, [
      ...bottomExitPortIds,
      ...endPortIds,
    ]),
  ],
  ports: [
    ...START_END_XS.flatMap((x, routeIndex) => [
      createPort(
        `start-port-${routeIndex}`,
        `start-${routeIndex}`,
        "top-main",
        x,
        10.5,
      ),
      createPort(
        `bottom-chain-port-${routeIndex}`,
        "bottom-main",
        "bottom-buffer",
        x,
        -6.5,
      ),
      createPort(
        `bottom-exit-port-${routeIndex}`,
        "bottom-buffer",
        "bottom-exit",
        x,
        -11.25,
      ),
      createPort(
        `end-port-${routeIndex}`,
        "bottom-exit",
        `end-${routeIndex}`,
        x,
        -14.5,
      ),
    ]),
    ...MID_LEFT_XS.flatMap((x, portIndex) => [
      createPort(`tl-${portIndex}`, "top-main", "mid-left", x, 6.0),
      createPort(`bl-${portIndex}`, "mid-left", "bottom-main", x, -0.5),
    ]),
    ...MID_RIGHT_XS.flatMap((x, portIndex) => [
      createPort(`tr-${portIndex}`, "top-main", "mid-right", x, 6.0),
      createPort(`br-${portIndex}`, "mid-right", "bottom-main", x, -0.5),
    ]),
  ],
  connections: START_END_XS.map((_, routeIndex) =>
    createConnection(routeIndex),
  ),
}
