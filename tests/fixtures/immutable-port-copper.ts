import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

export const createImmutablePortCopperGraph = (
  routeNetIds: readonly string[],
  immutableNetIds?: readonly string[],
): SerializedHyperGraph => {
  const terminalPorts = routeNetIds.flatMap(
    (_netId: string, index: number): SerializedHyperGraph["ports"] => [
      {
        portId: `start-${index}`,
        region1Id: `start-region-${index}`,
        region2Id: "left",
        d: { x: -3, y: index / 10, z: 0 },
      },
      {
        portId: `end-${index}`,
        region1Id: "right",
        region2Id: `end-region-${index}`,
        d: { x: 3, y: index / 10, z: 0 },
      },
    ],
  )
  return {
    regions: [
      ...routeNetIds.flatMap(
        (_netId: string, index: number): SerializedHyperGraph["regions"] => [
          {
            regionId: `start-region-${index}`,
            pointIds: [`start-${index}`],
            d: {
              center: { x: -4, y: index / 10 },
              width: 2,
              height: 2,
              availableZ: [0],
            },
          },
          {
            regionId: `end-region-${index}`,
            pointIds: [`end-${index}`],
            d: {
              center: { x: 4, y: index / 10 },
              width: 2,
              height: 2,
              availableZ: [0],
            },
          },
        ],
      ),
      {
        regionId: "left",
        pointIds: [
          ...routeNetIds.map(
            (_netId: string, index: number): string => `start-${index}`,
          ),
          "occupied",
          "alternate",
        ],
        d: { center: { x: -1, y: 0 }, width: 4, height: 6, availableZ: [0] },
      },
      {
        regionId: "right",
        pointIds: [
          "occupied",
          "alternate",
          ...routeNetIds.map(
            (_netId: string, index: number): string => `end-${index}`,
          ),
        ],
        d: { center: { x: 1, y: 0 }, width: 4, height: 6, availableZ: [0] },
      },
    ],
    ports: [
      ...terminalPorts,
      {
        portId: "occupied",
        region1Id: "left",
        region2Id: "right",
        d: {
          x: 0,
          y: 0,
          z: 0,
          ...(immutableNetIds !== undefined && {
            immutableCopperNetIds: [...immutableNetIds],
          }),
        },
      },
      {
        portId: "alternate",
        region1Id: "left",
        region2Id: "right",
        d: { x: 0, y: 2, z: 0 },
      },
    ],
    connections: routeNetIds.map(
      (
        netId: string,
        index: number,
      ): NonNullable<SerializedHyperGraph["connections"]>[number] => ({
        connectionId: `route-${index}`,
        mutuallyConnectedNetworkId: netId,
        startRegionId: `start-region-${index}`,
        endRegionId: `end-region-${index}`,
      }),
    ),
  }
}
