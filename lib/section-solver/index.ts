import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  applyTinyHyperGraphSolverOptions,
  createEmptyRegionIntersectionCache,
  getTinyHyperGraphSolverOptions,
  type RegionCostSummary,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolution,
  type TinyHyperGraphTopology,
  type TinyHyperGraphSolverOptions,
} from "../core"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import { shuffle } from "../shuffle"
import type {
  PortId,
  RegionId,
  RegionIntersectionCache,
  RouteId,
} from "../types"
import { visualizeTinyGraph } from "../visualizeTinyGraph"
import {
  createSectionSolverLossyScoreCacheKey,
  createSectionSolverScoreCacheKey,
  createSectionSolverCacheContext,
  createSectionSolverCacheEntry,
  getSectionSolverCacheEntry,
  isSectionSolverLossyScoreKeyObservationEnabled,
  recordSectionSolverLossyScoreKeyObservation,
  getTinyHyperGraphSectionSolverCacheStats,
  hydrateSectionSolverCacheEntrySolution,
  recordSectionSolverCacheTiming,
  recordSectionSolverCacheLookup,
  setSectionSolverCacheEntry,
  setSectionSolverScoreCacheEntry,
} from "./cache"
export {
  advanceTinyHyperGraphSectionSolverCacheGeneration,
  clearTinyHyperGraphSectionSolverCache,
  createSectionSolverLossyScoreCacheKey,
  createSectionSolverLossyScoreDescriptor,
  getSectionSolverLossyDescriptorDistance,
  getSectionSolverLossyScoreKeyStats,
  getSectionSolverScoreCacheKeyStats,
  getSectionSolverScoreCacheEntry,
  setSectionSolverLossyScoreKeyObservationEnabled,
  getTinyHyperGraphSectionSolverCacheStats,
  toActualPoint as applySectionSolverCacheReverseTransform,
} from "./cache"

interface SolvedStateSnapshot {
  portAssignment: Int32Array
  regionSegments: Array<[RouteId, PortId, PortId][]>
  regionIntersectionCaches: RegionIntersectionCache[]
}

interface SectionRoutePlan {
  routeId: RouteId
  fixedSegments: Array<{
    regionId: RegionId
    fromPortId: PortId
    toPortId: PortId
  }>
  activeStartPortId?: PortId
  activeEndPortId?: PortId
  forcedStartRegionId?: RegionId
}

export interface TinyHyperGraphSectionSolverOptions
  extends TinyHyperGraphSolverOptions {
  ENABLE_CACHE?: boolean
  MAX_RIPS?: number
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT?: number
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST?: number
}

const applyTinyHyperGraphSectionSolverOptions = (
  solver:
    | TinyHyperGraphSectionSearchSolver
    | TinyHyperGraphSectionSolver,
  options?: TinyHyperGraphSectionSolverOptions,
) => {
  applyTinyHyperGraphSolverOptions(solver, options)

  if (!options) {
    return
  }

  if (options.MAX_RIPS !== undefined) {
    solver.MAX_RIPS = options.MAX_RIPS
  }
  if (options.ENABLE_CACHE !== undefined) {
    solver.ENABLE_CACHE = options.ENABLE_CACHE
  }
  if (options.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT !== undefined) {
    solver.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT =
      options.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT
  }
  if (options.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST !== undefined) {
    solver.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST =
      options.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST
  }
}

const getTinyHyperGraphSectionSolverOptions = (
  solver: TinyHyperGraphSectionSolver,
): TinyHyperGraphSectionSolverOptions => ({
  ...getTinyHyperGraphSolverOptions(solver),
  ENABLE_CACHE: solver.ENABLE_CACHE,
  MAX_RIPS: solver.MAX_RIPS,
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT:
    solver.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT,
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST:
    solver.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST,
})

const cloneRegionSegments = (
  regionSegments: Array<[RouteId, PortId, PortId][]>,
): Array<[RouteId, PortId, PortId][]> =>
  regionSegments.map((segments) =>
    segments.map(
      ([routeId, fromPortId, toPortId]) =>
        [routeId, fromPortId, toPortId] as [RouteId, PortId, PortId],
    ),
  )

const cloneRegionIntersectionCache = (
  regionIntersectionCache: RegionIntersectionCache,
): RegionIntersectionCache => ({
  netIds: new Int32Array(regionIntersectionCache.netIds),
  lesserAngles: new Int32Array(regionIntersectionCache.lesserAngles),
  greaterAngles: new Int32Array(regionIntersectionCache.greaterAngles),
  layerMasks: new Int32Array(regionIntersectionCache.layerMasks),
  existingCrossingLayerIntersections:
    regionIntersectionCache.existingCrossingLayerIntersections,
  existingSameLayerIntersections:
    regionIntersectionCache.existingSameLayerIntersections,
  existingEntryExitLayerChanges:
    regionIntersectionCache.existingEntryExitLayerChanges,
  existingRegionCost: regionIntersectionCache.existingRegionCost,
  existingSegmentCount: regionIntersectionCache.existingSegmentCount,
})

const cloneSolvedStateSnapshot = (
  snapshot: SolvedStateSnapshot,
): SolvedStateSnapshot => ({
  portAssignment: new Int32Array(snapshot.portAssignment),
  regionSegments: cloneRegionSegments(snapshot.regionSegments),
  regionIntersectionCaches: snapshot.regionIntersectionCaches.map(
    cloneRegionIntersectionCache,
  ),
})

