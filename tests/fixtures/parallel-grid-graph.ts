import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
export function gridGraph(size = 4): SerializedHyperGraph {
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
