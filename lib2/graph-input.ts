import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "./graph-load"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphTopology,
} from "./domain"
import { err, ok, type Result } from "./prelude"

/** A serialized graph that has passed lib2 boundary parsing. */
export type ParsedSerializedGraph = SerializedHyperGraph

/** Loaded solver input produced from a parsed serialized graph. */
export type LoadedGraph = {
  readonly topology: TinyHyperGraphTopology
  readonly problem: TinyHyperGraphProblem
  readonly solution: TinyHyperGraphSolution
}

/** Expected failure while parsing serialized graph input. */
export class ParseGraphError extends Error {
  readonly _tag = "ParseGraphError"
  readonly graphCause: unknown | undefined

  constructor(
    readonly reason: string,
    graphCause?: unknown,
  ) {
    super(`Invalid serialized graph: ${reason}`)
    this.graphCause = graphCause
  }
}

/** Expected failure while loading parsed graph data into solver structures. */
export class LoadGraphError extends Error {
  readonly _tag = "LoadGraphError"
  readonly graphCause: unknown

  constructor(graphCause: unknown) {
    super(
      graphCause instanceof Error
        ? `Unable to load serialized graph: ${graphCause.message}`
        : "Unable to load serialized graph",
    )
    this.graphCause = graphCause
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/**
 * Parse unknown input into a serialized hypergraph boundary type.
 *
 * @param graph - Unknown boundary input.
 * @returns A parsed serialized graph or a typed parse error.
 */
export function parseGraph(
  graph: unknown,
): Result<ParsedSerializedGraph, ParseGraphError> {
  if (!isRecord(graph)) {
    return err(new ParseGraphError("expected an object"))
  }

  if (!Array.isArray(graph.regions)) {
    return err(new ParseGraphError("expected regions array"))
  }

  if (!Array.isArray(graph.ports)) {
    return err(new ParseGraphError("expected ports array"))
  }

  if (graph.connections !== undefined && !Array.isArray(graph.connections)) {
    return err(new ParseGraphError("expected connections array when present"))
  }

  // SAFETY: The compat loader owns detailed SerializedHyperGraph semantics.
  // This parser establishes the top-level shape before handing the graph to
  // that boundary adapter.
  return ok(graph as ParsedSerializedGraph)
}

/**
 * Load a parsed serialized graph into topology, problem, and solution values.
 *
 * @param graph - Parsed serialized graph.
 * @returns Loaded graph values or a typed load error.
 */
export function loadGraph(
  graph: ParsedSerializedGraph,
): Result<LoadedGraph, LoadGraphError> {
  try {
    return ok(loadSerializedHyperGraph(graph))
  } catch (cause) {
    return err(new LoadGraphError(cause))
  }
}
