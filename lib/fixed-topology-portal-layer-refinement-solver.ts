import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { convertToSerializedHyperGraph } from "./compat/convertToSerializedHyperGraph"
import { computeEstimatedViaDemand } from "./computeRegionCost"
import {
  createEmptyRegionIntersectionCache,
  TinyHyperGraphSolver,
  type RegionCostSummary,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolution,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "./core"
import { countNewIntersectionsWithValues } from "./countNewIntersections"
import type {
  FixedTopologyPortalLayerRefinementStats,
  PhysicalPortGroupId,
  PortalLayerChange,
  PortId,
  RegionId,
  RegionIntersectionCache,
  RouteId,
} from "./types"
import { visualizeTinyGraph } from "./visualizeTinyGraph"

const REGION_COST_EPSILON = 1e-12

interface RoutePlan {
  routeId: RouteId
  orderedPortIds: PortId[]
  orderedRegionIds: RegionId[]
  physicalGroupIds: Int32Array
  reducibleTransitionCount: number
}

interface DpCandidate {
  portIds: PortId[]
  predictedViaDemand: number
  entryExitLayerChanges: number
  portPenalty: number
}

interface StateSummary extends RegionCostSummary {
  predictedViaDemand: number
  entryExitLayerChanges: number
}

export interface FixedTopologyPortalLayerRefinementSolverOptions
  extends TinyHyperGraphSolverOptions {
  regionCostEpsilon?: number
}

const getReplaySolverOptions = (
  options?: TinyHyperGraphSolverOptions,
): TinyHyperGraphSolverOptions => ({
  ...options,
  USE_LAZY_ROUTE_HEURISTIC: true,
  USE_SPARSE_CANDIDATE_STORAGE: true,
  STATIC_REACHABILITY_PRECHECK: false,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const cloneRegionIntersectionCache = (
  cache: RegionIntersectionCache,
): RegionIntersectionCache => ({
  netIds: new Int32Array(cache.netIds),
  lesserAngles: new Int32Array(cache.lesserAngles),
  greaterAngles: new Int32Array(cache.greaterAngles),
  layerMasks: new Int32Array(cache.layerMasks),
  existingCrossingLayerIntersections: cache.existingCrossingLayerIntersections,
  existingSameLayerIntersections: cache.existingSameLayerIntersections,
  existingEntryExitLayerChanges: cache.existingEntryExitLayerChanges,
  existingRegionCost: cache.existingRegionCost,
  existingSegmentCount: cache.existingSegmentCount,
})

const getSharedRegionId = (
  topology: TinyHyperGraphTopology,
  fromPortId: PortId,
  toPortId: PortId,
): RegionId => {
  const sharedRegionIds = (
    topology.incidentPortRegion[fromPortId] ?? []
  ).filter((regionId) =>
    (topology.incidentPortRegion[toPortId] ?? []).includes(regionId),
  )

  if (sharedRegionIds.length !== 1) {
    throw new Error(
      `Solved segment ${fromPortId}->${toPortId} does not identify exactly one region`,
    )
  }

  return sharedRegionIds[0]!
}

const getOrderedRoutePlan = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
  routeId: RouteId,
): RoutePlan => {
  const routeSegments = solution.solvedRoutePathSegments[routeId] ?? []
  const routeSegmentRegionIds =
    solution.solvedRoutePathRegionIds?.[routeId] ?? []
  const startPortId = problem.routeStartPort[routeId]!
  const endPortId = problem.routeEndPort[routeId]!

  if (routeSegments.length === 0) {
    if (startPortId !== endPortId) {
      throw new Error(`Route ${routeId} has no solved path`)
    }

    return {
      routeId,
      orderedPortIds: [startPortId],
      orderedRegionIds: [],
      physicalGroupIds: Int32Array.from([
        topology.portPhysicalGroupId?.[startPortId] ?? -1,
      ]),
      reducibleTransitionCount: 0,
    }
  }

  const segmentsByPort = new Map<
    PortId,
    Array<{
      segmentIndex: number
      fromPortId: PortId
      toPortId: PortId
      regionId: RegionId
    }>
  >()

  routeSegments.forEach(([fromPortId, toPortId], segmentIndex) => {
    const regionId =
      routeSegmentRegionIds[segmentIndex] ??
      getSharedRegionId(topology, fromPortId, toPortId)
    const segment = {
      segmentIndex,
      fromPortId,
      toPortId,
      regionId,
    }
    const fromSegments = segmentsByPort.get(fromPortId) ?? []
    fromSegments.push(segment)
    segmentsByPort.set(fromPortId, fromSegments)
    const toSegments = segmentsByPort.get(toPortId) ?? []
    toSegments.push(segment)
    segmentsByPort.set(toPortId, toSegments)
  })

  const orderedPortIds = [startPortId]
  const orderedRegionIds: RegionId[] = []
  const usedSegmentIndices = new Set<number>()
  let currentPortId = startPortId

  while (currentPortId !== endPortId) {
    const nextSegments = (segmentsByPort.get(currentPortId) ?? []).filter(
      ({ segmentIndex }) => !usedSegmentIndices.has(segmentIndex),
    )

    if (nextSegments.length !== 1) {
      throw new Error(
        `Route ${routeId} is not a single fixed path at port ${currentPortId}`,
      )
    }

    const nextSegment = nextSegments[0]!
    const nextPortId =
      nextSegment.fromPortId === currentPortId
        ? nextSegment.toPortId
        : nextSegment.fromPortId
    usedSegmentIndices.add(nextSegment.segmentIndex)
    orderedRegionIds.push(nextSegment.regionId)
    orderedPortIds.push(nextPortId)
    currentPortId = nextPortId
  }

  if (usedSegmentIndices.size !== routeSegments.length) {
    throw new Error(`Route ${routeId} contains disconnected solved segments`)
  }

  const physicalGroupIds = Int32Array.from(orderedPortIds, (portId) =>
    Number(topology.portPhysicalGroupId?.[portId] ?? -1),
  )
  let reducibleTransitionCount = 0
  for (let portIndex = 1; portIndex < orderedPortIds.length; portIndex++) {
    const fromPortId = orderedPortIds[portIndex - 1]!
    const toPortId = orderedPortIds[portIndex]!
    if (
      topology.portZ[fromPortId] !== topology.portZ[toPortId] &&
      (physicalGroupIds[portIndex - 1]! >= 0 ||
        physicalGroupIds[portIndex]! >= 0)
    ) {
      reducibleTransitionCount += 1
    }
  }

  return {
    routeId,
    orderedPortIds,
    orderedRegionIds,
    physicalGroupIds,
    reducibleTransitionCount,
  }
}

const resetSolvedState = (solver: TinyHyperGraphSolver) => {
  solver.state.portAssignment.fill(-1)
  solver.state.regionSegments = Array.from(
    { length: solver.topology.regionCount },
    () => [],
  )
  solver.state.regionIntersectionCaches = Array.from(
    { length: solver.topology.regionCount },
    () => createEmptyRegionIntersectionCache(),
  )
  solver.state.regionCongestionCost.fill(0)
  solver.state.currentRouteId = undefined
  solver.state.currentRouteNetId = undefined
  solver.state.unroutedRoutes = []
  solver.state.candidateQueue.clear()
  solver.resetCandidateBestCosts()
  solver.state.goalPortId = -1
  solver.state.ripCount = 0
}

const appendRoutePlanToSolver = (
  solver: TinyHyperGraphSolver,
  routePlan: RoutePlan,
) => {
  const routeNet = solver.problem.routeNet[routePlan.routeId]!
  solver.state.currentRouteNetId = routeNet

  for (
    let segmentIndex = 0;
    segmentIndex < routePlan.orderedRegionIds.length;
    segmentIndex++
  ) {
    const regionId = routePlan.orderedRegionIds[segmentIndex]!
    const fromPortId = routePlan.orderedPortIds[segmentIndex]!
    const toPortId = routePlan.orderedPortIds[segmentIndex + 1]!
    solver.state.regionSegments[regionId]!.push([
      routePlan.routeId,
      fromPortId,
      toPortId,
    ])
    solver.state.portAssignment[fromPortId] = routeNet
    solver.state.portAssignment[toPortId] = routeNet
    solver.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
  }
}

const createSolvedSolver = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  routePlans: RoutePlan[],
  options?: TinyHyperGraphSolverOptions,
) => {
  const solver = new TinyHyperGraphSolver(
    topology,
    problem,
    getReplaySolverOptions(options),
  )
  resetSolvedState(solver)
  const expectedSegmentCount = routePlans.reduce(
    (count, routePlan) => count + routePlan.orderedRegionIds.length,
    0,
  )
  if (
    problem.initialAssignments &&
    problem.initialAssignments.length === expectedSegmentCount
  ) {
    for (const assignment of problem.initialAssignments) {
      solver.state.currentRouteNetId = problem.routeNet[assignment.routeId]!
      solver.state.regionSegments[assignment.regionId]!.push([
        assignment.routeId,
        assignment.fromPortId,
        assignment.toPortId,
      ])
      solver.state.portAssignment[assignment.fromPortId] =
        solver.state.currentRouteNetId
      solver.state.portAssignment[assignment.toPortId] =
        solver.state.currentRouteNetId
      solver.appendSegmentToRegionCache(
        assignment.regionId,
        assignment.fromPortId,
        assignment.toPortId,
      )
    }
  } else {
    for (const routePlan of routePlans) {
      appendRoutePlanToSolver(solver, routePlan)
    }
  }
  solver.state.currentRouteNetId = undefined
  solver.solved = true
  solver.failed = false
  solver.error = null
  return solver
}

const summarizeState = (solver: TinyHyperGraphSolver): StateSummary => {
  let maxRegionCost = 0
  let totalRegionCost = 0
  let predictedViaDemand = 0
  let entryExitLayerChanges = 0

  for (const cache of solver.state.regionIntersectionCaches) {
    maxRegionCost = Math.max(maxRegionCost, cache.existingRegionCost)
    totalRegionCost += cache.existingRegionCost
    predictedViaDemand += computeEstimatedViaDemand(
      cache.existingSameLayerIntersections,
      cache.existingCrossingLayerIntersections,
      cache.existingEntryExitLayerChanges,
    )
    entryExitLayerChanges += cache.existingEntryExitLayerChanges
  }

  return {
    maxRegionCost,
    totalRegionCost,
    predictedViaDemand,
    entryExitLayerChanges,
  }
}

const comparePortSequences = (
  topology: TinyHyperGraphTopology,
  left: PortId[],
  right: PortId[],
) => {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const leftPortId = left[index]!
    const rightPortId = right[index]!
    const zDelta = topology.portZ[leftPortId]! - topology.portZ[rightPortId]!
    if (zDelta !== 0) return zDelta
    if (leftPortId !== rightPortId) return leftPortId - rightPortId
  }
  return left.length - right.length
}

