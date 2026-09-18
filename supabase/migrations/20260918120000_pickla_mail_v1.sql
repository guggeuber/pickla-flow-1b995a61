-- Pickla Mail V1 — canonical double opt-in foundation.
-- Pickla owns consent truth. Resend is a delivery projection only.
-- This migration deliberately does not copy customers.marketing_consent or
-- any existing customer row into the communication tables.

CREATE TABLE public.communication_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  email text NOT NULL,
  email_normalized text NOT NULL,
  first_name text,
  marketing_status text NOT NULL DEFAULT 'unsubscribed'
    CHECK (marketing_status IN ('pending_confirmation', 'subscribed', 'unsubscribed', 'suppressed')),
  suppressed_at timestamptz,
  suppression_reason text,
  suppression_source text,
  unsubscribed_at timestamptz,
  unsubscribe_source text,
  resend_contact_id text,
  resend_sync_status text NOT NULL DEFAULT 'not_configured'
    CHECK (resend_sync_status IN ('pending', 'synced', 'failed', 'not_configured')),
  resend_sync_error text,
  resend_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_subscribers_email_normalized_check
    CHECK (email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) BETWEEN 3 AND 320),
  CONSTRAINT communication_subscribers_suppression_state_check
    CHECK (
      (
        marketing_status = 'suppressed'
        AND suppressed_at IS NOT NULL
        AND suppression_reason IS NOT NULL
        AND suppression_source IS NOT NULL
      )
      OR
      (
        marketing_status <> 'suppressed'
        AND suppressed_at IS NULL
        AND suppression_reason IS NULL
        AND suppression_source IS NULL
      )
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
  status text NOT NULL CHECK (status IN ('pending_confirmation', 'subscribed', 'unsubscribed')),
  request_source text,
  requested_at timestamptz,
  request_policy_version text,
  request_statement text,
  request_notice text,
  confirmation_source text,
  confirmed_at timestamptz,
  confirmation_token_hash text,
  confirmation_expires_at timestamptz,
  confirmation_delivery_status text NOT NULL DEFAULT 'not_required'
    CHECK (confirmation_delivery_status IN ('pending', 'sent', 'failed', 'not_required')),
  confirmation_delivery_error text,
  confirmation_message_id text,
  confirmation_sent_at timestamptz,
  withdrawn_at timestamptz,
  withdrawal_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_preferences_topic_key_check
    CHECK (topic_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT communication_preferences_request_evidence_check
    CHECK (
      status = 'unsubscribed'
      OR (
        request_source IS NOT NULL
        AND requested_at IS NOT NULL
        AND request_policy_version IS NOT NULL
        AND request_statement IS NOT NULL
        AND request_notice IS NOT NULL
      )
    ),
  CONSTRAINT communication_preferences_confirmation_evidence_check
    CHECK (
      status <> 'subscribed'
      OR (confirmation_source IS NOT NULL AND confirmed_at IS NOT NULL)
    ),
  CONSTRAINT communication_preferences_pending_token_check
    CHECK (
      status <> 'pending_confirmation'
      OR (
        confirmation_token_hash ~ '^[0-9a-f]{64}$'
        AND confirmation_expires_at IS NOT NULL
        AND confirmation_delivery_status IN ('pending', 'sent', 'failed')
      )
    ),
  CONSTRAINT communication_preferences_subscriber_topic_key UNIQUE (subscriber_id, topic_key),
  CONSTRAINT communication_preferences_confirmation_token_key UNIQUE (confirmation_token_hash)
);

CREATE INDEX communication_preferences_eligibility_idx
  ON public.communication_preferences(topic_key, status, subscriber_id);

CREATE INDEX communication_preferences_pending_idx
  ON public.communication_preferences(confirmation_expires_at)
  WHERE status = 'pending_confirmation';

CREATE TABLE public.communication_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.communication_subscribers(id) ON DELETE RESTRICT,
  topic_key text,
  event_type text NOT NULL
    CHECK (event_type IN ('confirmation_requested', 'subscribe', 'resubscribe', 'unsubscribe', 'suppress', 'identity_link')),
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

CREATE TABLE public.communication_rate_limits (
  action_key text NOT NULL,
  scope_hash text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (action_key, scope_hash),
  CONSTRAINT communication_rate_limits_action_check
    CHECK (action_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT communication_rate_limits_scope_hash_check
    CHECK (scope_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX communication_rate_limits_expiry_idx
  ON public.communication_rate_limits(updated_at);

ALTER TABLE public.communication_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.communication_subscribers FROM anon, authenticated;
REVOKE ALL ON public.communication_preferences FROM anon, authenticated;
REVOKE ALL ON public.communication_consent_events FROM anon, authenticated;
REVOKE ALL ON public.communication_provider_events FROM anon, authenticated;
REVOKE ALL ON public.communication_rate_limits FROM anon, authenticated;

GRANT ALL ON public.communication_subscribers TO service_role;
GRANT ALL ON public.communication_preferences TO service_role;
GRANT SELECT, INSERT ON public.communication_consent_events TO service_role;
GRANT ALL ON public.communication_provider_events TO service_role;
GRANT ALL ON public.communication_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.check_communication_rate_limit(
  p_action_key text,
  p_scope_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.communication_rate_limits%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_action_key !~ '^[a-z][a-z0-9_]{1,63}$'
    OR p_scope_hash !~ '^[0-9a-f]{64}$'
    OR p_limit < 1
    OR p_window_seconds < 1
    OR p_block_seconds < 1
  THEN
    RAISE EXCEPTION 'Invalid communication rate-limit configuration';
  END IF;

  INSERT INTO public.communication_rate_limits (action_key, scope_hash)
  VALUES (p_action_key, p_scope_hash)
  ON CONFLICT (action_key, scope_hash) DO NOTHING;

  -- The inserted row already represents this request. Returning here avoids
  -- counting the first request twice while concurrent callers still serialize
  -- on the row lock below.
  IF FOUND THEN
    RETURN true;
  END IF;

  SELECT * INTO v_row
  FROM public.communication_rate_limits rl
  WHERE rl.action_key = p_action_key AND rl.scope_hash = p_scope_hash
  FOR UPDATE;

  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    UPDATE public.communication_rate_limits
    SET request_count = request_count + 1, updated_at = v_now
    WHERE action_key = p_action_key AND scope_hash = p_scope_hash;
    RETURN false;
  END IF;

  IF v_row.window_started_at + make_interval(secs => p_window_seconds) <= v_now THEN
    UPDATE public.communication_rate_limits
    SET window_started_at = v_now,
        request_count = 1,
        blocked_until = NULL,
        updated_at = v_now
    WHERE action_key = p_action_key AND scope_hash = p_scope_hash;
    RETURN true;
  END IF;

  IF v_row.request_count >= p_limit THEN
    UPDATE public.communication_rate_limits
    SET request_count = request_count + 1,
        blocked_until = v_now + make_interval(secs => p_block_seconds),
        updated_at = v_now
    WHERE action_key = p_action_key AND scope_hash = p_scope_hash;
    RETURN false;
  END IF;

  UPDATE public.communication_rate_limits
  SET request_count = request_count + 1, updated_at = v_now
  WHERE action_key = p_action_key AND scope_hash = p_scope_hash;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_communication_confirmation(
  p_organization_id uuid,
  p_email text,
  p_first_name text,
  p_topic_key text,
  p_source text,
  p_policy_version text,
  p_consent_statement text,
  p_consent_notice text,
  p_confirmation_token_hash text,
  p_confirmation_expires_at timestamptz,
  p_request_id text DEFAULT NULL
)
RETURNS TABLE (
  subscriber_id uuid,
  preference_status text,
  marketing_status text,
  should_send_confirmation boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_subscriber public.communication_subscribers%ROWTYPE;
  v_preference public.communication_preferences%ROWTYPE;
BEGIN
  IF v_email = '' OR length(v_email) > 320 THEN
    RAISE EXCEPTION 'Invalid email';
  END IF;
  IF p_topic_key !~ '^[a-z][a-z0-9_]{1,63}$'
    OR nullif(btrim(p_source), '') IS NULL
    OR nullif(btrim(p_policy_version), '') IS NULL
    OR nullif(btrim(p_consent_statement), '') IS NULL
    OR nullif(btrim(p_consent_notice), '') IS NULL
    OR p_confirmation_token_hash !~ '^[0-9a-f]{64}$'
    OR p_confirmation_expires_at <= now()
  THEN
    RAISE EXCEPTION 'Invalid confirmation request';
  END IF;

  SELECT * INTO v_subscriber
  FROM public.communication_subscribers s
  WHERE s.organization_id = p_organization_id
    AND s.email_normalized = v_email
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.communication_subscribers (
      organization_id,
      email,
      email_normalized,
      first_name,
      marketing_status
    ) VALUES (
      p_organization_id,
      v_email,
      v_email,
      nullif(btrim(p_first_name), ''),
      'pending_confirmation'
    )
    ON CONFLICT (organization_id, email_normalized) DO NOTHING
    RETURNING * INTO v_subscriber;

    IF NOT FOUND THEN
      SELECT * INTO v_subscriber
      FROM public.communication_subscribers s
      WHERE s.organization_id = p_organization_id
        AND s.email_normalized = v_email
      FOR UPDATE;
    END IF;
  END IF;

  SELECT * INTO v_preference
  FROM public.communication_preferences cp
  WHERE cp.subscriber_id = v_subscriber.id
    AND cp.topic_key = p_topic_key;

  IF v_subscriber.marketing_status = 'suppressed' THEN
    RETURN QUERY SELECT
      v_subscriber.id,
      coalesce(v_preference.status, 'unsubscribed'),
      v_subscriber.marketing_status,
      false;
    RETURN;
  END IF;

  IF v_subscriber.marketing_status = 'subscribed' AND v_preference.status = 'subscribed' THEN
    RETURN QUERY SELECT v_subscriber.id, v_preference.status, v_subscriber.marketing_status, false;
    RETURN;
  END IF;

  UPDATE public.communication_subscribers
  SET first_name = coalesce(nullif(btrim(p_first_name), ''), first_name),
      marketing_status = 'pending_confirmation',
      unsubscribed_at = NULL,
      unsubscribe_source = NULL,
      updated_at = now()
  WHERE id = v_subscriber.id;

  INSERT INTO public.communication_preferences (
    subscriber_id,
    topic_key,
    status,
    request_source,
    requested_at,
    request_policy_version,
    request_statement,
    request_notice,
    confirmation_token_hash,
    confirmation_expires_at,
    confirmation_delivery_status,
    confirmation_delivery_error,
    confirmation_message_id,
    confirmation_sent_at
  ) VALUES (
    v_subscriber.id,
    p_topic_key,
    'pending_confirmation',
    p_source,
    now(),
    p_policy_version,
    p_consent_statement,
    p_consent_notice,
    p_confirmation_token_hash,
    p_confirmation_expires_at,
    'pending',
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT ON CONSTRAINT communication_preferences_subscriber_topic_key DO UPDATE SET
    status = 'pending_confirmation',
    request_source = EXCLUDED.request_source,
    requested_at = EXCLUDED.requested_at,
    request_policy_version = EXCLUDED.request_policy_version,
    request_statement = EXCLUDED.request_statement,
    request_notice = EXCLUDED.request_notice,
    confirmation_source = NULL,
    confirmed_at = NULL,
    confirmation_token_hash = EXCLUDED.confirmation_token_hash,
    confirmation_expires_at = EXCLUDED.confirmation_expires_at,
    confirmation_delivery_status = 'pending',
    confirmation_delivery_error = NULL,
    confirmation_message_id = NULL,
    confirmation_sent_at = NULL,
    updated_at = now();

  INSERT INTO public.communication_consent_events (
    subscriber_id,
    topic_key,
    event_type,
    source,
    policy_version,
    consent_statement,
    request_id,
    metadata
  ) VALUES (
    v_subscriber.id,
    p_topic_key,
    'confirmation_requested',
    p_source,
    p_policy_version,
    p_consent_statement,
    p_request_id,
    jsonb_build_object(
      'consent_notice', p_consent_notice,
      'confirmation_expires_at', p_confirmation_expires_at,
      'eligibility', 'pending_confirmation'
    )
  );

  RETURN QUERY SELECT v_subscriber.id, 'pending_confirmation'::text, 'pending_confirmation'::text, true;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_communication_preference(
  p_confirmation_token_hash text,
  p_source text,
  p_request_id text DEFAULT NULL
)
RETURNS TABLE (
  subscriber_id uuid,
  preference_status text,
  marketing_status text,
  confirmation_result text,
  state_changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_preference public.communication_preferences%ROWTYPE;
  v_subscriber public.communication_subscribers%ROWTYPE;
  v_event_type text;
  v_was_withdrawn boolean;
BEGIN
  IF p_confirmation_token_hash !~ '^[0-9a-f]{64}$' OR nullif(btrim(p_source), '') IS NULL THEN
    RAISE EXCEPTION 'Invalid confirmation token';
  END IF;

  SELECT * INTO v_preference
  FROM public.communication_preferences cp
  WHERE cp.confirmation_token_hash = p_confirmation_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, 'invalid'::text, false;
    RETURN;
  END IF;

  SELECT * INTO v_subscriber
  FROM public.communication_subscribers s
  WHERE s.id = v_preference.subscriber_id
  FOR UPDATE;

  IF v_preference.status = 'subscribed' AND v_subscriber.marketing_status = 'subscribed' THEN
    RETURN QUERY SELECT v_subscriber.id, v_preference.status, v_subscriber.marketing_status, 'already_confirmed'::text, false;
    RETURN;
  END IF;

  IF v_preference.status <> 'pending_confirmation'
    OR v_preference.confirmation_expires_at IS NULL
    OR v_preference.confirmation_expires_at < now()
  THEN
    RETURN QUERY SELECT v_subscriber.id, v_preference.status, v_subscriber.marketing_status, 'expired'::text, false;
    RETURN;
  END IF;

  IF v_subscriber.marketing_status = 'suppressed' THEN
    RETURN QUERY SELECT v_subscriber.id, v_preference.status, v_subscriber.marketing_status, 'suppressed'::text, false;
    RETURN;
  END IF;

  v_was_withdrawn := v_preference.withdrawn_at IS NOT NULL;
  v_event_type := CASE WHEN v_was_withdrawn THEN 'resubscribe' ELSE 'subscribe' END;

  UPDATE public.communication_preferences
  SET status = 'subscribed',
      confirmation_source = p_source,
      confirmed_at = now(),
      withdrawn_at = NULL,
      withdrawal_source = NULL,
      updated_at = now()
  WHERE id = v_preference.id;

  UPDATE public.communication_subscribers
  SET marketing_status = 'subscribed',
      unsubscribed_at = NULL,
      unsubscribe_source = NULL,
      resend_sync_status = 'pending',
      resend_sync_error = NULL,
      updated_at = now()
  WHERE id = v_subscriber.id;

  INSERT INTO public.communication_consent_events (
    subscriber_id,
    topic_key,
    event_type,
    source,
    policy_version,
    consent_statement,
    request_id,
    metadata
  ) VALUES (
    v_subscriber.id,
    v_preference.topic_key,
    v_event_type,
    p_source,
    v_preference.request_policy_version,
    v_preference.request_statement,
    p_request_id,
    jsonb_build_object(
      'request_source', v_preference.request_source,
      'requested_at', v_preference.requested_at,
      'consent_notice', v_preference.request_notice,
      'confirmation_method', 'email_link'
    )
  );

  RETURN QUERY SELECT v_subscriber.id, 'subscribed'::text, 'subscribed'::text, 'confirmed'::text, true;
END;
$$;

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
  p_consent_notice text,
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
  IF p_topic_key !~ '^[a-z][a-z0-9_]{1,63}$' OR v_email = '' OR length(v_email) > 320 THEN
    RAISE EXCEPTION 'Invalid communication preference';
  END IF;
  IF p_status = 'subscribed' AND (
    nullif(btrim(p_source), '') IS NULL
    OR nullif(btrim(p_policy_version), '') IS NULL
    OR nullif(btrim(p_consent_statement), '') IS NULL
    OR nullif(btrim(p_consent_notice), '') IS NULL
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
      organization_id, email, email_normalized, first_name, marketing_status, unsubscribed_at, unsubscribe_source
    ) VALUES (
      p_organization_id,
      v_email,
      v_email,
      nullif(btrim(p_first_name), ''),
      p_status,
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
  WHERE cp.subscriber_id = v_subscriber.id AND cp.topic_key = p_topic_key;

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
    SET customer_id = p_customer_id, updated_at = now()
    WHERE id = v_subscriber.id;
    v_linked_customer := true;
  END IF;

  IF v_subscriber.marketing_status = 'suppressed' THEN
    RETURN QUERY
    SELECT v_subscriber.id, coalesce(v_previous_preference, 'unsubscribed'), 'suppressed'::text, true, v_linked_customer;
    RETURN;
  END IF;

  UPDATE public.communication_subscribers
  SET first_name = coalesce(nullif(btrim(p_first_name), ''), first_name),
      marketing_status = p_status,
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
      request_source,
      requested_at,
      request_policy_version,
      request_statement,
      request_notice,
      confirmation_source,
      confirmed_at,
      confirmation_delivery_status,
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
      CASE WHEN p_status = 'subscribed' THEN p_consent_notice ELSE NULL END,
      CASE WHEN p_status = 'subscribed' THEN 'verified_account_preference' ELSE NULL END,
      CASE WHEN p_status = 'subscribed' THEN now() ELSE NULL END,
      'not_required',
      CASE WHEN p_status = 'unsubscribed' THEN now() ELSE NULL END,
      CASE WHEN p_status = 'unsubscribed' THEN p_source ELSE NULL END
    )
    ON CONFLICT ON CONSTRAINT communication_preferences_subscriber_topic_key DO UPDATE SET
      status = EXCLUDED.status,
      request_source = CASE WHEN EXCLUDED.status = 'subscribed' THEN EXCLUDED.request_source ELSE communication_preferences.request_source END,
      requested_at = CASE WHEN EXCLUDED.status = 'subscribed' THEN EXCLUDED.requested_at ELSE communication_preferences.requested_at END,
      request_policy_version = CASE WHEN EXCLUDED.status = 'subscribed' THEN EXCLUDED.request_policy_version ELSE communication_preferences.request_policy_version END,
      request_statement = CASE WHEN EXCLUDED.status = 'subscribed' THEN EXCLUDED.request_statement ELSE communication_preferences.request_statement END,
      request_notice = CASE WHEN EXCLUDED.status = 'subscribed' THEN EXCLUDED.request_notice ELSE communication_preferences.request_notice END,
      confirmation_source = EXCLUDED.confirmation_source,
      confirmed_at = EXCLUDED.confirmed_at,
      confirmation_token_hash = NULL,
      confirmation_expires_at = NULL,
      confirmation_delivery_status = 'not_required',
      confirmation_delivery_error = NULL,
      confirmation_message_id = NULL,
      confirmation_sent_at = NULL,
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
      subscriber_id, topic_key, event_type, source, policy_version, consent_statement, actor_user_id, request_id, metadata
    ) VALUES (
      v_subscriber.id,
      p_topic_key,
      v_event_type,
      p_source,
      CASE WHEN p_status = 'subscribed' THEN p_policy_version ELSE NULL END,
      CASE WHEN p_status = 'subscribed' THEN p_consent_statement ELSE NULL END,
      p_actor_user_id,
      p_request_id,
      CASE WHEN p_status = 'subscribed'
        THEN jsonb_build_object('consent_notice', p_consent_notice, 'confirmation_method', 'verified_account_action')
        ELSE '{}'::jsonb
      END
    );
  END IF;

  IF v_linked_customer THEN
    INSERT INTO public.communication_consent_events (
      subscriber_id, event_type, source, actor_user_id, request_id, metadata
    ) VALUES (
      v_subscriber.id,
      'identity_link',
      'verified_account_email',
      p_actor_user_id,
      p_request_id,
      '{}'::jsonb
    );
  END IF;

  RETURN QUERY
  SELECT s.id, cp.status, s.marketing_status, s.marketing_status = 'suppressed', v_changed OR v_linked_customer
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
    'suppressed',
    now(),
    p_reason,
    p_source
  )
  ON CONFLICT (organization_id, email_normalized) DO NOTHING
  RETURNING id INTO v_subscriber_id;

  IF v_subscriber_id IS NULL THEN
    SELECT id, marketing_status = 'suppressed'
    INTO v_subscriber_id, v_already_suppressed
    FROM public.communication_subscribers
    WHERE organization_id = p_organization_id AND email_normalized = v_email
    FOR UPDATE;

    IF NOT v_already_suppressed THEN
      UPDATE public.communication_subscribers
      SET marketing_status = 'suppressed',
          suppressed_at = now(),
          suppression_reason = p_reason,
          suppression_source = p_source,
          resend_sync_status = 'pending',
          resend_sync_error = NULL,
          updated_at = now()
      WHERE id = v_subscriber_id;

      UPDATE public.communication_preferences
      SET status = 'unsubscribed',
          confirmation_token_hash = NULL,
          confirmation_expires_at = NULL,
          confirmation_delivery_status = 'not_required',
          confirmation_delivery_error = NULL,
          updated_at = now()
      WHERE subscriber_id = v_subscriber_id;
    END IF;
  ELSE
    v_already_suppressed := false;
  END IF;

  INSERT INTO public.communication_consent_events (
    subscriber_id, event_type, source, provider, provider_event_id, request_id, metadata
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
      AND s.marketing_status = 'subscribed'
      AND s.suppressed_at IS NULL
      AND cp.topic_key = p_topic_key
      AND cp.status = 'subscribed'
      AND cp.confirmed_at IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.check_communication_rate_limit(text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_communication_confirmation(uuid, text, text, text, text, text, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_communication_preference(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_communication_preference(uuid, text, text, uuid, text, text, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suppress_communication_email(uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.communication_is_marketing_eligible(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.check_communication_rate_limit(text, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_communication_confirmation(uuid, text, text, text, text, text, text, text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_communication_preference(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_communication_preference(uuid, text, text, uuid, text, text, text, text, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.suppress_communication_email(uuid, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.communication_is_marketing_eligible(uuid, text) TO service_role;

COMMENT ON TABLE public.communication_subscribers IS
  'Canonical Pickla marketing identities and global pending/subscribed/unsubscribed/suppressed state. Not a transactional-email preference.';
COMMENT ON TABLE public.communication_preferences IS
  'Current per-topic preference plus double opt-in request, confirmation, withdrawal, and delivery evidence.';
COMMENT ON TABLE public.communication_consent_events IS
  'Append-only audit trail for confirmation requests, consent, withdrawal, suppression, and verified identity linking.';
COMMENT ON TABLE public.communication_provider_events IS
  'Minimal idempotent provider webhook ledger. Raw webhook payloads and public PII are intentionally not stored.';
COMMENT ON TABLE public.communication_rate_limits IS
  'Short-lived abuse-control counters keyed by server-HMAC scope hashes; raw email and IP values are never stored.';
