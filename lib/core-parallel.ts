import { OutsideInPartialRipTinyHyperGraphSolver } from "./outside-in-partial-rip-tiny-hypergraph-solver"
import { shuffle } from "./shuffle"
import {
  ParallelRegionCostPool,
  type ParallelCostExecutor,
} from "./parallel/ParallelRegionCostPool"
import { acquireWorkerRuntime } from "./parallel/acquireWorkerRuntime"

export { RegionCostTask, RegionCostReadyTask } from "./parallel/RegionCostTask"
export type { ParallelCostExecutor } from "./parallel/ParallelRegionCostPool"

const activeSolvers = new WeakSet<OutsideInPartialRipTinyHyperGraphSolver>()

/** Prepare exact region scores in workers while retaining the original ordered TypeScript search. */
export async function solveWithParallelCosts(
  solver: OutsideInPartialRipTinyHyperGraphSolver,
  executor: ParallelCostExecutor,
  stopAtIteration = solver.MAX_ITERATIONS,
): Promise<void> {
  if (activeSolvers.has(solver))
    throw new Error("Parallel routing is already running")
  activeSolvers.add(solver)
  const release = await acquireWorkerRuntime(executor)
  const service: { pool?: ParallelRegionCostPool } = {}
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
  executor: ParallelCostExecutor,
  stopAtIteration: number,
  service: { pool?: ParallelRegionCostPool },
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
        "parallelCostTables",
        "parallelCostCells",
        "parallelCostWorkerMs",
        "parallelCostPrepareMs",
        "parallelCostCacheHits",
        "parallelCostCacheMisses",
        "parallelOriginalSearchMs",
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
  executor: ParallelCostExecutor,
  limit: number,
  service: { pool?: ParallelRegionCostPool },
): Promise<void> {
  solver.setup()
  const previousProvider = solver.regionCostProvider
  let pool: ParallelRegionCostPool | undefined
  let searchMs = 0
  let initial = {
    prepareMs: 0,
    workerMs: 0,
    tables: 0,
    cells: 0,
    hits: 0,
    misses: 0,
  }
  try {
    while (!solver.solved && !solver.failed && solver.iterations < limit) {
      const routeId = solver.state.unroutedRoutes[0]
      if (
        limit === solver.MAX_ITERATIONS &&
        solver.state.currentRouteId === undefined &&
        routeId !== undefined &&
        solver.canPrepareRouteCostsInParallel(routeId)
      ) {
        if (!pool) {
          if (service.pool && service.pool.canReuse(solver)) {
            pool = service.pool
            pool.rebind(solver)
          } else {
            if (service.pool) await service.pool.dispose()
            pool = new ParallelRegionCostPool(solver, executor)
            service.pool = pool
            await pool.start()
          }
          const totals = pool.totals
          initial = {
            prepareMs: pool.prepareMs,
            workerMs: totals.workerMs,
            tables: totals.tables,
            cells: totals.cells,
            hits: pool.cacheHits,
            misses: pool.cacheMisses,
          }
          solver.regionCostProvider = (candidate, neighbor) =>
            pool!.lookup(candidate, neighbor)
        }
        await pool.prepare()
      }
      const start = performance.now()
      do {
        solver.step()
      } while (
        !solver.solved &&
        !solver.failed &&
        solver.iterations < limit &&
        solver.state.currentRouteId !== undefined
      )
      searchMs += performance.now() - start
    }
  } finally {
    solver.regionCostProvider = previousProvider
    const totals = pool?.totals
    solver.stats = {
      ...solver.stats,
      parallelRouteWorkers: pool?.workerCount ?? 0,
      parallelCostTables: (totals?.tables ?? 0) - initial.tables,
      parallelCostCells: (totals?.cells ?? 0) - initial.cells,
      parallelCostWorkerMs: (totals?.workerMs ?? 0) - initial.workerMs,
      parallelCostPrepareMs: (pool?.prepareMs ?? 0) - initial.prepareMs,
      parallelCostCacheHits: (pool?.cacheHits ?? 0) - initial.hits,
      parallelCostCacheMisses: (pool?.cacheMisses ?? 0) - initial.misses,
      parallelOriginalSearchMs: searchMs,
      maximumParticipatingCostWorkers: pool?.maximumParticipatingWorkers ?? 0,
    }
  }
}
