import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { TinyHyperGraphSolver } from "../../lib/core"
import { loadSerializedHyperGraph } from "../../lib/index"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"

for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
  test(`${Solver.name} keeps the fire-stick connection on the outer layers`, () => {
    const graph = JSON.parse(
      gunzipSync(
        new Uint8Array(
          readFileSync(
            new URL(
              "../fixtures/fire-stick-outer-layers.hypergraph.json.gz",
              import.meta.url,
            ),
          ),
        ),
      ).toString("utf8"),
    )
    const { topology, problem } = loadSerializedHyperGraph(graph)
    const allowedLayers = new Set([0, 3])
    expect(problem.routeCount).toBe(1)
    problem.routeSegmentFilter = ({ fromPortId, toPortId }) =>
      allowedLayers.has(topology.portZ[fromPortId]!) &&
      allowedLayers.has(topology.portZ[toPortId]!)
    const solver = new Solver(topology, problem)
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    const segments = solver.state.regionSegments.flat()
    expect(segments.length).toBeGreaterThan(0)
    // A through-via may cross the inner layers, but its entry and exit stay
    // on allowed layers. Check every segment endpoint, including via regions.
    const layers = segments.flatMap(([, from, to]) => [
      topology.portZ[from],
      topology.portZ[to],
    ])
    expect([...new Set(layers)].filter((z) => !allowedLayers.has(z!))).toEqual(
      [],
    )
  })
}
