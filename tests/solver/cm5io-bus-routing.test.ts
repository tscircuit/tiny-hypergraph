import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  filterPortPointPathingSolverInputByConnectionPatches,
  TinyHyperGraphBusSolver,
  type ConnectionPatchSelection,
} from "lib/index"

const createCm5ioBus1Solver = async () => {
  const fullInput = await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()
  const busSelection = (await Bun.file(
    new URL("../fixtures/CM5IO_bus1.json", import.meta.url),
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
  })
}

test("CM5IO bus1 evaluates one centerline candidate per step and visualizes all inferred routes", async () => {
  const solver = await createCm5ioBus1Solver()

  solver.step()
  solver.step()

  expect(solver.iterations).toBe(2)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.stats.busCenterConnectionId).toBe("source_trace_108")
  expect(solver.stats.openCandidateCount).toBeGreaterThan(0)
  expect(solver.stats.previewRouteCount).toBe(9)

  const graphics = solver.visualize()
  const renderedRouteIds = new Set(
    (graphics.lines ?? [])
      .flatMap((line) =>
        solver.busTraceOrder.traces
          .map((trace) => trace.connectionId)
          .filter((connectionId) => line.label?.includes(connectionId)),
      )
      .filter(Boolean),
  )

  expect(renderedRouteIds.size).toBe(9)
  expect(
    solver.state.regionSegments.reduce(
      (segmentCount, regionSegments) => segmentCount + regionSegments.length,
      0,
    ),
  ).toBeGreaterThan(0)
  expect(
    solver.state.regionSegments.every((regionSegments) =>
      regionSegments.every(
        ([, fromPortId, toPortId]) =>
          solver.topology.portZ[fromPortId] === 0 &&
          solver.topology.portZ[toPortId] === 0,
      ),
    ),
  ).toBe(true)
})

test("CM5IO bus1 marks the centerline end-manual regions in visualize labels", async () => {
  const solver = await createCm5ioBus1Solver()
  const graphics = solver.visualize()
  const regionLabels = (graphics.rects ?? [])
    .map((rect) => rect.label)
    .filter((label): label is string => typeof label === "string")

  expect(
    regionLabels.some(
      (label) =>
        label.includes("region: region-228") &&
        label.includes("bus end-manual hop: 0"),
    ),
  ).toBe(true)
  expect(
    regionLabels.some(
      (label) =>
        label.includes("region: region-224") &&
        label.includes("bus end-manual hop: 1"),
    ),
  ).toBe(true)
  expect(
    regionLabels.some(
      (label) =>
        label.includes("region: region-11") &&
        label.includes("bus end-manual hop: 2"),
    ),
  ).toBe(true)
})

test("CM5IO bus1 keeps boundary port ordering stable through centerline direction changes", async () => {
  const solver = await createCm5ioBus1Solver()
  const internal = solver as any

  const pathDescriptors = [
    { portId: 6768, nextRegionId: 72 },
    { portId: 2228, nextRegionId: 19 },
    { portId: 2282, nextRegionId: 20 },
    { portId: 2346, nextRegionId: 24 },
    { portId: 2800, nextRegionId: 25 },
    { portId: 2862, nextRegionId: 26 },
    { portId: 2978, nextRegionId: 36 },
    { portId: 3875, nextRegionId: 35 },
  ]

  let previousCandidate: any
  const centerPath = pathDescriptors.map((descriptor, index) => {
    const candidate = {
      portId: descriptor.portId,
      nextRegionId: descriptor.nextRegionId,
      g: index,
      h: 0,
      f: index,
      prevCandidate: previousCandidate,
      prevRegionId: previousCandidate?.nextRegionId,
    }
    previousCandidate = candidate
    return candidate
  })

  const boundarySteps = internal.getBoundarySteps(centerPath)
  const boundaryPortIdsByStep =
    internal.assignBoundaryPortsForPath(boundarySteps)
  const firstBoundaryPorts = boundaryPortIdsByStep[0]
  const turningBoundaryStep = boundarySteps.at(-1)
  const turningBoundaryPorts = boundaryPortIdsByStep.at(-1)

  expect(turningBoundaryStep).toBeDefined()
  expect(turningBoundaryStep.fromRegionId).toBe(36)
  expect(turningBoundaryStep.toRegionId).toBe(35)
  expect(turningBoundaryStep.normalX).toBeGreaterThan(0)
  expect(firstBoundaryPorts).toBeDefined()
  expect(turningBoundaryPorts).toBeDefined()
  expect(
    firstBoundaryPorts.map((portId: number) => solver.topology.portX[portId]),
  ).toEqual(
    [
      ...firstBoundaryPorts.map(
        (portId: number) => solver.topology.portX[portId],
      ),
    ].sort((left, right) => right - left),
  )
  expect(
    turningBoundaryPorts.map((portId: number) => solver.topology.portX[portId]),
  ).toEqual(
    [
      ...turningBoundaryPorts.map(
        (portId: number) => solver.topology.portX[portId],
      ),
    ].sort((left, right) => left - right),
  )
})

