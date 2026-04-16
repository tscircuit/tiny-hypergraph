import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

export const BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT = 6
export const BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE = 4
export const BUS_RIGHT_TURN_L_SHAPE_BRIDGE_REGION_COUNT = 3
export const BUS_RIGHT_TURN_L_SHAPE_SPLIT_STAGE_COUNT = 3

const START_XS = [-10, -6, -2, 2, 6, 10] as const
const END_XS = [24, 26, 28, 30, 32, 34] as const
const SPLIT_LEFT_XS = [-9, -6, -3, -0.5] as const
const SPLIT_RIGHT_XS = [0.5, 3, 6, 9] as const
const SPLIT_TOP_YS = [-7, -8, -9, -10] as const
const SPLIT_BOTTOM_YS = [-10.5, -11.5, -12.5, -13.5] as const

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

const startPortIds = START_XS.map((_, routeIndex) => `start-port-${routeIndex}`)
const bridgeChainPortIds = START_XS.map(
  (_, routeIndex) => `bridge-chain-port-${routeIndex}`,
)
const rightChainPortIds = END_XS.map(
  (_, routeIndex) => `right-chain-port-${routeIndex}`,
)
const rightExitPortIds = END_XS.map(
  (_, routeIndex) => `right-exit-port-${routeIndex}`,
)
const endPortIds = END_XS.map((_, routeIndex) => `end-port-${routeIndex}`)

const splitATopLeftPortIds = SPLIT_LEFT_XS.map(
  (_, portIndex) => `a-tl-${portIndex}`,
)
const splitABottomLeftPortIds = SPLIT_LEFT_XS.map(
  (_, portIndex) => `a-bl-${portIndex}`,
)
const splitATopRightPortIds = SPLIT_RIGHT_XS.map(
  (_, portIndex) => `a-tr-${portIndex}`,
)
const splitABottomRightPortIds = SPLIT_RIGHT_XS.map(
  (_, portIndex) => `a-br-${portIndex}`,
)
const splitBTopLeftPortIds = SPLIT_LEFT_XS.map(
  (_, portIndex) => `b-tl-${portIndex}`,
)
const splitBBottomLeftPortIds = SPLIT_LEFT_XS.map(
  (_, portIndex) => `b-bl-${portIndex}`,
)
const splitBTopRightPortIds = SPLIT_RIGHT_XS.map(
  (_, portIndex) => `b-tr-${portIndex}`,
)
const splitBBottomRightPortIds = SPLIT_RIGHT_XS.map(
  (_, portIndex) => `b-br-${portIndex}`,
)
const splitCTopLeftPortIds = SPLIT_TOP_YS.map(
  (_, portIndex) => `c-tl-${portIndex}`,
)
const splitCTopRightPortIds = SPLIT_TOP_YS.map(
  (_, portIndex) => `c-tr-${portIndex}`,
)
const splitCBottomLeftPortIds = SPLIT_BOTTOM_YS.map(
  (_, portIndex) => `c-bl-${portIndex}`,
)
const splitCBottomRightPortIds = SPLIT_BOTTOM_YS.map(
  (_, portIndex) => `c-br-${portIndex}`,
)

