import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphBusRoutingSolver } from "lib/index"
import {
  busOrderingVector,
  busRoutingFixture,
} from "tests/fixtures/bus-routing.fixture"

const getSolvedRoutePortIds = (
  output: ReturnType<TinyHyperGraphBusRoutingSolver["getOutput"]>,
) =>
  Object.fromEntries(
    (output.solvedRoutes ?? []).map((solvedRoute) => [
      solvedRoute.connection.connectionId,
      solvedRoute.path.map((candidate) => candidate.portId),
    ]),
  )

const getTraversedRegionIds = (
  output: ReturnType<TinyHyperGraphBusRoutingSolver["getOutput"]>,
) =>
  Object.fromEntries(
    (output.solvedRoutes ?? []).map((solvedRoute) => [
      solvedRoute.connection.connectionId,
      solvedRoute.path.slice(0, -1).map((candidate) => candidate.nextRegionId),
    ]),
  )

const getPortProjection = (
  output: ReturnType<TinyHyperGraphBusRoutingSolver["getOutput"]>,
  portId: string,
) => {
  const port = output.ports.find((candidate) => candidate.portId === portId)
  if (!port) {
    throw new Error(`Missing output port "${portId}"`)
  }

  const x = Number(port.d?.x ?? 0)
  const y = Number(port.d?.y ?? 0)

  return x * busOrderingVector.x + y * busOrderingVector.y
}

test("bus routing solver selects capacity-feasible region paths and ordered boundary ports", () => {
  const { topology, problem } = loadSerializedHyperGraph(busRoutingFixture)
  const solver = new TinyHyperGraphBusRoutingSolver(topology, problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutput()
  const traversedRegionIds = getTraversedRegionIds(output)
  const solvedRoutePortIds = getSolvedRoutePortIds(output)

  expect(output.connections).toEqual(problem.routeMetadata)
  expect(traversedRegionIds["route-0"]).toEqual([
    "fanout-left",
    "lane-top-left",
    "lane-top-right",
    "fanout-right",
  ])
  expect(traversedRegionIds["route-1"]).toEqual([
    "fanout-left",
    "lane-top-left",
    "lane-top-right",
    "fanout-right",
  ])
  expect(traversedRegionIds["route-2"]).toEqual([
    "fanout-left",
    "lane-bottom-left",
    "lane-bottom-right",
    "fanout-right",
  ])

  expect(
    getPortProjection(output, solvedRoutePortIds["route-0"]![1]!),
  ).toBeGreaterThan(
    getPortProjection(output, solvedRoutePortIds["route-1"]![1]!),
  )
  expect(
    getPortProjection(output, solvedRoutePortIds["route-1"]![1]!),
  ).toBeGreaterThan(
    getPortProjection(output, solvedRoutePortIds["route-2"]![1]!),
  )
  expect(
    getPortProjection(
      output,
      solvedRoutePortIds["route-0"]![
        solvedRoutePortIds["route-0"]!.length - 2
      ]!,
    ),
  ).toBeGreaterThan(
    getPortProjection(
      output,
      solvedRoutePortIds["route-1"]![
        solvedRoutePortIds["route-1"]!.length - 2
      ]!,
    ),
  )
  expect(
    getPortProjection(
      output,
      solvedRoutePortIds["route-1"]![
        solvedRoutePortIds["route-1"]!.length - 2
      ]!,
    ),
  ).toBeGreaterThan(
    getPortProjection(
      output,
      solvedRoutePortIds["route-2"]![
        solvedRoutePortIds["route-2"]!.length - 2
      ]!,
    ),
  )
})

test("bus routing solver output round-trips while preserving bus metadata on connections", () => {
  const { topology, problem } = loadSerializedHyperGraph(busRoutingFixture)
  const solver = new TinyHyperGraphBusRoutingSolver(topology, problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const output = solver.getOutput()
  const roundTripped = loadSerializedHyperGraph(output)

  expect(output.connections).toEqual(problem.routeMetadata)
  expect(
    (
      roundTripped.problem.routeMetadata?.[0] as
        | { d?: { busId?: string } }
        | undefined
    )?.d?.busId,
  ).toBe("data-bus")
  expect(
    (
      roundTripped.problem.routeMetadata?.[1] as
        | { d?: { busId?: string } }
        | undefined
    )?.d?.busId,
  ).toBe("data-bus")
  expect(
    (
      roundTripped.problem.routeMetadata?.[2] as
        | { d?: { busId?: string } }
        | undefined
    )?.d?.busId,
  ).toBe("data-bus")
})