const summarizeRegionIntersectionCaches = (
  regionIntersectionCaches: ArrayLike<RegionIntersectionCache>,
): RegionCostSummary => {
  let maxRegionCost = 0
  let totalRegionCost = 0

  for (
    let regionId = 0;
    regionId < regionIntersectionCaches.length;
    regionId++
  ) {
    const regionCost =
      regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
    maxRegionCost = Math.max(maxRegionCost, regionCost)
    totalRegionCost += regionCost
  }

  return {
    maxRegionCost,
    totalRegionCost,
  }
}

const summarizeRegionIntersectionCachesForRegionIds = (
  regionIntersectionCaches: ArrayLike<RegionIntersectionCache>,
  regionIds: RegionId[],
): RegionCostSummary => {
  let maxRegionCost = 0
  let totalRegionCost = 0

  for (const regionId of regionIds) {
    const regionCost =
      regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
    maxRegionCost = Math.max(maxRegionCost, regionCost)
    totalRegionCost += regionCost
  }

  return {
    maxRegionCost,
    totalRegionCost,
  }
}

const compareRegionCostSummaries = (
  left: RegionCostSummary,
  right: RegionCostSummary,
) => {
  if (left.maxRegionCost !== right.maxRegionCost) {
    return left.maxRegionCost - right.maxRegionCost
  }

  return left.totalRegionCost - right.totalRegionCost
}

const getSharedRegionIdForPorts = (
  topology: TinyHyperGraphTopology,
  fromPortId: PortId,
  toPortId: PortId,
): RegionId => {
  const fromIncidentRegions = topology.incidentPortRegion[fromPortId] ?? []
  const toIncidentRegions = topology.incidentPortRegion[toPortId] ?? []
  const sharedRegionId = fromIncidentRegions.find((regionId) =>
    toIncidentRegions.includes(regionId),
  )

  if (sharedRegionId === undefined) {
    throw new Error(`Ports ${fromPortId} and ${toPortId} do not share a region`)
  }

  return sharedRegionId
}

const getOrderedRoutePath = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
  routeId: RouteId,
): {
  orderedPortIds: PortId[]
  orderedRegionIds: RegionId[]
} => {
  const routeSegments = solution.solvedRoutePathSegments[routeId] ?? []
  const routeSegmentRegionIds = solution.solvedRoutePathRegionIds?.[routeId] ?? []
  const startPortId = problem.routeStartPort[routeId]
  const endPortId = problem.routeEndPort[routeId]

  if (routeSegments.length === 0) {
    if (startPortId === endPortId) {
      return {
        orderedPortIds: [startPortId],
        orderedRegionIds: [],
      }
    }

    throw new Error(`Route ${routeId} does not have an existing solved path`)
  }

  const segmentsByPort = new Map<
    PortId,
    Array<{
      segmentIndex: number
      fromPortId: PortId
      toPortId: PortId
      regionId?: RegionId
    }>
  >()

  routeSegments.forEach(([fromPortId, toPortId], segmentIndex) => {
    const indexedSegment = {
      segmentIndex,
      fromPortId,
      toPortId,
      regionId: routeSegmentRegionIds[segmentIndex],
    }

    const fromSegments = segmentsByPort.get(fromPortId) ?? []
    fromSegments.push(indexedSegment)
    segmentsByPort.set(fromPortId, fromSegments)

    const toSegments = segmentsByPort.get(toPortId) ?? []
    toSegments.push(indexedSegment)
    segmentsByPort.set(toPortId, toSegments)
  })

  const orderedPortIds = [startPortId]
  const orderedRegionIds: RegionId[] = []
  const usedSegmentIndices = new Set<number>()
  let currentPortId = startPortId
  let previousPortId: PortId | undefined

  while (currentPortId !== endPortId) {
    const nextSegments = (segmentsByPort.get(currentPortId) ?? []).filter(
      ({ segmentIndex, fromPortId, toPortId }) => {
        if (usedSegmentIndices.has(segmentIndex)) {
          return false
        }

        const nextPortId = fromPortId === currentPortId ? toPortId : fromPortId

        return nextPortId !== previousPortId
      },
    )

    if (nextSegments.length !== 1) {
      throw new Error(
        `Route ${routeId} is not a single ordered path from ${startPortId} to ${endPortId}`,
      )
    }

    const nextSegment = nextSegments[0]!
    const nextPortId =
      nextSegment.fromPortId === currentPortId
        ? nextSegment.toPortId
        : nextSegment.fromPortId

    usedSegmentIndices.add(nextSegment.segmentIndex)
    orderedRegionIds.push(
      nextSegment.regionId ??
        getSharedRegionIdForPorts(
          topology,
          nextSegment.fromPortId,
          nextSegment.toPortId,
        ),
    )
    orderedPortIds.push(nextPortId)
    previousPortId = currentPortId
    currentPortId = nextPortId
  }

  if (usedSegmentIndices.size !== routeSegments.length) {
    throw new Error(`Route ${routeId} contains disconnected solved segments`)
  }

  return {
    orderedPortIds,
    orderedRegionIds,
  }
}