const compareDpCandidates = (
  topology: TinyHyperGraphTopology,
  left: DpCandidate,
  right: DpCandidate,
) => {
  if (left.predictedViaDemand !== right.predictedViaDemand) {
    return left.predictedViaDemand - right.predictedViaDemand
  }
  if (left.entryExitLayerChanges !== right.entryExitLayerChanges) {
    return left.entryExitLayerChanges - right.entryExitLayerChanges
  }
  if (left.portPenalty !== right.portPenalty) {
    return left.portPenalty - right.portPenalty
  }
  return comparePortSequences(topology, left.portIds, right.portIds)
}

const regionSupportsZ = (
  topology: TinyHyperGraphTopology,
  regionId: RegionId,
  z: number,
) => {
  const availableZMask = topology.regionAvailableZMask?.[regionId] ?? 0
  return availableZMask === 0 || (availableZMask & (1 << z)) !== 0
}

const isAssignableViaRegion = (
  topology: TinyHyperGraphTopology,
  regionId: RegionId,
) => {
  const metadata = topology.regionMetadata?.[regionId]
  return isRecord(metadata) && metadata._assignableVia === true
}

export class FixedTopologyPortalLayerRefinementSolver extends BaseSolver {
  override MAX_ITERATIONS = 1

  refinedSolver: TinyHyperGraphSolver
  scratchSolver: TinyHyperGraphSolver
  routePlans: RoutePlan[]
  usedRouteIdsByPort: Array<Set<RouteId>>
  routeQueue: RouteId[] = []
  queuedRouteIds = new Set<RouteId>()
  eligibleRouteIds = new Set<RouteId>()
  lastAcceptedRegionIds: RegionId[] = []
  refinementStartTime = 0
  touchedRegionIds = new Set<RegionId>()
  changes: PortalLayerChange[] = []
  private scratchRegionIds = new Set<RegionId>()

