# PR Title

Reduce solver memory pressure in duplicate-port and section-pipeline flows

## Summary

This PR reduces memory usage across the duplicate-port repair path and the section pipeline, while fixing a regression around serialized metadata preservation.

## What changed

- Reworked `TinyHyperGraphSolver` candidate cost storage to use compact per-port incident-region slots instead of dense `portCount * regionCount` arrays.
- Added overflow handling for non-incident hops and explicit cleanup hooks to release transient search state after solving.
- Updated the section pipeline to reuse cached section-stage params, skip the optimize stage when the section mask is empty, and release no-longer-needed solver state after each stage.
- Reduced memory in `DuplicateCongestedPortSolver` by avoiding unnecessary deep cloning, stripping topology metadata before per-route solves, and precomputing serialized port IDs for reporting.
- Fixed serialized graph metadata handling so custom region/port metadata fields survive load/solve/output round-trips.
- Adjusted section replay scoring to rebuild solved solvers from solutions directly, so final congestion scoring reflects the actual solved output with the right solve options.

## Why

The recent duplicate-port and section-optimization flows were holding onto more solver/search state than necessary and allocating large dense structures that scale poorly with graph size. These changes keep the same behavior while lowering peak memory use and cleaning up state earlier. The metadata fix ensures the memory optimizations do not drop user-provided serialized fields.

## Testing

- Added coverage in `tests/compat/layer-label.test.ts` to verify custom region/port metadata is preserved through solver output.

I did not run the test suite here.
