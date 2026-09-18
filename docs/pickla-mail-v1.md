# Pickla Mail V1 — consent and delivery contract

Status: review candidate. Nothing in this document authorizes a deployment, customer import, broadcast, DNS change, or real email.

## Decision

Pickla owns the canonical marketing identity, consent evidence, preference, withdrawal, and suppression state. Resend is a synchronized delivery representation. A provider record can make a recipient less eligible, never more eligible.

V1 has one human preference:

- key: `news_community`
- label: `Pickla news & community`
- default: unsubscribed
- lawful/operational launch basis: explicit, separate opt-in

The legacy `customers.marketing_consent` and `customers.consent_at` columns are not sufficient evidence: no application path, purpose wording, source, version, or withdrawal trail was found. The V1 migration does not read or migrate them.

## Current email inventory

| Flow | Provider | Trigger | Sender | Recipient source | Class | Canonical business source |
|---|---|---|---|---|---|---|
| Signup confirmation, resend confirmation, password reset and recovery | Supabase Auth through configured SMTP/Resend | Auth action | Supabase Auth template/config | Supabase Auth user email | Transactional/security | Supabase Auth user/session |
| Staff auth-help reset or magic link | Supabase Auth | Authorized staff action | Supabase Auth template/config | Selected customer's verified account email | Transactional/security | Auth user + audited staff action |
| Booking participant ticket | Resend Email API | Committed participant ticket creation | `RESEND_FROM`, default `Pickla <hello@playpickla.com>` | Booking participant email | Transactional | Booking participant/claim state |
| Activity participant payment invitation | Resend Email API | Authorized staff creates payment invitation | `RESEND_FROM` | Participant/customer contact email | Transactional | Activity participant invitation; provider outcome persisted |
| Commerce receipt/order confirmation | Resend Email API | Successful Stripe commerce fulfillment | `RESEND_FROM` | Checkout/customer email | Transactional | Commerce order + receipt |
| Group inquiry acknowledgement | Resend Email API | Public group/corporate inquiry accepted | `RESEND_FROM` | Inquiry email | Transactional/service | Event lead/inquiry |
| Event customer reply | Resend Email API | Authorized venue staff reply | `RESEND_FROM` | Event customer email | Transactional/relationship | Event communication + audit context |
| Inbound event reply | Resend Receiving webhook | `email.received` | External customer | Verified inbound payload | Transactional/relationship | `event_communications` and event chat |
| Event offer with PDF | Resend Email API | Authorized event sales workflow | `RESEND_FROM` | Event lead/customer email | Transactional/sales response | Event offer/version |
| Event booking confirmation and deposit link | Resend Email API | Authorized event sales workflow | `RESEND_FROM` | Event customer email | Transactional | Event booking/deposit state |

No general marketing list, newsletter sender, marketing Broadcast endpoint, or customer import exists on the audited main. No generic booking-owner email implementation was found in application code; do not infer one from participant-ticket email or external provider settings.

## Legal engineering contract

This is an engineering interpretation for review, not a substitute for Swedish legal advice.

- The Swedish Marketing Act section 19 requires prior consent for electronic marketing to natural persons. Its existing-customer exception is conditional on collection during a sale, own similar products, no objection, and a clear, simple, free opt-out both at collection and in every later message. Pickla has no proven collection record satisfying those conditions, so V1 does not use the exception.
- Section 20 requires a valid address for stopping electronic marketing. Every future Pickla marketing message must include a functioning unsubscribe route.
- Consent must be voluntary, specific, informed, unambiguous, separate from terms, and expressed by an active action. The V1 Public Web checkbox is required and unchecked by default. Account usage, booking, or purchase is never consent.
- Pickla must prove how and when consent was obtained and which information was shown. V1 stores source, timestamp, topic, policy version, and the exact statement in an append-only event plus current projection.
- Withdrawal must be as easy as consent. Token unsubscribe is no-login, opaque, idempotent, non-enumerating, and changes Pickla state before any provider synchronization.
- Objection to direct marketing is absolute. Local unsubscribe or suppression always wins over a stale or contradictory Resend state.
- Children require particular care. V1 is general-audience, does not profile minors, and must not contain direct purchase exhortations aimed at people under 18. Child-targeted campaigns or online consent collection from children require legal/product review and an age/guardian design before use.
- Resend acts as a processor for customer data. Before production, Pickla must confirm acceptance of the current DPA, subprocessors, international-transfer assessment, and internal records of processing.
- Retention needs an approved schedule. Consent evidence and a minimal suppression tombstone may need to remain after withdrawal to prove and honor the objection; full campaign content and unnecessary provider metadata should not be retained by default.

