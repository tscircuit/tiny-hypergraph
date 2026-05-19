import {
  createEmptyRegionIntersectionCache,
  TinyHyperGraphSolver,
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "../core"
import type { PortId, RegionId, RouteId } from "../types"

type SolvedRouteSegment = {
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

/**
 * Routes every connection as if intermediate ports have unbounded virtual
 * fanout capacity, then assembles the discovered paths into a normal
 * TinyHyperGraphSolver output.
 *
 * Real route endpoints are still reserved by net. Use
 * splitOverloadedRouteEndpointPorts first when multiple different-net route
 * endpoints share the same physical port.
 */
export class TinyHyperGraphVirtualFanoutSolver extends TinyHyperGraphSolver {
  readonly solvedRouteSegmentsByRouteId: Array<SolvedRouteSegment[] | undefined>

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    this.solvedRouteSegmentsByRouteId = Array.from(
      { length: problem.routeCount },
      () => undefined,
    )
  }

  override onPathFound(finalCandidate: Candidate) {
    const currentRouteId = this.state.currentRouteId

    if (currentRouteId === undefined) return

    this.routeSuccessCountByRouteId[currentRouteId] += 1
    this.solvedRouteSegmentsByRouteId[currentRouteId] =
      this.getSolvedPathSegments(finalCandidate)

    this.state.candidateQueue.clear()
    this.state.currentRouteNetId = undefined
    this.state.currentRouteId = undefined
  }

  override onAllRoutesRouted() {
    if (
      this.solvedRouteSegmentsByRouteId.some(
        (routeSegments) => routeSegments === undefined,
      )
    ) {
      super.onAllRoutesRouted()
      return
    }

    this.assembleFanoutSolution()
    this.solved = true
  }

  protected assembleFanoutSolution() {
    const { topology, problem, state } = this

    state.portAssignment.fill(-1)
    state.regionSegments = Array.from(
      { length: topology.regionCount },
      () => [],
    )
    state.regionIntersectionCaches = Array.from(
      { length: topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )
    state.currentRouteId = undefined
    state.currentRouteNetId = undefined
    state.unroutedRoutes = []
    state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    state.goalPortId = -1

    for (let routeId = 0; routeId < problem.routeCount; routeId++) {
      state.currentRouteNetId = problem.routeNet[routeId]

      for (const { regionId, fromPortId, toPortId } of this
        .solvedRouteSegmentsByRouteId[routeId] ?? []) {
        state.regionSegments[regionId].push([routeId, fromPortId, toPortId])
        state.portAssignment[fromPortId] = state.currentRouteNetId
        state.portAssignment[toPortId] = state.currentRouteNetId
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }

    state.currentRouteNetId = undefined

    this.stats = {
      ...this.stats,
      virtualFanout: true,
      capturedPathCount: problem.routeCount,
      maxRegionCost: this.getMaxRegionCost(),
    }
  }
}
