-- Pickla Mail V1
-- Pickla is the canonical consent authority. Resend is a delivery projection only.
-- This migration deliberately does not copy customers.marketing_consent or any
-- existing customer rows into the communication tables.

CREATE TABLE public.communication_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  email text NOT NULL,
  email_normalized text NOT NULL,
  first_name text,
  marketing_status text NOT NULL DEFAULT 'unsubscribed'
    CHECK (marketing_status IN ('active', 'unsubscribed')),
  suppressed_at timestamptz,
  suppression_reason text,
  suppression_source text,
  unsubscribed_at timestamptz,
  unsubscribe_source text,
  resend_contact_id text,
  resend_sync_status text NOT NULL DEFAULT 'pending'
    CHECK (resend_sync_status IN ('pending', 'synced', 'failed', 'not_configured')),
  resend_sync_error text,
  resend_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_subscribers_email_normalized_check
    CHECK (email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) BETWEEN 3 AND 320),
  CONSTRAINT communication_subscribers_suppression_pair_check
    CHECK (
      (suppressed_at IS NULL AND suppression_reason IS NULL AND suppression_source IS NULL)
      OR
      (suppressed_at IS NOT NULL AND suppression_reason IS NOT NULL AND suppression_source IS NOT NULL)
    ),
  CONSTRAINT communication_subscribers_org_email_key UNIQUE (organization_id, email_normalized)
);

CREATE INDEX communication_subscribers_customer_idx
  ON public.communication_subscribers(customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX communication_subscribers_eligibility_idx
  ON public.communication_subscribers(organization_id, marketing_status, suppressed_at);

CREATE TABLE public.communication_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.communication_subscribers(id) ON DELETE RESTRICT,
  topic_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('subscribed', 'unsubscribed')),
  consent_source text,
  consent_at timestamptz,
  consent_policy_version text,
  consent_statement text,
  withdrawn_at timestamptz,
  withdrawal_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_preferences_topic_key_check
    CHECK (topic_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT communication_preferences_consent_evidence_check
    CHECK (
      status = 'unsubscribed'
      OR (
        consent_source IS NOT NULL
        AND consent_at IS NOT NULL
        AND consent_policy_version IS NOT NULL
        AND consent_statement IS NOT NULL
      )
    ),
  CONSTRAINT communication_preferences_subscriber_topic_key UNIQUE (subscriber_id, topic_key)
);

CREATE INDEX communication_preferences_eligibility_idx
  ON public.communication_preferences(topic_key, status, subscriber_id);

CREATE TABLE public.communication_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.communication_subscribers(id) ON DELETE RESTRICT,
  topic_key text,
  event_type text NOT NULL
    CHECK (event_type IN ('subscribe', 'resubscribe', 'unsubscribe', 'suppress', 'identity_link')),
  source text NOT NULL,
  policy_version text,
  consent_statement text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider text,
  provider_event_id text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_consent_events_provider_event_key UNIQUE (provider, provider_event_id)
);

CREATE INDEX communication_consent_events_subscriber_idx
  ON public.communication_consent_events(subscriber_id, occurred_at DESC);

CREATE TABLE public.communication_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload_sha256 text NOT NULL,
  email_sha256 text,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed')),
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT communication_provider_events_provider_key UNIQUE (provider, provider_event_id)
);

CREATE INDEX communication_provider_events_status_idx
  ON public.communication_provider_events(processing_status, received_at DESC);

ALTER TABLE public.communication_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_provider_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.communication_subscribers FROM anon, authenticated;
REVOKE ALL ON public.communication_preferences FROM anon, authenticated;
REVOKE ALL ON public.communication_consent_events FROM anon, authenticated;
REVOKE ALL ON public.communication_provider_events FROM anon, authenticated;

GRANT ALL ON public.communication_subscribers TO service_role;
GRANT ALL ON public.communication_preferences TO service_role;
GRANT SELECT, INSERT ON public.communication_consent_events TO service_role;
GRANT ALL ON public.communication_provider_events TO service_role;

