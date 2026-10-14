// AssemblyScript. Compile with build:native-search; arithmetic stays IEEE f64.
// The host validates graph limits before constructing this bounded kernel.
const P = 65536
const R = 16384
const H = P * 2
const E = 262144
const A = 1048576
const x = new StaticArray<f64>(P)
const y = new StaticArray<f64>(P)
const z = new StaticArray<i32>(P)
const angle1 = new StaticArray<i32>(P)
const angle2 = new StaticArray<i32>(P)
const first = new StaticArray<i32>(P)
const second = new StaticArray<i32>(P)
const section = new StaticArray<i32>(P)
const reserve = new StaticArray<i32>(P)
const assignment = new StaticArray<i32>(P)
const penalty = new StaticArray<f64>(P)
const area = new StaticArray<f64>(R)
const regionMask = new StaticArray<i32>(R)
const owner = new StaticArray<i32>(R)
const congestion = new StaticArray<f64>(R)
const starts = new StaticArray<i32>(R + 1)
const neighbors = new StaticArray<i32>(E)
const nextHops = new StaticArray<i32>(E)
const g = new StaticArray<f64>(H)
const h = new StaticArray<f64>(H)
const f = new StaticArray<f64>(H)
const parent = new StaticArray<i32>(H)
const generation = new StaticArray<u32>(H)
const position = new StaticArray<i32>(H)
const heap = new StaticArray<i32>(H)
const heuristic = new StaticArray<f64>(P)
const heuristicRoute = new StaticArray<u32>(P)
const cacheStart = new StaticArray<i32>(R)
const cacheCapacity = new StaticArray<i32>(R)
const cacheCount = new StaticArray<i32>(R)
const cacheSame = new StaticArray<i32>(R)
const cacheCross = new StaticArray<i32>(R)
const cacheChanges = new StaticArray<i32>(R)
const cacheCost = new StaticArray<f64>(R)
const nets = new StaticArray<i32>(A)
const lessers = new StaticArray<i32>(A)
const greaters = new StaticArray<i32>(A)
const masks = new StaticArray<i32>(A)
let regionCount: i32 = 0
let arenaSize: i32 = 0
let heapSize: i32 = 0
let epoch: u32 = 0
let steps: i32 = 0
let distanceFactor: f64 = 0.05
let viaSquare: f64 = 0
let densityFactor: f64 = 0
let traceSquare: f64 = 0
let goalPort: i32 = 0
let net: i32 = 0
let routeTag: u32 = 0
let distanceAware: bool = true
const L = 2000000
let legacyG = new StaticArray<f64>(0)
let legacyH = new StaticArray<f64>(0)
let legacyF = new StaticArray<f64>(0)
let legacyParent = new StaticArray<i32>(0)
let legacyHop = new StaticArray<i32>(0)
let legacyHeap = new StaticArray<i32>(0)
let legacyCount: i32 = 0
let overflow: bool = false
const M = 4000000
const pairRows = new StaticArray<i32>(H)
let scores = new StaticArray<f64>(0)
let scoreGeneration = new StaticArray<u32>(0)
const regionVersion = new StaticArray<u32>(R)
const contextGeneration = new StaticArray<u32>(R)
const contextOwnNet = new StaticArray<i32>(R)

@inline
function invalidate(region: i32): void {
  const version = unchecked(regionVersion[region])
  if (version === u32.MAX_VALUE) {
    scoreGeneration.fill(0)
    unchecked((regionVersion[region] = 1))
  } else unchecked((regionVersion[region] = version + 1))
}

export function ptr(field: i32): usize {
  switch (field) {
    case 0:
      return changetype<usize>(x)
    case 1:
      return changetype<usize>(y)
    case 2:
      return changetype<usize>(z)
    case 3:
      return changetype<usize>(angle1)
    case 4:
      return changetype<usize>(angle2)
    case 5:
      return changetype<usize>(first)
    case 6:
      return changetype<usize>(second)
    case 7:
      return changetype<usize>(section)
    case 8:
      return changetype<usize>(reserve)
    case 9:
      return changetype<usize>(assignment)
    case 10:
      return changetype<usize>(penalty)
    case 11:
      return changetype<usize>(area)
    case 12:
      return changetype<usize>(regionMask)
    case 13:
      return changetype<usize>(owner)
    case 14:
      return changetype<usize>(congestion)
    case 15:
      return changetype<usize>(starts)
    case 16:
      return changetype<usize>(neighbors)
    case 17:
      return changetype<usize>(nextHops)
    case 18:
      return distanceAware ? changetype<usize>(g) : changetype<usize>(legacyG)
    case 19:
      return distanceAware ? changetype<usize>(h) : changetype<usize>(legacyH)
    case 20:
      return distanceAware ? changetype<usize>(f) : changetype<usize>(legacyF)
    case 21:
      return distanceAware
        ? changetype<usize>(parent)
        : changetype<usize>(legacyParent)
    case 22:
      return changetype<usize>(legacyHop)
    case 23:
      return changetype<usize>(pairRows)
  }
  return 0
}

