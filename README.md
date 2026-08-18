# AI Revenue Engine

Standalone Next.js foundation for a reusable, product-agnostic revenue platform. Event Suite is the initial active product; Allxs and Prestige ID are represented as future placeholders only.

## Development

```bash
npm install
npm run dev
npm run check
```

The local Supabase migration represents the existing remote foundation. It is intentionally not pushed by this bootstrap. Browser access is not wired to revenue tables yet; RLS is enabled with no browser policies (fail-closed by design).

## Scope boundary

This slice does not implement prospecting, CRM, outreach, agents, workflow orchestration, authentication roles, or external sales integrations.
