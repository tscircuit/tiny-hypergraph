import type { GraphicsObject } from "graphics-debug"
import { MinHeap } from "../MinHeap"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "../core"
import type { NetId, PortId, RegionId, RouteId } from "../types"
import { visualizeTinyGraph } from "../visualizeTinyGraph"
import { BusTraceInferencePlanner } from "./BusTraceInferencePlanner"
import { deriveBusTraceOrder, type BusTraceOrder } from "./deriveBusTraceOrder"
import { BusBoundaryPlanner } from "./BusBoundaryPlanner"
import {
  computeCenterGoalHopDistance,
  computeRegionDistanceToGoal,
} from "./busGoalSearch"
import {
  centerCandidatePathContainsHop,
  centerCandidatePathContainsRegion,
  ensurePortOwnership,
  getCandidateBoundaryNormal,
  getCenterCandidatePath,
  getCenterCandidatePathKey,
  getTracePreviewLength,
  isPortIncidentToRegion,
} from "./busPathHelpers"
import {
  BUS_CANDIDATE_EPSILON,
  compareBusCandidatesByF,
  computeMedianTracePitch,
  type BoundaryStep,
  type BusCenterCandidate,
  type BusPreview,
  type PreviewRoutingStateSnapshot,
  type TinyHyperGraphBusSolverOptions,
  type TracePreview,
  type TraceSegment,
} from "./busSolverTypes"
import { getPortDistance, getPortProjection } from "./geometry"
import {
  clearPreviewRoutingState as clearPreviewRoutingStateValue,
  getPreviewIntersectionCounts as getPreviewIntersectionCountsValue,
  getPreviewRegionCost as getPreviewRegionCostValue,
  restorePreviewRoutingState as restorePreviewRoutingStateValue,
  snapshotPreviewRoutingState as snapshotPreviewRoutingStateValue,
} from "./previewRoutingState"

export class TinyHyperGraphBusSolver extends TinyHyperGraphSolver {
  BUS_END_MARGIN_STEPS = 3
  BUS_MAX_REMAINDER_STEPS = 8
  BUS_REMAINDER_GUIDE_WEIGHT = 1
  BUS_REMAINDER_GOAL_WEIGHT = 0.35
  BUS_REMAINDER_SIDE_WEIGHT = 0.2
  COMPLETE_TRACE_OPTION_BRANCH_LIMIT = 4
  CENTER_PORT_OPTIONS_PER_EDGE = 6
  BUS_TRACE_LENGTH_MARGIN = 1
  BUS_MAX_TRACE_STEPS = 256
  MANUAL_CENTER_FINISH_MAX_HOPS = 2
  MANUAL_CENTER_FINISH_PORT_OPTIONS_PER_BOUNDARY = 6
  MANUAL_CENTER_FINISH_CANDIDATE_LIMIT = 24
  TRACE_ALONGSIDE_SEARCH_BRANCH_LIMIT = 6
  TRACE_ALONGSIDE_SEARCH_BEAM_WIDTH = 24
  TRACE_ALONGSIDE_SEARCH_OPTION_LIMIT = 8
  TRACE_ALONGSIDE_LANE_WEIGHT = 1
  TRACE_ALONGSIDE_REGRESSION_WEIGHT = 2
  BUS_INTERSECTION_PREVIEW_PENALTY = 20
  PARTIAL_INTERSECTION_EXPANSION_THRESHOLD = 2

  readonly busTraceOrder: BusTraceOrder
  readonly centerTraceIndex: number
  readonly centerRouteId: RouteId
  readonly centerRouteNetId: NetId
  readonly centerGoalTransitRegionId: RegionId
  readonly centerGoalHopDistanceByRegion: Int32Array
  readonly otherTraceIndices: number[]
  readonly commitTraceIndices: number[]
  readonly tracePitch: number
  readonly regionDistanceToGoalByRegion: Float64Array

