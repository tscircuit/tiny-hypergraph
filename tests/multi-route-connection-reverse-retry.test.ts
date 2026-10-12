import { expect, test } from "bun:test"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

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

class InspectableReverseRetrySolver extends OutsideInPartialRipTinyHyperGraphSolver {
  downstreamFailureCount = 0

  getSearchEndpoints(routeId: number) {
    return {
      startPortId: this.getRouteStartPortId(routeId),
      endPortId: this.getRouteEndPortId(routeId),
    }
  }

  override onOutOfCandidates(): void {
    if (this.tryReverseMultiRouteConnectionSearch()) return
    this.downstreamFailureCount += 1
    this.solved = true
  }
}

const createProblem = (
  routeMetadata: TinyHyperGraphProblem["routeMetadata"],
): TinyHyperGraphProblem => ({
  routeCount: 2,
  portSectionMask: new Int8Array(2).fill(1),
  routeStartPort: new Int32Array([0, 0]),
  routeEndPort: new Int32Array([1, 1]),
  routeNet: new Int32Array([0, 0]),
  regionNetId: new Int32Array(2).fill(-1),
  routeMetadata,
})

const createSolver = (problem: TinyHyperGraphProblem) =>
  new InspectableReverseRetrySolver(topology, problem, {
    PARTIAL_RIP_ENABLED: false,
    MULTI_ROUTE_CONNECTION_REVERSE_RETRY: true,
    STATIC_REACHABILITY_PRECHECK: false,
  })

test("a failed decomposed connection edge retries from its opposite endpoint", () => {
  const solver = createSolver(
    createProblem([
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
    ]),
  )
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.state.unroutedRoutes = []

  solver.onOutOfCandidates()

  expect(solver.getSearchEndpoints(0)).toEqual({
    startPortId: 1,
    endPortId: 0,
  })
  expect(solver.state.unroutedRoutes).toEqual([0])
  expect(solver.stats.multiRouteConnectionReverseRetryCount).toBe(1)

  solver.step()
  expect(solver.state.goalPortId).toBe(0)
  solver.step()

  expect(solver.downstreamFailureCount).toBe(1)
  expect(solver.getSearchEndpoints(0)).toEqual({
    startPortId: 0,
    endPortId: 1,
  })
})

test("independent connections on one net keep their original search", () => {
  const solver = createSolver(
    createProblem([
      { connectionId: "connection-a" },
      { connectionId: "connection-b" },
    ]),
  )
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.state.unroutedRoutes = []

  solver.onOutOfCandidates()

  expect(solver.downstreamFailureCount).toBe(1)
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(solver.stats.multiRouteConnectionReverseRetryCount).toBeUndefined()
})

test("repeated connection names without root metadata keep their original search", () => {
  const solver = createSolver(
    createProblem([
      { simpleRouteConnection: { name: "connection" } },
      { simpleRouteConnection: { name: "connection" } },
    ]),
  )
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.state.unroutedRoutes = []

  solver.onOutOfCandidates()

  expect(solver.downstreamFailureCount).toBe(1)
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(solver.stats.multiRouteConnectionReverseRetryCount).toBeUndefined()
})
