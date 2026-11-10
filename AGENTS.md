# Pull request evidence

Every PR must include an inspected native visual snapshot and benchmark-effect
analysis. Compare identical inputs, options, and budgets on base and head; report
completion, failures, route/DRC compatibility, timing, memory, and any limitations.
Do not merge a PR before reporting its benchmark effects. A reproduction PR may
deliberately fail its new regression. Run complete benchmark datasets on Blacksmith
with sufficient time; do not count timeouts as passing cases or omit slow cases.