export const busRightTurnLShapeFixture: SerializedHyperGraph = {
  regions: [
    ...START_XS.flatMap((x, routeIndex) => [
      createRegion(`start-${routeIndex}`, x, 31.5, 1.2, 1.2, [
        `start-port-${routeIndex}`,
      ]),
      createRegion(`end-${routeIndex}`, END_XS[routeIndex]!, -46.5, 1.2, 1.2, [
        `end-port-${routeIndex}`,
      ]),
    ]),
    createRegion("top-main", 0, 25.5, 24, 3, [
      ...startPortIds,
      ...splitATopLeftPortIds,
      ...splitATopRightPortIds,
    ]),
    createRegion("split-a-left", -5.5, 19.5, 8.5, 9, [
      ...splitATopLeftPortIds,
      ...splitABottomLeftPortIds,
    ]),
    createRegion("split-a-right", 5.5, 19.5, 8.5, 9, [
      ...splitATopRightPortIds,
      ...splitABottomRightPortIds,
    ]),
    createRegion("bridge-upper", 0, 12, 28, 6, [
      ...splitABottomLeftPortIds,
      ...splitABottomRightPortIds,
      ...bridgeChainPortIds,
    ]),
    createRegion("bridge-lower", 0, 6, 28, 6, [
      ...bridgeChainPortIds,
      ...splitBTopLeftPortIds,
      ...splitBTopRightPortIds,
    ]),
    createRegion("split-b-left", -5.5, -1.5, 8.5, 9, [
      ...splitBTopLeftPortIds,
      ...splitBBottomLeftPortIds,
    ]),
    createRegion("split-b-right", 5.5, -1.5, 8.5, 9, [
      ...splitBTopRightPortIds,
      ...splitBBottomRightPortIds,
    ]),
    createRegion("bridge-final", 0, -10, 28, 7, [
      ...splitBBottomLeftPortIds,
      ...splitBBottomRightPortIds,
      ...splitCTopLeftPortIds,
      ...splitCBottomLeftPortIds,
    ]),
    createRegion("split-c-top", 18.5, -8, 9, 5, [
      ...splitCTopLeftPortIds,
      ...splitCTopRightPortIds,
    ]),
    createRegion("split-c-bottom", 18.5, -12.5, 9, 5, [
      ...splitCBottomLeftPortIds,
      ...splitCBottomRightPortIds,
    ]),
    createRegion("right-main", 29, -18, 12, 22, [
      ...splitCTopRightPortIds,
      ...splitCBottomRightPortIds,
      ...rightChainPortIds,
    ]),
    createRegion("right-buffer", 29, -32.5, 12, 7, [
      ...rightChainPortIds,
      ...rightExitPortIds,
    ]),
    createRegion("right-exit", 29, -39.5, 12, 7, [
      ...rightExitPortIds,
      ...endPortIds,
    ]),
  ],
  ports: [
    ...START_XS.flatMap((x, routeIndex) => [
      createPort(
        `start-port-${routeIndex}`,
        `start-${routeIndex}`,
        "top-main",
        x,
        28.5,
      ),
    ]),
    ...END_XS.flatMap((x, routeIndex) => [
      createPort(
        `right-chain-port-${routeIndex}`,
        "right-main",
        "right-buffer",
        x,
        -29,
      ),
      createPort(
        `right-exit-port-${routeIndex}`,
        "right-buffer",
        "right-exit",
        x,
        -36,
      ),
      createPort(
        `end-port-${routeIndex}`,
        "right-exit",
        `end-${routeIndex}`,
        x,
        -43,
      ),
    ]),
    ...START_XS.flatMap((x, routeIndex) => [
      createPort(
        `bridge-chain-port-${routeIndex}`,
        "bridge-upper",
        "bridge-lower",
        x,
        8.5,
      ),
    ]),
    ...SPLIT_LEFT_XS.flatMap((x, portIndex) => [
      createPort(`a-tl-${portIndex}`, "top-main", "split-a-left", x, 24),
      createPort(`a-bl-${portIndex}`, "split-a-left", "bridge-upper", x, 15),
      createPort(`b-tl-${portIndex}`, "bridge-lower", "split-b-left", x, 3),
      createPort(`b-bl-${portIndex}`, "split-b-left", "bridge-final", x, -6),
    ]),
    ...SPLIT_RIGHT_XS.flatMap((x, portIndex) => [
      createPort(`a-tr-${portIndex}`, "top-main", "split-a-right", x, 24),
      createPort(`a-br-${portIndex}`, "split-a-right", "bridge-upper", x, 15),
      createPort(`b-tr-${portIndex}`, "bridge-lower", "split-b-right", x, 3),
      createPort(`b-br-${portIndex}`, "split-b-right", "bridge-final", x, -6),
    ]),
    ...SPLIT_TOP_YS.flatMap((y, portIndex) => [
      createPort(`c-tl-${portIndex}`, "bridge-final", "split-c-top", 14, y),
      createPort(`c-tr-${portIndex}`, "split-c-top", "right-main", 23, y),
    ]),
    ...SPLIT_BOTTOM_YS.flatMap((y, portIndex) => [
      createPort(`c-bl-${portIndex}`, "bridge-final", "split-c-bottom", 14, y),
      createPort(`c-br-${portIndex}`, "split-c-bottom", "right-main", 23, y),
    ]),
  ],
  connections: START_XS.map((_, routeIndex) => createConnection(routeIndex)),
}
