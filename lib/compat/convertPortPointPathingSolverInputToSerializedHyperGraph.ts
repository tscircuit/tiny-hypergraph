import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

type SerializedHyperGraphRuntimeConfig = {
  effort?: number
  layerCount?: number
  flags?: Record<string, boolean>
  weights?: Record<string, number>
}

export type SerializedHyperGraphWithRuntimeConfig = SerializedHyperGraph &
  SerializedHyperGraphRuntimeConfig

type SerializedHyperGraphPortPointPathingSolverParamsBase = {
  format: "serialized-hg-port-point-pathing-solver-params"
  graph: {
    regions: SerializedHyperGraph["regions"]
    ports: SerializedHyperGraph["ports"]
  }
  connections: NonNullable<SerializedHyperGraph["connections"]>
  effort?: unknown
  flags?: unknown
  layerCount?: unknown
  weights?: unknown
}

export type SerializedHyperGraphPortPointPathingSolverParams =
  SerializedHyperGraphPortPointPathingSolverParamsBase &
    SerializedHyperGraphRuntimeConfig

export type SerializedHyperGraphPortPointPathingSolverInput =
  | SerializedHyperGraphPortPointPathingSolverParams
  | SerializedHyperGraphPortPointPathingSolverParams[]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isSerializedHyperGraphPortPointPathingSolverParams = (
  value: unknown,
): value is SerializedHyperGraphPortPointPathingSolverParams => {
  if (!isRecord(value)) {
    return false
  }

  const { format, graph, connections } = value

  return (
    format === "serialized-hg-port-point-pathing-solver-params" &&
    isRecord(graph) &&
    Array.isArray(graph.regions) &&
    Array.isArray(graph.ports) &&
    Array.isArray(connections)
  )
}

export const getSinglePortPointPathingSolverParams = (
  input: SerializedHyperGraphPortPointPathingSolverInput,
) => {
  if (!Array.isArray(input)) {
    return input
  }

  const params = input[0]
  if (!params) {
    throw new Error(
      "Port point pathing solver input array must contain at least one item",
    )
  }

  return params
}
export const convertPortPointPathingSolverInputToSerializedHyperGraph = (
  input: SerializedHyperGraphPortPointPathingSolverInput,
): SerializedHyperGraphWithRuntimeConfig => {
  const params = getSinglePortPointPathingSolverParams(input)

  if (!isSerializedHyperGraphPortPointPathingSolverParams(params)) {
    throw new Error(
      "Expected serialized-hg-port-point-pathing-solver-params input",
    )
  }

  const serializedHyperGraph: SerializedHyperGraphWithRuntimeConfig = {
    regions: params.graph.regions,
    ports: params.graph.ports,
    connections: params.connections,
    effort: params.effort,
    layerCount: params.layerCount,
    flags: params.flags,
    weights: params.weights,
  }

  return serializedHyperGraph
}
