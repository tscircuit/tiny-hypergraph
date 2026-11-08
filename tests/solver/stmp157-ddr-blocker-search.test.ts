import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { getStmp157BlockerRepro } from "../fixtures/getStmp157BlockerRepro"

test("replays the STM32MP157 DDR blocker search", async (): Promise<void> => {
  const { solver, graphics } = getStmp157BlockerRepro()
  const result = solver["findRelaxedBlockerPath"]()
  expect(result.found).toBe(true)
  if (!result.found) throw new Error(result.reason)
  expect([...result.owners]).toEqual([15])
  expect(result.distance).toBeCloseTo(37.383226720955626, 10)
  for (let index = 1; index < result.states.length; index++) {
    const from = result.states[index - 1]!.portId
    const to = result.states[index]!.portId
    graphics.lines!.push({
      points: [
        { x: solver.topology.portX[from]!, y: solver.topology.portY[from]! },
        { x: solver.topology.portX[to]!, y: solver.topology.portY[to]! },
      ],
      strokeColor: "black",
      strokeWidth: 0.127,
      layer: `z${solver.topology.portZ[to]}`,
    })
  }
  await expect(getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }))
    .toMatchSvgSnapshot(import.meta.path)
})
