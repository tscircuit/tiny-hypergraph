import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphTopology,
} from "./core"

export type TinySerializedHyperGraph = Omit<
  SerializedHyperGraph,
  "connections"
> & {
  connections?: Array<
    NonNullable<SerializedHyperGraph["connections"]>[number] & {
      /** Permitted signal-routing layers; absent means unrestricted. */
      allowedZ?: number[]
    }
  >
}

export const isPortAllowedForRoute = (
  topology: Pick<TinyHyperGraphTopology, "portZ">,
  problem: Pick<TinyHyperGraphProblem, "routeAllowedZ">,
  routeId: number,
  portId: number,
): boolean =>
  problem.routeAllowedZ?.[routeId]?.includes(topology.portZ[portId]!) ?? true

export const validateRouteAllowedZ = (
  topology: Pick<TinyHyperGraphTopology, "portZ">,
  problem: TinyHyperGraphProblem,
  solution?: TinyHyperGraphSolution,
): void => {
  if (problem.routeAllowedZ === undefined) return
  if (problem.routeAllowedZ.length !== problem.routeCount) {
    throw new Error("routeAllowedZ must contain one entry per route")
  }
  const assertPortAllowed = (routeId: number, portId: number) => {
    if (isPortAllowedForRoute(topology, problem, routeId, portId)) return
    const name =
      problem.routeMetadata?.[routeId]?.connectionId ?? `route-${routeId}`
    throw new Error(
      `Connection "${name}" port ${portId} on Z ${topology.portZ[portId]} is outside allowedZ [${problem.routeAllowedZ![routeId]}]`,
    )
  }
  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const allowedZ = problem.routeAllowedZ[routeId]
    if (allowedZ === undefined) continue
    if (
      !Array.isArray(allowedZ) ||
      allowedZ.length === 0 ||
      allowedZ.some((z) => !Number.isInteger(z) || z < 0)
    ) {
      const name =
        problem.routeMetadata?.[routeId]?.connectionId ?? `route-${routeId}`
      throw new Error(
        `Connection "${name}" allowedZ must contain non-negative integer layers`,
      )
    }
    assertPortAllowed(routeId, problem.routeStartPort[routeId]!)
    assertPortAllowed(routeId, problem.routeEndPort[routeId]!)
    for (const segment of solution?.solvedRoutePathSegments[routeId] ?? []) {
      for (const portId of segment) assertPortAllowed(routeId, portId)
    }
  }
  for (const { routeId, fromPortId, toPortId } of problem.initialAssignments ??
    []) {
    assertPortAllowed(routeId, fromPortId)
    assertPortAllowed(routeId, toPortId)
  }
}
