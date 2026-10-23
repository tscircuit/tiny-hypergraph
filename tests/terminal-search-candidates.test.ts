import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "../lib/core"

class ObservedFinalSolver extends TinyHyperGraphSolver {
  readonly children: TinyHyperGraphSolver[] = []
  readonly parentQueueSizes: number[] = []
  readonly previousChildQueueSizes: number[] = []

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
    attempt: number,
  ): TinyHyperGraphSolver {
    this.parentQueueSizes.push(this.state.candidateQueue.toArray().length)
    const previous = this.children.at(-1)
    if (previous) {
      this.previousChildQueueSizes.push(
        previous.state.candidateQueue.toArray().length,
      )
    }
    const child = super.createGreedyFinalRouteSolver(options, attempt)
    child.MAX_ITERATIONS = 1
    this.children.push(child)
    return child
  }
}

test("terminal owned searches release queued paths before replacement searches", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 3,
    regionIncidentPorts: [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
    incidentPortRegion: [[0], [0, 1], [1, 2], [2]],
    regionWidth: new Float64Array(3).fill(10),
    regionHeight: new Float64Array(3).fill(10),
    regionCenterX: new Float64Array(3),
    regionCenterY: new Float64Array(3),
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
    regionNetId: new Int32Array(3).fill(-1),
  }
  for (const { owned, terminal } of [
    { owned: true, terminal: true },
    { owned: false, terminal: true },
    { owned: true, terminal: false },
  ]) {
    const solver = new ObservedFinalSolver(topology, problem, {
      OWNED_REGIONAL_HOP_FRONTIER: owned,
      MAX_ITERATIONS: 10,
      GREEDY_FINAL_ROUTE_ITERS: 2,
      STATIC_REACHABILITY_PRECHECK: false,
    })
    solver._setup()
    solver.state.candidateQueue.queue({
      portId: 0,
      nextRegionId: 0,
      g: 0,
      h: 0,
      f: 0,
    })
    solver.iterations = terminal ? solver.MAX_ITERATIONS : 0
    const assignments = solver.state.portAssignment.slice()
    solver.tryFinalAcceptance()
    const retained = owned && terminal ? 0 : 1
    expect(solver.parentQueueSizes).toEqual([retained, retained])
    expect(solver.previousChildQueueSizes).toEqual([retained])
    expect(solver.children.map((child): boolean => child.failed)).toEqual([
      true,
      true,
    ])
    expect(solver.children.map((child): number => child.iterations)).toEqual([
      1, 1,
    ])
    expect(solver.state.portAssignment).toEqual(assignments)
    expect(solver.stats.greedyFinalRouteAttemptCount).toBe(2)
    expect(solver.stats.greedyFinalRouteMaxIterations).toBe(1)
  }
})
