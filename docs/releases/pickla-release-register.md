# Pickla release register

## 2026-09-26 coordinated Student pricing hotfix — BLOCKED

This section supersedes the historical snapshot below for this release. Read-only remote checks were performed on 2026-09-26, starting 09:28 UTC; local validation followed. No merge, production deployment, shared-Stage promotion, migration, routing change, purchase, or customer-data edit was performed.

### Decision and smallest next action

**Promotion is blocked by verified automatic deployment routing.** Vercel management reads now succeed after the official CLI refreshed the existing expired session. Customer production, shared Stage, and mail all link the same GitHub repository, all use `productionBranch: main`, all have `gitProviderOptions.createDeployments: enabled`, all have `autoAssignCustomDomains: true`, and no ignored-build command is configured. Stage domains have no branch-specific assignment. Merging would trigger production-channel builds and automatic alias assignment in all three projects, replacing the unrelated Storefront deployment on shared Stage.

**Smallest required action:** explicitly authorize temporarily pausing Git-triggered deployments for the Stage and mail Vercel projects during this release, retaining their current deployments and aliases. This is a proposed change only; it has not been applied. The customer production project remains on its existing routing. Re-enabling the paused projects must be coordinated after release so a subsequent main push does not silently replace Stage work.

Supabase GitHub integration mapping still needs verification before merging: there are no tracked GitHub workflows and the repository hooks response is empty, but neither proves the GitHub App integration is absent. The authenticated GitHub installation-list endpoint returned 403 because this credential is not a GitHub App token; public Supabase management metadata does not expose the integration mapping. The browser control server exited during the read-only dashboard attempt. No integration was disconnected or reconfigured. The existing Stage `MIGRATIONS_FAILED` operation status also remains unresolved, despite complete active-main migration versions.

Stage/isolated Edge verification and real Stripe test-mode checkout remain pending. Their results cannot be substituted with local mocks. No promotion may occur before these gates and the routing checks pass.

### Immutable sources and publication state

