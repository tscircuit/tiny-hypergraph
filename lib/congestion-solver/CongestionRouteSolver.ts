import {
  getTinyHyperGraphSolverOptions,
  type TinyHyperGraphInitialAssignment,
  type TinyHyperGraphSolver,
} from "../core"
import { OutsideInPartialRipTinyHyperGraphSolver } from "../outside-in-partial-rip-tiny-hypergraph-solver"
// The loader stores external identities in non-enumerable metadata properties.
// structuredClone copies the geometry but drops those identity descriptors.
function cloneTopology(source: TinyHyperGraphSolver["topology"]) {
  const copy = structuredClone(source)
  for (const [field, identity] of [
    ["regionMetadata", "serializedRegionId"],
    ["portMetadata", "serializedPortId"],
  ] as const) {
    source[field]?.forEach((metadata, index) => {
      if (!metadata || typeof metadata !== "object") return
      const descriptor = Object.getOwnPropertyDescriptor(metadata, identity)
      if (descriptor && copy[field]?.[index]) {
        Object.defineProperty(copy[field]![index], identity, descriptor)
      }
    })
  }
  return copy
}

/** A failed replacement must not rip routes retained from the complete solution. */
export class CongestionRouteSolver extends OutsideInPartialRipTinyHyperGraphSolver {
  constructor(
    source: TinyHyperGraphSolver,
    retained: TinyHyperGraphInitialAssignment[],
    public avoidedRegionId: number,
    maxIterations: number,
  ) {
    super(
      cloneTopology(source.topology),
      {
        ...structuredClone(source.problem),
        initialAssignments: retained,
      },
      {
        ...getTinyHyperGraphSolverOptions(source),
        minViaPadDiameter: source.minViaPadDiameter,
        MAX_ITERATIONS: maxIterations + 1,
        STATIC_REACHABILITY_PRECHECK: false,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
        PARTIAL_RIP_ENABLED: true,
        PARTIAL_RIP_MIN_ROUTE_COUNT: 0,
        PARTIAL_RIP_MAX_ROUTE_COUNT: Number.MAX_SAFE_INTEGER,
        OUTSIDE_IN_ROUTING: true,
        USE_SPARSE_CANDIDATE_STORAGE: true,
      },
    )
  }

  override isRegionReservedForDifferentNet(regionId: number): boolean {
    return (
      regionId === this.avoidedRegionId ||
      super.isRegionReservedForDifferentNet(regionId)
    )
  }

  override onOutOfCandidates() {
    this.failed = true
    this.error = "No route avoids the selected region"
    this.state.candidateQueue.clear()
  }

  override onAllRoutesRouted() {
    this.solved = true
    this.progress = 1
  }
}
