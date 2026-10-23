import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "../lib/core"
import { IndexedCandidateHeap } from "../lib/indexed-candidate-heap"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"

class ObservedSelectiveSolver extends SelectiveReripTinyHyperGraphSolver {
  readonly parentQueueSizes: number[] = []
  readonly children: TinyHyperGraphSolver[] = []

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
    attempt: number,
  ): TinyHyperGraphSolver {
    this.parentQueueSizes.push(this.state.candidateQueue.length)
    const child = super.createGreedyFinalRouteSolver(options, attempt)
    this.children.push(child)
    return child
  }
}

test("terminal indexed searches preserve successful final routing", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 5,
    regionIncidentPorts: [[0, 1], [1, 2], [2, 3], [0], [3]],
    incidentPortRegion: [
      [0, 3],
      [0, 1],
      [1, 2],
      [2, 4],
    ],
    regionWidth: new Float64Array(5).fill(10),
    regionHeight: new Float64Array(5).fill(10),
    regionCenterX: new Float64Array(5),
    regionCenterY: new Float64Array(5),
    portAngleForRegion1: new Int32Array(4),
    portX: Float64Array.from([0, 1, 2, 3]),
    portY: new Float64Array(4),
    portZ: new Int32Array(4),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: Int32Array.from([0]),
    routeEndPort: Int32Array.from([3]),
    routeNet: Int32Array.from([7]),
    regionNetId: new Int32Array(5).fill(-1),
  }
  let reference:
    | {
        output: ReturnType<TinyHyperGraphSolver["getOutput"]>
        stats: Record<string, unknown>
      }
    | undefined
  for (const owned of [false, true]) {
    const solver = new ObservedSelectiveSolver(topology, problem, {
      OWNED_REGIONAL_HOP_FRONTIER: owned,
      MAX_ITERATIONS: 1,
      GREEDY_FINAL_ROUTE_ITERS: 2,
      STATIC_REACHABILITY_PRECHECK: false,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      OUTSIDE_IN_ROUTING: false,
      PARTIAL_RIP_ENABLED: false,
    })
    solver.solve()
    expect(solver.state.candidateQueue).toBeInstanceOf(IndexedCandidateHeap)
    expect(solver.parentQueueSizes).toEqual([owned ? 0 : 1])
    expect(solver.iterations).toBe(1)
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.children.length).toBe(1)
    expect(solver.children[0]!.solved).toBe(true)
    expect(solver.children[0]!.MAX_ITERATIONS).toBe(50_000)
    expect(solver.stats.acceptedGreedyFinalRouteOnTimeout).toBe(true)
    expect(solver.stats.finalRoutingStrategy).toBe("congestion-aware")
    if (reference) {
      expect(solver.getOutput()).toEqual(reference.output)
      expect(solver.stats).toEqual(reference.stats)
    }
    reference = { output: solver.getOutput(), stats: solver.stats }
  }
})
