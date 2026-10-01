# Pickla Release V1

Run the trusted runner from a clean checkout of protected `main`:

```sh
npm run pickla -- release inspect <full-candidate-sha>
npm run pickla -- release stage <release-id>
npm run pickla -- release verify <release-id>
npm run pickla -- release status <release-id>
```

`inspect` requires the current canonical `origin/main` to be an ancestor of the candidate. It validates the commit, tree, base, policy hash and a clean temporary worktree. The candidate is input data; the policy and commands come from the runner checkout. `verify` rechecks main and policy before running local gates without credentials. The local JSON record is in `.pickla-release-v1/`; Actions persist it by normal fast-forward push to `pickla-release-registry`. Protect that ref against human force-push or deletion before relying on it operationally. Events are append-only within each record. Large logs are represented by SHA-256 digests.

Stage is allowlisted only for Supabase branch `byuwuoivuuklcwmoesrx` and a `.vercel.app` deployment of the exact SHA on the PR branch. The shared Stage and its Storefront candidate are excluded. The adapter reads Vercel Git deployments, served `/api/release`, the built application bundle and the Supabase branch control plane; it rejects older builds and protected URLs. The preview branch has isolated Supabase variables and skips the production Public Web data build. `/mail` returns 503 there. A durable Git ref serializes mutations to the isolated target. Candidate Edge diffs remain blocked until a narrow deployment/version adapter is approved. The branch reports `MIGRATIONS_FAILED`, while all 62 repo migrations are in its ledger and the synthetic APIs work; the failed workflow step is still unknown.

The trusted Studentpris harness uses only synthetic `student-hotfix-5403bc75` identities and the deployed isolated API. It checks 59 SEK for non-member, Play, Play+ and Founder; normal Open Play 165/99/0/0; a temporary explicit 49 SEK rule; and Admin save/reload. It removes its temporary rule and can be rerun. A real Stripe TEST checkout and `READY_FOR_APPROVAL` still require a branch-scoped TEST credential plus the protected-main workflow and scoped CI credentials. No claim of a paid checkout is made from local tests or earlier synthetic orders.

Promotion is disabled. A separate cutover must establish this runner as the sole production routing authority: assess and disable or redirect competing Vercel Git deployment, autoassign and hooks, Supabase GitHub production deploy and manual CLI paths; add an approval boundary that works for the actual GitHub plan; use a durable FIFO queue and remote Stage lease because GitHub Actions concurrency alone replaces older pending runs; verify alias, `/api/release`, Edge manifests and migrations immediately before promotion. The V1 `promote` command always fails closed. No production migration or alias change is automated.

The historical Studentpris commit `9ba8174a8ae803491589a4a08afed50ceec8bde1` is a policy fixture, already released through PR #3. Do not redeploy it. The snapshot selects deployed pricing, Admin, inverse and Stripe TEST evidence without selecting unrelated inventory/refund gates. Stripe PASS requires a paid `cs_test_` session, `livemode=false`, `amount_total=5900`, `currency=sek`, and a matching isolated Pickla order.

`release/inventory.json` is a timestamped control-plane inventory. `UNKNOWN` blocks routing decisions. `npm run prod:check` contains local behavior tests and source/build assertions; it does not prove a live Stage checkout, served identity or production deployment. `scripts/edge-release-plan.mjs` selects browser consumers of shared CORS code; the runner also records transitive local imports per affected Edge Function. Migration files can be inspected but production application is manual and disabled here.
