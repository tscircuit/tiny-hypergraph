import { expect, test } from "bun:test"
import {
  createEmptyRegionIntersectionCache,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"
import {
  afterColor,
  beforeColor,
  expectPerformanceSvg,
  performanceCanvas,
  projectVisual,
  visualMetric,
  visualPanel,
  visualText,
} from "./fixtures/performanceVisual"

class CountingSelectiveSolver extends SelectiveReripTinyHyperGraphSolver {
  appendCount = 0
  useCurrentNetInCost = false

  protected override computeRegionCostForRegion(
    regionId: number,
    numSameLayerIntersections: number,
    numCrossLayerIntersections: number,
    numEntryExitChanges: number,
    traceCount: number,
  ): number {
    return (
      super.computeRegionCostForRegion(
        regionId,
        numSameLayerIntersections,
        numCrossLayerIntersections,
        numEntryExitChanges,
        traceCount,
      ) + (this.useCurrentNetInCost ? (this.state.currentRouteNetId ?? 0) : 0)
    )
  }

  override appendSegmentToRegionCache(
    regionId: number,
    fromPortId: number,
    toPortId: number,
  ): void {
    this.appendCount++
    super.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
  }
}

const createSolver = (): CountingSelectiveSolver => {
  const mainRegionsByPort = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2]
  const regionIncidentPorts = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [8, 9, 10],
    ...mainRegionsByPort.map((_, portId) => [portId]),
    [],
  ]
  const regionCount = regionIncidentPorts.length
  const topology: TinyHyperGraphTopology = {
    portCount: mainRegionsByPort.length,
    regionCount,
    regionIncidentPorts,
    incidentPortRegion: mainRegionsByPort.map((regionId, portId) => [
      regionId,
      portId + 3,
    ]),
    regionWidth: new Float64Array(regionCount).fill(10),
    regionHeight: new Float64Array(regionCount).fill(10),
    regionCenterX: new Float64Array(regionCount),
    regionCenterY: new Float64Array(regionCount),
    regionAvailableZMask: new Int32Array(regionCount).fill(3),
    portAngleForRegion1: new Int32Array([
      0, 18000, 9000, 27000, 0, 18000, 9000, 27000, 0, 18000, 27000,
    ]),
    portAngleForRegion2: new Int32Array(mainRegionsByPort.length),
    portX: new Float64Array([0, 2, 1, 1, 4, 6, 5, 5, 8, 10, 9]),
    portY: new Float64Array([1, 1, 0, 2, 1, 1, 0, 2, 1, 1, 2]),
    portZ: new Int32Array([0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 6,
    routeStartPort: new Int32Array([0, 2, 4, 6, 8, 8]),
    routeEndPort: new Int32Array([1, 3, 5, 7, 9, 10]),
    routeNet: new Int32Array([0, 1, 2, 3, 4, 4]),
    regionNetId: new Int32Array(regionCount).fill(-1),
    portSectionMask: new Int8Array(mainRegionsByPort.length).fill(1),
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
      { routeId: 1, regionId: 0, fromPortId: 2, toPortId: 3 },
      { routeId: 2, regionId: 1, fromPortId: 4, toPortId: 5 },
      { routeId: 3, regionId: 1, fromPortId: 6, toPortId: 7 },
      { routeId: 4, regionId: 2, fromPortId: 8, toPortId: 9 },
      { routeId: 5, regionId: 2, fromPortId: 8, toPortId: 10 },
    ],
  }
  return new CountingSelectiveSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
}

const originalRebuild = (
  solver: CountingSelectiveSolver,
  rippedRouteIds: ReadonlySet<number>,
): void => {
  solver.state.regionSegments = solver.state.regionSegments.map((segments) =>
    segments.filter(([routeId]) => !rippedRouteIds.has(routeId)),
  )
  solver.state.portAssignment.fill(-1)
  solver.state.regionIntersectionCaches = Array.from(
    { length: solver.topology.regionCount },
    () => createEmptyRegionIntersectionCache(),
  )
  for (let regionId = 0; regionId < solver.topology.regionCount; regionId++) {
    for (const [routeId, fromPortId, toPortId] of solver.state.regionSegments[
      regionId
    ]!) {
      const routeNetId = solver.problem.routeNet[routeId]!
      solver.state.currentRouteNetId = routeNetId
      for (const portId of [fromPortId, toPortId]) {
        const assignedNetId = solver.state.portAssignment[portId]!
        if (assignedNetId !== -1 && assignedNetId !== routeNetId) {
          throw new Error(
            `SelectiveReripTinyHyperGraphSolver: rebuilding committed routes found cross-net ownership at port ${portId} between net ${assignedNetId} and net ${routeNetId}`,
          )
        }
        solver.state.portAssignment[portId] = routeNetId
      }
      solver.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    }
  }
  solver.state.currentRouteNetId = undefined
}

