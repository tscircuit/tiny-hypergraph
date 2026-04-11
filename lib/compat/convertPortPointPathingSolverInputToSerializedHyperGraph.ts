import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

export const PORT_POINT_PATHING_SOLVER_TUNING_KEY =
  "__portPointPathingSolverTuning"

export interface PortPointPathingSolverFlags {
  FORCE_CENTER_FIRST?: boolean
  RIPPING_ENABLED?: boolean
}

export interface PortPointPathingSolverWeights {
  START_RIPPING_PF_THRESHOLD?: number
  END_RIPPING_PF_THRESHOLD?: number
  STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR?: number
}

export interface PortPointPathingSolverTuning {
  flags?: PortPointPathingSolverFlags
  weights?: PortPointPathingSolverWeights
}

export interface SerializedHyperGraphPortPointPathingSolverParams {
  format: "serialized-hg-port-point-pathing-solver-params"
  graph: {
    regions: SerializedHyperGraph["regions"]
    ports: SerializedHyperGraph["ports"]
  }
  connections: NonNullable<SerializedHyperGraph["connections"]>
  flags?: PortPointPathingSolverFlags
  weights?: PortPointPathingSolverWeights
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

const getSinglePortPointPathingSolverParams = (
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

  const serializedHyperGraph = {
    regions: params.graph.regions,
    ports: params.graph.ports,
    connections: params.connections,
  } as SerializedHyperGraph & {
    [PORT_POINT_PATHING_SOLVER_TUNING_KEY]?: PortPointPathingSolverTuning
  }

  if (params.flags || params.weights) {
    Object.defineProperty(
      serializedHyperGraph,
      PORT_POINT_PATHING_SOLVER_TUNING_KEY,
      {
        value: {
          flags: params.flags,
          weights: params.weights,
        } satisfies PortPointPathingSolverTuning,
        enumerable: false,
        configurable: true,
        writable: true,
      },
    )
  }

  return serializedHyperGraph
}