Official review sources:

- [Swedish Marketing Act (2008:486), sections 19–20](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/marknadsforingslag-2008486_sfs-2008-486/)
- [IMY: consent as a lawful basis](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/rattslig-grund/samtycke/)
- [IMY: objection to direct marketing](https://www.imy.se/vanliga-fragor-och-svar/jag-vill-avregistrera-mig-fran-ett-nyhetsbrev.-hur-gor-jag)
- [GDPR official text](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/)
- [Konsumentverket: marketing to children](https://www.konsumentverket.se/marknadsratt-foretag/marknadsforing-till-barn-regler-for-foretag/)

## Canonical model and identity

`communication_subscribers` holds one organization-scoped identity per normalized email. It can link to a customer only when the verified account email matches an active customer in the same organization. Anonymous signup never creates a general customer record.

`communication_preferences` is the current per-topic projection. A subscribed row cannot exist without consent source, time, version, and statement.

`communication_consent_events` is the append-only audit trail for subscribe, resubscribe, unsubscribe, suppression, and verified account linking.

`communication_provider_events` stores only an event identifier, event type, payload digest, email digest, processing state, and bounded error — not the raw provider payload.

Eligibility requires all of:

1. `marketing_status = active`
2. no local suppression
3. topic preference `subscribed`
4. a fresh server-side calculation immediately before a future send

Resend state is not an eligibility input that can override these rules.

## Anonymous signup and later linking

Public signup accepts email, optional first name, explicit checkbox, approved surface source, and a honeypot. It returns the same success shape whether the email is new, already subscribed, linked, or locally suppressed. Duplicate calls preserve one subscriber identity and one current preference.

When an authenticated customer opens communication preferences, the API uses the verified Supabase Auth email. If that normalized address matches the anonymous subscriber and a same-organization customer, the existing subscriber is linked. It never creates a second marketing identity.

V1 uses explicit single opt-in. Double opt-in is not implemented or legally assumed. Pickla may add mailbox verification later as an abuse/deliverability control without weakening the consent evidence contract.

## Transactional versus marketing

Transactional email is required to provide or secure a requested service: auth, booking/ticket, receipt, payment link, necessary operational information, and direct customer-service/event dialogue. It does not consult or mutate Pickla Mail preferences.

Marketing/editorial email promotes discovery or ongoing engagement: Pickla Paper, community roundups, event discovery, offers, and re-engagement. It requires current canonical eligibility and unsubscribe. Promotional material must not be inserted into transactional mail to bypass consent.

## Resend projection

Use current Resend Contacts plus one public Topic configured with default subscription `opt_out`. The environment variable `RESEND_NEWS_COMMUNITY_TOPIC_ID` points to that topic. Do not use a Resend Segment or stale CSV as consent authority.

Pickla subscribe/resubscribe:

1. commit Pickla projection and audit event
2. create/update Resend Contact
3. set global contact `unsubscribed=false`
4. set the topic to `opt_in`
5. persist sync result without rolling back Pickla truth on provider failure

Pickla unsubscribe/suppression performs the local change first, then pushes global unsubscribed/topic opt-out. Sync failure is visible to Admin and never restores eligibility.

Relevant verified Resend webhooks:

- `contact.updated` with `unsubscribed=true` → local unsubscribe
- `suppression.added` → local suppression
- `email.bounced` → local hard-bounce suppression
- `email.complained` → local complaint suppression
- `email.suppressed` → local provider suppression
- delivery events → operational observation only
- provider opt-in, contact creation, or `suppression.removed` → never reactivates Pickla consent

The webhook verifies the raw body with the endpoint-specific Svix/Resend secret, rejects timestamps outside five minutes, and deduplicates on `svix-id`. Failed processing remains retryable; processed/ignored events are idempotent.

Official provider references:

- [Resend Contacts](https://resend.com/docs/dashboard/audiences/contacts)
- [Resend Topics](https://resend.com/docs/dashboard/topics/introduction)
- [Resend Broadcasts](https://resend.com/docs/dashboard/broadcasts/send-broadcast-with-api)
- [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Resend webhook event types](https://resend.com/docs/webhooks/event-types)
- [Resend suppressions](https://resend.com/docs/dashboard/emails/email-suppressions)
- [Resend consent guidance](https://resend.com/docs/knowledge-base/what-counts-as-email-consent)
- [Resend DPA](https://resend.com/legal/dpa)
- [Resend subprocessors](https://resend.com/legal/subprocessors)

## Unsubscribe contract

Future Pickla-rendered marketing mail should include both:

- a human-visible Pickla unsubscribe URL
- `List-Unsubscribe: <https://.../api-communications/unsubscribe?token=...>`
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

The token is versioned, HMAC-signed, contains no email or customer ID, and is accepted by GET and POST without login. Invalid, expired-by-secret-rotation, and valid links return the same non-enumerating confirmation. Token-secret rotation needs an overlap strategy before old links are invalidated.

Resend's native unsubscribe page can remain a secondary provider safety net because its `contact.updated` webhook flows back to Pickla. It is not the canonical UI or truth source.

## Sender and DNS audit (read-only, 2026-09-18)

Current application default: `Pickla <hello@playpickla.com>`.

Observed public DNS:

- root SPF: `v=spf1 include:_spf.google.com ~all`
- Resend return-path SPF at `send.playpickla.com`: `v=spf1 include:amazonses.com ~all`
- return-path MX: Amazon SES in `eu-west-1`
- DKIM: `resend._domainkey.playpickla.com` is published
- DMARC: `v=DMARC1; p=none;` with no aggregate report address

No DNS was changed. Keep `hello@playpickla.com` for V1 to avoid an unreviewed identity change. Before broad sending, confirm the domain as verified in Resend, test SPF/DKIM/DMARC alignment on all legitimate senders, add an approved `rua` mailbox, monitor, and only then consider moving DMARC from `p=none` to `quarantine`/`reject`. Resend now recommends purpose-specific sending subdomains; adopting one is a later deliverability decision because it requires DNS and sender migration.

## Admin and broadcast boundary

The V1 Admin module is super-admin-only and read-only. It shows active count, 30-day joins/withdrawals, suppression count, and sync failures. It exposes no email list and has no send button.

Future workflow:

1. human or agent creates a draft only
2. human previews content and sends only to designated test addresses
3. server calculates the audience from canonical Pickla eligibility
4. server rechecks every recipient immediately before schedule/send
5. authorized human approves the exact content, topic, audience calculation, and time
6. Resend Broadcast sends with unsubscribe headers/link
7. verified webhooks update operational delivery and canonical negative signals

No agent may send, schedule, import contacts, weaken eligibility, remove a suppression, create API keys, or change DNS. Resend API/MCP can later create drafts and retrieve status only behind an allowlisted tool boundary; send/schedule capabilities remain unavailable until a human approval system exists.

## Privacy, tracking, and cookies

Provider minimum: email, optional first name, global subscription state, and the V1 topic state. Do not sync booking history, payment data, phone, membership details, sensitive profile data, or arbitrary internal metadata.

Email consent is not cookie consent. The reusable form adds no browser tracking and requires no cookie banner change. Resend open/click tracking is disabled by default and V1 requires it to remain disabled. Open tracking inserts a recipient-specific pixel and click tracking rewrites links; enabling either requires a separate privacy/legal assessment and updated transparency before use.

## Configuration and release gates

Required server-only secrets/configuration (never frontend-exposed):

- existing `RESEND_API_KEY`
- new endpoint-specific `RESEND_COMMUNICATIONS_WEBHOOK_SECRET`
- new `RESEND_NEWS_COMMUNITY_TOPIC_ID` for a public, default `opt_out` topic
- new random `COMMUNICATION_UNSUBSCRIBE_SECRET` with at least 32 characters

Production activation also requires:

- apply the migration; verify zero imported subscribers
- deploy `api-communications` with `--no-verify-jwt`
- create the Resend Topic as default opt-out and record its ID as a secret
- create a Resend webhook for the documented events and store its endpoint-specific secret
- verify Contacts sync using designated internal test addresses only
- confirm Resend open/click tracking remains disabled
- legal review of controller wording, privacy text, retention schedule, DPA/subprocessors/transfers, minor-facing policy, and single-opt-in choice
- operational owner and incident runbook for complaints, webhook failure, and sync backlog

## Permanent test contract

The repository contract suite maps to requirements A–T in the task: anonymous and account subscription, evidence, idempotency, safe linking, no-login immediate unsubscribe, eligibility, transactional independence, fail-safe sync, verified/idempotent webhooks, suppression, zero legacy migration, no public PII/secrets, organization isolation, accessible capture, canonical audience calculation, and no autonomous send surface.
