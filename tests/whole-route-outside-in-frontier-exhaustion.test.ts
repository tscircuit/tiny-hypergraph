import { expect, test } from "bun:test"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

class InspectableOutsideInSolver extends OutsideInPartialRipTinyHyperGraphSolver {
  outOfCandidatesIteration?: number

  override onOutOfCandidates(): void {
    this.outOfCandidatesIteration = this.iterations
    this.solved = true
  }
}

test("an exhausted whole-route frontier ends the outside-in search", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [[0], [1]],
    incidentPortRegion: [[0], [1]],
    regionWidth: new Float64Array(2).fill(1),
    regionHeight: new Float64Array(2).fill(1),
    regionCenterX: new Float64Array([0, 10]),
    regionCenterY: new Float64Array(2),
    portAngleForRegion1: new Int32Array(2),
    portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array([0, 10]),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(2).fill(1),
    routeStartPort: new Int32Array([0, 0]),
    routeEndPort: new Int32Array([1, 1]),
    routeNet: new Int32Array([0, 0]),
    regionNetId: new Int32Array(2).fill(-1),
    routeMetadata: [
      {
        simpleRouteConnection: {
          name: "root_mst0",
          __rootConnectionNames: ["root"],
        },
      },
      {
        simpleRouteConnection: {
          name: "root_mst1",
          __rootConnectionNames: ["root"],
        },
      },
    ],
  }
  const solver = new InspectableOutsideInSolver(topology, problem, {
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: true,
    MULTI_ROUTE_CONNECTION_OUTSIDE_IN_ROUTING: true,
    STATIC_REACHABILITY_PRECHECK: false,
  })

  solver.solve()

  expect(solver.outOfCandidatesIteration).toBe(1)
  expect(solver.stats.outsideInForwardExpansionCount).toBe(1)
  expect(solver.stats.outsideInReverseExpansionCount).toBe(0)
})

test("independent connections on one net keep one-ended search", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [[0], [1]],
    incidentPortRegion: [[0], [1]],
    regionWidth: new Float64Array(2).fill(1),
    regionHeight: new Float64Array(2).fill(1),
    regionCenterX: new Float64Array([0, 10]),
    regionCenterY: new Float64Array(2),
    portAngleForRegion1: new Int32Array(2),
    portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array([0, 10]),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(2).fill(1),
    routeStartPort: new Int32Array([0, 0]),
    routeEndPort: new Int32Array([1, 1]),
    routeNet: new Int32Array([0, 0]),
    regionNetId: new Int32Array(2).fill(-1),
    routeMetadata: [
      { connectionId: "connection-a" },
      { connectionId: "connection-b" },
    ],
  }
  const solver = new InspectableOutsideInSolver(topology, problem, {
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: true,
    MULTI_ROUTE_CONNECTION_OUTSIDE_IN_ROUTING: true,
    STATIC_REACHABILITY_PRECHECK: false,
  })

  solver.solve()

  expect(solver.outOfCandidatesIteration).toBe(2)
  expect(solver.stats.outsideInRouteCount).toBeUndefined()
})

test("connections below the configured route count keep one-ended search", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [[0], [1]],
    incidentPortRegion: [[0], [1]],
    regionWidth: new Float64Array(2).fill(1),
    regionHeight: new Float64Array(2).fill(1),
    regionCenterX: new Float64Array([0, 10]),
    regionCenterY: new Float64Array(2),
    portAngleForRegion1: new Int32Array(2),
    portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array([0, 10]),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(2).fill(1),
    routeStartPort: new Int32Array([0, 0]),
    routeEndPort: new Int32Array([1, 1]),
    routeNet: new Int32Array([0, 0]),
    regionNetId: new Int32Array(2).fill(-1),
    routeMetadata: [
      {
        simpleRouteConnection: {
          name: "root_mst0",
          __rootConnectionNames: ["root"],
        },
      },
      {
        simpleRouteConnection: {
          name: "root_mst1",
          __rootConnectionNames: ["root"],
        },
      },
    ],
  }
  const solver = new InspectableOutsideInSolver(topology, problem, {
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: true,
    MULTI_ROUTE_CONNECTION_OUTSIDE_IN_ROUTING: true,
    MULTI_ROUTE_CONNECTION_OUTSIDE_IN_MIN_ROUTE_COUNT: 3,
    STATIC_REACHABILITY_PRECHECK: false,
  })

  solver.solve()

  expect(solver.outOfCandidatesIteration).toBe(2)
  expect(solver.stats.outsideInRouteCount).toBeUndefined()
})

test("repeated connection names without root metadata keep one-ended search", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [[0], [1]],
    incidentPortRegion: [[0], [1]],
    regionWidth: new Float64Array(2).fill(1),
    regionHeight: new Float64Array(2).fill(1),
    regionCenterX: new Float64Array([0, 10]),
    regionCenterY: new Float64Array(2),
    portAngleForRegion1: new Int32Array(2),
    portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array([0, 10]),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(2).fill(1),
    routeStartPort: new Int32Array([0, 0]),
    routeEndPort: new Int32Array([1, 1]),
    routeNet: new Int32Array([0, 0]),
    regionNetId: new Int32Array(2).fill(-1),
    routeMetadata: [
      { simpleRouteConnection: { name: "connection" } },
      { simpleRouteConnection: { name: "connection" } },
    ],
  }
  const solver = new InspectableOutsideInSolver(topology, problem, {
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: true,
    MULTI_ROUTE_CONNECTION_OUTSIDE_IN_ROUTING: true,
    STATIC_REACHABILITY_PRECHECK: false,
  })

  solver.solve()

  expect(solver.outOfCandidatesIteration).toBe(2)
  expect(solver.stats.outsideInRouteCount).toBeUndefined()
})
