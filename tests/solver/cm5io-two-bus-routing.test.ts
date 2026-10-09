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
] as const

const sequentialBusOrder = ["bus1", "bus2"] as const

const mergeConnectionPatchSelections = (
  selections: ConnectionPatchSelection[],
): ConnectionPatchSelection => ({
  connectionPatches: selections.flatMap((selection) =>
    selection.connectionPatches.map(({ connectionId }) => ({ connectionId })),
  ),
})

const loadCm5ioTwoBusSelections = async (): Promise<
  ConnectionPatchSelectionFixture[]
> =>
  (await Promise.all(
    cm5ioBusFixtureUrls.map((url) => Bun.file(url).json()),
  )) as ConnectionPatchSelectionFixture[]

const createCm5ioTwoBusSerializedHyperGraph = async () => {
  const fullInput = (await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()) as SerializedHyperGraphPortPointPathingSolverInput
  const busSelections = await loadCm5ioTwoBusSelections()
  return convertPortPointPathingSolverInputToSerializedHyperGraph(
    filterPortPointPathingSolverInputByConnectionPatches(
      fullInput,
      mergeConnectionPatchSelections(busSelections),
    ),
  )
}

const createCm5ioTwoBusSolver = async () => {
  const serializedHyperGraph = await createCm5ioTwoBusSerializedHyperGraph()
  const busSelections = await loadCm5ioTwoBusSelections()
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

test("CM5IO two-bus subset includes the complete bus1 and bus2 trace set", async () => {
  const fullInput = (await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()) as SerializedHyperGraphPortPointPathingSolverInput
  const busSelections = await loadCm5ioTwoBusSelections()
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

  expect(expectedBusIds).toEqual(["bus1", "bus2"])
  expect(selectedConnectionIds).toEqual(uniqueSelectedConnectionIds)
  expect(busOnlyConnectionIds).toEqual(uniqueSelectedConnectionIds)
  expect(busOnlyConnectionIds).toHaveLength(17)
})

test("CM5IO two-bus solver routes bus1 first and seeds an active bus2 start corridor", async () => {
  const solver = await createCm5ioTwoBusSolver()

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

  solver.solveUntilStage("bus2")

  const bus1Output = solver.getStageOutput<SerializedHyperGraph>("bus1")

  expect(bus1Output?.solvedRoutes).toHaveLength(9)
  expect(solver.getOutput()?.solvedRoutes).toHaveLength(9)
  expect(solver.getCurrentStageName()).toBe("bus2")

  solver.step()
  solver.step()

  const bus2Solver = solver.getSolver<any>("bus2")
  const bus2StartCandidate = bus2Solver.lastExpandedCandidate
  const queuedCandidates = bus2Solver.state.candidateQueue
    .toArray()
    .map((candidate: any) => ({
      serializedPortId:
        bus2Solver.topology.portMetadata?.[candidate.portId]?.serializedPortId,
      serializedRegionId:
        bus2Solver.topology.regionMetadata?.[candidate.nextRegionId]
          ?.serializedRegionId,
    }))
    .sort(
      (left: any, right: any) =>
        left.serializedPortId.localeCompare(right.serializedPortId) ||
        left.serializedRegionId.localeCompare(right.serializedRegionId),
    )

  expect(bus2Solver).toBeDefined()
  expect(bus2Solver.problem.routeCount).toBe(8)
  expect(bus2Solver.iterations).toBe(1)
  expect(bus2Solver.solved).toBe(false)
  expect(bus2Solver.failed).toBe(false)
  expect(bus2Solver.error).toBeNull()
  expect(bus2Solver.stats.busId).toBe("bus2")
  expect(bus2Solver.stats.seededAssignedPortCount).toBeGreaterThan(0)
  expect(bus2Solver.stats.seededIntersectionSegmentCount).toBeGreaterThan(0)
  expect(bus2Solver.stats.previewRouteCount).toBe(8)
  expect(bus2Solver.stats.lastNeighborCount).toBe(13)
  expect(bus2Solver.stats.lastQueuedNeighborCount).toBe(5)
  expect((bus2Solver as any).preferExplicitStartRegions).toBe(true)
  expect(
    bus2Solver.topology.portMetadata?.[bus2StartCandidate.portId]
      ?.serializedPortId,
  ).toBe("ce1774_pp0_z0::0")
  expect(
    bus2Solver.topology.regionMetadata?.[bus2StartCandidate.nextRegionId]
      ?.serializedRegionId,
  ).toBe("cmn_406")
  expect(queuedCandidates).toHaveLength(5)
  expect(
    queuedCandidates.some(
      ({ serializedPortId }: any) =>
        serializedPortId === "ce4917_pp0_z0::0",
    ),
  ).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(false)
  expect(solver.getCurrentStageName()).toBe("bus2")
  expect(solver.getOutput()?.solvedRoutes).toHaveLength(9)
  expect(
    solver.getOutput()?.solvedRoutes?.some(
      (route: any) => route.connectionId === "source_trace_94",
    ),
  )
    .toBe(false)
})
