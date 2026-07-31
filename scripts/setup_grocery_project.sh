#!/usr/bin/env bash
# Idempotently set up a grocery-store labeling project in a running Label
# Studio instance: find-or-create the project, wire a local-files import
# storage at $DATASET_DIR and sync it, optionally wire a local-files export
# storage at $EXPORT_DIR, and optionally register an ML backend. Safe to
# re-run — every step finds an existing resource before creating a new one,
# so this can be the "bring images in" half of a repeatable session script.
#
# Prereqs:
#   - Label Studio is running on $LS_URL with LOCAL_FILES_SERVING_ENABLED=true
#     and LOCAL_FILES_DOCUMENT_ROOT covering $DATASET_DIR (and $EXPORT_DIR,
#     if set).
#   - $LS_TOKEN is a personal access token for a user on that instance.
#
# Usage:
#   LS_TOKEN=... LS_URL=http://localhost:8080 DATASET_DIR=/root/datasets/grocery \
#     EXPORT_DIR=/root/datasets/grocery-export \
#     ML_BACKEND_URL=http://localhost:9091 \
#     scripts/setup_grocery_project.sh
#
# DATASET_DIR/EXPORT_DIR are stored in the API payload as-is, so they must be
# paths as LABEL STUDIO ITSELF sees them -- when LS runs in Docker (see
# tj-labeling-ops), that's a container-side path like /tj-data/frames, not
# the host path this script actually runs on. This script, though, runs on
# the HOST (it's a plain curl/bash script, not something exec'd inside the
# container), so a bare `[ -d "$DATASET_DIR" ]` or `mkdir -p "$EXPORT_DIR"`
# would check/create the WRONG path when those differ -- silently creating a
# bogus directory at the container path taken literally on the host, or
# failing with a confusing "does not exist" for a path that's real, just not
# from this side. DATASET_DIR_HOST/EXPORT_DIR_HOST let a containerized-LS
# caller supply the host-visible equivalent for those checks only; they
# default to the plain DATASET_DIR/EXPORT_DIR so a native (non-Docker) LS
# setup, where both sides see the same path, needs no changes.

set -euo pipefail

LS_URL="${LS_URL:-http://localhost:8080}"
LS_TOKEN="${LS_TOKEN:?LS_TOKEN env var is required (Label Studio legacy access token)}"
DATASET_DIR="${DATASET_DIR:?DATASET_DIR env var is required (absolute path to image directory, as Label Studio sees it)}"
DATASET_DIR_HOST="${DATASET_DIR_HOST:-$DATASET_DIR}"
EXPORT_DIR="${EXPORT_DIR:-}"
EXPORT_DIR_HOST="${EXPORT_DIR_HOST:-$EXPORT_DIR}"
ML_BACKEND_URL="${ML_BACKEND_URL:-}"
PROJECT_TITLE="${PROJECT_TITLE:-Grocery Store SKU Labeling}"

if [ ! -d "$DATASET_DIR_HOST" ]; then
  echo "ERROR: DATASET_DIR_HOST '$DATASET_DIR_HOST' does not exist" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/grocery_label_config.xml"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: label config not found at $CONFIG_FILE" >&2
  exit 1
fi

auth=( -H "Authorization: Token $LS_TOKEN" )

# Pull a JSON API response apart looking for one entry matching a field value,
# print its "id" if found (else nothing). Handles both paginated
# ({"results": [...]}) and bare-list API shapes.
find_id_by_field() {
  local field="$1" value="$2"
  python3 -c '
import json, sys
field, value = sys.argv[1], sys.argv[2]
data = json.load(sys.stdin)
results = data if isinstance(data, list) else data.get("results", [])
for item in results:
    if item.get(field) == value:
        print(item["id"])
        break
' "$field" "$value"
}

# ---------------------------------------------------------------------------
# Find-or-create the project
# ---------------------------------------------------------------------------
echo "==> Looking for existing project titled '$PROJECT_TITLE'"
project_id=$(curl -sS "${auth[@]}" "$LS_URL/api/projects/?page_size=200" | find_id_by_field title "$PROJECT_TITLE")

if [ -n "$project_id" ]; then
  echo "    found existing project id = $project_id"
else
  echo "==> Creating project: $PROJECT_TITLE"
  payload_file="$(mktemp)"
  trap 'rm -f "$payload_file"' EXIT
  python3 - "$PROJECT_TITLE" "$CONFIG_FILE" > "$payload_file" <<'PY'
