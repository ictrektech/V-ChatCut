#!/usr/bin/env bash
set -euo pipefail

APP_LABEL="v_chatcut"
TAG_PREFIX="vos-v-chatcut-v"
VERSION_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/VERSION"
REPO_ROOT="$(git -C "$(dirname "$VERSION_FILE")" rev-parse --show-toplevel)"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/update_version.sh [patch|minor|major]

Updates ictrek.app/VERSION, commits it, pushes the current branch, and pushes
the vos-v-chatcut-vX.Y.Z CI trigger tag. GitHub Actions creates the public
vX.Y.Z tag and release.
EOF
}

bump_version() {
  local part="$1" current major minor patch
  current="$(tr -d '[:space:]' < "$VERSION_FILE")"
  [[ "$current" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "invalid VERSION: $current" >&2
    exit 1
  }
  IFS=. read -r major minor patch <<< "$current"
  case "$part" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    major) major=$((major + 1)); minor=0; patch=0 ;;
    *) usage >&2; exit 1 ;;
  esac
  printf '%s.%s.%s\n' "$major" "$minor" "$patch"
}

remote_tag_exists() {
  git ls-remote --exit-code --tags origin "refs/tags/$1" >/dev/null 2>&1
}

part="${1:-patch}"
[[ "$part" != -h && "$part" != --help ]] || { usage; exit 0; }

cd "$REPO_ROOT"
[[ -z "$(git status --porcelain)" ]] || {
  echo "worktree is not clean; commit code changes before releasing" >&2
  exit 1
}

version="$(bump_version "$part")"
trigger_tag="${TAG_PREFIX}${version}"
public_tag="v${version}"

remote_tag_exists "$trigger_tag" && {
  echo "VOS trigger tag already exists on origin: ${trigger_tag}" >&2
  exit 1
}
git rev-parse -q --verify "refs/tags/${trigger_tag}" >/dev/null && {
  echo "VOS trigger tag already exists locally: ${trigger_tag}" >&2
  exit 1
}
remote_tag_exists "$public_tag" && {
  echo "public release tag already exists on origin: ${public_tag}" >&2
  exit 1
}
git rev-parse -q --verify "refs/tags/${public_tag}" >/dev/null && {
  echo "public release tag already exists locally: ${public_tag}" >&2
  exit 1
}

printf '%s\n' "$version" > "$VERSION_FILE"
git add "$VERSION_FILE"
git commit -m "chore: release VOS ${APP_LABEL} ${version}"
git tag "$trigger_tag"
branch="$(git branch --show-current)"
[[ -n "$branch" ]] || { echo "cannot release from detached HEAD" >&2; exit 1; }
git push origin "$branch"
git push origin "$trigger_tag"

echo "Pushed ${trigger_tag}. GitHub Actions will create release ${public_tag}."
