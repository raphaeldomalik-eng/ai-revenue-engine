# Commercial foundation

The typed source of truth lives in `src/revenue/`:

- `commercial-model.ts` defines product-agnostic playbook, claim, offer, pricing, readiness, and channel-guidance types.
- `claims.ts` defines commodity/prohibited governance, Event Suite hypotheses, and the defensible-claim gate.
- `pricing.ts` holds approved South African structured pricing and an explicit UK deferred state.
- `playbooks.ts` defines the four Event Suite playbook families.
- `playbook-resolver.ts` resolves a playbook deterministically by product, territory, and sales motion.

The Command Centre reads these playbooks as static configuration. No Supabase migration is needed for this slice, and no outreach or AI capability may bypass claim governance or unresolved readiness states.
