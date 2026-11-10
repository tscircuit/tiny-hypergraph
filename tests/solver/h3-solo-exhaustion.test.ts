import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { getH3SoloRepro } from "../fixtures/getH3SoloRepro"

test("replays the H3 SDQS1_N independent route search", async (): Promise<void> => {
  const { solver, graphics } = getH3SoloRepro()
  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  const left = Math.min(
    ...graphics.rects!.map((rect) => rect.center.x - rect.width / 2),
  )
  const top = Math.max(
    ...graphics.rects!.map((rect) => rect.center.y + rect.height / 2),
  )
  graphics.texts = [
    {
      x: left,
      y: top + 2,
      text: `H3 SDQS1_N: ${solver.iterations} iterations; ${solver.state.ripCount} unchanged retries`,
      fontSize: 0.6,
      anchorSide: "center_left",
    },
    {
      x: left,
      y: top + 1,
      text: String(solver.error),
      fontSize: 0.5,
      anchorSide: "center_left",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
