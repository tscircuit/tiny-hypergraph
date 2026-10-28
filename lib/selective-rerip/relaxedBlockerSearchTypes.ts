import type { PortId, RegionId, RouteId } from "../types"

export type RelaxedSearchState = {
  portId: PortId
  nextRegionId: RegionId
}

export type PortBlockerResource = {
  kind: "port"
  portId: PortId
  owners: RouteId[]
}

type SameLayerIntersectionBlockerResource = {
  kind: "same_layer_intersection"
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
  owners: RouteId[]
}

export type SelectiveReripBlockerResource =
  | PortBlockerResource
  | SameLayerIntersectionBlockerResource

export type RelaxedSearchHopData = {
  resources: SelectiveReripBlockerResource[]
}

export type RelaxedSearchHop = {
  state: RelaxedSearchState
  distance: number
  owners: RouteId[]
  data: RelaxedSearchHopData
}