export function configure(
  regions: i32,
  distance: f64,
  via: f64,
  density: f64,
  trace: f64,
  useDistance: i32,
): void {
  regionCount = regions
  distanceFactor = distance
  viaSquare = via
  densityFactor = density
  traceSquare = trace
  distanceAware = useDistance !== 0
  if (!distanceAware) {
    legacyG = new StaticArray<f64>(L)
    legacyH = new StaticArray<f64>(L)
    legacyF = new StaticArray<f64>(L)
    legacyParent = new StaticArray<i32>(L)
    legacyHop = new StaticArray<i32>(L)
    legacyHeap = new StaticArray<i32>(L)
    scores = new StaticArray<f64>(M)
    scoreGeneration = new StaticArray<u32>(M)
  }
}

export function resetCaches(): void {
  arenaSize = 0
  for (let r: i32 = 0; r < regionCount; r++) {
    invalidate(r)
    unchecked((cacheCapacity[r] = 0))
    unchecked((cacheCount[r] = 0))
    unchecked((cacheSame[r] = 0))
    unchecked((cacheCross[r] = 0))
    unchecked((cacheChanges[r] = 0))
    unchecked((cacheCost[r] = 0))
  }
}

export function append(
  region: i32,
  segmentNet: i32,
  lesser: i32,
  greater: i32,
  mask: i32,
  same: i32,
  cross: i32,
  changes: i32,
  cost: f64,
): i32 {
  const count = unchecked(cacheCount[region])
  const capacity = unchecked(cacheCapacity[region])
  if (count === capacity) {
    const nextCapacity = capacity === 0 ? 4 : capacity * 2
    if (arenaSize + nextCapacity > A) return 0
    const old = unchecked(cacheStart[region])
    for (let i: i32 = 0; i < count; i++) {
      unchecked((nets[arenaSize + i] = nets[old + i]))
      unchecked((lessers[arenaSize + i] = lessers[old + i]))
      unchecked((greaters[arenaSize + i] = greaters[old + i]))
      unchecked((masks[arenaSize + i] = masks[old + i]))
    }
    unchecked((cacheStart[region] = arenaSize))
    unchecked((cacheCapacity[region] = nextCapacity))
    arenaSize += nextCapacity
  }
  const index = unchecked(cacheStart[region]) + count
  unchecked((nets[index] = segmentNet))
  unchecked((lessers[index] = lesser))
  unchecked((greaters[index] = greater))
  unchecked((masks[index] = mask))
  unchecked((cacheCount[region] = count + 1))
  unchecked((cacheSame[region] = same))
  unchecked((cacheCross[region] = cross))
  unchecked((cacheChanges[region] = changes))
  unchecked((cacheCost[region] = cost))
  invalidate(region)
  return 1
}

@inline
function up(start: i32): void {
  const candidate = unchecked(heap[start])
  let index = start
  while (index > 0) {
    const parentIndex = (index - 1) >> 1
    const ancestor = unchecked(heap[parentIndex])
    if (unchecked(f[ancestor]) <= unchecked(f[candidate])) break
    unchecked((heap[index] = ancestor))
    unchecked((position[ancestor] = index))
    index = parentIndex
  }
  unchecked((heap[index] = candidate))
  unchecked((position[candidate] = index))
}

@inline
function down(start: i32): void {
  const candidate = unchecked(heap[start])
  let index = start
  while (true) {
    const left = index * 2 + 1
    if (left >= heapSize) break
    const right = left + 1
    const childIndex =
      right < heapSize && unchecked(f[heap[right]]) < unchecked(f[heap[left]])
        ? right
        : left
    const child = unchecked(heap[childIndex])
    if (unchecked(f[candidate]) <= unchecked(f[child])) break
    unchecked((heap[index] = child))
    unchecked((position[child] = index))
    index = childIndex
  }
  unchecked((heap[index] = candidate))
  unchecked((position[candidate] = index))
}

