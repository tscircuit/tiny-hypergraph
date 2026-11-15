import type { TinyHyperGraphTopology, TinyHyperGraphProblem } from "../core"

export type SharedRouteDistances = Array<Float64Array | undefined>

/** Immutable, symmetric geometric distances. One bounded copy is shared by
 * all candidate workers, and survives every rerip within this graph. */
export function createSharedRouteDistances(
  topology: TinyHyperGraphTopology,
): SharedRouteDistances {
  const result: SharedRouteDistances = []
  let cells = 0
  for (const ports of topology.regionIncidentPorts) {
    const n = ports.length
    if (cells + n * n > 8_000_000) {
      result.push(undefined)
      continue
    }
    const table = new Float64Array(new SharedArrayBuffer(n * n * 8))
    cells += n * n
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const dx = topology.portX[ports[a]] - topology.portX[ports[b]]
        const dy = topology.portY[ports[a]] - topology.portY[ports[b]]
        const distance = Math.sqrt(dx * dx + dy * dy)
        table[a * n + b] = distance
        table[b * n + a] = distance
      }
    result.push(table)
  }
  return result
}

export type SharedRouteHeuristics = { values: Float64Array; ready: Uint8Array }

/** Lazily shared route-major distances. Each worker retains the core's local
 * weighted per-port cache. Atomics publish initialized shared values. */
export function createSharedRouteHeuristics(
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
): SharedRouteHeuristics | undefined {
  const cells = topology.portCount * problem.routeCount
  if (cells > 28_000_000) return undefined // At most 252 MB shared by the pool.
  return {
    values: new Float64Array(new SharedArrayBuffer(cells * 8)),
    ready: new Uint8Array(new SharedArrayBuffer(cells)),
  }
}
