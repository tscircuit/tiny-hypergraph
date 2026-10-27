import { OutsideInPartialRipTinyHyperGraphSolver } from "./outside-in-partial-rip-tiny-hypergraph-solver"
import { shuffle } from "./shuffle"
import {
  DistributedSearchPool,
  type ParallelSearchExecutor,
} from "./parallel/DistributedSearchPool"
import { acquireWorkerRuntime } from "./parallel/acquireWorkerRuntime"

export {
  DistributedSearchTask,
  DistributedSearchReadyTask,
} from "./parallel/DistributedSearchTask"
export type { ParallelSearchExecutor } from "./parallel/DistributedSearchPool"

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
  const service: { pool?: DistributedSearchPool } = {}
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
  service: { pool?: DistributedSearchPool },
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
        "parallelSearchMessages",
        "parallelSearchBatches",
      ])
        solver.stats[key] =
          Number(solver.stats[key] ?? 0) + Number(candidate.stats[key] ?? 0)
      for (const key of [
        "parallelRouteWorkers",
        "maximumParticipatingSearchWorkers",
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
  service: { pool?: DistributedSearchPool },
): Promise<void> {
  solver.setup()
  if (limit < solver.MAX_ITERATIONS) {
    while (!solver.solved && !solver.failed && solver.iterations < limit)
      solver.step()
    return
  }
  let pool: DistributedSearchPool | undefined
  let searches = 0
  let initial = { searchMs: 0, expansions: 0, messages: 0, batches: 0 }
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
          pool = new DistributedSearchPool(solver, executor)
          service.pool = pool
          await pool.start()
        }
      }
      if (searches === 0) initial = { searchMs: pool.searchMs, ...pool.totals }
      const remaining = limit - solver.iterations,
        result = await pool.search(routeId, remaining)
      searches++
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
      parallelRouteExpansions:
        (pool?.totals.expansions ?? 0) - initial.expansions,
      parallelSearchMessages: (pool?.totals.messages ?? 0) - initial.messages,
      parallelSearchBatches: (pool?.totals.batches ?? 0) - initial.batches,
      maximumParticipatingSearchWorkers: pool?.maximumParticipatingWorkers ?? 0,
    }
  }
}
