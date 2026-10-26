import {
  DistanceAwareTinyHyperGraphSolver,
  IndexedCandidateHeap,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "../../lib/index"

type RegionalBlockFixtureOptions = {
  owned: boolean
  goalPortId?: number
  portCount?: number
}

export const createRegionalBlockFixture = ({
  owned,
  goalPortId = 73,
  portCount = 74,
}: RegionalBlockFixtureOptions): DistanceAwareTinyHyperGraphSolver => {
  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount: 4,
    regionIncidentPorts: [
      Array.from({ length: portCount - 2 }, (_, portId) => portId),
      [...Array.from({ length: 64 }, (_, portId) => portId), portCount - 1],
      Array.from({ length: portCount - 66 }, (_, index) => index + 64),
      [portCount - 1],
    ],
    incidentPortRegion: Array.from({ length: portCount }, (_, portId) =>
      portId < 64 ? [0, 1] : portId === portCount - 1 ? [1, 3] : [0, 2],
    ),
    regionWidth: new Float64Array(4).fill(100),
    regionHeight: new Float64Array(4).fill(100),
    regionCenterX: new Float64Array(4),
    regionCenterY: new Float64Array(4),
    portAngleForRegion1: Int32Array.from(
      { length: portCount },
      (_, portId) => portId * 100,
    ),
    portAngleForRegion2: Int32Array.from(
      { length: portCount },
      (_, portId) => portId * 100,
    ),
    portX: Float64Array.from({ length: portCount }, (_, portId) => portId),
    portY: new Float64Array(portCount),
    portZ: new Int32Array(portCount),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    routeStartPort: Int32Array.from([64]),
    routeEndPort: Int32Array.from([goalPortId]),
    routeNet: Int32Array.from([7]),
    regionNetId: new Int32Array(4).fill(-1),
    portSectionMask: new Int8Array(portCount).fill(1),
  }
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    OWNED_REGIONAL_HOP_FRONTIER: owned,
    STATIC_REACHABILITY_PRECHECK: false,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
  })
  solver._setup()
  solver.state.candidateQueue = new IndexedCandidateHeap(topology.regionCount)
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 7
  solver.state.goalPortId = goalPortId
  solver.state.unroutedRoutes = []
  return solver
}

export const seedRegionalBlockCosts = (
  solver: DistanceAwareTinyHyperGraphSolver,
  bestCost = 1,
): void => {
  for (const portId of solver.topology.regionIncidentPorts[0]) {
    const nextRegionId = solver.topology.incidentPortRegion[portId][1]
    const hopId = solver.getHopId(portId, nextRegionId)
    solver.setCandidateBestCost(hopId, bestCost)
  }
}

export const expandRegionalBlockFixture = (
  solver: DistanceAwareTinyHyperGraphSolver,
  candidate: { portId: number; g: number },
): void => {
  const hopId = solver.getHopId(candidate.portId, 0)
  solver.setCandidateBestCost(hopId, candidate.g)
  solver.state.candidateQueue.queue({
    hopId,
    portId: candidate.portId,
    nextRegionId: 0,
    g: candidate.g,
    h: 0,
    f: candidate.g,
  })
  solver._step()
}

export const snapshotRegionalBlockSolver = (
  solver: DistanceAwareTinyHyperGraphSolver,
): unknown => ({
  state: solver.state,
  stats: solver.stats,
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  iterations: solver.iterations,
})

export const serializeRegionalBlockSolver = (
  solver: DistanceAwareTinyHyperGraphSolver,
): string =>
  JSON.stringify(
    snapshotRegionalBlockSolver(solver),
    (_key, snapshotPart: unknown): unknown => {
      if (typeof snapshotPart === "number" && !Number.isFinite(snapshotPart)) {
        return String(snapshotPart)
      }
      if (ArrayBuffer.isView(snapshotPart)) return Object.values(snapshotPart)
      if (snapshotPart instanceof Map) return [...snapshotPart.entries()]
      if (snapshotPart instanceof Set) return [...snapshotPart]
      return snapshotPart
    },
  )

export const checkRegionalBlockList = (
  solver: DistanceAwareTinyHyperGraphSolver,
): number[] => {
  const frontier = solver["regionalHopFrontiers"].get(0)
  if (!frontier) return []
  const indices: number[] = []
  let index = frontier.head
  while (index !== -1 && indices.length <= frontier.neighbors.length) {
    if (indices.length > 0 && index <= indices[indices.length - 1]!) {
      throw new Error("Regional frontier list is not strictly ordered")
    }
    indices.push(index)
    index = frontier.next[index]!
  }
  if (index !== -1) throw new Error("Regional frontier list contains a cycle")
  return indices
}
