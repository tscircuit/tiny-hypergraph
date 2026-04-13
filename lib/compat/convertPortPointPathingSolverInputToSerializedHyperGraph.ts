import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

export interface SerializedHyperGraphPortPointPathingSolverParams {
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

export type SerializedHyperGraphPortPointPathingSolverInput =
  | SerializedHyperGraphPortPointPathingSolverParams
  | SerializedHyperGraphPortPointPathingSolverParams[]

const isSerializedHyperGraphPortPointPathingSolverParams = (
  value: unknown,
): value is SerializedHyperGraphPortPointPathingSolverParams =>
  typeof value === "object" &&
  value !== null &&
  (value as { format?: unknown }).format ===
    "serialized-hg-port-point-pathing-solver-params" &&
  Array.isArray((value as { graph?: { regions?: unknown } }).graph?.regions) &&
  Array.isArray((value as { graph?: { ports?: unknown } }).graph?.ports) &&
  Array.isArray((value as { connections?: unknown }).connections)

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
): SerializedHyperGraph => {
  const params = getSinglePortPointPathingSolverParams(input)

  if (!isSerializedHyperGraphPortPointPathingSolverParams(params)) {
    throw new Error(
      "Expected serialized-hg-port-point-pathing-solver-params input",
    )
  }

  return {
    regions: params.graph.regions,
    ports: params.graph.ports,
    connections: params.connections,
  }
}
