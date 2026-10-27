import type { Candidate } from "../core"
import { setNewIntersectionCounts } from "../countNewIntersections"
import { DistanceAwareTinyHyperGraphSolver } from "../distance-aware-tiny-hypergraph-solver"
import type { RegionIntersectionCache } from "../types"

type RegionScores = {
  cache: RegionIntersectionCache
  costs: Float64Array
  net: number
  owned: boolean
}

/** Lazy transition costs belong to a worker's immutable region snapshot. */
export class CachedRouteSearchSolver extends DistanceAwareTinyHyperGraphSolver {
  private readonly scores: Array<RegionScores | undefined> = []
  private localIndices?: Int32Array

  override computeG(
    candidate: Candidate,
    neighbor: number,
    maximumCost = Number.POSITIVE_INFINITY,
    knownSegmentDistance?: number,
  ): number {
    const { state, topology } = this
    const region = candidate.nextRegionId
    const cache = state.regionIntersectionCaches[region]!
    const count = topology.regionIncidentPorts[region]!.length
    if (cache.existingSegmentCount === 0 || count > 128)
      return super.computeG(
        candidate,
        neighbor,
        maximumCost,
        knownSegmentDistance,
      )

    let scores = this.scores[region]
    const net = state.currentRouteNetId!
    if (!scores || scores.cache !== cache) {
      scores = {
        cache,
        costs: new Float64Array(count * count).fill(Number.NaN),
        net,
        owned: cache.netIds.includes(net),
      }
      this.scores[region] = scores
    } else if (scores.net !== net) {
      scores.net = net
      scores.owned = cache.netIds.includes(net)
    }
    // Intersections skip a route's own net; only foreign-net costs are shared.
    if (scores.owned)
      return super.computeG(
        candidate,
        neighbor,
        maximumCost,
        knownSegmentDistance,
      )

    const congestion = state.regionCongestionCost[region]!
    const penalty = this.problem.portPenalty?.[neighbor] ?? 0
    let distanceCost = 0
    if (this.ADD_SEGMENT_DISTANCE_TO_G) {
      let distance = knownSegmentDistance
      if (distance === undefined) {
        const dx = topology.portX[candidate.portId]! - topology.portX[neighbor]!
        const dy = topology.portY[candidate.portId]! - topology.portY[neighbor]!
        distance = Math.sqrt(dx * dx + dy * dy)
      }
      distanceCost = distance * this.DISTANCE_TO_COST
    }
    const lower = candidate.g + congestion + penalty + distanceCost
    if (lower > maximumCost + 1e-9) return Number.POSITIVE_INFINITY

    if (!this.localIndices) {
      const stride = topology.incidentPortRegion.reduce(
        (max, regions) => Math.max(max, regions.length),
        1,
      )
      this.localIndices = new Int32Array(topology.portCount * stride).fill(-1)
      for (let r = 0; r < topology.regionCount; r++) {
        const ports = topology.regionIncidentPorts[r]!
        for (let i = 0; i < ports.length; i++)
          this.localIndices[this.getHopId(ports[i]!, r)] = i
      }
    }
    const from = this.localIndices[this.getHopId(candidate.portId, region)]!
    const to = this.localIndices[this.getHopId(neighbor, region)]!
    if (from < 0 || to < 0)
      throw new Error("Transition port is outside its region")
    const index = from * count + to
    let marginal = scores.costs[index]!
    if (Number.isNaN(marginal)) {
      const geometry = this.populateSegmentGeometryScratch(
        region,
        candidate.portId,
        neighbor,
      )
      setNewIntersectionCounts(cache, geometry)
      if (
        geometry.sameLayerIntersectionCount > 0 &&
        this.isKnownSingleLayerRegion(region)
      )
        marginal = Number.POSITIVE_INFINITY
      else
        marginal =
          this.computeRegionCostForRegion(
            region,
            cache.existingSameLayerIntersections +
              geometry.sameLayerIntersectionCount,
            cache.existingCrossingLayerIntersections +
              geometry.crossingLayerIntersectionCount,
            cache.existingEntryExitLayerChanges +
              geometry.entryExitLayerChanges,
            cache.existingSegmentCount + 1,
          ) - cache.existingRegionCost
      scores.costs[index] = marginal
      // Both intersection counts and via transitions are symmetric.
      scores.costs[to * count + from] = marginal
    }
    return candidate.g + marginal + congestion + penalty + distanceCost
  }
}
