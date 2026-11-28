import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  loadSerializedHyperGraph,
  TinyHyperGraphSolver,
  TinyHyperGraphSectionSolver,
} from "lib/index"
import graph from "../fixtures/h616-closed-return-path.json"

test("serializes a preloaded route that returns through the same ports", (): void => {
  const loaded = loadSerializedHyperGraph(graph)
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem)
  solver.solve()
  expect(solver.solved).toBeTrue()
  const output = solver.getOutput()
  expect(output.solvedRoutes![0]!.path.map((point) => point.portId)).toEqual(
    graph.solvedRoutes[0]!.path.map((point) => point.portId),
  )
  const reloaded = loadSerializedHyperGraph(output)
  const replay = new TinyHyperGraphSectionSolver(
    reloaded.topology,
    reloaded.problem,
    reloaded.solution,
  )
  replay.solve()
  expect(replay.solved).toBeTrue()
  expect(replay.getOutput().solvedRoutes![0]!.path).toHaveLength(5)
  const graphics = solver.visualize()
  graphics.texts = [
    {
      x: 8.6,
      y: 3.9,
      fontSize: 0.08,
      color: "#334155",
      text: `Serialized return path: ${output.solvedRoutes![0]!.path.length} visits; replay preserved`,
    },
  ]
  expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
