import { expect, test } from "bun:test"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"
import type { PortId } from "lib/types"

type Fixture = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solver: SelectiveReripTinyHyperGraphSolver
}
type GeometryCase = { eligible: boolean; change: (fixture: Fixture) => void }

function createFixture(): Fixture {
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 7,
    regionIncidentPorts: [[0, 1, 2, 3], [0], [1, 4], [2], [3, 5], [4], [5]],
    incidentPortRegion: [[0, 1], [0, 2], [0, 3], [0, 4], [2, 5], [4, 6]],
    regionWidth: new Float64Array(7).fill(1),
    regionHeight: new Float64Array(7).fill(1),
    regionCenterX: new Float64Array(7),
    regionCenterY: new Float64Array(7),
    portAngleForRegion1: new Int32Array(6),
    portAngleForRegion2: new Int32Array(6),
    portX: new Float64Array([0, 1, 2, 3, 1, 3]),
    portY: new Float64Array([0, 0, 0, 0, -1, -1]),
    portZ: new Int32Array([0, 0, 1, 1, 0, 1]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    routeStartPort: new Int32Array([0, 4]),
    routeEndPort: new Int32Array([2, 5]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array(7).fill(-1),
    portSectionMask: new Int8Array(6).fill(1),
  }
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  return { topology, problem, solver }
}

function searchOutcome(solver: SelectiveReripTinyHyperGraphSolver): unknown {
  try {
    return solver["findRelaxedBlockerPath"]()
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { error: error.message }
  }
}

test("covered proofs retain native validation outside bounded referenced geometry", (): void => {
  const cases: GeometryCase[] = [
    { eligible: true, change: (): void => {} },
    {
      eligible: true,
      change: ({ topology }): void => {
        topology.portX[1] = Number.MAX_SAFE_INTEGER
      },
    },
    {
      eligible: false,
      change: ({ topology }): void => {
        topology.portX[1] = Number.MAX_VALUE
      },
    },
    {
      eligible: false,
      change: ({ topology }): void => {
        topology.portX[1] = Number.NaN
      },
    },
    {
      eligible: false,
      change: ({ topology }): void => {
        topology.portY[1] = Infinity
      },
    },
    {
      eligible: false,
      change: ({ topology }): void => {
        topology.portY = new Float64Array(2)
      },
    },
    {
      eligible: false,
      change: ({ topology }): void => {
        topology.regionIncidentPorts[0]!.push(99)
      },
    },
    {
      eligible: false,
      change: ({ topology }): void => {
        Reflect.deleteProperty(topology.regionIncidentPorts, 6)
      },
    },
    {
      eligible: false,
      change: ({ problem }): void => {
        problem.routeEndPort[0] = -1
      },
    },
  ]
  for (const geometry of cases) {
    const fixture = createFixture()
    geometry.change(fixture)
    expect(fixture.solver["hasBoundedReachabilityGeometry"]({
      startPortId: 0,
      goalPortId: fixture.problem.routeEndPort[0]!,
    })).toBe(geometry.eligible)
    const covered = searchOutcome(fixture.solver)
    fixture.solver["hasBoundedReachabilityGeometry"] = (): boolean => false
    expect(searchOutcome(fixture.solver)).toEqual(covered)
  }
  const unreachable = createFixture()
  // Port 4 is reserved for another net and cannot be reached by this search.
  unreachable.topology.portX[4] = Number.NaN
  const result = unreachable.solver["findRelaxedBlockerPath"]()
  expect(result.found).toBe(true)
  if (result.found) {
    expect(result.distance).toBe(2)
    expect(result.owners.size).toBe(0)
    expect(result.states.map((state): PortId => state.portId)).toEqual([0, 2])
  }
})