const rebuild = (
  solver: CountingSelectiveSolver,
  rippedRouteIds: ReadonlySet<number>,
): void => {
  const internalSolver = solver as unknown as {
    rebuildCommittedState: (routeIds: ReadonlySet<number>) => void
  }
  internalSolver.rebuildCommittedState(rippedRouteIds)
}

test("selective rerips reuse only unchanged region geometry and preserve ownership checks", async (): Promise<void> => {
  const workSnapshots = []
  for (const routeIds of [[], [99], [0], [0, 2], [4], [0, 1, 2, 3, 4, 5]]) {
    const optimized = createSolver()
    const original = createSolver()
    const previousCaches = [...optimized.state.regionIntersectionCaches]
    const previousSegments = [...optimized.state.regionSegments]
    const rippedRouteIds = new Set(routeIds)

    originalRebuild(original, rippedRouteIds)
    rebuild(optimized, rippedRouteIds)

    expect(optimized.state).toEqual(original.state)
    expect(optimized.appendCount).toBeLessThanOrEqual(original.appendCount)
    let expectedAppends = 0
    for (let regionId = 0; regionId < previousSegments.length; regionId++) {
      const changed = previousSegments[regionId]!.some(([routeId]) =>
        rippedRouteIds.has(routeId),
      )
      if (changed) {
        expect(optimized.state.regionIntersectionCaches[regionId]).not.toBe(
          previousCaches[regionId],
        )
        expectedAppends += optimized.state.regionSegments[regionId]!.length
      } else {
        expect(optimized.state.regionIntersectionCaches[regionId]).toBe(
          previousCaches[regionId],
        )
      }
    }
    expect(optimized.appendCount).toBe(expectedAppends)
    workSnapshots.push({
      rippedRouteIds: routeIds,
      beforeRebuildAllRegions: { appendedSegments: original.appendCount },
      afterRebuildChangedRegions: { appendedSegments: optimized.appendCount },
      reusedGeometryRegions: previousCaches.flatMap((cache, regionId) =>
        previousSegments[regionId]!.length > 0 &&
        optimized.state.regionIntersectionCaches[regionId] === cache
          ? [regionId]
          : [],
      ),
      remainingCommittedRoutes: optimized.state.regionSegments
        .slice(0, 3)
        .map((segments) => segments.map(([routeId]) => routeId)),
    })
    if (routeIds.length === 1 && routeIds[0] === 0) {
      const graphics = performanceCanvas(
        "Ripping one route only rebuilds the region it changed",
        "Both views show the same committed copper after removing route 0. Color identifies geometry rebuilt versus reused.",
      )
      for (const [left, solver, title, color] of [
        [24, original, "Before: rebuild every populated region", beforeColor],
        [624, optimized, "After: retain untouched region geometry", afterColor],
      ] as const) {
        visualPanel(
          graphics,
          left,
          title,
          "Orange = rebuilt cache. Green = retained cache. Copper stays identical.",
          color,
        )
        const project = projectVisual(
          { minX: -0.5, maxX: 10.5, minY: -0.6, maxY: 2.6 },
          left + 26,
          214,
          500,
          240,
        )
        for (const regionId of [0, 1, 2]) {
          const ports = solver.topology.regionIncidentPorts[regionId]!
          const xs = ports.map((portId) => solver.topology.portX[portId]!)
          const rebuilt =
            left === 24 ||
            previousCaches[regionId] !==
              optimized.state.regionIntersectionCaches[regionId]
          const regionColor = rebuilt ? beforeColor : afterColor
          const center = project({
            x: (Math.min(...xs) + Math.max(...xs)) / 2,
            y: 1,
          })
          graphics.rects.push({
            center,
            width: ((Math.max(...xs) - Math.min(...xs) + 0.6) / 11) * 500,
            height: (2.6 / 11) * 500,
            fill: rebuilt ? "rgba(180,83,9,0.10)" : "rgba(4,120,87,0.10)",
            stroke: regionColor,
          })
          visualText(
            graphics,
            center.x - 39,
            center.y - 92,
            `Region ${regionId}`,
            16,
          )
          visualText(
            graphics,
            center.x - 31,
            center.y - 68,
            rebuilt ? "rebuild" : "reuse",
            14,
            regionColor,
          )
          for (const [routeId, from, to] of solver.state.regionSegments[
            regionId
          ]!) {
            graphics.lines.push({
              points: [from, to].map((portId) =>
                project({
                  x: solver.topology.portX[portId]!,
                  y: solver.topology.portY[portId]!,
                }),
              ),
              strokeWidth: 3,
              strokeColor: routeId % 2 === 0 ? "#2563eb" : "#7c3aed",
              ...(solver.topology.portZ[from] === 1
                ? { strokeDash: "7 4" }
                : {}),
            })
          }
          for (const portId of ports) {
            graphics.circles.push({
              center: project({
                x: solver.topology.portX[portId]!,
                y: solver.topology.portY[portId]!,
              }),
              radius: 3,
              fill: "white",
              stroke: "#475569",
            })
          }
        }
        graphics.lines.push({
          points: [project({ x: 0, y: 1 }), project({ x: 2, y: 1 })],
          strokeColor: "#94a3b8",
          strokeWidth: 2,
          strokeDash: "4 4",
        })
        visualText(
          graphics,
          left + 20,
          486,
          "Gray dashed segment: removed route 0. Blue/purple: retained copper.",
          13,
          "#64748b",
        )
      }
      visualMetric(
        graphics,
        "Segments appended while rebuilding committed geometry",
        original.appendCount,
        optimized.appendCount,
        "Committed state matches the full rebuild; subsequent routing and ownership checks also match.",
      )
      await expectPerformanceSvg(graphics, import.meta.path)
    }

    // Recommit ripped routes as future pathfinding would, then remove another
    // set. Retained caches must stay independent from changed neighboring ones.
    for (const { routeId, regionId, fromPortId, toPortId } of optimized.problem
      .initialAssignments!) {
      if (!rippedRouteIds.has(routeId)) continue
      for (const solver of [optimized, original]) {
        solver.state.currentRouteNetId = solver.problem.routeNet[routeId]!
        solver.state.regionSegments[regionId]!.push([
          routeId,
          fromPortId,
          toPortId,
        ])
        solver.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }
    originalRebuild(original, new Set([3]))
    rebuild(optimized, new Set([3]))
    expect(optimized.state).toEqual(original.state)

    // Continue routing against the rebuilt copper, including preloaded and
    // same-net shared endpoints, and compare serialized geometry and work.
    for (const solver of [optimized, original]) {
      solver.state.unroutedRoutes = [3]
      solver.solve()
    }
    expect(optimized.solved).toBe(true)
    expect(optimized.failed).toBe(false)
    expect(optimized.iterations).toBe(original.iterations)
    expect(optimized.getOutput()).toEqual(original.getOutput())
  }
  expect(workSnapshots).toMatchSnapshot(
    "selective rerips only rebuild geometry in changed regions",
  )

  const costUpdates: Array<(solver: CountingSelectiveSolver) => void> = [
    (solver) => {
      solver.minViaPadDiameter = 0.7
    },
    (solver) => {
      solver.TRACE_DENSITY_COST_FACTOR = 2
    },
    (solver) => {
      solver.topology.regionWidth[0] = 4
    },
    (solver) => {
      solver.topology.regionHeight[1] = 3
    },
    (solver) => {
      solver.topology.regionAvailableZMask![0] = 1
    },
    (solver) => {
      solver.useCurrentNetInCost = true
    },
  ]
  for (const updateCost of costUpdates) {
    for (const routeIds of [[], [2]]) {
      const optimized = createSolver()
      const original = createSolver()
      const previousCaches = [...optimized.state.regionIntersectionCaches]
      const previousCosts = previousCaches.map(
        (cache) => cache.existingRegionCost,
      )
      updateCost(optimized)
      updateCost(original)
      originalRebuild(original, new Set(routeIds))
      rebuild(optimized, new Set(routeIds))
      expect(optimized.state).toEqual(original.state)
      expect(optimized.appendCount).toBe(routeIds.length === 0 ? 0 : 1)
      for (const regionId of [0, 2]) {
        const cache = optimized.state.regionIntersectionCaches[regionId]!
        const previous = previousCaches[regionId]!
        expect(cache.netIds).toBe(previous.netIds)
        expect(cache.lesserAngles).toBe(previous.lesserAngles)
        expect(cache.greaterAngles).toBe(previous.greaterAngles)
        expect(cache.layerMasks).toBe(previous.layerMasks)
        expect(previous.existingRegionCost).toBe(previousCosts[regionId])
      }
    }
  }

  for (const routeIds of [[], [0]]) {
    const optimized = createSolver()
    const original = createSolver()
    // Cross-net ownership remains a loud invariant error even in an otherwise
    // unchanged region, rather than being bypassed together with cache work.
    for (const solver of [optimized, original]) {
      solver.state.regionSegments[2]!.push([0, 8, 10])
    }
    let originalError = ""
    try {
      originalRebuild(original, new Set(routeIds))
    } catch (error) {
      originalError = (error as Error).message
    }
    if (routeIds.length === 0) {
      expect(originalError).toContain("cross-net ownership at port 8")
      expect(() => rebuild(optimized, new Set(routeIds))).toThrow(originalError)
    } else {
      rebuild(optimized, new Set(routeIds))
      expect(optimized.state).toEqual(original.state)
    }
  }
})
