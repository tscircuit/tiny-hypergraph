import {
  type Candidate,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
} from "../core"
import { setNewIntersectionCounts } from "../countNewIntersections"
import { RouteSearchSolver } from "./RouteSearchSolver"
import type { RoutingSnapshot } from "./protocol"

/** Scores depend on the immutable region snapshot and net, not on the route
 * prefix. Keep those scores across searches until that region changes. */
export class CachedRouteSearchSolver extends RouteSearchSolver {
  private scoreCaches: Array<
    | {
        nets: Set<number>
        generic: Float64Array
        own: Map<number, Float64Array>
      }
    | undefined
  > = []
  private firstIndex: Int32Array
  private secondIndex: Int32Array
  private cacheable: Uint8Array
  private cachedCells = 0
  private readonly cellLimit = 4_000_000 // At most 32 MB of score tables per worker.
  private adjacency: Array<{ next: Int32Array; hops: Int32Array }> = []
  private fastExpansion = true
  private emptySameCost: Float64Array
  private emptyChangeCost: Float64Array

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    this.firstIndex = new Int32Array(topology.portCount)
    this.secondIndex = new Int32Array(topology.portCount)
    this.cacheable = new Uint8Array(topology.regionCount).fill(1)
    this.emptySameCost = new Float64Array(topology.regionCount)
    this.emptyChangeCost = new Float64Array(topology.regionCount)
    for (let r = 0; r < topology.regionCount; r++) {
      this.emptySameCost[r] = this.computeRegionCostForRegion(r, 0, 0, 0, 1)
      this.emptyChangeCost[r] = this.computeRegionCostForRegion(r, 0, 0, 1, 1)
      const ports = topology.regionIncidentPorts[r]
      const next = new Int32Array(ports.length).fill(-1)
      const hops = new Int32Array(ports.length).fill(-1)
      for (let i = 0; i < ports.length; i++) {
        const incident = topology.incidentPortRegion[ports[i]]
        const region = incident[0] === r ? incident[1] : incident[0]
        if (region !== undefined) {
          next[i] = region
          hops[i] = this.getHopId(ports[i], region)
          if (hops[i] < 0) this.fastExpansion = false
        }
      }
      this.adjacency.push({ next, hops })
    }
    for (let r = 0; r < topology.regionCount; r++)
      for (let i = 0; i < topology.regionIncidentPorts[r].length; i++) {
        const p = topology.regionIncidentPorts[r][i]
        if (topology.incidentPortRegion[p][0] === r) this.firstIndex[p] = i
        else if (topology.incidentPortRegion[p][1] === r)
          this.secondIndex[p] = i
        else this.cacheable[r] = 0
      }
  }

  override _step() {
    const { state, problem, topology } = this
    const costs = state.candidateBestCostByHopId
    const generations = state.candidateBestCostGenerationByHopId
    if (
      state.currentRouteId === undefined ||
      costs instanceof Map ||
      generations instanceof Map ||
      this.ADD_SEGMENT_DISTANCE_TO_G ||
      !this.fastExpansion
    )
      return super._step()
    const candidate = state.candidateQueue.dequeue()
    if (!candidate) {
      this.onOutOfCandidates()
      return
    }
    const hop = candidate.hopId!
    if (hop < 0)
      throw new Error("Fixed-round dense search received a nonincident hop")
    const epoch = state.candidateBestCostGeneration
    if (generations[hop] === epoch && candidate.g > costs[hop]) return
    const region = candidate.nextRegionId
    const net = state.currentRouteNetId!
    const regionOwner = problem.regionNetId[region]
    if (regionOwner !== -1 && regionOwner !== net) return
    const ports = topology.regionIncidentPorts[region]
    const { next, hops } = this.adjacency[region]
    const assignments = state.portAssignment
    const reservations = this.problemSetup.portEndpointReservationNetId
    const base = candidate.g + state.regionCongestionCost[region]
    for (let i = 0; i < ports.length; i++) {
      const port = ports[i]
      if (port === state.goalPortId) {
        const reserved = reservations[port] ?? -1
        if (reserved === -2 || (reserved !== -1 && reserved !== net)) continue
        if (assignments[port] !== -1 && assignments[port] !== net) continue
        this.onPathFound(candidate)
        return
      }
      if (port === candidate.portId || problem.portSectionMask[port] === 0)
        continue
      const nextRegion = next[i]
      if (nextRegion === -1) continue
      const nextHop = hops[i]
      const reserved = reservations[port] ?? -1
      if (reserved === -2 || (reserved !== -1 && reserved !== net)) continue
      if (assignments[port] !== -1 && assignments[port] !== net) continue
      const owner = problem.regionNetId[nextRegion]
      if (owner !== -1 && owner !== net) continue
      const previous =
        generations[nextHop] === epoch ? costs[nextHop] : Infinity
      if (
        candidate.g >= previous ||
        base + (problem.portPenalty?.[port] ?? 0) >= previous
      )
        continue
      const g = this.computeG(candidate, port, previous)
      if (!Number.isFinite(g) || g >= previous) continue
      const h = this.computeH(port)
      costs[nextHop] = g
      generations[nextHop] = epoch
      state.candidateQueue.queue({
        hopId: nextHop,
        prevRegionId: region,
        nextRegionId: nextRegion,
        portId: port,
        g,
        h,
        f: g + h,
        prevCandidate: candidate,
      })
    }
  }

  override applySnapshot(snapshot: RoutingSnapshot) {
    super.applySnapshot(snapshot)
    if (snapshot.resetRegions) {
      this.scoreCaches = []
      this.cachedCells = 0
    } else
      for (const { regionId } of snapshot.regionUpdates) {
        const old = this.scoreCaches[regionId]
        if (old) this.cachedCells -= old.generic.length * (1 + old.own.size)
        this.scoreCaches[regionId] = undefined
      }
  }

  override computeG(
    candidate: Candidate,
    portId: number,
    maximumCost = Infinity,
    distance?: number,
  ): number {
    const regionId = candidate.nextRegionId
    const congestion = this.state.regionCongestionCost[regionId]
    const penalty = this.problem.portPenalty?.[portId] ?? 0
    let distanceCost = 0
    if (this.ADD_SEGMENT_DISTANCE_TO_G) {
      const dx =
        this.topology.portX[candidate.portId] - this.topology.portX[portId]
      const dy =
        this.topology.portY[candidate.portId] - this.topology.portY[portId]
      distanceCost =
        (distance ?? Math.sqrt(dx * dx + dy * dy)) * this.DISTANCE_TO_COST
    }
    if (candidate.g + congestion + penalty + distanceCost > maximumCost + 1e-9)
      return Infinity
    let scores = this.scoreCaches[regionId]
    const cache = this.state.regionIntersectionCaches[regionId]
    if (cache.existingSegmentCount === 0) {
      const cost =
        (this.topology.portZ[candidate.portId] === this.topology.portZ[portId]
          ? this.emptySameCost[regionId]
          : this.emptyChangeCost[regionId]) - cache.existingRegionCost
      return candidate.g + cost + congestion + penalty + distanceCost
    }
    const n = this.topology.regionIncidentPorts[regionId].length
    if (
      !this.cacheable[regionId] ||
      (!scores && this.cachedCells + n * n > this.cellLimit)
    )
      return super.computeG(candidate, portId, maximumCost, distance)
    if (!scores) {
      this.scoreCaches[regionId] = scores = {
        nets: new Set(cache.netIds),
        generic: new Float64Array(n * n).fill(NaN),
        own: new Map(),
      }
      this.cachedCells += n * n
    }
    const net = this.state.currentRouteNetId!
    // Nets absent from this region have identical intersection scores.
    let pairs = scores.generic
    if (scores.nets.has(net)) {
      pairs = scores.own.get(net)!
      if (!pairs) {
        if (this.cachedCells + n * n > this.cellLimit)
          return super.computeG(candidate, portId, maximumCost, distance)
        scores.own.set(net, (pairs = new Float64Array(n * n).fill(NaN)))
        this.cachedCells += n * n
      }
    }
    const a =
      this.topology.incidentPortRegion[candidate.portId][0] === regionId
        ? this.firstIndex[candidate.portId]
        : this.secondIndex[candidate.portId]
    const b =
      this.topology.incidentPortRegion[portId][0] === regionId
        ? this.firstIndex[portId]
        : this.secondIndex[portId]
    const pair = a * n + b
    let cost = pairs[pair]
    if (Number.isNaN(cost)) {
      const geometry = this.populateSegmentGeometryScratch(
        regionId,
        candidate.portId,
        portId,
      )
      setNewIntersectionCounts(cache, geometry)
      cost =
        geometry.sameLayerIntersectionCount > 0 &&
        this.isKnownSingleLayerRegion(regionId)
          ? Infinity
          : this.computeRegionCostForRegion(
              regionId,
              cache.existingSameLayerIntersections +
                geometry.sameLayerIntersectionCount,
              cache.existingCrossingLayerIntersections +
                geometry.crossingLayerIntersectionCount,
              cache.existingEntryExitLayerChanges +
                geometry.entryExitLayerChanges,
              cache.existingSegmentCount + 1,
            ) - cache.existingRegionCost
      pairs[pair] = cost
      pairs[b * n + a] = cost
    }
    return candidate.g + cost + congestion + penalty + distanceCost
  }
}
