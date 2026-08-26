-- Dynamic Catalog member prices reuse membership_tier_pricing. League keeps
-- its original reservation RPC for application rollback compatibility and
-- adds a verified V2 path. V2 accepts no regular/member price: it resolves the
-- captain's canonical active membership and direct product rule inside the
-- same transaction after the original function has acquired the League lock.

CREATE OR REPLACE FUNCTION public.reserve_league_team_entry_v2(
  p_league_season_id UUID,
  p_captain_user_id UUID,
  p_captain_customer_id UUID,
  p_player_customer_id UUID,
  p_team_name TEXT,
  p_registration_request_id TEXT,
  p_source_id UUID,
  p_age_confirmed BOOLEAN,
  p_quoted_price_minor INTEGER DEFAULT NULL,
  p_ttl_seconds INTEGER DEFAULT 1920
) RETURNS TABLE (
  ok BOOLEAN,
  team_entry_id UUID,
  hold_id UUID,
  available_count INTEGER,
  reason TEXT,
  applied_price_type TEXT,
  base_price_minor INTEGER,
  regular_price_minor INTEGER,
  regular_price_type TEXT,
  final_price_minor INTEGER,
  early_bird_remaining INTEGER,
  quote_changed BOOLEAN,
  team_capacity INTEGER,
  team_fill_before INTEGER,
  allocation_position INTEGER,
  early_bird_allocation_position INTEGER,
  membership_id UUID,
  membership_tier_id UUID,
  membership_tier_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reserved RECORD;
  v_context RECORD;
  v_membership RECORD;
  v_rule public.membership_tier_pricing%ROWTYPE;
  v_base_price INTEGER;
  v_member_price INTEGER;
  v_regular_price INTEGER;
  v_regular_type TEXT := 'league_team_base_price';
  v_final_price INTEGER;
  v_final_type TEXT;
  v_early_bird_remaining INTEGER;
  v_early_bird_position INTEGER;
  v_today DATE := (now() AT TIME ZONE 'Europe/Stockholm')::DATE;
BEGIN
  -- The original RPC remains the capacity/identity/League lock authority.
  -- Its row and product locks are retained until this outer transaction ends.
  SELECT * INTO v_reserved
  FROM public.reserve_league_team_entry(
    p_league_season_id,
    p_captain_user_id,
    p_captain_customer_id,
    p_player_customer_id,
    p_team_name,
    p_registration_request_id,
    p_source_id,
    p_age_confirmed,
    p_quoted_price_minor,
    p_ttl_seconds
  );

  ok := v_reserved.ok;
  team_entry_id := v_reserved.team_entry_id;
  hold_id := v_reserved.hold_id;
  available_count := v_reserved.available_count;
  reason := v_reserved.reason;
  applied_price_type := v_reserved.applied_price_type;
  base_price_minor := v_reserved.base_price_minor;
  regular_price_minor := v_reserved.base_price_minor;
  regular_price_type := 'league_team_base_price';
  final_price_minor := v_reserved.final_price_minor;
  early_bird_remaining := v_reserved.early_bird_remaining;
  quote_changed := v_reserved.quote_changed;
  team_capacity := v_reserved.team_capacity;
  team_fill_before := v_reserved.team_fill_before;
  allocation_position := v_reserved.allocation_position;
  early_bird_allocation_position := v_reserved.early_bird_allocation_position;
  membership_id := NULL;
  membership_tier_id := NULL;
  membership_tier_name := NULL;

  IF v_reserved.ok IS DISTINCT FROM true OR v_reserved.team_entry_id IS NULL OR v_reserved.hold_id IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    entry.purchase_provenance,
    season.venue_id,
    product.product_key,
    product.base_price_sek,
    product.early_bird_slots
  INTO v_context
  FROM public.league_team_entries entry
  JOIN public.league_seasons season ON season.id = entry.league_season_id
  JOIN public.activity_series series ON series.id = season.activity_series_id
  JOIN public.access_products product ON product.id = series.access_product_id
  WHERE entry.id = v_reserved.team_entry_id
  FOR UPDATE OF entry, product;

  IF v_context.product_key IS NULL THEN RAISE EXCEPTION 'league_pricing_context_missing'; END IF;
  v_base_price := ROUND(v_context.base_price_sek * 100)::INTEGER;
  IF v_base_price <= 0 OR v_base_price <> v_reserved.base_price_minor THEN
    RAISE EXCEPTION 'league_team_price_invalid';
  END IF;

  -- Existing holds and completed entries are already frozen. Read their V2
  -- provenance only; never re-evaluate after membership/configuration changes.
  IF v_reserved.reason <> 'held' THEN
    regular_price_minor := COALESCE((v_context.purchase_provenance->>'regular_price_minor')::INTEGER, v_reserved.base_price_minor);
    regular_price_type := COALESCE(v_context.purchase_provenance->>'regular_price_type', 'league_team_base_price');
    membership_id := NULLIF(v_context.purchase_provenance->>'membership_id', '')::UUID;
    membership_tier_id := NULLIF(v_context.purchase_provenance->>'membership_tier_id', '')::UUID;
    membership_tier_name := NULLIF(v_context.purchase_provenance->>'membership_tier_name', '');
    RETURN NEXT;
    RETURN;
  END IF;

  v_regular_price := v_base_price;

  SELECT membership.id, membership.tier_id, tier.name
  INTO v_membership
  FROM public.memberships membership
  JOIN public.membership_tiers tier ON tier.id = membership.tier_id
  WHERE membership.user_id = p_captain_user_id
    AND membership.venue_id = v_context.venue_id
    AND membership.status = 'active'
    AND membership.starts_at <= v_today
    AND (membership.expires_at IS NULL OR membership.expires_at >= v_today)
    AND (membership.customer_id IS NULL OR membership.customer_id = p_captain_customer_id)
    AND (tier.is_active = true OR tier.is_assignable = true)
  ORDER BY membership.created_at DESC, membership.id DESC
  LIMIT 1
  FOR SHARE OF membership, tier;

  IF v_membership.id IS NOT NULL THEN
    SELECT pricing.* INTO v_rule
    FROM public.membership_tier_pricing pricing
    WHERE pricing.tier_id = v_membership.tier_id
      AND pricing.product_type = v_context.product_key
      AND pricing.pricing_rule_id IS NULL
    FOR SHARE;

    IF v_rule.id IS NOT NULL THEN
      IF v_rule.fixed_price IS NOT NULL AND v_rule.discount_percent IS NULL
         AND v_rule.fixed_price > 0 THEN
        v_member_price := ROUND(v_rule.fixed_price * 100)::INTEGER;
      ELSIF v_rule.fixed_price IS NULL AND v_rule.discount_percent IS NOT NULL
         AND v_rule.discount_percent > 0 AND v_rule.discount_percent < 100 THEN
        v_member_price := ROUND(v_base_price * (100 - v_rule.discount_percent) / 100)::INTEGER;
      END IF;
      IF v_member_price > 0 AND v_member_price < v_base_price THEN
        v_regular_price := v_member_price;
        v_regular_type := 'membership_tier_pricing';
      END IF;
    END IF;
  END IF;

  v_final_price := v_regular_price;
  v_final_type := v_regular_type;
  v_early_bird_remaining := v_reserved.early_bird_remaining;
  v_early_bird_position := NULL;

  -- The old RPC evaluated the Early Bird candidate while holding the canonical
  -- team lock. It wins only when it is strictly lower than the verified regular
  -- candidate. A tie belongs to the member candidate and consumes no EB slot.
  IF v_reserved.applied_price_type = 'early_bird'
     AND v_reserved.final_price_minor < v_regular_price THEN
    v_final_price := v_reserved.final_price_minor;
    v_final_type := 'early_bird';
    v_early_bird_position := v_reserved.early_bird_allocation_position;
  ELSIF v_reserved.applied_price_type = 'early_bird' THEN
    v_early_bird_remaining := LEAST(
      COALESCE(v_context.early_bird_slots, 0),
      COALESCE(v_reserved.early_bird_remaining, 0) + 1
    );
  END IF;

  UPDATE public.league_team_entries entry
  SET pricing_reason = v_final_type,
      base_price_minor = v_base_price,
      final_price_minor = v_final_price,
      purchase_provenance = COALESCE(entry.purchase_provenance, '{}'::JSONB) || jsonb_build_object(
        'pricing_contract', 'catalog_dynamic_member_prices_v1',
        'regular_price_minor', v_regular_price,
        'regular_price_type', v_regular_type,
        'membership_id', v_membership.id,
        'membership_tier_id', v_membership.tier_id,
        'membership_tier_name', v_membership.name
      )
  WHERE entry.id = v_reserved.team_entry_id;

  UPDATE public.capacity_holds hold
  SET metadata = COALESCE(hold.metadata, '{}'::JSONB) || jsonb_build_object(
    'pricing_contract', 'catalog_dynamic_member_prices_v1',
    'applied_price_type', v_final_type,
    'base_price_minor', v_base_price,
    'regular_price_minor', v_regular_price,
    'regular_price_type', v_regular_type,
    'final_price_minor', v_final_price,
    'early_bird_remaining', COALESCE(v_early_bird_remaining, -1),
    'early_bird_allocation_position', v_early_bird_position,
    'membership_id', v_membership.id,
    'membership_tier_id', v_membership.tier_id,
    'membership_tier_name', v_membership.name
  )
  WHERE hold.id = v_reserved.hold_id;

  applied_price_type := v_final_type;
  regular_price_minor := v_regular_price;
  regular_price_type := v_regular_type;
  final_price_minor := v_final_price;
  early_bird_remaining := v_early_bird_remaining;
  quote_changed := p_quoted_price_minor IS NOT NULL AND p_quoted_price_minor <> v_final_price;
  early_bird_allocation_position := v_early_bird_position;
  membership_id := v_membership.id;
  membership_tier_id := v_membership.tier_id;
  membership_tier_name := v_membership.name;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_league_team_entry_v2(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_league_team_entry_v2(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, INTEGER, INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.reserve_league_team_entry_v2(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, INTEGER, INTEGER) IS
  'League V1 reservation with transactionally verified purchaser membership pricing; quoted price is comparison-only and never pricing authority.';
