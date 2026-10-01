# Pickla Release V1

Run the trusted runner from a clean checkout of protected `main`:

```sh
npm run pickla -- release inspect <full-candidate-sha>
npm run pickla -- release stage <release-id>
npm run pickla -- release verify <release-id>
npm run pickla -- release status <release-id>
```

`inspect` requires the current canonical `origin/main` to be an ancestor of the candidate. It validates the commit, tree, base, policy hash and a clean temporary worktree. The candidate is input data; the policy and commands come from the runner checkout. `verify` rechecks main and policy before running local gates without credentials. The local JSON record is in `.pickla-release-v1/`; Actions persist it by normal fast-forward push to `pickla-release-registry`. Protect that ref against human force-push or deletion before relying on it operationally. Events are append-only within each record. Large logs are represented by SHA-256 digests.

Stage is configured only through `release/stage-targets.json`: explicit owner, Vercel project ID, Supabase ref, alias and current served identity. The allowlist is empty. `stage` therefore returns `BLOCKED: isolated Stage target unavailable`. The minimum environment action is a dedicated Vercel project and Supabase project, separate from production and shared `stage.playpickla.com`, with Stripe **test** credentials in a trusted Stage-only harness. Verify project ownership, control-plane routing, release identity, aliases, Edge versions, migration ledger and secret **presence** before enabling the target. Never copy a key value to the agent or repo. The current CLI deliberately has no Stage deploy adapter or credential-bearing workflow; adding a target alone cannot deploy.

Promotion is disabled. A separate cutover must establish this runner as the sole production routing authority: assess and disable or redirect competing Vercel Git deployment, autoassign and hooks, Supabase GitHub production deploy and manual CLI paths; add an approval boundary that works for the actual GitHub plan; use a durable FIFO queue and remote Stage lease because GitHub Actions concurrency alone replaces older pending runs; verify alias, `/api/release`, Edge manifests and migrations immediately before promotion. The V1 `promote` command always fails closed. No production migration or alias change is automated.

The historical Studentpris commit `9ba8174a8ae803491589a4a08afed50ceec8bde1` is a policy fixture. It is already on main through PR #3 and must not be redeployed. The snapshot selects pricing resolver, Admin save/reload, customer display and real isolated Stripe TEST 59 SEK evidence. It does not select generic inventory or refund certification unless those implementations change. A real Stripe TEST pass requires a paid `cs_test_` session, `livemode=false`, `amount_total=5900`, `currency=sek`, and an isolated target. Mocked tests are labeled local evidence only.

`release/inventory.json` is a timestamped control-plane inventory. `UNKNOWN` blocks routing decisions. `npm run prod:check` contains local behavior tests and source/build assertions; it does not prove a live Stage checkout, served identity or production deployment. `scripts/edge-release-plan.mjs` selects browser consumers of shared CORS code; the runner also records transitive local imports per affected Edge Function. Migration files can be inspected but production application is manual and disabled here.
