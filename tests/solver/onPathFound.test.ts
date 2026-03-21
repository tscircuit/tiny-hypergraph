import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/index"

test("onPathFound commits a multi-region route into solver state", () => {
  const solver = new TinyHyperGraphSolver(
    {
      portCount: 3,
      regionCount: 2,
      regionIncidentPorts: [
        [0, 1],
        [1, 2],
      ],
      incidentPortRegion: [[0], [0, 1], [1]],
      regionWidth: new Float64Array([2, 2]),
      regionHeight: new Float64Array([2, 2]),
      regionCenterX: new Float64Array([0.5, 1.5]),
      regionCenterY: new Float64Array([0, 0]),
      portAngle: new Int32Array([0, 9000, 18000]),
      portX: new Float64Array([0, 1, 2]),
      portY: new Float64Array([0, 0, 0]),
      portZ: new Int32Array([0, 0, 0]),
    },
    {
      routeCount: 1,
      portSectionMask: new Int8Array([1, 1, 1]),
      routeStartPort: new Int32Array([0]),
      routeEndPort: new Int32Array([2]),
      routeNet: new Int32Array([0]),
    },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.regionSegments).toEqual([
    [[0, 0, 1]],
    [[0, 1, 2]],
  ])
  expect(Array.from(solver.state.portAssignment)).toEqual([0, 0, 0])
  expect(Array.from(solver.state.regionCongestionCost)).toEqual([0, 0])
  expect(
    solver.state.regionIntersectionCaches.map((cache) => ({
      netIds: Array.from(cache.netIds),
      lesserAngles: Array.from(cache.lesserAngles),
      greaterAngles: Array.from(cache.greaterAngles),
      layerMasks: Array.from(cache.layerMasks),
      existingSameLayerIntersections: cache.existingSameLayerIntersections,
      existingCrossingLayerIntersections:
        cache.existingCrossingLayerIntersections,
      existingEntryExitLayerChanges: cache.existingEntryExitLayerChanges,
      existingRegionCost: cache.existingRegionCost,
    })),
  ).toEqual([
    {
      netIds: [0],
      lesserAngles: [0],
      greaterAngles: [9000],
      layerMasks: [1],
      existingSameLayerIntersections: 0,
      existingCrossingLayerIntersections: 0,
      existingEntryExitLayerChanges: 0,
      existingRegionCost: 0,
    },
    {
      netIds: [0],
      lesserAngles: [9000],
      greaterAngles: [18000],
      layerMasks: [1],
      existingSameLayerIntersections: 0,
      existingCrossingLayerIntersections: 0,
      existingEntryExitLayerChanges: 0,
      existingRegionCost: 0,
    },
  ])
})

test("visualize labels rect regions with total region cost", () => {
  const solver = new TinyHyperGraphSolver(
    {
      portCount: 2,
      regionCount: 1,
      regionIncidentPorts: [[0, 1]],
      incidentPortRegion: [[0], [0]],
      regionWidth: new Float64Array([2]),
      regionHeight: new Float64Array([1]),
      regionCenterX: new Float64Array([0]),
      regionCenterY: new Float64Array([0]),
      portAngle: new Int32Array([0, 18000]),
      portX: new Float64Array([-1, 1]),
      portY: new Float64Array([0, 0]),
      portZ: new Int32Array([0, 0]),
    },
    {
      routeCount: 1,
      portSectionMask: new Int8Array([1, 1]),
      routeStartPort: new Int32Array([0]),
      routeEndPort: new Int32Array([1]),
      routeNet: new Int32Array([0]),
    },
  )

  solver.state.regionIntersectionCaches[0] = {
    ...solver.state.regionIntersectionCaches[0],
    existingRegionCost: 0.125,
  }
  solver.state.regionCongestionCost[0] = 0.25

  const graphics = solver.visualize()

  expect(graphics.rects?.[0]?.label).toBe("region-0\ncost: 0.375")
})

test("visualize always shows route endpoints with net ids", () => {
  const solver = new TinyHyperGraphSolver(
    {
      portCount: 2,
      regionCount: 1,
      regionIncidentPorts: [[0, 1]],
      incidentPortRegion: [[0], [0]],
      regionWidth: new Float64Array([2]),
      regionHeight: new Float64Array([1]),
      regionCenterX: new Float64Array([0]),
      regionCenterY: new Float64Array([0]),
      portAngle: new Int32Array([0, 18000]),
      portX: new Float64Array([-1, 1]),
      portY: new Float64Array([0, 0]),
      portZ: new Int32Array([0, 0]),
    },
    {
      routeCount: 1,
      portSectionMask: new Int8Array([1, 1]),
      routeStartPort: new Int32Array([0]),
      routeEndPort: new Int32Array([1]),
      routeNet: new Int32Array([7]),
      routeMetadata: [{ connectionId: "conn-a" }],
    },
  )

  solver.solve()

  const labels = graphicsPointLabels(solver.visualize())

  expect(labels).toContain("conn-a\nnet: 7\nstart")
  expect(labels).toContain("conn-a\nnet: 7\nend")
})

const graphicsPointLabels = (
  graphics: ReturnType<TinyHyperGraphSolver["visualize"]>,
) => (graphics.points ?? []).flatMap((point) => (point.label ? [point.label] : []))
