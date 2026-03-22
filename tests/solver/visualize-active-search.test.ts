import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"

test("visualize renders an active search iteration without throwing", () => {
  const { topology, problem } = loadSerializedHyperGraph(datasetHg07.sample002)
  const solver = new TinyHyperGraphSolver(topology, problem)

  let hasActiveFrontier = false
  for (let stepIndex = 0; stepIndex < 20; stepIndex++) {
    solver.step()
    if (solver.state.candidateQueue.length > 0) {
      hasActiveFrontier = true
      break
    }
  }

  expect(hasActiveFrontier).toBe(true)

  const graphics = solver.visualize()

  expect((graphics.rects ?? []).length).toBeGreaterThan(0)
  expect((graphics.points ?? []).length).toBeGreaterThan(0)
  expect((graphics.lines ?? []).length).toBeGreaterThan(0)
})