const applyRouteSegmentsToSolver = (
  solver: TinyHyperGraphSolver,
  routeSegmentsByRegion: Array<[RouteId, PortId, PortId][]>,
) => {
  solver.state.portAssignment.fill(-1)
  solver.state.regionSegments = Array.from(
    { length: solver.topology.regionCount },
    () => [],
  )
  solver.state.regionIntersectionCaches = Array.from(
    { length: solver.topology.regionCount },
    () => createEmptyRegionIntersectionCache(),
  )
  solver.state.currentRouteId = undefined
  solver.state.currentRouteNetId = undefined
  solver.state.unroutedRoutes = []
  solver.state.candidateQueue.clear()
  solver.state.candidateBestCostByHopId.fill(Number.POSITIVE_INFINITY)
  solver.state.goalPortId = -1
  solver.state.ripCount = 0
  solver.state.regionCongestionCost.fill(0)

  for (let regionId = 0; regionId < routeSegmentsByRegion.length; regionId++) {
    for (const [routeId, fromPortId, toPortId] of routeSegmentsByRegion[
      regionId
    ] ?? []) {
      solver.state.currentRouteNetId = solver.problem.routeNet[routeId]
      solver.state.regionSegments[regionId]!.push([
        routeId,
        fromPortId,
        toPortId,
      ])
      solver.state.portAssignment[fromPortId] = routeId
      solver.state.portAssignment[toPortId] = routeId
      solver.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    }
  }

  solver.state.currentRouteId = undefined
  solver.state.currentRouteNetId = undefined
  solver.solved = true
  solver.failed = false
  solver.error = null
}

const createSolvedSolverFromRegionSegments = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  routeSegmentsByRegion: Array<[RouteId, PortId, PortId][]>,
  options?: TinyHyperGraphSolverOptions,
) => {
  const solver = new TinyHyperGraphSolver(topology, problem, options)
  applyRouteSegmentsToSolver(solver, routeSegmentsByRegion)
  return solver
}

const createSolvedSolverFromSolution = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
  options?: TinyHyperGraphSolverOptions,
) => {
  const routeSegmentsByRegion = Array.from(
    { length: topology.regionCount },
    () => [] as [RouteId, PortId, PortId][],
  )

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const { orderedPortIds, orderedRegionIds } = getOrderedRoutePath(
      topology,
      problem,
      solution,
      routeId,
    )
    for (let portIndex = 1; portIndex < orderedPortIds.length; portIndex++) {
      const fromPortId = orderedPortIds[portIndex - 1]!
      const toPortId = orderedPortIds[portIndex]!
      const regionId = orderedRegionIds[portIndex - 1]!
      routeSegmentsByRegion[regionId]!.push([routeId, fromPortId, toPortId])
    }
  }

  return createSolvedSolverFromRegionSegments(
    topology,
    problem,
    routeSegmentsByRegion,
    options,
  )
}

const createSectionRoutePlans = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
): {
  sectionProblem: TinyHyperGraphProblem
  routePlans: SectionRoutePlan[]
  activeRouteIds: RouteId[]
} => {
  const routeStartPort = new Int32Array(problem.routeStartPort)
  const routeEndPort = new Int32Array(problem.routeEndPort)
  const routePlans: SectionRoutePlan[] = Array.from(
    { length: problem.routeCount },
    (_, routeId) => ({
      routeId,
      fixedSegments: [],
    }),
  )
  const activeRouteIds: RouteId[] = []

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const routePlan = routePlans[routeId]!
    const { orderedPortIds, orderedRegionIds } = getOrderedRoutePath(
      topology,
      problem,
      solution,
      routeId,
    )
    const maskedRuns: Array<{ startIndex: number; endIndex: number }> = []
    let currentRunStartIndex: number | undefined

    for (let portIndex = 0; portIndex < orderedPortIds.length; portIndex++) {
      const portId = orderedPortIds[portIndex]!
      const isMasked = problem.portSectionMask[portId] === 1

      if (isMasked && currentRunStartIndex === undefined) {
        currentRunStartIndex = portIndex
      } else if (!isMasked && currentRunStartIndex !== undefined) {
        maskedRuns.push({
          startIndex: currentRunStartIndex,
          endIndex: portIndex - 1,
        })
        currentRunStartIndex = undefined
      }
    }

    if (currentRunStartIndex !== undefined) {
      maskedRuns.push({
        startIndex: currentRunStartIndex,
        endIndex: orderedPortIds.length - 1,
      })
    }

    if (maskedRuns.length === 0) {
      for (let portIndex = 1; portIndex < orderedPortIds.length; portIndex++) {
        routePlan.fixedSegments.push({
          regionId: orderedRegionIds[portIndex - 1]!,
          fromPortId: orderedPortIds[portIndex - 1]!,
          toPortId: orderedPortIds[portIndex]!,
        })
      }
      continue
    }

    if (maskedRuns.length > 1) {
      throw new Error(
        `Route ${routeId} enters the section multiple times; only one contiguous section span is currently supported`,
      )
    }

    const maskedRun = maskedRuns[0]!
    const activeStartIndex = Math.max(0, maskedRun.startIndex - 1)
    const activeEndIndex = Math.min(
      orderedPortIds.length - 1,
      maskedRun.endIndex + 1,
    )

    if (activeEndIndex <= activeStartIndex) {
      throw new Error(`Route ${routeId} does not have a valid section span`)
    }

    for (let portIndex = 1; portIndex <= activeStartIndex; portIndex++) {
      routePlan.fixedSegments.push({
        regionId: orderedRegionIds[portIndex - 1]!,
        fromPortId: orderedPortIds[portIndex - 1]!,
        toPortId: orderedPortIds[portIndex]!,
      })
    }

    for (
      let portIndex = activeEndIndex + 1;
      portIndex < orderedPortIds.length;
      portIndex++
    ) {
      routePlan.fixedSegments.push({
        regionId: orderedRegionIds[portIndex - 1]!,
        fromPortId: orderedPortIds[portIndex - 1]!,
        toPortId: orderedPortIds[portIndex]!,
      })
    }

    routePlan.activeStartPortId = orderedPortIds[activeStartIndex]
    routePlan.activeEndPortId = orderedPortIds[activeEndIndex]
    routePlan.forcedStartRegionId = orderedRegionIds[activeStartIndex]
    routeStartPort[routeId] = routePlan.activeStartPortId
    routeEndPort[routeId] = routePlan.activeEndPortId
    activeRouteIds.push(routeId)
  }

  return {
    sectionProblem: {
      routeCount: problem.routeCount,
      portSectionMask: new Int8Array(problem.portSectionMask),
      routeMetadata: problem.routeMetadata,
      routeStartPort,
      routeEndPort,
      routeNet: new Int32Array(problem.routeNet),
      regionNetId: new Int32Array(problem.regionNetId),
    },
    routePlans,
    activeRouteIds,
  }
}