import json, sys
title, cfg_path = sys.argv[1], sys.argv[2]
with open(cfg_path) as fh:
    label_config = fh.read()
print(json.dumps({"title": title, "label_config": label_config}))
PY
  project_json=$(curl -sSf -X POST "${auth[@]}" -H "Content-Type: application/json" \
    -d @"$payload_file" "$LS_URL/api/projects/")
  project_id=$(printf '%s' "$project_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  echo "    project id = $project_id"
fi

# ---------------------------------------------------------------------------
# Find-or-create the import storage, then sync (pick up any new files)
# ---------------------------------------------------------------------------
echo "==> Checking for existing local-files import storage (title=grocery-images)"
# Matched by title, not path: the in-browser folder picker (Data Manager
# toolbar) legitimately repoints this storage's path to a per-labeler
# in-progress/ subfolder, so matching on path would stop finding it and
# create a new duplicate storage every session once anyone uses the picker.
storage_id=$(curl -sS "${auth[@]}" "$LS_URL/api/storages/localfiles/?project=$project_id" | find_id_by_field title "grocery-images")

if [ -n "$storage_id" ]; then
  echo "    found existing storage id = $storage_id"
else
  echo "==> Creating local-files source storage pointing at $DATASET_DIR"
  storage_json=$(curl -sSf -X POST "${auth[@]}" -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"project": sys.argv[1], "path": sys.argv[2], "regex_filter": ".*\\.(jpg|jpeg|png|webp)$", "use_blob_urls": True, "recursive_scan": True, "title": "grocery-images"}))' "$project_id" "$DATASET_DIR")" \
    "$LS_URL/api/storages/localfiles/")
  storage_id=$(printf '%s' "$storage_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  echo "    storage id = $storage_id"
fi

echo "==> Syncing import storage (importing any new files as tasks)"
# Note: sync endpoint has no trailing slash, unlike most LS API routes
curl -sSf -X POST "${auth[@]}" "$LS_URL/api/storages/localfiles/$storage_id/sync" >/dev/null

# ---------------------------------------------------------------------------
# Optional: find-or-create the export storage
# ---------------------------------------------------------------------------
if [ -n "$EXPORT_DIR" ]; then
  mkdir -p "$EXPORT_DIR_HOST"
  echo "==> Checking for existing local-files export storage at $EXPORT_DIR"
  # NOTE: export storage routes have NO trailing slash (unlike the import
  # routes above, which do) — a trailing slash here 404s to the SPA HTML page.
  export_id=$(curl -sS "${auth[@]}" "$LS_URL/api/storages/export/localfiles?project=$project_id" | find_id_by_field path "$EXPORT_DIR")

  if [ -n "$export_id" ]; then
    echo "    found existing export storage id = $export_id"
  else
    echo "==> Creating local-files export storage at $EXPORT_DIR"
    curl -sSf -X POST "${auth[@]}" -H "Content-Type: application/json" \
      -d "$(python3 -c 'import json,sys; print(json.dumps({"project": sys.argv[1], "path": sys.argv[2], "title": "grocery-export"}))' "$project_id" "$EXPORT_DIR")" \
      "$LS_URL/api/storages/export/localfiles" >/dev/null
  fi
fi

# ---------------------------------------------------------------------------
# Optional: find-or-create the ML backend registration
# ---------------------------------------------------------------------------
if [ -n "$ML_BACKEND_URL" ]; then
  echo "==> Checking for existing ML backend registration ($ML_BACKEND_URL)"
  ml_id=$(curl -sS "${auth[@]}" "$LS_URL/api/ml?project=$project_id" | find_id_by_field url "$ML_BACKEND_URL")

  if [ -n "$ml_id" ]; then
    echo "    found existing ML backend id = $ml_id"
  else
    echo "==> Registering ML backend $ML_BACKEND_URL"
    curl -sSf -X POST "${auth[@]}" -H "Content-Type: application/json" \
      -d "$(python3 -c 'import json,sys; print(json.dumps({"url": sys.argv[1], "project": sys.argv[2]}))' "$ML_BACKEND_URL" "$project_id")" \
      "$LS_URL/api/ml" >/dev/null
  fi
fi

echo
echo "Done."
echo "Project URL: $LS_URL/projects/$project_id/data"
echo "PROJECT_ID=$project_id"