test("CM5IO bus1 preserves start-side order on the first boundary fanout", async () => {
  const solver = await createCm5ioBus1Solver()
  const internal = solver as any

  const centerPath: any[] = [
    {
      portId: 6768,
      nextRegionId: 72,
      g: 0,
      h: 0,
      f: 0,
    },
    {
      portId: 3087,
      nextRegionId: 27,
      g: 1,
      h: 0,
      f: 1,
    },
  ]

  centerPath[1].prevCandidate = centerPath[0]
  centerPath[1].prevRegionId = centerPath[0].nextRegionId

  const boundarySteps = internal.getBoundarySteps(centerPath)
  const firstBoundaryPorts =
    internal.assignBoundaryPortsForPath(boundarySteps)[0]

  expect(boundarySteps).toHaveLength(1)
  expect(firstBoundaryPorts).toEqual([
    3095, 3093, 3091, 3089, 3087, 3085, 3083, 3081, 3079,
  ])
  expect(
    firstBoundaryPorts.map((portId: number) => solver.topology.portY[portId]),
  ).toEqual(
    [
      ...firstBoundaryPorts.map(
        (portId: number) => solver.topology.portY[portId],
      ),
    ].sort((left, right) => right - left),
  )
})

test("CM5IO bus1 never accepts an intersecting centerline bus solution", async () => {
  const solver = await createCm5ioBus1Solver()

  solver.solve()

  expect(solver.iterations).toBeLessThanOrEqual(200)
  expect(solver.stats.busCenterConnectionId).toBe("source_trace_108")
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput().solvedRoutes).toHaveLength(9)
  expect(
    solver.state.regionSegments.reduce(
      (segmentCount, regionSegments) => segmentCount + regionSegments.length,
      0,
    ),
  ).toBeGreaterThan(0)

  const sameLayerIntersectionCount =
    solver.state.regionIntersectionCaches.reduce(
      (total, regionCache) =>
        total + regionCache.existingSameLayerIntersections,
      0,
    )
  const crossingLayerIntersectionCount =
    solver.state.regionIntersectionCaches.reduce(
      (total, regionCache) =>
        total + regionCache.existingCrossingLayerIntersections,
      0,
    )

  expect(sameLayerIntersectionCount).toBe(0)
  expect(crossingLayerIntersectionCount).toBe(0)

  const routeIdsByPortId = new Map<number, Set<number>>()
  for (const regionSegments of solver.state.regionSegments) {
    for (const [routeId, fromPortId, toPortId] of regionSegments) {
      if (solver.problem.routeStartPort[routeId] !== fromPortId) {
        const fromPortRouteIds =
          routeIdsByPortId.get(fromPortId) ?? new Set<number>()
        fromPortRouteIds.add(routeId)
        routeIdsByPortId.set(fromPortId, fromPortRouteIds)
      }
      if (solver.problem.routeEndPort[routeId] !== toPortId) {
        const toPortRouteIds =
          routeIdsByPortId.get(toPortId) ?? new Set<number>()
        toPortRouteIds.add(routeId)
        routeIdsByPortId.set(toPortId, toPortRouteIds)
      }
    }
  }

  for (const routeIds of routeIdsByPortId.values()) {
    expect(routeIds.size).toBe(1)
  }
  expect(
    solver.state.regionSegments.every((regionSegments) =>
      regionSegments.every(
        ([, fromPortId, toPortId]) =>
          solver.topology.portZ[fromPortId] === 0 &&
          solver.topology.portZ[toPortId] === 0,
      ),
    ),
  ).toBe(true)
})

test("CM5IO bus1 solved visualize only shows final traces", async () => {
  const solver = await createCm5ioBus1Solver()

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const graphics = solver.visualize()

  expect(
    (graphics.points ?? []).some(
      (point) =>
        typeof point.label === "string" && point.label.includes("g: "),
    ),
  ).toBe(false)
  expect(
    (graphics.lines ?? []).some((line) => typeof line.label !== "string"),
  ).toBe(false)
})