Coordinated review artifact: [draft PR #3](https://github.com/guggeuber/pickla-flow-1b995a61/pull/3), branch `codex/student-pricing-coordinated-release-20260926`. Published source/register head before this publication-note commit: `2ae648edd74abfbe198092964e117d8cfb1070fc`. It remains DRAFT and unmerged. Normal automatic Vercel preview builds may run; these are frontend previews and do not establish candidate Edge or Stripe lifecycle parity. Shared Stage and mail production aliases are preserved.

| Source | Exact SHA / state |
| --- | --- |
| Fresh canonical `origin/main` | `567581097d97a8631fc95c2770bffdcbba6effd9`; fetched and rechecked with canonical `ls-remote`; unchanged |
| Original hotfix | `9ba8174a8ae803491589a4a08afed50ceec8bde1`, remote `codex/pricing-product-selection-hotfix-20260925`; unchanged, original worktree preserved |
| Deployed P0 preservation source | `bd7058d6cc7dece988308148446ee9d30d51f1e0`, remote `codex/p0-restore-customer-membership-functions-20260923`; [PR #2](https://github.com/guggeuber/pickla-flow-1b995a61/pull/2) remains OPEN, head exact, base current main |
| Coordinated runtime candidate | `fbf13803003b719251d65bf4356eea2bac9b5f49`, local `codex/student-pricing-coordinated-release-20260926`, clean isolated checkout `/private/tmp/pickla-student-pricing-coordinated-20260926` |
| Coordinated recovery source | `5d8ed56cf7736410f95d6974c8290dba3b4b825d`, runtime equivalent to published P0 source `bd7058d`; original main plus exact four P0 commits, before hotfix |
| Schedule candidate | Local `codex/schedule-truth-repair` at `a8cfd729b8e8723dc8d7733976d3125e1a04fb27`; no canonical remote branch with this name; merge base with main `a8b7ce92c969970c680f22705f601bf82e61abe2` |

The coordinated runtime candidate cherry-picks only the four exact P0 commits and original hotfix onto fresh main. The only runtime delta against the original hotfix is preservation of the already-live P0 correction; no pricing implementation was rewritten. Full runtime diff: **14 files, 936 insertions / 80 deletions**. The release-register commit subsequently adds this document only. No dependency or config changes are included. The coordinated PR is prepared as a draft for review; its publication identity is recorded below. No main merge is permitted while deployment automation is unresolved. PR #2 is a dependency, not a merged integration result.

Exact runtime patch: `git diff 567581097d97a8631fc95c2770bffdcbba6effd9..fbf13803003b719251d65bf4356eea2bac9b5f49`; saved `/private/tmp/pickla-student-release-evidence-20260926/coordinated-runtime.patch`, SHA-256 `532cafefa6c353fcd2685a8af670d26a0897737b81f0ec7594c31c9638c6a6ba`. Original patch: `git show --format=fuller --binary 9ba8174`; saved `original-hotfix.patch`, SHA-256 `fa2bfe527291acb366f9c7ddd5c6d692b8606ba780bbab767905f5dc61d78c92`.

### Narrow diff and overlap

Original hotfix files:

- `src/components/admin/AdminSchedule.tsx`: retains the selected canonical ticket key; selected product initializes session price; writes explicit inclusion metadata alongside canonical access policy; OFF preview uses paid base price unless an explicit product rule exists.
- `src/components/hub/EventCard.tsx`: inclusion labels use backend debug truth or the same shared policy fallback.
- `src/lib/activityPricing.ts`: OFF gates inherited inclusion/default discounts; explicit product rules remain effective.
- `supabase/functions/_shared/activity_inclusion_policy.ts`: explicit canonical policy overrides legacy metadata; custom canonical products do not inherit absent legacy inclusion defaults.
- `supabase/functions/_shared/activity_pricing.ts`: authoritative checkout resolver uses that policy; explicit product tier rule is respected even with inclusion OFF.
- `src/test/activityProductSelectionPricing.test.ts`: four-category Student regression, explicit rule exception, normal Open Play inverse, Admin/Commerce source contracts.
- `docs/production-readiness.md`: exact production smoke invariant.

P0 preservation adds its existing tests and exactly four runtime files: `_shared/customer_access.ts`, `_shared/customers.ts`, `api-customers/index.ts`, `api-memberships/index.ts`. Live production customers and memberships match every file in their complete downloaded closures against both `bd7058d` and coordinated source (6/6 each). Authorization, organization isolation, canonical identity, and membership replacement ordering are preserved.

Five deployed functions actually bundle the changed activity pricing resolver: **api-bookings, api-commerce, api-courses, api-leagues, api-event-public**. Each also bundles `customers.ts`; all prospective bundles must use the coordinated P0 helper. `api-admin` does not bundle the changed resolver; existing main already preserves explicit canonical selection and validates canonical session type. It requires no backend hotfix deployment. `api-stripe-webhook` bundles the P0 helper but does not bundle activity pricing; it requires no pricing hotfix deployment.

The generic release planner reports ten browser consumers for the combined pricing + P0 shared diff. That is a dependency map, not authorization to redeploy them all. The P0 pair is already live and must remain untouched; additional P0-only consumers require a separate deliberate decision if automation would deploy them. Do not deploy older main closures.

Schedule overlap is **AdminSchedule.tsx and production-readiness.md** at the file level, plus api-admin/api-commerce/api-bookings as shared operational consumers. Its older fork substitutes `productKeyForActivityTicket(sessionType)`, rejects custom keys such as Studentpris, removes main's canonical product validation/filtering, and adds occurrence/schedule changes. None was imported. Future schedule integration must retain this hotfix and current canonical product validation. The schedule migration `20260919120000_exact_activity_occurrence_invariant.sql` also collides in version with main's applied commerce migration; it is outside this release.

Storefront `200b5fe` overlaps through Stage's api-commerce consumer and api-admin product catalog; neither branch nor migration was imported. Native/security candidates overlap P0 shared customer consumers but were not imported. MCP and architecture candidates were untouched.

### Actual public offer and pricing evidence

Read-only production configuration for activity **`061c579b-8e4a-4dde-95e4-0528a65b9d0b`**, venue `7ff6e5dc-f27a-473b-af4e-2b358340ab81`:

- Name `STUDENT TUESDAYS 🎓`; recurrence Tuesday; classification `open_play`.
- Selected product `studentpris`, product name Studentpris, canonical `session_ticket`, product session type `open_play`, base/session/online price **59 SEK**; separate desk price 79 SEK.
- Canonical policy `allows_day_access: false`, `includes_day_access: false`, `member_benefit_key: null`, `sold_as: activity_ticket`.
- Legacy metadata has online/desk/channel values and no explicit membership-included field. The live resolver defaults that field to true.
- The 2026-09-29 anonymous activity preview returned selected `studentpris`, base/final **59 SEK**, `regular_price`, `day_pass_included: false`, but **`membership_included: true`**. This is pre-release evidence of the live defect, not a claim that member pricing is corrected in production.
- A read-only query across **all** venue tiers found **zero Studentpris product pricing rules**. Active Play has a 40% normal `open_play_slot` rule; the only other normal rule belongs to an inactive Stripe test tier. No customer membership rows were inspected.

| Category | Local authoritative resolver + customer-label regression | Real production after-release verification |
| --- | --- | --- |
| Non-member | 59 SEK; paid checkout; no inclusion label | Not released; current anonymous preview independently returns 59 SEK |
| Play | 59 SEK; paid checkout; no inclusion label | Pending |
| Play+ | 59 SEK despite positive unlimited entitlement; paid checkout | Pending |
| Founder | 59 SEK despite unlimited + day-access rights; paid checkout | Pending |
| Explicit Studentpris product rule | Fixture 49 SEK respected by resolver and customer label | No such production rule found |

Normal Open Play regression: canonical `open_play_slot`, explicit Day/Unlimited ON, stale legacy OFF metadata -> Play+ **0 SEK**, day-access **0 SEK**, Play **99 SEK** on a 165 SEK session with 40% rule. Read-only normal production sessions retain `allows_day_access: true` and `member_benefit_key: open_play_unlimited`. No global entitlement disabling was introduced. Live authenticated inverse verification is pending.

The Admin save/reload portion uses source contracts plus a reloaded fixture; no real Stage Admin mutation was performed. Commerce source contract verifies server pricing derives from the scope resolver's `finalAmountSek`. A real cart and Stripe test Checkout lifecycle was **not** performed.

### Validation and remaining gates

- Installed the unchanged lockfile with `npm ci` in the isolated checkout: Supabase SDK/auth **2.110.9**, TypeScript **5.8.3**. Initial reused dependencies were SDK/auth 2.98.0 and caused one unrelated auth SDK test failure; this was resolved by using the locked dependencies, without code/dependency changes.
- `npm run prod:check`: **PASS**, 157 test files / **1,120 tests**, Edge browser contract, production build/public-web validation, PWA release identity all pass; generated build identity `fbf13803` at `2026-09-26T09:41:25.086Z`.
- Focused pricing/Commerce/P0 run: **PASS**, 21 files / **131 tests**; includes four-category hotfix, rule exception, inverse normal Open Play, customer membership recovery, desk order operability, Commerce pricing/checkout tests.
- `tsc -b --pretty false`: **nonzero**, **532 diagnostics**, byte-normalized diagnostic set exactly equal to fresh main with the same locked dependencies; **zero introduced diagnostics**. This is not a clean TypeScript pass. Earlier 500-diagnostic comparison used the reused older SDK and is superseded.
- `git diff --check`: PASS. Ops Agent deploy check: required docs/scripts present and checkout clean after removing only this task's generated build info. Its printed live deployment checklist remains unfulfilled.
- Required real Stage Admin save/reload, authenticated previews, cart, real Stripe test-mode amount/lifecycle, P0 DB/API E2E, live CORS after deployment, production member matrix, and post-deploy logs/observation window are **pending**, not claimed passed.
- No production mutation, real charge, synthetic production purchase, customer message, migration, or bulk Edge deployment. Temporary ignored dependencies/build output were removed after validation to recover disk space; logs remain in the evidence directory.

### Frontend routing and preserved environments

| Project | Internal ID | Current production target | Current SHA | Alias / main behavior |
| --- | --- | --- | --- | --- |
| Customer production | `prj_ZXHb62NWhYVlIrj2yaEZekIxgJVV` | `dpl_CUCk49qUoccrnn3qkm4kF6Br6uUm` | `567581097d97a8631fc95c2770bffdcbba6effd9` | playpickla.com; main auto-build/assign ON |
| Shared Stage | `prj_UpeWrQfUsTKcYETcIy08PmzeCP1s` | `dpl_BBjGz3Ht4D1PS2bA9ZhMLCu3c41D` | `200b5fe15cbb4174c6a44ef0250e1d55b12e745f` | stage.playpickla.com; main auto-build/assign ON; Storefront preserved |
| Mail | `prj_c9wdkbsstp9Qgx9C8Xf4JIySVrJ6` | `dpl_BMWV4ihZ3CWfAVqBjgosPVU3wuY8` | `567581097d97a8631fc95c2770bffdcbba6effd9` | pickla-mail-v1-edde736.vercel.app; main auto-build/assign ON |

Production and Stage dynamic `/api/release` reads correlate the requested IDs and agree with Vercel management target metadata. Mail identity is management metadata; direct deployment release URLs redirect to Vercel authentication, not application JSON. `mail.playpickla.com` does not resolve and is not configured as a mail project domain. Do not treat a protected 200 login HTML response as a served release identity. No Stage or mail promotion occurred.

Production migration ledger remains **62** versions, latest `20260922120000_cancellation_policy_v1`; Stage remains **63**, adds only Storefront `20260923120000`. **No migration is part of or applied by this hotfix.** Canonical sorted JSON version/name digest: production `08e939edd416c24055399274f085b0e6a72c6a577a21b96ac697adb80a7b5b4d`; Stage `fdc56e110907767526990510b6fe30e023a014dcbba03208ba2acc4f7619385d`. Read-only SELECTs confirmed ledgers; no archived migration was replayed or ledger marked.

### Current Edge inventories and complete first-party source manifests

Fresh downloads used separate directories for each function/environment. All listed functions are ACTIVE with JWT verification disabled. Source-manifest digest format is the same as historical Appendix B: sorted UTF-8 `<file hash><two spaces><repo-relative path><LF>`. Third-party URL dependencies were not independently rebuilt by this audit.

| Environment | Function | Version | Bundle SHA-256 | Downloaded source identity |
| --- | --- | --- | --- | --- |
| prod | `api-admin` | 83 | `dd1885ba401dd75a65706048bcae438514c3a564c14f9959e31a79045d0209ba` | origin/main / bd7058d; 16 files; manifest `f7ebb2a553bb577625938fa9112cc7e3c59a0da496056f2967ce4ade41828bf2` |
| prod | `api-bookings` | 86 | `409718e2718e2b7ea1a36ba205b29b73cbd56a5ec5ee88b56c829bbd3d532401` | origin/main / 200b5fe; 27 files; manifest `13b22e6ed0ac5b9b638466e8ccf6bc17911e39bddbe234f2a0ad0c52d0044ec8` |
| prod | `api-commerce` | 43 | `422370b349d67082a6884bca9abf25da9f507bd61b058c3e21f8e37281eea1f6` | origin/main; 22 files; manifest `0789977087950db1c647bc4f2ba7bf86b870658b63ba29f53b8fb2e1b0ab5a30` |
| prod | `api-courses` | 27 | `9f83860a43926c86ff1a397848445de2205ead7b87efa6bdc11afb0870e7b376` | See differences below; 12 files; manifest `3689862cc0ef2fca95261747323bc7670830dfeaff8cc7bc36b39a851abe6fa0` |
| prod | `api-customers` | 39 | `f76e0ca0cc201e1aa0dc7743787b7243973b72abb0490218c752f237001c60e9` | bd7058d; 6 files; manifest `6bcec507fcfa1e446219acfd4cc839272b86d33839704bb53ee27ebc5a43325a` |
| prod | `api-event-public` | 73 | `cddd73b168a9d7a62dfac0cbac58e4116249f22606f34db1cdb4ab6909821c70` | origin/main / 200b5fe; 22 files; manifest `e8434ab9fa0b892effd98214123143db8e765804142161b7ebb91423d12dfbec` |
| prod | `api-leagues` | 16 | `66de5c7646eee4038eba8ee85da498ed433156fd29b820e84f9de02ec8b30b2a` | See differences below; 11 files; manifest `746f5a8248fad2a371060dc0d813083c37fb31686ff8fb96d014fa9c4fece151` |
| prod | `api-memberships` | 28 | `c0926dffb61b43c4062ab1ba1b1bdb864618cbefab3d1fee4884aec5b522a94a` | bd7058d; 6 files; manifest `39c7e90a5bf9585cc38c462eedc61ffaeb6fd1f997b8fb450f7cd934770f5443` |
| prod | `api-stripe-webhook` | 52 | `81f8ce7424f7db30fb7644f87a9123fe6f49580c466a98b04ec0ba83e8f17d4a` | origin/main / 200b5fe; 16 files; manifest `7be26a974ce87d747c2d18cedb55e6780d280fff3702abec9057e022cd19e4d0` |
| stage | `api-admin` | 91 | `1393260c90a339b8e0bce02498f82339bb129b1ce45f8b903c6feaca5608457e` | 200b5fe; 16 files; manifest `f5d3518947b68fe439aca9ec63f1c8ba63b0446ef8cc44d84644957b5f6552a0` |
| stage | `api-bookings` | 92 | `9000ddced48d68ac1e0ef984eb2d6a1eae088b6f3bad35c6c2aba81743ca4f9d` | See differences below; 26 files; manifest `0c2c8a75fbf3293c968ccbb6effd365ea374b40aa686779698dc3a8f6f87f585` |
| stage | `api-commerce` | 56 | `4b3d7a494c6aea8b0f654508d5cc6bb00064b222fb8c7efc34a46d6ccc4f311b` | 200b5fe; 24 files; manifest `5fa4d192699249c17329f926ce6aa68906bd5c6907e0422aedff312bdfeb41a2` |
| stage | `api-courses` | 32 | `9f83860a43926c86ff1a397848445de2205ead7b87efa6bdc11afb0870e7b376` | See differences below; 12 files; manifest `3689862cc0ef2fca95261747323bc7670830dfeaff8cc7bc36b39a851abe6fa0` |
| stage | `api-customers` | 42 | `c326ee4f6154abd6ccccc1d5964a1a1e10fe02a2c57f64fb1fba4cea580d5155` | origin/main / 200b5fe; 5 files; manifest `6f35f90e1ad433b495a2b39972765d6b066ac22f582e7d55beb729b7a918a1df` |
| stage | `api-event-public` | 77 | `188c4168d4113d926012f76b8c207a8eb70520331adaf6891319e581f97e6301` | See differences below; 22 files; manifest `f353ac8b790d90d8d561c10a6923de3ac24230837a5a8308fc4d83b89d8ce858` |
| stage | `api-leagues` | 21 | `66de5c7646eee4038eba8ee85da498ed433156fd29b820e84f9de02ec8b30b2a` | See differences below; 11 files; manifest `746f5a8248fad2a371060dc0d813083c37fb31686ff8fb96d014fa9c4fece151` |
| stage | `api-memberships` | 30 | `48c5c7e6c83b44802c97a6ab40109a40b66f20e3e4547fb21e817bff880f843b` | See differences below; 6 files; manifest `b951b89eb77cef00a49eef26b23acbe946dd300d18f05565692889995378910f` |
| stage | `api-stripe-webhook` | 58 | `119cb5f0364946c8d491bd90b14ad9be0e04869a4e4ff8b5af96f36368f348b1` | See differences below; 16 files; manifest `9c4b6f341e3ba43d086436cf5144dc4968f580b101f6b13a2ccce12467f7fd90` |

Production courses/leagues differ from main only because live `cors.ts` lacks the unused `htmlResponse` helper; existing CORS headers agree. Stage admin/commerce exactly match Storefront. Stage event-public differs from main in older `canonical_origin.ts`, `commerce_availability.ts`, and `cors.ts`; Stage bookings/webhook/memberships retain the prior recorded cancellation/helper differences. Thus shared Stage is not a uniform deployment of its frontend SHA and cannot certify this candidate's backend.

### Recovery and next release sequence

- Frontend recovery: current customer production deployment `dpl_CUCk49qUoccrnn3qkm4kF6Br6uUm` / SHA `5675810…`; leave the exact Stage and mail targets above intact.
- Pricing Edge recovery: published **`bd7058d6cc7dece988308148446ee9d30d51f1e0`** / equivalent coordinated pre-hotfix `5d8ed56…`, with complete dependency closures. This retains P0 `customers.ts`. For courses/leagues its unused HTML helper differs from current live source; retain the downloaded live closure plus P0 customer helper if exact recovery parity is required. Do not use pre-P0 main for recovery bundles.
- P0 pair recovery: preserve current production **api-customers v39 / api-memberships v28**, exact complete P0 source above. **v38/v27 are forbidden recovery targets**.
- After approved routing isolation and verified Supabase automation, use an isolated Stage/test deployment that preserves shared Storefront; record frontend/backend identities and run synthetic save/reload, four-category/cart, explicit-rule and inverse tests, and real Stripe test lifecycle. Do not use production Stripe secrets or copy production customer identities.
- Re-fetch main and exact final candidate; review PR diff; merge via canonical PR workflow with expected head protection. Deploy only five pricing consumers from coordinated source, unless a separately reviewed automation/P0 impact decision requires more; no migrations. Observe all deployment and alias assignments, then read-only production matrix and a stated checkout-error observation window before declaring RELEASED.

Existing worktrees, the original hotfix, Storefront/MCP/native/schedule candidates, and real customer data remain untouched. Current main/frontend match proves frontend parity only; separate Edge identities above prove the actual baseline. No post-release observation window exists because no release occurred.

## Historical 2026-09-23 snapshot (superseded by the section above)

Remote baseline captured: **2026-09-23 from 19:34 UTC (21:34 CEST)**; canonical GitHub branch refs rechecked at **19:37 UTC**. Local source and documentation analysis continued afterward. This is a point-in-time register, not an environment lock.

Prepared on `codex/release-coordination-verified-20260923`, in a clean isolated worktree based on verified remote `main` **`567581097d97a8631fc95c2770bffdcbba6effd9`**. Only this coordination document is committed. The earlier local register at `4a113d79d0978aac0c88550208f6ab6df52ccdba` was consulted, then independently rechecked; its branch and missing registered worktree were left untouched. This document supersedes that snapshot, including its incomplete Edge dependency map and clean-worktree claims.

## Decision and one next action

**The deployed P0 correction is still missing from canonical GitHub `main`.** Production `api-customers` v39 and `api-memberships` v28 match candidate **`bd7058d6cc7dece988308148446ee9d30d51f1e0`** byte-for-byte across their entrypoints and complete downloaded local dependency closures (six files each). Deploying either function from current `main` would remove its correction. Matching frontend and `main` SHAs do not establish Edge source identity.

**One next action:** in a separately authorized Git publication task, publish exact `bd7058d6cc7dece988308148446ee9d30d51f1e0` to `guggeuber/pickla-flow-1b995a61` as `codex/p0-restore-customer-membership-functions-20260923` and open a narrow PR to `main`. **No redeployment or customer-data correction belongs in that action.** Repository preservation requires this PR and subsequent reviewed integration; it is not a no-op. No source reconciliation against current `main` is needed before opening the PR because the candidate is directly based on that exact main and its runtime source matches production.

The P0 checkout's `origin` is a **local temporary repository**, not GitHub. Its tracking status (`ahead 3`) is not evidence of canonical publication. The canonical main repository does not currently contain the P0 commit object. The publishing task must verify the canonical destination and transfer the exact candidate from its separate local repository; do not blindly run `git push origin` in that checkout.

Alma's legitimate membership and venue link must be preserved. This audit did not query, cancel, restore, merge, or otherwise change any customer record. There is no customer-data repair step in this release plan.

## Verified frontend and Git baseline

| Surface | Verified identity | Evidence |
| --- | --- | --- |
| Canonical GitHub `main` | `567581097d97a8631fc95c2770bffdcbba6effd9` | Fresh `git ls-remote` against `https://github.com/guggeuber/pickla-flow-1b995a61.git`; existing local object and `origin/main` agree. Commit: `feat(admin): add canonical activity ticket products`. No fetch, pull, main update, or push was necessary. |
| Customer production | Project slug `pickla-flow-1b995a61`; alias `playpickla.com`; deployment **`dpl_CUCk49qUoccrnn3qkm4kF6Br6uUm`**; served SHA **`567581097d97a8631fc95c2770bffdcbba6effd9`**; built `2026-09-22T20:38:12.092Z` | Correlated `GET /api/release?request_id=<unique-id>` returned 200, echoed the ID, `Age: 0`, `x-vercel-cache: MISS`, and private/no-store. Deployment URL: `pickla-flow-1b995a61-d0cj33isg-gunnar-picklaats-projects.vercel.app`. Served main JS embeds only production Supabase ref `ptnvhbniiiapzbyofctg`. |
| Shared Stage | Project slug `pickla-stage`; alias `stage.playpickla.com`; deployment **`dpl_BBjGz3Ht4D1PS2bA9ZhMLCu3c41D`**; served SHA **`200b5fe15cbb4174c6a44ef0250e1d55b12e745f`**; built `2026-09-23T03:26:32.873Z` | Same successful no-store/correlation checks. Deployment URL: `pickla-stage-miby09xt7-gunnar-picklaats-projects.vercel.app`. Served main JS embeds only Stage Supabase ref `anpxxnpevtxhiajxmfji`. |

Stage's release payload says `environment: production`: this is the Vercel Production channel of **the Stage project**, not customer production. The project slugs above are derived from the release payload's deployment URLs. Authenticated Vercel project and exact-deployment GET requests returned **403 `forbidden` / `Not authorized`**. Vercel internal project IDs and independent management-API alias ownership could therefore not be verified; do not overstate that evidence.

Served main JS evidence:

| Alias | Asset | SHA-256 |
| --- | --- | --- |
| `playpickla.com` | `/assets/main-xikNKLe3.js` | `7c08dac4b8435951f308fd640dff9a5cbdcf3fcac8f69be6b179ecdda864336f` |
| `stage.playpickla.com` | `/assets/main-pxu_9qem.js` | `190577026be905b0089a375ca239211c0fed2fa36f034c2980264246ba41339a` |

## Supabase identities and migration ledgers

| Environment | Read-only branch metadata | Applied ledger |
| --- | --- | --- |
| Production `ptnvhbniiiapzbyofctg` | Default `main`; branch ID `e67e5c4a-6917-4416-bd35-a110a4fdd5bf`; `FUNCTIONS_DEPLOYED`; project `ACTIVE_HEALTHY` | **62 unique versions**; latest `20260922120000_cancellation_policy_v1`. None of `20260923120000`, `20260923130000`, `20260923140000` is present. |
| Shared Stage `anpxxnpevtxhiajxmfji` | Persistent `stage`; parent `ptnvhbniiiapzbyofctg`; branch ID `45ea5379-d33b-49ca-8424-6523f8d7a61c`; **`MIGRATIONS_FAILED`**; project `ACTIVE_HEALTHY` | **63 unique versions**; latest `20260923120000_storefront_v1_product_presentation`. MCP `20260923130000` and native `20260923140000` are absent. |

Both ledgers were read with `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version` via the Management API. No application table was queried. Stage adds only the Storefront version; the common `20260301000000` row has name `extensions` in production and `production_schema_baseline` in Stage. Equal versions do not prove equal migration SQL or live schema; migration statement checksums and live RLS definitions were not compared.

Stage's branch-status `updated_at` is `2026-09-20T11:04:18.465722Z`, earlier than this Storefront deployment. The current failed status is real metadata, but **this evidence does not establish that Storefront caused it**. Resolve whether it is stale orchestration state or an actionable migration failure before any new shared-Stage mutation. The applied Storefront ledger entry alone does not clear the status.

**Operator context supplied during this audit:** Stage was not built by running every migration from the beginning; the user identifies this as a likely explanation for the failed status. This is a plausible historical cause, not a verified missing-migration diagnosis. Fresh comparison finds **all 62 active migration versions on current main present in both remote ledgers**; Stage also has Storefront's version. The repository deliberately archives 114 older migrations and replaces their schema history with the canonical baseline. [production-baseline.md](../database/production-baseline.md) explicitly explains why production's `extensions` ledger name and Stage's `production_schema_baseline` name share version `20260301000000`. That naming difference is expected under its documented strategy, not itself evidence of drift. Do not replay archived migrations or bulk mark history to clear the status. The outstanding check is the failed branch-operation details and actual schema/baseline contract, not an assumption that every legacy file is missing.

The complete version/name ledger and deterministic digests are preserved in Appendix B, so this register does not depend on temporary CLI output.

## Deployed Edge source provenance

Read-only `functions list` and `functions download <name> --project-ref <explicit-ref> --use-api` succeeded for all **14** environment/function pairs below. Each download used a separate scratch directory to avoid overwriting a different function's bundled `_shared` files. All listed functions are `ACTIVE` and `verify_jwt=false`.

“Exact” means byte equality against the named Git commit for every returned first-party source file, with recursive relative-import traversal finding **zero missing local dependencies**. The source API did not return vendored third-party module contents; external import specifiers were inspected, not independently rebuilt. The Supabase bundle hash identifies the deployed artifact; it is distinct from the source-manifest digest. Neither proves which operator/worktree originally deployed it.

| Environment | Function | Version | Supabase bundle SHA-256 (`ezbr_sha256`) | Source result |
| --- | --- | --- | --- | --- |
| production | `api-customers` | 39 | `f76e0ca0cc201e1aa0dc7743787b7243973b72abb0490218c752f237001c60e9` | Exact **P0 `bd7058d`**, 6/6 files; differs from main. |
| production | `api-memberships` | 28 | `c0926dffb61b43c4062ab1ba1b1bdb864618cbefab3d1fee4884aec5b522a94a` | Exact **P0 `bd7058d`**, 6/6 files; differs from main. |
| production | `api-bookings` | 86 | `409718e2718e2b7ea1a36ba205b29b73cbd56a5ec5ee88b56c829bbd3d532401` | Exact main and cancellation-forward `a865fcd`, 27/27 files; pre-P0 customer helper. |
| production | `api-stripe-webhook` | 52 | `81f8ce7424f7db30fb7644f87a9123fe6f49580c466a98b04ec0ba83e8f17d4a` | Exact main and cancellation-forward `a865fcd`, 16/16 files; pre-P0 customer helper. |
| production | `api-notifications` | 22 | `90351b30ea93537c21d7ce6d0489b63a466f224e3a768111e2b112e4be614927` | Entrypoint equals main; older `cors.ts`; 3 files. Not native security. |
| production | `api-admin` | 83 | `dd1885ba401dd75a65706048bcae438514c3a564c14f9959e31a79045d0209ba` | Exact main, 16/16 files; not Storefront. |
| production | `api-commerce` | 43 | `422370b349d67082a6884bca9abf25da9f507bd61b058c3e21f8e37281eea1f6` | Exact main, 22/22 files; not Storefront; pre-P0 customer helper. |
| stage | `api-customers` | 42 | `c326ee4f6154abd6ccccc1d5964a1a1e10fe02a2c57f64fb1fba4cea580d5155` | Exact main, 5/5 files; P0 absent. |
| stage | `api-memberships` | 30 | `48c5c7e6c83b44802c97a6ab40109a40b66f20e3e4547fb21e817bff880f843b` | 6 files; entrypoint equals initial/forward cancellation; older `cors.ts`; draft-price support and P0 absent. |
| stage | `api-bookings` | 92 | `9000ddced48d68ac1e0ef984eb2d6a1eae088b6f3bad35c6c2aba81743ca4f9d` | Exact initial cancellation `4ed0157`, 26/26 files; not main/native security. |
| stage | `api-stripe-webhook` | 58 | `119cb5f0364946c8d491bd90b14ad9be0e04869a4e4ff8b5af96f36368f348b1` | Exact initial cancellation `4ed0157`, 16/16 files; not main/native security. |
| stage | `api-notifications` | 27 | `90351b30ea93537c21d7ce6d0489b63a466f224e3a768111e2b112e4be614927` | Same bundle and 3 source files as production; not native security. |
| stage | `api-admin` | 91 | `1393260c90a339b8e0bce02498f82339bb129b1ce45f8b903c6feaca5608457e` | Exact Storefront `200b5fe`, 16/16 files. |
| stage | `api-commerce` | 56 | `4b3d7a494c6aea8b0f654508d5cc6bb00064b222fb8c7efc34a46d6ccc4f311b` | Exact Storefront `200b5fe`, 24/24 files; pre-P0 customer helper. |

`api-mcp` is absent from both complete function inventories. Production `api-bookings`/webhook also match cancellation-forward commit `a865fcddf69a91845a7ae09a05ee8ba877535260`, which is already an ancestor of main. Stage's older pair matches `4ed01571b2a60878fb92ae6b28a6e64064402533`, also an ancestor, but omits the later forward-only cutover behavior. Stage is therefore **not a uniform deployment of its frontend commit**.

The only notification dependency difference from main is `_shared/cors.ts` lacking the later `htmlResponse` helper; the CORS headers themselves are unchanged. Stage memberships additionally lacks main's `allowDraftProduct` / `allow_draft_product` support in tier pricing. Neither Stage P0 function contains the P0 correction.

### Exact production-versus-main P0 delta

The two live P0 bundles jointly differ from fresh main in exactly these **four runtime files**; there is **no frontend change and no migration**:

| File under `supabase/functions/` | Added/deleted lines | Exact behavior added or removed relative to main |
| --- | --- | --- |
| `_shared/customer_access.ts` | +49 / −0 | Adds `canListCustomers`: super admin may list globally; otherwise active staff requires the requested venue. Authorization-query errors propagate. Adds `filterVenueEligibleProfiles`, preserving the existing eligible-customer/user filtering as a reusable helper. |
| `api-customers/index.ts` | +9 / −28 | Imports those helpers; removes the old inline guard/filter. Runs list authorization even when `venueId` is absent, closing main's authenticated global-list bypass; uses the same guard for list, metrics, and merge paths. No other main runtime file differs in this function's closure. |
| `_shared/customers.ts` | +63 / −20 | Before a venue link, loads both rows and requires the same organization and an active, unmerged customer. Resolves venue organization before identity lookup, resolves merged IDs to the canonical customer, repairs an existing profile link when that canonical ID differs, and rejects a foreign-organization auth identity. Replaces the unscoped single auth-identity lookup with organization-aware selection. Accepts explicit display/first/last name and phone and uses them before profile/auth fallbacks when creating customer/identity rows. |
| `api-memberships/index.ts` | +18 / −6 | Resolves canonical customer and venue link **before cancelling the existing active membership** in both assignment paths. The create-user path supplies submitted identity fields to that resolver and persists `customer_id` in the profile before replacement. The old cancellation-before-resolution ordering is removed. This is an ordering correction, not a transactional rewrite of all membership writes. |

Functional source first appears in **`a489a65837b0d8c567a026fcdf9005f40652abb9`**. The next three commits through **`bd7058d6cc7dece988308148446ee9d30d51f1e0`** add/refine tests only. The candidate's other three files are `src/test/customerMembershipRecovery.test.ts`, `src/test/deskOrderCustomerOperability.test.ts` (+1/−1), and `supabase/tests/customer_membership_recovery_api_e2e.mjs`. Full seven-file change: **725 insertions, 55 deletions**.

Reproduce the exact patch from a repository containing the P0 candidate with:

```bash
git diff 567581097d97a8631fc95c2770bffdcbba6effd9..bd7058d6cc7dece988308148446ee9d30d51f1e0 -- supabase/functions/
```

This audit reran the two P0 Vitest files: **15/15 tests passed**. These are fixture/source tests; they do not prove live database/Edge behavior. The mutation-bearing Edge/database E2E was not run. No production customer smoke or record inspection was performed.

P0 source hashes below preserve a durable manifest of the complete downloaded closures. Prefix every path with `supabase/functions/`; C = customers bundle, M = memberships bundle. Both bundles import external `https://esm.sh/@supabase/supabase-js@2.110.9` and `https://esm.sh/luxon@3.5.0`.

| Relative file | Bundle | SHA-256 |
| --- | --- | --- |
| `_shared/auth.ts` | C, M | `5e5ac5c080badb652e5ee3195980d83efd995ad2007c2910f639428eaa6a2c37` |
| `_shared/authorization.ts` | C | `064000d254873db2b6de295207b29cba8a6fb37ea5dc61773ba27c5096eaee96` |
| `_shared/bookings.ts` | M | `1f325ca246bb40801c9341b0d221b713152f553c42a1a92262ccef1efb592c78` |
| `_shared/canonical_origin.ts` | C | `15c095d62cd88ace40b970adabaa7121d3652442fd02063c56357c709847a53e` |
| `_shared/cors.ts` | C, M | `8db605036f816474898b47b224bb25e19ef816b2b367a10fc6a84848a3e8e6e4` |
| `_shared/customer_access.ts` | C | `e3c75388ed86083358b4163b3b580ef86900de00ff49b7a9a81778e306a85699` |
| `_shared/customers.ts` | M | `2b28d209ec536f04ab38475ce040e5bfca1d71f2e455ab444419a0f446eabd74` |
| `_shared/pricing_math.ts` | M | `3e424bbea2bfc71d2809e4e15e4b189830b749394599aca514dce8a7454fe600` |
| `api-customers/index.ts` | C | `22750b4a336dd0d7796126e18a3fc3fd267489ca1ed825b7db5957761dd3dcba` |
| `api-memberships/index.ts` | M | `0c41989088ffd3a70a2ddbf8ebc8c8f3bb280aa617e650deec9921630345c3bc` |

## Candidate inventory and handoff status

All six named candidates have verified merge base **`567581097d97a8631fc95c2770bffdcbba6effd9`**. Canonical remote refs were checked directly, not inferred from tracking refs. GitHub PR inventory returned only historical merged PR #1 (`Install Vercel Web Analytics Integration`); **none of these candidates has an open or merged PR**.

| Candidate | Branch and full SHA | Current checkout / Git status | Scope and durable handoff artifact |
| --- | --- | --- | --- |
| P0 | `codex/p0-restore-customer-membership-functions-20260923` — `bd7058d6cc7dece988308148446ee9d30d51f1e0` | Separate local repository, clean. Canonical remote branch absent. Its `origin` points at a temporary local repository. | 7 files; 2 entrypoints and shared `customers.ts`/`customer_access.ts`; no migration. Exact source manifest and patch definition above; E2E source in candidate. |
| Storefront V1 | `codex/storefront-v1-premium` — `200b5fe15cbb4174c6a44ef0250e1d55b12e745f` | Clean existing worktree; canonical remote branch equals exact SHA. | 28 files; frontend, `api-admin`, `api-commerce`, new `commerce_product_pricing.ts`/`storefront_publication.ts`; migration `20260923120000`. Candidate artifact: `docs/storefront-v1-native-mcp-integration.md`. |
| MCP V1 | `codex/pickla-mcp-v1` — `3a4d2544b87e0579456b4f56335a1a39c3d4d114` | Clean existing worktree; local-only. | 28 files; new `api-mcp`, consent route, package/config changes; migration `20260923130000`. Artifacts: `docs/pickla-mcp-v1.md`, `docs/pickla-native-service-contracts.md`. No existing `_shared` runtime file changed. |
| Native V0 security | `codex/native-v0-security-repairs-20260923` — `0d769af42e2b86fc404f40de7b5c4be54c580bbf` | Local commit/branch exists; registered worktree is missing. **Current clean/dirty state unavailable**, not “clean.” | 17 files; booking/webhook identity and price authority, notifications, Hub/membership UI, new security helpers, chat/RLS migration `20260923140000`. Artifact: `docs/native-v0-security-repairs.md`. |
| Native architecture audit | `codex/native-v0-foundation-audit` — `34a58111442bacc0fa2dde5031e2dd415f718d11` | Local-only; registered worktree missing, current cleanliness unavailable. | One document: `docs/architecture/native-v0-foundation-audit.md`. No implementation/migration. |
| Multi-organizer audit | `codex/architecture-multi-organizer-audit` — `0401f4ef7147d8f24e38278341f2768fb5d43312` | Local-only; registered worktree missing, current cleanliness unavailable. | One document: `docs/architecture/multi-organizer-shared-venue-audit.md`. No implementation/migration. |

Candidate artifacts not yet present on main must be read from their specified commit (for example `git show <full-sha>:docs/<artifact>`), not assumed to exist on the current checkout. Storefront's published artifact is also [available on GitHub at its exact commit](https://github.com/guggeuber/pickla-flow-1b995a61/blob/200b5fe15cbb4174c6a44ef0250e1d55b12e745f/docs/storefront-v1-native-mcp-integration.md). Appendix A records every changed file for all six candidates.

| Candidate | Implemented | Tested | Committed | Pushed to canonical GitHub | Stage-deployed | Customer-production-deployed | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | Yes | 15/15 targeted tests rerun here; full gates and isolated E2E still required | Yes | **No** | **No**, current downloaded source lacks it | **Yes**, exact v39/v28 source match | No |
| Storefront | Yes | Prior register reports 46 targeted assertions passed; not rerun here; current Stage source identity verified | Yes | Yes | **Yes**, frontend + v91/v56 + migration | **No**, frontend/source/ledger differ | No |
| MCP | Yes | Prior register reports 30 targeted assertions; candidate describes local transport tests; remote intended-client certification missing | Yes | No | No `api-mcp` or migration | No `api-mcp` or migration | No |
| Native security | Yes | Candidate artifact records local Vitest, 21 DB assertions and isolated Edge/Stripe-double checks; not rerun here | Yes | No | No: 3 downloaded entrypoints differ and migration absent | No: 3 downloaded entrypoints differ and migration absent | No |
| Native audit | Document only | Source/diff inspected; no application build required | Yes | No | N/A | N/A | No |
| Multi-organizer audit | Document only | Source/diff inspected; no application build required | Yes | No | N/A | N/A | No |

MCP remote operation is disabled by default in its candidate configuration and migration. No `api-mcp` deployment or migration exists in the two inspected environments. No claim is made about uninspected third-party projects or secret values.

### Other relevant local state, preserved

- The long-lived root checkout remains on local `main` **`7b52cf2e259ade24c05d714e94d2869f57d3b6d6`**, 140 commits behind verified remote main, with tracked application/Edge/CLI changes and untracked files. It is not a deployment source. Its dirty `_shared/auth.ts`, `customers.ts`, pricing, and webhook files must not be swept into any candidate. Only status/path metadata was inspected for unrelated work.
- P0's second local E2E repository has HEAD **`18cb64d8b4df728c7749af0d0311a1d6d2eadd43`**, the same base as P0, and **exactly the same committed tree** as `bd7058d`: `2b3db4f82c06e3dadf312c2359732e80ce6654f8`. It has dirty `supabase/config.toml` and untracked `supabase/.branches/`. Its three test-commit SHAs differ, but there is no committed file delta. Preserve the clean, named `bd7058d` handoff; do not publish this dirty duplicate or claim its tracking remote is GitHub.
- Cancellation-forward **`a865fcddf69a91845a7ae09a05ee8ba877535260`** and initial cancellation **`4ed01571b2a60878fb92ae6b28a6e64064402533`** are already canonical main ancestors. They explain live function provenance, not separate unmerged feature candidates. Forward is the production bookings/webhook source; initial remains in Stage. The existing detached forward-release worktree at that exact commit is clean; older temporary branch worktrees are missing and were not recreated.
- The old register `4a113d79d0978aac0c88550208f6ab6df52ccdba` remains local-only. Its registered worktree is missing; it was neither removed nor recreated. Historical unrelated worktrees/branches were not certified as release candidates.

## Dependency and conflict map

Changed-file intersection across the six candidates finds only **Storefront ↔ MCP: `src/App.tsx`**. That is textual overlap to review, not proof of an unavoidable merge conflict. A clean textual merge elsewhere does not establish runtime compatibility.

| Relationship | Semantic/shared dependency or migration issue | Required integration decision |
| --- | --- | --- |
| P0 → every later candidate | All start before P0. Shared `customers.ts` changes identity canonicalization and organization/venue link validation. Existing `_shared/auth.ts` is unchanged by all four implementation candidates. | Preserve P0 on main first; recreate/reconcile each candidate on then-fresh main. Recheck shared auth/customer hashes. No broad deployment from any original pre-P0 candidate. |
| P0 → Storefront | `api-commerce` bundles `customers.ts`; current Stage Storefront bundle contains the old helper. New catalog pricing/publication and canonical customer resolution meet in checkout. | A P0-inclusive Storefront candidate needs a new Stage `api-commerce` bundle and identity/pricing/checkout/fulfillment smoke. Do not promote existing Stage artifacts unchanged. |
| P0 → native security | Native changes caller identity, payer/participant selection, price authority, and webhook email-to-user behavior; both bookings and webhook bundle `customers.ts`. | Certify canonical customer/venue linking, forged-identity rejection, membership replacement ordering, guest/participant cases, and webhook fulfillment together after rebase. |
| Storefront ↔ native security | No direct file overlap; both affect money-critical flows and share current commerce/pricing/customer assumptions. | Separate commits/PRs/releases/recovery targets; cross-smoke booking, merchandise, memberships, receipts and fulfillment. |
| Storefront → MCP | `src/App.tsx` overlap. MCP documentation intentionally numbers its migration after Storefront; no actual Storefront API/tool integration is implemented. | Resolve route additions on fresh main. Keep commerce mutations outside MCP. Treat migration chronology separately from a functional dependency. |
| MCP ↔ native security | Unique new migration versions, but MCP `20260923130000` is below native `20260923140000`; MCP is blocked and should not gate security. | If native lands first, renumber the still-unapplied MCP migration above the then-current ledger and update its references/tests in its own future implementation task. No migration was renamed here. |
| RLS/auth surfaces | Storefront publication/media, MCP control/grants, native chat eligibility and fan-out each add distinct policies; no migration-version collision among candidates or current ledger. | Certify each policy surface and old/new client compatibility separately; never infer deployed policy bodies from ledger presence alone. |
| Shared Stage | Frontend is Storefront; customers is main; memberships predates main's draft pricing; bookings/webhook are initial cancellation. Branch metadata reports migration failure. | Before certification, record and explicitly reconcile this mixed baseline under one Stage owner. The current Stage state cannot certify a uniform main/P0/Storefront release. |

### Full P0 shared dependency impact

At the **P0 candidate** the existing `edge:release-plan` reports 10 browser functions: `api-bookings`, `api-checkins`, `api-commerce`, `api-courses`, `api-customers`, `api-day-passes`, `api-entitlements`, `api-event-public`, `api-leagues`, `api-memberships`.

Independent recursive inspection of **all** function entrypoints finds two additional consumers of `customers.ts`: **`api-stripe-webhook` and `api-commerce-recovery`**. The full affected set is therefore **12 functions**. The repository planner intentionally inventories browser calls and is not a complete backend deployment matrix. Running it at old main also misses the newly introduced `customer_access.ts` import; run it from the exact candidate.

This is an impact map, **not authorization to deploy all 12**. Production source downloads directly prove that bookings, commerce and webhook still bundle pre-P0 `customers.ts`; the P0 helper is live in memberships. Customers uses the new separate authorization helper. Other consumers' versions were inventoried, but their source was not downloaded. A later shared-helper rollout must explicitly cover and verify non-browser consumers or document retained bundle skew and compatibility; a browser-only planner pass is insufficient.

## Smallest ordered integration plan

| Order | Candidate / next action | Remaining validation and blocker |
| --- | --- | --- |
| 1 | **P0 preservation PR** for exact `bd7058d`, then reviewed integration into main. No Edge deployment needed to preserve the already-live pair. | Canonical publication is absent. Before merge, record full `npm run prod:check`, applicable lint, P0 unit checks, isolated Edge E2E, and complete dependency impact. Do not replace production code from pre-P0 main. Main integration must account for automatic Vercel production builds. |
| 2 | **Storefront as its own release.** Reconcile onto P0-preserving fresh main, then recertify the exact candidate on Stage before considering production. | Resolve/triage `MIGRATIONS_FAILED`, reconcile Stage P0/other relevant baseline skew, repeat full gates and synthetic Stripe/Commerce/browser smoke. Production lacks `20260923120000`; later authorized rollout must apply that migration, then exact reviewed Edge matrix, then frontend. |
| 3 | **Native security as its own release**, promptly after the preceding baseline is established. | Restore a new clean worktree from the surviving branch without rewriting it; incorporate P0 and any integrated Storefront changes. Follow its committed migration → functions → old-client smoke → new frontend → full smoke → at least 30-minute observation procedure. No Stage/production certification currently exists. |
| 4 | **MCP remains isolated and blocked.** Prepare its own PR/certification only after prerequisites exist. | Separate non-production OAuth project/hostname, asymmetric key, client registration, Auth hook, intended-client refresh/revocation and multi-instance gate testing, security/dependency review; never enable it on shared Storefront Stage. Renumber unapplied migration if native has landed first. |
| Independent | **Two architecture documents**, each as documentation-only review/PR when useful. | Local-only and missing working directories; surviving commits are inspectable. Neither audit proposal is implementation or release authorization. |

The above order preserves the already-applied Stage `...23120000` chronology and keeps MCP from blocking `...23140000`. It is not permission to leave a security release waiting indefinitely for Storefront scope. If Storefront cannot clear its gates promptly, a release owner must make an explicit security-first plan covering the lower unapplied Storefront migration in production and mixed Stage baseline; do not combine all features merely to solve ordering.

Safe recovery must be candidate-specific. For P0, the preservation target is `bd7058d` with the recorded v39/v28 contents; current pre-P0 main is **not** a safe recovery source for those functions. The source/ledger inventory here is not a backup. Native's committed recovery plan explicitly keeps tightened RLS and uses fix-forward migrations; returning to old checkout/webhook code reintroduces its documented security issues and requires incident ownership. Capture verified recovery artifacts before any later mutation.

## Operating process: reuse existing release gates

This register applies [production-readiness.md](../production-readiness.md), [launch-runbook.md](../launch-runbook.md), [staging.md](../staging.md), [smoke-tests.md](../smoke-tests.md), [security-checklist.md](../security-checklist.md), and [observability-and-ops-agent.md](../observability-and-ops-agent.md). It introduces no CI or deployment automation.

1. Each implementation starts in a clean isolated worktree at fresh remote main. Fetch/verify remote main before creating the worktree; do not pull/rebase the dirty long-lived checkout. Keep an exact base SHA and preserve unrelated work.
2. Every handoff states separately: **implemented, tested, committed, pushed, Stage-deployed, production-deployed, merged**. Give test names/results and actual artifacts; tracking refs, frontend identity, and Vercel channel labels cannot stand in for other states.
3. One explicitly named release task owns **mutations to each shared environment** at a time. Implementation tasks can prepare candidates; they do not automatically own Stage or production. Record owner, exact candidate, target and current baseline before mutation.
4. Deploy only an exact committed, verified candidate. Before every deployment recheck target project/ref and alias, current function versions/source, shared dependency closure (including non-browser functions), migration ledger/order and old/new client/API compatibility. If anything changed, re-plan before proceeding.
5. Reuse `npm run prod:check`, applicable targeted lint, `npm run ops:agent -- --mode=deploy`, `edge:release-plan`, its deployment verification, live CORS, PWA/release identity checks, domain smoke and Ops watch as required by the existing runbook. Ops/deployment checks are for a scoped release task; they were not run against production in this read-only audit.
6. Production actions require explicit scoped authorization covering environment, migrations, function matrix, frontend candidate, verification and recovery. A main push/merge can trigger a frontend production build and must be treated accordingly. This task authorizes no such action.
7. A hotfix deployed before repository integration remains an **open follow-up until its code is preserved on canonical main**, even if the customer symptom is fixed. Track publication/PR/merge independently from live deployment.
8. Each Edge release records source commit, target project, function IDs/versions and bundle hashes, bundled local/transitive dependencies and external import versions, verification, and a safe recovery artifact. Do not use frontend SHA as a substitute for Edge provenance.
9. Customer-data corrections and software releases are separate tasks. Support discovery does not authorize a deployment. Software integration does not authorize cancelling or repairing Alma's membership or venue link.

### Existing-instruction contradictions and limits

- The runbook's “pull latest main with rebase” is satisfied for this workflow by verified fresh main plus a clean isolated worktree and later candidate reconciliation. Do not run it against an unrelated dirty working tree.
- [deploy-stage-functions.sh](../../scripts/deploy-stage-functions.sh) deploys a broad hard-coded list, although the Stage/runbook prose says only changed/affected functions. It rejects the production ref but does **not** enforce equality with the canonical Stage ref. Use the reviewed explicit target and dependency matrix; do not invoke this bulk helper for a narrow candidate.
- [edge-release-plan.mjs](../../scripts/edge-release-plan.mjs) / [edge-browser-contract.mjs](../../scripts/edge-browser-contract.mjs) cover browser consumers, not all Edge entrypoints. Add webhook/recovery consumers to the reviewed release record. No planner changes were made here.
- [supabase/config.toml](../../supabase/config.toml) contains `project_id = "qrzkxhnpxtsicqcpzplc"`, different from both verified remote refs. CLI link state can also vary by worktree. Never infer a remote target from either; verify and pass the explicit project ref.
- No tracked `.github` workflows exist at fresh main. Package scripts and runbook gates exist but are **manual**, not evidence of enforced GitHub CI. `prod:check` includes tests, Edge browser contract, build/public-web verification, and PWA verification. Record actual output for each runtime release.
- Migration application instructions conflict: the older launch runbook/AGENTS text defaults to the SQL editor, while [production-baseline.md](../database/production-baseline.md) requires tracked CLI application, with an exact-file, immediately registered SQL-editor exception for emergencies. Use that dedicated baseline discipline in the release plan: reviewed forward file, rehearsal, reviewed dry-run, backup gate, tracked application and invariant checks. Do not treat manual SQL or a schema-reload notification as proof that migration history was recorded. The baseline document's “twelve active files” is its August snapshot; fresh main now has 62. No migration procedure was executed here.
- Main auto-deploys the frontend. “No Edge deployment needed for P0 preservation” does not mean a future main merge has no remote effect. Publication/PR is the immediate next action; integration and its frontend consequence belong to the later authorized release decision.

## Explicit evidence gaps

- Authenticated Vercel metadata is blocked by 403; project slugs and alias/deployment identities come from current correlated application release payloads, not independently verified Vercel internal IDs.
- Download comparisons establish first-party content equivalence, not the deployer's Git SHA or vendored third-party byte identity. The 14 relevant pairs were downloaded; all remaining functions were inventoried only.
- Migration ledgers are complete version/name snapshots, not schema/RLS checksums. Stage's reported migration-failure cause remains unresolved.
- No current authenticated browser/Stripe, physical-device, production customer, or database-write smoke was performed. Only the 15 P0 unit/source tests were rerun here; other candidates' test claims are attributed to their existing artifacts, not presented as fresh results.
- Native/security/audit working directories are missing, so their former uncommitted state cannot be recovered or certified by this audit. Their Git commits survive. P0's clean canonical candidate and dirty duplicate must remain distinct.
- Current Stage is a mixed backend baseline. MCP remote readiness is blocked. No concurrent environment mutation lock was acquired; recheck this snapshot immediately before any future release.

## Mutation confirmation

**No remote environment or customer data was changed.** Remote operations were read-only Git/PR metadata, Vercel/public frontend reads, Supabase function inventory/source downloads, branch metadata and migration-ledger SELECTs. No deploy, migration, configuration/secret edit, customer read/write, push, merge, reset, branch rewrite or cleanup of another worktree was performed. Local committed change: this document only. Existing checkout changes were preserved.

## Appendix A: exact candidate changed-file manifests

Each manifest is `git diff --name-status <verified-base>..<candidate-full-sha>`. `A` means added, `M` modified. These are committed deltas; dirty checkout files are separately described above.

<details><summary>P0: bd7058d6cc7dece988308148446ee9d30d51f1e0</summary>

Base: `567581097d97a8631fc95c2770bffdcbba6effd9`; 4 commit(s) above base.

```text
A	src/test/customerMembershipRecovery.test.ts
M	src/test/deskOrderCustomerOperability.test.ts
A	supabase/functions/_shared/customer_access.ts
M	supabase/functions/_shared/customers.ts
M	supabase/functions/api-customers/index.ts
M	supabase/functions/api-memberships/index.ts
A	supabase/tests/customer_membership_recovery_api_e2e.mjs
```

</details>

<details><summary>Storefront: 200b5fe15cbb4174c6a44ef0250e1d55b12e745f</summary>

Base: `567581097d97a8631fc95c2770bffdcbba6effd9`; 5 commit(s) above base.

```text
A	docs/storefront-v1-native-mcp-integration.md
M	scripts/test-commerce-r2a-db.sh
M	src/App.tsx
M	src/components/admin/commerce/AdminCommerceWorkspace.tsx
M	src/components/admin/commerce/ProductMediaEditor.tsx
A	src/components/admin/commerce/StorefrontPresentationEditor.tsx
A	src/components/storefront/ProductGallery.tsx
A	src/components/storefront/StorefrontCartDrawer.tsx
M	src/hooks/useStandaloneShopCart.ts
M	src/lib/adminCommerce.ts
M	src/lib/api.ts
M	src/lib/commerce.ts
A	src/lib/storefront.ts
M	src/pages/CommerceCartPage.tsx
A	src/pages/CommerceProductPage.tsx
M	src/pages/CommerceShopPage.tsx
M	src/test/commerceShopPage.test.tsx
M	src/test/productMediaV2.test.ts
M	src/test/programPurchaseSessionUi.test.tsx
A	src/test/storefrontPublicationSecurity.test.ts
A	src/test/storefrontV1.test.ts
A	src/test/storefrontV1Contracts.test.ts
A	supabase/functions/_shared/commerce_product_pricing.ts
A	supabase/functions/_shared/storefront_publication.ts
M	supabase/functions/api-admin/index.ts
M	supabase/functions/api-commerce/index.ts
A	supabase/migrations/20260923120000_storefront_v1_product_presentation.sql
A	supabase/tests/storefront_v1.sql
```

</details>

<details><summary>MCP: 3a4d2544b87e0579456b4f56335a1a39c3d4d114</summary>

Base: `567581097d97a8631fc95c2770bffdcbba6effd9`; 3 commit(s) above base.

```text
A	docs/pickla-mcp-v1.md
A	docs/pickla-native-service-contracts.md
M	package-lock.json
M	package.json
A	scripts/mint-pickla-mcp-token.mjs
A	scripts/smoke-pickla-mcp-openai.mjs
A	scripts/smoke-pickla-mcp.mjs
M	src/App.tsx
A	src/pages/OAuthConsent.tsx
A	src/test/picklaMcpTransport.test.ts
A	src/test/picklaMcpV1.test.ts
M	src/test/setup.ts
M	supabase/config.toml
A	supabase/functions/api-mcp/adapter.ts
A	supabase/functions/api-mcp/audit.ts
A	supabase/functions/api-mcp/auth.ts
A	supabase/functions/api-mcp/config.ts
A	supabase/functions/api-mcp/date.ts
A	supabase/functions/api-mcp/deno.json
A	supabase/functions/api-mcp/finance.ts
A	supabase/functions/api-mcp/index.ts
A	supabase/functions/api-mcp/oauth.ts
A	supabase/functions/api-mcp/pagination.ts
A	supabase/functions/api-mcp/runtime.ts
A	supabase/functions/api-mcp/schemas.ts
A	supabase/functions/api-mcp/tools.ts
A	supabase/functions/api-mcp/types.ts
A	supabase/migrations/20260923130000_pickla_mcp_remote_control.sql
```

</details>

<details><summary>Native security: 0d769af42e2b86fc404f40de7b5c4be54c580bbf</summary>

Base: `567581097d97a8631fc95c2770bffdcbba6effd9`; 1 commit(s) above base.

```text
A	docs/native-v0-security-repairs.md
M	docs/production-readiness.md
A	scripts/test-native-v0-security-db.sh
M	src/lib/bookingGroups.ts
M	src/pages/HubPage.tsx
M	src/pages/MembershipPage.tsx
A	src/test/nativeV0SecurityRepairs.test.ts
A	supabase/functions/_shared/booking_checkout_security.ts
A	supabase/functions/_shared/notification_security.ts
M	supabase/functions/api-bookings/index.ts
M	supabase/functions/api-notifications/index.ts
M	supabase/functions/api-stripe-webhook/index.ts
A	supabase/migrations/20260923140000_native_v0_security_repairs.sql
A	supabase/tests/native_v0_checkout_e2e.mjs
A	supabase/tests/native_v0_checkout_fixture.sql
A	supabase/tests/native_v0_checkout_test_gateway.mjs
A	supabase/tests/native_v0_security_repairs.sql
```

</details>

<details><summary>Native architecture: 34a58111442bacc0fa2dde5031e2dd415f718d11</summary>

Base: `567581097d97a8631fc95c2770bffdcbba6effd9`; 1 commit(s) above base.

```text
A	docs/architecture/native-v0-foundation-audit.md
```

</details>

<details><summary>Multi-organizer architecture: 0401f4ef7147d8f24e38278341f2768fb5d43312</summary>

Base: `567581097d97a8631fc95c2770bffdcbba6effd9`; 1 commit(s) above base.

```text
A	docs/architecture/multi-organizer-shared-venue-audit.md
```

</details>


## Appendix B: complete migration ledger and source manifest digests

Ledger SHA-256 input is UTF-8 lines `version<TAB>name<LF>` sorted by version. Production: **`379ac8073105e3aa32129181230e03332f27cedb4748173ec1423ad393653ba7`**. Stage: **`68588bc682aeb8ab9a7536d8590a87b80e48b48d9ee097eccc0ab94c1ca4eb84`**.

<details><summary>62 production rows / 63 Stage rows</summary>

| Version | Production name | Stage name |
| --- | --- | --- |
| `20260301000000` | extensions | production_schema_baseline |
| `20260703120000` | lock_down_player_profiles | lock_down_player_profiles |
| `20260703121000` | stripe_events_idempotency | stripe_events_idempotency |
| `20260703123000` | repair_auth_user_identity_chain_safe | repair_auth_user_identity_chain_safe |
| `20260703124000` | subscription_invoice_receipts | subscription_invoice_receipts |
| `20260716120000` | repair_active_personal_data_exposure | repair_active_personal_data_exposure |
| `20260716121000` | repair_dormant_token_privilege_exposure | repair_dormant_token_privilege_exposure |
| `20260727120000` | activity_sessions_end_at_midnight | activity_sessions_end_at_midnight |
| `20260728170000` | restore_event_logo_storage | restore_event_logo_storage |
| `20260728180000` | restore_private_event_offer_storage | restore_private_event_offer_storage |
| `20260728190000` | commerce_r1_activity_drafts | commerce_r1_activity_drafts |
| `20260728200000` | commerce_r1b_account_later | commerce_r1b_account_later |
| `20260731100000` | atomic_activity_pricing_holds | atomic_activity_pricing_holds |
| `20260731110000` | commerce_day_pass_orders | commerce_day_pass_orders |
| `20260803120000` | commerce_r1b_standalone_shop_carts | commerce_r1b_standalone_shop_carts |
| `20260806120000` | converge_canonical_entitlements | converge_canonical_entitlements |
| `20260806130000` | entitlement_consumption_contracts | entitlement_consumption_contracts |
| `20260806140000` | partner_and_punch_card_readiness | partner_and_punch_card_readiness |
| `20260808120000` | entitlement_constitution_v11 | entitlement_constitution_v11 |
| `20260809120000` | bruce_partner_program_operations | bruce_partner_program_operations |
| `20260810120000` | bruce_v1_manual_operations | bruce_v1_manual_operations |
| `20260810130000` | operations_week_staffing | operations_week_staffing |
| `20260811120000` | booking_participation_pay_first | booking_participation_pay_first |
| `20260813120000` | course_series_commitments | course_series_commitments |
| `20260813130000` | course_resource_conflict_guard | course_resource_conflict_guard |
| `20260813140000` | course_operator_content_draft_edit | course_operator_content_draft_edit |
| `20260815120000` | navigation_discovery_event_identity | navigation_discovery_event_identity |
| `20260816120000` | first_visit_offer_once | first_visit_offer_once |
| `20260820120000` | series_presentation_types | series_presentation_types |
| `20260820130000` | series_schedule_write_boundary | series_schedule_write_boundary |
| `20260822120000` | series_house_comp_staff_grants | series_house_comp_staff_grants |
| `20260823120000` | series_member_pricing_guardrails | series_member_pricing_guardrails |
| `20260824120000` | series_early_bird | series_early_bird |
| `20260825120000` | managed_series_admin_edit | managed_series_admin_edit |
| `20260826120000` | series_open_play_benefit | series_open_play_benefit |
| `20260827120000` | league_v1_domain | league_v1_domain |
| `20260827121000` | league_v1_commerce | league_v1_commerce |
| `20260827122000` | league_v1_play | league_v1_play |
| `20260827123000` | league_v1_security_boundary | league_v1_security_boundary |
| `20260827124000` | league_catalog_edit_v1 | league_catalog_edit_v1 |
| `20260827125000` | catalog_dynamic_member_prices | catalog_dynamic_member_prices |
| `20260827126000` | league_traditional_sideout_scoring | league_traditional_sideout_scoring |
| `20260829120000` | public_customer_course_cards | public_customer_course_cards |
| `20260830120000` | public_customer_today_secondary_facts | public_customer_today_secondary_facts |
| `20260831120000` | public_customer_prices_facts | public_customer_prices_facts |
| `20260831130000` | public_customer_prices_first_visit_parity | public_customer_prices_first_visit_parity |
| `20260831140000` | course_dependent_only_participant_policy | course_dependent_only_participant_policy |
| `20260904120000` | session_social_context | session_social_context |
| `20260909120000` | physical_availability_foundation_v1 | physical_availability_foundation_v1 |
| `20260910120000` | corporate_company_pages_phase1 | corporate_company_pages_phase1 |
| `20260911120000` | delta_aware_activity_schedule_editing | delta_aware_activity_schedule_editing |
| `20260913120000` | activity_participant_invitations | activity_participant_invitations |
| `20260913130000` | bounded_activity_pricing_facts | bounded_activity_pricing_facts |
| `20260914120000` | corporate_company_page_v2_cms | corporate_company_page_v2_cms |
| `20260916120000` | scope_activity_registration_idempotency_to_occurrence | scope_activity_registration_idempotency_to_occurrence |
| `20260918120000` | pickla_mail_v1 | pickla_mail_v1 |
| `20260919120000` | commerce_r2a_tracked_merchandise | commerce_r2a_tracked_merchandise |
| `20260920120000` | commerce_r2a_refund_truth_reconciliation | commerce_r2a_refund_truth_reconciliation |
| `20260921120000` | product_media_gallery | product_media_gallery |
| `20260921130000` | desk_order_customer_operability | desk_order_customer_operability |
| `20260921140000` | activity_cancellation_capacity_truth | activity_cancellation_capacity_truth |
| `20260922120000` | cancellation_policy_v1 | cancellation_policy_v1 |
| `20260923120000` | Absent | storefront_v1_product_presentation |

</details>

Source-manifest SHA-256 input is UTF-8 lines `<file-sha256><two spaces><repository-relative-path><LF>`, sorted by path, for every source file returned by that function download. This preserves a compact content fingerprint independent of temporary download location.

| Environment / function | Files in complete local closure | Source-manifest SHA-256 |
| --- | --- | --- |
| production / `api-admin` | 16 | `f7ebb2a553bb577625938fa9112cc7e3c59a0da496056f2967ce4ade41828bf2` |
| production / `api-bookings` | 27 | `13b22e6ed0ac5b9b638466e8ccf6bc17911e39bddbe234f2a0ad0c52d0044ec8` |
| production / `api-commerce` | 22 | `0789977087950db1c647bc4f2ba7bf86b870658b63ba29f53b8fb2e1b0ab5a30` |
| production / `api-customers` | 6 | `6bcec507fcfa1e446219acfd4cc839272b86d33839704bb53ee27ebc5a43325a` |
| production / `api-memberships` | 6 | `39c7e90a5bf9585cc38c462eedc61ffaeb6fd1f997b8fb450f7cd934770f5443` |
| production / `api-notifications` | 3 | `11218d415a78f84c0eedb23ec89b78f008b3e0bad9acf56ad348d2a3c72c6326` |
| production / `api-stripe-webhook` | 16 | `7be26a974ce87d747c2d18cedb55e6780d280fff3702abec9057e022cd19e4d0` |
| stage / `api-admin` | 16 | `f5d3518947b68fe439aca9ec63f1c8ba63b0446ef8cc44d84644957b5f6552a0` |
| stage / `api-bookings` | 26 | `0c2c8a75fbf3293c968ccbb6effd365ea374b40aa686779698dc3a8f6f87f585` |
| stage / `api-commerce` | 24 | `5fa4d192699249c17329f926ce6aa68906bd5c6907e0422aedff312bdfeb41a2` |
| stage / `api-customers` | 5 | `6f35f90e1ad433b495a2b39972765d6b066ac22f582e7d55beb729b7a918a1df` |
| stage / `api-memberships` | 6 | `b951b89eb77cef00a49eef26b23acbe946dd300d18f05565692889995378910f` |
| stage / `api-notifications` | 3 | `11218d415a78f84c0eedb23ec89b78f008b3e0bad9acf56ad348d2a3c72c6326` |
| stage / `api-stripe-webhook` | 16 | `9c4b6f341e3ba43d086436cf5144dc4968f580b101f6b13a2ccce12467f7fd90` |
