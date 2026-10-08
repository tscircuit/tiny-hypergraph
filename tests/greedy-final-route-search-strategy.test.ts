import { expect, test } from "bun:test"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "lib/index"

const createTopology = (portCount: number): TinyHyperGraphTopology => ({
  portCount,
  regionCount: 1,
  regionIncidentPorts: [[0, 1]],
  incidentPortRegion: Array.from({ length: portCount }, (_, portId) =>
    portId < 2 ? [0] : [],
  ),
  regionWidth: new Float64Array([1]),
  regionHeight: new Float64Array([1]),
  regionCenterX: new Float64Array([0]),
  regionCenterY: new Float64Array([0]),
  portAngleForRegion1: new Int32Array(portCount),
  portAngleForRegion2: new Int32Array(portCount),
  portX: new Float64Array(portCount),
  portY: new Float64Array(portCount),
  portZ: new Int32Array(portCount),
})

const createProblem = (portCount: number): TinyHyperGraphProblem => ({
  routeCount: 1,
  portSectionMask: new Int8Array(portCount).fill(1),
  routeStartPort: new Int32Array([0]),
  routeEndPort: new Int32Array([1]),
  routeNet: new Int32Array([0]),
  regionNetId: new Int32Array([-1]),
})

class GreedyFinalRouteProbe extends TinyHyperGraphSolver {
  greedyOptions?: TinyHyperGraphSolverOptions

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
  ): TinyHyperGraphSolver {
    this.greedyOptions = options
    return super.createGreedyFinalRouteSolver(options)
  }

  runGreedyFinalRouteAcceptance(): boolean {
    return this.tryGreedyFinalRouteAcceptance()
  }
}

class OutsideInGreedyFinalRouteProbe extends OutsideInPartialRipTinyHyperGraphSolver {
  getGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
  ): TinyHyperGraphSolver {
    return this.createGreedyFinalRouteSolver(options)
  }
}

test("final completion keeps the route-search strategy and scales to the topology", () => {
  const largePortCount = 50_001
  const budgetProbe = new GreedyFinalRouteProbe(
    createTopology(largePortCount),
    createProblem(largePortCount),
    {
      GREEDY_FINAL_ROUTE_ITERS: 1,
      STATIC_REACHABILITY_PRECHECK: false,
    },
  )

  expect(budgetProbe.runGreedyFinalRouteAcceptance()).toBe(true)
  expect(budgetProbe.greedyOptions?.MAX_ITERATIONS).toBe(largePortCount)

  const outsideInProbe = new OutsideInGreedyFinalRouteProbe(
    createTopology(2),
    createProblem(2),
    {
      PARTIAL_RIP_ENABLED: false,
      OUTSIDE_IN_ROUTING: true,
      WHOLE_ROUTE_OUTSIDE_IN_ROUTING: true,
      STATIC_REACHABILITY_PRECHECK: false,
    },
  )
  const greedySolver = outsideInProbe.getGreedyFinalRouteSolver({
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: true,
    WHOLE_ROUTE_OUTSIDE_IN_ROUTING: true,
  })

  expect(greedySolver).toBeInstanceOf(OutsideInPartialRipTinyHyperGraphSolver)
})