@inline
function enqueue(hop: i32, cost: f64, heuristicCost: f64, previous: i32): void {
  const present = unchecked(generation[hop]) === epoch
  const index = present ? unchecked(position[hop]) : -2
  if (index === -1) return
  const oldF = unchecked(f[hop])
  unchecked((g[hop] = cost))
  unchecked((h[hop] = heuristicCost))
  unchecked((f[hop] = cost + heuristicCost))
  unchecked((parent[hop] = previous))
  unchecked((generation[hop] = epoch))
  if (index >= 0) {
    if (cost + heuristicCost <= oldF) up(index)
    else down(index)
  } else {
    unchecked((heap[heapSize++] = hop))
    up(heapSize - 1)
  }
}

@inline
function pop(): i32 {
  if (heapSize === 0) return -1
  const best = unchecked(heap[0])
  unchecked((position[best] = -1))
  heapSize--
  if (heapSize > 0) {
    unchecked((heap[0] = heap[heapSize]))
    down(0)
  }
  return best
}

@inline
function knownSingle(mask: i32): bool {
  return <u32>mask > 0 && (mask & (mask - 1)) === 0
}

@inline
function regionCost(
  region: i32,
  same: i32,
  cross: i32,
  changes: i32,
  count: i32,
): f64 {
  const estimate: f64 = <f64>same * 2 + <f64>cross + <f64>changes
  const mask = unchecked(regionMask[region])
  const layers: f64 = mask === 0 ? 2 : <f64>i32.popcnt(mask)
  const density = <f64>count / layers
  return (
    (estimate * viaSquare * (1 + <f64>count / 5)) / unchecked(area[region]) +
    (knownSingle(mask) ? <f64>same * 10 : 0) +
    (densityFactor * (density * density) * traceSquare) /
      unchecked(area[region])
  )
}

@inline
function computeG(
  hop: i32,
  port: i32,
  region: i32,
  distance: f64,
  cost: f64,
  column: i32 = -1,
): f64 {
  const from = hop >> 1
  let same: i32 = 0,
    cross: i32 = 0
  const changes = unchecked(z[from]) !== unchecked(z[port]) ? 1 : 0
  const count = unchecked(cacheCount[region])
  if (
    !distanceAware &&
    count > 0 &&
    unchecked(contextGeneration[region]) !== epoch
  ) {
    let own = 0
    const start = unchecked(cacheStart[region])
    for (let i: i32 = start; i < start + count; i++)
      if (net === unchecked(nets[i])) {
        own = 1
        break
      }
    unchecked((contextOwnNet[region] = own))
    unchecked((contextGeneration[region] = epoch))
  }
  const row =
    !distanceAware && count > 0 && unchecked(contextOwnNet[region]) === 0
      ? unchecked(pairRows[hop])
      : -1
  const key = row >= 0 && column >= 0 ? row + column : -1
  const version = unchecked(regionVersion[region])
  if (key >= 0 && unchecked(scoreGeneration[key]) === version)
    return (
      cost +
      unchecked(scores[key]) +
      unchecked(congestion[region]) +
      unchecked(penalty[port]) +
      0
    )
  if (count > 0) {
    const a =
      unchecked(first[from]) === region || unchecked(second[from]) !== region
        ? unchecked(angle1[from])
        : unchecked(angle2[from])
    const b =
      unchecked(first[port]) === region || unchecked(second[port]) !== region
        ? unchecked(angle1[port])
        : unchecked(angle2[port])
    const lesser = a < b ? a : b,
      greater = a < b ? b : a
    const mask = (1 << unchecked(z[from])) | (1 << unchecked(z[port]))
    const start = unchecked(cacheStart[region])
    for (let i: i32 = start; i < start + count; i++) {
      if (net === unchecked(nets[i])) continue
      const insideL =
        lesser < unchecked(lessers[i]) && unchecked(lessers[i]) < greater
      const insideG =
        lesser < unchecked(greaters[i]) && unchecked(greaters[i]) < greater
      if (insideL === insideG) continue
      if ((mask & unchecked(masks[i])) !== 0) same++
      else cross++
    }
  }
  if (same > 0 && knownSingle(unchecked(regionMask[region]))) {
    if (key >= 0) {
      unchecked((scores[key] = Infinity))
      unchecked((scoreGeneration[key] = version))
    }
    return Infinity
  }
  const delta =
    regionCost(
      region,
      unchecked(cacheSame[region]) + same,
      unchecked(cacheCross[region]) + cross,
      unchecked(cacheChanges[region]) + changes,
      count + 1,
    ) - unchecked(cacheCost[region])
  if (key >= 0) {
    unchecked((scores[key] = delta))
    unchecked((scoreGeneration[key] = version))
  }
  return (
    cost +
    delta +
    unchecked(congestion[region]) +
    unchecked(penalty[port]) +
    (distanceAware ? distance * distanceFactor : 0)
  )
}

