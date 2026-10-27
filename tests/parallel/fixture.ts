import { OutsideInPartialRipTinyHyperGraphSolver, type TinyHyperGraphTopology, type TinyHyperGraphProblem } from "../../lib/index"

export const createParallelFixture = (): OutsideInPartialRipTinyHyperGraphSolver => {
  const regionCount = 10
  const routeCount = 12
  const portsPerBoundary = 32
  const incidentPortRegion: number[][] = []
  const regionIncidentPorts: number[][] = Array.from({ length: regionCount }, () => [])
  const xs: number[] = [], ys: number[] = [], zs: number[] = []
  const addPort = (regions: number[], x: number, y: number, z: number): number => {
    const port = xs.length
    xs.push(x); ys.push(y); zs.push(z)
    incidentPortRegion.push(regions)
    for (const region of regions) regionIncidentPorts[region]!.push(port)
    return port
  }
  const starts = Array.from({ length: routeCount }, (_, i) => addPort([0], 0, i, i % 2))
  for (let boundary = 1; boundary < regionCount; boundary++) {
    for (let i = 0; i < portsPerBoundary; i++) addPort([boundary - 1, boundary], boundary * 2, i / 2, i % 2)
  }
  const ends = Array.from({ length: routeCount }, (_, i) => addPort([regionCount - 1], regionCount * 2, routeCount - i - 1, i % 2))
  const angle = (port: number, region: number): number => Math.round(Math.atan2(ys[port]! - 8, xs[port]! - (region * 2 + 1)) * 18000 / Math.PI + 18000)
  const topology: TinyHyperGraphTopology = {
    portCount: xs.length, regionCount, incidentPortRegion, regionIncidentPorts,
    portX: Float64Array.from(xs), portY: Float64Array.from(ys), portZ: Int32Array.from(zs),
    portAngleForRegion1: Int32Array.from(xs, (_, i) => angle(i, incidentPortRegion[i]![0]!)),
    portAngleForRegion2: Int32Array.from(xs, (_, i) => angle(i, incidentPortRegion[i]![1] ?? incidentPortRegion[i]![0]!)),
    regionWidth: new Float64Array(regionCount).fill(2), regionHeight: new Float64Array(regionCount).fill(16),
    regionCenterX: Float64Array.from({ length: regionCount }, (_, i) => i * 2 + 1),
    regionCenterY: new Float64Array(regionCount).fill(8), regionAvailableZMask: new Int32Array(regionCount).fill(3),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount, routeStartPort: Int32Array.from(starts), routeEndPort: Int32Array.from(ends),
    routeNet: Int32Array.from({ length: routeCount }, (_, i) => i),
    portSectionMask: new Int8Array(xs.length).fill(1), regionNetId: new Int32Array(regionCount).fill(-1),
  }
  return new OutsideInPartialRipTinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 30_000, RIP_THRESHOLD_RAMP_ATTEMPTS: 2, GREEDY_FINAL_ROUTE_ITERS: 1,
    OUTSIDE_IN_ROUTING: true, PARTIAL_RIP_ENABLED: true, VERBOSE: false,
  })
}
