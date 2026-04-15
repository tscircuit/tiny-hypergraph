import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphBusSolver, TinyHyperGraphSolver } from "lib/index"
import {
  BUS_RIGHT_TURN_L_SHAPE_BRIDGE_REGION_COUNT,
  BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT,
  BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  BUS_RIGHT_TURN_L_SHAPE_SPLIT_STAGE_COUNT,
  busRightTurnLShapeFixture,
} from "tests/fixtures/bus-right-turn-l-shape.fixture"

const countSharedPorts = (regionAId: string, regionBId: string) =>
  busRightTurnLShapeFixture.ports.filter(
    (port) =>
      (port.region1Id === regionAId && port.region2Id === regionBId) ||
      (port.region1Id === regionBId && port.region2Id === regionAId),
  ).length

const countRoutesUsingRegion = (
  solvedRoutes: NonNullable<ReturnType<TinyHyperGraphSolver["getOutput"]>["solvedRoutes"]>,
  regionId: string,
) =>
  solvedRoutes.filter((route) =>
    route.path.some((node) => node.nextRegionId === regionId),
  ).length

const getRegionIndexBySerializedId = (
  topology: ReturnType<typeof loadSerializedHyperGraph>["topology"],
) => {
  const regionIndexBySerializedId = new Map<string, number>()

  topology.regionMetadata?.forEach((metadata, regionIndex) => {
    const serializedRegionId = (metadata as { serializedRegionId?: string })
      .serializedRegionId
    if (typeof serializedRegionId === "string") {
      regionIndexBySerializedId.set(serializedRegionId, regionIndex)
    }
  })

  return regionIndexBySerializedId
}

const getTracePreviewByConnectionId = (
  busSolver: TinyHyperGraphBusSolver,
  connectionId: string,
) => {
  const internal = busSolver as any
  return internal.lastPreview?.tracePreviews.find(
    (tracePreview: { traceIndex: number }) =>
      busSolver.busTraceOrder.traces[tracePreview.traceIndex]?.connectionId ===
      connectionId,
  )
}

const getSerializedRegionId = (
  topology: ReturnType<typeof loadSerializedHyperGraph>["topology"],
  regionId: number | undefined,
) =>
  regionId === undefined
    ? undefined
    : (
        topology.regionMetadata?.[regionId] as
          | { serializedRegionId?: string }
          | undefined
      )?.serializedRegionId

const getSerializedPortId = (
  topology: ReturnType<typeof loadSerializedHyperGraph>["topology"],
  portId: number,
) =>
  (
    topology.portMetadata?.[portId] as { serializedPortId?: string } | undefined
  )?.serializedPortId

const getTracePreviewLength = (
  topology: ReturnType<typeof loadSerializedHyperGraph>["topology"],
  tracePreview: { segments: Array<{ fromPortId: number; toPortId: number }> },
) =>
  tracePreview.segments.reduce(
    (sum, segment) =>
      sum +
      Math.hypot(
        topology.portX[segment.fromPortId] - topology.portX[segment.toPortId],
        topology.portY[segment.fromPortId] - topology.portY[segment.toPortId],
      ),
    0,
  )

test("repro: region-19 turns right into an L-shaped top-bottom split", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busRightTurnLShapeFixture,
  )
  const plainSolver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })
  const regionIndexBySerializedId = getRegionIndexBySerializedId(topology)

  expect(problem.routeCount).toBe(BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT)
  expect(BUS_RIGHT_TURN_L_SHAPE_SPLIT_STAGE_COUNT).toBe(3)
  expect(BUS_RIGHT_TURN_L_SHAPE_BRIDGE_REGION_COUNT).toBe(3)
  expect(regionIndexBySerializedId.get("bridge-final")).toBe(19)
  expect(countSharedPorts("top-main", "split-a-left")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("top-main", "split-a-right")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("bridge-lower", "split-b-left")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("bridge-lower", "split-b-right")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("bridge-final", "split-c-top")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("bridge-final", "split-c-bottom")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("split-c-top", "right-main")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("split-c-bottom", "right-main")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(problem.routeCount).toBeGreaterThan(
    countSharedPorts("bridge-final", "split-c-top"),
  )

  plainSolver.solve()

  expect(plainSolver.solved).toBe(true)
  expect(plainSolver.failed).toBe(false)

  const solvedRoutes = plainSolver.getOutput().solvedRoutes ?? []

  expect(solvedRoutes).toHaveLength(BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT)
  expect(countRoutesUsingRegion(solvedRoutes, "bridge-final")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-a-left")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "split-a-right")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "split-b-left")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "split-b-right")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "split-c-top")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "split-c-bottom")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "right-main")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT,
  )
})

