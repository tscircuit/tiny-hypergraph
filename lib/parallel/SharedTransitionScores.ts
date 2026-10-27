import type { TinyHyperGraphSolver } from "../core"

export type SharedTransitionScores = {
  offsets: Int32Array
  positions: Int32Array
  heads: Int32Array
  versions: Int32Array
  values: Float64Array
  owners: Int8Array
  next: Int32Array
}

/** Published records are immutable, so readers never race with Float64 writes. */
export function createSharedTransitionScores(
  solver: TinyHyperGraphSolver,
): SharedTransitionScores {
  const { topology } = solver
  const stride = topology.incidentPortRegion.reduce(
    (n, regions) => Math.max(n, regions.length),
    1,
  )
  const positions = new Int32Array(topology.portCount * stride).fill(-1)
  const offsets = new Int32Array(topology.regionCount).fill(-1)
  let cells = 0
  for (let region = 0; region < topology.regionCount; region++) {
    const ports = topology.regionIncidentPorts[region]!
    for (let i = 0; i < ports.length; i++)
      positions[solver.getHopId(ports[i]!, region)] = i
    const size = ports.length * ports.length
    if (ports.length > 128 || cells + size > 4_000_000) continue
    offsets[region] = cells
    cells += size
  }
  const records = Math.min(16_000_000, cells * 16)
  return {
    offsets,
    positions,
    heads: new Int32Array(new SharedArrayBuffer(cells * 4)).fill(-1),
    versions: new Int32Array(new SharedArrayBuffer(records * 4)),
    values: new Float64Array(new SharedArrayBuffer(records * 8)),
    owners: new Int8Array(new SharedArrayBuffer(records)),
    next: new Int32Array(new SharedArrayBuffer(4)),
  }
}

export function readTransitionScore(
  data: SharedTransitionScores,
  cell: number,
  version: number,
): number {
  const record = readTransitionRecord(data, cell, version)
  return record >= 0 ? data.values[record]! : Number.NaN
}

export function readTransitionRecord(
  data: SharedTransitionScores,
  cell: number,
  version: number,
): number {
  const record = Atomics.load(data.heads, cell)
  return record >= 0 && data.versions[record] === version ? record : -1
}

export function publishTransitionScore(
  data: SharedTransitionScores,
  cell: number,
  version: number,
  value: number,
  workerIndex = 0,
): void {
  if (Number.isNaN(value)) return
  const previous = Atomics.load(data.heads, cell)
  if (previous >= 0 && data.versions[previous]! >= version) return
  if (Atomics.load(data.next, 0) >= data.values.length) return
  const record = Atomics.add(data.next, 0, 1)
  if (record >= data.values.length) return
  data.versions[record] = version
  data.values[record] = value
  data.owners[record] = workerIndex
  // Publishing the index makes the preceding immutable record visible. A
  // failed CAS just leaves an unused record; it cannot replace a newer score.
  Atomics.compareExchange(data.heads, cell, previous, record)
}
