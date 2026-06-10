#!/usr/bin/env bash
# Trigger a deployment of the sync relay backend to AI Builder Space.
# The platform pulls code from GitHub, so push your changes first.
# The token is read from the environment — never commit it.
#
#   AI_BUILDER_TOKEN=sk_... bash deploy.sh
#
set -euo pipefail
: "${AI_BUILDER_TOKEN:?set AI_BUILDER_TOKEN first}"

curl -sS -X POST "https://space.ai-builders.com/backend/v1/deployments" \
  -H "Authorization: Bearer ${AI_BUILDER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "repo_url": "https://github.com/zhangboy03/brain-aging-defense",
    "service_name": "brain-aging-sync",
    "branch": "main"
  }'
