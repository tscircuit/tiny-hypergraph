import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { loadSerializedHyperGraph, TinyHyperGraphSolver } from "lib/index"
import graph from "../fixtures/h616-closed-return-path.json"

test("serializes a preloaded route that returns through the same ports", (): void => {
  const loaded = loadSerializedHyperGraph(graph)
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(() => solver.getOutput()).toThrow("not a single ordered path")
  const graphics = solver.visualize()
  graphics.texts = [
    {
      x: 8.6,
      y: 3.9,
      fontSize: 0.08,
      color: "#334155",
      text: "Serialization rejects a valid preloaded return path",
    },
  ]
  expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