export const getActiveSectionRouteIds = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
) => createSectionRoutePlans(topology, problem, solution).activeRouteIds

const getSectionRegionIds = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
): RegionId[] => {
  const sectionRegionIds = new Set<RegionId>()

  for (let portId = 0; portId < problem.portSectionMask.length; portId++) {
    if (problem.portSectionMask[portId] !== 1) {
      continue
    }

    for (const regionId of topology.incidentPortRegion[portId] ?? []) {
      sectionRegionIds.add(regionId)
    }
  }

  return [...sectionRegionIds]
}

class TinyHyperGraphSectionSearchSolver extends TinyHyperGraphSolver {
  bestSnapshot?: SolvedStateSnapshot
  bestSummary?: RegionCostSummary
  baselineBeatRipCount?: number
  previousBestMaxRegionCost = Number.POSITIVE_INFINITY
  ripsSinceBestMaxRegionCostImprovement = 0

  MAX_RIPS = Number.POSITIVE_INFINITY
  ENABLE_CACHE = true
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT = Number.POSITIVE_INFINITY
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST = Number.POSITIVE_INFINITY

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    public readonly routePlans: SectionRoutePlan[],
    public readonly activeRouteIds: RouteId[],
    private baselineSummary: RegionCostSummary,
    options?: TinyHyperGraphSectionSolverOptions,
  ) {
    super(topology, problem, options)
    applyTinyHyperGraphSectionSolverOptions(this, options)
    this.state.unroutedRoutes = [...activeRouteIds]
    this.applyFixedSegments()
  }

  applyFixedSegments() {
    for (const routePlan of this.routePlans) {
      for (const { regionId, fromPortId, toPortId } of routePlan.fixedSegments) {
        this.state.currentRouteNetId = this.problem.routeNet[routePlan.routeId]
        this.state.regionSegments[regionId]!.push([
          routePlan.routeId,
          fromPortId,
          toPortId,
        ])
        this.state.portAssignment[fromPortId] = routePlan.routeId
        this.state.portAssignment[toPortId] = routePlan.routeId
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }

    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
  }

  captureBestState(summary: RegionCostSummary) {
    if (
      this.bestSummary &&
      compareRegionCostSummaries(summary, this.bestSummary) >= 0
    ) {
      return
    }

    this.bestSummary = summary
    this.bestSnapshot = cloneSolvedStateSnapshot({
      portAssignment: this.state.portAssignment,
      regionSegments: this.state.regionSegments,
      regionIntersectionCaches: this.state.regionIntersectionCaches,
    })
  }

  restoreBestState() {
    if (!this.bestSnapshot) {
      return
    }

    const snapshot = cloneSolvedStateSnapshot(this.bestSnapshot)
    this.state.portAssignment = snapshot.portAssignment
    this.state.regionSegments = snapshot.regionSegments
    this.state.regionIntersectionCaches = snapshot.regionIntersectionCaches
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = []
    this.state.candidateQueue.clear()
    this.state.candidateBestCostByHopId.fill(Number.POSITIVE_INFINITY)
    this.state.goalPortId = -1
  }

  override getStartingNextRegionId(
    routeId: RouteId,
    startingPortId: PortId,
  ): RegionId | undefined {
    const forcedStartRegionId = this.routePlans[routeId]?.forcedStartRegionId
    if (forcedStartRegionId !== undefined) {
      return forcedStartRegionId
    }

    return super.getStartingNextRegionId(routeId, startingPortId)
  }

  override resetRoutingStateForRerip() {
    super.resetRoutingStateForRerip()
    this.state.unroutedRoutes = shuffle(
      [...this.activeRouteIds],
      this.state.ripCount,
    )
    this.applyFixedSegments()
  }

  override onAllRoutesRouted() {
    const { topology, state } = this
    const maxRips = Math.min(this.MAX_RIPS, this.RIP_THRESHOLD_RAMP_ATTEMPTS)
    const ripThresholdProgress =
      maxRips <= 0 ? 1 : Math.min(1, state.ripCount / maxRips)
    const currentRipThreshold =
      this.RIP_THRESHOLD_START +
      (this.RIP_THRESHOLD_END - this.RIP_THRESHOLD_START) * ripThresholdProgress

    const regionIdsOverCostThreshold: RegionId[] = []
    const regionCosts = new Float64Array(topology.regionCount)
    let maxRegionCost = 0
    let totalRegionCost = 0

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const regionCost =
        state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
      regionCosts[regionId] = regionCost
      maxRegionCost = Math.max(maxRegionCost, regionCost)
      totalRegionCost += regionCost

      if (regionCost > currentRipThreshold) {
        regionIdsOverCostThreshold.push(regionId)
      }
    }

    this.captureBestState({
      maxRegionCost,
      totalRegionCost,
    })
    const bestSummary = this.bestSummary ?? {
      maxRegionCost,
      totalRegionCost,
    }

    if (
      bestSummary.maxRegionCost <
      this.previousBestMaxRegionCost - Number.EPSILON
    ) {
      this.previousBestMaxRegionCost = bestSummary.maxRegionCost
      this.ripsSinceBestMaxRegionCostImprovement = 0
    } else {
      this.ripsSinceBestMaxRegionCostImprovement += 1
    }

    if (
      this.baselineBeatRipCount === undefined &&
      bestSummary.maxRegionCost <
        this.baselineSummary.maxRegionCost - Number.EPSILON
    ) {
      this.baselineBeatRipCount = state.ripCount
    }

    this.stats = {
      ...this.stats,
      activeRouteCount: this.activeRouteIds.length,
      currentRipThreshold,
      hotRegionCount: regionIdsOverCostThreshold.length,
      maxRegionCost,
      totalRegionCost,
      bestMaxRegionCost: bestSummary.maxRegionCost,
      bestTotalRegionCost: bestSummary.totalRegionCost,
      ripCount: state.ripCount,
    }

    if (
      regionIdsOverCostThreshold.length === 0 ||
      state.ripCount >= maxRips ||
      this.ripsSinceBestMaxRegionCostImprovement >=
        this.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT ||
      (this.baselineBeatRipCount !== undefined &&
        state.ripCount - this.baselineBeatRipCount >=
          this.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST)
    ) {
      this.restoreBestState()
      this.solved = true
      return
    }

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      state.regionCongestionCost[regionId] +=
        regionCosts[regionId] * this.RIP_CONGESTION_REGION_COST_FACTOR
    }

    state.ripCount += 1
    this.resetRoutingStateForRerip()
    this.stats = {
      ...this.stats,
      ripCount: state.ripCount,
      reripRegionCount: regionIdsOverCostThreshold.length,
    }
  }

  override tryFinalAcceptance() {
    if (!this.bestSnapshot) {
      return
    }

    this.restoreBestState()
    this.solved = true
  }

  override visualize(): GraphicsObject {
    return visualizeTinyGraph(this, {
      highlightSectionMask: true,
      showIdlePortRegionConnectors: false,
      showInitialRouteHints: false,
      showOnlySectionPortsOnIdle: true,
    })
  }
}