CREATE OR REPLACE FUNCTION public.record_communication_preference(
  p_organization_id uuid,
  p_email text,
  p_first_name text,
  p_customer_id uuid,
  p_topic_key text,
  p_status text,
  p_source text,
  p_policy_version text,
  p_consent_statement text,
  p_request_id text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  subscriber_id uuid,
  preference_status text,
  marketing_status text,
  is_suppressed boolean,
  state_changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_subscriber public.communication_subscribers%ROWTYPE;
  v_previous_preference text;
  v_previous_marketing text;
  v_was_new boolean := false;
  v_linked_customer boolean := false;
  v_changed boolean := false;
  v_event_type text;
BEGIN
  IF p_status NOT IN ('subscribed', 'unsubscribed') THEN
    RAISE EXCEPTION 'Unsupported communication preference status';
  END IF;
  IF p_topic_key !~ '^[a-z][a-z0-9_]{1,63}$' THEN
    RAISE EXCEPTION 'Invalid communication topic';
  END IF;
  IF v_email = '' OR length(v_email) > 320 THEN
    RAISE EXCEPTION 'Invalid email';
  END IF;
  IF p_status = 'subscribed' AND (
    nullif(btrim(p_source), '') IS NULL
    OR nullif(btrim(p_policy_version), '') IS NULL
    OR nullif(btrim(p_consent_statement), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Consent evidence is required';
  END IF;

  SELECT * INTO v_subscriber
  FROM public.communication_subscribers s
  WHERE s.organization_id = p_organization_id
    AND s.email_normalized = v_email
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.communication_subscribers (
      organization_id,
      customer_id,
      email,
      email_normalized,
      first_name,
      marketing_status,
      unsubscribed_at,
      unsubscribe_source
    ) VALUES (
      p_organization_id,
      NULL,
      v_email,
      v_email,
      nullif(btrim(p_first_name), ''),
      CASE WHEN p_status = 'subscribed' THEN 'active' ELSE 'unsubscribed' END,
      CASE WHEN p_status = 'unsubscribed' THEN now() ELSE NULL END,
      CASE WHEN p_status = 'unsubscribed' THEN p_source ELSE NULL END
    )
    ON CONFLICT (organization_id, email_normalized) DO NOTHING
    RETURNING * INTO v_subscriber;

    IF FOUND THEN
      v_was_new := true;
    ELSE
      SELECT * INTO v_subscriber
      FROM public.communication_subscribers s
      WHERE s.organization_id = p_organization_id
        AND s.email_normalized = v_email
      FOR UPDATE;
    END IF;
  END IF;

  v_previous_marketing := v_subscriber.marketing_status;
  SELECT cp.status INTO v_previous_preference
  FROM public.communication_preferences cp
  WHERE cp.subscriber_id = v_subscriber.id
    AND cp.topic_key = p_topic_key;

  IF p_customer_id IS NOT NULL
    AND v_subscriber.customer_id IS NOT NULL
    AND v_subscriber.customer_id IS DISTINCT FROM p_customer_id
  THEN
    RAISE EXCEPTION 'Subscriber is already linked to another customer';
  END IF;

  IF p_customer_id IS NOT NULL AND v_subscriber.customer_id IS NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = p_customer_id
        AND c.organization_id = p_organization_id
        AND c.status = 'active'
        AND lower(btrim(coalesce(c.email_normalized, c.primary_email, ''))) = v_email
    ) THEN
      RAISE EXCEPTION 'Customer identity does not match subscriber email';
    END IF;
    UPDATE public.communication_subscribers
    SET customer_id = p_customer_id,
        updated_at = now()
    WHERE id = v_subscriber.id;
    v_linked_customer := true;
  END IF;

  UPDATE public.communication_subscribers
  SET first_name = coalesce(nullif(btrim(p_first_name), ''), first_name),
      marketing_status = CASE WHEN p_status = 'subscribed' THEN 'active' ELSE 'unsubscribed' END,
      unsubscribed_at = CASE WHEN p_status = 'unsubscribed' THEN coalesce(unsubscribed_at, now()) ELSE NULL END,
      unsubscribe_source = CASE WHEN p_status = 'unsubscribed' THEN coalesce(unsubscribe_source, p_source) ELSE NULL END,
      resend_sync_status = 'pending',
      resend_sync_error = NULL,
      updated_at = now()
  WHERE id = v_subscriber.id;

  IF v_previous_preference IS DISTINCT FROM p_status OR v_was_new THEN
    INSERT INTO public.communication_preferences (
      subscriber_id,
      topic_key,
      status,
      consent_source,
      consent_at,
      consent_policy_version,
      consent_statement,
      withdrawn_at,
      withdrawal_source
    ) VALUES (
      v_subscriber.id,
      p_topic_key,
      p_status,
      CASE WHEN p_status = 'subscribed' THEN p_source ELSE NULL END,
      CASE WHEN p_status = 'subscribed' THEN now() ELSE NULL END,
      CASE WHEN p_status = 'subscribed' THEN p_policy_version ELSE NULL END,
      CASE WHEN p_status = 'subscribed' THEN p_consent_statement ELSE NULL END,
      CASE WHEN p_status = 'unsubscribed' THEN now() ELSE NULL END,
      CASE WHEN p_status = 'unsubscribed' THEN p_source ELSE NULL END
    )
    ON CONFLICT ON CONSTRAINT communication_preferences_subscriber_topic_key DO UPDATE SET
      status = EXCLUDED.status,
      consent_source = CASE WHEN EXCLUDED.status = 'subscribed' THEN EXCLUDED.consent_source ELSE communication_preferences.consent_source END,
      consent_at = CASE WHEN EXCLUDED.status = 'subscribed' THEN EXCLUDED.consent_at ELSE communication_preferences.consent_at END,
      consent_policy_version = CASE WHEN EXCLUDED.status = 'subscribed' THEN EXCLUDED.consent_policy_version ELSE communication_preferences.consent_policy_version END,
      consent_statement = CASE WHEN EXCLUDED.status = 'subscribed' THEN EXCLUDED.consent_statement ELSE communication_preferences.consent_statement END,
      withdrawn_at = EXCLUDED.withdrawn_at,
      withdrawal_source = EXCLUDED.withdrawal_source,
      updated_at = now();
    v_changed := true;
  END IF;

  IF v_changed THEN
    v_event_type := CASE
      WHEN p_status = 'unsubscribed' THEN 'unsubscribe'
      WHEN v_previous_preference = 'unsubscribed' OR v_previous_marketing = 'unsubscribed' THEN 'resubscribe'
      ELSE 'subscribe'
    END;
    INSERT INTO public.communication_consent_events (
      subscriber_id,
      topic_key,
      event_type,
      source,
      policy_version,
      consent_statement,
      actor_user_id,
      request_id
    ) VALUES (
      v_subscriber.id,
      p_topic_key,
      v_event_type,
      p_source,
      CASE WHEN p_status = 'subscribed' THEN p_policy_version ELSE NULL END,
      CASE WHEN p_status = 'subscribed' THEN p_consent_statement ELSE NULL END,
      p_actor_user_id,
      p_request_id
    );
  END IF;

  IF v_linked_customer THEN
    INSERT INTO public.communication_consent_events (
      subscriber_id,
      event_type,
      source,
      actor_user_id,
      request_id,
      metadata
    ) VALUES (
      v_subscriber.id,
      'identity_link',
      'verified_account_email',
      p_actor_user_id,
      p_request_id,
      jsonb_build_object('customer_id', p_customer_id)
    );
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    cp.status,
    s.marketing_status,
    s.suppressed_at IS NOT NULL,
    v_changed OR v_linked_customer
  FROM public.communication_subscribers s
  JOIN public.communication_preferences cp
    ON cp.subscriber_id = s.id AND cp.topic_key = p_topic_key
  WHERE s.id = v_subscriber.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.suppress_communication_email(
  p_organization_id uuid,
  p_email text,
  p_reason text,
  p_source text,
  p_provider text DEFAULT NULL,
  p_provider_event_id text DEFAULT NULL,
  p_request_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_subscriber_id uuid;
  v_already_suppressed boolean;
BEGIN
  IF v_email = '' OR length(v_email) > 320 THEN
    RAISE EXCEPTION 'Invalid email';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL OR nullif(btrim(p_source), '') IS NULL THEN
    RAISE EXCEPTION 'Suppression reason and source are required';
  END IF;

  INSERT INTO public.communication_subscribers (
    organization_id,
    email,
    email_normalized,
    marketing_status,
    suppressed_at,
    suppression_reason,
    suppression_source
  ) VALUES (
    p_organization_id,
    v_email,
    v_email,
    'unsubscribed',
    now(),
    p_reason,
    p_source
  )
  ON CONFLICT (organization_id, email_normalized) DO NOTHING
  RETURNING id INTO v_subscriber_id;

  IF v_subscriber_id IS NULL THEN
    SELECT id, suppressed_at IS NOT NULL
    INTO v_subscriber_id, v_already_suppressed
    FROM public.communication_subscribers
    WHERE organization_id = p_organization_id
      AND email_normalized = v_email
    FOR UPDATE;

    IF NOT v_already_suppressed THEN
      UPDATE public.communication_subscribers
      SET suppressed_at = now(),
          suppression_reason = p_reason,
          suppression_source = p_source,
          resend_sync_status = 'pending',
          resend_sync_error = NULL,
          updated_at = now()
      WHERE id = v_subscriber_id;
    END IF;
  ELSE
    v_already_suppressed := false;
  END IF;

  IF NOT coalesce(v_already_suppressed, false) THEN
    INSERT INTO public.communication_consent_events (
      subscriber_id,
      event_type,
      source,
      provider,
      provider_event_id,
      request_id,
      metadata
    ) VALUES (
      v_subscriber_id,
      'suppress',
      p_source,
      p_provider,
      p_provider_event_id,
      p_request_id,
      jsonb_build_object('reason', p_reason)
    )
    ON CONFLICT (provider, provider_event_id) DO NOTHING;
  END IF;

  RETURN v_subscriber_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.communication_is_marketing_eligible(
  p_subscriber_id uuid,
  p_topic_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.communication_subscribers s
    JOIN public.communication_preferences cp ON cp.subscriber_id = s.id
    WHERE s.id = p_subscriber_id
      AND s.marketing_status = 'active'
      AND s.suppressed_at IS NULL
      AND cp.topic_key = p_topic_key
      AND cp.status = 'subscribed'
  );
$$;

REVOKE ALL ON FUNCTION public.record_communication_preference(uuid, text, text, uuid, text, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suppress_communication_email(uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.communication_is_marketing_eligible(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_communication_preference(uuid, text, text, uuid, text, text, text, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.suppress_communication_email(uuid, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.communication_is_marketing_eligible(uuid, text) TO service_role;

COMMENT ON TABLE public.communication_subscribers IS
  'Canonical Pickla marketing identities and global eligibility/suppression state. Not a transactional-email preference.';
COMMENT ON TABLE public.communication_preferences IS
  'Current per-topic marketing preference projection. Consent evidence is required for subscribed rows.';
COMMENT ON TABLE public.communication_consent_events IS
  'Append-only audit trail for marketing consent, withdrawal, suppression, and verified identity linking.';
COMMENT ON TABLE public.communication_provider_events IS
  'Minimal, idempotent provider webhook ledger. Raw webhook payloads and public PII are intentionally not stored.';
