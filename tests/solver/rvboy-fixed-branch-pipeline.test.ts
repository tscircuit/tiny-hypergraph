import "bun-match-svg"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  loadSerializedHyperGraph,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSectionSolverOptions,
} from "lib/index"

type Repro = {
  graph: SerializedHyperGraph
  options: TinyHyperGraphSectionSolverOptions
  portSectionMask: number[]
  regionNetId: number[]
  removedKeysBeforeFix: string[]
}
const target = '__tscircuit_preloaded_trace__:["source_trace_327_0",1]'
const assignments = (graph: SerializedHyperGraph): string[] =>
  [
    ...new Set(
      graph.regions.flatMap((region) =>
        (region.assignments ?? [])
          .filter((a) => a.connectionId === target)
          .map((a) =>
            JSON.stringify([
              region.regionId,
              ...[a.regionPort1Id, a.regionPort2Id].sort(),
            ]),
          ),
      ),
    ),
  ].sort()

const draw = (
  graph: SerializedHyperGraph,
  keys: string[],
  title: string,
): string => {
  const ports = new Map(
    graph.ports.map((p) => [p.portId, p.d as { x: number; y: number }]),
  )
  const segments = (items: string[], color: string): string =>
    items
      .map((key) => {
        const [, a, b] = JSON.parse(key) as string[]
        const p = ports.get(a!)!,
          q = ports.get(b!)!
        return `<line x1="${p.x}" y1="${-p.y}" x2="${q.x}" y2="${-q.y}" stroke="${color}" stroke-width="0.025" stroke-linecap="round"/>`
      })
      .join("")
  // Keep the entire constructor input. Only the SVG viewBox is cropped.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="400" viewBox="0 0 1000 400"><rect width="100%" height="100%" fill="white"/><text x="20" y="30" font-family="sans-serif" font-size="20">${title}</text><text x="20" y="58" font-family="sans-serif" font-size="16">Exact RVboy input. Gray: required fixed occupancy; blue: retained occupancy.</text><svg x="0" y="80" width="1000" height="300" viewBox="-2.9 -5.7 2.3 0.8">${segments(assignments(graph), "#cbd5e1")}${segments(keys, "#2563eb")}</svg></svg>`
}

test("RVboy section reconstruction preserves every occupied edge of fixed copper", (): void => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-fixed-branch-pipeline.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as Repro
  const original = structuredClone(fixture.graph)
  const before = assignments(fixture.graph)
  expect(before).toHaveLength(17)
  const loaded = loadSerializedHyperGraph(fixture.graph)
  loaded.problem.portSectionMask = Int8Array.from(fixture.portSectionMask)
  loaded.problem.regionNetId = Int32Array.from(fixture.regionNetId)
  // JSON represents the captured unbounded improvement budget as null.
  const options = {
    ...fixture.options,
    EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST: Infinity,
  }
  const solver = new TinyHyperGraphSectionSolver(
    loaded.topology,
    loaded.problem,
    loaded.solution,
    options,
  )
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  expect(assignments(solver.getOutput())).toEqual(before)
  expect(fixture.graph).toEqual(original)
  const oldKeys = before.filter(
    (key) => !fixture.removedKeysBeforeFix.includes(key),
  )
  expect(oldKeys).toHaveLength(6)
  expect(
    draw(
      original,
      oldKeys,
      "Before: section replay drops 11 occupied edges of fixed copper",
    ),
  ).toMatchSvgSnapshot(import.meta.path.replace(".test.ts", "-before.test.ts"))
  expect(
    draw(
      original,
      assignments(solver.getOutput()),
      "After: all 17 fixed copper edges survive section replay",
    ),
  ).toMatchSvgSnapshot(import.meta.path.replace(".test.ts", "-after.test.ts"))
})
