import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { getCenterCandidatePath } from "lib/bus-solver/busPathHelpers"
import {
  filterPortPointPathingSolverInputByConnectionPatches,
  TinyHyperGraphBusSolver,
  type ConnectionPatchSelection,
} from "lib/index"

const CM5IO_CENTER_PORT_OPTIONS_PER_EDGE = 16

const getColorAlpha = (color: string): number => {
  const match = color.match(/^(?:rgba|hsla)\((.*),\s*([0-9]*\.?[0-9]+)\)$/)
  if (!match) {
    throw new Error(`Unsupported color format: ${color}`)
  }

  return Number(match[2])
}

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
    CENTER_PORT_OPTIONS_PER_EDGE: CM5IO_CENTER_PORT_OPTIONS_PER_EDGE,
  })
}

const getPortIdBySerializedId = (
  solver: TinyHyperGraphBusSolver,
  serializedPortId: string,
) => {
  const portId = solver.topology.portMetadata?.findIndex(
    (metadata) => metadata?.serializedPortId === serializedPortId,
  )

  if (portId === undefined || portId < 0) {
    throw new Error(`Could not find serialized port ${serializedPortId}`)
  }

  return portId
}

const getSerializedPortId = (solver: TinyHyperGraphBusSolver, portId: number) =>
  solver.topology.portMetadata?.[portId]?.serializedPortId

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

test("CM5IO bus1 visualize dims non-center bus traces and route points", async () => {
  const solver = await createCm5ioBus1Solver()

  solver.step()
  solver.step()

  const graphics = solver.visualize()
  const centerConnectionId =
    solver.busTraceOrder.traces[solver.centerTraceIndex]!.connectionId
  const otherConnectionIds = solver.busTraceOrder.traces
    .filter((_, traceIndex) => traceIndex !== solver.centerTraceIndex)
    .map((trace) => trace.connectionId)

  const getRouteSegmentAlpha = (connectionId: string) => {
    const line = (graphics.lines ?? []).find(
      (candidate) =>
        typeof candidate.label === "string" &&
        candidate.label.includes(`route: ${connectionId}`) &&
        candidate.label.includes("region: region-") &&
        typeof candidate.strokeColor === "string",
    )

    expect(line).toBeDefined()
    return getColorAlpha(line!.strokeColor!)
  }

  const getRoutePortPointAlpha = (connectionId: string) => {
    const point = (graphics.points ?? []).find(
      (candidate) =>
        typeof candidate.label === "string" &&
        candidate.label.includes(`route: ${connectionId}`) &&
        candidate.label.includes("port: ") &&
        !candidate.label.includes("endpoint:") &&
        typeof candidate.color === "string",
    )

    expect(point).toBeDefined()
    return getColorAlpha(point!.color!)
  }

  const centerSegmentAlpha = getRouteSegmentAlpha(centerConnectionId)
  const centerPointAlpha = getRoutePortPointAlpha(centerConnectionId)

  expect(centerSegmentAlpha).toBeCloseTo(0.8, 6)
  expect(centerPointAlpha).toBeCloseTo(1, 6)

  for (const connectionId of otherConnectionIds) {
    expect(getRouteSegmentAlpha(connectionId)).toBeCloseTo(0.4, 6)
    expect(getRoutePortPointAlpha(connectionId)).toBeCloseTo(0.5, 6)
  }
})

