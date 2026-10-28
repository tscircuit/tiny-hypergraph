import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "../../lib/core"

export const permissionSolveOptions: TinyHyperGraphSolverOptions = {
  MAX_ITERATIONS: 2_000,
  RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  GREEDY_FINAL_ROUTE_ITERS: 0,
  STATIC_REACHABILITY_PRECHECK: true,
  OWNED_REGIONAL_HOP_FRONTIER: true,
  USE_SPARSE_CANDIDATE_STORAGE: false,
  PARTIAL_RIP_ENABLED: false,
  OUTSIDE_IN_ROUTING: false,
}

export const createNativePermissionFixture = (
  netId = 0,
): { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem } => ({
  topology: {
    portCount: 4,
    regionCount: 4,
    regionIncidentPorts: [[0], [0, 1, 2], [1, 2, 3], [3]],
    incidentPortRegion: [[0, 1], [1, 2], [1, 2], [2, 3]],
    regionWidth: new Float64Array(4).fill(4),
    regionHeight: new Float64Array(4).fill(10),
    regionCenterX: Float64Array.of(-5, -2, 2, 5),
    regionCenterY: new Float64Array(4),
    regionAvailableZMask: Int32Array.of(3, 3, 3, 3),
    portAngleForRegion1: Int32Array.of(0, 0, 4000, 0),
    portAngleForRegion2: Int32Array.of(18000, 18000, 14000, 18000),
    portX: Float64Array.of(-3, 0, 0, 3),
    portY: Float64Array.of(0, 0, 4, 0),
    portZ: Int32Array.of(0, 0, 1, 0),
  },
  problem: {
    routeCount: 1,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: Int32Array.of(0),
    routeEndPort: Int32Array.of(3),
    routeNet: Int32Array.of(netId),
    routeMetadata: [{ connectionId: `route-${netId}`, mutuallyConnectedNetworkId: `net-${netId}` }],
    regionNetId: Int32Array.of(netId, -1, -1, netId),
    portPenalty: Float64Array.of(0, 0, 100, 0),
    portNetId: Int32Array.of(-1, 0, -1, -1),
  },
})

export const createSerializedPermissionFixture = (
  netIds: string[] = ["net-a"],
): SerializedHyperGraph => {
  const ports: SerializedHyperGraph["ports"] = [
    { portId: "restricted", region1Id: "left", region2Id: "right", d: { x: 0, y: 0, z: 0, allowedNetId: "net-a" } },
    { portId: "detour", region1Id: "left", region2Id: "right", d: { x: 0, y: 4, z: 1, tinyHypergraphPortPenalty: 100 } },
  ]
  for (const [index, netId] of netIds.entries()) {
    ports.push(
      { portId: `start-${netId}`, region1Id: `start-region-${netId}`, region2Id: "left", d: { x: -3, y: index / 10, z: 0 } },
      { portId: `end-${netId}`, region1Id: "right", region2Id: `end-region-${netId}`, d: { x: 3, y: index / 10, z: 0 } },
    )
  }
  const regionIds = ["left", "right", ...netIds.flatMap((netId) => [`start-region-${netId}`, `end-region-${netId}`])]
  return {
    regions: regionIds.map((regionId) => ({
      regionId,
      pointIds: ports.filter((port) => port.region1Id === regionId || port.region2Id === regionId).map((port) => port.portId),
      d: { center: { x: regionId === "left" ? -2 : regionId === "right" ? 2 : regionId.startsWith("start") ? -5 : 5, y: 0 }, width: 4, height: 10, availableZ: [0, 1] },
    })),
    ports,
    connections: netIds.map((netId) => ({
      connectionId: `route-${netId}`,
      mutuallyConnectedNetworkId: netId,
      startRegionId: `start-region-${netId}`,
      endRegionId: `end-region-${netId}`,
    })),
  }
}

export const getUsedRoutePortIds = (
  solver: TinyHyperGraphSolver,
  routeId = 0,
): number[] => {
  const used = new Set<number>()
  for (const segments of solver.state.regionSegments) {
    for (const [segmentRouteId, fromPort, toPort] of segments) {
      if (segmentRouteId === routeId) {
        used.add(fromPort)
        used.add(toPort)
      }
    }
  }
  return [...used]
}
