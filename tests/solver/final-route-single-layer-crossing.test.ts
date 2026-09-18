import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { TinyHyperGraphSolver } from "lib/core"

test("goal acceptance and greedy completion preserve single-layer crossing constraints", () => {
  for (const greedy of [false, true]) {
    const solver = new TinyHyperGraphSolver(
      {
        portCount: 5,
        regionCount: 6,
        regionIncidentPorts: [[0, 1, 2, 3], [3, 4], [0], [1], [2], [4]],
        incidentPortRegion: [
          [0, 2],
          [0, 3],
          [0, 4],
          [0, 1],
          [1, 5],
        ],
        regionWidth: new Float64Array(6).fill(2),
        regionHeight: new Float64Array(6).fill(2),
        regionCenterX: new Float64Array(6),
        regionCenterY: new Float64Array([0, -2, 0, 2, 0, -4]),
        regionAvailableZMask: new Int32Array(6).fill(1 << 2),
        portAngleForRegion1: new Int32Array([18000, 9000, 0, 27000, 27000]),
        portAngleForRegion2: new Int32Array([0, 27000, 18000, 9000, 9000]),
        portX: new Float64Array([-1, 0, 1, 0, 0]),
        portY: new Float64Array([0, 1, 0, -1, -3]),
        portZ: new Int32Array(5).fill(2),
      },
      {
        routeCount: 2,
        portSectionMask: new Int8Array(5).fill(1),
        routeStartPort: new Int32Array([0, 1]),
        routeEndPort: new Int32Array([2, greedy ? 4 : 3]),
        routeNet: new Int32Array([0, 1]),
        regionNetId: new Int32Array(6).fill(-1),
      },
      { ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true, GREEDY_FINAL_ROUTE_ITERS: 1 },
    )
    solver.state.currentRouteNetId = 0
    solver.state.portAssignment[0] = 0
    solver.state.portAssignment[2] = 0
    solver.state.regionSegments[0].push([0, 0, 2])
    solver.appendSegmentToRegionCache(0, 0, 2)
    solver.state.currentRouteNetId = undefined
    solver.state.unroutedRoutes = [1]

    if (greedy) solver.tryFinalAcceptance()
    else solver.step()

    if (!greedy) {
      expect(
        getSvgFromGraphicsObject(
          {
            rects: [
              {
                center: { x: 0, y: 0 },
                width: 2,
                height: 2,
                fill: "rgba(0,120,255,0.06)",
              },
            ],
            points: [0, 1, 2, 3].map((portId) => ({
              x: solver.topology.portX[portId]!,
              y: solver.topology.portY[portId]!,
              color: portId % 2 === 0 ? "#2563eb" : "#dc2626",
            })),
            lines: solver.state.regionSegments[0]!.map(
              ([routeId, fromPortId, toPortId]) => ({
                points: [fromPortId, toPortId].map((portId) => ({
                  x: solver.topology.portX[portId]!,
                  y: solver.topology.portY[portId]!,
                })),
                strokeColor: routeId === 0 ? "#2563eb" : "#dc2626",
                strokeWidth: 0.03,
              }),
            ),
          },
          { backgroundColor: "white" },
        ),
      ).toMatchSvgSnapshot(import.meta.path)
    }
    expect(solver.solved).toBe(false)
    expect(solver.state.regionSegments[0]).toEqual([[0, 0, 2]])
  }
})