  private refinementStats: FixedTopologyPortalLayerRefinementStats = {
    physicalPortalGroupCount: 0,
    eligibleRouteCount: 0,
    routesConsidered: 0,
    routesImproved: 0,
    predictedViaDemandBefore: 0,
    predictedViaDemandAfter: 0,
    entryExitLayerChangesBefore: 0,
    entryExitLayerChangesAfter: 0,
    candidateCount: 0,
    acceptedCandidateCount: 0,
    touchedRegionCount: 0,
    rejectedForRegionCostCount: 0,
    rejectedForIntersectionRegressionCount: 0,
    rejectedForPortConflictCount: 0,
    rejectedForLockedAssignmentCount: 0,
    rejectedForNoViaDemandImprovementCount: 0,
    rejectedForNoEntryExitImprovementCount: 0,
    portalLayerRefinementMs: 0,
  }

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    public solution: TinyHyperGraphSolution,
    public options: FixedTopologyPortalLayerRefinementSolverOptions = {},
  ) {
    super()
    this.routePlans = Array.from({ length: problem.routeCount }, (_, routeId) =>
      getOrderedRoutePlan(topology, problem, solution, routeId),
    )
    this.usedRouteIdsByPort = Array.from(
      { length: topology.portCount },
      () => new Set<RouteId>(),
    )
    for (const routePlan of this.routePlans) {
      for (const portId of routePlan.orderedPortIds) {
        this.usedRouteIdsByPort[portId]!.add(routePlan.routeId)
      }
    }
    this.refinedSolver = createSolvedSolver(
      topology,
      problem,
      this.routePlans,
      options,
    )
    this.scratchSolver = new TinyHyperGraphSolver(
      topology,
      problem,
      getReplaySolverOptions(options),
    )
    resetSolvedState(this.scratchSolver)
  }

  override _setup() {
    this.refinementStartTime = performance.now()
    const initialSummary = summarizeState(this.refinedSolver)
    this.refinementStats.physicalPortalGroupCount =
      this.topology.physicalPortalGroupCount ?? 0
    this.refinementStats.predictedViaDemandBefore =
      initialSummary.predictedViaDemand
    this.refinementStats.predictedViaDemandAfter =
      initialSummary.predictedViaDemand
    this.refinementStats.entryExitLayerChangesBefore =
      initialSummary.entryExitLayerChanges
    this.refinementStats.entryExitLayerChangesAfter =
      initialSummary.entryExitLayerChanges

    const usedRouteIdsByPort = this.getUsedRouteIdsByPort()
    this.routeQueue = this.routePlans
      .filter((routePlan) =>
        this.isEligibleRoute(routePlan, usedRouteIdsByPort),
      )
      .sort((left, right) => this.compareRoutePlans(left, right))
      .map(({ routeId }) => routeId)
    this.queuedRouteIds = new Set(this.routeQueue)
    this.eligibleRouteIds = new Set(this.routeQueue)
    this.refinementStats.eligibleRouteCount = this.routeQueue.length
    this.MAX_ITERATIONS =
      this.problem.routeCount * (initialSummary.predictedViaDemand + 1) +
      this.problem.routeCount +
      1

    if (this.routeQueue.length === 0) {
      this.finish()
    }
  }

  private compareRoutePlans(left: RoutePlan, right: RoutePlan) {
    return (
      right.reducibleTransitionCount - left.reducibleTransitionCount ||
      right.orderedPortIds.length - left.orderedPortIds.length ||
      left.routeId - right.routeId
    )
  }

  private isEligibleRoute(
    routePlan: RoutePlan,
    usedRouteIdsByPort: Array<Set<RouteId>>,
  ) {
    if (
      this.problem.portalLayerRefinementLockedRouteMask?.[routePlan.routeId] ===
      1
    ) {
      this.refinementStats.rejectedForLockedAssignmentCount += 1
      return false
    }

    if (
      routePlan.orderedRegionIds.some((regionId) =>
        isAssignableViaRegion(this.topology, regionId),
      )
    ) {
      this.refinementStats.rejectedForLockedAssignmentCount += 1
      return false
    }

    for (
      let portIndex = 1;
      portIndex < routePlan.orderedPortIds.length - 1;
      portIndex++
    ) {
      if (
        routePlan.physicalGroupIds[portIndex]! >= 0 &&
        this.getAlternativePorts(routePlan, portIndex, usedRouteIdsByPort)
          .length > 1
      ) {
        return true
      }
    }

    return false
  }

  private getUsedRouteIdsByPort() {
    return this.usedRouteIdsByPort
  }

  private getAlternativePorts(
    routePlan: RoutePlan,
    portIndex: number,
    usedRouteIdsByPort: Array<Set<RouteId>>,
  ) {
    const currentPortId = routePlan.orderedPortIds[portIndex]!
    const physicalGroupId = routePlan.physicalGroupIds[portIndex]!
    const groupPortIdByZ = this.topology.physicalGroupPortIdByZ
    const layerCount = this.topology.physicalGroupLayerCount ?? 0

    if (physicalGroupId < 0 || !groupPortIdByZ || layerCount === 0) {
      return [currentPortId]
    }

    const previousRegionId = routePlan.orderedRegionIds[portIndex - 1]
    const nextRegionId = routePlan.orderedRegionIds[portIndex]
    if (previousRegionId === undefined || nextRegionId === undefined) {
      return [currentPortId]
    }

    const routeNetId = this.problem.routeNet[routePlan.routeId]!
    const alternatives: PortId[] = []

    for (let z = 0; z < layerCount; z++) {
      const portId = groupPortIdByZ[physicalGroupId * layerCount + z] ?? -1
      if (portId < 0) continue
      if (portId === currentPortId) {
        alternatives.push(portId)
        continue
      }

      const incidentRegionIds = this.topology.incidentPortRegion[portId] ?? []
      if (
        !incidentRegionIds.includes(previousRegionId) ||
        !incidentRegionIds.includes(nextRegionId) ||
        this.problem.portSectionMask[portId] !== 1 ||
        !regionSupportsZ(this.topology, previousRegionId, z) ||
        !regionSupportsZ(this.topology, nextRegionId, z)
      ) {
        continue
      }

      const endpointReservationNetId =
        this.refinedSolver.problemSetup.portEndpointReservationNetId[portId] ??
        -1
      if (
        endpointReservationNetId !== -1 &&
        endpointReservationNetId !== routeNetId
      ) {
        continue
      }

      if (
        [...usedRouteIdsByPort[portId]!].some(
          (usedRouteId) => usedRouteId !== routePlan.routeId,
        )
      ) {
        continue
      }

      alternatives.push(portId)
    }

    if (!alternatives.includes(currentPortId)) {
      alternatives.push(currentPortId)
    }
    alternatives.sort(
      (left, right) =>
        this.topology.portZ[left]! - this.topology.portZ[right]! ||
        left - right,
    )
    return alternatives
  }

  private createBackgroundSolver(routeId: RouteId, regionIds: Set<RegionId>) {
    const solver = this.scratchSolver
    const regionIdsToClear = new Set([...this.scratchRegionIds, ...regionIds])
    for (const regionId of regionIdsToClear) {
      solver.state.regionSegments[regionId] = []
      solver.state.regionIntersectionCaches[regionId] =
        createEmptyRegionIntersectionCache()
    }
    this.scratchRegionIds = new Set(regionIds)

    for (const regionId of regionIds) {
      for (const [segmentRouteId, fromPortId, toPortId] of this.refinedSolver
        .state.regionSegments[regionId] ?? []) {
        if (segmentRouteId === routeId) continue
        solver.state.currentRouteNetId = this.problem.routeNet[segmentRouteId]!
        solver.state.regionSegments[regionId]!.push([
          segmentRouteId,
          fromPortId,
          toPortId,
        ])
        solver.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }

    solver.state.currentRouteNetId = undefined
    return solver
  }

  private getBestCandidate(routePlan: RoutePlan): DpCandidate | undefined {
    const usedRouteIdsByPort = this.getUsedRouteIdsByPort()
    const domains = routePlan.orderedPortIds.map((currentPortId, portIndex) =>
      portIndex === 0 || portIndex === routePlan.orderedPortIds.length - 1
        ? [currentPortId]
        : this.getAlternativePorts(routePlan, portIndex, usedRouteIdsByPort),
    )
    const touchedRegionIds = new Set(routePlan.orderedRegionIds)
    const backgroundSolver = this.createBackgroundSolver(
      routePlan.routeId,
      touchedRegionIds,
    )
    const routeNetId = this.problem.routeNet[routePlan.routeId]!
    let candidatesByPort = new Map<PortId, DpCandidate>()
    const startPortId = domains[0]![0]!
    candidatesByPort.set(startPortId, {
      portIds: [startPortId],
      predictedViaDemand: 0,
      entryExitLayerChanges: 0,
      portPenalty: this.problem.portPenalty?.[startPortId] ?? 0,
    })

    for (
      let segmentIndex = 0;
      segmentIndex < routePlan.orderedRegionIds.length;
      segmentIndex++
    ) {
      const regionId = routePlan.orderedRegionIds[segmentIndex]!
      const nextCandidatesByPort = new Map<PortId, DpCandidate>()

      for (const previousCandidate of candidatesByPort.values()) {
        const fromPortId =
          previousCandidate.portIds[previousCandidate.portIds.length - 1]!
        for (const toPortId of domains[segmentIndex + 1]!) {
          this.refinementStats.candidateCount += 1
          const geometry = backgroundSolver.populateSegmentGeometryScratch(
            regionId,
            fromPortId,
            toPortId,
          )
          const [sameLayer, crossLayer, entryExit] =
            countNewIntersectionsWithValues(
              backgroundSolver.state.regionIntersectionCaches[regionId]!,
              routeNetId,
              geometry.lesserAngle,
              geometry.greaterAngle,
              geometry.layerMask,
              geometry.entryExitLayerChanges,
            )
          const candidate: DpCandidate = {
            portIds: [...previousCandidate.portIds, toPortId],
            predictedViaDemand:
              previousCandidate.predictedViaDemand +
              computeEstimatedViaDemand(sameLayer, crossLayer, entryExit),
            entryExitLayerChanges:
              previousCandidate.entryExitLayerChanges + entryExit,
            portPenalty:
              previousCandidate.portPenalty +
              (this.problem.portPenalty?.[toPortId] ?? 0),
          }
          const existingCandidate = nextCandidatesByPort.get(toPortId)
          if (
            !existingCandidate ||
            compareDpCandidates(this.topology, candidate, existingCandidate) < 0
          ) {
            nextCandidatesByPort.set(toPortId, candidate)
          }
        }
      }

      candidatesByPort = nextCandidatesByPort
    }

    return [...candidatesByPort.values()].sort((left, right) =>
      compareDpCandidates(this.topology, left, right),
    )[0]
  }

  private rebuildRegionCache(regionId: RegionId) {
    this.refinedSolver.state.regionIntersectionCaches[regionId] =
      createEmptyRegionIntersectionCache()
    for (const [routeId, fromPortId, toPortId] of this.refinedSolver.state
      .regionSegments[regionId] ?? []) {
      this.refinedSolver.state.currentRouteNetId =
        this.problem.routeNet[routeId]!
      this.refinedSolver.appendSegmentToRegionCache(
        regionId,
        fromPortId,
        toPortId,
      )
    }
    this.refinedSolver.state.currentRouteNetId = undefined
  }

  private recomputePortAssignments(): boolean {
    const routeIdsByPort = Array.from(
      { length: this.topology.portCount },
      () => new Set<RouteId>(),
    )
    this.refinedSolver.state.portAssignment.fill(-1)

    for (const regionSegments of this.refinedSolver.state.regionSegments) {
      for (const [routeId, fromPortId, toPortId] of regionSegments) {
        routeIdsByPort[fromPortId]!.add(routeId)
        routeIdsByPort[toPortId]!.add(routeId)
      }
    }

    for (let portId = 0; portId < routeIdsByPort.length; portId++) {
      const routeIds = routeIdsByPort[portId]!
      if (routeIds.size === 0) continue
      const netIds = new Set(
        [...routeIds].map((routeId) => this.problem.routeNet[routeId]!),
      )
      if (netIds.size > 1) {
        return false
      }
      this.refinedSolver.state.portAssignment[portId] = [...netIds][0]!
    }

    return true
  }

  private tryCandidate(routePlan: RoutePlan, candidate: DpCandidate) {
    this.lastAcceptedRegionIds = []
    if (
      candidate.portIds.every(
        (portId, portIndex) => portId === routePlan.orderedPortIds[portIndex],
      )
    ) {
      this.refinementStats.rejectedForNoViaDemandImprovementCount += 1
      this.refinementStats.rejectedForNoEntryExitImprovementCount += 1
      return false
    }

    const baselineSummary = summarizeState(this.refinedSolver)
    const changedSegmentIndices: number[] = []
    for (
      let segmentIndex = 0;
      segmentIndex < routePlan.orderedRegionIds.length;
      segmentIndex++
    ) {
      if (
        routePlan.orderedPortIds[segmentIndex] !==
          candidate.portIds[segmentIndex] ||
        routePlan.orderedPortIds[segmentIndex + 1] !==
          candidate.portIds[segmentIndex + 1]
      ) {
        changedSegmentIndices.push(segmentIndex)
      }
    }
    const touchedRegionIds = [
      ...new Set(
        changedSegmentIndices.map(
          (segmentIndex) => routePlan.orderedRegionIds[segmentIndex]!,
        ),
      ),
    ]
    const savedSegments = new Map(
      touchedRegionIds.map((regionId) => [
        regionId,
        this.refinedSolver.state.regionSegments[regionId]!.map(
          ([routeId, fromPortId, toPortId]) =>
            [routeId, fromPortId, toPortId] as [RouteId, PortId, PortId],
        ),
      ]),
    )
    const savedCaches = new Map(
      touchedRegionIds.map((regionId) => [
        regionId,
        cloneRegionIntersectionCache(
          this.refinedSolver.state.regionIntersectionCaches[regionId]!,
        ),
      ]),
    )
    const savedPortAssignment = new Int32Array(
      this.refinedSolver.state.portAssignment,
    )

    for (const regionId of touchedRegionIds) {
      const candidateSegments = routePlan.orderedRegionIds
        .flatMap((candidateRegionId, segmentIndex) =>
          candidateRegionId === regionId ? [segmentIndex] : [],
        )
        .map(
          (segmentIndex) =>
            [
              routePlan.routeId,
              candidate.portIds[segmentIndex]!,
              candidate.portIds[segmentIndex + 1]!,
            ] as [RouteId, PortId, PortId],
        )
      let candidateSegmentIndex = 0
      this.refinedSolver.state.regionSegments[regionId] =
        this.refinedSolver.state.regionSegments[regionId]!.map((segment) => {
          if (
            segment[0] !== routePlan.routeId ||
            candidateSegmentIndex >= candidateSegments.length
          ) {
            return segment
          }
          return candidateSegments[candidateSegmentIndex++]!
        })

      if (candidateSegmentIndex !== candidateSegments.length) {
        throw new Error(
          `Route ${routePlan.routeId} changed segment count in region ${regionId}`,
        )
      }
    }
    for (const regionId of touchedRegionIds) {
      this.rebuildRegionCache(regionId)
    }

    const hasValidPortAssignments = this.recomputePortAssignments()
    const candidateSummary = summarizeState(this.refinedSolver)
    const epsilon = this.options.regionCostEpsilon ?? REGION_COST_EPSILON
    const regionCostDidNotWorsen =
      candidateSummary.maxRegionCost <=
        baselineSummary.maxRegionCost + epsilon &&
      candidateSummary.totalRegionCost <=
        baselineSummary.totalRegionCost + epsilon
    const intersectionCountsDidNotWorsen = touchedRegionIds.every(
      (regionId) => {
        const before = savedCaches.get(regionId)!
        const after =
          this.refinedSolver.state.regionIntersectionCaches[regionId]!
        return (
          after.existingSameLayerIntersections <=
            before.existingSameLayerIntersections &&
          after.existingCrossingLayerIntersections <=
            before.existingCrossingLayerIntersections &&
          after.existingEntryExitLayerChanges <=
            before.existingEntryExitLayerChanges
        )
      },
    )
    const viaDemandImproved =
      candidateSummary.predictedViaDemand < baselineSummary.predictedViaDemand
    const entryExitLayerChangesImproved =
      candidateSummary.entryExitLayerChanges <
      baselineSummary.entryExitLayerChanges

    if (
      !hasValidPortAssignments ||
      !regionCostDidNotWorsen ||
      !intersectionCountsDidNotWorsen ||
      !viaDemandImproved ||
      !entryExitLayerChangesImproved
    ) {
      for (const regionId of touchedRegionIds) {
        this.refinedSolver.state.regionSegments[regionId] =
          savedSegments.get(regionId)!
        this.refinedSolver.state.regionIntersectionCaches[regionId] =
          savedCaches.get(regionId)!
      }
      this.refinedSolver.state.portAssignment = savedPortAssignment
      if (!hasValidPortAssignments) {
        this.refinementStats.rejectedForPortConflictCount += 1
      }
      if (!regionCostDidNotWorsen) {
        this.refinementStats.rejectedForRegionCostCount += 1
      }
      if (!intersectionCountsDidNotWorsen) {
        this.refinementStats.rejectedForIntersectionRegressionCount += 1
      }
      if (!viaDemandImproved) {
        this.refinementStats.rejectedForNoViaDemandImprovementCount += 1
      }
      if (!entryExitLayerChangesImproved) {
        this.refinementStats.rejectedForNoEntryExitImprovementCount += 1
      }
      return false
    }

    for (
      let portIndex = 1;
      portIndex < routePlan.orderedPortIds.length - 1;
      portIndex++
    ) {
      const fromPortId = routePlan.orderedPortIds[portIndex]!
      const toPortId = candidate.portIds[portIndex]!
      if (fromPortId === toPortId) continue
      this.changes.push({
        routeId: routePlan.routeId,
        physicalPortGroupId: routePlan.physicalGroupIds[
          portIndex
        ]! as PhysicalPortGroupId,
        fromPortId,
        toPortId,
        fromZ: this.topology.portZ[fromPortId]!,
        toZ: this.topology.portZ[toPortId]!,
      })
    }
    for (const portId of new Set(routePlan.orderedPortIds)) {
      this.usedRouteIdsByPort[portId]!.delete(routePlan.routeId)
    }
    for (const portId of new Set(candidate.portIds)) {
      this.usedRouteIdsByPort[portId]!.add(routePlan.routeId)
    }
    routePlan.orderedPortIds = candidate.portIds
    this.refinementStats.routesImproved += 1
    this.refinementStats.acceptedCandidateCount += 1
    this.refinementStats.predictedViaDemandAfter =
      candidateSummary.predictedViaDemand
    this.refinementStats.entryExitLayerChangesAfter =
      candidateSummary.entryExitLayerChanges
    for (const regionId of touchedRegionIds) {
      this.touchedRegionIds.add(regionId)
    }
    this.lastAcceptedRegionIds = touchedRegionIds
    return true
  }

  override _step() {
    const routeId = this.routeQueue.shift()
    if (routeId === undefined) {
      this.finish()
      return
    }
    this.queuedRouteIds.delete(routeId)
    const routePlan = this.routePlans[routeId]!
    this.refinementStats.routesConsidered += 1
    const candidate = this.getBestCandidate(routePlan)
    if (candidate && this.tryCandidate(routePlan, candidate)) {
      const affectedRouteIds = new Set<RouteId>([routeId])
      for (const regionId of this.lastAcceptedRegionIds) {
        for (const [affectedRouteId] of this.refinedSolver.state.regionSegments[
          regionId
        ] ?? []) {
          affectedRouteIds.add(affectedRouteId)
        }
      }
      for (const affectedRouteId of affectedRouteIds) {
        if (
          this.eligibleRouteIds.has(affectedRouteId) &&
          !this.queuedRouteIds.has(affectedRouteId)
        ) {
          this.routeQueue.push(affectedRouteId)
          this.queuedRouteIds.add(affectedRouteId)
        }
      }
      this.routeQueue.sort((leftRouteId, rightRouteId) =>
        this.compareRoutePlans(
          this.routePlans[leftRouteId]!,
          this.routePlans[rightRouteId]!,
        ),
      )
    }
    this.updateStats()
  }

  private updateStats() {
    this.refinementStats.touchedRegionCount = this.touchedRegionIds.size
    this.refinementStats.portalLayerRefinementMs =
      performance.now() - this.refinementStartTime
    this.stats = { ...this.refinementStats }
  }

  private finish() {
    const finalSummary = summarizeState(this.refinedSolver)
    this.refinementStats.predictedViaDemandAfter =
      finalSummary.predictedViaDemand
    this.refinementStats.entryExitLayerChangesAfter =
      finalSummary.entryExitLayerChanges
    this.updateStats()
    this.refinedSolver.solved = true
    this.refinedSolver.failed = false
    this.refinedSolver.error = null
    this.solved = true
    this.failed = false
    this.error = null
  }

  getRefinedSolver() {
    return this.refinedSolver
  }

  override getOutput() {
    if (!this.solved || this.failed) {
      throw new Error(
        "FixedTopologyPortalLayerRefinementSolver has no solved output",
      )
    }
    return convertToSerializedHyperGraph(this.refinedSolver)
  }

  override visualize(): GraphicsObject {
    const graphics = visualizeTinyGraph(this.refinedSolver)
    graphics.circles ??= []
    graphics.texts ??= []

    for (const change of this.changes) {
      const x = this.topology.portX[change.toPortId]!
      const y = this.topology.portY[change.toPortId]!
      graphics.circles.push({
        center: { x, y },
        radius: 0.11,
        fill: "rgba(16, 185, 129, 0.25)",
        stroke: "rgba(5, 150, 105, 0.95)",
        label: `route ${change.routeId} | group ${change.physicalPortGroupId} | z${change.fromZ}->z${change.toZ}`,
      })
    }

    graphics.title = [
      "Fixed-topology portal-layer refinement",
      `via demand ${this.refinementStats.predictedViaDemandBefore}->${this.refinementStats.predictedViaDemandAfter}`,
      `entry/exit ${this.refinementStats.entryExitLayerChangesBefore}->${this.refinementStats.entryExitLayerChangesAfter}`,
      `accepted=${this.refinementStats.acceptedCandidateCount}`,
    ].join(" | ")
    return graphics
  }
}
