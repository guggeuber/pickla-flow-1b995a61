# Pickla Mail V1 — public activation record

Review date: 2026-09-18
Release state: candidate preparation; arbitrary public signup is not active

## Provider and transfer review

Resend's current DPA was reviewed at <https://resend.com/legal/dpa> (page update shown as 2026-08-27). The DPA describes Resend as processor where the customer is controller, incorporates the EU Standard Contractual Clauses (Module 2 for controller-to-processor and Module 3 where applicable), and refers to the EU–U.S. Data Privacy Framework and UK Extension. Resend's GDPR page states that primary processing is in the United States: <https://resend.com/security/gdpr>.

This technical review does not prove that Pickla has validly executed/accepted the DPA, selected the correct SCC module, completed a transfer impact assessment, or documented the transfer in its Article 30 records. The controller/legal owner must approve those items before `COMMUNICATION_SEND_MODE=live`.

The current Resend subprocessor page was reviewed at <https://resend.com/legal/subprocessors> (page update shown as 2026-08-27). It lists: Amazon Web Services, Anthropic, Attio, Cloudflare, Datadog, Elastic, Estuary, Google, Inngest, Liveblocks, Metabase, Plain (Not Just Tickets), PlanetScale, Retool, RunPod, Salesforce/Slack, Snowflake, Stripe, Supabase, Svix, Tinybird, and Vercel; the listed processing location is the United States. The DPA states that changes are notified with an objection window. Pickla must record approval of the current list and name the person/process that reviews future notices.

## Controller and privacy information

The live privacy page already identifies Pickla Orbit AB (org.nr 559203-1610) as platform provider and Pickla Solna AB (org.nr 556977-4481) as responsible for local Solna operations. It explains the Pickla Mail data set, separate voluntary marketing choice, double opt-in, adult/guardian rule, withdrawal, suppression, Resend processing, and minimization.

Before activation, the controller must explicitly approve and publish an unambiguous allocation for the generic cross-venue `Pickla news & community` list: which Pickla company is controller, its contact channel, purposes and lawful basis, recipient categories, US transfer/SCC/DPF information, retention criteria, data-subject rights, complaint route to IMY, and whether provision is optional. Engineering must not guess that allocation.

Tracking remains off. Resend's documented open tracking uses a recipient-specific pixel and click tracking rewrites links; neither is required for V1. Provider launch inspection must continue to show `open_tracking=false` and `click_tracking=false`. Sources: <https://resend.com/blog/open-and-click-tracking> and <https://resend.com/changelog/update-click-open-tracking-via-api>.

## Retention decision record

No purge job is active. The engineering proposal remains:

- unconfirmed request/token/delivery evidence: 30 days after the latest token expires
- rate-limit counters and keyed scope digests: 24 hours after the window/block expires
- provider event digests and bounded operational errors: 90 days
- active consent evidence: while consent remains active
- withdrawn consent evidence: 3 years after withdrawal or the last disputed marketing event
- minimal suppression record: while needed to honor the objection/block; after a verified lift, evidence for 3 years

Controller/legal approval is required for each purpose, period, start point, deletion/anonymization method, suppression handling, legal-hold exception, and the unsubscribe-link/key useful life. The proposal is not legal certainty and must not be activated by engineering alone.

## Technical activation boundary

The candidate mounts the reviewed form after the useful acquisition content and before the footer. Browser requests go only to same-origin `/mail/subscribe`; `/mail/:action` is handled by a bounded Vercel Function, which forwards the verified Vercel client address and a server-only rotating proxy credential. In live mode the Supabase function rejects both signup and confirmation unless `COMMUNICATION_WAF_VERIFIED=true` and the proxy credential matches the current/previous server ring. Direct Supabase-origin bypass therefore fails closed.

The external WAF rules must protect both incoming paths beginning `/mail/` and the directly addressable `/api/mail` Vercel Function route, count by IP, and return 429 after the approved fixed-window threshold. Application limits remain 3 attempts per email and 10 per network per 15 minutes, with a one-hour block. Both active and previous HMAC buckets are consumed during rotation.

Observed on 2026-09-18: Vercel Firewall is enabled with mitigations active. Rule `rule_pickla_mail_public_endpoints_7VA7UT` is enabled for `/mail/` OR `/api/mail`, uses a fixed 60-second window keyed by IP, and rate-limits after 30 requests. `COMMUNICATION_WAF_VERIFIED` remains false until this exact candidate is deployed to preview, both routes produce a live 429, and the release owner approves the production activation sequence.

## Human activation record required

The release owner must record, with date/name:

1. DPA/contract acceptance and controller identity.
2. Current subprocessor list, SCC/DPF/TIA conclusion, Article 30/privacy-copy update.
3. Retention and unsubscribe-key lifetime approval.
4. WAF active-version evidence and live 429 test.
5. Resend domain/topic/webhook/tracking-off evidence.
6. Explicit approval to deploy the immutable candidate and change send mode from `canary` to `live`.

No item in this record authorizes a Broadcast, customer import, autonomous send, DNS change, or marketing message.
