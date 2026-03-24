import type { TinyHyperGraphTopology } from "lib/index"

export const sample002SectionSerializedRegionIds = [
  "new-cmn_1-7",
  "cmn_1",
  "cmn_148",
  "cmn_155",
  "new-cmn_148-41",
  "cmn_147",
  "new-cmn_21-22",
]

export const createSample002SectionPortMask = (
  topology: TinyHyperGraphTopology,
) => {
  const sectionRegionIds = new Set(sample002SectionSerializedRegionIds)

  return Int8Array.from({ length: topology.portCount }, (_, portId) => {
    const incidentRegionIds = topology.incidentPortRegion[portId] ?? []
    return incidentRegionIds.some((regionId) =>
      sectionRegionIds.has(
        topology.regionMetadata?.[regionId]?.serializedRegionId,
      ),
    )
      ? 1
      : 0
  })
}