export class TinyHyperGraphSectionSolver extends BaseSolver {
  baselineSolver: TinyHyperGraphSolver
  baselineSummary: RegionCostSummary
  sectionBaselineSummary: RegionCostSummary
  sectionRegionIds: RegionId[]
  optimizedSolver?: TinyHyperGraphSolver
  sectionSolver?: TinyHyperGraphSectionSearchSolver
  activeRouteIds: RouteId[] = []
  sectionScoreCacheKey?: string
  sectionCacheContext?: ReturnType<typeof createSectionSolverCacheContext>
  sectionCacheHydrated = false
  preparedSectionProblem?: TinyHyperGraphProblem
  preparedRoutePlans?: SectionRoutePlan[]
  preparedActiveRouteIds?: RouteId[]
  preparedRoutePlanBuildMs = 0
  preparedCacheContextBuildMs = 0

  ENABLE_CACHE = true
  DISTANCE_TO_COST = 0.05

  RIP_THRESHOLD_START = 0.05
  RIP_THRESHOLD_END = 0.8
  RIP_THRESHOLD_RAMP_ATTEMPTS = 50
  MAX_RIPS = Number.POSITIVE_INFINITY
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT = 10
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST = 10

  RIP_CONGESTION_REGION_COST_FACTOR = 0.1

