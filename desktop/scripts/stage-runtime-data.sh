#!/bin/zsh
set -euo pipefail

required_databases=(changemajor.db courses.db majors.db rmp.db ucdavis_calendar.db)

fail() {
  print -u2 -- "Pathfinder data packaging error: $1"
  exit 1
}

verify_runtime_data() {
  local app_bundle="$1"
  local data_root="$app_bundle/Contents/Resources/data"
  local sqlite_dir="$data_root/sqlite"
  local text_dir="$data_root/txt"
  local chat_dir="$data_root/chat"

  [[ -d "$sqlite_dir" ]] || fail "missing packaged SQLite directory"
  [[ -d "$text_dir" ]] || fail "missing packaged policy-text directory"
  [[ -d "$chat_dir" ]] || fail "missing empty packaged chat directory"
  [[ -z "$(find "$chat_dir" -mindepth 1 -print -quit)" ]] || fail "packaged chat directory must be empty"

  local actual=("$sqlite_dir"/*.db(N:t))
  [[ "${(j: :)actual}" == "${(j: :)required_databases}" ]] || \
    fail "database allowlist mismatch: expected ${(j: :)required_databases}; found ${(j: :)actual}"

  local forbidden
  for forbidden in app.db users.db '*.bak' '*-wal' '*-shm' .DS_Store; do
    if find "$data_root" -name "$forbidden" -print -quit | grep -q .; then
      fail "forbidden packaged resource matched $forbidden"
    fi
  done

  local policy_files=("$text_dir"/*.(txt|md)(N))
  (( ${#policy_files} > 0 )) || fail "no packaged .txt or .md policy sources"

  local database integrity
  for database in "$sqlite_dir"/*.db(N); do
    integrity="$(sqlite3 "$database" 'PRAGMA integrity_check;')"
    [[ "$integrity" == "ok" ]] || fail "SQLite integrity check failed for ${database:t}: $integrity"
  done
}

stage_runtime_data() {
  local source_root="$1"
  local app_bundle="$2"
  local resources_root="$app_bundle/Contents/Resources"
  local data_root="$resources_root/data"

  [[ -d "$source_root/sqlite" ]] || fail "source SQLite directory does not exist: $source_root/sqlite"
  [[ -d "$source_root/txt" ]] || fail "source policy-text directory does not exist: $source_root/txt"
  [[ -d "$resources_root" ]] || fail "application Resources directory does not exist: $resources_root"

  rm -rf "$data_root"
  mkdir -p "$data_root/sqlite" "$data_root/txt" "$data_root/chat"

  local database source_database
  for database in $required_databases; do
    source_database="$source_root/sqlite/$database"
    [[ -f "$source_database" ]] || fail "required source database is missing: $database"
    ditto --noextattr --noqtn "$source_database" "$data_root/sqlite/$database"
  done

  local policy_file
  while IFS= read -r -d '' policy_file; do
    ditto --noextattr --noqtn "$policy_file" "$data_root/txt/${policy_file:t}"
  done < <(find "$source_root/txt" -maxdepth 1 -type f \( -name '*.txt' -o -name '*.md' \) -print0)

  verify_runtime_data "$app_bundle"
}

case "${1:-}" in
  --verify)
    (( $# == 2 )) || fail "usage: $0 --verify <app-bundle>"
    verify_runtime_data "$2"
    ;;
  *)
    (( $# == 2 )) || fail "usage: $0 <source-data-root> <app-bundle>"
    stage_runtime_data "$1" "$2"
    ;;
esac
