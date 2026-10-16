import "bun-match-svg"
import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import {
  createPmp22650RouteSolver,
  getPmp22650RouteGraphics,
  pmp22650RouteFixture,
} from "./pmp22650-route158-fixture"

test("PMP22650 outside-in search completes route 158", () => {
  const searchStepCount = 5_000
  const solver = createPmp22650RouteSolver()
  const targetRouteId = pmp22650RouteFixture.targetRouteId
  const beforeGraphics = getPmp22650RouteGraphics({
    solver,
    title: `PMP22650 before ${searchStepCount} search steps`,
    showRatsnest: true,
  })

  for (let step = 0; step < searchStepCount; step++) {
    solver.step()
    if (solver.hasRouteSucceeded(targetRouteId)) break
  }

  const targetRouteCompleted = solver.hasRouteSucceeded(targetRouteId)
  const afterGraphics = getPmp22650RouteGraphics({
    solver,
    title: `PMP22650 after ${searchStepCount} search steps: route ${targetRouteCompleted ? "completed" : "not completed"}`,
    showRatsnest: true,
  })
  expect(
    getSvgFromGraphicsObject(
      stackGraphicsVertically([beforeGraphics, afterGraphics]),
      {
        backgroundColor: "#0d1b2a",
        svgWidth: 1400,
        svgHeight: 900,
      },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(targetRouteCompleted).toBe(true)
}, 120_000)