  override MAX_ITERATIONS = 1e6

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    public initialSolution: TinyHyperGraphSolution,
    options?: TinyHyperGraphSectionSolverOptions,
  ) {
    super()
    applyTinyHyperGraphSectionSolverOptions(this, options)
    this.baselineSolver = createSolvedSolverFromSolution(
      topology,
      problem,
      initialSolution,
      getTinyHyperGraphSolverOptions(this),
    )
    this.baselineSummary = summarizeRegionIntersectionCaches(
      this.baselineSolver.state.regionIntersectionCaches,
    )
    this.sectionRegionIds = getSectionRegionIds(topology, problem)
    this.sectionBaselineSummary = summarizeRegionIntersectionCachesForRegionIds(
      this.baselineSolver.state.regionIntersectionCaches,
      this.sectionRegionIds,
    )
    this.applySectionRipPolicy()
  }

  applySectionRipPolicy() {
    this.RIP_THRESHOLD_START = 0.05
    this.RIP_THRESHOLD_END = Math.max(
      this.RIP_THRESHOLD_START,
      this.sectionBaselineSummary.maxRegionCost,
    )
    this.MAX_RIPS = Math.min(this.MAX_RIPS, 20)
  }

  prepareSectionSolveState() {
    this.applySectionRipPolicy()

    if (
      !this.preparedSectionProblem ||
      !this.preparedRoutePlans ||
      !this.preparedActiveRouteIds
    ) {
      const routePlanBuildStartTime = performance.now()
      const { sectionProblem, routePlans, activeRouteIds } =
        createSectionRoutePlans(this.topology, this.problem, this.initialSolution)

      this.preparedSectionProblem = sectionProblem
      this.preparedRoutePlans = routePlans
      this.preparedActiveRouteIds = activeRouteIds
      this.preparedRoutePlanBuildMs =
        performance.now() - routePlanBuildStartTime
    }

    const sectionProblem = this.preparedSectionProblem
    const routePlans = this.preparedRoutePlans
    const activeRouteIds = this.preparedActiveRouteIds

    this.activeRouteIds = activeRouteIds

    if (this.ENABLE_CACHE && activeRouteIds.length > 0) {
      if (!this.sectionScoreCacheKey) {
        const cacheContextBuildStartTime = performance.now()
        this.sectionScoreCacheKey = createSectionSolverLossyScoreCacheKey({
          topology: this.topology,
          problem: sectionProblem,
          sectionRegionIds: this.sectionRegionIds,
          routePlans,
          activeRouteIds,
          baselineRegionCosts:
            this.baselineSolver.state.regionIntersectionCaches.map(
              (regionCache) => regionCache.existingRegionCost,
            ),
          policy: {
            DISTANCE_TO_COST: this.DISTANCE_TO_COST,
            RIP_THRESHOLD_START: this.RIP_THRESHOLD_START,
            RIP_THRESHOLD_END: this.RIP_THRESHOLD_END,
            RIP_THRESHOLD_RAMP_ATTEMPTS: this.RIP_THRESHOLD_RAMP_ATTEMPTS,
            RIP_CONGESTION_REGION_COST_FACTOR:
              this.RIP_CONGESTION_REGION_COST_FACTOR,
            MAX_ITERATIONS: this.MAX_ITERATIONS,
            MAX_RIPS: this.MAX_RIPS,
            MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT:
              this.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT,
            EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST:
              this.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST,
          },
        })
        this.preparedCacheContextBuildMs =
          performance.now() - cacheContextBuildStartTime
        recordSectionSolverCacheTiming({
          contextBuildMs: this.preparedCacheContextBuildMs,
        })

        if (
          this.sectionScoreCacheKey &&
          isSectionSolverLossyScoreKeyObservationEnabled()
        ) {
          const exactScoreKey = createSectionSolverScoreCacheKey({
            topology: this.topology,
            problem: sectionProblem,
            sectionRegionIds: this.sectionRegionIds,
            routePlans,
            activeRouteIds,
            baselineRegionCosts:
              this.baselineSolver.state.regionIntersectionCaches.map(
                (regionCache) => regionCache.existingRegionCost,
              ),
            policy: {
              DISTANCE_TO_COST: this.DISTANCE_TO_COST,
              RIP_THRESHOLD_START: this.RIP_THRESHOLD_START,
              RIP_THRESHOLD_END: this.RIP_THRESHOLD_END,
              RIP_THRESHOLD_RAMP_ATTEMPTS: this.RIP_THRESHOLD_RAMP_ATTEMPTS,
              RIP_CONGESTION_REGION_COST_FACTOR:
                this.RIP_CONGESTION_REGION_COST_FACTOR,
              MAX_ITERATIONS: this.MAX_ITERATIONS,
              MAX_RIPS: this.MAX_RIPS,
              MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT:
                this.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT,
              EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST:
                this.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST,
            },
          })

          if (exactScoreKey) {
            recordSectionSolverLossyScoreKeyObservation(
              this.sectionScoreCacheKey,
              exactScoreKey,
            )
          }
        }
      }
    } else {
      this.sectionScoreCacheKey = undefined
      this.sectionCacheContext = undefined
      this.preparedCacheContextBuildMs = 0
    }

    this.stats = {
      ...this.stats,
      sectionRoutePlanBuildMs: this.preparedRoutePlanBuildMs,
      sectionCacheContextBuildMs: this.preparedCacheContextBuildMs,
    }

    return {
      sectionProblem,
      routePlans,
      activeRouteIds,
      scoreCacheKey: this.sectionScoreCacheKey,
      cacheContext: this.sectionCacheContext,
    }
  }

  override _setup() {
    this.sectionCacheHydrated = false

    const {
      sectionProblem,
      routePlans,
      activeRouteIds,
      scoreCacheKey,
      cacheContext,
    } = this.prepareSectionSolveState()

    if (activeRouteIds.length === 0) {
      this.optimizedSolver = this.baselineSolver
      this.stats = {
        ...this.stats,
        activeRouteCount: 0,
        cacheHit: false,
        cacheStatus: "not-applicable",
        initialMaxRegionCost: this.baselineSummary.maxRegionCost,
        initialTotalRegionCost: this.baselineSummary.totalRegionCost,
        finalMaxRegionCost: this.baselineSummary.maxRegionCost,
        finalTotalRegionCost: this.baselineSummary.totalRegionCost,
        optimized: false,
      }
      this.solved = true
      return
    }

    this.sectionSolver = new TinyHyperGraphSectionSearchSolver(
      this.topology,
      sectionProblem,
      routePlans,
      activeRouteIds,
      this.baselineSummary,
      getTinyHyperGraphSectionSolverOptions(this),
    )
    this.activeSubSolver = this.sectionSolver

    let cacheStatus = "miss"
    let cacheHit = false

    if (this.ENABLE_CACHE && !cacheContext && scoreCacheKey) {
      const cacheContextBuildStartTime = performance.now()
      this.sectionCacheContext = createSectionSolverCacheContext({
        topology: this.topology,
        problem: sectionProblem,
        sectionRegionIds: this.sectionRegionIds,
        routePlans,
        activeRouteIds,
        baselineRegionCosts:
          this.baselineSolver.state.regionIntersectionCaches.map(
            (regionCache) => regionCache.existingRegionCost,
          ),
        policy: {
          DISTANCE_TO_COST: this.DISTANCE_TO_COST,
          RIP_THRESHOLD_START: this.RIP_THRESHOLD_START,
          RIP_THRESHOLD_END: this.RIP_THRESHOLD_END,
          RIP_THRESHOLD_RAMP_ATTEMPTS: this.RIP_THRESHOLD_RAMP_ATTEMPTS,
          RIP_CONGESTION_REGION_COST_FACTOR:
            this.RIP_CONGESTION_REGION_COST_FACTOR,
          MAX_ITERATIONS: this.MAX_ITERATIONS,
          MAX_RIPS: this.MAX_RIPS,
          MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT:
            this.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT,
          EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST:
            this.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST,
        },
      })
      const fullCacheContextBuildMs =
        performance.now() - cacheContextBuildStartTime
      recordSectionSolverCacheTiming({
        contextBuildMs: fullCacheContextBuildMs,
      })
      this.stats = {
        ...this.stats,
        fullCacheContextBuildMs,
      }
    }

    const effectiveCacheContext = this.sectionCacheContext

    if (effectiveCacheContext) {
      const cachedEntry = getSectionSolverCacheEntry(effectiveCacheContext.key)

      if (!cachedEntry) {
        recordSectionSolverCacheLookup("miss")
      } else {
        try {
          if (!cachedEntry.optimized) {
            recordSectionSolverCacheLookup("hit")
            this.optimizedSolver = this.baselineSolver
            this.sectionCacheHydrated = true
            this.activeSubSolver = undefined
            this.stats = {
              ...this.stats,
              sectionBaselineMaxRegionCost:
                this.sectionBaselineSummary.maxRegionCost,
              sectionBaselineTotalRegionCost:
                this.sectionBaselineSummary.totalRegionCost,
              effectiveRipThresholdStart: this.RIP_THRESHOLD_START,
              effectiveRipThresholdEnd: this.RIP_THRESHOLD_END,
              effectiveMaxRips: this.MAX_RIPS,
              activeRouteCount: this.activeRouteIds.length,
              initialMaxRegionCost: this.baselineSummary.maxRegionCost,
              initialTotalRegionCost: this.baselineSummary.totalRegionCost,
              finalMaxRegionCost: this.baselineSummary.maxRegionCost,
              finalTotalRegionCost: this.baselineSummary.totalRegionCost,
              optimized: false,
              cacheHit: true,
              cacheStatus: "hit",
              cacheScaleBucket: effectiveCacheContext.transform.scaleBucket,
              cacheRotationQuarterTurns:
                effectiveCacheContext.transform.rotationQuarterTurns,
              cacheEntries: getTinyHyperGraphSectionSolverCacheStats().entries,
            }
            this.solved = true
            return
          }

          const cacheHydrationStartTime = performance.now()
          const hydratedSolution = hydrateSectionSolverCacheEntrySolution(
            cachedEntry,
            effectiveCacheContext,
            this.initialSolution,
          )
          const cacheHydrationMs = performance.now() - cacheHydrationStartTime
          const hydratedSolverBuildStartTime = performance.now()
          const hydratedSolver = createSolvedSolverFromSolution(
            this.topology,
            this.problem,
            hydratedSolution,
            getTinyHyperGraphSolverOptions(this),
          )
          const hydratedSummary = summarizeRegionIntersectionCaches(
            hydratedSolver.state.regionIntersectionCaches,
          )
          const cacheHydratedSolverBuildMs =
            performance.now() - hydratedSolverBuildStartTime
          const hydratedOptimized =
            compareRegionCostSummaries(hydratedSummary, this.baselineSummary) < 0

          recordSectionSolverCacheTiming({
            hydrateSolutionMs: cacheHydrationMs,
            hydratedSolverBuildMs: cacheHydratedSolverBuildMs,
          })
          recordSectionSolverCacheLookup("hit")
          this.optimizedSolver = hydratedSolver
          this.sectionCacheHydrated = true
          this.activeSubSolver = undefined
          this.stats = {
            ...this.stats,
            sectionBaselineMaxRegionCost:
              this.sectionBaselineSummary.maxRegionCost,
            sectionBaselineTotalRegionCost:
              this.sectionBaselineSummary.totalRegionCost,
            effectiveRipThresholdStart: this.RIP_THRESHOLD_START,
            effectiveRipThresholdEnd: this.RIP_THRESHOLD_END,
            effectiveMaxRips: this.MAX_RIPS,
            activeRouteCount: this.activeRouteIds.length,
            initialMaxRegionCost: this.baselineSummary.maxRegionCost,
            initialTotalRegionCost: this.baselineSummary.totalRegionCost,
            finalMaxRegionCost: hydratedSummary.maxRegionCost,
            finalTotalRegionCost: hydratedSummary.totalRegionCost,
            optimized: hydratedOptimized,
            cacheHit: true,
            cacheStatus: "hit",
            cacheScaleBucket: effectiveCacheContext.transform.scaleBucket,
            cacheRotationQuarterTurns:
              effectiveCacheContext.transform.rotationQuarterTurns,
            cacheEntries: getTinyHyperGraphSectionSolverCacheStats().entries,
            cacheHydrationMs,
            cacheHydratedSolverBuildMs,
          }
          this.solved = true
          return
        } catch {
          recordSectionSolverCacheLookup("rejected")
          cacheStatus = "rejected"
        }
      }

      if (cacheStatus !== "rejected") {
        cacheStatus = "miss"
      }
      cacheHit = false
    } else if (this.ENABLE_CACHE) {
      cacheStatus = "disabled"
    } else {
      cacheStatus = "disabled"
    }

    this.stats = {
      ...this.stats,
      sectionBaselineMaxRegionCost: this.sectionBaselineSummary.maxRegionCost,
      sectionBaselineTotalRegionCost: this.sectionBaselineSummary.totalRegionCost,
      effectiveRipThresholdStart: this.RIP_THRESHOLD_START,
      effectiveRipThresholdEnd: this.RIP_THRESHOLD_END,
      effectiveMaxRips: this.MAX_RIPS,
      cacheHit,
      cacheStatus,
      cacheScaleBucket: effectiveCacheContext?.transform.scaleBucket ?? null,
      cacheRotationQuarterTurns:
        effectiveCacheContext?.transform.rotationQuarterTurns ?? null,
      cacheEntries: getTinyHyperGraphSectionSolverCacheStats().entries,
    }
  }

  override _step() {
    if (!this.sectionSolver) {
      this.solved = true
      return
    }

    this.sectionSolver.step()
    this.stats = {
      ...this.stats,
      ...this.sectionSolver.stats,
      activeRouteCount: this.activeRouteIds.length,
    }

    if (this.sectionSolver.failed) {
      this.error = this.sectionSolver.error
      this.failed = true
      return
    }

    if (!this.sectionSolver.solved) {
      return
    }

    const candidateSolver = createSolvedSolverFromRegionSegments(
      this.topology,
      this.problem,
      cloneRegionSegments(this.sectionSolver.state.regionSegments),
      getTinyHyperGraphSolverOptions(this),
    )
    const candidateSummary = summarizeRegionIntersectionCaches(
      candidateSolver.state.regionIntersectionCaches,
    )
    let optimized =
      compareRegionCostSummaries(candidateSummary, this.baselineSummary) < 0
    let selectedSolver: TinyHyperGraphSolver = optimized
      ? candidateSolver
      : this.baselineSolver
    let finalSummary = optimized ? candidateSummary : this.baselineSummary
    let validatedReplayTopology: TinyHyperGraphTopology | undefined
    let validatedReplaySolution: TinyHyperGraphSolution | undefined

    if (this.ENABLE_CACHE && optimized) {
      const storeValidationStartTime = performance.now()
      const validatedOutput = candidateSolver.getOutput()
      const replay = loadSerializedHyperGraph(validatedOutput)
      const replayedSolver = createSolvedSolverFromSolution(
        replay.topology,
        replay.problem,
        replay.solution,
        getTinyHyperGraphSolverOptions(this),
      )
      const replayedSummary = summarizeRegionIntersectionCaches(
        replayedSolver.state.regionIntersectionCaches,
      )

      selectedSolver = replayedSolver
      finalSummary = replayedSummary
      validatedReplayTopology = replay.topology
      validatedReplaySolution = replay.solution
      const cacheStoreValidationMs =
        performance.now() - storeValidationStartTime
      recordSectionSolverCacheTiming({
        storeValidationMs: cacheStoreValidationMs,
      })
      this.stats = {
        ...this.stats,
        cacheStoreValidationMs,
      }
      optimized =
        compareRegionCostSummaries(replayedSummary, this.baselineSummary) < 0

      if (!optimized) {
        selectedSolver = this.baselineSolver
        finalSummary = this.baselineSummary
        validatedReplayTopology = undefined
        validatedReplaySolution = undefined
      }
    }

    this.optimizedSolver = selectedSolver

    if (this.ENABLE_CACHE && this.sectionScoreCacheKey && !this.sectionCacheHydrated) {
      setSectionSolverScoreCacheEntry({
        lossyKey: this.sectionScoreCacheKey,
        entry: {
          optimized,
          finalSummary,
        },
      })
    }

    if (this.ENABLE_CACHE && this.sectionCacheContext && !this.sectionCacheHydrated) {
      const storeEntryBuildStartTime = performance.now()
      setSectionSolverCacheEntry(
        this.sectionCacheContext.key,
        createSectionSolverCacheEntry({
          context: this.sectionCacheContext,
          currentTopology: this.topology,
          replayTopology: validatedReplayTopology ?? this.topology,
          finalSolution: validatedReplaySolution ?? this.initialSolution,
          optimized,
          finalSummary,
        }),
      )
      const cacheStoreEntryBuildMs =
        performance.now() - storeEntryBuildStartTime
      recordSectionSolverCacheTiming({
        storeEntryBuildMs: cacheStoreEntryBuildMs,
      })
      this.stats = {
        ...this.stats,
        cacheStoreEntryBuildMs,
      }
    }

    this.stats = {
      ...this.stats,
      initialMaxRegionCost: this.baselineSummary.maxRegionCost,
      initialTotalRegionCost: this.baselineSummary.totalRegionCost,
      candidateMaxRegionCost: candidateSummary.maxRegionCost,
      candidateTotalRegionCost: candidateSummary.totalRegionCost,
      finalMaxRegionCost: finalSummary.maxRegionCost,
      finalTotalRegionCost: finalSummary.totalRegionCost,
      optimized,
      cacheEntries: getTinyHyperGraphSectionSolverCacheStats().entries,
    }
    this.solved = true
  }

  getSolvedSolver(): TinyHyperGraphSolver {
    if (!this.solved || this.failed || !this.optimizedSolver) {
      throw new Error(
        "TinyHyperGraphSectionSolver does not have a solved output yet",
      )
    }

    return this.optimizedSolver
  }

  override visualize(): GraphicsObject {
    if (this.optimizedSolver) {
      return visualizeTinyGraph(this.optimizedSolver, {
        highlightSectionMask: true,
      })
    }

    if (this.sectionSolver) {
      return this.sectionSolver.visualize()
    }

    return visualizeTinyGraph(this.baselineSolver, {
      highlightSectionMask: true,
      showIdlePortRegionConnectors: false,
      showInitialRouteHints: false,
      showOnlySectionPortsOnIdle: true,
    })
  }

  override getOutput() {
    return this.getSolvedSolver().getOutput()
  }
}
