ROUTE SEARCH KERNEL

route-search.ts is AssemblyScript, not ordinary TypeScript. It is excluded from
the application's typecheck and Biome parser. The committed WASM is the runtime
artifact; consumers do not need a compiler. AssemblyScript 0.28.20 is pinned as
a development dependency. Its compiler emits IEEE f64 instructions; no fast-math
or relaxed SIMD transformations are enabled.

  bun install
  bun run build:native-search

CI rebuilds and compares the binary before benchmarking. The implementation
preserves neighbor order, heap tie order, stale legacy entries, indexed closure,
terminal scoring and search-step accounting. NativePortfolioSolver applies the
original routing mutations and acceptance rules. Numeric immutable inputs are
shared across worker runtimes, then copied into bounded linear memory for each
candidate. Mutable assignments and congestion use views into that memory.

The host checks input limits before enabling the kernel. Cache/history limits
fall back to the reference JS search. Region counts and costs are supplied by
the original insertion code, and versioned generic score caching is enabled
only when the current net has no existing segment in that region.

Tests compare route state, full output, status, errors, statistics and iteration
counts against the original constituent algorithms, including density costs,
tiny budgets, rerips, reservations and preloaded inputs. Benchmark fingerprints
also compare every srj18 result across worker counts and repetitions.
