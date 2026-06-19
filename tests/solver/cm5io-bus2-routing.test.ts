import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  filterPortPointPathingSolverInputByConnectionPatches,
  TinyHyperGraphBusSolver,
  type ConnectionPatchSelection,
} from "lib/index"
import type { TinyHyperGraphBusSolverOptions } from "lib/bus-solver/busSolverTypes"

const CM5IO_CENTER_PORT_OPTIONS_PER_EDGE = 16

const createCm5ioBus2Solver = async (
  options: TinyHyperGraphBusSolverOptions = {},
) => {
  const fullInput = await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()
  const busSelection = (await Bun.file(
    new URL("../fixtures/CM5IO_bus2.json", import.meta.url),
  ).json()) as ConnectionPatchSelection
  const serializedHyperGraph =
    convertPortPointPathingSolverInputToSerializedHyperGraph(
      filterPortPointPathingSolverInputByConnectionPatches(
        fullInput,
        busSelection,
      ),
    )
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)

  return new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 250_000,
    CENTER_PORT_OPTIONS_PER_EDGE: CM5IO_CENTER_PORT_OPTIONS_PER_EDGE,
    ...options,
  })
}

test("CM5IO bus2 starts from its pad-side start region and queues first-hop candidates", async () => {
  const solver = await createCm5ioBus2Solver()

  solver.step()

  expect(solver.iterations).toBe(1)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.problem.routeCount).toBe(8)
  expect(solver.stats.busCenterConnectionId).toBe("source_trace_94")
  expect(solver.stats.previewRouteCount).toBe(8)
  expect(solver.stats.lastNeighborCount).toBe(13)
  expect(solver.stats.lastQueuedNeighborCount).toBeGreaterThan(0)

  const startCandidate = (solver as any).lastExpandedCandidate
  const queuedCandidates = solver.state.candidateQueue
    .toArray()
    .map((candidate: any) => ({
      serializedPortId:
        solver.topology.portMetadata?.[candidate.portId]?.serializedPortId,
      serializedRegionId:
        solver.topology.regionMetadata?.[candidate.nextRegionId]
          ?.serializedRegionId,
    }))
    .sort(
      (left, right) =>
        left.serializedPortId.localeCompare(right.serializedPortId) ||
        left.serializedRegionId.localeCompare(right.serializedRegionId),
    )

  expect(startCandidate).toBeDefined()
  expect(
    solver.topology.portMetadata?.[startCandidate.portId]?.serializedPortId,
  ).toBe("ce1774_pp0_z0::0")
  expect(
    solver.topology.regionMetadata?.[startCandidate.nextRegionId]
      ?.serializedRegionId,
  ).toBe("cmn_406")
  expect(queuedCandidates).toHaveLength(5)
  expect(
    queuedCandidates.some(
      (candidate) => candidate.serializedPortId === "ce4917_pp0_z0::0",
    ),
  ).toBe(true)
})

test("CM5IO bus2 queues ce4917 as the best first-hop centerline candidate", async () => {
  const solver = await createCm5ioBus2Solver()

  solver.step()

  const internal = solver as any
  const startCandidate = internal.lastExpandedCandidate
  const queuedCandidates = solver.state.candidateQueue.toArray() as any[]
  const bestQueuedCandidate = queuedCandidates.sort(
    (left, right) => left.f - right.f || left.portId - right.portId,
  )[0]

  expect(bestQueuedCandidate).toBeDefined()
  expect(
    solver.topology.portMetadata?.[bestQueuedCandidate.portId]?.serializedPortId,
  ).toBe("ce4917_pp0_z0::0")
  expect(
    solver.topology.regionMetadata?.[bestQueuedCandidate.nextRegionId]
      ?.serializedRegionId,
  ).toBe("new-cmn_32-451__sub_0_2")
  expect(
    internal
      .getAvailableCenterMoves(startCandidate)
      .some(
        (candidate: any) =>
          solver.topology.portMetadata?.[candidate.portId]?.serializedPortId ===
          "ce4917_pp0_z0::0",
      ),
  ).toBe(true)
})

test("CM5IO bus2 ce4917 preview keeps the full bus alive through the shared start-side corridor", async () => {
  const solver = await createCm5ioBus2Solver()

  solver.step()

  const internal = solver as any
  const startCandidate = internal.lastExpandedCandidate
  const ce4917Candidate = internal
    .getAvailableCenterMoves(startCandidate)
    .find(
      (candidate: any) =>
        solver.topology.portMetadata?.[candidate.portId]?.serializedPortId ===
        "ce4917_pp0_z0::0",
    )

  expect(ce4917Candidate).toBeDefined()

  const ce4917Preview = internal.evaluateCandidate(ce4917Candidate)
  const usedPortOwners = internal.buildPreviewUsedPortOwners(
    ce4917Preview.tracePreviews,
  )
  const traceTerminalRegions = Object.fromEntries(
    ce4917Preview.tracePreviews.map((tracePreview: any) => [
      solver.busTraceOrder.traces[tracePreview.traceIndex]!.connectionId,
      solver.topology.regionMetadata?.[tracePreview.terminalRegionId]
        ?.serializedRegionId,
    ]),
  )

  expect(ce4917Preview.reason).toBeUndefined()
  expect(ce4917Preview.sameLayerIntersectionCount).toBe(0)
  expect(ce4917Preview.crossingLayerIntersectionCount).toBe(0)
  expect(ce4917Preview.tracePreviews).toHaveLength(8)
  expect(internal.hasRemainingTraceCandidates(ce4917Preview)).toBe(true)
  expect(internal.isQueueablePreview(ce4917Preview)).toBe(true)
  expect(
    ce4917Preview.tracePreviews.every((tracePreview: any) =>
      internal.traceInferencePlanner.hasRemainingTraceCandidate(
        tracePreview,
        usedPortOwners,
      ),
    ),
  ).toBe(true)
  expect(traceTerminalRegions).toMatchObject({
    source_trace_91: "new-cmn_32-451__sub_0_2",
    source_trace_92: "new-cmn_32-451__sub_0_2",
    source_trace_93: "new-cmn_32-451__sub_0_2",
    source_trace_94: "new-cmn_32-451__sub_0_2",
    source_trace_95: "new-cmn_32-451__sub_0_2",
    source_trace_96: "new-cmn_32-451__sub_0_1",
    source_trace_97: "new-cmn_32-451__sub_0_1",
    source_trace_98: "new-cmn_32-451__sub_0_1",
  })
})

test("CM5IO bus2 stays active on the default solver path", async () => {
  const solver = await createCm5ioBus2Solver()

  for (let iteration = 0; iteration < 100; iteration++) {
    solver.step()
  }

  expect(solver.iterations).toBe(100)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect((solver as any).preferExplicitStartRegions).toBe(true)
  expect(solver.stats.openCandidateCount).toBeGreaterThan(0)
})
