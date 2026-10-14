import "bun-match-svg"
import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import {
  createPmp22650FinalTailSolver,
  getPmp22650FinalTailGraphics,
  pmp22650FinalTailFixture,
} from "./pmp22650-final-tail-fixture"

test("PMP22650 whole-route search stalls in the final tail", () => {
  const solver = createPmp22650FinalTailSolver()
  const remainingRouteIds = new Set(
    pmp22650FinalTailFixture.remainingRouteIds,
  )
  const beforeGraphics = getPmp22650FinalTailGraphics({
    solver,
    title: "PMP22650 before 50,000 search steps",
    showRatsnest: true,
  })

  for (let step = 0; step < 50_000; step++) solver.step()

  const routedRouteIds = new Set(
    solver.state.regionSegments.flatMap((regionSegments) =>
      regionSegments.map(([routeId]) => routeId),
    ),
  )
  const routedRouteCount = [...remainingRouteIds].filter((routeId) =>
    routedRouteIds.has(routeId),
  ).length
  const afterGraphics = getPmp22650FinalTailGraphics({
    solver,
    title: `PMP22650 after 50,000 search steps: ${routedRouteCount} of ${remainingRouteIds.size} routes completed`,
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
  expect(routedRouteCount).toBe(3)
}, 120_000)
