#!/usr/bin/env bash
# Create a grocery-store labeling project in a running Label Studio instance,
# wire a local-files storage at $DATASET_DIR, and trigger a sync.
#
# Prereqs:
#   - Label Studio is running on $LS_URL with LABEL_STUDIO_LOCAL_FILES_SERVING_ENABLED=true
#     and LABEL_STUDIO_LOCAL_FILES_DOCUMENT_ROOT covering $DATASET_DIR.
#   - $LS_TOKEN is a personal access token for a user on that instance.
#
# Usage:
#   LS_TOKEN=... LS_URL=http://localhost:8080 DATASET_DIR=/root/datasets/grocery \
#     scripts/setup_grocery_project.sh

set -euo pipefail

LS_URL="${LS_URL:-http://localhost:8080}"
LS_TOKEN="${LS_TOKEN:?LS_TOKEN env var is required (Label Studio legacy access token)}"
DATASET_DIR="${DATASET_DIR:?DATASET_DIR env var is required (absolute path to image directory)}"
PROJECT_TITLE="${PROJECT_TITLE:-Grocery Store SKU Labeling}"

if [ ! -d "$DATASET_DIR" ]; then
  echo "ERROR: DATASET_DIR '$DATASET_DIR' does not exist" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/grocery_label_config.xml"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: label config not found at $CONFIG_FILE" >&2
  exit 1
fi

auth=( -H "Authorization: Token $LS_TOKEN" )

# Build a JSON payload with the label config inlined.
payload_file="$(mktemp)"
trap 'rm -f "$payload_file"' EXIT
python3 - "$PROJECT_TITLE" "$CONFIG_FILE" > "$payload_file" <<'PY'
import json, sys
title, cfg_path = sys.argv[1], sys.argv[2]
with open(cfg_path) as fh:
    label_config = fh.read()
print(json.dumps({"title": title, "label_config": label_config}))
PY

echo "==> Creating project: $PROJECT_TITLE"
project_json=$(curl -sS -X POST "${auth[@]}" -H "Content-Type: application/json" \
  -d @"$payload_file" "$LS_URL/api/projects/")
project_id=$(printf '%s' "$project_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "    project id = $project_id"

echo "==> Creating local-files source storage pointing at $DATASET_DIR"
storage_json=$(curl -sS -X POST "${auth[@]}" -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"project": int(sys.argv[1]), "path": sys.argv[2], "regex_filter": ".*\\.(jpg|jpeg|png|webp)$", "use_blob_urls": True, "recursive_scan": True, "title": "grocery-images"}))' "$project_id" "$DATASET_DIR")" \
  "$LS_URL/api/storages/localfiles/")
storage_id=$(printf '%s' "$storage_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "    storage id = $storage_id"

echo "==> Syncing storage (importing tasks)"
# Note: sync endpoint has no trailing slash, unlike most LS API routes
curl -sS -X POST "${auth[@]}" "$LS_URL/api/storages/localfiles/$storage_id/sync" >/dev/null

echo
echo "Done."
echo "Project URL: $LS_URL/projects/$project_id/data"
