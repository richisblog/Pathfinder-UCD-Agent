#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
test_root="$(mktemp -d /tmp/pathfinder-stage-data-test.XXXXXX)"
source_root="$test_root/source"
app_bundle="$test_root/Pathfinder Test.app"

cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT

fail() {
  print -u2 -- "$1"
  exit 1
}

mkdir -p "$source_root/sqlite" "$source_root/txt" "$app_bundle/Contents/Resources"
for name in rmp.db courses.db majors.db changemajor.db ucdavis_calendar.db app.db users.db; do
  sqlite3 "$source_root/sqlite/$name" 'CREATE TABLE package_test (value TEXT); INSERT INTO package_test VALUES ("ok");'
done
touch "$source_root/sqlite/rmp.db.bak" "$source_root/sqlite/rmp.db-wal" "$source_root/sqlite/rmp.db-shm"
touch "$source_root/.DS_Store" "$source_root/sqlite/.DS_Store"
print -- "Policy text" > "$source_root/txt/policy.md"
print -- "Placement text" > "$source_root/txt/placement.txt"
print -- "do not package" > "$source_root/txt/private.json"

zsh "$script_dir/stage-runtime-data.sh" "$source_root" "$app_bundle"

sqlite_dir="$app_bundle/Contents/Resources/data/sqlite"
chat_dir="$app_bundle/Contents/Resources/data/chat"
expected=(changemajor.db courses.db majors.db rmp.db ucdavis_calendar.db)
actual=("$sqlite_dir"/*.db(N:t))
[[ "${(j: :)actual}" == "${(j: :)expected}" ]] || fail "database allowlist mismatch: ${(j: :)actual}"
[[ -d "$chat_dir" ]] || fail "empty chat directory is missing"
[[ -z "$(find "$chat_dir" -mindepth 1 -print -quit)" ]] || fail "chat directory is not empty"

policy_files=("$app_bundle/Contents/Resources/data/txt"/*(N:t))
[[ "${(j: :)policy_files}" == "placement.txt policy.md" ]] || fail "policy allowlist mismatch: ${(j: :)policy_files}"

for forbidden in app.db users.db '*.bak' '*-wal' '*-shm' .DS_Store private.json; do
  if find "$app_bundle/Contents/Resources/data" -name "$forbidden" -print -quit | grep -q .; then
    fail "forbidden packaged resource matched $forbidden"
  fi
done

for database in "$sqlite_dir"/*.db(N); do
  [[ "$(sqlite3 "$database" 'PRAGMA integrity_check;')" == "ok" ]] || fail "integrity check failed for ${database:t}"
done

package_script="$script_dir/package-local-dmg.sh"
stage_line="$(grep -n 'stage-runtime-data.sh.*data_source' "$package_script" | head -n 1 | cut -d: -f1)"
sign_line="$(grep -n 'codesign --force' "$package_script" | head -n 1 | cut -d: -f1)"
[[ -n "$stage_line" && -n "$sign_line" && "$stage_line" -lt "$sign_line" ]] || \
  fail "DMG builder must stage allowlisted data before signing"
grep -q 'stage-runtime-data.sh.*--verify' "$package_script" || \
  fail "DMG builder must verify mounted runtime data"

print -- "stage-runtime-data test: PASS"
