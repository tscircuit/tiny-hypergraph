import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

type NodeId = number
type OwnerId = number
type Edge = { state: NodeId; distance: number; owners: OwnerId[] }
type EdgeVisitor = (edge: Edge) => boolean
type Graph = Edge[][]
type Label = { state: NodeId; mask: number; distance: number }
type StateOwnerKey = string

function getOwnerCount(mask: number): number {
  let count = 0
  while (mask !== 0) {
    mask &= mask - 1
    count++
  }
  return count
}

function exhaustiveObjective(graph: Graph): Label | undefined {
  const queue: Label[] = [{ state: 0, mask: 0, distance: 0 }]
  const best = new Map<StateOwnerKey, number>([["0:0", 0]])
  while (queue.length > 0) {
    queue.sort(
      (a, b): number =>
        getOwnerCount(a.mask) - getOwnerCount(b.mask) || a.distance - b.distance,
    )
    const current = queue.shift()!
    if (current.distance !== best.get(`${current.state}:${current.mask}`)) continue
    if (current.state === graph.length - 1) return current
    for (const edge of graph[current.state]!) {
      let mask = current.mask
      for (const owner of edge.owners) mask |= 1 << owner
      const distance = current.distance + edge.distance
      const key = `${edge.state}:${mask}`
      if (best.has(key) && best.get(key)! <= distance) continue
      best.set(key, distance)
      queue.push({ state: edge.state, mask, distance })
    }
  }
  return undefined
}

function getRemainingDistances(graph: Graph): number[] {
  const remaining = new Array<number>(graph.length).fill(Infinity)
  remaining[graph.length - 1] = 0
  for (let pass = 1; pass < graph.length; pass++) {
    for (const [node, edges] of graph.entries()) {
      for (const edge of edges) {
        remaining[node] = Math.min(
          remaining[node]!,
          edge.distance + remaining[edge.state]!,
        )
      }
    }
  }
  return remaining.map((distance): number =>
    Number.isFinite(distance) ? distance : 0,
  )
}

function checkGraph(options: { graph: Graph; remaining: number[] }): void {
  const { graph, remaining } = options
  const searchOptions = {
    start: 0,
    getStateKey: (state: NodeId): NodeId => state,
    isGoal: (state: NodeId): boolean => state === graph.length - 1,
    getHops: (state: NodeId): Edge[] => graph[state]!,
    checkReachability: true,
  }
  for (const useSeparateProvider of [false, true]) {
    const result = findDistinctOwnerBlockerPath({
      ...searchOptions,
      forEachReachabilityHop: useSeparateProvider
        ? (state: NodeId, visit: EdgeVisitor): void => {
            for (const edge of graph[state]!) {
              if (!visit({ ...edge, owners: [...edge.owners] })) return
            }
          }
        : undefined,
      checkOwnerFreeReachability: true,
      getRemainingDistance: (state: NodeId): number => remaining[state]!,
    })
    const objective = exhaustiveObjective(graph)
    expect(result.found).toBe(objective !== undefined)
    if (result.found && objective) {
      expect(result.owners.size).toBe(getOwnerCount(objective.mask))
      expect(Math.abs(result.distance - objective.distance)).toBeLessThanOrEqual(
        1e-10 * Math.max(1, objective.distance),
      )
      expect(
        result.hops.reduce(
          (distance, edge): number => distance + edge.distance,
          0,
        ),
      ).toBe(result.distance)
      expect(result.states[0]).toBe(0)
      expect(result.states.at(-1)).toBe(graph.length - 1)
      const owners = new Set<OwnerId>()
      for (const [index, edge] of result.hops.entries()) {
        expect(graph[result.states[index]!]!.includes(edge as Edge)).toBe(true)
        expect(edge.state).toBe(result.states[index + 1]!)
        for (const owner of edge.owners ?? []) owners.add(owner)
      }
      expect(result.owners).toEqual(owners)
    }
  }
}

test("A lexicographic A* bound preserves the distinct-owner objective on exhaustive DAGs and cyclic geometric graphs", (): void => {
  for (let mask = 0; mask < 1024; mask++) {
    const graph: Graph = Array.from({ length: 5 }, (): Edge[] => [])
    let edgeIndex = 0
    for (let a = 0; a < 5; a++) {
      for (let b = a + 1; b < 5; b++, edgeIndex++) {
        if ((mask & (1 << edgeIndex)) === 0) continue
        graph[a]!.push({
          state: b,
          distance: (edgeIndex * 3 + mask) % 7,
          owners: edgeIndex % 3 === 0 ? [] : [(edgeIndex + mask) % 3],
        })
      }
    }
    checkGraph({ graph, remaining: getRemainingDistances(graph) })
  }
  let seed = 23171
  for (let trial = 0; trial < 500; trial++) {
    const graph: Graph = Array.from({ length: 6 }, (): Edge[] => [])
    const points = Array.from(
      { length: 6 },
      (_, node): { x: number; y: number } => ({
        x: node % 3,
        y: Math.floor(node / 3),
      }),
    )
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        if (a === b || seed % 3 !== 0) continue
        graph[a]!.push({
          state: b,
          distance: Math.hypot(
            points[a]!.x - points[b]!.x,
            points[a]!.y - points[b]!.y,
          ),
          owners: seed % 5 === 0 ? [] : [seed % 3],
        })
      }
    }
    const goal = points[5]!
    const remaining = points.map((point): number =>
      Math.max(
        0,
        Math.hypot(point.x - goal.x, point.y - goal.y) -
          256 *
            Number.EPSILON *
            Math.max(
              1,
              Math.abs(point.x),
              Math.abs(point.y),
              Math.abs(goal.x),
              Math.abs(goal.y),
            ),
      ),
    )
    checkGraph({ graph, remaining })
  }
})
