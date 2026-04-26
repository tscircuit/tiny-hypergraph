import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"
import { sameNetSharedBottleneckFixture } from "tests/fixtures/same-net-shared-bottleneck.fixture"

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

test("visualize includes z labels on route points", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    sameNetSharedBottleneckFixture,
  )
  const solver = new TinyHyperGraphSolver(topology, problem)
  const graphics = solver.visualize()
  const routePointLabels = (graphics.points ?? [])
    .map((point) => point.label)
    .filter(
      (label): label is string =>
        typeof label === "string" &&
        (label.includes("route-a") || label.includes("route-b")),
    )

  expect(routePointLabels.length).toBeGreaterThan(0)
  for (const label of routePointLabels) {
    expect(label).toContain("z: 0")
  }
})

test("visualize includes z labels on solved route segment hovers", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    sameNetSharedBottleneckFixture,
  )
  const solver = new TinyHyperGraphSolver(topology, problem)

  solver.solve()

  const graphics = solver.visualize()
  const routeSegmentLabels = (graphics.lines ?? [])
    .map((line) => line.label)
    .filter(
      (label): label is string =>
        typeof label === "string" &&
        (label.includes("route: route-a") || label.includes("route: route-b")),
    )

  expect(routeSegmentLabels.length).toBeGreaterThan(0)
  for (const label of routeSegmentLabels) {
    expect(label).toContain("z: 0")
  }
})
