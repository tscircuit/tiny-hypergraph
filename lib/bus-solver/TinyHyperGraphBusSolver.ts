import type { GraphicsObject } from "graphics-debug"
import { MinHeap } from "../MinHeap"
import {
  type Candidate,
  createEmptyRegionIntersectionCache,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "../core"
import type { NetId, PortId, RegionId, RouteId } from "../types"
import { visualizeTinyGraph } from "../visualizeTinyGraph"
import { deriveBusTraceOrder, type BusTraceOrder } from "./deriveBusTraceOrder"
import {
  getDistanceFromPortToPolyline,
  getPortDistance,
  getPortProgressAlongPolyline,
  getPortProjection,
} from "./geometry"

export interface TinyHyperGraphBusSolverOptions
  extends TinyHyperGraphSolverOptions {
  BUS_END_MARGIN_STEPS?: number
  BUS_MAX_REMAINDER_STEPS?: number
  BUS_REMAINDER_GUIDE_WEIGHT?: number
  BUS_REMAINDER_GOAL_WEIGHT?: number
  BUS_REMAINDER_SIDE_WEIGHT?: number
}

interface BusCenterCandidate extends Candidate {
  atGoal?: boolean
  busCost?: number
  boundaryNormalX?: number
  boundaryNormalY?: number
}

interface BoundaryStep {
  fromRegionId: RegionId
  toRegionId: RegionId
  centerPortId: PortId
  normalX: number
  normalY: number
}

interface TraceSegment {
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

interface TracePreview {
  traceIndex: number
  routeId: RouteId
  segments: TraceSegment[]
  complete: boolean
  terminalPortId: PortId
  terminalRegionId?: RegionId
  previewCost?: number
}

interface TraceInferenceState {
  routeId: RouteId
  portId: PortId
  nextRegionId?: RegionId
  atGoal: boolean
}

interface TraceInferenceMove {
  nextState: TraceInferenceState
  segmentLength: number
}

interface BusPreview {
  tracePreviews: TracePreview[]
  totalLength: number
  totalCost: number
  completeTraceCount: number
  sameLayerIntersectionCount: number
  crossingLayerIntersectionCount: number
  reason?: string
}

interface PreviewRoutingStateSnapshot {
  portAssignment: Int32Array
  regionSegments: Array<[RouteId, PortId, PortId][]>
  regionIntersectionCaches: TinyHyperGraphSolver["state"]["regionIntersectionCaches"]
}

interface RegionSearchCandidate {
  regionId: RegionId
  cost: number
}

const BUS_CANDIDATE_EPSILON = 1e-9

const compareCandidatesByF = (left: Candidate, right: Candidate) =>
  left.f - right.f || left.h - right.h || left.g - right.g

const compareRegionCandidates = (
  left: RegionSearchCandidate,
  right: RegionSearchCandidate,
) => left.cost - right.cost

const getRegionPairKey = (regionAId: RegionId, regionBId: RegionId) =>
  regionAId < regionBId
    ? `${regionAId}:${regionBId}`
    : `${regionBId}:${regionAId}`

const computeMedianTracePitch = (busTraceOrder: BusTraceOrder) => {
  const deltas: number[] = []

  for (
    let traceIndex = 1;
    traceIndex < busTraceOrder.traces.length;
    traceIndex++
  ) {
    deltas.push(
      busTraceOrder.traces[traceIndex]!.score -
        busTraceOrder.traces[traceIndex - 1]!.score,
    )
  }

  const positiveDeltas = deltas
    .map((delta) => Math.abs(delta))
    .filter((delta) => Number.isFinite(delta) && delta > BUS_CANDIDATE_EPSILON)
    .sort((left, right) => left - right)

  if (positiveDeltas.length === 0) {
    return 0.5
  }

  return positiveDeltas[Math.floor(positiveDeltas.length / 2)]!
}

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

  readonly busTraceOrder: BusTraceOrder
  readonly centerTraceIndex: number
  readonly centerRouteId: RouteId
  readonly centerRouteNetId: NetId
  readonly centerGoalTransitRegionId: RegionId
  readonly otherTraceIndices: number[]
  readonly commitTraceIndices: number[]
  readonly tracePitch: number
  readonly regionDistanceToGoalByRegion: Float64Array

  private readonly sharedZ0PortsByRegionPair = new Map<string, PortId[]>()
  private readonly regionIndexBySerializedId = new Map<string, RegionId>()
  private readonly portIndexBySerializedId = new Map<string, PortId>()
  private readonly boundarySupportCache = new Map<string, boolean>()
  private lastExpandedCandidate?: BusCenterCandidate
  private lastPreview?: BusPreview

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
    for (let portId = 0; portId < this.topology.portCount; portId++) {
      const serializedPortId =
        this.topology.portMetadata?.[portId]?.serializedPortId
      if (typeof serializedPortId === "string") {
        this.portIndexBySerializedId.set(serializedPortId, portId)
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

    this.buildSharedZ0PortsByRegionPair()
    this.regionDistanceToGoalByRegion = this.computeRegionDistanceToGoal()
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
    this.clearPreviewRoutingState()
    this.resetCandidateBestCosts()
    this.state.candidateQueue = new MinHeap([], compareCandidatesByF)

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

    if (!hasIntersections && !hasInferenceFailure && !currentCandidate.atGoal) {
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

  private buildSharedZ0PortsByRegionPair() {
    this.sharedZ0PortsByRegionPair.clear()

    for (let portId = 0; portId < this.topology.portCount; portId++) {
      if (this.topology.portZ[portId] !== 0) {
        continue
      }

      const [regionAId, regionBId] =
        this.topology.incidentPortRegion[portId] ?? []
      if (regionAId === undefined || regionBId === undefined) {
        continue
      }

      const regionPairKey = getRegionPairKey(regionAId, regionBId)
      const sharedPortIds =
        this.sharedZ0PortsByRegionPair.get(regionPairKey) ?? []
      sharedPortIds.push(portId)
      this.sharedZ0PortsByRegionPair.set(regionPairKey, sharedPortIds)
    }

    for (const [regionPairKey, sharedPortIds] of this
      .sharedZ0PortsByRegionPair) {
      sharedPortIds.sort((leftPortId, rightPortId) => {
        const leftProjection = getPortProjection(
          this.topology,
          leftPortId,
          this.busTraceOrder.normalX,
          this.busTraceOrder.normalY,
        )
        const rightProjection = getPortProjection(
          this.topology,
          rightPortId,
          this.busTraceOrder.normalX,
          this.busTraceOrder.normalY,
        )

        return leftProjection - rightProjection || leftPortId - rightPortId
      })
      this.sharedZ0PortsByRegionPair.set(regionPairKey, sharedPortIds)
    }
  }

  private computeRegionDistanceToGoal() {
    const regionDistanceToGoalByRegion = new Float64Array(
      this.topology.regionCount,
    ).fill(Number.POSITIVE_INFINITY)
    const candidateQueue = new MinHeap<RegionSearchCandidate>(
      [],
      compareRegionCandidates,
    )

    regionDistanceToGoalByRegion[this.centerGoalTransitRegionId] = 0
    candidateQueue.queue({
      regionId: this.centerGoalTransitRegionId,
      cost: 0,
    })

    while (candidateQueue.length > 0) {
      const currentCandidate = candidateQueue.dequeue()
      if (!currentCandidate) {
        break
      }

      if (
        currentCandidate.cost >
        regionDistanceToGoalByRegion[currentCandidate.regionId]! +
          BUS_CANDIDATE_EPSILON
      ) {
        continue
      }

      for (const [regionPairKey, sharedPortIds] of this
        .sharedZ0PortsByRegionPair) {
        if (sharedPortIds.length < this.problem.routeCount) {
          continue
        }

        const separatorIndex = regionPairKey.indexOf(":")
        const regionAId = Number(regionPairKey.slice(0, separatorIndex))
        const regionBId = Number(regionPairKey.slice(separatorIndex + 1))
        const nextRegionId =
          regionAId === currentCandidate.regionId
            ? regionBId
            : regionBId === currentCandidate.regionId
              ? regionAId
              : undefined

        if (nextRegionId === undefined) {
          continue
        }

        const edgeCost = Math.hypot(
          this.topology.regionCenterX[currentCandidate.regionId] -
            this.topology.regionCenterX[nextRegionId],
          this.topology.regionCenterY[currentCandidate.regionId] -
            this.topology.regionCenterY[nextRegionId],
        )
        const nextCost = currentCandidate.cost + edgeCost

        if (nextCost >= regionDistanceToGoalByRegion[nextRegionId]!) {
          continue
        }

        regionDistanceToGoalByRegion[nextRegionId] = nextCost
        candidateQueue.queue({
          regionId: nextRegionId,
          cost: nextCost,
        })
      }
    }

    return regionDistanceToGoalByRegion
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

  private clearPreviewRoutingState() {
    this.state.portAssignment.fill(-1)
    this.state.regionSegments = Array.from(
      { length: this.topology.regionCount },
      () => [],
    )
    this.state.regionIntersectionCaches = Array.from(
      { length: this.topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )
    this.state.regionCongestionCost.fill(0)
    this.state.ripCount = 0
  }

  private computePlannedCenterlineCandidates() {
    const centerProblem: TinyHyperGraphProblem = {
      routeCount: 1,
      portSectionMask: Int8Array.from(
        this.problem.portSectionMask,
        (_value, portId) => (this.topology.portZ[portId] === 0 ? 1 : 0),
      ),
      routeMetadata: [this.problem.routeMetadata?.[this.centerRouteId]],
      routeStartPort: new Int32Array([
        this.problem.routeStartPort[this.centerRouteId]!,
      ]),
      routeEndPort: new Int32Array([
        this.problem.routeEndPort[this.centerRouteId]!,
      ]),
      routeNet: new Int32Array([this.problem.routeNet[this.centerRouteId]!]),
      regionNetId: this.problem.regionNetId,
    }

    const centerlineSolver = new TinyHyperGraphSolver(
      this.topology,
      centerProblem,
      {
        MAX_ITERATIONS: this.MAX_ITERATIONS,
      },
    )
    centerlineSolver.solve()

    if (!centerlineSolver.solved || centerlineSolver.failed) {
      throw new Error(
        centerlineSolver.error ??
          `Failed to precompute the z=0 centerline for ${this.getRouteConnectionId(this.centerRouteId)}`,
      )
    }

    const solvedRoutes = centerlineSolver.getOutput().solvedRoutes ?? []
    const plannedPath = solvedRoutes[0]?.path ?? []
    if (plannedPath.length === 0) {
      throw new Error(
        `Precomputed centerline for ${this.getRouteConnectionId(this.centerRouteId)} did not include a solved path`,
      )
    }

    const plannedCandidates: BusCenterCandidate[] = []
    let previousCandidate: BusCenterCandidate | undefined
    let cumulativeG = 0

    for (let pathIndex = 0; pathIndex < plannedPath.length; pathIndex++) {
      const pathNode = plannedPath[pathIndex]!
      const portId = this.portIndexBySerializedId.get(pathNode.portId)
      if (portId === undefined) {
        throw new Error(
          `Centerline path references unknown port "${pathNode.portId}"`,
        )
      }

      if (pathIndex > 0) {
        cumulativeG +=
          getPortDistance(
            this.topology,
            plannedCandidates[pathIndex - 1]!.portId,
            portId,
          ) * this.DISTANCE_TO_COST
      }

      const mappedNextRegionId =
        typeof pathNode.nextRegionId === "string"
          ? this.regionIndexBySerializedId.get(pathNode.nextRegionId)
          : undefined
      const atGoal = pathIndex === plannedPath.length - 1
      const h = atGoal ? 0 : this.computeCenterHeuristic(portId)
      const candidate: BusCenterCandidate = {
        portId,
        nextRegionId: atGoal
          ? (previousCandidate?.nextRegionId ?? this.centerGoalTransitRegionId)
          : (mappedNextRegionId ?? previousCandidate?.nextRegionId ?? -1),
        g: cumulativeG,
        h,
        f: atGoal ? cumulativeG : cumulativeG + h,
        atGoal,
        prevCandidate: previousCandidate,
        prevRegionId: previousCandidate?.nextRegionId,
      }

      previousCandidate = candidate
      plannedCandidates.push(candidate)
    }

    return plannedCandidates
  }

  private evaluateCandidate(
    candidate: BusCenterCandidate,
  ): BusPreview | undefined {
    this.clearPreviewRoutingState()
    this.state.currentRouteId = this.centerRouteId
    this.state.currentRouteNetId = this.centerRouteNetId
    this.state.goalPortId = this.problem.routeEndPort[this.centerRouteId]!

    const centerPath = this.getCenterCandidatePath(candidate)
    const boundarySteps = this.getBoundarySteps(centerPath)
    const boundaryPortIdsByStep = this.assignBoundaryPortsForPath(boundarySteps)

    if (candidate.atGoal === true) {
      const completeBusPreview = this.buildBestCompleteBusPreview(
        centerPath,
        boundarySteps,
        boundaryPortIdsByStep,
      )
      if (!completeBusPreview) {
        const { sameLayerIntersectionCount, crossingLayerIntersectionCount } =
          this.getPreviewIntersectionCounts()
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
        this.getPreviewIntersectionCounts()
      const totalRegionCost = this.getPreviewRegionCost()
      const totalIntersectionCount =
        sameLayerIntersectionCount + crossingLayerIntersectionCount
      return {
        tracePreviews: completeBusPreview.tracePreviews,
        totalLength: completeBusPreview.totalLength,
        totalCost:
          completeBusPreview.totalLength * this.DISTANCE_TO_COST +
          totalRegionCost,
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
          this.getPreviewIntersectionCounts()
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
          this.getPreviewIntersectionCounts()
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
      this.getPreviewIntersectionCounts()
    const totalRegionCost = this.getPreviewRegionCost()
    const totalIntersectionCount =
      sameLayerIntersectionCount + crossingLayerIntersectionCount
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

    if (!this.ensurePortOwnership(routeId, startPortId, localOwners)) {
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
      if (
        !this.ensurePortOwnership(routeId, nextCandidate.portId, localOwners)
      ) {
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

  private buildGreedyTracePreview(
    traceIndex: number,
    centerPath: BusCenterCandidate[],
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
    completeRoute: boolean,
  ): TracePreview | undefined {
    const routeId = this.busTraceOrder.traces[traceIndex]!.routeId
    const centerPortIds = centerPath.map(
      (pathCandidate) => pathCandidate.portId,
    )
    const targetGuideProgress = this.getPolylineLength(centerPortIds)
    const minTargetGuideProgress = Math.max(
      0,
      targetGuideProgress - this.BUS_TRACE_LENGTH_MARGIN,
    )
    const maxTargetGuideProgress =
      targetGuideProgress + this.BUS_TRACE_LENGTH_MARGIN
    const localOwners = new Map(usedPortOwners)
    const startState = this.createTraceStartState(routeId)
    if (
      !startState ||
      !this.ensurePortOwnership(routeId, startState.portId, localOwners)
    ) {
      return undefined
    }

    const segments: TraceSegment[] = []
    const visitedTraceStates = new Set([this.getTraceStateKey(startState)])
    const visitedTracePortIds = new Set<PortId>([startState.portId])
    let currentState = startState
    let currentGuideProgress = getPortProgressAlongPolyline(
      this.topology,
      currentState.portId,
      centerPortIds,
    )

    for (let stepIndex = 0; stepIndex < this.BUS_MAX_TRACE_STEPS; stepIndex++) {
      if (currentState.atGoal) {
        return {
          traceIndex,
          routeId,
          segments,
          complete: true,
          terminalPortId: currentState.portId,
        }
      }

      if (!completeRoute && currentGuideProgress >= minTargetGuideProgress) {
        return {
          traceIndex,
          routeId,
          segments,
          complete: false,
          terminalPortId: currentState.portId,
          terminalRegionId: currentState.nextRegionId,
        }
      }

      let bestMove: TraceInferenceMove | undefined
      let bestScore = Number.POSITIVE_INFINITY

      for (const move of this.getAvailableTraceMoves(currentState)) {
        const nextPortOwner = localOwners.get(move.nextState.portId)
        if (nextPortOwner !== undefined && nextPortOwner !== routeId) {
          continue
        }

        if (visitedTracePortIds.has(move.nextState.portId)) {
          continue
        }

        const nextStateKey = this.getTraceStateKey(move.nextState)
        if (visitedTraceStates.has(nextStateKey)) {
          continue
        }

        if (completeRoute && move.nextState.atGoal) {
          bestMove = move
          break
        }

        const goalCost = move.nextState.atGoal
          ? 0
          : this.problemSetup.portHCostToEndOfRoute[
              move.nextState.portId * this.problem.routeCount + routeId
            ]
        const guideDistance = getDistanceFromPortToPolyline(
          this.topology,
          move.nextState.portId,
          centerPortIds,
        )
        const nextGuideProgress = getPortProgressAlongPolyline(
          this.topology,
          move.nextState.portId,
          centerPortIds,
        )
        const sidePenalty = this.getTraceSidePenalty(
          traceIndex,
          move.nextState.portId,
        )
        const backwardPenalty =
          Math.max(0, currentGuideProgress - nextGuideProgress) * 3
        const stallPenalty =
          Math.max(
            0,
            currentGuideProgress + this.tracePitch * 0.5 - nextGuideProgress,
          ) * 2
        const progressPenalty = completeRoute
          ? Math.max(0, targetGuideProgress - nextGuideProgress) * 0.08
          : Math.max(0, minTargetGuideProgress - nextGuideProgress) * 0.24
        const overshootPenalty = completeRoute
          ? 0
          : Math.max(0, nextGuideProgress - maxTargetGuideProgress) * 4
        const score =
          guideDistance * 1.1 +
          goalCost * 0.45 +
          sidePenalty * this.BUS_REMAINDER_SIDE_WEIGHT +
          backwardPenalty +
          stallPenalty +
          progressPenalty +
          overshootPenalty

        if (
          !bestMove ||
          score < bestScore - BUS_CANDIDATE_EPSILON ||
          (Math.abs(score - bestScore) <= BUS_CANDIDATE_EPSILON &&
            move.nextState.portId < bestMove.nextState.portId)
        ) {
          bestMove = move
          bestScore = score
        }
      }

      if (!bestMove) {
        break
      }

      if (
        !this.ensurePortOwnership(
          routeId,
          bestMove.nextState.portId,
          localOwners,
        )
      ) {
        return undefined
      }

      if (currentState.portId !== bestMove.nextState.portId) {
        if (currentState.nextRegionId === undefined) {
          return undefined
        }

        segments.push({
          regionId: currentState.nextRegionId,
          fromPortId: currentState.portId,
          toPortId: bestMove.nextState.portId,
        })
      }

      currentState = bestMove.nextState
      currentGuideProgress = getPortProgressAlongPolyline(
        this.topology,
        currentState.portId,
        centerPortIds,
      )
      visitedTracePortIds.add(currentState.portId)
      visitedTraceStates.add(this.getTraceStateKey(currentState))
    }

    if (!completeRoute && currentGuideProgress >= minTargetGuideProgress) {
      return {
        traceIndex,
        routeId,
        segments,
        complete: false,
        terminalPortId: currentState.portId,
        terminalRegionId: currentState.nextRegionId,
      }
    }

    return undefined
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
    this.ensurePortOwnership(routeId, startPortId, localOwners)

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

      if (!this.ensurePortOwnership(routeId, boundaryPortId, localOwners)) {
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
    const centerPortIds = centerPath.map(
      (pathCandidate) => pathCandidate.portId,
    )
    const targetGuideProgress = this.getPolylineLength(centerPortIds)
    const minSharedStepCount = 0
    let bestPreview: TracePreview | undefined
    let bestScore = Number.POSITIVE_INFINITY
    let bestSharedStepCount = -1

    for (
      let sharedStepCount = maxSharedStepCount;
      sharedStepCount >= minSharedStepCount;
      sharedStepCount--
    ) {
      const prefixPreview = this.buildPrefixTracePreview(
        traceIndex,
        sharedStepCount,
        boundarySteps,
        boundaryPortIdsByStep,
        usedPortOwners,
      )
      if (!prefixPreview) {
        continue
      }

      const terminalGuideProgress = getPortProgressAlongPolyline(
        this.topology,
        prefixPreview.terminalPortId,
        centerPortIds,
      )
      const shortfallPenalty = Math.max(
        0,
        targetGuideProgress - terminalGuideProgress,
      )
      const overshootPenalty = Math.max(
        0,
        terminalGuideProgress - targetGuideProgress,
      )
      const lagPenalty =
        (maxSharedStepCount - sharedStepCount) * this.tracePitch
      const score = shortfallPenalty * 2 + overshootPenalty * 4 + lagPenalty

      if (
        !bestPreview ||
        score < bestScore - BUS_CANDIDATE_EPSILON ||
        (Math.abs(score - bestScore) <= BUS_CANDIDATE_EPSILON &&
          sharedStepCount > bestSharedStepCount)
      ) {
        bestPreview = {
          ...prefixPreview,
          previewCost: score,
        }
        bestScore = score
        bestSharedStepCount = sharedStepCount
      }
    }

    return bestPreview
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

    const routeId = this.busTraceOrder.traces[traceIndex]!.routeId
    const previewOptions: TracePreview[] = []

    for (
      let sharedStepCount = boundarySteps.length;
      sharedStepCount >= 0;
      sharedStepCount--
    ) {
      const prefixPreview = this.buildPrefixTracePreview(
        traceIndex,
        sharedStepCount,
        boundarySteps,
        boundaryPortIdsByStep,
        usedPortOwners,
      )
      if (!prefixPreview) {
        continue
      }

      const currentRegionId =
        sharedStepCount === 0
          ? this.getStartingNextRegionId(
              routeId,
              this.problem.routeStartPort[routeId]!,
            )
          : boundarySteps[sharedStepCount - 1]!.toRegionId
      const currentPortId =
        sharedStepCount === 0
          ? this.problem.routeStartPort[routeId]!
          : boundaryPortIdsByStep[sharedStepCount - 1]?.[traceIndex]

      if (currentRegionId === undefined || currentPortId === undefined) {
        continue
      }

      const remainderSegments = this.inferEndRemainderSegments(
        traceIndex,
        currentPortId,
        currentRegionId,
        centerPath,
        sharedStepCount,
        usedPortOwners,
      )
      if (!remainderSegments) {
        continue
      }

      previewOptions.push({
        traceIndex,
        routeId,
        segments: [...prefixPreview.segments, ...remainderSegments],
        complete: true,
        terminalPortId: this.problem.routeEndPort[routeId]!,
        previewCost: 0,
      })
    }

    return previewOptions
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
      const currentIntersectionCount =
        this.getPreviewIntersectionCounts().sameLayerIntersectionCount +
        this.getPreviewIntersectionCounts().crossingLayerIntersectionCount

      if (
        currentIntersectionCount > bestIntersectionCount ||
        (currentIntersectionCount === bestIntersectionCount &&
          tracePreviewsStack.reduce(
            (sum, preview) => sum + this.getTracePreviewLength(preview),
            0,
          ) >= bestTotalLength)
      ) {
        return
      }

      if (orderIndex >= this.commitTraceIndices.length) {
        const totalLength = tracePreviewsStack.reduce(
          (sum, preview) => sum + this.getTracePreviewLength(preview),
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
          const stateSnapshot = this.snapshotPreviewRoutingState()
          const ownerSnapshot = new Map(usedPortOwners)
          const traceLength = this.commitTracePreview(
            tracePreview,
            usedPortOwners,
          )
          const intersectionCount =
            this.getPreviewIntersectionCounts().sameLayerIntersectionCount +
            this.getPreviewIntersectionCounts().crossingLayerIntersectionCount
          this.restorePreviewRoutingState(stateSnapshot)
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
        const stateSnapshot = this.snapshotPreviewRoutingState()
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

        this.restorePreviewRoutingState(stateSnapshot)
        usedPortOwners.clear()
        for (const [portId, routeId] of ownerSnapshot) {
          usedPortOwners.set(portId, routeId)
        }

        if (bestIntersectionCount === 0) {
          return
        }
      }
    }

    this.clearPreviewRoutingState()
    search(0, new Map())

    if (!bestTracePreviews) {
      return undefined
    }

    this.clearPreviewRoutingState()
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

  private buildCompleteTracePreview(
    traceIndex: number,
    centerPath: BusCenterCandidate[],
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ): TracePreview | undefined {
    if (traceIndex === this.centerTraceIndex) {
      return this.buildCenterlineCompleteTracePreview(
        centerPath,
        boundarySteps,
        usedPortOwners,
      )
    }

    const maxSharedStepCount = boundarySteps.length
    const minSharedStepCount = 0
    let bestPreview: TracePreview | undefined
    let bestPreviewScore = Number.POSITIVE_INFINITY

    for (
      let sharedStepCount = maxSharedStepCount;
      sharedStepCount >= minSharedStepCount;
      sharedStepCount--
    ) {
      const prefixPreview = this.buildPrefixTracePreview(
        traceIndex,
        sharedStepCount,
        boundarySteps,
        boundaryPortIdsByStep,
        usedPortOwners,
      )
      if (!prefixPreview) {
        continue
      }

      const routeId = prefixPreview.routeId
      const currentRegionId =
        sharedStepCount === 0
          ? this.getStartingNextRegionId(
              routeId,
              this.problem.routeStartPort[routeId]!,
            )
          : boundarySteps[sharedStepCount - 1]!.toRegionId
      const currentPortId =
        sharedStepCount === 0
          ? this.problem.routeStartPort[routeId]!
          : boundaryPortIdsByStep[sharedStepCount - 1]![traceIndex]!

      if (currentRegionId === undefined) {
        continue
      }

      const localOwners = new Map(usedPortOwners)
      for (const segment of prefixPreview.segments) {
        if (
          !this.ensurePortOwnership(routeId, segment.fromPortId, localOwners) ||
          !this.ensurePortOwnership(routeId, segment.toPortId, localOwners)
        ) {
          return undefined
        }
      }

      const remainderSegments = this.inferEndRemainderSegments(
        traceIndex,
        currentPortId,
        currentRegionId,
        centerPath,
        sharedStepCount,
        localOwners,
      )
      if (!remainderSegments) {
        continue
      }

      const completePreview: TracePreview = {
        traceIndex,
        routeId,
        segments: [...prefixPreview.segments, ...remainderSegments],
        complete: true,
        terminalPortId: this.problem.routeEndPort[routeId]!,
        previewCost: 0,
      }
      const snapshot = this.snapshotPreviewRoutingState()
      const previewLength = this.commitTracePreview(
        completePreview,
        new Map(usedPortOwners),
      )
      const previewIntersections =
        this.getPreviewIntersectionCounts().sameLayerIntersectionCount +
        this.getPreviewIntersectionCounts().crossingLayerIntersectionCount
      const previewRegionCost = this.getPreviewRegionCost()
      this.restorePreviewRoutingState(snapshot)

      if (!Number.isFinite(previewLength)) {
        continue
      }

      const previewScore =
        previewIntersections * 1_000 + previewRegionCost + previewLength

      if (
        !bestPreview ||
        previewScore < bestPreviewScore - BUS_CANDIDATE_EPSILON ||
        (Math.abs(previewScore - bestPreviewScore) <= BUS_CANDIDATE_EPSILON &&
          completePreview.segments.length < bestPreview.segments.length)
      ) {
        bestPreview = completePreview
        bestPreviewScore = previewScore
      }
    }

    return bestPreview
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
      !this.ensurePortOwnership(routeId, startPortId, localOwners) ||
      !this.ensurePortOwnership(routeId, goalPortId, localOwners)
    ) {
      return undefined
    }

    const segments: TraceSegment[] = []
    let currentPortId = startPortId
    let currentRegionId = startRegionId

    for (const boundaryStep of boundarySteps) {
      if (
        !this.ensurePortOwnership(
          routeId,
          boundaryStep.centerPortId,
          localOwners,
        )
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

  private inferEndRemainderSegments(
    traceIndex: number,
    startPortId: PortId,
    startRegionId: RegionId,
    centerPath: BusCenterCandidate[],
    sharedStepCount: number,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ): TraceSegment[] | undefined {
    const routeId = this.busTraceOrder.traces[traceIndex]!.routeId
    const endPortId = this.problem.routeEndPort[routeId]!

    if (this.topology.portZ[endPortId] !== 0) {
      return undefined
    }

    if (this.isPortIncidentToRegion(endPortId, startRegionId)) {
      if (
        this.ensurePortOwnership(routeId, endPortId, new Map(usedPortOwners)) &&
        startPortId !== endPortId
      ) {
        return [
          {
            regionId: startRegionId,
            fromPortId: startPortId,
            toPortId: endPortId,
          },
        ]
      }

      return []
    }

    const guidePortIds = this.getGuidePortIds(centerPath, sharedStepCount)
    const goalTransitRegionIds =
      this.topology.incidentPortRegion[endPortId]?.filter(
        (regionId) => regionId !== undefined,
      ) ?? []
    const currentNetId = this.problem.routeNet[routeId]!
    const localOwners = new Map(usedPortOwners)
    if (!this.ensurePortOwnership(routeId, startPortId, localOwners)) {
      return undefined
    }

    const visitedStates = new Set([`${startPortId}:${startRegionId}`])
    const segments: TraceSegment[] = []
    let currentPortId = startPortId
    let currentRegionId = startRegionId

    for (
      let stepIndex = 0;
      stepIndex < this.BUS_MAX_REMAINDER_STEPS;
      stepIndex++
    ) {
      if (this.isPortIncidentToRegion(endPortId, currentRegionId)) {
        if (!this.ensurePortOwnership(routeId, endPortId, localOwners)) {
          return undefined
        }

        if (currentPortId !== endPortId) {
          segments.push({
            regionId: currentRegionId,
            fromPortId: currentPortId,
            toPortId: endPortId,
          })
        }

        return segments
      }

      let bestMove:
        | {
            boundaryPortId: PortId
            nextRegionId: RegionId
            score: number
          }
        | undefined

      for (const boundaryPortId of this.topology.regionIncidentPorts[
        currentRegionId
      ] ?? []) {
        if (
          boundaryPortId === currentPortId ||
          this.topology.portZ[boundaryPortId] !== 0
        ) {
          continue
        }

        const nextRegionId =
          this.topology.incidentPortRegion[boundaryPortId]?.[0] ===
          currentRegionId
            ? this.topology.incidentPortRegion[boundaryPortId]?.[1]
            : this.topology.incidentPortRegion[boundaryPortId]?.[0]

        if (
          nextRegionId === undefined ||
          this.isRegionReservedForDifferentBusNet(currentNetId, nextRegionId) ||
          visitedStates.has(`${boundaryPortId}:${nextRegionId}`)
        ) {
          continue
        }

        const owner = localOwners.get(boundaryPortId)
        if (owner !== undefined && owner !== routeId) {
          continue
        }

        const goalDistance = getPortDistance(
          this.topology,
          boundaryPortId,
          endPortId,
        )
        const guideDistance = getDistanceFromPortToPolyline(
          this.topology,
          boundaryPortId,
          guidePortIds,
        )
        const sidePenalty = this.getTraceSidePenalty(traceIndex, boundaryPortId)
        const goalRegionBonus = goalTransitRegionIds.includes(nextRegionId)
          ? -5
          : 0
        const score =
          guideDistance * this.BUS_REMAINDER_GUIDE_WEIGHT +
          goalDistance * this.BUS_REMAINDER_GOAL_WEIGHT +
          sidePenalty * this.BUS_REMAINDER_SIDE_WEIGHT +
          goalRegionBonus

        if (
          !bestMove ||
          score < bestMove.score - BUS_CANDIDATE_EPSILON ||
          (Math.abs(score - bestMove.score) <= BUS_CANDIDATE_EPSILON &&
            boundaryPortId < bestMove.boundaryPortId)
        ) {
          bestMove = {
            boundaryPortId,
            nextRegionId,
            score,
          }
        }
      }

      if (!bestMove) {
        return undefined
      }

      if (
        !this.ensurePortOwnership(routeId, bestMove.boundaryPortId, localOwners)
      ) {
        return undefined
      }

      segments.push({
        regionId: currentRegionId,
        fromPortId: currentPortId,
        toPortId: bestMove.boundaryPortId,
      })
      currentPortId = bestMove.boundaryPortId
      currentRegionId = bestMove.nextRegionId
      visitedStates.add(`${currentPortId}:${currentRegionId}`)
    }

    return undefined
  }

  private createBoundaryStep(
    fromRegionId: RegionId,
    toRegionId: RegionId,
    centerPortId: PortId,
    referencePortId: PortId,
    previousNormal?:
      | {
          x: number
          y: number
        }
      | undefined,
  ): BoundaryStep {
    const { x, y } = this.computeBoundaryNormal(
      referencePortId,
      centerPortId,
      fromRegionId,
      toRegionId,
      previousNormal,
    )

    return {
      fromRegionId,
      toRegionId,
      centerPortId,
      normalX: x,
      normalY: y,
    }
  }

  private computeBoundaryNormal(
    fromPortId: PortId,
    toPortId: PortId,
    fromRegionId: RegionId,
    toRegionId: RegionId,
    previousNormal?:
      | {
          x: number
          y: number
        }
      | undefined,
  ) {
    let tangentX =
      this.topology.portX[toPortId] - this.topology.portX[fromPortId]
    let tangentY =
      this.topology.portY[toPortId] - this.topology.portY[fromPortId]
    let tangentLength = Math.hypot(tangentX, tangentY)

    if (tangentLength <= BUS_CANDIDATE_EPSILON) {
      tangentX =
        this.topology.regionCenterX[toRegionId] -
        this.topology.regionCenterX[fromRegionId]
      tangentY =
        this.topology.regionCenterY[toRegionId] -
        this.topology.regionCenterY[fromRegionId]
      tangentLength = Math.hypot(tangentX, tangentY)
    }

    if (tangentLength <= BUS_CANDIDATE_EPSILON) {
      const fallbackNormal = previousNormal ?? {
        x: this.busTraceOrder.normalX,
        y: this.busTraceOrder.normalY,
      }
      return {
        x: fallbackNormal.x,
        y: fallbackNormal.y,
      }
    }

    tangentX /= tangentLength
    tangentY /= tangentLength

    let normalX = -tangentY
    let normalY = tangentX
    const referenceNormal = previousNormal ?? {
      x: this.busTraceOrder.normalX,
      y: this.busTraceOrder.normalY,
    }

    if (
      normalX * referenceNormal.x + normalY * referenceNormal.y <
      -BUS_CANDIDATE_EPSILON
    ) {
      normalX *= -1
      normalY *= -1
    }

    return {
      x: normalX,
      y: normalY,
    }
  }

  private getOrderedSharedPortsForBoundaryStep(boundaryStep: BoundaryStep) {
    const regionPairKey = getRegionPairKey(
      boundaryStep.fromRegionId,
      boundaryStep.toRegionId,
    )
    const sharedPortIds = this.sharedZ0PortsByRegionPair.get(regionPairKey)

    if (!sharedPortIds) {
      return undefined
    }

    return [...sharedPortIds].sort((leftPortId, rightPortId) => {
      const leftProjection = getPortProjection(
        this.topology,
        leftPortId,
        boundaryStep.normalX,
        boundaryStep.normalY,
      )
      const rightProjection = getPortProjection(
        this.topology,
        rightPortId,
        boundaryStep.normalX,
        boundaryStep.normalY,
      )

      return leftProjection - rightProjection || leftPortId - rightPortId
    })
  }

  private getPreferredCenterPortOptionsForBoundaryStep(
    boundaryStep: BoundaryStep,
  ) {
    const orderedSharedPortIds =
      this.getOrderedSharedPortsForBoundaryStep(boundaryStep)

    if (!orderedSharedPortIds || orderedSharedPortIds.length === 0) {
      return []
    }

    const midpointIndex = (orderedSharedPortIds.length - 1) / 2

    return orderedSharedPortIds
      .map((portId, index) => ({
        portId,
        index,
      }))
      .sort(
        (left, right) =>
          Math.abs(left.index - midpointIndex) -
            Math.abs(right.index - midpointIndex) || left.portId - right.portId,
      )
      .slice(0, this.CENTER_PORT_OPTIONS_PER_EDGE)
      .map(({ portId }) => portId)
  }

  private buildBoundaryPortAssignmentsFromOrderedPorts(
    orderedPortIds: readonly PortId[],
    centerPortId: PortId,
  ) {
    if (!orderedPortIds.includes(centerPortId)) {
      return undefined
    }

    const centerIndex = orderedPortIds.indexOf(centerPortId)
    const tracesBeforeCenter = this.centerTraceIndex
    const tracesAfterCenter =
      this.problem.routeCount - this.centerTraceIndex - 1

    if (
      centerIndex < tracesBeforeCenter ||
      orderedPortIds.length - centerIndex - 1 < tracesAfterCenter
    ) {
      return undefined
    }

    const assignments = new Array<PortId>(this.problem.routeCount)

    for (
      let traceIndex = 0;
      traceIndex < this.problem.routeCount;
      traceIndex++
    ) {
      const offsetFromCenter = traceIndex - this.centerTraceIndex
      const assignedPortId = orderedPortIds[centerIndex + offsetFromCenter]

      if (assignedPortId === undefined) {
        return undefined
      }

      assignments[traceIndex] = assignedPortId
    }

    return assignments
  }

  private countLocalBoundaryAssignmentIntersections(
    previousPortIds: readonly PortId[],
    nextPortIds: readonly PortId[],
  ) {
    let intersectionCount = 0

    for (let leftIndex = 0; leftIndex < previousPortIds.length; leftIndex++) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < previousPortIds.length;
        rightIndex++
      ) {
        if (
          this.doPortSegmentsIntersect(
            previousPortIds[leftIndex]!,
            nextPortIds[leftIndex]!,
            previousPortIds[rightIndex]!,
            nextPortIds[rightIndex]!,
          )
        ) {
          intersectionCount += 1
        }
      }
    }

    return intersectionCount
  }

  private doPortSegmentsIntersect(
    aFromPortId: PortId,
    aToPortId: PortId,
    bFromPortId: PortId,
    bToPortId: PortId,
  ) {
    if (
      aFromPortId === bFromPortId ||
      aFromPortId === bToPortId ||
      aToPortId === bFromPortId ||
      aToPortId === bToPortId
    ) {
      return false
    }

    const ax = this.topology.portX[aFromPortId]
    const ay = this.topology.portY[aFromPortId]
    const bx = this.topology.portX[aToPortId]
    const by = this.topology.portY[aToPortId]
    const cx = this.topology.portX[bFromPortId]
    const cy = this.topology.portY[bFromPortId]
    const dx = this.topology.portX[bToPortId]
    const dy = this.topology.portY[bToPortId]

    const orientation = (
      px: number,
      py: number,
      qx: number,
      qy: number,
      rx: number,
      ry: number,
    ) => (qx - px) * (ry - py) - (qy - py) * (rx - px)

    const aToC = orientation(ax, ay, bx, by, cx, cy)
    const aToD = orientation(ax, ay, bx, by, dx, dy)
    const bToA = orientation(cx, cy, dx, dy, ax, ay)
    const bToB = orientation(cx, cy, dx, dy, bx, by)

    if (
      Math.abs(aToC) <= BUS_CANDIDATE_EPSILON ||
      Math.abs(aToD) <= BUS_CANDIDATE_EPSILON ||
      Math.abs(bToA) <= BUS_CANDIDATE_EPSILON ||
      Math.abs(bToB) <= BUS_CANDIDATE_EPSILON
    ) {
      return false
    }

    return aToC > 0 !== aToD > 0 && bToA > 0 !== bToB > 0
  }

  private getBoundaryAssignmentLength(
    previousPortIds: readonly PortId[],
    nextPortIds: readonly PortId[],
  ) {
    let totalLength = 0

    for (
      let traceIndex = 0;
      traceIndex < previousPortIds.length;
      traceIndex++
    ) {
      totalLength += getPortDistance(
        this.topology,
        previousPortIds[traceIndex]!,
        nextPortIds[traceIndex]!,
      )
    }

    return totalLength
  }

  private assignBoundaryPortsForPath(boundarySteps: readonly BoundaryStep[]) {
    const boundaryPortIdsByStep: Array<PortId[] | undefined> = []
    let previousPortIds = this.busTraceOrder.traces.map(
      (trace) => this.problem.routeStartPort[trace.routeId]!,
    )

    for (const boundaryStep of boundarySteps) {
      const assignments = this.assignBoundaryPortsForStep(
        boundaryStep,
        previousPortIds,
      )
      boundaryPortIdsByStep.push(assignments)

      if (!assignments) {
        for (
          let remainingIndex = boundaryPortIdsByStep.length;
          remainingIndex < boundarySteps.length;
          remainingIndex++
        ) {
          boundaryPortIdsByStep.push(undefined)
        }
        break
      }

      previousPortIds = assignments
    }

    return boundaryPortIdsByStep
  }

  private assignBoundaryPortsForStep(
    boundaryStep: BoundaryStep,
    previousPortIds?: readonly PortId[],
  ): PortId[] | undefined {
    const sharedPortIds =
      this.getOrderedSharedPortsForBoundaryStep(boundaryStep)

    if (!sharedPortIds) {
      return undefined
    }

    const candidateAssignments = [
      this.buildBoundaryPortAssignmentsFromOrderedPorts(
        sharedPortIds,
        boundaryStep.centerPortId,
      ),
      this.buildBoundaryPortAssignmentsFromOrderedPorts(
        [...sharedPortIds].reverse(),
        boundaryStep.centerPortId,
      ),
    ].filter(
      (
        assignments,
        assignmentIndex,
        assignmentsList,
      ): assignments is PortId[] =>
        assignments !== undefined &&
        assignmentsList.findIndex(
          (candidate) =>
            candidate?.every(
              (portId, traceIndex) => portId === assignments[traceIndex],
            ) ?? false,
        ) === assignmentIndex,
    )

    if (candidateAssignments.length === 0) {
      return undefined
    }

    if (!previousPortIds) {
      return candidateAssignments[0]
    }

    return candidateAssignments
      .map((assignments) => ({
        assignments,
        intersectionCount: this.countLocalBoundaryAssignmentIntersections(
          previousPortIds,
          assignments,
        ),
        totalLength: this.getBoundaryAssignmentLength(
          previousPortIds,
          assignments,
        ),
      }))
      .sort(
        (left, right) =>
          left.intersectionCount - right.intersectionCount ||
          left.totalLength - right.totalLength,
      )[0]?.assignments
  }

  private getBoundarySteps(centerPath: BusCenterCandidate[]) {
    const boundarySteps: BoundaryStep[] = []
    let currentRegionId = centerPath[0]?.nextRegionId
    let previousNormal:
      | {
          x: number
          y: number
        }
      | undefined

    if (currentRegionId === undefined) {
      return boundarySteps
    }

    for (let pathIndex = 1; pathIndex < centerPath.length; pathIndex++) {
      const nextCandidate = centerPath[pathIndex]!

      if (nextCandidate.atGoal) {
        break
      }

      const previousPortId =
        centerPath[pathIndex - 1]?.portId ?? nextCandidate.portId
      const nextPortId =
        centerPath[pathIndex + 1]?.portId ?? nextCandidate.portId
      const boundaryNormal = this.computeBoundaryNormal(
        previousPortId,
        nextPortId,
        currentRegionId,
        nextCandidate.nextRegionId,
        previousNormal,
      )

      boundarySteps.push({
        fromRegionId: currentRegionId,
        toRegionId: nextCandidate.nextRegionId,
        centerPortId: nextCandidate.portId,
        normalX: boundaryNormal.x,
        normalY: boundaryNormal.y,
      })
      previousNormal = boundaryNormal
      currentRegionId = nextCandidate.nextRegionId
    }

    return boundarySteps
  }

  private getCenterCandidatePath(candidate: BusCenterCandidate) {
    const path: BusCenterCandidate[] = []
    let cursor: BusCenterCandidate | undefined = candidate

    while (cursor) {
      path.unshift(cursor)
      cursor = cursor.prevCandidate as BusCenterCandidate | undefined
    }

    return path
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

      const previousNormal =
        currentCandidate.boundaryNormalX !== undefined &&
        currentCandidate.boundaryNormalY !== undefined
          ? {
              x: currentCandidate.boundaryNormalX,
              y: currentCandidate.boundaryNormalY,
            }
          : undefined
      const boundaryStep = this.createBoundaryStep(
        currentCandidate.nextRegionId,
        nextRegionId,
        neighborPortId,
        currentCandidate.portId,
        previousNormal,
      )
      const boundarySupportPenalty =
        this.getBoundarySupportPenalty(boundaryStep)
      const g =
        parentCost +
        segmentLength * this.DISTANCE_TO_COST * this.problem.routeCount +
        boundarySupportPenalty

      const centerPortOptions =
        this.getPreferredCenterPortOptionsForBoundaryStep(boundaryStep)
      if (!centerPortOptions || !centerPortOptions.includes(neighborPortId)) {
        continue
      }

      if (
        this.centerCandidatePathContainsHop(
          currentCandidate,
          neighborPortId,
          nextRegionId,
        )
      ) {
        continue
      }

      if (
        this.centerCandidatePathContainsRegion(currentCandidate, nextRegionId)
      ) {
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
        !this.ensurePortOwnership(
          tracePreview.routeId,
          segment.fromPortId,
          usedPortOwners,
        ) ||
        !this.ensurePortOwnership(
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

  private getPreviewRegionCost() {
    let totalCost = 0

    for (const regionCache of this.state.regionIntersectionCaches) {
      totalCost += regionCache.existingRegionCost
    }

    return totalCost
  }

  private getPreviewIntersectionCounts() {
    let sameLayerIntersectionCount = 0
    let crossingLayerIntersectionCount = 0

    for (const regionCache of this.state.regionIntersectionCaches) {
      sameLayerIntersectionCount += regionCache.existingSameLayerIntersections
      crossingLayerIntersectionCount +=
        regionCache.existingCrossingLayerIntersections
    }

    return {
      sameLayerIntersectionCount,
      crossingLayerIntersectionCount,
    }
  }

  private snapshotPreviewRoutingState(): PreviewRoutingStateSnapshot {
    return {
      portAssignment: new Int32Array(this.state.portAssignment),
      regionSegments: this.state.regionSegments.map((segments) =>
        segments.map((segment) => [...segment] as [RouteId, PortId, PortId]),
      ),
      regionIntersectionCaches: this.state.regionIntersectionCaches.map(
        (cache) => ({
          netIds: new Int32Array(cache.netIds),
          lesserAngles: new Int32Array(cache.lesserAngles),
          greaterAngles: new Int32Array(cache.greaterAngles),
          layerMasks: new Int32Array(cache.layerMasks),
          existingCrossingLayerIntersections:
            cache.existingCrossingLayerIntersections,
          existingSameLayerIntersections: cache.existingSameLayerIntersections,
          existingEntryExitLayerChanges: cache.existingEntryExitLayerChanges,
          existingRegionCost: cache.existingRegionCost,
          existingSegmentCount: cache.existingSegmentCount,
        }),
      ),
    }
  }

  private restorePreviewRoutingState(snapshot: PreviewRoutingStateSnapshot) {
    this.state.portAssignment = new Int32Array(snapshot.portAssignment)
    this.state.regionSegments = snapshot.regionSegments.map((segments) =>
      segments.map((segment) => [...segment] as [RouteId, PortId, PortId]),
    )
    this.state.regionIntersectionCaches = snapshot.regionIntersectionCaches.map(
      (cache) => ({
        netIds: new Int32Array(cache.netIds),
        lesserAngles: new Int32Array(cache.lesserAngles),
        greaterAngles: new Int32Array(cache.greaterAngles),
        layerMasks: new Int32Array(cache.layerMasks),
        existingCrossingLayerIntersections:
          cache.existingCrossingLayerIntersections,
        existingSameLayerIntersections: cache.existingSameLayerIntersections,
        existingEntryExitLayerChanges: cache.existingEntryExitLayerChanges,
        existingRegionCost: cache.existingRegionCost,
        existingSegmentCount: cache.existingSegmentCount,
      }),
    )
  }

  private getGuidePortIds(
    centerPath: BusCenterCandidate[],
    sharedStepCount: number,
  ) {
    const guidePortIds = centerPath.map((pathCandidate) => pathCandidate.portId)
    const startIndex = Math.min(
      sharedStepCount,
      Math.max(guidePortIds.length - 1, 0),
    )
    return guidePortIds.slice(startIndex)
  }

  private getTracePreviewLength(tracePreview: TracePreview) {
    return tracePreview.segments.reduce((sum, segment) => {
      return (
        sum +
        getPortDistance(this.topology, segment.fromPortId, segment.toPortId)
      )
    }, 0)
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

  private computeCenterHeuristic(portId: PortId, nextRegionId?: RegionId) {
    const portHeuristic =
      this.problemSetup.portHCostToEndOfRoute[
        portId * this.problem.routeCount + this.centerRouteId
      ]

    if (nextRegionId === undefined) {
      return portHeuristic
    }

    const regionHeuristic = this.regionDistanceToGoalByRegion[nextRegionId]
    if (!Number.isFinite(regionHeuristic)) {
      return portHeuristic
    }

    return Math.max(portHeuristic, regionHeuristic * this.DISTANCE_TO_COST)
  }

  private createTraceStartState(
    routeId: RouteId,
  ): TraceInferenceState | undefined {
    const startPortId = this.problem.routeStartPort[routeId]!
    const goalPortId = this.problem.routeEndPort[routeId]!
    const startNextRegionId = this.getStartingNextRegionId(routeId, startPortId)

    if (startPortId === goalPortId) {
      return {
        routeId,
        portId: startPortId,
        atGoal: true,
      }
    }

    if (
      startNextRegionId === undefined ||
      this.topology.portZ[startPortId] !== 0
    ) {
      return undefined
    }

    return {
      routeId,
      portId: startPortId,
      nextRegionId: startNextRegionId,
      atGoal: false,
    }
  }

  private getAvailableTraceMoves(traceState: TraceInferenceState) {
    if (traceState.atGoal || traceState.nextRegionId === undefined) {
      return [] as TraceInferenceMove[]
    }

    const routeId = traceState.routeId
    const goalPortId = this.problem.routeEndPort[routeId]!
    const currentNetId = this.problem.routeNet[routeId]!
    const currentRegionId = traceState.nextRegionId
    const moves: TraceInferenceMove[] = []

    for (const neighborPortId of this.topology.regionIncidentPorts[
      currentRegionId
    ] ?? []) {
      if (
        neighborPortId === traceState.portId ||
        this.problem.portSectionMask[neighborPortId] === 0 ||
        this.topology.portZ[neighborPortId] !== 0 ||
        this.isPortReservedForDifferentBusNet(currentNetId, neighborPortId)
      ) {
        continue
      }

      const segmentLength = getPortDistance(
        this.topology,
        traceState.portId,
        neighborPortId,
      )

      if (neighborPortId === goalPortId) {
        moves.push({
          nextState: {
            routeId,
            portId: goalPortId,
            atGoal: true,
          },
          segmentLength,
        })
        continue
      }

      const nextRegionId =
        this.topology.incidentPortRegion[neighborPortId]?.[0] ===
        currentRegionId
          ? this.topology.incidentPortRegion[neighborPortId]?.[1]
          : this.topology.incidentPortRegion[neighborPortId]?.[0]

      if (
        nextRegionId === undefined ||
        this.isRegionReservedForDifferentBusNet(currentNetId, nextRegionId)
      ) {
        continue
      }

      moves.push({
        nextState: {
          routeId,
          portId: neighborPortId,
          nextRegionId,
          atGoal: false,
        },
        segmentLength,
      })
    }

    return moves
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

  private getTraceStateKey(traceState: TraceInferenceState) {
    return [
      traceState.routeId,
      traceState.portId,
      traceState.nextRegionId ?? -1,
      traceState.atGoal ? 1 : 0,
    ].join(":")
  }

  private centerCandidatePathContainsHop(
    candidate: BusCenterCandidate,
    portId: PortId,
    nextRegionId: RegionId,
  ) {
    let cursor: BusCenterCandidate | undefined = candidate

    while (cursor) {
      if (cursor.portId === portId && cursor.nextRegionId === nextRegionId) {
        return true
      }

      cursor = cursor.prevCandidate as BusCenterCandidate | undefined
    }

    return false
  }

  private centerCandidatePathContainsRegion(
    candidate: BusCenterCandidate,
    regionId: RegionId,
  ) {
    let cursor: BusCenterCandidate | undefined = candidate

    while (cursor) {
      if (cursor.nextRegionId === regionId) {
        return true
      }

      cursor = cursor.prevCandidate as BusCenterCandidate | undefined
    }

    return false
  }

  private getPolylineLength(polylinePortIds: readonly PortId[]) {
    let totalLength = 0

    for (let portIndex = 1; portIndex < polylinePortIds.length; portIndex++) {
      totalLength += getPortDistance(
        this.topology,
        polylinePortIds[portIndex - 1]!,
        polylinePortIds[portIndex]!,
      )
    }

    return totalLength
  }

  private isRegionReservedForDifferentBusNet(
    currentNetId: NetId,
    regionId: RegionId,
  ) {
    const reservedNetId = this.problem.regionNetId[regionId]
    return reservedNetId !== -1 && reservedNetId !== currentNetId
  }

  private isPortIncidentToRegion(portId: PortId, regionId: RegionId) {
    return this.topology.incidentPortRegion[portId]?.includes(regionId) ?? false
  }

  private ensurePortOwnership(
    routeId: RouteId,
    portId: PortId,
    usedPortOwners: Map<PortId, RouteId>,
  ) {
    const owner = usedPortOwners.get(portId)
    if (owner !== undefined && owner !== routeId) {
      return false
    }

    usedPortOwners.set(portId, routeId)
    return true
  }

  private getRouteConnectionId(routeId: RouteId) {
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

  private describeBoundaryStep(boundaryStep: BoundaryStep) {
    return `${boundaryStep.fromRegionId}->${boundaryStep.toRegionId}`
  }

  private canSupportBoundaryStep(boundaryStep: BoundaryStep) {
    const cacheKey = [
      boundaryStep.fromRegionId,
      boundaryStep.toRegionId,
      boundaryStep.centerPortId,
      Math.round(boundaryStep.normalX * 1_000_000),
      Math.round(boundaryStep.normalY * 1_000_000),
    ].join(":")
    const cached = this.boundarySupportCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    const supported =
      this.assignBoundaryPortsForStep(boundaryStep) !== undefined
    this.boundarySupportCache.set(cacheKey, supported)
    return supported
  }

  private getBoundarySupportPenalty(boundaryStep: BoundaryStep) {
    const sharedPortIds =
      this.getOrderedSharedPortsForBoundaryStep(boundaryStep)

    if (!sharedPortIds) {
      return this.problem.routeCount * 20
    }

    const centerIndex = sharedPortIds.indexOf(boundaryStep.centerPortId)
    if (centerIndex === -1) {
      return this.problem.routeCount * 20
    }

    const supportedBefore = Math.min(centerIndex, this.centerTraceIndex)
    const supportedAfter = Math.min(
      sharedPortIds.length - centerIndex - 1,
      this.problem.routeCount - this.centerTraceIndex - 1,
    )
    const supportedTraceCount = 1 + supportedBefore + supportedAfter
    const unsupportedTraceCount = this.problem.routeCount - supportedTraceCount

    return unsupportedTraceCount * 20
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