test("CM5IO bus1 visualize only shows the current bus, not queued search overlays", async () => {
  const solver = await createCm5ioBus1Solver()

  solver.step()
  solver.step()

  expect(solver.state.candidateQueue.length).toBeGreaterThan(0)

  const graphics = solver.visualize()

  expect(
    (graphics.points ?? []).some(
      (point) => typeof point.label === "string" && point.label.includes("g: "),
    ),
  ).toBe(false)
  expect(
    (graphics.lines ?? []).some((line) => line.strokeDash === "10 5"),
  ).toBe(false)
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

test("CM5IO bus1 keeps boundary port ordering stable along the solved centerline", async () => {
  const solver = await createCm5ioBus1Solver()
  const internal = solver as any

  while (!solver.solved && !solver.failed) {
    solver.step()
  }

  expect(solver.solved).toBe(true)

  const centerPath = getCenterCandidatePath(internal.lastExpandedCandidate)

  const boundarySteps = internal.boundaryPlanner.getBoundarySteps(centerPath)
  const boundaryPortIdsByStep =
    internal.boundaryPlanner.assignBoundaryPortsForPath(boundarySteps)
  const firstBoundaryPorts = boundaryPortIdsByStep[0]
  const finalAssignedBoundaryPorts = boundaryPortIdsByStep.findLast(
    (boundaryPorts: number[] | undefined) => boundaryPorts !== undefined,
  )
  const finalAssignedBoundaryStep =
    boundarySteps[
      boundaryPortIdsByStep.findLastIndex(
        (boundaryPorts: number[] | undefined) => boundaryPorts !== undefined,
      )
    ]

  expect(firstBoundaryPorts).toBeDefined()
  expect(finalAssignedBoundaryPorts).toBeDefined()
  expect(finalAssignedBoundaryStep).toBeDefined()
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
    finalAssignedBoundaryPorts.map(
      (portId: number) => solver.topology.portY[portId],
    ),
  ).toEqual(
    [
      ...finalAssignedBoundaryPorts.map(
        (portId: number) => solver.topology.portY[portId],
      ),
    ].sort((left, right) => left - right),
  )
})

test("CM5IO bus1 uses greedy late remainder routing to choose ce466_pp4_z0::0", async () => {
  const solver = await createCm5ioBus1Solver()

  while (!solver.solved && !solver.failed) {
    solver.step()
  }

  expect(solver.solved).toBe(true)

  const internal = solver as any
  const centerPath = getCenterCandidatePath(internal.lastExpandedCandidate)
  const lastPreview = internal.lastPreview
  const serializedPortIds = centerPath.map(
    (candidate) =>
      solver.topology.portMetadata?.[candidate.portId]?.serializedPortId,
  )

  expect(serializedPortIds).toContain("ce466_pp4_z0::0")
  expect(lastPreview).toBeDefined()
  expect(lastPreview.sameLayerIntersectionCount).toBe(0)
  expect(lastPreview.crossingLayerIntersectionCount).toBe(0)

  const region11FanoutSegments = Object.fromEntries(
    lastPreview.tracePreviews.flatMap((tracePreview: any) => {
      const connectionId =
        solver.busTraceOrder.traces[tracePreview.traceIndex]!.connectionId

      return tracePreview.segments
        .filter(
          (segment: any) =>
            segment.regionId === 11 &&
            solver.topology.portMetadata?.[
              segment.fromPortId
            ]?.serializedPortId?.startsWith("ce466_"),
        )
        .map((segment: any) => [
          connectionId,
          {
            from: solver.topology.portMetadata?.[segment.fromPortId]
              ?.serializedPortId,
            to: solver.topology.portMetadata?.[segment.toPortId]
              ?.serializedPortId,
          },
        ])
    }),
  )

  expect(region11FanoutSegments).toMatchObject({
    source_trace_106: {
      from: "ce466_pp2_z0::0",
      to: "ce481_pp0_z0::0",
    },
    source_trace_107: {
      from: "ce466_pp3_z0::0",
      to: "ce483_pp0_z0::0",
    },
    source_trace_108: {
      from: "ce466_pp4_z0::0",
      to: "ce488_pp0_z0::0",
    },
    source_trace_109: {
      from: "ce466_pp5_z0::0",
      to: "ce490_pp0_z0::0",
    },
    source_trace_110: {
      from: "ce466_pp6_z0::0",
      to: "ce494_pp0_z0::0",
    },
    source_trace_111: {
      from: "ce466_pp7_z0::0",
      to: "ce496_pp0_z0::0",
    },
    source_trace_114: {
      from: "ce466_pp8_z0::0",
      to: "ce507_pp0_z0::0",
    },
  })
})

test("CM5IO bus1 preserves start-side order on the first boundary fanout", async () => {
  const solver = await createCm5ioBus1Solver()
  const internal = solver as any

  const centerPath: any[] = [
    {
      portId: getPortIdBySerializedId(solver, "ce1638_pp0_z0::0"),
      nextRegionId: 72,
      g: 0,
      h: 0,
      f: 0,
    },
    {
      portId: getPortIdBySerializedId(solver, "ce650_pp6_z0::0"),
      nextRegionId: 19,
      g: 1,
      h: 0,
      f: 1,
    },
  ]

  centerPath[1].prevCandidate = centerPath[0]
  centerPath[1].prevRegionId = centerPath[0].nextRegionId

  const boundarySteps = internal.boundaryPlanner.getBoundarySteps(centerPath)
  const firstBoundaryPorts =
    internal.boundaryPlanner.assignBoundaryPortsForPath(boundarySteps)[0]

  expect(boundarySteps).toHaveLength(1)
  expect(
    firstBoundaryPorts.map((portId: number) =>
      getSerializedPortId(solver, portId),
    ),
  ).toEqual([
    "ce650_pp10_z0::0",
    "ce650_pp9_z0::0",
    "ce650_pp8_z0::0",
    "ce650_pp7_z0::0",
    "ce650_pp6_z0::0",
    "ce650_pp5_z0::0",
    "ce650_pp4_z0::0",
    "ce650_pp3_z0::0",
    "ce650_pp2_z0::0",
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
      (point) => typeof point.label === "string" && point.label.includes("g: "),
    ),
  ).toBe(false)
  expect(
    (graphics.lines ?? []).some((line) => typeof line.label !== "string"),
  ).toBe(false)
})