test("repro: iteration 3 keeps all traces behind the centerline", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busRightTurnLShapeFixture,
  )
  const busSolver = new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })

  busSolver.step()
  busSolver.step()
  busSolver.step()

  const centerTracePreview = getTracePreviewByConnectionId(busSolver, "route-2")
  const route4Preview = getTracePreviewByConnectionId(busSolver, "route-4")
  const route5Preview = getTracePreviewByConnectionId(busSolver, "route-5")

  expect(centerTracePreview).toBeDefined()
  expect(route4Preview).toBeDefined()
  expect(route5Preview).toBeDefined()
  expect(route4Preview.segments.length).toBeLessThanOrEqual(
    centerTracePreview.segments.length,
  )
  expect(route5Preview.segments.length).toBeLessThanOrEqual(
    centerTracePreview.segments.length,
  )
  expect(getTracePreviewLength(topology, route4Preview)).toBeLessThanOrEqual(
    getTracePreviewLength(topology, centerTracePreview) + 1e-9,
  )
  expect(getTracePreviewLength(topology, route5Preview)).toBeLessThanOrEqual(
    getTracePreviewLength(topology, centerTracePreview) + 1e-9,
  )
})

test("repro: iteration 4 only keeps queueable non-intersecting derived bus candidates that keep pace with the centerline", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busRightTurnLShapeFixture,
  )
  const busSolver = new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })
  const internal = busSolver as any

  busSolver.step()
  busSolver.step()
  busSolver.step()
  busSolver.step()

  for (const candidate of busSolver.state.candidateQueue.toArray()) {
    const preview = internal.evaluateCandidate(candidate)
    const centerTracePreview = preview.tracePreviews.find(
      (tracePreview: { traceIndex: number }) =>
        tracePreview.traceIndex === busSolver.centerTraceIndex,
    )

    expect(preview).toBeDefined()
    expect(preview.reason).toBeUndefined()
    expect(preview.sameLayerIntersectionCount).toBe(0)
    expect(preview.crossingLayerIntersectionCount).toBe(0)
    expect(centerTracePreview).toBeDefined()
    expect(internal.hasRemainingTraceCandidates(preview)).toBe(true)

    if ((centerTracePreview?.segments.length ?? 0) >= 2) {
      const minimumTraceSegmentCount = Math.max(
        1,
        Math.floor((centerTracePreview?.segments.length ?? 0) * 0.7),
      )
      const centerTraceLength = getTracePreviewLength(
        topology,
        centerTracePreview,
      )

      for (const tracePreview of preview.tracePreviews) {
        if (tracePreview.traceIndex === busSolver.centerTraceIndex) {
          continue
        }

        expect(tracePreview.segments.length).toBeLessThanOrEqual(
          centerTracePreview?.segments.length ?? 0,
        )
        expect(tracePreview.segments.length).toBeGreaterThanOrEqual(
          minimumTraceSegmentCount,
        )
        expect(getTracePreviewLength(topology, tracePreview)).toBeLessThanOrEqual(
          centerTraceLength + 1e-9,
        )
      }
    }
  }
})

test("repro: iteration 4 keeps route-1 behind the centerline while still making progress", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busRightTurnLShapeFixture,
  )
  const busSolver = new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })

  busSolver.step()
  busSolver.step()
  busSolver.step()
  busSolver.step()

  const route1Preview = getTracePreviewByConnectionId(busSolver, "route-1")
  const centerTracePreview = getTracePreviewByConnectionId(busSolver, "route-2")

  expect(route1Preview).toBeDefined()
  expect(centerTracePreview).toBeDefined()
  expect(route1Preview.segments.length).toBeGreaterThan(0)
  expect(route1Preview.segments.length).toBeLessThanOrEqual(
    centerTracePreview.segments.length,
  )
  expect(getTracePreviewLength(topology, route1Preview)).toBeLessThanOrEqual(
    getTracePreviewLength(topology, centerTracePreview) + 1e-9,
  )
})

test("repro: iteration 10 keeps all derived traces behind the centerline", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busRightTurnLShapeFixture,
  )
  const busSolver = new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })

  for (let iteration = 0; iteration < 10; iteration++) {
    busSolver.step()
  }

  const centerTracePreview = getTracePreviewByConnectionId(busSolver, "route-2")

  expect(centerTracePreview).toBeDefined()

  const centerTraceLength = getTracePreviewLength(topology, centerTracePreview)

  expect((busSolver as any).hasRemainingTraceCandidates((busSolver as any).lastPreview)).toBe(
    true,
  )

  for (const tracePreview of (busSolver as any).lastPreview?.tracePreviews ?? []) {
    if (tracePreview.traceIndex === busSolver.centerTraceIndex) {
      continue
    }

    expect(tracePreview.segments.length).toBeLessThanOrEqual(
      centerTracePreview.segments.length,
    )
    expect(getTracePreviewLength(topology, tracePreview)).toBeLessThanOrEqual(
      centerTraceLength + 1e-9,
    )
  }
})

test("repro: iteration 12 exposes generated but rejected centerline neighbors", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busRightTurnLShapeFixture,
  )
  const busSolver = new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
    CENTER_GREEDY_HEURISTIC_MULTIPLIER: 1_000,
  })

  for (let iteration = 0; iteration < 12; iteration++) {
    busSolver.step()
  }

  expect(busSolver.iterations).toBe(12)
  expect(busSolver.stats.lastNeighborCount).toBeGreaterThan(0)
  expect(busSolver.stats.lastQueuedNeighborCount).toBe(0)
  expect(busSolver.stats.openCandidateCount).toBeGreaterThan(0)
})