@inline
function reserved(port: i32): bool {
  const value = unchecked(reserve[port])
  return value === -2 || (value !== -1 && value !== net)
}

@inline
function distance(a: i32, b: i32): f64 {
  const dx = unchecked(x[a]) - unchecked(x[b]),
    dy = unchecked(y[a]) - unchecked(y[b])
  return Math.sqrt(dx * dx + dy * dy)
}

@inline
function computeH(port: i32): f64 {
  if (unchecked(heuristicRoute[port]) !== routeTag) {
    unchecked((heuristic[port] = distance(port, goalPort) * distanceFactor))
    unchecked((heuristicRoute[port] = routeTag))
  }
  return unchecked(heuristic[port])
}

export function search(
  startHop: i32,
  goal: i32,
  routeNet: i32,
  route: i32,
  limit: i32,
): i32 {
  if (epoch === u32.MAX_VALUE) {
    generation.fill(0)
    contextGeneration.fill(0)
    epoch = 1
  } else epoch++
  heapSize = 0
  steps = 0
  goalPort = goal
  net = routeNet
  routeTag = <u32>route + 1
  if (!distanceAware) return searchLegacy(startHop, limit)
  enqueue(startHop, 0, 0, -1)
  while (steps < limit) {
    steps++
    const current = pop()
    if (current < 0) return -1
    const from = current >> 1
    const region =
      (current & 1) === 0 ? unchecked(first[from]) : unchecked(second[from])
    const regionOwner = unchecked(owner[region])
    if (regionOwner !== -1 && regionOwner !== net) continue
    const cost = unchecked(g[current])
    for (
      let i: i32 = unchecked(starts[region]);
      i < unchecked(starts[region + 1]);
      i++
    ) {
      const port = unchecked(neighbors[i])
      if (port === goalPort) {
        if (
          reserved(port) ||
          (unchecked(assignment[port]) !== -1 &&
            unchecked(assignment[port]) !== net)
        )
          continue
        if (from === goalPort) return current + 1
        const goalHop = port * 2 + (unchecked(first[port]) === region ? 0 : 1)
        const goalG = computeG(
          current,
          port,
          region,
          distance(from, port),
          cost,
        )
        const previous =
          unchecked(generation[goalHop]) === epoch
            ? unchecked(g[goalHop])
            : Infinity
        if (isFinite(goalG) && goalG < previous)
          enqueue(goalHop, goalG, 0, current)
        break
      }
      if (port === from || unchecked(section[port]) === 0) continue
      const next = unchecked(nextHops[i])
      if (next < 0) continue
      if (
        unchecked(generation[next]) === epoch &&
        unchecked(position[next]) === -1
      )
        continue
      if (
        reserved(port) ||
        (unchecked(assignment[port]) !== -1 &&
          unchecked(assignment[port]) !== net)
      )
        continue
      const nextRegion =
        (next & 1) === 0 ? unchecked(first[port]) : unchecked(second[port])
      const nextOwner = unchecked(owner[nextRegion])
      if (nextOwner !== -1 && nextOwner !== net) continue
      const previous =
        unchecked(generation[next]) === epoch ? unchecked(g[next]) : Infinity
      if (cost >= previous) continue
      const length = distance(from, port)
      if (
        cost +
          unchecked(congestion[region]) +
          unchecked(penalty[port]) +
          length * distanceFactor >=
        previous
      )
        continue
      const nextG = computeG(current, port, region, length, cost)
      if (!isFinite(nextG) || nextG >= previous) continue
      enqueue(next, nextG, computeH(port), current)
    }
  }
  return 0
}

