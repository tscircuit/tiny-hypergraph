import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/index"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/index"
import { visualizeTinyGraph } from "lib/visualizeTinyGraph"

const createVisualizationTopology = (): TinyHyperGraphTopology => ({
  portCount: 4,
  regionCount: 2,
  regionIncidentPorts: [
    [0, 1, 2, 3],
    [0, 1, 2, 3],
  ],
  incidentPortRegion: [
    [0, 1],
    [0, 1],
    [0, 1],
    [0, 1],
  ],
  regionWidth: new Float64Array([4, 4]),
  regionHeight: new Float64Array([4, 4]),
  regionCenterX: new Float64Array([0, 5]),
  regionCenterY: new Float64Array([0, 0]),
  portAngleForRegion1: new Int32Array(4),
  portAngleForRegion2: new Int32Array(4),
  portX: new Float64Array([0, 1, 2, 3]),
  portY: new Float64Array([0, 0, 0, 0]),
  portZ: new Int32Array(4),
})

const createVisualizationProblem = (): TinyHyperGraphProblem => ({
  routeCount: 1,
  portSectionMask: new Int8Array(4).fill(1),
  routeStartPort: new Int32Array([0]),
  routeEndPort: new Int32Array([1]),
  routeNet: new Int32Array([0]),
  regionNetId: new Int32Array(2).fill(-1),
})

test("visualizeTinyGraph draws unassigned ports after routing begins", () => {
  const solver = new TinyHyperGraphSolver(
    createVisualizationTopology(),
    createVisualizationProblem(),
  )

  solver.solve()

  const graphics = visualizeTinyGraph(solver)
  const circles = graphics.circles ?? []
  const unassignedCircles = circles.filter(
    (circle: { label?: string }) =>
      circle.label?.includes("assignment: unassigned"),
  )
  const unassignedLabels = unassignedCircles
    .map((circle: { label?: string }) => circle.label ?? "")
    .sort()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(Array.from(solver.state.portAssignment)).toEqual([0, 0, -1, -1])
  expect(unassignedCircles).toHaveLength(2)
  expect(
    unassignedLabels.some((label: string) => label.includes("port: port-2")),
  ).toBe(
    true,
  )
  expect(
    unassignedLabels.some((label: string) => label.includes("port: port-3")),
  ).toBe(
    true,
  )
})
