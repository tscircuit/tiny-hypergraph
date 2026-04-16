import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

export const BUS_DOUBLE_SPLIT_LONG_SPAN_ROUTE_COUNT = 6
export const BUS_DOUBLE_SPLIT_LONG_SPAN_SHARED_PORTS_PER_SPLIT_EDGE = 4
export const BUS_DOUBLE_SPLIT_LONG_SPAN_BRIDGE_REGION_COUNT = 3
export const BUS_DOUBLE_SPLIT_LONG_SPAN_SPLIT_STAGE_COUNT = 3

const START_END_XS = [-10, -6, -2, 2, 6, 10] as const
const SPLIT_LEFT_XS = [-9, -6, -3, -0.5] as const
const SPLIT_RIGHT_XS = [0.5, 3, 6, 9] as const

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

const startPortIds = START_END_XS.map(
  (_, routeIndex) => `start-port-${routeIndex}`,
)
const bridgeChainPortIds = START_END_XS.map(
  (_, routeIndex) => `bridge-chain-port-${routeIndex}`,
)
const bottomChainPortIds = START_END_XS.map(
  (_, routeIndex) => `bottom-chain-port-${routeIndex}`,
)
const bottomExitPortIds = START_END_XS.map(
  (_, routeIndex) => `bottom-exit-port-${routeIndex}`,
)
const endPortIds = START_END_XS.map((_, routeIndex) => `end-port-${routeIndex}`)

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
const splitCTopLeftPortIds = SPLIT_LEFT_XS.map(
  (_, portIndex) => `c-tl-${portIndex}`,
)
const splitCBottomLeftPortIds = SPLIT_LEFT_XS.map(
  (_, portIndex) => `c-bl-${portIndex}`,
)
const splitCTopRightPortIds = SPLIT_RIGHT_XS.map(
  (_, portIndex) => `c-tr-${portIndex}`,
)
const splitCBottomRightPortIds = SPLIT_RIGHT_XS.map(
  (_, portIndex) => `c-br-${portIndex}`,
)

export const busDoubleSplitLongSpanFixture: SerializedHyperGraph = {
  regions: [
    ...START_END_XS.flatMap((x, routeIndex) => [
      createRegion(`start-${routeIndex}`, x, 31.5, 1.2, 1.2, [
        `start-port-${routeIndex}`,
      ]),
      createRegion(`end-${routeIndex}`, x, -43.5, 1.2, 1.2, [
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
      ...splitCTopRightPortIds,
    ]),
    createRegion("split-c-left", -5.5, -18, 8.5, 9, [
      ...splitCTopLeftPortIds,
      ...splitCBottomLeftPortIds,
    ]),
    createRegion("split-c-right", 5.5, -18, 8.5, 9, [
      ...splitCTopRightPortIds,
      ...splitCBottomRightPortIds,
    ]),
    createRegion("bottom-main", 0, -25.5, 24, 6, [
      ...splitCBottomLeftPortIds,
      ...splitCBottomRightPortIds,
      ...bottomChainPortIds,
    ]),
    createRegion("bottom-buffer", 0, -32, 24, 6, [
      ...bottomChainPortIds,
      ...bottomExitPortIds,
    ]),
    createRegion("bottom-exit", 0, -38, 24, 4, [
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
        28.5,
      ),
      createPort(
        `bridge-chain-port-${routeIndex}`,
        "bridge-upper",
        "bridge-lower",
        x,
        8.5,
      ),
      createPort(
        `bottom-chain-port-${routeIndex}`,
        "bottom-main",
        "bottom-buffer",
        x,
        -28.5,
      ),
      createPort(
        `bottom-exit-port-${routeIndex}`,
        "bottom-buffer",
        "bottom-exit",
        x,
        -35,
      ),
      createPort(
        `end-port-${routeIndex}`,
        "bottom-exit",
        `end-${routeIndex}`,
        x,
        -41,
      ),
    ]),
    ...SPLIT_LEFT_XS.flatMap((x, portIndex) => [
      createPort(`a-tl-${portIndex}`, "top-main", "split-a-left", x, 24),
      createPort(`a-bl-${portIndex}`, "split-a-left", "bridge-upper", x, 15),
      createPort(`b-tl-${portIndex}`, "bridge-lower", "split-b-left", x, 3),
      createPort(`b-bl-${portIndex}`, "split-b-left", "bridge-final", x, -6),
      createPort(`c-tl-${portIndex}`, "bridge-final", "split-c-left", x, -13),
      createPort(`c-bl-${portIndex}`, "split-c-left", "bottom-main", x, -22),
    ]),
    ...SPLIT_RIGHT_XS.flatMap((x, portIndex) => [
      createPort(`a-tr-${portIndex}`, "top-main", "split-a-right", x, 24),
      createPort(`a-br-${portIndex}`, "split-a-right", "bridge-upper", x, 15),
      createPort(`b-tr-${portIndex}`, "bridge-lower", "split-b-right", x, 3),
      createPort(`b-br-${portIndex}`, "split-b-right", "bridge-final", x, -6),
      createPort(`c-tr-${portIndex}`, "bridge-final", "split-c-right", x, -13),
      createPort(`c-br-${portIndex}`, "split-c-right", "bottom-main", x, -22),
    ]),
  ],
  connections: START_END_XS.map((_, routeIndex) =>
    createConnection(routeIndex),
  ),
}
