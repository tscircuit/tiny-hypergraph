import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

test("prepared routing enforces a segment filter on one route in a shared graph", () => {
  const { topology, problem, options } = createPreparedRoutingFixture()
  problem.routeSegmentFilter = ({ routeId, fromPortId, toPortId }) =>
    routeId !== 0 ||
    [fromPortId, toPortId].every(
      (portId) =>
        topology.incidentPortRegion[portId]!.length === 1 ||
        topology.portZ[portId] === 1,
    )
  const solver = new PreparedPortPointRoutingSolver(topology, problem, {
    ...options,
    STATIC_REACHABILITY_PRECHECK: true,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  const segments = solver.state.regionSegments.flat()
  const interiorLayers = (routeId: number) =>
    segments
      .filter(([owner]) => owner === routeId)
      .flatMap(([, from, to]) => [from, to])
      .filter((portId) => topology.incidentPortRegion[portId]!.length === 2)
      .map((portId) => topology.portZ[portId]!)
  expect(new Set(interiorLayers(0))).toEqual(new Set([1]))
  expect(interiorLayers(1)).toContain(0)
})

test("static reachability fails when the segment filter disconnects a route", () => {
  const { topology, problem, options } = createPreparedRoutingFixture()
  problem.routeSegmentFilter = ({ routeId }) => routeId !== 0
  const solver = new TinyHyperGraphSolver(topology, problem, {
    ...options,
    STATIC_REACHABILITY_PRECHECK: true,
  })

  solver.solve()

  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("Static reachability precheck failed: 1 route")
})
