import { OutsideInPartialRipTinyHyperGraphSolver } from "./outside-in-partial-rip-tiny-hypergraph-solver"
import { shuffle } from "./shuffle"
import {
  ParallelRouteSearchPool,
  type ParallelSearchExecutor,
} from "./parallel/ParallelRouteSearchPool"
import { acquireWorkerRuntime } from "./parallel/acquireWorkerRuntime"

export { ParallelRouteSearchTask } from "./parallel/ParallelRouteSearchTask"
export type { ParallelSearchExecutor } from "./parallel/ParallelRouteSearchPool"

const activeSolvers = new WeakSet<OutsideInPartialRipTinyHyperGraphSolver>()

/** Run the TypeScript route search in workers and commit valid results in serial order. */
export async function solveWithParallelSearch(
  solver: OutsideInPartialRipTinyHyperGraphSolver,
  executor: ParallelSearchExecutor,
  stopAtIteration = solver.MAX_ITERATIONS,
): Promise<void> {
  if (activeSolvers.has(solver))
    throw new Error("Parallel routing is already running")
  activeSolvers.add(solver)
  const release = await acquireWorkerRuntime(executor)
  const service: { pool?: ParallelRouteSearchPool } = {}
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
  executor: ParallelSearchExecutor,
  stopAtIteration: number,
  service: { pool?: ParallelRouteSearchPool },
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
        "parallelSearchMs",
        "parallelRouteSearches",
        "parallelRouteExpansions",
        "speculativeRouteSearches",
        "speculativeRouteExpansions",
        "staleRouteSearches",
        "certifiedRouteSearches",
        "parallelWorkerSearchMs",
        "parallelWorkerSnapshotMs",
        "parallelGraphSyncMs",
      ])
        solver.stats[key] =
          Number(solver.stats[key] ?? 0) + Number(candidate.stats[key] ?? 0)
      for (const key of [
        "parallelRouteWorkers",
        "maximumParticipatingSearchWorkers",
        "maximumConcurrentRouteSearches",
      ])
        solver.stats[key] = Math.max(
          Number(solver.stats[key] ?? 0),
          Number(candidate.stats[key] ?? 0),
        )
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
  executor: ParallelSearchExecutor,
  limit: number,
  service: { pool?: ParallelRouteSearchPool },
): Promise<void> {
  solver.setup()
  if (limit < solver.MAX_ITERATIONS) {
    while (!solver.solved && !solver.failed && solver.iterations < limit)
      solver.step()
    return
  }
  let pool: ParallelRouteSearchPool | undefined
  let searches = 0
  let chargedExpansions = 0
  let initial = {
    searchMs: 0,
    expansions: 0,
    messages: 0,
    batches: 0,
    physicalSearches: 0,
    physicalExpansions: 0,
    stale: 0,
    certified: 0,
    workerMs: 0,
    snapshotMs: 0,
    syncMs: 0,
  }
  try {
    while (!solver.solved && !solver.failed && solver.iterations < limit) {
      const routeId = solver.state.unroutedRoutes[0]
      if (
        solver.state.currentRouteId !== undefined ||
        routeId === undefined ||
        !solver.canSearchRouteInParallel(routeId)
      ) {
        solver.step()
        continue
      }
      if (!pool) {
        if (service.pool && service.pool.canReuse(solver)) {
          pool = service.pool
          pool.rebind(solver)
        } else {
          if (service.pool) await service.pool.dispose()
          pool = new ParallelRouteSearchPool(solver, executor)
          service.pool = pool
          await pool.start()
        }
      }
      if (searches === 0)
        initial = {
          searchMs: pool.searchMs,
          ...pool.totals,
          physicalSearches: pool.searches,
          physicalExpansions: pool.speculativeExpansions,
          stale: pool.staleSearches,
          certified: pool.certifiedSearches,
          workerMs: pool.workerSearchMs,
          snapshotMs: pool.workerSnapshotMs,
          syncMs: pool.graphSyncMs,
        }
      const remaining = limit - solver.iterations,
        result = await pool.search(routeId, remaining)
      searches++
      chargedExpansions += Math.min(remaining, result.iterations)
      if (result.status === "budget" || result.iterations > remaining)
        solver.expireParallelRouteSearch(routeId, remaining)
      else
        solver.acceptParallelRouteSearch(
          routeId,
          result.candidate,
          result.iterations,
        )
    }
  } finally {
    solver.stats = {
      ...solver.stats,
      parallelRouteWorkers: searches > 0 ? pool!.workerCount : 0,
      parallelSearchMs: (pool?.searchMs ?? 0) - initial.searchMs,
      parallelRouteSearches: searches,
      parallelRouteExpansions: chargedExpansions,
      speculativeRouteSearches:
        (pool?.searches ?? 0) - initial.physicalSearches,
      speculativeRouteExpansions:
        (pool?.speculativeExpansions ?? 0) - initial.physicalExpansions,
      staleRouteSearches: (pool?.staleSearches ?? 0) - initial.stale,
      certifiedRouteSearches:
        (pool?.certifiedSearches ?? 0) - initial.certified,
      parallelWorkerSearchMs: (pool?.workerSearchMs ?? 0) - initial.workerMs,
      parallelWorkerSnapshotMs:
        (pool?.workerSnapshotMs ?? 0) - initial.snapshotMs,
      parallelGraphSyncMs: (pool?.graphSyncMs ?? 0) - initial.syncMs,
      maximumConcurrentRouteSearches: pool?.maximumConcurrentSearches ?? 0,
      maximumParticipatingSearchWorkers: pool?.maximumParticipatingWorkers ?? 0,
    }
  }
}
