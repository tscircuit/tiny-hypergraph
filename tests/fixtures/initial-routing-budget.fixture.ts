import { loadSerializedHyperGraph } from "../../lib/index"

export function createInitialRoutingBudgetProblem(): ReturnType<
  typeof loadSerializedHyperGraph
> {
  const regionCount = 24
  return loadSerializedHyperGraph({
    regions: Array.from({ length: regionCount }, (_, index) => ({
      regionId: `r${index}`,
      pointIds: [
        ...(index > 0 ? [`p${index - 1}`] : []),
        ...(index < regionCount - 1 ? [`p${index}`] : []),
      ],
      d: { center: { x: index, y: 0 }, width: 1, height: 1, availableZ: [0] },
    })),
    ports: Array.from({ length: regionCount - 1 }, (_, index) => ({
      portId: `p${index}`,
      region1Id: `r${index}`,
      region2Id: `r${index + 1}`,
      d: { x: index + 0.5, y: 0, z: 0 },
    })),
    connections: [
      { connectionId: "signal", startRegionId: "r0", endRegionId: "r23" },
    ],
  })
}
