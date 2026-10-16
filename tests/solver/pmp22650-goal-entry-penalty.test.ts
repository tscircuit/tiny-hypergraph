import "bun-match-svg"
import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import {
  createPmp22650GoalEntrySolver,
  pmp22650GoalEntryFixture,
  pmp22650GoalEntryProblem,
  pmp22650GoalEntryTopology,
} from "./pmp22650-goal-entry-penalty-fixture"

const getPmp22650ConnectionGraphics = (
  solver: ReturnType<typeof createPmp22650GoalEntrySolver>,
  title: string,
): GraphicsObject => {
  const center = { x: 150.2, y: 79.6 }
  const radius = 2
  const isLocalPoint = (point: { x: number; y: number }): boolean =>
    Math.abs(point.x - center.x) <= radius &&
    Math.abs(point.y - center.y) <= radius

  return {
    coordinateSystem: "cartesian",
    title,
    rects: Array.from(
      { length: pmp22650GoalEntryTopology.regionCount },
      (_, regionId) => ({
        center: {
          x: pmp22650GoalEntryTopology.regionCenterX[regionId]!,
          y: pmp22650GoalEntryTopology.regionCenterY[regionId]!,
        },
        width: pmp22650GoalEntryTopology.regionWidth[regionId]!,
        height: pmp22650GoalEntryTopology.regionHeight[regionId]!,
        fill:
          pmp22650GoalEntryProblem.regionNetId[regionId] === -1
            ? "rgba(30, 41, 59, 0.3)"
            : "rgba(37, 99, 235, 0.35)",
        stroke: "#334155",
        strokeWidth: 0.01,
      }),
    ).filter((rect) => isLocalPoint(rect.center)),
    circles: Array.from(
      { length: pmp22650GoalEntryTopology.portCount },
      (_, portId) => ({
        center: {
          x: pmp22650GoalEntryTopology.portX[portId]!,
          y: pmp22650GoalEntryTopology.portY[portId]!,
        },
        radius: 0.025,
        fill:
          (pmp22650GoalEntryProblem.portPenalty?.[portId] ?? 0) > 0
            ? "#ef4444"
            : "#64748b",
      }),
    ).filter((circle) => isLocalPoint(circle.center)),
    points: [
      {
        x: pmp22650GoalEntryTopology.portX[
          pmp22650GoalEntryProblem.routeStartPort[0]!
        ]!,
        y: pmp22650GoalEntryTopology.portY[
          pmp22650GoalEntryProblem.routeStartPort[0]!
        ]!,
        color: "#22d3ee",
        label: "C145.2",
      },
      {
        x: pmp22650GoalEntryTopology.portX[
          pmp22650GoalEntryProblem.routeEndPort[0]!
        ]!,
        y: pmp22650GoalEntryTopology.portY[
          pmp22650GoalEntryProblem.routeEndPort[0]!
        ]!,
        color: "#a3e635",
        label: "U33.11",
      },
    ],
    lines: [
      {
        points: [
          {
            x: pmp22650GoalEntryTopology.portX[
              pmp22650GoalEntryProblem.routeStartPort[0]!
            ]!,
            y: pmp22650GoalEntryTopology.portY[
              pmp22650GoalEntryProblem.routeStartPort[0]!
            ]!,
          },
          {
            x: pmp22650GoalEntryTopology.portX[
              pmp22650GoalEntryProblem.routeEndPort[0]!
            ]!,
            y: pmp22650GoalEntryTopology.portY[
              pmp22650GoalEntryProblem.routeEndPort[0]!
            ]!,
          },
        ],
        strokeColor: "#64748b",
        strokeWidth: 0.025,
        label: "unrouted connection",
      },
      ...solver.state.regionSegments.flatMap((regionSegments) =>
        regionSegments.map(([, fromPortId, toPortId]) => ({
          points: [
            {
              x: pmp22650GoalEntryTopology.portX[fromPortId]!,
              y: pmp22650GoalEntryTopology.portY[fromPortId]!,
            },
            {
              x: pmp22650GoalEntryTopology.portX[toPortId]!,
              y: pmp22650GoalEntryTopology.portY[toPortId]!,
            },
          ],
          strokeColor: "#facc15",
          strokeWidth: 0.08,
          label: "routed segment",
        })),
      ),
    ],
  }
}

test("PMP22650 routes through a required penalized goal entry", () => {
  const solver = createPmp22650GoalEntrySolver()
  const beforeGraphics = getPmp22650ConnectionGraphics(
    solver,
    "PMP22650 before routing",
  )

  for (let step = 0; step < 100; step++) solver.step()

  const afterGraphics = getPmp22650ConnectionGraphics(
    solver,
    "PMP22650 after 100 search steps: routed",
  )
  expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally([beforeGraphics, afterGraphics]),
      {
        backgroundColor: "#0d1b2a",
        svgWidth: 1400,
        svgHeight: 700,
      },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(pmp22650GoalEntryFixture.source).toEqual({
    board: "PMP22650",
    dataset: "dataset-srj24 sample024",
    connectionId: "source_net_altium_pcb_408_mst8",
    originalRouteId: 562,
    captureBoundary: "post-DuplicateCongestedPortSolver tiny hypergraph input",
  })
  expect(solver.solved).toBe(true)
  expect(solver.getNeverSuccessfullyRoutedRoutes()).toEqual([])
})
