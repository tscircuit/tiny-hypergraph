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
import { shuffle } from "../shuffle"
import type {
  PortId,
  RegionId,
  RegionIntersectionCache,
  RouteId,
} from "../types"
import { visualizeTinyGraph } from "../visualizeTinyGraph"

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
  MAX_RIPS?: number
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT?: number
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST?: number
  /**
   * Pipeline convenience option for automatic section-mask search.
   * When `sectionSearchConfig.maxHotRegions` is omitted, the section pipeline
   * falls back to this value before using its built-in default.
   */
  MAX_HOT_REGIONS?: number
}

const applyTinyHyperGraphSectionSolverOptions = (
  solver: TinyHyperGraphSectionSearchSolver | TinyHyperGraphSectionSolver,
  options?: TinyHyperGraphSectionSolverOptions,
) => {
  applyTinyHyperGraphSolverOptions(solver, options)

  if (!options) {
    return
  }

  if (options.MAX_RIPS !== undefined) {
    solver.MAX_RIPS = options.MAX_RIPS
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

const restoreSolvedStateSnapshot = (
  solver: TinyHyperGraphSolver,
  snapshot: SolvedStateSnapshot,
) => {
  const clonedSnapshot = cloneSolvedStateSnapshot(snapshot)
  solver.state.portAssignment = clonedSnapshot.portAssignment
  solver.state.regionSegments = clonedSnapshot.regionSegments
  solver.state.regionIntersectionCaches =
    clonedSnapshot.regionIntersectionCaches
}

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

const summarizeRegionIntersectionCachesExcludingRegionIds = (
  regionIntersectionCaches: ArrayLike<RegionIntersectionCache>,
  excludedRegionIds: RegionId[],
): RegionCostSummary => {
  const excludedRegionIdSet = new Set(excludedRegionIds)
  let maxRegionCost = 0
  let totalRegionCost = 0

  for (
    let regionId = 0;
    regionId < regionIntersectionCaches.length;
    regionId++
  ) {
    if (excludedRegionIdSet.has(regionId)) {
      continue
    }

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
  const routeSegmentRegionIds =
    solution.solvedRoutePathRegionIds?.[routeId] ?? []
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
  solver.resetCandidateBestCosts()
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
      solver.state.portAssignment[fromPortId] = solver.state.currentRouteNetId
      solver.state.portAssignment[toPortId] = solver.state.currentRouteNetId
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
  fixedSnapshot?: SolvedStateSnapshot
  bestSummary?: RegionCostSummary
  baselineBeatRipCount?: number
  previousBestMaxRegionCost = Number.POSITIVE_INFINITY
  ripsSinceBestMaxRegionCostImprovement = 0

  MAX_RIPS = Number.POSITIVE_INFINITY
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT = Number.POSITIVE_INFINITY
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST = Number.POSITIVE_INFINITY

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    private routePlans: SectionRoutePlan[],
    private activeRouteIds: RouteId[],
    private mutableRegionIds: RegionId[],
    private immutableRegionSummary: RegionCostSummary,
    private baselineSummary: RegionCostSummary,
    options?: TinyHyperGraphSectionSolverOptions,
  ) {
    super(topology, problem, options)
    applyTinyHyperGraphSectionSolverOptions(this, options)
    this.state.unroutedRoutes = [...activeRouteIds]
    this.applyFixedSegments()
    this.fixedSnapshot = cloneSolvedStateSnapshot({
      portAssignment: this.state.portAssignment,
      regionSegments: this.state.regionSegments,
      regionIntersectionCaches: this.state.regionIntersectionCaches,
    })
  }

  applyFixedSegments() {
    for (const routePlan of this.routePlans) {
      for (const {
        regionId,
        fromPortId,
        toPortId,
      } of routePlan.fixedSegments) {
        this.state.currentRouteNetId = this.problem.routeNet[routePlan.routeId]
        this.state.regionSegments[regionId]!.push([
          routePlan.routeId,
          fromPortId,
          toPortId,
        ])
        this.state.portAssignment[fromPortId] = this.state.currentRouteNetId
        this.state.portAssignment[toPortId] = this.state.currentRouteNetId
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

    restoreSolvedStateSnapshot(this, this.bestSnapshot)
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = []
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
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
    if (!this.fixedSnapshot) {
      super.resetRoutingStateForRerip()
      this.state.unroutedRoutes = shuffle(
        [...this.activeRouteIds],
        this.state.ripCount,
      )
      this.applyFixedSegments()
      return
    }

    restoreSolvedStateSnapshot(this, this.fixedSnapshot)
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = shuffle(
      [...this.activeRouteIds],
      this.state.ripCount,
    )
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1
  }

  override onAllRoutesRouted() {
    const { state } = this
    const maxRips = Math.min(this.MAX_RIPS, this.RIP_THRESHOLD_RAMP_ATTEMPTS)
    const ripThresholdProgress =
      maxRips <= 0 ? 1 : Math.min(1, state.ripCount / maxRips)
    const currentRipThreshold =
      this.RIP_THRESHOLD_START +
      (this.RIP_THRESHOLD_END - this.RIP_THRESHOLD_START) * ripThresholdProgress

    const regionIdsOverCostThreshold: RegionId[] = []
    const mutableRegionCosts = new Float64Array(this.mutableRegionIds.length)
    let mutableMaxRegionCost = 0
    let mutableTotalRegionCost = 0

    for (
      let mutableRegionIndex = 0;
      mutableRegionIndex < this.mutableRegionIds.length;
      mutableRegionIndex++
    ) {
      const regionId = this.mutableRegionIds[mutableRegionIndex]!
      const regionCost =
        state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
      mutableRegionCosts[mutableRegionIndex] = regionCost
      mutableMaxRegionCost = Math.max(mutableMaxRegionCost, regionCost)
      mutableTotalRegionCost += regionCost

      if (regionCost > currentRipThreshold) {
        regionIdsOverCostThreshold.push(regionId)
      }
    }

    const maxRegionCost = Math.max(
      this.immutableRegionSummary.maxRegionCost,
      mutableMaxRegionCost,
    )
    const totalRegionCost =
      this.immutableRegionSummary.totalRegionCost + mutableTotalRegionCost

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

    for (
      let mutableRegionIndex = 0;
      mutableRegionIndex < this.mutableRegionIds.length;
      mutableRegionIndex++
    ) {
      const regionId = this.mutableRegionIds[mutableRegionIndex]!
      state.regionCongestionCost[regionId] +=
        mutableRegionCosts[mutableRegionIndex]! *
        this.RIP_CONGESTION_REGION_COST_FACTOR
    }

    state.ripCount += 1
    this.resetRoutingStateForRerip()
    this.stats = {
      ...this.stats,
      ripCount: state.ripCount,
      reripRegionCount: regionIdsOverCostThreshold.length,
    }
  }

  override onOutOfCandidates() {
    const { state } = this

    for (const regionId of this.mutableRegionIds) {
      const regionCost =
        state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
      state.regionCongestionCost[regionId] +=
        regionCost * this.RIP_CONGESTION_REGION_COST_FACTOR
    }

    state.ripCount += 1
    this.resetRoutingStateForRerip()
    this.stats = {
      ...this.stats,
      ripCount: state.ripCount,
      reripReason: "out_of_candidates",
    }
  }

  override tryFinalAcceptance() {
    if (!this.bestSnapshot) {
      super.tryFinalAcceptance()
      return
    }

    this.restoreBestState()
    this.solved = true
  }

  override visualize(): GraphicsObject {
    return visualizeTinyGraph(this, {
      highlightSectionMask: true,
      showInitialRouteHints: false,
      showOnlySectionPortsOnIdle: true,
    })
  }
}

export class TinyHyperGraphSectionSolver extends BaseSolver {
  baselineSolver: TinyHyperGraphSolver
  baselineSummary: RegionCostSummary
  sectionBaselineSummary: RegionCostSummary
  outsideSectionBaselineSummary: RegionCostSummary
  sectionRegionIds: RegionId[]
  optimizedSolver?: TinyHyperGraphSolver
  sectionSolver?: TinyHyperGraphSectionSearchSolver
  activeRouteIds: RouteId[] = []

  DISTANCE_TO_COST = 0.05
  VERBOSE = false

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
    this.outsideSectionBaselineSummary =
      summarizeRegionIntersectionCachesExcludingRegionIds(
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

  override _setup() {
    this.applySectionRipPolicy()

    const { sectionProblem, routePlans, activeRouteIds } =
      createSectionRoutePlans(this.topology, this.problem, this.initialSolution)

    this.activeRouteIds = activeRouteIds

    if (activeRouteIds.length === 0) {
      this.optimizedSolver = this.baselineSolver
      this.stats = {
        ...this.stats,
        activeRouteCount: 0,
        initialMaxRegionCost: this.baselineSummary.maxRegionCost,
        finalMaxRegionCost: this.baselineSummary.maxRegionCost,
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
      this.sectionRegionIds,
      this.outsideSectionBaselineSummary,
      this.baselineSummary,
      getTinyHyperGraphSectionSolverOptions(this),
    )
    this.activeSubSolver = this.sectionSolver
    this.stats = {
      ...this.stats,
      sectionBaselineMaxRegionCost: this.sectionBaselineSummary.maxRegionCost,
      sectionBaselineTotalRegionCost:
        this.sectionBaselineSummary.totalRegionCost,
      effectiveRipThresholdStart: this.RIP_THRESHOLD_START,
      effectiveRipThresholdEnd: this.RIP_THRESHOLD_END,
      effectiveMaxRips: this.MAX_RIPS,
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
    const optimized =
      compareRegionCostSummaries(candidateSummary, this.baselineSummary) < 0

    this.optimizedSolver = optimized ? candidateSolver : this.baselineSolver

    const finalSummary = optimized ? candidateSummary : this.baselineSummary
    this.stats = {
      ...this.stats,
      initialMaxRegionCost: this.baselineSummary.maxRegionCost,
      initialTotalRegionCost: this.baselineSummary.totalRegionCost,
      candidateMaxRegionCost: candidateSummary.maxRegionCost,
      candidateTotalRegionCost: candidateSummary.totalRegionCost,
      finalMaxRegionCost: finalSummary.maxRegionCost,
      finalTotalRegionCost: finalSummary.totalRegionCost,
      optimized,
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
      showInitialRouteHints: false,
      showOnlySectionPortsOnIdle: true,
    })
  }

  override getOutput() {
    return this.getSolvedSolver().getOutput()
  }
}