export function searchSteps(): i32 {
  return steps
}

@inline
function legacyUp(start: i32): void {
  const candidate = unchecked(legacyHeap[start])
  let index = start
  while (index > 0) {
    const p = (index - 1) >> 1,
      ancestor = unchecked(legacyHeap[p])
    if (unchecked(legacyF[ancestor]) <= unchecked(legacyF[candidate])) break
    unchecked((legacyHeap[index] = ancestor))
    index = p
  }
  unchecked((legacyHeap[index] = candidate))
}

@inline
function legacyDown(start: i32): void {
  const candidate = unchecked(legacyHeap[start])
  let index = start
  while (true) {
    const left = index * 2 + 1
    if (left >= heapSize) break
    const right = left + 1
    const childIndex =
      right < heapSize &&
      unchecked(legacyF[legacyHeap[right]]) <
        unchecked(legacyF[legacyHeap[left]])
        ? right
        : left
    const child = unchecked(legacyHeap[childIndex])
    if (unchecked(legacyF[candidate]) <= unchecked(legacyF[child])) break
    unchecked((legacyHeap[index] = child))
    index = childIndex
  }
  unchecked((legacyHeap[index] = candidate))
}

@inline
function legacyEnqueue(
  hop: i32,
  cost: f64,
  heuristicCost: f64,
  previous: i32,
): void {
  if (legacyCount >= L) {
    overflow = true
    return
  }
  const record = legacyCount++
  unchecked((legacyG[record] = cost))
  unchecked((legacyH[record] = heuristicCost))
  unchecked((legacyF[record] = cost + heuristicCost))
  unchecked((legacyHop[record] = hop))
  unchecked((legacyParent[record] = previous))
  unchecked((g[hop] = cost))
  unchecked((generation[hop] = epoch))
  unchecked((legacyHeap[heapSize++] = record))
  legacyUp(heapSize - 1)
}

@inline
function legacyPop(): i32 {
  if (heapSize === 0) return -1
  const best = unchecked(legacyHeap[0])
  heapSize--
  if (heapSize > 0) {
    unchecked((legacyHeap[0] = legacyHeap[heapSize]))
    legacyDown(0)
  }
  return best
}

function searchLegacy(start: i32, limit: i32): i32 {
  legacyCount = 0
  overflow = false
  legacyEnqueue(start, 0, 0, -1)
  while (steps < limit) {
    steps++
    const record = legacyPop()
    if (record < 0) return -1
    const hop = unchecked(legacyHop[record]),
      cost = unchecked(legacyG[record])
    if (cost > unchecked(g[hop])) continue
    const from = hop >> 1
    const region =
      (hop & 1) === 0 ? unchecked(first[from]) : unchecked(second[from])
    const regionOwner = unchecked(owner[region])
    if (regionOwner !== -1 && regionOwner !== net) continue
    for (
      let i: i32 = unchecked(starts[region]);
      i < unchecked(starts[region + 1]);
      i++
    ) {
      const port = unchecked(neighbors[i])
      if (port === goalPort) {
        if (
          reserved(port) ||
          (unchecked(assignment[port]) !== -1 &&
            unchecked(assignment[port]) !== net)
        )
          continue
        return record + 1
      }
      if (port === from || unchecked(section[port]) === 0) continue
      const next = unchecked(nextHops[i])
      if (next < 0) continue
      if (
        reserved(port) ||
        (unchecked(assignment[port]) !== -1 &&
          unchecked(assignment[port]) !== net)
      )
        continue
      const nextRegion =
        (next & 1) === 0 ? unchecked(first[port]) : unchecked(second[port])
      const nextOwner = unchecked(owner[nextRegion])
      if (nextOwner !== -1 && nextOwner !== net) continue
      const previous =
        unchecked(generation[next]) === epoch ? unchecked(g[next]) : Infinity
      if (
        cost >= previous ||
        cost + unchecked(congestion[region]) + unchecked(penalty[port]) >=
          previous
      )
        continue
      const nextG = computeG(
        hop,
        port,
        region,
        0,
        cost,
        i - unchecked(starts[region]),
      )
      if (!isFinite(nextG) || nextG >= previous) continue
      legacyEnqueue(next, nextG, computeH(port), record)
      if (overflow) return -2
    }
  }
  return 0
}
