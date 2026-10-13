import { parentPort } from "node:worker_threads"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../core"
import type { RoundTaskResult, SolveResult, WorkerRequest } from "./protocol"

import { RouteSearchSolver } from "./RouteSearchSolver"
import { CachedRouteSearchSolver } from "./CachedRouteSearchSolver"

let initialized: Extract<WorkerRequest, { kind: "init" }> | undefined
let routeSolver: RouteSearchSolver | undefined
if (!parentPort) throw new Error("solver-worker must run in a worker thread")
parentPort.on("message", (request: WorkerRequest) => {
  try {
    if (request.kind === "init") {
      initialized = request
      const SearchSolver = request.cacheScores
        ? CachedRouteSearchSolver
        : RouteSearchSolver
      routeSolver = new SearchSolver(
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
      solver.trackReads = request.kind === "route"
      solver.applySnapshot(request.snapshot)
      let value
      if (request.kind === "round") {
        const results: RoundTaskResult[] = []
        while (true) {
          const index = Atomics.add(request.taskCounter, 0, 1)
          if (index >= request.routeIds.length) break
          results.push({
            index,
            search: solver.searchRoute(
              request.routeIds[index],
              request.maxSteps,
            ),
          })
        }
        value = results
      } else value = solver.searchRoute(request.routeId, request.maxSteps)
      parentPort!.postMessage({ value })
    }
  } catch (error) {
    parentPort!.postMessage({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
