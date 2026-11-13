import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  DistanceAwareTinyHyperGraphSolver,
  OutsideInPartialRipTinyHyperGraphSolver,
  SelectiveReripTinyHyperGraphSolver,
  type TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
} from "lib/index"
import { createImmutablePortCopperGraph } from "tests/fixtures/immutable-port-copper"

type SolverConstructor = typeof DistanceAwareTinyHyperGraphSolver

const snapshot = (solver: TinyHyperGraphSolver): unknown =>
  structuredClone({
    route: solver.state.currentRouteId,
    net: solver.state.currentRouteNetId,
    goal: solver.state.goalPortId,
    queue: solver.state.candidateQueue.toArray(),
    costs: solver.state.candidateBestCostByHopId,
    generations: solver.state.candidateBestCostGenerationByHopId,
    generation: solver.state.candidateBestCostGeneration,
    assignments: solver.state.portAssignment,
    segments: solver.state.regionSegments,
    caches: solver.state.regionIntersectionCaches,
    congestion: solver.state.regionCongestionCost,
    unrouted: solver.state.unroutedRoutes,
    ripCount: solver.state.ripCount,
    iterations: solver.iterations,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    stats: solver.stats,
  })

const compare = (
  graph: SerializedHyperGraph,
  Solver: SolverConstructor,
  options: TinyHyperGraphSolverOptions,
): TinyHyperGraphSolver => {
  const original = structuredClone(graph)
  const makeSolver = (owned: boolean | undefined): TinyHyperGraphSolver => {
    const { topology, problem } = loadSerializedHyperGraph(graph)
    return new Solver(topology, problem, {
      ...options,
      OWNED_REGIONAL_HOP_FRONTIER: owned,
    })
  }
  const baseline = makeSolver(false)
  const optimized = makeSolver(true)
  const unspecified = makeSolver(undefined)
  expect(optimized.OWNED_REGIONAL_HOP_FRONTIER).toBeTrue()
  expect(unspecified.OWNED_REGIONAL_HOP_FRONTIER).toBeFalse()
  for (let steps = 0; steps < 10000; steps++) {
    expect(snapshot(optimized)).toEqual(snapshot(baseline))
    expect(snapshot(unspecified)).toEqual(snapshot(baseline))
    if (baseline.solved || baseline.failed) break
    baseline.step()
    optimized.step()
    unspecified.step()
  }
  expect(baseline.solved || baseline.failed).toBeTrue()
  if (baseline.solved) {
    expect(optimized.getOutput()).toEqual(baseline.getOutput())
    expect(unspecified.getOutput()).toEqual(baseline.getOutput())
  }
  expect(optimized.topology.portReservedNetId).toEqual(
    baseline.topology.portReservedNetId,
  )
  expect(graph).toEqual(original)
  return optimized
}

test("owned frontier preserves physical copper", (): void => {
  const options: TinyHyperGraphSolverOptions = {
    VIA_COST: 0.6,
    CROSS_LAYER_INTERSECTION_COST_FACTOR: 1,
    TRACE_DENSITY_COST_FACTOR: 10,
    PARTIAL_RIP_ENABLED: true,
    PARTIAL_RIP_MIN_ROUTE_COUNT: 0,
    PARTIAL_RIP_MAX_ATTEMPTS: 7,
    PARTIAL_RIP_WARMUP_FULL_RIP_ATTEMPTS: 1,
    PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO: Number.POSITIVE_INFINITY,
    PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO: 0.1,
    OUTSIDE_IN_ROUTING: true,
    RIP_THRESHOLD_START: 0,
    RIP_THRESHOLD_END: 0,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 3,
    STATIC_REACHABILITY_PRECHECK: false,
  }
  for (const Solver of [
    DistanceAwareTinyHyperGraphSolver,
    OutsideInPartialRipTinyHyperGraphSolver,
    SelectiveReripTinyHyperGraphSolver,
  ]) {
    for (const sparse of [false, true]) {
      for (const [net, reservations, middle] of [
        ["net-a", ["net-a"], "occupied"],
        ["net-b", ["net-a"], "alternate"],
        ["net-a", ["net-a", "net-c"], "alternate"],
      ] as const) {
        const graph = createImmutablePortCopperGraph([net], reservations)
        graph.ports.find((port) => port.portId === "alternate")!.d.z = 1
        for (const region of graph.regions) {
          if (region.regionId === "left" || region.regionId === "right") {
            region.d.availableZ = [0, 1]
            // Repeated occurrences exercise the ordered frontier contract.
            region.pointIds.push("occupied", "alternate")
          }
        }
        const solver = compare(graph, Solver, {
          ...options,
          USE_SPARSE_CANDIDATE_STORAGE: sparse,
        })
        expect(solver.failed).toBeFalse()
        expect(
          solver
            .getOutput()
            .solvedRoutes![0]!.path.map((point): string => point.portId),
        ).toEqual(["start-0", middle, "end-0"])
        expect(
          solver.state.regionIntersectionCaches.reduce(
            (sum, cache): number => sum + cache.existingEntryExitLayerChanges,
            0,
          ),
        ).toBe(middle === "occupied" ? 0 : 2)
        if (Solver !== DistanceAwareTinyHyperGraphSolver) {
          expect(solver.stats.outsideInCompletedRouteCount).toBeGreaterThan(0)
          expect(solver.stats.partialRipCount).toBeGreaterThan(0)
        }
      }
    }
  }

  for (const connectedLayers of [[0], [0, 1]]) {
    const graph = createImmutablePortCopperGraph(["net-a"], ["net-a"])
    // Both incident regions are owned. Enter the connected body first rather
    // than the one-port terminal cap, matching a native owned pad contact.
    graph.ports[0]!.region1Id = "left"
    graph.ports[0]!.region2Id = "start-region-0"
    graph.ports.find((port) => port.portId === "occupied")!.d.z = 1
    for (const region of graph.regions) {
      if (region.regionId === "left" || region.regionId === "right") {
        region.d.availableZ = [0, 1]
        region.d.connectedZ = connectedLayers
        region.d.netId = 0
      }
    }
    const solver = compare(graph, DistanceAwareTinyHyperGraphSolver, options)
    expect(solver.failed).toBeFalse()
    expect(solver.getOutput().solvedRoutes![0]!.path[1]!.portId).toBe(
      connectedLayers.length === 2 ? "occupied" : "alternate",
    )
    expect(
      solver.state.regionIntersectionCaches.reduce(
        (sum, cache): number => sum + cache.existingEntryExitLayerChanges,
        0,
      ),
    ).toBe(0)
  }

  for (const precheck of [false, true]) {
    for (const endpoint of [0, 1]) {
      const graph = createImmutablePortCopperGraph(["net-b"], ["net-a"])
      graph.ports[endpoint]!.d.immutableCopperNetIds = ["net-a"]
      const solver = compare(graph, DistanceAwareTinyHyperGraphSolver, {
        ...options,
        STATIC_REACHABILITY_PRECHECK: precheck,
      })
      expect(solver.failed).toBeTrue()
      expect(solver.error).toContain("blocked by immutable copper")
    }
  }
})
