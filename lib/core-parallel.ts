import { OutsideInPartialRipTinyHyperGraphSolver } from "./outside-in-partial-rip-tiny-hypergraph-solver"
import { shuffle } from "./shuffle"
import {
  ParallelRoutePool,
  type ParallelRouteExecutor,
} from "./parallel/ParallelRoutePool"
import { acquireWorkerRuntime } from "./parallel/acquireWorkerRuntime"

export {
  RouteSearchTask,
  RouteSearchReadyTask,
} from "./parallel/RouteSearchTask"
export type { ParallelRouteExecutor } from "./parallel/ParallelRoutePool"

const activeSolvers = new WeakSet<OutsideInPartialRipTinyHyperGraphSolver>()

/** Run the TypeScript route search in workers and commit valid results in serial order. */
export async function solveWithParallelRoutes(
  solver: OutsideInPartialRipTinyHyperGraphSolver,
  executor: ParallelRouteExecutor,
  stopAtIteration = solver.MAX_ITERATIONS,
): Promise<void> {
  if (activeSolvers.has(solver))
    throw new Error("Parallel routing is already running")
  activeSolvers.add(solver)
  const release = await acquireWorkerRuntime(executor)
  const service: { pool?: ParallelRoutePool } = {}
  try {
    await solve(solver, executor, stopAtIteration, service)
  } finally {
    if (service.pool) {
      try {
        await service.pool.dispose()
      } finally {
        release()
        activeSolvers.delete(solver)
      }
    } else {
      release()
      activeSolvers.delete(solver)
    }
  }
}
async function solve(
  solver: OutsideInPartialRipTinyHyperGraphSolver,
  executor: ParallelRouteExecutor,
  stopAtIteration: number,
  service: { pool?: ParallelRoutePool },
): Promise<void> {
  if (solver.deferFinalRouteAcceptance)
    throw new Error("Parallel routing is already running")
  solver.deferFinalRouteAcceptance = true
  try {
    await route(
      solver,
      executor,
      Math.min(stopAtIteration, solver.MAX_ITERATIONS),
      service,
    )
    if (!solver.hasDeferredFinalRouteAcceptance) return
    const request = solver.getFinalRouteRequest()
    let finalRouteMaxIterations = 0
    for (
      let attempt = request.firstAttempt;
      attempt < Math.floor(solver.GREEDY_FINAL_ROUTE_ITERS);
      attempt++
    ) {
      const routeIds =
        attempt <= 0
          ? request.routeIds
          : shuffle(request.routeIds, request.ripCount + attempt)
      const candidate = solver.createFinalRouteCandidate(
        attempt,
        request.snapshot,
        routeIds,
      )
      finalRouteMaxIterations = candidate.MAX_ITERATIONS
      if (candidate instanceof OutsideInPartialRipTinyHyperGraphSolver)
        await solve(candidate, executor, candidate.MAX_ITERATIONS, service)
      else candidate.solve()
      for (const key of [
        "parallelWorkerSearchMs",
        "parallelWorkerSnapshotMs",
        "parallelGraphSyncMs",
        "parallelWaitForRouteMs",
        "parallelCoordinatorSerialMs",
        "parallelRouteSearches",
        "parallelRouteExpansions",
        "speculativeRouteSearches",
        "staleRouteSearches",
        "speculativeRouteExpansions",
      ])
        solver.stats[key] =
          Number(solver.stats[key] ?? 0) + Number(candidate.stats[key] ?? 0)
      if (!candidate.solved || candidate.failed) continue
      solver.acceptFinalRouteResult(
        candidate.getFinalRouteResult(),
        attempt,
        request.routeIds.length,
      )
      break
    }
    if (solver.hasDeferredFinalRouteAcceptance)
      solver.stats = {
        ...solver.stats,
        greedyFinalRouteAttemptCount: Math.floor(
          solver.GREEDY_FINAL_ROUTE_ITERS,
        ),
        greedyFinalRouteRemainingRouteCount: request.routeIds.length,
        greedyFinalRouteMaxIterations: finalRouteMaxIterations,
      }
  } finally {
    solver.deferFinalRouteAcceptance = false
    solver.hasDeferredFinalRouteAcceptance = false
  }
}
async function route(
  solver: OutsideInPartialRipTinyHyperGraphSolver,
  executor: ParallelRouteExecutor,
  limit: number,
  service: { pool?: ParallelRoutePool },
): Promise<void> {
  solver.setup()
  if (limit < solver.MAX_ITERATIONS) {
    while (!solver.solved && !solver.failed && solver.iterations < limit)
      solver.step()
    return
  }
  let pool: ParallelRoutePool | undefined
  let searches = 0
  let expansions = 0
  let serialRoutingMs = 0
  let initial = {
    searches: 0,
    stale: 0,
    expansions: 0,
    searchMs: 0,
    snapshotMs: 0,
    syncMs: 0,
    waitMs: 0,
  }
  try {
    while (!solver.solved && !solver.failed && solver.iterations < limit) {
      const routeId = solver.state.unroutedRoutes[0]
      if (
        solver.state.currentRouteId !== undefined ||
        routeId === undefined ||
        !solver.canSearchRouteInParallel(routeId)
      ) {
        const serialStart = performance.now()
        solver.step()
        serialRoutingMs += performance.now() - serialStart
        continue
      }
      if (!pool) {
        if (service.pool && service.pool.canReuse(solver)) {
          pool = service.pool
          pool.rebind(solver)
        } else {
          if (service.pool) await service.pool.dispose()
          pool = new ParallelRoutePool(solver, executor)
          service.pool = pool
          await pool.start()
        }
      }
      if (searches === 0)
        initial = {
          searches: pool.searches,
          stale: pool.staleSearches,
          expansions: pool.speculativeExpansions,
          searchMs: pool.workerSearchMs,
          snapshotMs: pool.workerSnapshotMs,
          syncMs: pool.graphSyncMs,
          waitMs: pool.waitForRouteMs,
        }
      const remaining = limit - solver.iterations,
        result = await pool.search(routeId, remaining)
      searches++
      expansions += result.iterations
      const commitStart = performance.now()
      if (result.status === "budget" || result.iterations > remaining)
        solver.expireParallelRouteSearch(routeId, remaining)
      else
        solver.acceptParallelRouteSearch(
          routeId,
          result.candidate,
          result.iterations,
        )
      serialRoutingMs += performance.now() - commitStart
    }
  } finally {
    solver.stats = {
      ...solver.stats,
      parallelRouteWorkers: searches > 0 ? pool!.workerCount : 0,
      parallelWorkerSearchMs: (pool?.workerSearchMs ?? 0) - initial.searchMs,
      parallelWorkerSnapshotMs:
        (pool?.workerSnapshotMs ?? 0) - initial.snapshotMs,
      parallelGraphSyncMs: (pool?.graphSyncMs ?? 0) - initial.syncMs,
      parallelWaitForRouteMs: (pool?.waitForRouteMs ?? 0) - initial.waitMs,
      parallelCoordinatorSerialMs: serialRoutingMs,
      parallelRouteSearches: searches,
      parallelRouteExpansions: expansions,
      speculativeRouteSearches: (pool?.searches ?? 0) - initial.searches,
      staleRouteSearches: (pool?.staleSearches ?? 0) - initial.stale,
      speculativeRouteExpansions:
        (pool?.speculativeExpansions ?? 0) - initial.expansions,
      maximumConcurrentRouteSearches: pool?.maximumConcurrentSearches ?? 0,
    }
  }
}