test("repro: debug mode can queue all generated neighbors", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busRightTurnLShapeFixture,
  )
  const busSolver = new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
    CENTER_GREEDY_HEURISTIC_MULTIPLIER: 1_000,
    QUEUE_ALL_CANDIDATES: true,
  })

  let sawQueuedExpansion = false

  for (let iteration = 0; iteration < 20; iteration++) {
    busSolver.step()

    if ((busSolver.stats.lastNeighborCount ?? 0) > 0) {
      expect(busSolver.stats.lastQueuedNeighborCount).toBe(
        busSolver.stats.lastNeighborCount,
      )
      expect(busSolver.stats.openCandidateCount).toBeGreaterThanOrEqual(
        busSolver.stats.lastQueuedNeighborCount,
      )
      sawQueuedExpansion = true
      break
    }
  }

  expect(sawQueuedExpansion).toBe(true)
})

test("repro: visualize only shows the current bus at iteration 4", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busRightTurnLShapeFixture,
  )
  const busSolver = new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })

  busSolver.step()
  busSolver.step()
  busSolver.step()
  busSolver.step()

  const graphics = busSolver.visualize()

  expect(
    (graphics.points ?? []).some(
      (point) => typeof point.label === "string" && point.label.includes("g: "),
    ),
  ).toBe(false)
  expect(
    (graphics.lines ?? []).some((line) => line.strokeDash === "10 5"),
  ).toBe(false)
})

test("repro: bus solver handles the region-19 right turn and L-shaped split", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busRightTurnLShapeFixture,
  )
  const busSolver = new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })
  const plainSolver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })
  const regionIndexBySerializedId = getRegionIndexBySerializedId(topology)

  const splitALeftRegionIndex = regionIndexBySerializedId.get("split-a-left")
  const splitARightRegionIndex = regionIndexBySerializedId.get("split-a-right")
  const splitBLeftRegionIndex = regionIndexBySerializedId.get("split-b-left")
  const splitBRightRegionIndex = regionIndexBySerializedId.get("split-b-right")
  const splitCTopRegionIndex = regionIndexBySerializedId.get("split-c-top")
  const splitCBottomRegionIndex = regionIndexBySerializedId.get("split-c-bottom")

  expect(splitALeftRegionIndex).toBeDefined()
  expect(splitARightRegionIndex).toBeDefined()
  expect(splitBLeftRegionIndex).toBeDefined()
  expect(splitBRightRegionIndex).toBeDefined()
  expect(splitCTopRegionIndex).toBeDefined()
  expect(splitCBottomRegionIndex).toBeDefined()
  expect(regionIndexBySerializedId.get("bridge-final")).toBe(19)
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitALeftRegionIndex!],
  ).toBeGreaterThan(6)
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitARightRegionIndex!],
  ).toBeGreaterThan(6)
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitBLeftRegionIndex!],
  ).toBeGreaterThan(4)
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitBRightRegionIndex!],
  ).toBeGreaterThan(4)
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitCTopRegionIndex!],
  ).toBeGreaterThan(2)
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitCBottomRegionIndex!],
  ).toBeGreaterThan(2)

  busSolver.solve()
  plainSolver.solve()

  expect(plainSolver.solved).toBe(true)
  expect(plainSolver.failed).toBe(false)
  expect(busSolver.solved).toBe(true)
  expect(busSolver.failed).toBe(false)

  const solvedRoutes = busSolver.getOutput().solvedRoutes ?? []
  const sameLayerIntersectionCount =
    busSolver.state.regionIntersectionCaches.reduce(
      (total, regionCache) =>
        total + regionCache.existingSameLayerIntersections,
      0,
    )
  const crossingLayerIntersectionCount =
    busSolver.state.regionIntersectionCaches.reduce(
      (total, regionCache) =>
        total + regionCache.existingCrossingLayerIntersections,
      0,
    )
  const plainSameLayerIntersectionCount =
    plainSolver.state.regionIntersectionCaches.reduce(
      (total, regionCache) =>
        total + regionCache.existingSameLayerIntersections,
      0,
    )
  const plainCrossingLayerIntersectionCount =
    plainSolver.state.regionIntersectionCaches.reduce(
      (total, regionCache) =>
        total + regionCache.existingCrossingLayerIntersections,
      0,
    )

  expect(solvedRoutes).toHaveLength(BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT)
  expect(countRoutesUsingRegion(solvedRoutes, "bridge-final")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-c-top")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "split-c-bottom")).toBeGreaterThan(
    0,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "right-main")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT,
  )
  expect(sameLayerIntersectionCount).toBeLessThanOrEqual(
    plainSameLayerIntersectionCount,
  )
  expect(crossingLayerIntersectionCount).toBeLessThanOrEqual(
    plainCrossingLayerIntersectionCount,
  )
})
