# Dataset18 sample014 native port-pathing input

`srj18-sample014-native.json.gz` captures the fresh numeric input to Pipeline9's native port-point solver, before any route is assigned. It contains 20,321 ports, 4,225 regions, and 238 routes. The native 2,000,000-iteration budget and all solver options are retained. Typed arrays use `$typed` tags; non-finite numbers use `$number` tags so `Infinity` does not become JSON `null`.

Producer: `scripts/benchmark/capture-native-port-pathing.ts` in [autorouter PR #3226](https://github.com/tscircuit/tscircuit-autorouter/pull/3226), captured by [run39997592146](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/39997592146).

Uncompressed SHA256: `32725b1f9d5603551138e799c6234293f0a475a3f3ff063a0c69044e990505a5`.

Run an isolated solve:

```sh
bun scripts/benchmarking/native-port-point-pathing.ts --repeat 2
```

Compare another checkout in ABBA order:

```sh
bun scripts/benchmarking/native-port-point-pathing.ts --reference /path/to/reference-tiny-hypergraph --repeat 2
```

Every comparison requires identical serialized output, iterations, and all non-timing statistics. Input decoding and fixture loading are outside the timed solve. These isolated solves are synchronous; this command does not claim to exercise four workers. The consumer PR's `/benchmark --dataset 18 --threads 4` measures the complete pipeline with its four-worker runtime.

The deterministic four-lane solver has a separate real-worker benchmark:

```sh
bun scripts/benchmarking/native-port-point-portfolio.ts --reference /path/to/reference-tiny-hypergraph --threads 4 --repeat 2
```

It first checks the complete synchronous portfolio result, then requires every worker solve to match that output, working state, iteration count, and statistics exactly. The ABBA comparison measures the original solver against four worker searches. Their routes can differ; congestion metrics are printed for both, and the consumer's full dataset benchmark checks completion and DRC. Each lane receives half the original native iteration budget, so difficult boards use twice the aggregate native search work. Synchronous execution can therefore be slower on those boards. Searches remain identical until a costly blocker rerip; if none occurs, synchronous execution skips the three identical candidates.
