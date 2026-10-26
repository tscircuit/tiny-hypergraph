import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"

export const createSingleRouteViaCapacity = (width = 0.2, endZ = 1) => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 3,
    regionIncidentPorts: [[0, 1], [0], [1]],
    incidentPortRegion: [[0, 1], [0, 2]],
    regionWidth: new Float64Array([width, 1, 1]),
    regionHeight: new Float64Array([width, 1, 1]),
    regionCenterX: new Float64Array([0, -1, 1]),
    regionCenterY: new Float64Array(3),
    regionAvailableZMask: new Int32Array([3, 1, 1 << endZ]),
    portAngleForRegion1: new Int32Array([0, 18000]),
    portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array([-width / 2, width / 2]),
    portY: new Float64Array(2),
    portZ: new Int32Array([0, endZ]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(3).fill(-1),
  }
  return { topology, problem }
}

/** A reachable chain plus an isolated goal beyond the bounded static precheck. */
export const createSingleRouteDisconnectedChain = (connected = false) => {
  const chainPorts = 12
  const portCount = chainPorts + 1
  const regionCount = chainPorts + 3
  const regionIncidentPorts: number[][] = Array.from({ length: regionCount }, () => [])
  const incidentPortRegion: number[][] = []
  for (let i = 0; i < portCount; i++) {
    const regions = i === chainPorts ? [chainPorts + 1, chainPorts + 2] : i === 0 ? [1, 0] : [i, i + 1]
    incidentPortRegion.push(regions)
    for (const region of regions) regionIncidentPorts[region].push(i)
  }
  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount,
    regionIncidentPorts,
    incidentPortRegion,
    regionWidth: new Float64Array(regionCount).fill(1),
    regionHeight: new Float64Array(regionCount).fill(1),
    regionCenterX: Float64Array.from({ length: regionCount }, (_, i) => i),
    regionCenterY: new Float64Array(regionCount),
    regionAvailableZMask: new Int32Array(regionCount).fill(1),
    portAngleForRegion1: new Int32Array(portCount),
    portAngleForRegion2: new Int32Array(portCount).fill(18000),
    portX: Float64Array.from({ length: portCount }, (_, i) => i === chainPorts ? chainPorts + 1.5 : i + 0.5),
    portY: new Float64Array(portCount),
    portZ: new Int32Array(portCount),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(portCount).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([connected ? chainPorts - 1 : chainPorts]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(regionCount).fill(-1),
  }
  return { topology, problem }
}
