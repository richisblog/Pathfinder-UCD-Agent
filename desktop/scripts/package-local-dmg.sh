#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h:h}"
source_app="$repo_root/desktop/build/bin/pathfinder-ucd.app"
data_source="${PATHFINDER_DATA_SOURCE:-$repo_root/desktop/PathfinderUCD.app/Contents/Resources/data}"
repo_dmg="$repo_root/dist/PathfinderUCD-darwin-arm64.dmg"
desktop_dmg="/Users/richis/Desktop/PathfinderUCD.dmg"
stage_dir="$(mktemp -d /tmp/pathfinder-dmg-stage.XXXXXX)"
image_dir="$(mktemp -d /tmp/pathfinder-dmg-image.XXXXXX)"
mount_dir="$(mktemp -d /tmp/pathfinder-dmg-mount.XXXXXX)"
temp_dmg="$image_dir/PathfinderUCD.dmg"

cleanup() {
  hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
  rm -rf "$stage_dir" "$image_dir" "$mount_dir"
}
trap cleanup EXIT

test -d "$source_app"
ditto --noextattr --noqtn "$source_app" "$stage_dir/Pathfinder UCD.app"
zsh "$repo_root/desktop/scripts/stage-runtime-data.sh" "$data_source" "$stage_dir/Pathfinder UCD.app"
xattr -cr "$stage_dir/Pathfinder UCD.app"
codesign --force --deep -s - "$stage_dir/Pathfinder UCD.app"
codesign --verify --deep --strict "$stage_dir/Pathfinder UCD.app"
ln -s /Applications "$stage_dir/Applications"

hdiutil create -quiet -volname "Pathfinder UCD" -srcfolder "$stage_dir" -format UDZO "$temp_dmg"
hdiutil verify "$temp_dmg"
hdiutil attach -quiet -readonly -nobrowse -mountpoint "$mount_dir" "$temp_dmg"
test -d "$mount_dir/Pathfinder UCD.app"
test -L "$mount_dir/Applications"
zsh "$repo_root/desktop/scripts/stage-runtime-data.sh" --verify "$mount_dir/Pathfinder UCD.app"
codesign --verify --deep --strict "$mount_dir/Pathfinder UCD.app"
file "$mount_dir/Pathfinder UCD.app/Contents/MacOS/pathfinder-ucd" | grep -q "arm64"
hdiutil detach -quiet "$mount_dir"

mkdir -p "${repo_dmg:h}"
cp -f "$temp_dmg" "$repo_dmg"
cp -f "$temp_dmg" "$desktop_dmg"
cmp -s "$repo_dmg" "$desktop_dmg"
shasum -a 256 "$repo_dmg"
