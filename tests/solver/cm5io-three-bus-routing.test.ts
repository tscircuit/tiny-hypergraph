import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  convertPortPointPathingSolverInputToSerializedHyperGraph,
  type SerializedHyperGraphPortPointPathingSolverInput,
} from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import {
  filterPortPointPathingSolverInputByConnectionPatches,
  TinyHyperGraphSequentialBusSolver,
  type ConnectionPatchSelection,
} from "lib/index"

interface ConnectionPatchSelectionFixture extends ConnectionPatchSelection {
  busId: string
}

const cm5ioBusFixtureUrls = [
  new URL("../fixtures/CM5IO_bus1.json", import.meta.url),
  new URL("../fixtures/CM5IO_bus2.json", import.meta.url),
  new URL("../fixtures/CM5IO_bus3.json", import.meta.url),
] as const

const sequentialBusOrder = ["bus1", "bus3", "bus2"] as const

const mergeConnectionPatchSelections = (
  selections: ConnectionPatchSelection[],
): ConnectionPatchSelection => ({
  connectionPatches: selections.flatMap((selection) =>
    selection.connectionPatches.map(({ connectionId }) => ({ connectionId })),
  ),
})

const loadCm5ioThreeBusSelections = async (): Promise<
  ConnectionPatchSelectionFixture[]
> =>
  (await Promise.all(
    cm5ioBusFixtureUrls.map((url) => Bun.file(url).json()),
  )) as ConnectionPatchSelectionFixture[]

const createCm5ioThreeBusSerializedHyperGraph = async () => {
  const fullInput = (await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()) as SerializedHyperGraphPortPointPathingSolverInput
  const busSelections = await loadCm5ioThreeBusSelections()
  return convertPortPointPathingSolverInputToSerializedHyperGraph(
    filterPortPointPathingSolverInputByConnectionPatches(
      fullInput,
      mergeConnectionPatchSelections(busSelections),
    ),
  )
}

const createCm5ioThreeBusSolver = async () => {
  const serializedHyperGraph = await createCm5ioThreeBusSerializedHyperGraph()
  const busSelections = await loadCm5ioThreeBusSelections()
  const orderedBusSelections = sequentialBusOrder.map((busId) => {
    const matchingSelection = busSelections.find(
      (selection) => selection.busId === busId,
    )

    if (!matchingSelection) {
      throw new Error(`Missing CM5IO bus selection for "${busId}"`)
    }

    return matchingSelection
  })

  return new TinyHyperGraphSequentialBusSolver({
    serializedHyperGraph,
    busStages: orderedBusSelections.map((selection) => ({
      stageName: selection.busId,
      busId: selection.busId,
      connectionIds: selection.connectionPatches.map(
        ({ connectionId }) => connectionId,
      ),
    })),
    busSolverOptions: {
      MAX_ITERATIONS: 250_000,
    },
  })
}

test("CM5IO three-bus subset includes the complete bus1, bus2, and bus3 trace set", async () => {
  const fullInput = (await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()) as SerializedHyperGraphPortPointPathingSolverInput
  const busSelections = await loadCm5ioThreeBusSelections()
  const mergedSelection = mergeConnectionPatchSelections(busSelections)
  const expectedBusIds = busSelections.map((selection) => selection.busId)
  const selectedConnectionIds = busSelections
    .flatMap((selection) =>
      selection.connectionPatches.map(({ connectionId }) => connectionId),
    )
    .sort()
  const uniqueSelectedConnectionIds = [...new Set(selectedConnectionIds)].sort()
  const busOnlyFixture = filterPortPointPathingSolverInputByConnectionPatches(
    fullInput,
    mergedSelection,
  )
  const busOnlyConnectionIds = (
    Array.isArray(busOnlyFixture) ? busOnlyFixture[0] : busOnlyFixture
  ).connections
    .map((connection: { connectionId: string }) => connection.connectionId)
    .sort()

  expect(expectedBusIds).toEqual(["bus1", "bus2", "bus3"])
  expect(selectedConnectionIds).toEqual(uniqueSelectedConnectionIds)
  expect(busOnlyConnectionIds).toEqual(uniqueSelectedConnectionIds)
  expect(busOnlyConnectionIds).toHaveLength(43)
})

test("CM5IO three-bus solver routes buses sequentially and seeds later stages from earlier buses", async () => {
  const solver = await createCm5ioThreeBusSolver()

  solver.step()
  expect(solver.getCurrentStageName()).toBe("bus1")

  solver.step()
  solver.step()

  const bus1Solver = solver.getSolver<any>("bus1")

  expect(bus1Solver).toBeDefined()
  expect(bus1Solver.problem.routeCount).toBe(9)
  expect(bus1Solver.iterations).toBe(2)
  expect(bus1Solver.solved).toBe(false)
  expect(bus1Solver.failed).toBe(false)
  expect(bus1Solver.stats.busId).toBe("bus1")
  expect(bus1Solver.stats.seededAssignedPortCount).toBe(0)
  expect(bus1Solver.stats.seededIntersectionSegmentCount).toBe(0)
  expect(bus1Solver.stats.previewRouteCount).toBe(9)

  solver.solveUntilStage("bus3")

  const bus1Output = solver.getStageOutput<SerializedHyperGraph>("bus1")

  expect(bus1Output?.solvedRoutes).toHaveLength(9)
  expect(solver.getOutput()?.solvedRoutes).toHaveLength(9)
  expect(solver.getCurrentStageName()).toBe("bus3")

  solver.step()
  solver.step()
  solver.step()

  const bus3Solver = solver.getSolver<any>("bus3")

  expect(bus3Solver).toBeDefined()
  expect(bus3Solver.problem.routeCount).toBe(26)
  expect(bus3Solver.iterations).toBe(2)
  expect(bus3Solver.solved).toBe(false)
  expect(bus3Solver.failed).toBe(false)
  expect(bus3Solver.stats.busId).toBe("bus3")
  expect(bus3Solver.stats.seededAssignedPortCount).toBeGreaterThan(0)
  expect(bus3Solver.stats.seededIntersectionSegmentCount).toBeGreaterThan(0)
  expect(bus3Solver.stats.previewRouteCount).toBe(26)
})
