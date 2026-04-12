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

test("visualize assigns z-layer labels to region and port objects", () => {
  const { topology, problem } = loadSerializedHyperGraph(datasetHg07.sample002)
  const solver = new TinyHyperGraphSolver(topology, problem)
  const graphics = solver.visualize()

  const expectedRegionLayer = `z${datasetHg07.sample002.regions[0]!.d!.availableZ!.join(",")}`
  const expectedPortLayer = `z${datasetHg07.sample002.ports[0]!.d!.z}`

  const region0Rect = (graphics.rects ?? []).find((rect) =>
    rect.label?.includes("region: region-0"),
  )
  const port0Circle = (graphics.circles ?? []).find((circle) =>
    circle.label?.includes(`port: ${datasetHg07.sample002.ports[0]!.portId}`),
  )
  const startEndpoint = (graphics.points ?? []).find((point) =>
    point.label?.includes("endpoint: start"),
  )

  expect(region0Rect?.layer).toBe(expectedRegionLayer)
  expect(port0Circle?.layer).toBe(expectedPortLayer)
  expect(startEndpoint?.layer).toMatch(/^z\d+(,\d+)*$/)
})
