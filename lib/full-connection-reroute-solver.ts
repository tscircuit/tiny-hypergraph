import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getOrderedRoutePath } from "./compat/convertToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "./compat/loadSerializedHyperGraph"
import { BaseSolver } from "@tscircuit/solver-utils"
import {
  TinyHyperGraphSolver,
  createEmptyRegionIntersectionCache,
  type TinyHyperGraphProblem,
  type TinyHyperGraphProblemSetup,
  type TinyHyperGraphSolution,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "./core"
import { TinyHyperGraphSectionSolver } from "./section-solver"

export interface FullConnectionRerouteOptions {
  maxHotRegions?: number
  maxAttempts?: number
  maxIterationsPerAttempt?: number
}

// Keep every other connection fixed, and never reseed/rip the graph on failure.
class AvoidRegionRouteSolver extends TinyHyperGraphSolver {
  sharedProblemSetup?: TinyHyperGraphProblemSetup
  private reservedPorts!: Uint8Array
  private reservedRegions!: Uint8Array
  private routeHeuristic!: Float64Array

  prepareAttempt(regionId: number, routeId: number): void {
    const netId = this.problem.routeNet[routeId]!
    const reservations = this.problemSetup.portEndpointReservationNetId
    this.reservedPorts = Uint8Array.from(reservations, (reservedNetId) =>
      Number(
        reservedNetId === -2 ||
          (reservedNetId !== -1 && reservedNetId !== netId),
      ),
    )
    this.reservedRegions = Uint8Array.from(
      this.problem.regionNetId,
      (reservedNetId, id) =>
        Number(
          id === regionId ||
            (reservedNetId !== -1 && reservedNetId !== netId),
        ),
    )
    const endPortId = this.problem.routeEndPort[routeId]!
    const endX = this.topology.portX[endPortId]!
    const endY = this.topology.portY[endPortId]!
    this.routeHeuristic = Float64Array.from(this.topology.portX, (x, portId) => {
      const dx = x - endX
      const dy = this.topology.portY[portId]! - endY
      return Math.sqrt(dx * dx + dy * dy) * this.DISTANCE_TO_COST
    })
  }

  override computeProblemSetup(): TinyHyperGraphProblemSetup {
    // Every attempt has the same topology, endpoints, nets, and options.
    return this.sharedProblemSetup ?? super.computeProblemSetup()
  }

  override isPortReservedForDifferentNet(portId: number): boolean {
    return this.reservedPorts[portId] === 1
  }

  override isRegionReservedForDifferentNet(regionId: number): boolean {
    return this.reservedRegions[regionId] === 1
  }

  override computeH(portId: number): number {
    return this.routeHeuristic[portId]!
  }

  override getStartingNextRegionId(
    routeId: number,
    startingPortId: number,
  ): number | undefined {
    const preferredRegion = super.getStartingNextRegionId(
      routeId,
      startingPortId,
    )
    if (
      preferredRegion !== undefined &&
      !this.isRegionReservedForDifferentNet(preferredRegion)
    ) {
      return preferredRegion
    }
    return this.topology.incidentPortRegion[startingPortId]?.find(
      (regionId) => !this.isRegionReservedForDifferentNet(regionId),
    )
  }

  canonicalizeRegionCosts(routeId: number): void {
    const routeSegments = this.state.regionSegments.flatMap(
      (segments, regionId) =>
        segments
          .filter(([segmentRouteId]) => segmentRouteId === routeId)
          .map(([, fromPortId, toPortId]) => ({ regionId, fromPortId, toPortId })),
    )
    // Use the serializer's exact path extraction, including removal of loops.
    const path = getOrderedRoutePath(this, routeId, routeSegments)
    const canonicalRouteByRegion = new Map<
      number,
      Array<[number, number, number]>
    >()
    for (let index = 0; index < path.orderedRegionIds.length; index++) {
      const regionId = path.orderedRegionIds[index]!
      let segments = canonicalRouteByRegion.get(regionId)
      if (!segments) {
        segments = []
        canonicalRouteByRegion.set(regionId, segments)
      }
      segments.push([
        routeId,
        path.orderedPortIds[index]!,
        path.orderedPortIds[index + 1]!,
      ])
    }
    const affectedRegionIds = new Set(
      routeSegments.map((segment) => segment.regionId),
    )
    for (const regionId of affectedRegionIds) {
      const segments = this.state.regionSegments[regionId]!
        .filter(([segmentRouteId]) => segmentRouteId !== routeId)
        .concat(canonicalRouteByRegion.get(regionId) ?? [])
        .sort((a, b) => a[0] - b[0])
      // Equal-angle crossings are order-sensitive. Fixed routes are already
      // canonical; only caches touched by the newly searched route need replay.
      this.state.regionIntersectionCaches[regionId] =
        createEmptyRegionIntersectionCache()
      for (const [segmentRouteId, fromPortId, toPortId] of segments) {
        this.state.currentRouteNetId = this.problem.routeNet[segmentRouteId]
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }
    this.state.currentRouteNetId = undefined
  }

  override onAllRoutesRouted(): void {
    this.solved = true
  }

  override onOutOfCandidates(): void {
    this.failed = true
    this.error = "No route avoiding the selected high-cost region"
  }
}

const summarize = (solver: TinyHyperGraphSolver) => {
  const costs = solver.state.regionIntersectionCaches.map(
    (cache) => cache.existingRegionCost,
  )
  return {
    max: costs.reduce((max, cost) => Math.max(max, cost), 0),
    total: costs.reduce((total, cost) => total + cost, 0),
    estimatedVias: solver.state.regionIntersectionCaches.reduce(
      (sum, cache) =>
        sum +
        2 * cache.existingSameLayerIntersections +
        cache.existingCrossingLayerIntersections +
        cache.existingEntryExitLayerChanges,
      0,
    ),
    layerChanges: solver.state.regionIntersectionCaches.reduce(
      (sum, cache) => sum + cache.existingEntryExitLayerChanges,
      0,
    ),
    segments: solver.state.regionIntersectionCaches.reduce(
      (sum, cache) => sum + cache.existingSegmentCount,
      0,
    ),
  }
}

/** Try full connections individually; only retain strict whole-graph improvements. */
export class FullConnectionRerouteSolver extends BaseSolver {
  bestSolver: TinyHyperGraphSolver
  private acceptedOutput: SerializedHyperGraph
  private attempts: Array<{ regionId: number; routeId: number }>
  private hotRegionIds: number[]
  private candidate?: AvoidRegionRouteSolver
  private sharedProblemSetup?: TinyHyperGraphProblemSetup
  private attemptIndex = 0
  private accepted = 0
  private reroutedRouteIds = new Set<number>()
  private initialScore: ReturnType<typeof summarize>

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    solution: TinyHyperGraphSolution,
    public solverOptions: TinyHyperGraphSolverOptions = {},
    public options: FullConnectionRerouteOptions = {},
    serializedInput?: SerializedHyperGraph,
    private loadHyperGraph: typeof loadSerializedHyperGraph = loadSerializedHyperGraph,
  ) {
    super()
    this.bestSolver = new TinyHyperGraphSectionSolver(
      topology,
      problem,
      solution,
      solverOptions,
    ).baselineSolver
    this.acceptedOutput = serializedInput ?? this.bestSolver.getOutput()
    this.initialScore = summarize(this.bestSolver)
    this.hotRegionIds = this.bestSolver.state.regionIntersectionCaches
      .map((cache, regionId) => ({ regionId, cost: cache.existingRegionCost }))
      .filter(({ cost }) => cost > 0)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, options.maxHotRegions ?? 8)
      .map(({ regionId }) => regionId)
    this.attempts = this.hotRegionIds
      .flatMap((regionId) =>
        [
          ...new Set(
            this.bestSolver.state.regionSegments[regionId]!.map(
              ([routeId]) => routeId,
            ),
          ),
        ]
          // Boundary endpoints can escape through their other incident region.
          // Only skip endpoints that have no incident region outside the blocked one.
          .filter(
            (routeId) =>
              topology.incidentPortRegion[
                problem.routeStartPort[routeId]!
              ]!.some((incidentRegionId) => incidentRegionId !== regionId) &&
              topology.incidentPortRegion[problem.routeEndPort[routeId]!]!.some(
                (incidentRegionId) => incidentRegionId !== regionId,
              ),
          )
          .map((routeId) => ({ regionId, routeId })),
      )
      .slice(0, options.maxAttempts ?? 64)
    this.MAX_ITERATIONS =
      (options.maxIterationsPerAttempt ?? 20_000) * this.attempts.length +
      this.attempts.length +
      1
  }

  override _step(): void {
    if (!this.candidate) {
      const attempt = this.attempts[this.attemptIndex]
      if (!attempt) {
        this.finish()
        return
      }
      const initialAssignments = this.bestSolver.state.regionSegments.flatMap(
        (segments, regionId) =>
          segments
            .filter(([routeId]) => routeId !== attempt.routeId)
            .map(([routeId, fromPortId, toPortId]) => ({
              routeId,
              regionId,
              fromPortId,
              toPortId,
            })),
      )
      this.candidate = new AvoidRegionRouteSolver(
        this.topology,
        {
          ...this.problem,
          portSectionMask: new Int8Array(this.topology.portCount).fill(1),
          initialAssignments,
        },
        {
          ...this.solverOptions,
          // Only one connection is active. Avoid a portCount * routeCount
          // distance table for the connections fixed by initialAssignments.
          USE_LAZY_ROUTE_HEURISTIC:
            this.solverOptions.USE_LAZY_ROUTE_HEURISTIC ?? true,
          MAX_ITERATIONS: this.options.maxIterationsPerAttempt ?? 20_000,
          STATIC_REACHABILITY_PRECHECK: false,
          ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
          GREEDY_FINAL_ROUTE_ITERS: 0,
        },
      )
      this.candidate.sharedProblemSetup = this.sharedProblemSetup
      this.candidate.prepareAttempt(attempt.regionId, attempt.routeId)
      this.sharedProblemSetup = this.candidate.problemSetup
    }
    // A search expansion is tiny, but each outer pipeline step rebuilds its
    // diagnostic stats. Batch expansions while preserving the candidate's own
    // iteration limit and stopping immediately when it finishes.
    for (let expansion = 0; expansion < 256; expansion++) {
      this.candidate.step()
      if (this.candidate.solved || this.candidate.failed) break
    }
    if (!this.candidate.solved && !this.candidate.failed) return
    if (this.candidate.solved && !this.candidate.failed) {
      const before = summarize(this.bestSolver)
      this.candidate.canonicalizeRegionCosts(
        this.attempts[this.attemptIndex]!.routeId,
      )
      if (!this.improvesScore(this.candidate, before)) {
        this.candidate = undefined
        this.attemptIndex += 1
        return
      }
      const candidateOutput = this.candidate.getOutput()
      const replay = this.loadHyperGraph(candidateOutput)
      const replaySolver = new TinyHyperGraphSectionSolver(
        replay.topology,
        replay.problem,
        replay.solution,
        this.solverOptions,
      ).baselineSolver
      if (this.improvesScore(replaySolver, before)) {
        this.bestSolver = replaySolver
        this.acceptedOutput = candidateOutput
        this.accepted += 1
        this.reroutedRouteIds.add(this.attempts[this.attemptIndex]!.routeId)
      }
    }
    this.candidate = undefined
    this.attemptIndex += 1
  }

  private improvesScore(
    solver: TinyHyperGraphSolver,
    before: ReturnType<typeof summarize>,
  ): boolean {
    const after = summarize(solver)
    return (
      // Moving crossings into a larger region lowers its area-normalized
      // cost even when it introduces more vias or longer region detours.
      // Preserve the unweighted via estimate and downstream path complexity.
      after.estimatedVias < before.estimatedVias &&
      after.layerChanges <= before.layerChanges &&
      after.segments + 2 * after.estimatedVias <=
        before.segments + 2 * before.estimatedVias &&
      after.total <= before.total + 1e-9 &&
      // A lower maximum must not hide increased congestion in another
      // high-cost region selected for this pass.
      this.hotRegionIds.every(
        (regionId) =>
          solver.state.regionIntersectionCaches[regionId]!
            .existingRegionCost <=
          this.bestSolver.state.regionIntersectionCaches[regionId]!
            .existingRegionCost + 1e-9,
      ) &&
      (after.max < before.max - 1e-9 ||
        (Math.abs(after.max - before.max) <= 1e-9 &&
          after.max <= before.max &&
          after.total < before.total - 1e-9))
    )
  }

  private finish(): void {
    const score = summarize(this.bestSolver)
    this.stats = {
      ...this.stats,
      rerouteAttempts: this.attemptIndex,
      acceptedReroutes: this.accepted,
      reroutedRouteCount: this.reroutedRouteIds.size,
      initialMaxRegionCost: this.initialScore.max,
      finalMaxRegionCost: score.max,
      initialTotalRegionCost: this.initialScore.total,
      finalTotalRegionCost: score.total,
      initialEstimatedViaCount: this.initialScore.estimatedVias,
      finalEstimatedViaCount: score.estimatedVias,
      initialLayerChangeCount: this.initialScore.layerChanges,
      finalLayerChangeCount: score.layerChanges,
      initialSegmentCount: this.initialScore.segments,
      finalSegmentCount: score.segments,
    }
    this.solved = true
  }

  override tryFinalAcceptance(): void {
    // The incumbent is always complete, including when the search budget expires.
    this.finish()
  }

  getSolvedSolver(): TinyHyperGraphSolver {
    return this.bestSolver
  }

  override getOutput() {
    return this.acceptedOutput
  }

  override visualize() {
    return this.bestSolver.visualize()
  }
}
