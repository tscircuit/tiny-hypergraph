import {
  TinyHyperGraphSolver,
  createEmptyRegionIntersectionCache,
  type Candidate,
} from "../core"
import type {
  FlatCandidate,
  RouteSearchResult,
  RoutingSnapshot,
} from "./protocol"

// Reuse the exact serial heap and arithmetic. Only intercept search completion
// and record mutable inputs; the coordinator owns all routing mutations.
export class RouteSearchSolver extends TinyHyperGraphSolver {
  trackReads = true
  readPorts = new Set<number>()
  readRegions = new Set<number>()
  path?: FlatCandidate[]
  exhausted = false

  override isPortReservedForDifferentNet(portId: number) {
    if (this.trackReads) this.readPorts.add(portId)
    return super.isPortReservedForDifferentNet(portId)
  }

  override computeG(
    candidate: Candidate,
    portId: number,
    maximumCost?: number,
    distance?: number,
  ) {
    if (this.trackReads) this.readRegions.add(candidate.nextRegionId)
    return super.computeG(candidate, portId, maximumCost, distance)
  }

  override onPathFound(candidate: Candidate) {
    const path: FlatCandidate[] = []
    let cursor: Candidate | undefined = candidate
    while (cursor) {
      const prevCandidate: Candidate | undefined = cursor.prevCandidate
      const { prevCandidate: _previous, ...flat } = cursor
      path.push(flat)
      cursor = prevCandidate
    }
    this.path = path.reverse()
  }

  override onOutOfCandidates() {
    this.exhausted = true
  }

  applySnapshot(snapshot: RoutingSnapshot) {
    if (snapshot.portPenalty) this.problem.portPenalty = snapshot.portPenalty
    this.state.portAssignment = snapshot.portAssignment
    if (snapshot.resetRegions) {
      this.state.regionIntersectionCaches = Array.from(
        { length: this.topology.regionCount },
        createEmptyRegionIntersectionCache,
      )
    }
    for (const { regionId, cache } of snapshot.regionUpdates) {
      this.state.regionIntersectionCaches[regionId] = cache
    }
    this.state.regionCongestionCost = snapshot.regionCongestionCost
  }

  searchRoute(routeId: number, maxSteps: number): RouteSearchResult {
    this.readPorts.clear()
    this.readRegions.clear()
    this.path = undefined
    this.exhausted = false
    this.failed = false
    this.error = null
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.candidateQueue.clear()
    this.state.unroutedRoutes = [routeId]
    let steps = 0
    while (!this.path && !this.exhausted && !this.failed && steps < maxSteps) {
      this._step()
      steps++
    }
    return {
      path: this.path,
      exhausted: this.exhausted,
      steps,
      readPorts: [...this.readPorts],
      readRegions: [...this.readRegions],
      failed: this.failed,
      error: this.error,
    }
  }
}
