import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"
import type { PortId } from "lib/types"
import {
  createBlockerReachabilityFixture,
  type BlockerReachabilityFixture,
} from "./fixtures/createBlockerReachabilityFixture"

type GeometryCase = {
  eligible: boolean
  change: (fixture: BlockerReachabilityFixture) => void
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
    const fixture = createBlockerReachabilityFixture()
    geometry.change(fixture)
    expect(
      fixture.solver["hasBoundedReachabilityGeometry"]({
        startPortId: 0,
        goalPortId: fixture.problem.routeEndPort[0]!,
      }),
    ).toBe(geometry.eligible)
    const covered = searchOutcome(fixture.solver)
    fixture.solver["hasBoundedReachabilityGeometry"] = (): boolean => false
    expect(searchOutcome(fixture.solver)).toEqual(covered)
  }
  const unreachable = createBlockerReachabilityFixture()
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
