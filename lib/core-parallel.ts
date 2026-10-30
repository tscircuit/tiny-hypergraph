import { findParallelBlockerPath } from "./parallel/findParallelBlockerPath"

import { SelectiveReripTinyHyperGraphSolver } from "./selective-rerip-tiny-hyper-graph-solver"
import { OutsideInPartialRipTinyHyperGraphSolver } from "./outside-in-partial-rip-tiny-hypergraph-solver"
import { shuffle } from "./shuffle"
import { WasmRoutePool, type WasmRouteExecutor } from "./parallel/WasmRoutePool"

import { acquireWorkerRuntime } from "./parallel/acquireWorkerRuntime"
export { WasmRouteTask, WasmRouteReadyTask } from "./parallel/WasmRouteTask"
export { findParallelBlockerPath } from "./parallel/findParallelBlockerPath"
export type { WasmRouteExecutor } from "./parallel/WasmRoutePool"

const activeSolvers = new WeakSet<OutsideInPartialRipTinyHyperGraphSolver>()

/** Use compiled route searches and parallel region/blocker work, preserving route commit order. */
export async function solveWithWasmRoutes(
  solver: OutsideInPartialRipTinyHyperGraphSolver,
  executor: WasmRouteExecutor,
  stopAtIteration = solver.MAX_ITERATIONS,
): Promise<void> {
  if (activeSolvers.has(solver))
    throw new Error("Parallel routing is already running")
  activeSolvers.add(solver)
  const release = await acquireWorkerRuntime(executor)
  const service: { pool?: WasmRoutePool } = {}
  try {
    await solve(solver, executor, stopAtIteration, service)
  } finally {
    if (service.pool) {
      const pairs = service.pool.geometryPairsByWorker
      solver.stats.parallelGeometryPairs = pairs
        .slice(1)
        .reduce((sum, value) => sum + value, 0)
      solver.stats.geometryPairs = pairs.reduce((sum, value) => sum + value, 0)
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
  executor: WasmRouteExecutor,
  stopAtIteration: number,
  service: { pool?: WasmRoutePool },
): Promise<void> {
  if (solver.deferFinalRouteAcceptance)
    throw new Error("Wasm routing is already running")
  const selective =
    solver instanceof SelectiveReripTinyHyperGraphSolver ? solver : undefined
  const priorOwnerSearch = selective?.blockerPathSearch
  if (selective)
    selective.blockerPathSearch = (context) =>
      findParallelBlockerPath(selective, context)
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
        "wasmRouteSearches",
        "wasmRouteExpansions",
        "wasmRouteWaves",
        "parallelOwnerSearches",
        "parallelOwnerGraphRows",
        "parallelOwnerSearchMs",
        "parallelRegionCostTables",
        "parallelPortMasks",
        "parallelConnectivityChecks",
        "parallelConnectivitySavedExpansions",
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
    if (selective) selective.blockerPathSearch = priorOwnerSearch
    solver.deferFinalRouteAcceptance = false
    solver.hasDeferredFinalRouteAcceptance = false
  }
}
async function route(
  solver: OutsideInPartialRipTinyHyperGraphSolver,
  executor: WasmRouteExecutor,
  limit: number,
  service: { pool?: WasmRoutePool },
): Promise<void> {
  solver.setup()
  if (limit < solver.MAX_ITERATIONS) {
    while (!solver.solved && !solver.failed && solver.iterations < limit)
      solver.step()
    return
  }
  const priorOwnerHook =
    solver instanceof SelectiveReripTinyHyperGraphSolver
      ? solver.blockerPathSearch
      : undefined
  let pool: WasmRoutePool | undefined,
    searches = 0,
    expansions = 0,
    waves = 0,
    ownerStart = 0,
    ownerTimeStart = 0,
    tableStart = 0,
    maskStart = 0,
    checkStart = 0,
    savedStart = 0,
    ownerRowsStart = 0
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
          pool = new WasmRoutePool(solver, executor)
          service.pool = pool
          await pool.start()
        }
      }
      if (searches === 0) {
        ownerStart = pool.ownerSearches
        ownerTimeStart = pool.ownerSearchMs
        tableStart = pool.regionCostTables
        maskStart = pool.parallelPortMasks
        checkStart = pool.parallelConnectivityChecks
        savedStart = pool.parallelConnectivitySavedExpansions
        ownerRowsStart = pool.ownerGraphRows
      }
      if (solver instanceof SelectiveReripTinyHyperGraphSolver)
        solver.blockerPathSearch = (context) =>
          findParallelBlockerPath(
            solver,
            context,
            (options, geometry, forbidden) =>
              pool!.searchOwners(options, geometry, forbidden),
          )
      const remaining = limit - solver.iterations,
        result = await pool.search(routeId, remaining)
      searches++
      expansions += result.iterations
      waves += pool.waves
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
    if (solver instanceof SelectiveReripTinyHyperGraphSolver)
      solver.blockerPathSearch = priorOwnerHook
    solver.stats = {
      ...solver.stats,
      // A search starts only after every persistent helper acknowledges startup.
      parallelRouteWorkers: searches > 0 ? pool!.threads - 1 : 0,
      wasmRouteSearches: searches,
      wasmRouteExpansions: expansions,
      wasmRouteWaves: waves,
      parallelOwnerSearches: (pool?.ownerSearches ?? 0) - ownerStart,
      parallelOwnerGraphRows: (pool?.ownerGraphRows ?? 0) - ownerRowsStart,
      parallelOwnerSearchMs: (pool?.ownerSearchMs ?? 0) - ownerTimeStart,
      parallelRegionCostTables: (pool?.regionCostTables ?? 0) - tableStart,
      parallelPortMasks: (pool?.parallelPortMasks ?? 0) - maskStart,
      parallelConnectivityChecks:
        (pool?.parallelConnectivityChecks ?? 0) - checkStart,
      parallelConnectivitySavedExpansions:
        (pool?.parallelConnectivitySavedExpansions ?? 0) - savedStart,
    }
  }
}
