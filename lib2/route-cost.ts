import type { Candidate } from "./domain"
import type { NetId, PortId } from "./types"
import type { MutableRegionCache, RegionCostFn } from "./region-cache"
import type { SegmentGeometry } from "./segment-geometry"

/** Input needed to score one possible route step. */
export type RouteCostInput = {
  readonly currentCandidate: Candidate
  readonly neighborPortId: PortId
  readonly routeNetId: NetId
  readonly regionCache: MutableRegionCache
  readonly regionCongestionCost: number
  readonly portPenalty: number
  readonly segmentGeometry: SegmentGeometry
  readonly isKnownSingleLayerRegion: boolean
  readonly computeRegionCost: RegionCostFn
}

/**
 * Compute the A* `g` score for moving from the current candidate to a port.
 *
 * @param input - Route step cost input.
 * @returns The next `g` score, or infinity when the step is impossible.
 */
export function computeRouteG(input: RouteCostInput): number {
  const delta = input.regionCache.countDelta(
    input.routeNetId,
    input.segmentGeometry,
  )

  if (delta.sameLayerIntersections > 0 && input.isKnownSingleLayerRegion) {
    return Number.POSITIVE_INFINITY
  }

  return (
    input.currentCandidate.g +
    input.regionCache.getAddedCost(delta, input.computeRegionCost) +
    input.regionCongestionCost +
    input.portPenalty
  )
}
