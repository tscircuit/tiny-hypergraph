import "bun-match-svg"
import { expect, test } from "bun:test"
import {
  type GraphicsObject,
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import { PreparedPortPointRoutingSolver } from "lib/prepared/PreparedPortPointRoutingSolver"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"
import { createPreparedRoutingFixture } from "tests/fixtures/createPreparedRoutingFixture"

test("final rerip stops before clearing routes when the shared budget expires", () => {
  const graphics: GraphicsObject[] = []
  for (const Parent of [
    SelectiveReripTinyHyperGraphSolver,
    PreparedPortPointRoutingSolver,
  ]) {
    class ObservedSolver extends Parent {
      createFinalSolver() {
        return this.createGreedyFinalRouteSolver({}, -1)
      }
    }
    const fixture = createPreparedRoutingFixture()
    const parent = new ObservedSolver(
      fixture.topology,
      fixture.problem,
      fixture.options,
    )
    const final = parent.createFinalSolver()
    while (
      final.state.unroutedRoutes.length +
        Number(final.state.currentRouteId !== undefined) >
      5
    ) {
      final.step()
    }
    graphics.push(final.visualize())
    final.state.ripCount = 8
    final.resetRoutingStateForRerip()
    expect(final.failed).toBe(false)
    expect(
      final.state.regionSegments.every((segments) => segments.length === 0),
    ).toBe(true)
    graphics.push(final.visualize())
  }
  expect(
    getSvgFromGraphicsObject(stackGraphicsVertically(graphics), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
