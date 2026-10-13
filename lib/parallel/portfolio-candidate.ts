import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
  type TinyHyperGraphSolverOptions,
} from "../core"
import { shuffle } from "../shuffle"
import { CachedPortfolioSolver } from "./CachedPortfolioSolver"
import { CachedDistancePortfolioSolver } from "./CachedDistancePortfolioSolver"

export const PORTFOLIO_PLANS = [
  { solver: "legacy", distance: 0.05, congestion: 0.1 },
  { solver: "distance", distance: 0.05, congestion: 0.1 },
  { solver: "distance", distance: 0.025, congestion: 0.1 },
  { solver: "distance", distance: 0.05, congestion: 0.2 },
  { solver: "distance", distance: 0.1, congestion: 0.1 },
  { solver: "distance", distance: 0.1, congestion: 0.2 },
  { solver: "distance", distance: 0.025, congestion: 0.2 },
  { solver: "distance", distance: 0.05, congestion: 0.4 },
] as const

export interface PortfolioCandidate {
  index: number
  solved: boolean
  failed: boolean
  error: string | null
  iterations: number
  searchSettings: {
    solver: "legacy" | "distance"
    distanceToCost: number
    ripCongestionFactor: number
    greedyFinalRouteIters: number
  }
  stats: TinyHyperGraphSolver["stats"]
  quality: {
    maxRegionCost: number
    totalRegionCost: number
    singleLayerRegions: number
    singleLayerIntersections: number
    pathLength: number
    layerChanges: number
    segments: number
  }
}

export function runPortfolioCandidate(
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  options: TinyHyperGraphSolverOptions,
  index: number,
) {
  const plan = PORTFOLIO_PLANS[index]
  const { distance, congestion } = plan
  const Solver =
    plan.solver === "legacy"
      ? CachedPortfolioSolver
      : CachedDistancePortfolioSolver
  const solver = new Solver(topology, problem, {
    DISTANCE_TO_COST: distance,
    RIP_CONGESTION_REGION_COST_FACTOR: congestion,
    GREEDY_FINAL_ROUTE_ITERS: plan.solver === "distance" ? 0 : 4,
    ...options,
  })
  // Candidate zero retains the original order. Remaining seeds are fixed,
  // independently of worker count or completion order.
  if (index)
    solver.state.unroutedRoutes = shuffle(solver.state.unroutedRoutes, index)
  solver.solve()
  let maxRegionCost = 0,
    totalRegionCost = 0
  let singleLayerRegions = 0,
    singleLayerIntersections = 0,
    pathLength = 0,
    layerChanges = 0,
    segments = 0
  for (let r = 0; r < topology.regionCount; r++) {
    const cache = solver.state.regionIntersectionCaches[r]
    maxRegionCost = Math.max(maxRegionCost, cache.existingRegionCost)
    totalRegionCost += cache.existingRegionCost
    if (
      solver.isKnownSingleLayerRegion(r) &&
      cache.existingSameLayerIntersections > 0
    ) {
      singleLayerRegions++
      singleLayerIntersections += cache.existingSameLayerIntersections
    }
    for (const [route, a, b] of solver.state.regionSegments[r]) {
      if (
        solver.state.portAssignment[a] !== problem.routeNet[route] ||
        solver.state.portAssignment[b] !== problem.routeNet[route]
      )
        throw new Error("Portfolio ownership invariant violated")
      const dx = topology.portX[a] - topology.portX[b],
        dy = topology.portY[a] - topology.portY[b]
      pathLength += Math.sqrt(dx * dx + dy * dy)
      layerChanges += Number(topology.portZ[a] !== topology.portZ[b])
      segments++
    }
  }
  const candidate: PortfolioCandidate = {
    index,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    searchSettings: {
      solver: plan.solver,
      distanceToCost: solver.DISTANCE_TO_COST,
      ripCongestionFactor: solver.RIP_CONGESTION_REGION_COST_FACTOR,
      greedyFinalRouteIters: solver.GREEDY_FINAL_ROUTE_ITERS,
    },
    stats: solver.stats,
    quality: {
      maxRegionCost,
      totalRegionCost,
      singleLayerRegions,
      singleLayerIntersections,
      pathLength,
      layerChanges,
      segments,
    },
  }
  return { solver, candidate }
}

export function comparePortfolioCandidates(
  a: PortfolioCandidate,
  b: PortfolioCandidate,
) {
  const completeA = a.solved && !a.failed,
    completeB = b.solved && !b.failed
  if (completeA !== completeB) return completeA ? -1 : 1
  if (!completeA) return a.index - b.index
  return (
    a.quality.singleLayerIntersections - b.quality.singleLayerIntersections ||
    a.quality.maxRegionCost - b.quality.maxRegionCost ||
    a.quality.totalRegionCost - b.quality.totalRegionCost ||
    a.index - b.index
  )
}
