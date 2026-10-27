import type { Candidate } from "../core"
import { setNewIntersectionCounts } from "../countNewIntersections"
import { DistanceAwareTinyHyperGraphSolver } from "../distance-aware-tiny-hypergraph-solver"
import type { RegionIntersectionCache } from "../types"
import {
  publishTransitionScore,
  readTransitionRecord,
  type SharedTransitionScores,
} from "./SharedTransitionScores"

/** Original arithmetic, sharing only foreign-net region transition costs. */
export class SharedScoreSearchSolver extends DistanceAwareTinyHyperGraphSolver {
  transitionScores?: SharedTransitionScores
  regionVersions?: Int32Array
  scoreWorkerIndex = 0
  sharedScoreHits = 0
  crossWorkerScoreHits = 0
  sharedScoreMisses = 0
  private readonly caches: Array<RegionIntersectionCache | undefined> = []
  private readonly nets = new Int32Array(this.topology.regionCount)
  private readonly owned = new Uint8Array(this.topology.regionCount)

  override computeG(
    candidate: Candidate,
    neighbor: number,
    maximumCost = Infinity,
    knownSegmentDistance?: number,
  ): number {
    const { state, topology } = this
    const region = candidate.nextRegionId
    const cache = state.regionIntersectionCaches[region]!
    const scores = this.transitionScores
    if (
      !scores ||
      !this.regionVersions ||
      scores.offsets[region]! < 0 ||
      cache.existingSegmentCount === 0 ||
      !Number.isFinite(cache.existingRegionCost)
    )
      return super.computeG(
        candidate,
        neighbor,
        maximumCost,
        knownSegmentDistance,
      )
    const net = state.currentRouteNetId!
    if (this.caches[region] !== cache || this.nets[region] !== net) {
      this.caches[region] = cache
      this.nets[region] = net
      this.owned[region] = cache.netIds.includes(net) ? 1 : 0
    }
    if (this.owned[region])
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
    if (candidate.g + congestion + penalty + distanceCost > maximumCost + 1e-9)
      return Infinity
    const a =
      scores.positions[
        candidate.hopId ?? this.getHopId(candidate.portId, region)
      ]!
    const b = scores.positions[this.getHopId(neighbor, region)]!
    if (a < 0 || b < 0)
      throw new Error("Transition score port is outside its region")
    const cell =
      scores.offsets[region]! +
      Math.min(a, b) * topology.regionIncidentPorts[region]!.length +
      Math.max(a, b)
    const version = this.regionVersions[region]!
    const record = readTransitionRecord(scores, cell, version)
    let cost = record >= 0 ? scores.values[record]! : Number.NaN
    if (record >= 0) {
      this.sharedScoreHits++
      if (scores.owners[record] !== this.scoreWorkerIndex)
        this.crossWorkerScoreHits++
    }
    if (Number.isNaN(cost)) {
      this.sharedScoreMisses++
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
        cost = Infinity
      else
        cost = this.computeRegionCostForRegion(
          region,
          cache.existingSameLayerIntersections +
            geometry.sameLayerIntersectionCount,
          cache.existingCrossingLayerIntersections +
            geometry.crossingLayerIntersectionCount,
          cache.existingEntryExitLayerChanges + geometry.entryExitLayerChanges,
          cache.existingSegmentCount + 1,
        )
      publishTransitionScore(scores, cell, version, cost, this.scoreWorkerIndex)
    }
    if (cost === Infinity) return Infinity
    const marginal = cost - cache.existingRegionCost
    return candidate.g + marginal + congestion + penalty + distanceCost
  }
}
