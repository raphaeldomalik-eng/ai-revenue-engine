# Secure Persistence Foundation V1

This slice introduces a reviewable persistence boundary for internal AI Revenue Engine users. It is not activated in production until the accompanying migration and RLS policies are reviewed and applied separately.

```text
Auth User
  -> active internal Revenue Membership
  -> RLS and grants
  -> RevenueRepository
  -> Account / Contact / Evidence / Opportunity / Activity
```

## Internal membership

`revenue_members` contains internal company / Revenue Engine users only. `admin`, `operator`, and `viewer` roles are authorisation roles, not customer or partner roles.

Future Local Operator Network / channel concepts are deliberately separate: `partner_organisations`, `partner_members`, and `partner_product_authorisations` are future concepts only and are not created by this slice. Local Operators, partners, and their staff must never be treated as `revenue_members`.

`AUTHENTICATED != AUTHORIZED`:

- Anonymous users receive no grants or policies.
- Authenticated users without an active membership receive no data access and cannot self-enrol.
- Active viewers can read commercial and reference data.
- Active operators and admins can perform ordinary CRUD on mutable commercial data.
- Application users cannot mutate reference data or membership rows.

The migration uses minimal `SECURITY DEFINER` helpers in the non-exposed `private` schema. They return only the current authenticated user's active membership/role; they accept no user ID and cannot mutate commercial data.

## Persistence semantics

`UNKNOWN != DEFAULT`. Unknown account facts become `null` columns or explicit structured metadata; no numeric confidence mapping is invented.

Research Evidence keeps `FACT` and `INFERENCE` in separate persisted fields. Qualitative confidence is preserved; qualification scoring remains deferred.

`UNDETERMINED DIRECT ROUTE != SELF-SERVICE OR DEMO`. A Product Opportunity stores product, territory, and sales motion while `commercial_program_id` remains null until a conversion route is selected. LNO Business Opportunity Enquiry can resolve an existing Commercial Program through stable `products.code`, `territories.code`, `sales_motions.code`, and conversion identifiers, never copied UUIDs.

## Production activation

1. Review `supabase/migrations/20260818000001_secure_persistence_foundation.sql`.
2. Run its RLS test matrix in a disposable/local Supabase environment.
3. Apply it to production through the approved database-activation workflow.
4. Provision the first Auth user and corresponding active internal `revenue_members` row administratively.
5. Validate anon, non-member, viewer, operator, and admin behaviour before exposing persistence UI.

This implementation does not apply the migration, provision users, write production data, use a service-role key, or create browser persistence forms.
