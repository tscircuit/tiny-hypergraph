import { expect, test } from "bun:test"
import type { SerializedHyperGraphPortPointPathingSolverInput } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import type { TinyHyperGraphBusData } from "lib/bus-router/common"
import { TinyHyperGraphBusRouterPipelineSolver } from "lib/index"

const countDuplicatePortIds = (
  baselineNoIntersectionCostPaths: NonNullable<
    ReturnType<TinyHyperGraphBusRouterPipelineSolver["getOutput"]>
  >["baselineNoIntersectionCostPaths"],
) => {
  const seenPortIds = new Set<string>()
  let duplicateCount = 0

  for (const tracePath of baselineNoIntersectionCostPaths) {
    for (const point of tracePath.points) {
      if (seenPortIds.has(point.portId)) {
        duplicateCount += 1
        continue
      }

      seenPortIds.add(point.portId)
    }
  }

  return duplicateCount
}

test("CM5IO bus router pipeline routes bus1 and computes a 20-segment centerline", async () => {
  const input = (await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()) as SerializedHyperGraphPortPointPathingSolverInput
  const bus = (await Bun.file(
    new URL("../fixtures/CM5IO_bus1.json", import.meta.url),
  ).json()) as TinyHyperGraphBusData
  const serializedHyperGraph =
    convertPortPointPathingSolverInputToSerializedHyperGraph(input)
  const pipelineSolver = new TinyHyperGraphBusRouterPipelineSolver({
    serializedHyperGraph,
    bus,
    baselineSolverOptions: {
      DISTANCE_TO_COST: 0.05,
      MAX_ITERATIONS: 200_000,
    },
    centerlineSegmentCount: 20,
  })

  pipelineSolver.solve()

  expect(pipelineSolver.solved).toBe(true)
  expect(pipelineSolver.failed).toBe(false)
  expect(pipelineSolver.hasStageOutput("baselineNoIntersectionCostPaths")).toBe(
    true,
  )
  expect(pipelineSolver.hasStageOutput("centerlinePath")).toBe(true)

  const output = pipelineSolver.getOutput()
  expect(output).not.toBeNull()

  if (!output || !("centerlinePath" in output)) {
    throw new Error(
      "Bus router pipeline did not return the final centerline output",
    )
  }

  expect(output.busId).toBe("bus1")
  expect(output.baselineNoIntersectionCostPaths).toHaveLength(
    bus.connectionPatches.length,
  )
  expect(
    output.baselineNoIntersectionCostPaths.map(
      (tracePath) => tracePath.connectionId,
    ),
  ).toEqual(
    bus.connectionPatches.map(
      (connectionPatch) => connectionPatch.connectionId,
    ),
  )
  expect(countDuplicatePortIds(output.baselineNoIntersectionCostPaths)).toBe(0)
  expect(output.centerlineSegmentCount).toBe(20)
  expect(output.centerlinePath).toHaveLength(21)
  expect(
    output.centerlinePath.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    ),
  ).toBe(true)
})
