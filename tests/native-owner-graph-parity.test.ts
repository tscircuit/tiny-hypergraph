import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { WasmRoutePool } from "../lib/parallel/WasmRoutePool"
import type { TinyHyperGraphTopology, TinyHyperGraphProblem } from "../lib/core"
import type { WasmRouteInput } from "../lib/parallel/WasmRouteTask"

test("native parallel graph construction preserves port and crossing owners, restrictions, and paths", async () => {
  const regions: number[][] = Array.from({ length: 5 }, () => []),
    incident: number[][] = [],
    x: number[] = [],
    y: number[] = []
  const add = (px: number, py: number, rs: number[]): void => {
    const id = x.length
    x.push(px)
    y.push(py)
    incident.push(rs)
    rs.forEach((r) => regions[r]!.push(id))
  }
  add(-0.4, -0.4, [0])
  add(1.4, 1.4, [3])
  add(5, 5, [4])
  add(6, 5, [4])
  for (let i = 0; i < 8; i++) {
    const offset = (i + 1) / 9 - 0.5
    add(0.5, offset, [0, 1])
    add(offset, 0.5, [0, 2])
    add(1 + offset, 0.5, [1, 3])
    add(0.5, 1 + offset, [2, 3])
  }
  const ports = x.length,
    cx = [0, 1, 0, 1, 5.5],
    cy = [0, 0, 1, 1, 5]
  const topology: TinyHyperGraphTopology = {
    portCount: ports,
    regionCount: 5,
    regionIncidentPorts: regions,
    incidentPortRegion: incident,
    portX: Float64Array.from(x),
    portY: Float64Array.from(y),
    portZ: Int32Array.from(x, (_, i) => (i % 3 ? 0 : 1)),
    portAngleForRegion1: new Int32Array(ports),
    portAngleForRegion2: new Int32Array(ports),
    regionAvailableZMask: Int32Array.of(3, 1, 1, 3, 3),
    regionCenterX: Float64Array.from(cx),
    regionCenterY: Float64Array.from(cy),
    regionWidth: new Float64Array(5).fill(1),
    regionHeight: new Float64Array(5).fill(1),
  }
  for (let port = 0; port < ports; port++)
    incident[port]!.forEach((r, slot) => {
      const angle = Math.round(
        ((Math.atan2(y[port]! - cy[r]!, x[port]! - cx[r]!) * 18000) / Math.PI +
          36000) %
          36000,
      )
      ;(slot ? topology.portAngleForRegion2! : topology.portAngleForRegion1)[
        port
      ] = angle
    })
  const problem: TinyHyperGraphProblem = {
    routeCount: 9,
    routeStartPort: Int32Array.of(0, ...new Array(8).fill(2)),
    routeEndPort: Int32Array.of(1, ...new Array(8).fill(3)),
    routeNet: Int32Array.of(7, ...new Array(8).fill(99)),
    regionNetId: new Int32Array(5).fill(-1),
    portSectionMask: new Int8Array(ports).fill(1),
  }
  problem.portSectionMask[1] = 0
  for (let port = 7; port < ports; port += 7) problem.portSectionMask[port] = 0
  problem.regionNetId[4] = 99
  class Reference extends SelectiveReripTinyHyperGraphSolver {
    search(forbidden: ReadonlySet<number>) {
      return this.findRelaxedBlockerPath(forbidden)
    }
  }
  const solver = new Reference(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })
  const workers = [0, 1, 2].map(
      () =>
        new Worker(new URL("./fixtures/wasmRoute.worker.ts", import.meta.url)),
    ),
    free = [...workers]
  const pool = new WasmRoutePool(solver, {
    persistentWorkerCount: 4,
    executeAsync(_Task, input: WasmRouteInput): Promise<unknown> {
      const worker = free.pop()!
      return new Promise((resolve, reject) => {
        worker.onmessage = (event: MessageEvent): void => {
          free.push(worker)
          event.data.error
            ? reject(new Error(event.data.error))
            : resolve(event.data.output)
        }
        worker.onerror = reject
        worker.postMessage(input)
      })
    },
  })
  try {
    await pool.start()
    for (let seed = 1; seed <= 100; seed++) {
      let randomState = seed
      const random = (): number =>
        (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) /
        2 ** 32
      solver.state.regionSegments = Array.from({ length: 5 }, () => [])
      solver.state.portAssignment.fill(-1)
      for (let r = 0; r < 4; r++)
        for (let i = 0; i < 8; i++) {
          const candidates = regions[r]!.filter((p) => p >= 4),
            a = candidates[Math.floor(random() * candidates.length)]!,
            b = candidates[Math.floor(random() * candidates.length)]!
          solver.state.regionSegments[r]!.push([
            1 + Math.floor(random() * 8),
            a,
            b,
          ])
          solver.state.portAssignment[a] = solver.state.portAssignment[b] = 99
        }
      solver.state.currentRouteId = 0
      solver.state.currentRouteNetId = 7
      solver.state.goalPortId = 1
      const forbidden = new Set(seed % 3 === 0 ? [1, 3] : [])
      solver.useCompiledOwnerSearch = false
      solver.parallelOwnerSearch = undefined
      const reference = solver.search(forbidden)
      const cacheToken = {}
      solver.useCompiledOwnerSearch = true
      solver.parallelOwnerSearch = (options, geometry, blocked) =>
        pool.searchOwners(
          options,
          {
            ...geometry,
            nativeGraph: { ...geometry.nativeGraph!, cacheToken },
          },
          blocked,
        )
      const actual = solver.search(forbidden)
      expect(actual.found).toBe(reference.found)
      if (actual.found && reference.found) {
        expect(actual.states).toEqual(reference.states)
        expect(actual.hops).toEqual(reference.hops)
        expect(actual.distance).toBe(reference.distance)
        expect([...actual.owners]).toEqual([...reference.owners])
      } else if (!actual.found && !reference.found)
        expect(actual.reason).toBe(reference.reason)
      const rows = pool.ownerGraphRows,
        hook = solver.parallelOwnerSearch
      solver.useCompiledOwnerSearch = false
      solver.parallelOwnerSearch = undefined
      const alternateReference = solver.search(new Set([1, 2, 3]))
      solver.useCompiledOwnerSearch = true
      solver.parallelOwnerSearch = hook
      const { expandedLabelCount: nativeExpansions, ...alternateActual } =
        solver.search(new Set([1, 2, 3]))
      const { expandedLabelCount: serialExpansions, ...alternateExpected } =
        alternateReference
      // The serial owner-bound heuristic reduces internal label expansions;
      // paths, owner ordering, distances and failure reasons must still match.
      expect(alternateActual).toEqual(alternateExpected)
      expect(nativeExpansions).toBeGreaterThanOrEqual(0)
      expect(serialExpansions).toBeGreaterThanOrEqual(0)
      expect(pool.ownerGraphRows).toBe(rows)
    }
  } finally {
    await pool.dispose()
    workers.forEach((worker) => worker.terminate())
  }
})
