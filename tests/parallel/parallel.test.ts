import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  ParallelTinyHyperGraphSolver,
  solveTinyHyperGraphsParallel,
} from "../../lib/parallel"

function gridGraph(size = 4): SerializedHyperGraph {
  const regions: SerializedHyperGraph["regions"] = []
  const ports: SerializedHyperGraph["ports"] = []
  const connections: NonNullable<SerializedHyperGraph["connections"]> = []
  const region = (id: string, x: number, y: number) => {
    regions.push({
      regionId: id,
      pointIds: [],
      d: { center: { x, y }, width: 10, height: 10, availableZ: [0, 1] },
    })
    return id
  }
  const port = (a: string, b: string, x: number, y: number) => {
    const id = `p${ports.length}`
    ports.push({ portId: id, region1Id: a, region2Id: b, d: { x, y, z: 0 } })
    for (const r of regions)
      if (r.regionId === a || r.regionId === b) r.pointIds.push(id)
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) region(`${x}:${y}`, x * 10, y * 10)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      for (let k = 0; k < 3; k++) {
        if (x + 1 < size)
          port(`${x}:${y}`, `${x + 1}:${y}`, x * 10 + 5, y * 10 + k - 1)
        if (y + 1 < size)
          port(`${x}:${y}`, `${x}:${y + 1}`, x * 10 + k - 1, y * 10 + 5)
      }
  for (let i = 0; i < size; i++) {
    const src = region(`s${i}`, -10, i * 10),
      dst = region(`t${i}`, size * 10, (size - 1 - i) * 10)
    port(src, `0:${i}`, -5, i * 10)
    port(`${size - 1}:${size - 1 - i}`, dst, size * 10 - 5, (size - 1 - i) * 10)
    connections.push({
      connectionId: `c${i}`,
      startRegionId: src,
      endRegionId: dst,
      mutuallyConnectedNetworkId: `n${i}`,
    })
  }
  return { regions, ports, connections }
}
const compare = async (
  graph: SerializedHyperGraph,
  workers: number,
  options = {},
) => {
  const a = loadSerializedHyperGraph(graph),
    b = loadSerializedHyperGraph(graph)
  const serial = new TinyHyperGraphSolver(a.topology, a.problem, options)
  const parallel = new ParallelTinyHyperGraphSolver(b.topology, b.problem, {
    ...options,
    workers,
  })
  serial.solve()
  await parallel.solveAsync()
  expect([
    parallel.solved,
    parallel.failed,
    parallel.error,
    parallel.iterations,
  ]).toEqual([serial.solved, serial.failed, serial.error, serial.iterations])
  expect(parallel.state.regionSegments).toEqual(serial.state.regionSegments)
  expect(parallel.state.portAssignment).toEqual(serial.state.portAssignment)
  expect(parallel.stats).toEqual(serial.stats)
  if (serial.solved && !serial.failed)
    expect(JSON.stringify(parallel.getOutput())).toBe(
      JSON.stringify(serial.getOutput()),
    )
  return parallel
}
test("speculative searches preserve serial results for interacting routes and rerips", async () => {
  let invalidated = 0
  for (const workers of [2, 3, 4])
    for (const lazy of [true, false]) {
      const solver = await compare(gridGraph(), workers, {
        RIP_THRESHOLD_START: 0,
        RIP_THRESHOLD_END: 0,
        RIP_THRESHOLD_RAMP_ATTEMPTS: 3,
        USE_LAZY_ROUTE_HEURISTIC: lazy,
        MAX_ITERATIONS: 10000,
      })
      invalidated += solver.parallelStats.invalidatedSearches
    }
  expect(invalidated).toBeGreaterThan(0)
}, 30000)
test("iteration limits retain exact serial acceptance and failure", async () => {
  for (const max of [1, 2, 5, 15, 30, 100])
    await compare(gridGraph(), 3, {
      MAX_ITERATIONS: max,
      STATIC_REACHABILITY_PRECHECK: false,
    })
}, 30000)
test("single worker, owned frontier, empty and disconnected problems", async () => {
  await compare(gridGraph(), 1)
  await compare(gridGraph(), 3, { OWNED_REGIONAL_HOP_FRONTIER: true })
  const graph = gridGraph()
  graph.connections = []
  await compare(graph, 3)
  const disconnected = gridGraph()
  disconnected.ports = disconnected.ports.filter(
    (p) =>
      !(p.region1Id === "0:0" && p.region2Id !== "s0") &&
      !(p.region2Id === "0:0" && p.region1Id !== "s0"),
  )
  for (const r of disconnected.regions)
    r.pointIds = r.pointIds.filter((p) =>
      disconnected.ports.some((port) => port.portId === p),
    )
  await compare(disconnected, 2)
}, 30000)
test("initial assignments and independent batch output order", async () => {
  const graph = gridGraph(3)
  const serialInput = loadSerializedHyperGraph(graph),
    serial = new TinyHyperGraphSolver(serialInput.topology, serialInput.problem)
  serial.solve()
  expect(serial.solved).toBe(true)
  const preloaded = serial.getOutput()
  await compare(preloaded, 3)
  const graphs = [gridGraph(2), gridGraph(3), gridGraph(4)]
  const batch = await solveTinyHyperGraphsParallel(graphs, { workers: 3 })
  for (let i = 0; i < graphs.length; i++) {
    const input = loadSerializedHyperGraph(graphs[i])
    const baseline = new TinyHyperGraphSolver(input.topology, input.problem)
    baseline.solve()
    expect(batch[i].iterations).toBe(baseline.iterations)
    expect(JSON.stringify(batch[i].output)).toBe(
      JSON.stringify(baseline.getOutput()),
    )
  }
  expect(await solveTinyHyperGraphsParallel([])).toEqual([])
  await expect(
    solveTinyHyperGraphsParallel([], { workers: 0 }),
  ).rejects.toThrow("positive integer")
}, 30000)
test("worker errors reject without leaking workers; concurrent and subclass calls fail clearly", async () => {
  const malformed = gridGraph(2)
  malformed.ports = []
  await expect(
    solveTinyHyperGraphsParallel([gridGraph(2), malformed], { workers: 2 }),
  ).rejects.toThrow("route endpoints")
  const recovered = await solveTinyHyperGraphsParallel([gridGraph(2)], {
    workers: 2,
  })
  expect(recovered[0].solved).toBe(true)
  const input = loadSerializedHyperGraph(gridGraph())
  const solver = new ParallelTinyHyperGraphSolver(
    input.topology,
    input.problem,
    { workers: 2 },
  )
  const first = solver.solveAsync()
  await expect(solver.solveAsync()).rejects.toThrow("already running")
  await first
  class CustomSolver extends ParallelTinyHyperGraphSolver {}
  const custom = new CustomSolver(input.topology, input.problem)
  await expect(custom.solveAsync()).rejects.toThrow("custom subclasses")
}, 30000)
