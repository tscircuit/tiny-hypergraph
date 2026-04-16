import type { Candidate, TinyHyperGraphSolverOptions } from "../core"
import type { NetId, PortId, RegionId, RouteId } from "../types"
import type { RegionIntersectionCache } from "../types"
import type { BusTraceOrder } from "./deriveBusTraceOrder"

export interface TinyHyperGraphBusSolverOptions
  extends TinyHyperGraphSolverOptions {
  BUS_END_MARGIN_STEPS?: number
  BUS_MAX_REMAINDER_STEPS?: number
  BUS_REMAINDER_GUIDE_WEIGHT?: number
  BUS_REMAINDER_GOAL_WEIGHT?: number
  BUS_REMAINDER_SIDE_WEIGHT?: number
  CENTER_GREEDY_HEURISTIC_MULTIPLIER?: number
  CENTER_PORT_OPTIONS_PER_EDGE?: number
  QUEUE_ALL_CANDIDATES?: boolean
  VISUALIZE_UNASSIGNED_PORTS?: boolean
}

export interface BusCenterCandidate extends Candidate {
  atGoal?: boolean
  busCost?: number
  boundaryNormalX?: number
  boundaryNormalY?: number
}

export interface BoundaryStep {
  fromRegionId: RegionId
  toRegionId: RegionId
  centerPortId: PortId
  normalX: number
  normalY: number
}

export interface TraceSegment {
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

export interface TracePreview {
  traceIndex: number
  routeId: RouteId
  segments: TraceSegment[]
  complete: boolean
  terminalPortId: PortId
  terminalRegionId?: RegionId
  previewCost?: number
}

export interface BusPreview {
  tracePreviews: TracePreview[]
  totalLength: number
  totalCost: number
  completeTraceCount: number
  sameLayerIntersectionCount: number
  crossingLayerIntersectionCount: number
  reason?: string
}

export interface PreviewRoutingStateSnapshot {
  portAssignment: Int32Array
  regionSegments: Array<[RouteId, PortId, PortId][]>
  regionIntersectionCaches: RegionIntersectionCache[]
}

export const BUS_CANDIDATE_EPSILON = 1e-9

export const compareBusCandidatesByF = (left: Candidate, right: Candidate) =>
  left.f - right.f || left.h - right.h || left.g - right.g

export const getRegionPairKey = (regionAId: RegionId, regionBId: RegionId) =>
  regionAId < regionBId
    ? `${regionAId}:${regionBId}`
    : `${regionBId}:${regionAId}`

export const computeMedianTracePitch = (busTraceOrder: BusTraceOrder) => {
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