  private readonly boundaryPlanner: BusBoundaryPlanner
  private readonly traceInferencePlanner: BusTraceInferencePlanner
  private readonly centerlineNeighborRegionIdsByRegion: RegionId[][]
  private readonly regionIndexBySerializedId = new Map<string, RegionId>()
  private lastExpandedCandidate?: BusCenterCandidate
  private lastPreview?: BusPreview
  private bestCompleteFallbackPreview?: BusPreview
  private bestCompleteFallbackSnapshot?: PreviewRoutingStateSnapshot
  private bestCompleteFallbackIntersectionCount = Number.POSITIVE_INFINITY
  private bestCompleteFallbackCost = Number.POSITIVE_INFINITY

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphBusSolverOptions,
  ) {
    super(topology, problem, options)

    this.busTraceOrder = deriveBusTraceOrder(topology, problem)
    this.centerTraceIndex = this.busTraceOrder.centerTraceIndex
    this.centerRouteId = this.busTraceOrder.centerTraceRouteId
    this.centerRouteNetId = this.problem.routeNet[this.centerRouteId]!
    this.otherTraceIndices = this.busTraceOrder.traces
      .map((_, traceIndex) => traceIndex)
      .filter((traceIndex) => traceIndex !== this.centerTraceIndex)
    this.commitTraceIndices = [
      this.centerTraceIndex,
      ...this.otherTraceIndices.sort((leftTraceIndex, rightTraceIndex) => {
        const leftTrace = this.busTraceOrder.traces[leftTraceIndex]!
        const rightTrace = this.busTraceOrder.traces[rightTraceIndex]!
        return (
          leftTrace.distanceFromCenter - rightTrace.distanceFromCenter ||
          leftTrace.signedIndexFromCenter - rightTrace.signedIndexFromCenter
        )
      }),
    ]
    this.tracePitch = computeMedianTracePitch(this.busTraceOrder)
    for (let regionId = 0; regionId < this.topology.regionCount; regionId++) {
      const serializedRegionId =
        this.topology.regionMetadata?.[regionId]?.serializedRegionId
      if (typeof serializedRegionId === "string") {
        this.regionIndexBySerializedId.set(serializedRegionId, regionId)
      }
    }
    this.centerGoalTransitRegionId = this.resolveCenterGoalTransitRegionId()

    if (options?.BUS_END_MARGIN_STEPS !== undefined) {
      this.BUS_END_MARGIN_STEPS = options.BUS_END_MARGIN_STEPS
    }
    if (options?.BUS_MAX_REMAINDER_STEPS !== undefined) {
      this.BUS_MAX_REMAINDER_STEPS = options.BUS_MAX_REMAINDER_STEPS
    }
    if (options?.BUS_REMAINDER_GUIDE_WEIGHT !== undefined) {
      this.BUS_REMAINDER_GUIDE_WEIGHT = options.BUS_REMAINDER_GUIDE_WEIGHT
    }
    if (options?.BUS_REMAINDER_GOAL_WEIGHT !== undefined) {
      this.BUS_REMAINDER_GOAL_WEIGHT = options.BUS_REMAINDER_GOAL_WEIGHT
    }
    if (options?.BUS_REMAINDER_SIDE_WEIGHT !== undefined) {
      this.BUS_REMAINDER_SIDE_WEIGHT = options.BUS_REMAINDER_SIDE_WEIGHT
    }

    this.traceInferencePlanner = new BusTraceInferencePlanner({
      topology: this.topology,
      problem: this.problem,
      busTraceOrder: this.busTraceOrder,
      centerTraceIndex: this.centerTraceIndex,
      tracePitch: this.tracePitch,
      DISTANCE_TO_COST: this.DISTANCE_TO_COST,
      BUS_MAX_REMAINDER_STEPS: this.BUS_MAX_REMAINDER_STEPS,
      BUS_REMAINDER_GUIDE_WEIGHT: this.BUS_REMAINDER_GUIDE_WEIGHT,
      BUS_REMAINDER_GOAL_WEIGHT: this.BUS_REMAINDER_GOAL_WEIGHT,
      BUS_REMAINDER_SIDE_WEIGHT: this.BUS_REMAINDER_SIDE_WEIGHT,
      TRACE_ALONGSIDE_SEARCH_BRANCH_LIMIT:
        this.TRACE_ALONGSIDE_SEARCH_BRANCH_LIMIT,
      TRACE_ALONGSIDE_SEARCH_BEAM_WIDTH: this.TRACE_ALONGSIDE_SEARCH_BEAM_WIDTH,
      TRACE_ALONGSIDE_SEARCH_OPTION_LIMIT:
        this.TRACE_ALONGSIDE_SEARCH_OPTION_LIMIT,
      TRACE_ALONGSIDE_LANE_WEIGHT: this.TRACE_ALONGSIDE_LANE_WEIGHT,
      TRACE_ALONGSIDE_REGRESSION_WEIGHT: this.TRACE_ALONGSIDE_REGRESSION_WEIGHT,
      buildPrefixTracePreview: (...args) =>
        this.buildPrefixTracePreview(...args),
      getStartingNextRegionId: (...args) =>
        this.getStartingNextRegionId(...args),
      isRegionReservedForDifferentBusNet: (...args) =>
        this.isRegionReservedForDifferentBusNet(...args),
      getTraceSidePenalty: (...args) => this.getTraceSidePenalty(...args),
      getTraceLanePenalty: (...args) => this.getTraceLanePenalty(...args),
      getRouteHeuristic: (...args) => this.getRouteHeuristic(...args),
    })

    this.boundaryPlanner = new BusBoundaryPlanner({
      topology: this.topology,
      problem: this.problem,
      busTraceOrder: this.busTraceOrder,
      centerTraceIndex: this.centerTraceIndex,
      CENTER_PORT_OPTIONS_PER_EDGE: this.CENTER_PORT_OPTIONS_PER_EDGE,
      isUsableCenterlineBoundaryPort: (portId) =>
        this.isUsableCenterlineBoundaryPort(portId),
    })
    this.centerlineNeighborRegionIdsByRegion =
      this.boundaryPlanner.centerlineNeighborRegionIdsByRegion
    this.regionDistanceToGoalByRegion = computeRegionDistanceToGoal(
      this.topology,
      this.centerGoalTransitRegionId,
      this.centerlineNeighborRegionIdsByRegion,
    )
    this.centerGoalHopDistanceByRegion = computeCenterGoalHopDistance(
      this.topology.regionCount,
      this.centerGoalTransitRegionId,
      this.centerlineNeighborRegionIdsByRegion,
    )
    this.updateBusStats()
  }

  override _setup() {
    void this.problemSetup
    this.state.currentRouteId = this.centerRouteId
    this.state.currentRouteNetId = this.centerRouteNetId
    this.state.goalPortId = this.problem.routeEndPort[this.centerRouteId]!
    this.state.unroutedRoutes = this.otherTraceIndices.map(
      (traceIndex) => this.busTraceOrder.traces[traceIndex]!.routeId,
    )
    this.lastExpandedCandidate = undefined
    this.lastPreview = undefined
    this.bestCompleteFallbackPreview = undefined
    this.bestCompleteFallbackSnapshot = undefined
    this.bestCompleteFallbackIntersectionCount = Number.POSITIVE_INFINITY
    this.bestCompleteFallbackCost = Number.POSITIVE_INFINITY
    clearPreviewRoutingStateValue(this.state, this.topology.regionCount)
    this.resetCandidateBestCosts()
    this.state.candidateQueue = new MinHeap([], compareBusCandidatesByF)

    const startPortId = this.problem.routeStartPort[this.centerRouteId]!
    const startNextRegionId = this.getStartingNextRegionId(
      this.centerRouteId,
      startPortId,
    )

    if (startNextRegionId === undefined) {
      this.failed = true
      this.error = `Centerline start port ${startPortId} has no incident regions`
      this.updateBusStats()
      return
    }

    const startHeuristic =
      this.computeCenterHeuristic(startPortId, startNextRegionId) *
      this.problem.routeCount
    this.setCandidateBestCost(this.getHopId(startPortId, startNextRegionId), 0)
    this.state.candidateQueue.queue({
      portId: startPortId,
      nextRegionId: startNextRegionId,
      g: 0,
      h: startHeuristic,
      f: startHeuristic,
    })
    this.updateBusStats()
  }

  override _step() {
    if (this.failed || this.solved) {
      return
    }

    const currentCandidate = this.state.candidateQueue.dequeue() as
      | BusCenterCandidate
      | undefined
    if (!currentCandidate) {
      if (this.tryAcceptBestCompleteFallbackPreview()) {
        return
      }

      this.failed = true
      this.error =
        "Centerline candidates are exhausted without a non-intersecting bus solution"
      this.updateBusStats()
      return
    }

    const currentCandidateHopId = this.getHopId(
      currentCandidate.portId,
      currentCandidate.nextRegionId,
    )
    if (currentCandidate.g > this.getCandidateBestCost(currentCandidateHopId)) {
      this.updateBusStats()
      return
    }

    this.lastExpandedCandidate = currentCandidate
    const preview = this.evaluateCandidate(currentCandidate)
    this.lastPreview = preview

    if (!preview) {
      this.updateBusStats("preview_failed")
      return
    }

    currentCandidate.busCost = preview.totalCost
    const hasIntersections =
      preview.sameLayerIntersectionCount > 0 ||
      preview.crossingLayerIntersectionCount > 0
    const totalIntersectionCount =
      preview.sameLayerIntersectionCount +
      preview.crossingLayerIntersectionCount
    const hasInferenceFailure =
      preview.reason !== undefined && !hasIntersections
    const allowIntersectingPartialExpansion =
      !currentCandidate.atGoal &&
      totalIntersectionCount <= this.PARTIAL_INTERSECTION_EXPANSION_THRESHOLD

    if (
      currentCandidate.atGoal &&
      preview.completeTraceCount === this.problem.routeCount &&
      totalIntersectionCount > 0
    ) {
      this.maybeStoreBestCompleteFallbackPreview(
        preview,
        totalIntersectionCount,
      )
    }

    if (
      currentCandidate.atGoal &&
      !hasIntersections &&
      preview.completeTraceCount === this.problem.routeCount
    ) {
      this.solved = true
      this.state.unroutedRoutes = []
      this.updateBusStats()
      return
    }

    if (
      (!hasIntersections || allowIntersectingPartialExpansion) &&
      !hasInferenceFailure &&
      !currentCandidate.atGoal
    ) {
      for (const nextCandidate of this.getAvailableCenterMoves(
        currentCandidate,
      )) {
        const nextCandidateHopId = this.getHopId(
          nextCandidate.portId,
          nextCandidate.nextRegionId,
        )
        if (nextCandidate.g >= this.getCandidateBestCost(nextCandidateHopId)) {
          continue
        }

        this.setCandidateBestCost(nextCandidateHopId, nextCandidate.g)
        this.state.candidateQueue.queue(nextCandidate)
      }
    }

    if (this.state.candidateQueue.length === 0) {
      if (this.tryAcceptBestCompleteFallbackPreview()) {
        return
      }

      this.failed = true
      this.error =
        preview.reason ??
        (currentCandidate.atGoal
          ? "Centerline reached its destination but the bus remainder could not be inferred"
          : "Centerline candidates are exhausted without a non-intersecting bus solution")
      this.updateBusStats()
      return
    }

    this.updateBusStats()
  }

  override visualize(): GraphicsObject {
    return visualizeTinyGraph(this)
  }

  private resolveCenterGoalTransitRegionId() {
    const goalPortId = this.problem.routeEndPort[this.centerRouteId]!
    const incidentRegionIds = this.topology.incidentPortRegion[goalPortId] ?? []
    const preferredOuterRegionId = this.getSerializedRegionIdFromRouteMetadata(
      this.centerRouteId,
      "end",
    )

    return (
      incidentRegionIds.find(
        (regionId) => regionId !== preferredOuterRegionId,
      ) ??
      incidentRegionIds[0] ??
      -1
    )
  }

  private getSerializedRegionIdFromRouteMetadata(
    routeId: RouteId,
    side: "start" | "end",
  ) {
    const regionIdValue =
      side === "start"
        ? this.problem.routeMetadata?.[routeId]?.startRegionId
        : this.problem.routeMetadata?.[routeId]?.endRegionId

    return typeof regionIdValue === "string"
      ? this.regionIndexBySerializedId.get(regionIdValue)
      : undefined
  }

  private evaluateCandidate(
    candidate: BusCenterCandidate,
  ): BusPreview | undefined {
    clearPreviewRoutingStateValue(this.state, this.topology.regionCount)
    this.state.currentRouteId = this.centerRouteId
    this.state.currentRouteNetId = this.centerRouteNetId
    this.state.goalPortId = this.problem.routeEndPort[this.centerRouteId]!

    const centerPath = getCenterCandidatePath(candidate)
    const boundarySteps = this.boundaryPlanner.getBoundarySteps(centerPath)
    const boundaryPortIdsByStep =
      this.boundaryPlanner.assignBoundaryPortsForPath(boundarySteps)

    if (candidate.atGoal === true) {
      const completeBusPreview = this.buildBestCompleteBusPreview(
        centerPath,
        boundarySteps,
        boundaryPortIdsByStep,
      )
      if (!completeBusPreview) {
        const { sameLayerIntersectionCount, crossingLayerIntersectionCount } =
          getPreviewIntersectionCountsValue(this.state)
        return {
          tracePreviews: [],
          totalLength: 0,
          totalCost: Number.POSITIVE_INFINITY,
          completeTraceCount: 0,
          sameLayerIntersectionCount,
          crossingLayerIntersectionCount,
          reason: "Failed to infer a complete bus preview from the centerline",
        }
      }

      const { sameLayerIntersectionCount, crossingLayerIntersectionCount } =
        getPreviewIntersectionCountsValue(this.state)
      const totalRegionCost = getPreviewRegionCostValue(this.state)
      const totalIntersectionCount =
        sameLayerIntersectionCount + crossingLayerIntersectionCount
      return {
        tracePreviews: completeBusPreview.tracePreviews,
        totalLength: completeBusPreview.totalLength,
        totalCost:
          completeBusPreview.totalLength * this.DISTANCE_TO_COST +
          totalRegionCost +
          totalIntersectionCount * this.BUS_INTERSECTION_PREVIEW_PENALTY,
        completeTraceCount: completeBusPreview.tracePreviews.length,
        sameLayerIntersectionCount,
        crossingLayerIntersectionCount,
        reason:
          totalIntersectionCount > 0
            ? `Discarded centerline candidate due to ${totalIntersectionCount} bus intersections`
            : undefined,
      }
    }

    const tracePreviews: TracePreview[] = []
    const usedPortOwners = new Map<PortId, RouteId>()
    let totalLength = 0
    let totalPreviewCost = 0

    for (const traceIndex of this.commitTraceIndices) {
      const tracePreview =
        traceIndex === this.centerTraceIndex
          ? this.buildCenterlineTracePreview(centerPath, usedPortOwners, false)
          : this.buildBestPrefixTracePreview(
              traceIndex,
              centerPath,
              boundarySteps.length,
              boundarySteps,
              boundaryPortIdsByStep,
              usedPortOwners,
            )

      if (!tracePreview) {
        const { sameLayerIntersectionCount, crossingLayerIntersectionCount } =
          getPreviewIntersectionCountsValue(this.state)
        return {
          tracePreviews,
          totalLength,
          totalCost: Number.POSITIVE_INFINITY,
          completeTraceCount: tracePreviews.filter(
            (preview) => preview.complete,
          ).length,
          sameLayerIntersectionCount,
          crossingLayerIntersectionCount,
          reason:
            traceIndex === this.centerTraceIndex
              ? `Failed to infer centerline preview for ${this.getTraceConnectionId(traceIndex)}`
              : `Failed to infer ${candidate.atGoal ? "remainder" : "prefix"} for ${this.getTraceConnectionId(traceIndex)}`,
        }
      }

      tracePreviews.push(tracePreview)
      const traceLength = this.commitTracePreview(tracePreview, usedPortOwners)
      if (!Number.isFinite(traceLength)) {
        const { sameLayerIntersectionCount, crossingLayerIntersectionCount } =
          getPreviewIntersectionCountsValue(this.state)
        return {
          tracePreviews,
          totalLength,
          totalCost: Number.POSITIVE_INFINITY,
          completeTraceCount: tracePreviews.filter(
            (preview) => preview.complete,
          ).length,
          sameLayerIntersectionCount,
          crossingLayerIntersectionCount,
          reason: `Conflicting inferred port ownership for ${this.getTraceConnectionId(traceIndex)}`,
        }
      }

      totalLength += traceLength
      totalPreviewCost += tracePreview.previewCost ?? 0
    }

    const { sameLayerIntersectionCount, crossingLayerIntersectionCount } =
      getPreviewIntersectionCountsValue(this.state)
    const totalRegionCost = getPreviewRegionCostValue(this.state)
    const totalIntersectionCount =
      sameLayerIntersectionCount + crossingLayerIntersectionCount
    return {
      tracePreviews,
      totalLength,
      totalCost:
        totalLength * this.DISTANCE_TO_COST +
        totalRegionCost +
        totalPreviewCost +
        totalIntersectionCount * this.BUS_INTERSECTION_PREVIEW_PENALTY,
      completeTraceCount: tracePreviews.filter((preview) => preview.complete)
        .length,
      sameLayerIntersectionCount,
      crossingLayerIntersectionCount,
      reason:
        totalIntersectionCount > 0
          ? `Discarded centerline candidate due to ${totalIntersectionCount} bus intersections`
          : undefined,
    }
  }

  private buildCenterlineTracePreview(
    centerPath: BusCenterCandidate[],
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
    complete: boolean,
  ): TracePreview | undefined {
    const routeId = this.centerRouteId
    const startPortId = this.problem.routeStartPort[routeId]!
    const localOwners = new Map(usedPortOwners)

    if (!ensurePortOwnership(routeId, startPortId, localOwners)) {
      return undefined
    }

    const segments: TraceSegment[] = []
    let currentPortId = startPortId
    let currentRegionId = centerPath[0]?.nextRegionId

    if (currentRegionId === undefined) {
      return undefined
    }

    for (let pathIndex = 1; pathIndex < centerPath.length; pathIndex++) {
      const nextCandidate = centerPath[pathIndex]!
      if (!ensurePortOwnership(routeId, nextCandidate.portId, localOwners)) {
        return undefined
      }

      if (currentPortId !== nextCandidate.portId) {
        segments.push({
          regionId: currentRegionId,
          fromPortId: currentPortId,
          toPortId: nextCandidate.portId,
        })
      }

      currentPortId = nextCandidate.portId
      if (!nextCandidate.atGoal) {
        currentRegionId = nextCandidate.nextRegionId
      }
    }

    return {
      traceIndex: this.centerTraceIndex,
      routeId,
      segments,
      complete,
      terminalPortId: currentPortId,
      terminalRegionId: complete ? undefined : currentRegionId,
      previewCost: 0,
    }
  }

  private buildPrefixTracePreview(
    traceIndex: number,
    sharedStepCount: number,
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ): TracePreview | undefined {
    const routeId = this.busTraceOrder.traces[traceIndex]!.routeId
    const startPortId = this.problem.routeStartPort[routeId]!
    const startRegionId = this.getStartingNextRegionId(routeId, startPortId)

    if (startRegionId === undefined || this.topology.portZ[startPortId] !== 0) {
      return undefined
    }

    if (
      sharedStepCount > 0 &&
      startRegionId !== boundarySteps[0]!.fromRegionId
    ) {
      return undefined
    }

    const localOwners = new Map(usedPortOwners)
    if (!ensurePortOwnership(routeId, startPortId, localOwners)) {
      return undefined
    }

    const segments: TraceSegment[] = []
    let currentPortId = startPortId
    let currentRegionId = startRegionId

    for (let stepIndex = 0; stepIndex < sharedStepCount; stepIndex++) {
      const boundaryStep = boundarySteps[stepIndex]!
      const boundaryPortId = boundaryPortIdsByStep[stepIndex]?.[traceIndex]

      if (
        boundaryPortId === undefined ||
        currentRegionId !== boundaryStep.fromRegionId
      ) {
        return undefined
      }

      if (!ensurePortOwnership(routeId, boundaryPortId, localOwners)) {
        return undefined
      }

      if (currentPortId !== boundaryPortId) {
        segments.push({
          regionId: currentRegionId,
          fromPortId: currentPortId,
          toPortId: boundaryPortId,
        })
      }

      currentPortId = boundaryPortId
      currentRegionId = boundaryStep.toRegionId
    }

    return {
      traceIndex,
      routeId,
      segments,
      complete: false,
      terminalPortId: currentPortId,
      terminalRegionId: currentRegionId,
      previewCost: 0,
    }
  }

  private buildBestPrefixTracePreview(
    traceIndex: number,
    centerPath: BusCenterCandidate[],
    maxSharedStepCount: number,
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) {
    return this.traceInferencePlanner.buildBestPrefixTracePreview(
      traceIndex,
      centerPath,
      maxSharedStepCount,
      boundarySteps,
      boundaryPortIdsByStep,
      usedPortOwners,
    )
  }

  private buildCompleteTracePreviewOptions(
    traceIndex: number,
    centerPath: BusCenterCandidate[],
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) {
    if (traceIndex === this.centerTraceIndex) {
      const centerPreview = this.buildCenterlineCompleteTracePreview(
        centerPath,
        boundarySteps,
        usedPortOwners,
      )
      return centerPreview ? [centerPreview] : []
    }

    return this.traceInferencePlanner.buildCompleteTracePreviewOptions(
      traceIndex,
      centerPath,
      boundarySteps,
      boundaryPortIdsByStep,
      usedPortOwners,
    )
  }

  private buildBestCompleteBusPreview(
    centerPath: BusCenterCandidate[],
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
  ) {
    const tracePreviewsStack: TracePreview[] = []
    let bestTracePreviews: TracePreview[] | undefined
    let bestIntersectionCount = Number.POSITIVE_INFINITY
    let bestTotalLength = Number.POSITIVE_INFINITY

    const search = (
      orderIndex: number,
      usedPortOwners: Map<PortId, RouteId>,
    ) => {
      const {
        sameLayerIntersectionCount: currentSameLayerIntersectionCount,
        crossingLayerIntersectionCount: currentCrossingLayerIntersectionCount,
      } = getPreviewIntersectionCountsValue(this.state)
      const currentIntersectionCount =
        currentSameLayerIntersectionCount +
        currentCrossingLayerIntersectionCount

      if (
        currentIntersectionCount > bestIntersectionCount ||
        (currentIntersectionCount === bestIntersectionCount &&
          tracePreviewsStack.reduce(
            (sum, preview) =>
              sum + getTracePreviewLength(this.topology, preview),
            0,
          ) >= bestTotalLength)
      ) {
        return
      }

      if (orderIndex >= this.commitTraceIndices.length) {
        const totalLength = tracePreviewsStack.reduce(
          (sum, preview) => sum + getTracePreviewLength(this.topology, preview),
          0,
        )

        if (
          !bestTracePreviews ||
          currentIntersectionCount < bestIntersectionCount ||
          (currentIntersectionCount === bestIntersectionCount &&
            totalLength < bestTotalLength - BUS_CANDIDATE_EPSILON)
        ) {
          bestIntersectionCount = currentIntersectionCount
          bestTotalLength = totalLength
          bestTracePreviews = tracePreviewsStack.map((preview) => ({
            ...preview,
            segments: preview.segments.map((segment) => ({ ...segment })),
          }))
        }
        return
      }

      const traceIndex = this.commitTraceIndices[orderIndex]!
      const rankedOptions = this.buildCompleteTracePreviewOptions(
        traceIndex,
        centerPath,
        boundarySteps,
        boundaryPortIdsByStep,
        usedPortOwners,
      )
        .map((tracePreview) => {
          const stateSnapshot = snapshotPreviewRoutingStateValue(this.state)
          const ownerSnapshot = new Map(usedPortOwners)
          const traceLength = this.commitTracePreview(
            tracePreview,
            usedPortOwners,
          )
          const { sameLayerIntersectionCount, crossingLayerIntersectionCount } =
            getPreviewIntersectionCountsValue(this.state)
          const intersectionCount =
            sameLayerIntersectionCount + crossingLayerIntersectionCount
          restorePreviewRoutingStateValue(this.state, stateSnapshot)
          usedPortOwners.clear()
          for (const [portId, routeId] of ownerSnapshot) {
            usedPortOwners.set(portId, routeId)
          }

          return {
            tracePreview,
            traceLength,
            intersectionCount,
          }
        })
        .filter(({ traceLength }) => Number.isFinite(traceLength))
        .sort(
          (left, right) =>
            left.intersectionCount - right.intersectionCount ||
            left.traceLength - right.traceLength,
        )
        .slice(0, this.COMPLETE_TRACE_OPTION_BRANCH_LIMIT)

      for (const { tracePreview } of rankedOptions) {
        const stateSnapshot = snapshotPreviewRoutingStateValue(this.state)
        const ownerSnapshot = new Map(usedPortOwners)
        const traceLength = this.commitTracePreview(
          tracePreview,
          usedPortOwners,
        )

        if (Number.isFinite(traceLength)) {
          tracePreviewsStack.push(tracePreview)
          search(orderIndex + 1, usedPortOwners)
          tracePreviewsStack.pop()
        }

        restorePreviewRoutingStateValue(this.state, stateSnapshot)
        usedPortOwners.clear()
        for (const [portId, routeId] of ownerSnapshot) {
          usedPortOwners.set(portId, routeId)
        }

        if (bestIntersectionCount === 0) {
          return
        }
      }
    }

    clearPreviewRoutingStateValue(this.state, this.topology.regionCount)
    search(0, new Map())

    if (!bestTracePreviews) {
      return undefined
    }

    clearPreviewRoutingStateValue(this.state, this.topology.regionCount)
    const usedPortOwners = new Map<PortId, RouteId>()
    let totalLength = 0

    for (const tracePreview of bestTracePreviews) {
      totalLength += this.commitTracePreview(tracePreview, usedPortOwners)
    }

    return {
      tracePreviews: bestTracePreviews,
      totalLength,
    }
  }

  private buildCenterlineCompleteTracePreview(
    centerPath: BusCenterCandidate[],
    boundarySteps: BoundaryStep[],
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ): TracePreview | undefined {
    const routeId = this.centerRouteId
    const startPortId = this.problem.routeStartPort[routeId]!
    const goalPortId = this.problem.routeEndPort[routeId]!
    const startRegionId = this.getStartingNextRegionId(routeId, startPortId)

    if (startRegionId === undefined) {
      return undefined
    }

    const localOwners = new Map(usedPortOwners)
    if (
      !ensurePortOwnership(routeId, startPortId, localOwners) ||
      !ensurePortOwnership(routeId, goalPortId, localOwners)
    ) {
      return undefined
    }

    const segments: TraceSegment[] = []
    let currentPortId = startPortId
    let currentRegionId = startRegionId

    for (const boundaryStep of boundarySteps) {
      if (
        !ensurePortOwnership(routeId, boundaryStep.centerPortId, localOwners)
      ) {
        return undefined
      }

      if (currentRegionId !== boundaryStep.fromRegionId) {
        return undefined
      }

      if (currentPortId !== boundaryStep.centerPortId) {
        segments.push({
          regionId: currentRegionId,
          fromPortId: currentPortId,
          toPortId: boundaryStep.centerPortId,
        })
      }

      currentPortId = boundaryStep.centerPortId
      currentRegionId = boundaryStep.toRegionId
    }

    if (currentPortId !== goalPortId) {
      segments.push({
        regionId: currentRegionId,
        fromPortId: currentPortId,
        toPortId: goalPortId,
      })
    }

    return {
      traceIndex: this.centerTraceIndex,
      routeId,
      segments,
      complete: true,
      terminalPortId: goalPortId,
      previewCost: 0,
    }
  }

  private maybeStoreBestCompleteFallbackPreview(
    preview: BusPreview,
    totalIntersectionCount: number,
  ) {
    if (
      totalIntersectionCount > this.bestCompleteFallbackIntersectionCount ||
      (totalIntersectionCount === this.bestCompleteFallbackIntersectionCount &&
        preview.totalCost >= this.bestCompleteFallbackCost)
    ) {
      return
    }

    this.bestCompleteFallbackPreview = {
      ...preview,
      reason: undefined,
      tracePreviews: preview.tracePreviews.map((tracePreview) => ({
        ...tracePreview,
        segments: tracePreview.segments.map((segment) => ({ ...segment })),
      })),
    }
    this.bestCompleteFallbackSnapshot = snapshotPreviewRoutingStateValue(
      this.state,
    )
    this.bestCompleteFallbackIntersectionCount = totalIntersectionCount
    this.bestCompleteFallbackCost = preview.totalCost
  }

  private tryAcceptBestCompleteFallbackPreview() {
    if (
      !this.bestCompleteFallbackPreview ||
      !this.bestCompleteFallbackSnapshot
    ) {
      return false
    }

    restorePreviewRoutingStateValue(
      this.state,
      this.bestCompleteFallbackSnapshot,
    )
    this.lastPreview = this.bestCompleteFallbackPreview
    this.solved = true
    this.failed = false
    this.error = null
    this.state.unroutedRoutes = []
    this.updateBusStats()
    return true
  }

  private isUsableCenterlineBoundaryPort(portId: PortId) {
    return (
      this.problem.portSectionMask[portId] === 1 &&
      this.topology.portZ[portId] === 0 &&
      !this.isPortReservedForDifferentBusNet(this.centerRouteNetId, portId)
    )
  }

  private isManualCenterFinishRegion(regionId: RegionId) {
    const hopDistance = this.centerGoalHopDistanceByRegion[regionId]
    return hopDistance >= 0 && hopDistance <= this.MANUAL_CENTER_FINISH_MAX_HOPS
  }

  override getAdditionalRegionLabel(regionId: RegionId) {
    if (!this.isManualCenterFinishRegion(regionId)) {
      return undefined
    }

    return `bus end-manual hop: ${this.centerGoalHopDistanceByRegion[regionId]}`
  }

  private getManualCenterFinishPortOptions(
    currentCandidate: BusCenterCandidate,
    nextRegionId: RegionId,
  ) {
    const currentRegionId = currentCandidate.nextRegionId
    if (currentRegionId === undefined) {
      return [] as Array<{
        boundaryStep: BoundaryStep
        portId: PortId
        score: number
      }>
    }

    const sharedPortIds =
      this.boundaryPlanner.getUsableCenterlinePortIdsBetweenRegions(
        currentRegionId,
        nextRegionId,
      ) ?? []
    const previousNormal = getCandidateBoundaryNormal(currentCandidate)
    const candidatePortOptions = sharedPortIds
      .filter((portId) => portId !== currentCandidate.portId)
      .map((portId) => {
        const boundaryStep = this.boundaryPlanner.createBoundaryStep(
          currentRegionId,
          nextRegionId,
          portId,
          currentCandidate.portId,
          previousNormal,
        )
        const midpointPenalty =
          this.boundaryPlanner.getBoundaryCenterMidpointPenalty(boundaryStep)
        const segmentLength = getPortDistance(
          this.topology,
          currentCandidate.portId,
          portId,
        )
        const goalHeuristic =
          this.computeCenterHeuristic(portId, nextRegionId) *
          this.problem.routeCount
        const score =
          segmentLength * this.DISTANCE_TO_COST * this.problem.routeCount +
          midpointPenalty +
          goalHeuristic

        return {
          boundaryStep,
          portId,
          score,
        }
      })
      .sort(
        (left, right) => left.score - right.score || left.portId - right.portId,
      )

    return candidatePortOptions.slice(
      0,
      this.MANUAL_CENTER_FINISH_PORT_OPTIONS_PER_BOUNDARY,
    )
  }

  private getManualCenterFinishCandidates(
    currentCandidate: BusCenterCandidate,
  ) {
    const currentRegionId = currentCandidate.nextRegionId
    if (
      currentRegionId === undefined ||
      !this.isManualCenterFinishRegion(currentRegionId)
    ) {
      return [] as BusCenterCandidate[]
    }

    const goalPortId = this.problem.routeEndPort[this.centerRouteId]!
    const candidateKeys = new Set<string>()
    const completionCandidates: BusCenterCandidate[] = []
    const currentHopDistance =
      this.centerGoalHopDistanceByRegion[currentRegionId]
    const baseCost = currentCandidate.busCost ?? currentCandidate.g

    const search = (
      candidate: BusCenterCandidate,
      regionId: RegionId,
      hopDistance: number,
      accumulatedCost: number,
    ) => {
      if (isPortIncidentToRegion(this.topology, goalPortId, regionId)) {
        const segmentLength = getPortDistance(
          this.topology,
          candidate.portId,
          goalPortId,
        )
        const goalCandidate: BusCenterCandidate = {
          portId: goalPortId,
          nextRegionId: regionId,
          g:
            accumulatedCost +
            segmentLength * this.DISTANCE_TO_COST * this.problem.routeCount,
          h: 0,
          f:
            accumulatedCost +
            segmentLength * this.DISTANCE_TO_COST * this.problem.routeCount,
          atGoal: true,
          prevRegionId: regionId,
          prevCandidate: candidate,
        }
        const candidateKey = getCenterCandidatePathKey(goalCandidate)
        if (!candidateKeys.has(candidateKey)) {
          candidateKeys.add(candidateKey)
          completionCandidates.push(goalCandidate)
        }
        return
      }

      if (hopDistance <= 0) {
        return
      }

      const nextHopDistance = hopDistance - 1
      for (const nextRegionId of this.centerlineNeighborRegionIdsByRegion[
        regionId
      ] ?? []) {
        if (
          this.centerGoalHopDistanceByRegion[nextRegionId] !== nextHopDistance
        ) {
          continue
        }

        if (centerCandidatePathContainsRegion(candidate, nextRegionId)) {
          continue
        }

        for (const portOption of this.getManualCenterFinishPortOptions(
          candidate,
          nextRegionId,
        )) {
          if (
            centerCandidatePathContainsHop(
              candidate,
              portOption.portId,
              nextRegionId,
            )
          ) {
            continue
          }

          const segmentLength = getPortDistance(
            this.topology,
            candidate.portId,
            portOption.portId,
          )
          const nextCost = accumulatedCost + portOption.score
          const nextCandidate: BusCenterCandidate = {
            portId: portOption.portId,
            nextRegionId,
            g: nextCost,
            h: 0,
            f: nextCost,
            prevRegionId: regionId,
            prevCandidate: candidate,
            boundaryNormalX: portOption.boundaryStep.normalX,
            boundaryNormalY: portOption.boundaryStep.normalY,
          }

          search(nextCandidate, nextRegionId, nextHopDistance, nextCost)
        }
      }
    }

    search(currentCandidate, currentRegionId, currentHopDistance, baseCost)

    return completionCandidates
      .sort((left, right) => left.g - right.g || left.portId - right.portId)
      .slice(0, this.MANUAL_CENTER_FINISH_CANDIDATE_LIMIT)
  }

  private getAvailableCenterMoves(currentCandidate: BusCenterCandidate) {
    const moves: BusCenterCandidate[] = []
    const routeId = this.centerRouteId
    const currentNetId = this.centerRouteNetId

    if (currentCandidate.atGoal) {
      return moves
    }

    if (
      this.isRegionReservedForDifferentBusNet(
        currentNetId,
        currentCandidate.nextRegionId,
      )
    ) {
      return moves
    }

    if (this.isManualCenterFinishRegion(currentCandidate.nextRegionId)) {
      return this.getManualCenterFinishCandidates(currentCandidate)
    }

    const parentCost = currentCandidate.busCost ?? currentCandidate.g
    const goalPortId = this.problem.routeEndPort[routeId]!

    for (const neighborPortId of this.topology.regionIncidentPorts[
      currentCandidate.nextRegionId
    ] ?? []) {
      if (
        neighborPortId === currentCandidate.portId ||
        this.problem.portSectionMask[neighborPortId] === 0 ||
        this.topology.portZ[neighborPortId] !== 0 ||
        this.isPortReservedForDifferentNet(neighborPortId)
      ) {
        continue
      }

      const segmentLength = getPortDistance(
        this.topology,
        currentCandidate.portId,
        neighborPortId,
      )

      if (neighborPortId === goalPortId) {
        const g =
          parentCost +
          segmentLength * this.DISTANCE_TO_COST * this.problem.routeCount
        moves.push({
          portId: goalPortId,
          nextRegionId: currentCandidate.nextRegionId,
          g,
          h: 0,
          f: g,
          atGoal: true,
          prevRegionId: currentCandidate.nextRegionId,
          prevCandidate: currentCandidate,
        })
        continue
      }

      const nextRegionId =
        this.topology.incidentPortRegion[neighborPortId]?.[0] ===
        currentCandidate.nextRegionId
          ? this.topology.incidentPortRegion[neighborPortId]?.[1]
          : this.topology.incidentPortRegion[neighborPortId]?.[0]

      if (
        nextRegionId === undefined ||
        this.isRegionReservedForDifferentBusNet(currentNetId, nextRegionId)
      ) {
        continue
      }

      const previousNormal = getCandidateBoundaryNormal(currentCandidate)
      const boundaryStep = this.boundaryPlanner.createBoundaryStep(
        currentCandidate.nextRegionId,
        nextRegionId,
        neighborPortId,
        currentCandidate.portId,
        previousNormal,
      )
      const boundarySupportPenalty =
        this.boundaryPlanner.getBoundarySupportPenalty(boundaryStep)
      const g =
        parentCost +
        segmentLength * this.DISTANCE_TO_COST * this.problem.routeCount +
        boundarySupportPenalty

      const centerPortOptions =
        this.boundaryPlanner.getPreferredCenterPortOptionsForBoundaryStep(
          boundaryStep,
        )
      if (!centerPortOptions || !centerPortOptions.includes(neighborPortId)) {
        continue
      }

      if (
        centerCandidatePathContainsHop(
          currentCandidate,
          neighborPortId,
          nextRegionId,
        )
      ) {
        continue
      }

      if (centerCandidatePathContainsRegion(currentCandidate, nextRegionId)) {
        continue
      }

      const h = this.computeCenterHeuristic(neighborPortId, nextRegionId)
      if (!Number.isFinite(h)) {
        continue
      }
      const scaledH = h * this.problem.routeCount
      moves.push({
        portId: neighborPortId,
        nextRegionId,
        g,
        h: scaledH,
        f: g + scaledH,
        prevRegionId: currentCandidate.nextRegionId,
        prevCandidate: currentCandidate,
        boundaryNormalX: boundaryStep.normalX,
        boundaryNormalY: boundaryStep.normalY,
      })
    }

    return moves
  }

  private commitTracePreview(
    tracePreview: TracePreview,
    usedPortOwners: Map<PortId, RouteId>,
  ) {
    let totalLength = 0
    const routeNetId = this.problem.routeNet[tracePreview.routeId]!

    this.state.currentRouteId = tracePreview.routeId
    this.state.currentRouteNetId = routeNetId

    for (const segment of tracePreview.segments) {
      if (
        this.topology.portZ[segment.fromPortId] !== 0 ||
        this.topology.portZ[segment.toPortId] !== 0 ||
        !ensurePortOwnership(
          tracePreview.routeId,
          segment.fromPortId,
          usedPortOwners,
        ) ||
        !ensurePortOwnership(
          tracePreview.routeId,
          segment.toPortId,
          usedPortOwners,
        )
      ) {
        return Number.POSITIVE_INFINITY
      }

      this.state.regionSegments[segment.regionId]!.push([
        tracePreview.routeId,
        segment.fromPortId,
        segment.toPortId,
      ])
      this.state.portAssignment[segment.fromPortId] = routeNetId
      this.state.portAssignment[segment.toPortId] = routeNetId
      this.appendSegmentToRegionCache(
        segment.regionId,
        segment.fromPortId,
        segment.toPortId,
      )
      totalLength += getPortDistance(
        this.topology,
        segment.fromPortId,
        segment.toPortId,
      )
    }

    this.state.currentRouteId = this.centerRouteId
    this.state.currentRouteNetId = this.centerRouteNetId
    return totalLength
  }

  private getTraceSidePenalty(traceIndex: number, portId: PortId) {
    const trace = this.busTraceOrder.traces[traceIndex]!
    if (trace.signedIndexFromCenter === 0) {
      return 0
    }

    const projection = getPortProjection(
      this.topology,
      portId,
      this.busTraceOrder.normalX,
      this.busTraceOrder.normalY,
    )
    const centerProjection =
      this.busTraceOrder.traces[this.centerTraceIndex]!.score
    const offset = projection - centerProjection

    if (
      (trace.signedIndexFromCenter < 0 && offset <= 0) ||
      (trace.signedIndexFromCenter > 0 && offset >= 0)
    ) {
      return 0
    }

    return Math.abs(offset)
  }

  private getTraceLanePenalty(traceIndex: number, portId: PortId) {
    const trace = this.busTraceOrder.traces[traceIndex]!
    const projection = getPortProjection(
      this.topology,
      portId,
      this.busTraceOrder.normalX,
      this.busTraceOrder.normalY,
    )

    return Math.abs(projection - trace.score)
  }

  private getRouteHeuristic(routeId: RouteId, portId: PortId) {
    return this.problemSetup.portHCostToEndOfRoute[
      portId * this.problem.routeCount + routeId
    ]
  }

  private computeCenterHeuristic(portId: PortId, nextRegionId?: RegionId) {
    const portHeuristic = this.getRouteHeuristic(this.centerRouteId, portId)

    if (nextRegionId === undefined) {
      return portHeuristic
    }

    const regionHeuristic = this.regionDistanceToGoalByRegion[nextRegionId]
    if (!Number.isFinite(regionHeuristic)) {
      return portHeuristic
    }

    return Math.max(portHeuristic, regionHeuristic * this.DISTANCE_TO_COST)
  }

  private isPortReservedForDifferentBusNet(
    currentNetId: NetId,
    portId: PortId,
  ) {
    const reservedNetIds = this.problemSetup.portEndpointNetIds[portId]
    if (!reservedNetIds) {
      return false
    }

    for (const reservedNetId of reservedNetIds) {
      if (reservedNetId !== currentNetId) {
        return true
      }
    }

    return false
  }

  private isRegionReservedForDifferentBusNet(
    currentNetId: NetId,
    regionId: RegionId,
  ) {
    const reservedNetId = this.problem.regionNetId[regionId]
    return reservedNetId !== -1 && reservedNetId !== currentNetId
  }

  protected override getRouteConnectionId(routeId: RouteId) {
    return (
      this.problem.routeMetadata?.[routeId]?.connectionId ?? `route-${routeId}`
    )
  }

  private getTraceConnectionId(traceIndex: number) {
    return (
      this.busTraceOrder.traces[traceIndex]?.connectionId ??
      `trace-${traceIndex}`
    )
  }

  private updateBusStats(failureReason?: string) {
    this.stats = {
      ...this.stats,
      routeCount: this.problem.routeCount,
      busCenterConnectionId: this.getRouteConnectionId(this.centerRouteId),
      currentTraceConnectionId: this.getRouteConnectionId(this.centerRouteId),
      openCandidateCount: this.state.candidateQueue.length,
      solvedTraceCount: this.lastPreview?.completeTraceCount ?? 0,
      currentBusCost: this.lastExpandedCandidate?.busCost,
      previewReason: failureReason ?? this.lastPreview?.reason,
      previewRouteCount: this.lastPreview?.tracePreviews.length ?? 0,
    }
  }
}
