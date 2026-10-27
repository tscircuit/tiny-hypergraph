import { SelectiveReripTinyHyperGraphSolver } from "./selective-rerip-tiny-hyper-graph-solver"
import { applyInitialAssignments } from "./initialAssignments"

/** Global retries restore serialized copper; selective retries may move blockers. */
export class StableInitialAssignmentsTinyHyperGraphSolver extends SelectiveReripTinyHyperGraphSolver {
  private initialAssignmentRouteIds?: ReadonlySet<number>

  protected override getRouteIdsPreferredForPreservation(): ReadonlySet<number> {
    this.initialAssignmentRouteIds ??= new Set(
      (this.problem.initialAssignments ?? []).map(({ routeId }) => routeId),
    )
    return this.initialAssignmentRouteIds
  }

  override resetRoutingStateForRerip(): void {
    super.resetRoutingStateForRerip()
    if (!this.problem.initialAssignments?.length) return
    applyInitialAssignments({
      topology: this.topology,
      problem: this.problem,
      state: this.state,
      routeSuccessCountByRouteId: this.routeSuccessCountByRouteId,
      appendSegmentToRegionCache: (regionId, fromPortId, toPortId) =>
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId),
    })
  }
}
