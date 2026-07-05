#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${1:-}"

if [[ -z "$PROJECT_REF" ]]; then
  echo "Usage: scripts/deploy-stage-functions.sh <stage-project-ref>" >&2
  exit 1
fi

if [[ "$PROJECT_REF" == "ptnvhbniiiapzbyofctg" ]]; then
  echo "Refusing to deploy stage functions to production project ref: $PROJECT_REF" >&2
  exit 1
fi

functions=(
  api-admin
  api-auth
  api-bookings
  api-checkins
  api-corporate
  api-customers
  api-day-passes
  api-event-public
  api-event-templates
  api-events
  api-link-preview
  api-matches
  api-memberships
  api-notifications
  api-ops
  api-score
  api-stripe
  api-stripe-webhook
)

for fn in "${functions[@]}"; do
  echo "Deploying $fn to $PROJECT_REF"
  supabase functions deploy "$fn" --no-verify-jwt --project-ref "$PROJECT_REF"
done
