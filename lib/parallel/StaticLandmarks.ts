import type { TinyHyperGraphSolver } from "../core"

export type StaticLandmarks = {
  sources: Int32Array
  distances: Float64Array
}

/** Immutable, relaxed port graph; each worker computes disjoint landmark rows. */
export function createStaticLandmarks(
  solver: TinyHyperGraphSolver,
  count = 8,
): StaticLandmarks {
  const { topology, problem } = solver
  const sources: number[] = []
  if (
    solver.DISTANCE_TO_COST >= 0 &&
    solver.TRACE_DENSITY_COST_FACTOR >= 0 &&
    !problem.portPenalty?.some((p) => p < 0)
  ) {
    const nearest = new Float64Array(topology.portCount).fill(Infinity)
    let next = 0
    for (let i = 0; i < Math.min(count, topology.portCount); i++) {
      sources.push(next)
      let farthest = -1
      let best = -1
      for (let port = 0; port < topology.portCount; port++) {
        const dx = topology.portX[port]! - topology.portX[next]!
        const dy = topology.portY[port]! - topology.portY[next]!
        nearest[port] = Math.min(nearest[port]!, dx * dx + dy * dy)
        if (!sources.includes(port) && nearest[port]! > best) {
          best = nearest[port]!
          farthest = port
        }
      }
      next = farthest
    }
  }
  return {
    sources: Int32Array.from(sources),
    distances: new Float64Array(
      new SharedArrayBuffer(sources.length * topology.portCount * 8),
    ),
  }
}

export function prepareStaticLandmarks(
  solver: TinyHyperGraphSolver,
  landmarks: StaticLandmarks,
  workerIndex: number,
  workerCount: number,
  control: Int32Array,
): boolean {
  if (landmarks.sources.length === 0) return true
  const { topology, problem } = solver
  const size = topology.portCount
  const heap = new Int32Array(size)
  const indices = new Int32Array(size)
  for (
    let row = workerIndex;
    row < landmarks.sources.length;
    row += workerCount
  ) {
    const distances = landmarks.distances.subarray(row * size, (row + 1) * size)
    distances.fill(Infinity)
    indices.fill(-1)
    let length = 0
    const queue = (port: number, cost: number): void => {
      let index = indices[port]!
      if (index === -1) index = length++
      distances[port] = cost
      while (index > 0) {
        const parent = (index - 1) >> 1
        const other = heap[parent]!
        if (distances[other]! <= cost) break
        heap[index] = other
        indices[other] = index
        index = parent
      }
      heap[index] = port
      indices[port] = index
    }
    queue(landmarks.sources[row]!, 0)
    let iterations = 0
    while (length > 0) {
      if ((iterations++ & 255) === 0 && Atomics.load(control, 0) === 3)
        return false
      const port = heap[0]!
      const last = heap[--length]!
      indices[port] = -2
      if (length > 0) {
        let index = 0
        while (index * 2 + 1 < length) {
          const left = index * 2 + 1
          const right = left + 1
          const child =
            right < length && distances[heap[right]!]! < distances[heap[left]!]!
              ? right
              : left
          if (distances[last]! <= distances[heap[child]!]!) break
          heap[index] = heap[child]!
          indices[heap[index]!] = index
          index = child
        }
        heap[index] = last
        indices[last] = index
      }
      for (const region of topology.incidentPortRegion[port]!) {
        for (const neighbor of topology.regionIncidentPorts[region]!) {
          if (problem.portSectionMask[neighbor] === 0) continue
          if (indices[neighbor] === -2) continue
          const dx = topology.portX[port]! - topology.portX[neighbor]!
          const dy = topology.portY[port]! - topology.portY[neighbor]!
          const edge =
            Math.sqrt(dx * dx + dy * dy) * solver.DISTANCE_TO_COST +
            ((problem.portPenalty?.[port] ?? 0) +
              (problem.portPenalty?.[neighbor] ?? 0)) /
              2
          const cost = distances[port]! + edge
          if (cost < distances[neighbor]!) queue(neighbor, cost)
        }
      }
    }
  }
  return true
}

export function landmarkHeuristic(
  solver: TinyHyperGraphSolver,
  landmarks: StaticLandmarks,
  port: number,
): number {
  const goal = solver.state.goalPortId
  if (goal === undefined || port === goal) return 0
  let bound = 0
  let scale = 1
  for (let row = 0; row < landmarks.sources.length; row++) {
    const start = row * solver.topology.portCount
    const a = landmarks.distances[start + port]!
    const b = landmarks.distances[start + goal]!
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    bound = Math.max(bound, Math.abs(a - b))
    scale = Math.max(scale, b)
  }
  const correction =
    ((solver.problem.portPenalty?.[goal] ?? 0) -
      (solver.problem.portPenalty?.[port] ?? 0)) /
    2
  return Math.max(0, bound + correction - scale * 1e-9)
}
