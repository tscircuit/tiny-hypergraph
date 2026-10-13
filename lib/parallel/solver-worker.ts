import { parentPort } from "node:worker_threads"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphSolver,
  createEmptyRegionIntersectionCache,
  type Candidate,
} from "../core"
import type {
  FlatCandidate,
  RouteSearchResult,
  SolveResult,
  WorkerRequest,
} from "./protocol"

// Reuse the exact serial heap and arithmetic. Only intercept search completion
// and record mutable inputs; the coordinator owns all routing mutations.
class RouteSearchSolver extends TinyHyperGraphSolver {
  readPorts = new Set<number>()
  readRegions = new Set<number>()
  path?: FlatCandidate[]
  exhausted = false

  override isPortReservedForDifferentNet(portId: number) {
    this.readPorts.add(portId)
    return super.isPortReservedForDifferentNet(portId)
  }

  override computeG(
    candidate: Candidate,
    portId: number,
    maximumCost?: number,
    distance?: number,
  ) {
    this.readRegions.add(candidate.nextRegionId)
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
}

let initialized: Extract<WorkerRequest, { kind: "init" }> | undefined
let routeSolver: RouteSearchSolver | undefined
if (!parentPort) throw new Error("solver-worker must run in a worker thread")
parentPort.on("message", (request: WorkerRequest) => {
  try {
    if (request.kind === "init") {
      initialized = request
      routeSolver = new RouteSearchSolver(
        request.topology,
        { ...request.problem, initialAssignments: undefined },
        { ...request.options, STATIC_REACHABILITY_PRECHECK: false },
      )
      routeSolver.setup()
      parentPort!.postMessage({ value: null })
    } else if (request.kind === "solve") {
      const { topology, problem } = loadSerializedHyperGraph(request.graph)
      const solver = new TinyHyperGraphSolver(
        topology,
        problem,
        request.options,
      )
      solver.solve()
      const value: SolveResult = {
        solved: solver.solved,
        failed: solver.failed,
        error: solver.error,
        iterations: solver.iterations,
        output: solver.solved && !solver.failed ? solver.getOutput() : null,
        stats: solver.stats,
      }
      parentPort!.postMessage({ value })
    } else {
      if (!initialized) throw new Error("Route worker was not initialized")
      const solver = routeSolver!
      solver.readPorts.clear()
      solver.readRegions.clear()
      solver.path = undefined
      solver.exhausted = false
      solver.failed = false
      solver.error = null
      solver.state.currentRouteId = undefined
      solver.state.currentRouteNetId = undefined
      solver.state.candidateQueue.clear()
      solver.state.portAssignment = request.snapshot.portAssignment
      if (request.snapshot.resetRegions) {
        solver.state.regionIntersectionCaches = Array.from(
          { length: solver.topology.regionCount },
          createEmptyRegionIntersectionCache,
        )
      }
      for (const { regionId, cache } of request.snapshot.regionUpdates) {
        solver.state.regionIntersectionCaches[regionId] = cache
      }
      solver.state.regionCongestionCost = request.snapshot.regionCongestionCost
      solver.state.unroutedRoutes = [request.routeId]
      // Setup has no routing mutations; endpoint reservations include all routes.
      solver.setup()
      let steps = 0
      while (
        !solver.path &&
        !solver.exhausted &&
        !solver.failed &&
        steps < request.maxSteps
      ) {
        solver._step()
        steps++
      }
      const value: RouteSearchResult = {
        path: solver.path,
        exhausted: solver.exhausted,
        steps,
        readPorts: [...solver.readPorts],
        readRegions: [...solver.readRegions],
      }
      parentPort!.postMessage({ value })
    }
  } catch (error) {
    parentPort!.postMessage({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
