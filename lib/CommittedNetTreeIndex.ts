import type { NetId, PortId, RegionId, RouteId } from "./types"

export type CommittedTreeStep = {
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

type RegionSegments = Array<Array<[RouteId, PortId, PortId]>>

/** Connectivity comes only from committed graph edges, never net labels or XY. */
export class CommittedNetTreeIndex {
  private source?: RegionSegments
  private readonly edgeKeys = new Set<string>()
  private adjacency = new Map<NetId, Map<PortId, CommittedTreeStep[]>>()

  invalidate(): void {
    // Independent problems may reuse the outer segment array in place.
    this.source = undefined
    this.adjacency.clear()
    this.edgeKeys.clear()
  }

  synchronize(args: {
    regionSegments: RegionSegments
    routeNet: Int32Array
  }): void {
    if (this.source === args.regionSegments) return
    this.source = args.regionSegments
    this.adjacency.clear()
    this.edgeKeys.clear()
    for (let regionId = 0; regionId < args.regionSegments.length; regionId++) {
      for (const [routeId, fromPortId, toPortId] of args.regionSegments[regionId]!) {
        this.add({ netId: args.routeNet[routeId]!, regionId, fromPortId, toPortId })
      }
    }
  }

  add(args: CommittedTreeStep & { netId: NetId }): void {
    const key = [
      args.netId,
      args.regionId,
      Math.min(args.fromPortId, args.toPortId),
      Math.max(args.fromPortId, args.toPortId),
    ].join(":")
    if (this.edgeKeys.has(key)) return
    this.edgeKeys.add(key)
    let net = this.adjacency.get(args.netId)
    if (!net) {
      net = new Map()
      this.adjacency.set(args.netId, net)
    }
    const directions: Array<[PortId, PortId]> = [
      [args.fromPortId, args.toPortId],
      [args.toPortId, args.fromPortId],
    ]
    for (const [fromPortId, toPortId] of directions) {
      let edges = net.get(fromPortId)
      if (!edges) {
        edges = []
        net.set(fromPortId, edges)
      }
      edges.push({ regionId: args.regionId, fromPortId, toPortId })
    }
  }

  /** Each discovered port owns an oriented, acyclic successor toward the root. */
  getComponent(args: {
    netId: NetId
    rootPortId: PortId
  }): Map<PortId, CommittedTreeStep | undefined> {
    const successors = new Map<PortId, CommittedTreeStep | undefined>([
      [args.rootPortId, undefined],
    ])
    const queue = [args.rootPortId]
    const net = this.adjacency.get(args.netId)
    for (let head = 0; head < queue.length; head++) {
      const fromPortId = queue[head]!
      for (const edge of net?.get(fromPortId) ?? []) {
        if (successors.has(edge.toPortId)) continue
        successors.set(edge.toPortId, {
          regionId: edge.regionId,
          fromPortId: edge.toPortId,
          toPortId: fromPortId,
        })
        queue.push(edge.toPortId)
      }
    }
    return successors
  }
}
