import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

const connection = {
  connectionId: "route-0",
  startRegionId: "src",
  endRegionId: "dst",
  mutuallyConnectedNetworkId: "net-0",
}

const createSolvedRoutePath = (
  portIds: string[],
  traversedRegionIds: string[],
) =>
  portIds.map((portId, pathIndex) => ({
    portId,
    g: pathIndex,
    h: 0,
    f: pathIndex,
    hops: pathIndex,
    ripRequired: false,
    lastPortId: pathIndex > 0 ? portIds[pathIndex - 1] : undefined,
    lastRegionId: pathIndex > 0 ? traversedRegionIds[pathIndex - 1] : undefined,
    nextRegionId:
      pathIndex < traversedRegionIds.length
        ? traversedRegionIds[pathIndex]
        : connection.endRegionId,
  }))

export const ambiguousRouteOutputFixture: SerializedHyperGraph = {
  regions: [
    {
      regionId: "src",
      pointIds: ["s"],
      d: { center: { x: -3, y: 0 }, width: 1, height: 1 },
    },
    {
      regionId: "upper",
      pointIds: ["s", "u", "v"],
      d: { center: { x: -0.5, y: 1 }, width: 4, height: 1 },
    },
    {
      regionId: "lower",
      pointIds: ["u", "v", "t"],
      d: { center: { x: -0.5, y: -1 }, width: 4, height: 1 },
    },
    {
      regionId: "dst",
      pointIds: ["t"],
      d: { center: { x: 3, y: 0 }, width: 1, height: 1 },
    },
  ],
  ports: [
    {
      portId: "s",
      region1Id: "src",
      region2Id: "upper",
      d: { x: -2, y: 0, z: 0 },
    },
    {
      portId: "u",
      region1Id: "upper",
      region2Id: "lower",
      d: { x: -1, y: 0, z: 0 },
    },
    {
      portId: "v",
      region1Id: "upper",
      region2Id: "lower",
      d: { x: 1, y: 0, z: 0 },
    },
    {
      portId: "t",
      region1Id: "lower",
      region2Id: "dst",
      d: { x: 2, y: 0, z: 0 },
    },
  ],
  connections: [connection],
  solvedRoutes: [
    {
      connection,
      requiredRip: false,
      path: createSolvedRoutePath(["s", "u", "v", "t"], [
        "upper",
        "lower",
        "lower",
      ]),
    },
  ],
}
