import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"

test("completion can traverse a graph larger than the fixed 50000-step limit", () => {
  const portCount = 50_002
  const regionCount = portCount - 1
  const solver = new TinyHyperGraphSolver(
    {
      portCount,
      regionCount,
      regionIncidentPorts: Array.from({ length: regionCount }, (_, i) => [
        i,
        i + 1,
      ]),
      incidentPortRegion: Array.from({ length: portCount }, (_, i) =>
        [i - 1, i].filter((region) => region >= 0 && region < regionCount),
      ),
      regionWidth: new Float64Array(regionCount).fill(1),
      regionHeight: new Float64Array(regionCount).fill(1),
      regionCenterX: Float64Array.from(
        { length: regionCount },
        (_, i) => i + 0.5,
      ),
      regionCenterY: new Float64Array(regionCount),
      regionAvailableZMask: new Int32Array(regionCount).fill(1),
      portAngleForRegion1: new Int32Array(portCount),
      portAngleForRegion2: new Int32Array(portCount).fill(18000),
      portX: Float64Array.from({ length: portCount }, (_, i) => i),
      portY: new Float64Array(portCount),
      portZ: new Int32Array(portCount),
    },
    {
      routeCount: 1,
      portSectionMask: new Int8Array(portCount).fill(1),
      routeStartPort: new Int32Array([0]),
      routeEndPort: new Int32Array([portCount - 1]),
      routeNet: new Int32Array([0]),
      regionNetId: new Int32Array(regionCount).fill(-1),
    },
    {
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
      GREEDY_FINAL_ROUTE_ITERS: 1,
      STATIC_REACHABILITY_PRECHECK: false,
    },
  )

  solver.tryFinalAcceptance()

  expect(solver.solved).toBe(true)
  expect(solver.state.unroutedRoutes).toHaveLength(0)
  expect(
    solver.state.regionSegments.every((segments) => segments.length === 1),
  ).toBe(true)
})
