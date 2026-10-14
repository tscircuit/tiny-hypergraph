import {
  type Candidate,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
} from "../core"
import { setNewIntersectionCounts } from "../countNewIntersections"
import { RouteSearchSolver } from "./RouteSearchSolver"
import type { RoutingSnapshot } from "./protocol"
import type {
  SharedRouteDistances,
  SharedRouteHeuristics,
} from "./shared-distances"

type ScoreTable = { values: Float64Array; generations: Uint32Array }
const createScoreTable = (count: number): ScoreTable => ({
  values: new Float64Array(count),
  generations: new Uint32Array(count),
})

/** Scores depend on the immutable region snapshot and net, not on the route
 * prefix. Keep those scores across searches until that region changes. */
export class CachedRouteSearchSolver extends RouteSearchSolver {
  private scoreCaches: Array<
    | {
        nets?: Set<number>
        epoch: number
        generic: ScoreTable
        own: Map<number, ScoreTable>
      }
    | undefined
  > = []
  private firstIndex: Int32Array
  private secondIndex: Int32Array
  private cacheable: Uint8Array
  private cachedCells = 0
  private readonly cellLimit = 2_666_666 // 12 bytes per cell; at most 32 MB per worker.
  private adjacency: Array<{ next: Int32Array; hops: Int32Array }> = []
  private fastExpansion = true
  private emptySameCost: Float64Array
  private emptyChangeCost: Float64Array
  private heuristicRoute: Int32Array
  private heuristicCost: Float64Array
  private contextRegion = -1
  private contextNet = -1
  private contextSize = 0
  private contextEpoch = 0
  private contextTable?: ScoreTable

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options: TinyHyperGraphSolverOptions,
    private readonly distances?: SharedRouteDistances,
    private readonly heuristics?: SharedRouteHeuristics,
  ) {
    super(topology, problem, options)
    this.firstIndex = new Int32Array(topology.portCount)
    this.secondIndex = new Int32Array(topology.portCount)
    this.heuristicRoute = new Int32Array(topology.portCount).fill(-1)
    this.heuristicCost = new Float64Array(topology.portCount)
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

  override computeH(port: number) {
    if (!this.heuristics) return super.computeH(port)
    const route = this.state.currentRouteId!
    if (this.heuristicRoute[port] !== route) {
      const index = route * this.topology.portCount + port
      const { values, ready } = this.heuristics
      let distance: number
      if (Atomics.load(ready, index) === 1) distance = values[index]
      else {
        const goal = this.problem.routeEndPort[route]
        const dx = this.topology.portX[port] - this.topology.portX[goal]
        const dy = this.topology.portY[port] - this.topology.portY[goal]
        distance = Math.sqrt(dx * dx + dy * dy)
        // Concurrent writers compute identical IEEE values. Publishing with
        // release/acquire ensures readers never observe an uninitialized value.
        values[index] = distance
        Atomics.store(ready, index, 1)
      }
      this.heuristicCost[port] = distance * this.DISTANCE_TO_COST
      this.heuristicRoute[port] = route
    }
    return this.heuristicCost[port]
  }

  override _step() {
    const { state, problem, topology } = this
    const costs = state.candidateBestCostByHopId
    const generations = state.candidateBestCostGenerationByHopId
    if (
      state.currentRouteId === undefined ||
      costs instanceof Map ||
      generations instanceof Map ||
      !this.fastExpansion ||
      this.OWNED_REGIONAL_HOP_FRONTIER
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
    const distances = this.distances?.[region]
    const row =
      (topology.incidentPortRegion[candidate.portId][0] === region
        ? this.firstIndex[candidate.portId]
        : this.secondIndex[candidate.portId]) * ports.length
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
      if (state.candidateQueue.isClosedHopId?.(nextHop)) continue
      const reserved = reservations[port] ?? -1
      if (reserved === -2 || (reserved !== -1 && reserved !== net)) continue
      if (assignments[port] !== -1 && assignments[port] !== net) continue
      const owner = problem.regionNetId[nextRegion]
      if (owner !== -1 && owner !== net) continue
      const previous =
        generations[nextHop] === epoch ? costs[nextHop] : Infinity
      if (candidate.g >= previous) continue
      let lowerBound = base + (problem.portPenalty?.[port] ?? 0)
      let distance: number | undefined
      if (this.ADD_SEGMENT_DISTANCE_TO_G) {
        if (distances && this.cacheable[region]) distance = distances[row + i]
        else {
          const dx = topology.portX[candidate.portId] - topology.portX[port]
          const dy = topology.portY[candidate.portId] - topology.portY[port]
          distance = Math.sqrt(dx * dx + dy * dy)
        }
        lowerBound += distance * this.DISTANCE_TO_COST
      }
      if (lowerBound >= previous) continue
      const g = this.computeG(candidate, port, previous, distance, row, i)
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
      this.clearScoreCaches()
    } else
      for (const { regionId } of snapshot.regionUpdates) {
        this.invalidateScoreCache(regionId)
      }
  }

  protected invalidateScoreCache(regionId: number) {
    this.contextRegion = -1
    const scores = this.scoreCaches?.[regionId]
    if (!scores) return
    scores.nets = undefined
    if (scores.epoch === 0xffffffff) {
      scores.generic.generations.fill(0)
      for (const table of scores.own.values()) table.generations.fill(0)
      scores.epoch = 1
    } else scores.epoch++
  }

  protected clearScoreCaches() {
    for (let r = 0; r < this.scoreCaches.length; r++)
      this.invalidateScoreCache(r)
  }

  override computeG(
    candidate: Candidate,
    portId: number,
    maximumCost = Infinity,
    distance?: number,
    knownRow?: number,
    knownColumn?: number,
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
    const cache = this.state.regionIntersectionCaches[regionId]
    if (cache.existingSegmentCount === 0) {
      const cost =
        (this.topology.portZ[candidate.portId] === this.topology.portZ[portId]
          ? this.emptySameCost[regionId]
          : this.emptyChangeCost[regionId]) - cache.existingRegionCost
      return candidate.g + cost + congestion + penalty + distanceCost
    }
    const net = this.state.currentRouteNetId!
    let pairs: ScoreTable
    let epoch: number
    let n: number
    if (
      this.contextRegion === regionId &&
      this.contextNet === net &&
      this.contextTable
    ) {
      pairs = this.contextTable
      epoch = this.contextEpoch
      n = this.contextSize
    } else {
      let scores = this.scoreCaches[regionId]
      n = this.topology.regionIncidentPorts[regionId].length
      if (
        !this.cacheable[regionId] ||
        (!scores && this.cachedCells + n * n > this.cellLimit)
      )
        return super.computeG(candidate, portId, maximumCost, distance)
      if (!scores) {
        this.scoreCaches[regionId] = scores = {
          nets: new Set(cache.netIds),
          epoch: 1,
          generic: createScoreTable(n * n),
          own: new Map(),
        }
        this.cachedCells += n * n
      }
      // Nets absent from this region have identical intersection scores.
      pairs = scores.generic
      scores.nets ??= new Set(cache.netIds)
      if (scores.nets.has(net)) {
        pairs = scores.own.get(net)!
        if (!pairs) {
          if (this.cachedCells + n * n > this.cellLimit)
            return super.computeG(candidate, portId, maximumCost, distance)
          scores.own.set(net, (pairs = createScoreTable(n * n)))
          this.cachedCells += n * n
        }
      }
      epoch = scores.epoch
      this.contextRegion = regionId
      this.contextNet = net
      this.contextSize = n
      this.contextEpoch = epoch
      this.contextTable = pairs
    }
    const a =
      knownRow !== undefined
        ? knownRow / n
        : this.topology.incidentPortRegion[candidate.portId][0] === regionId
          ? this.firstIndex[candidate.portId]
          : this.secondIndex[candidate.portId]
    const b =
      knownColumn !== undefined
        ? knownColumn
        : this.topology.incidentPortRegion[portId][0] === regionId
          ? this.firstIndex[portId]
          : this.secondIndex[portId]
    const pair = (knownRow ?? a * n) + (knownColumn ?? b)
    let cost = pairs.values[pair]
    if (pairs.generations[pair] !== epoch) {
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
      pairs.values[pair] = cost
      pairs.values[b * n + a] = cost
      pairs.generations[pair] = epoch
      pairs.generations[b * n + a] = epoch
    }
    return candidate.g + cost + congestion + penalty + distanceCost
  }
}
