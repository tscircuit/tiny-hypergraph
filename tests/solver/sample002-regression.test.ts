import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"

const getSharedPortsAcrossDifferentNets = (solver: TinyHyperGraphSolver) => {
  const routeIdsByPortId = new Map<number, Set<number>>()

  for (const regionSegments of solver.state.regionSegments) {
    for (const [routeId, port1Id, port2Id] of regionSegments) {
      for (const portId of [port1Id, port2Id]) {
        const routeIds = routeIdsByPortId.get(portId) ?? new Set<number>()
        routeIds.add(routeId)
        routeIdsByPortId.set(portId, routeIds)
      }
    }
  }

  return [...routeIdsByPortId.entries()]
    .filter(([, routeIds]) => routeIds.size > 1)
    .map(([portId, routeIds]) => {
      const sortedRouteIds = [...routeIds].sort((left, right) => left - right)
      const nets = [
        ...new Set(
          sortedRouteIds.map((routeId) => solver.problem.routeNet[routeId]),
        ),
      ].sort((left, right) => left - right)

      return {
        portId,
        routeIds: sortedRouteIds,
        nets,
      }
    })
    .filter((entry) => entry.nets.length > 1)
}

test("sample002 keeps region-80 labels consistent and avoids shared ports across different nets", () => {
  const { topology, problem } = loadSerializedHyperGraph(datasetHg07.sample002)
  const solver = new TinyHyperGraphSolver(topology, problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const region80Cache = solver.state.regionIntersectionCaches[80]
  expect(region80Cache.existingSameLayerIntersections).toBe(0)

  const graphics = solver.visualize()
  const region80Rect = (graphics.rects ?? []).find((rect) =>
    rect.label?.includes("region: region-80"),
  )

  expect(region80Rect?.label).toContain("same layer X: 0")
  expect(getSharedPortsAcrossDifferentNets(solver)).toEqual([])
})
