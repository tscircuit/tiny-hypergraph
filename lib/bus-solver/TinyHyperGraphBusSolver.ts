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
    isPortIncidentToRegion,
  } from "./busPathHelpers"
import {
  BUS_CANDIDATE_EPSILON,
  compareBusCandidatesByF,
  computeMedianTracePitch,
  type BoundaryStep,
  type BusCenterCandidate,
  type BusPreview,
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
  BUS_MIN_TRACE_PROGRESS_RATIO = 0.7
  BUS_MIN_TRACE_PROGRESS_THRESHOLD = 2
  CENTER_GREEDY_HEURISTIC_MULTIPLIER = 10
  CENTER_PORT_OPTIONS_PER_EDGE = 6
  BUS_TRACE_LENGTH_MARGIN = 1
  BUS_MAX_TRACE_STEPS = 256
  MANUAL_CENTER_FINISH_MAX_HOPS = 2
  MANUAL_CENTER_FINISH_PORT_OPTIONS_PER_BOUNDARY = 6
  MANUAL_CENTER_FINISH_CANDIDATE_LIMIT = 24
  TRACE_ALONGSIDE_SEARCH_BRANCH_LIMIT = 6
  TRACE_ALONGSIDE_SEARCH_BEAM_WIDTH = 32
  TRACE_ALONGSIDE_SEARCH_OPTION_LIMIT = 8
  TRACE_ALONGSIDE_LANE_WEIGHT = 1
  TRACE_ALONGSIDE_REGRESSION_WEIGHT = 2

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
  readonly showUnassignedPortsInVisualization: boolean

  private readonly boundaryPlanner: BusBoundaryPlanner
  private readonly traceInferencePlanner: BusTraceInferencePlanner
  private readonly centerlineNeighborRegionIdsByRegion: RegionId[][]
  private readonly regionIndexBySerializedId = new Map<string, RegionId>()
  private readonly candidateBestCostByStateKey = new Map<string, number>()
  private readonly queuedCandidateBestCostByStateKey = new Map<string, number>()
  private lastExpandedCandidate?: BusCenterCandidate
  private lastPreview?: BusPreview
  private lastNeighborCount = 0
  private lastQueuedNeighborCount = 0

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
    if (options?.CENTER_GREEDY_HEURISTIC_MULTIPLIER !== undefined) {
      this.CENTER_GREEDY_HEURISTIC_MULTIPLIER =
        options.CENTER_GREEDY_HEURISTIC_MULTIPLIER
    }
    this.showUnassignedPortsInVisualization =
      options?.VISUALIZE_UNASSIGNED_PORTS ?? false

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
      BUS_MIN_TRACE_PROGRESS_RATIO: this.BUS_MIN_TRACE_PROGRESS_RATIO,
      BUS_MIN_TRACE_PROGRESS_THRESHOLD: this.BUS_MIN_TRACE_PROGRESS_THRESHOLD,
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
      isTracePreviewUsable: (...args) => this.isTracePreviewUsable(...args),
      getTraceSidePenalty: (...args) => this.getTraceSidePenalty(...args),
      getTraceLanePenalty: (...args) => this.getTraceLanePenalty(...args),
      getRouteHeuristic: (...args) => this.getRouteHeuristic(...args),
      getCenterGoalHopDistance: (regionId) =>
        this.centerGoalHopDistanceByRegion[regionId] ?? -1,
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
    this.lastNeighborCount = 0
    this.lastQueuedNeighborCount = 0
    this.candidateBestCostByStateKey.clear()
    this.queuedCandidateBestCostByStateKey.clear()
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
      this.scaleCenterHeuristic(
        this.computeCenterHeuristic(startPortId, startNextRegionId),
      )
    const startCandidate: BusCenterCandidate = {
      portId: startPortId,
      nextRegionId: startNextRegionId,
      g: 0,
      h: startHeuristic,
      f: startHeuristic,
    }
    if (this.shouldUseBusStatePruning()) {
      this.queuedCandidateBestCostByStateKey.set(
        this.getBusCandidateStateKey(startCandidate, {
          tracePreviews: [],
          totalLength: 0,
          totalCost: 0,
          completeTraceCount: 0,
          sameLayerIntersectionCount: 0,
          crossingLayerIntersectionCount: 0,
        }),
        0,
      )
    } else {
      this.setCandidateBestCost(this.getHopId(startPortId, startNextRegionId), 0)
    }
    this.state.candidateQueue.queue(startCandidate)
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
      this.failed = true
      this.error =
        "Centerline candidates are exhausted without a non-intersecting bus solution"
      this.updateBusStats()
      return
    }

    if (!this.shouldUseBusStatePruning()) {
      const currentCandidateHopId = this.getHopId(
        currentCandidate.portId,
        currentCandidate.nextRegionId,
      )
      if (currentCandidate.g > this.getCandidateBestCost(currentCandidateHopId)) {
        this.updateBusStats()
        return
      }
    }

    this.lastExpandedCandidate = currentCandidate
    this.lastNeighborCount = 0
    this.lastQueuedNeighborCount = 0
    const preview = this.evaluateCandidate(currentCandidate)
    this.lastPreview = preview

    if (!preview) {
      this.updateBusStats("preview_failed")
      return
    }

    currentCandidate.busCost = preview.totalCost
    if (this.shouldUseBusStatePruning()) {
      const currentCandidateStateKey = this.getBusCandidateStateKey(
        currentCandidate,
        preview,
      )
      const currentBestCost = this.candidateBestCostByStateKey.get(
        currentCandidateStateKey,
      )
      if (
        currentBestCost !== undefined &&
        currentCandidate.busCost >= currentBestCost - BUS_CANDIDATE_EPSILON
      ) {
        this.updateBusStats()
        return
      }
      this.candidateBestCostByStateKey.set(
        currentCandidateStateKey,
        currentCandidate.busCost,
      )
    }
    const hasIntersections =
      preview.sameLayerIntersectionCount > 0 ||
      preview.crossingLayerIntersectionCount > 0
    const hasInferenceFailure =
      preview.reason !== undefined && !hasIntersections

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
      !hasIntersections &&
      !hasInferenceFailure &&
      !currentCandidate.atGoal
    ) {
      const currentPreviewState = snapshotPreviewRoutingStateValue(this.state)
      const nextCandidates = this.getAvailableCenterMoves(currentCandidate)
      this.lastNeighborCount = nextCandidates.length
      this.lastQueuedNeighborCount = 0

      for (const nextCandidate of nextCandidates) {
        const nextPreview = this.evaluateCandidate(nextCandidate)
        if (!nextPreview || !this.isQueueablePreview(nextPreview)) {
          continue
        }

        nextCandidate.busCost = nextPreview.totalCost

        if (this.shouldUseBusStatePruning()) {
          const nextQueuedCandidateStateKey = this.getBusCandidateStateKey(
            nextCandidate,
            nextPreview,
          )
          if (
            nextCandidate.busCost >=
            (this.queuedCandidateBestCostByStateKey.get(
              nextQueuedCandidateStateKey,
            ) ?? Number.POSITIVE_INFINITY)
          ) {
            continue
          }

          this.queuedCandidateBestCostByStateKey.set(
            nextQueuedCandidateStateKey,
            nextCandidate.busCost,
          )
        } else {
          const nextCandidateHopId = this.getHopId(
            nextCandidate.portId,
            nextCandidate.nextRegionId,
          )
          if (nextCandidate.g >= this.getCandidateBestCost(nextCandidateHopId)) {
            continue
          }

          this.setCandidateBestCost(nextCandidateHopId, nextCandidate.g)
        }
        this.state.candidateQueue.queue(nextCandidate)
        this.lastQueuedNeighborCount += 1
      }

      restorePreviewRoutingStateValue(this.state, currentPreviewState)
    } else {
      this.lastNeighborCount = 0
      this.lastQueuedNeighborCount = 0
    }

    if (this.state.candidateQueue.length === 0) {
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

    return this.buildDerivedBusPreview(
      centerPath,
      boundarySteps,
      boundaryPortIdsByStep,
      candidate.atGoal === true,
    )
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

  private buildCompleteTracePreview(
    traceIndex: number,
    centerPath: BusCenterCandidate[],
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) {
    return this.traceInferencePlanner.buildCompleteTracePreview(
      traceIndex,
      centerPath,
      boundarySteps,
      boundaryPortIdsByStep,
      usedPortOwners,
    )
  }

  private buildDerivedBusPreview(
    centerPath: BusCenterCandidate[],
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    complete: boolean,
  ) {
    const tracePreviews: TracePreview[] = []
    const usedPortOwners = new Map<PortId, RouteId>()
    let totalLength = 0
    let totalPreviewCost = 0

    for (const traceIndex of this.commitTraceIndices) {
      const tracePreview =
        traceIndex === this.centerTraceIndex
          ? complete
            ? this.buildCenterlineCompleteTracePreview(
                centerPath,
                boundarySteps,
                usedPortOwners,
              )
            : this.buildCenterlineTracePreview(centerPath, usedPortOwners, false)
          : complete
            ? this.buildCompleteTracePreview(
                traceIndex,
                centerPath,
                boundarySteps,
                boundaryPortIdsByStep,
                usedPortOwners,
              )
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
              : `Failed to infer ${complete ? "remainder" : "prefix"} for ${this.getTraceConnectionId(traceIndex)}`,
        }
      }

      const {
        sameLayerIntersectionCount: previousSameLayerIntersectionCount,
        crossingLayerIntersectionCount: previousCrossingLayerIntersectionCount,
      } = getPreviewIntersectionCountsValue(this.state)

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

      const { sameLayerIntersectionCount, crossingLayerIntersectionCount } =
        getPreviewIntersectionCountsValue(this.state)
      if (
        sameLayerIntersectionCount > previousSameLayerIntersectionCount ||
        crossingLayerIntersectionCount > previousCrossingLayerIntersectionCount
      ) {
        return {
          tracePreviews,
          totalLength,
          totalCost: Number.POSITIVE_INFINITY,
          completeTraceCount: tracePreviews.filter(
            (preview) => preview.complete,
          ).length,
          sameLayerIntersectionCount,
          crossingLayerIntersectionCount,
          reason: `Intersecting inferred path for ${this.getTraceConnectionId(traceIndex)}`,
        }
      }

      totalLength += traceLength
      totalPreviewCost += tracePreview.previewCost ?? 0
    }

    const { sameLayerIntersectionCount, crossingLayerIntersectionCount } =
      getPreviewIntersectionCountsValue(this.state)
    const totalRegionCost = getPreviewRegionCostValue(this.state)

    if (!complete) {
      for (const tracePreview of tracePreviews) {
        if (tracePreview.traceIndex === this.centerTraceIndex) {
          continue
        }

        if (
          !this.traceInferencePlanner.hasRemainingTraceCandidate(
            tracePreview,
            usedPortOwners,
          )
        ) {
          return {
            tracePreviews,
            totalLength,
            totalCost: Number.POSITIVE_INFINITY,
            completeTraceCount: tracePreviews.filter((preview) => preview.complete)
              .length,
            sameLayerIntersectionCount,
            crossingLayerIntersectionCount,
            reason: `No remaining candidates for ${this.getTraceConnectionId(tracePreview.traceIndex)}`,
          }
        }
      }
    }

    return {
      tracePreviews,
      totalLength,
      totalCost:
        totalLength * this.DISTANCE_TO_COST +
        totalRegionCost +
        totalPreviewCost,
      completeTraceCount: tracePreviews.filter((preview) => preview.complete)
        .length,
      sameLayerIntersectionCount,
      crossingLayerIntersectionCount,
    }
  }

  private getBusCandidateStateKey(
    candidate: BusCenterCandidate,
    preview: BusPreview,
  ) {
    return [
      `${candidate.portId}:${candidate.nextRegionId}:${candidate.prevRegionId ?? -1}:${candidate.atGoal ? 1 : 0}`,
      ...preview.tracePreviews.map(
        (tracePreview) =>
          `${tracePreview.traceIndex}:${tracePreview.terminalRegionId ?? -1}:${tracePreview.complete ? 1 : 0}`,
      ),
    ].join("|")
  }

  private shouldUseBusStatePruning() {
    return this.problem.routeCount <= 6
  }

  private isQueueablePreview(preview: BusPreview) {
    if (
      preview.reason !== undefined ||
      preview.sameLayerIntersectionCount > 0 ||
      preview.crossingLayerIntersectionCount > 0
    ) {
      return false
    }

    const centerTracePreview = preview.tracePreviews.find(
      (tracePreview) => tracePreview.traceIndex === this.centerTraceIndex,
    )
    if (!centerTracePreview) {
      return false
    }

    const centerSegmentCount = centerTracePreview.segments.length
    const centerTraceLength = this.getTracePreviewLength(centerTracePreview)
    if (centerSegmentCount < this.BUS_MIN_TRACE_PROGRESS_THRESHOLD) {
      return preview.tracePreviews.every((tracePreview) => {
        if (tracePreview.traceIndex === this.centerTraceIndex) {
          return true
        }

        return (
          tracePreview.segments.length <= centerSegmentCount &&
          this.getTracePreviewLength(tracePreview) <=
            centerTraceLength + BUS_CANDIDATE_EPSILON
        )
      })
    }

    const minimumTraceSegmentCount = Math.max(
      1,
      Math.floor(centerSegmentCount * this.BUS_MIN_TRACE_PROGRESS_RATIO),
    )

    for (const tracePreview of preview.tracePreviews) {
      if (tracePreview.traceIndex === this.centerTraceIndex) {
        continue
      }

      if (
        tracePreview.segments.length > centerSegmentCount ||
        this.getTracePreviewLength(tracePreview) >
          centerTraceLength + BUS_CANDIDATE_EPSILON
      ) {
        return false
      }

      if (tracePreview.segments.length < minimumTraceSegmentCount) {
        return false
      }
    }

    return true
  }

  private buildPreviewUsedPortOwners(tracePreviews: readonly TracePreview[]) {
    const usedPortOwners = new Map<PortId, RouteId>()

    for (const tracePreview of tracePreviews) {
      for (const segment of tracePreview.segments) {
        if (
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
          return undefined
        }
      }
    }

    return usedPortOwners
  }

  private hasRemainingTraceCandidates(preview: BusPreview) {
    const usedPortOwners = this.buildPreviewUsedPortOwners(preview.tracePreviews)
    if (!usedPortOwners) {
      return false
    }

    return preview.tracePreviews.every((tracePreview) => {
      if (tracePreview.traceIndex === this.centerTraceIndex) {
        return true
      }

      return this.traceInferencePlanner.hasRemainingTraceCandidate(
        tracePreview,
        usedPortOwners,
      )
    })
  }

  private getTracePreviewLength(tracePreview: TracePreview) {
    return tracePreview.segments.reduce(
      (sum, segment) =>
        sum + getPortDistance(this.topology, segment.fromPortId, segment.toPortId),
      0,
    )
  }

  private isTracePreviewUsable(
    tracePreview: TracePreview,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) {
    const stateSnapshot = snapshotPreviewRoutingStateValue(this.state)
    const localOwners = new Map(usedPortOwners)
    const {
      sameLayerIntersectionCount: previousSameLayerIntersectionCount,
      crossingLayerIntersectionCount: previousCrossingLayerIntersectionCount,
    } = getPreviewIntersectionCountsValue(this.state)
    const traceLength = this.commitTracePreview(tracePreview, localOwners)
    const { sameLayerIntersectionCount, crossingLayerIntersectionCount } =
      getPreviewIntersectionCountsValue(this.state)

    restorePreviewRoutingStateValue(this.state, stateSnapshot)

    return (
      Number.isFinite(traceLength) &&
      sameLayerIntersectionCount === previousSameLayerIntersectionCount &&
      crossingLayerIntersectionCount === previousCrossingLayerIntersectionCount
    )
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
          this.scaleCenterHeuristic(
            this.computeCenterHeuristic(portId, nextRegionId),
          )
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
    const manualFinishCandidates = this.isManualCenterFinishRegion(
      currentCandidate.nextRegionId,
    )
      ? this.getManualCenterFinishCandidates(currentCandidate)
      : []

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
      const scaledH = this.scaleCenterHeuristic(h)
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

    if (manualFinishCandidates.length === 0) {
      return moves
    }

    const dedupedMoves = new Map<string, BusCenterCandidate>()
    for (const candidate of [...moves, ...manualFinishCandidates]) {
      const candidateKey = getCenterCandidatePathKey(candidate)
      const existingCandidate = dedupedMoves.get(candidateKey)
      if (
        !existingCandidate ||
        candidate.f < existingCandidate.f - BUS_CANDIDATE_EPSILON
      ) {
        dedupedMoves.set(candidateKey, candidate)
      }
    }

    return [...dedupedMoves.values()]
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

  private scaleCenterHeuristic(heuristic: number) {
    return (
      heuristic *
      this.problem.routeCount *
      this.CENTER_GREEDY_HEURISTIC_MULTIPLIER
    )
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
      lastNeighborCount: this.lastNeighborCount,
      lastQueuedNeighborCount: this.lastQueuedNeighborCount,
    }
  }
}
