#!/usr/bin/env bash
set -euo pipefail

APP_NAME="v_chatcut"
APP_ID="com.ictrek.v-chatcut"
ROUTER_PAGE_ID="v-chatcut"
ROUTER_HASH_PATH="#/app/com.ictrek.v-chatcut/v-chatcut"
FRONTEND_BASE_PATH="/app/com.ictrek.v-chatcut"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${ROOT_DIR}/.." && pwd)"
SRC_DIR="${ROOT_DIR}/src"
DIST_DIR="${ROOT_DIR}/dist"
STAGE_DIR="${DIST_DIR}/staging"
PACKAGE_ROOT="${DIST_DIR}/package-root"
VERSION_FILE="${ROOT_DIR}/VERSION"
LOCK_DIR="${DIST_DIR}/.package.lock"
FEISHU_HELPER="${REPO_ROOT}/vos_docker/feishu_components.py"
BACKEND_COMPONENT="v-chatcut-backend"
FRONTEND_COMPONENT="v-chatcut-frontend"
BACKEND_REPOSITORY="swr.cn-southwest-2.myhuaweicloud.com/ictrek/v-chatcut-backend"
FRONTEND_REPOSITORY="swr.cn-southwest-2.myhuaweicloud.com/ictrek/v-chatcut-frontend"

PROFILES=(
  "AMD_WITH_CUDA|AMD_with_cuda"
  "AMD_WITHOUT_CUDA|AMD_with_mxn100"
  "ARM_WITH_CUDA|ARM_with_cuda"
  "ARM_WITHOUT_CUDA|ARM_without_cuda"
  "L4T|l4t"
  "THOR_SPARK|thor_spark"
)

log() { echo "[INFO] $*"; }
die() { echo "[ERROR] $*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

usage() {
  cat <<'EOF'
Usage:
  ./scripts/package.sh

Creates one pull-mode VOS package for all six profiles. Image repositories and
tags are read from the shared Feishu component table; the package never embeds
Docker image archives.
EOF
}

validate_yaml_file() {
  local file="$1"
  if python3 - "$file" <<'PY' 2>/dev/null
import sys
import yaml
with open(sys.argv[1], "r", encoding="utf-8") as stream:
    yaml.safe_load(stream)
PY
  then
    return 0
  fi
  command -v ruby >/dev/null 2>&1 || die "missing PyYAML and ruby; cannot validate ${file}"
  ruby -e 'require "yaml"; YAML.load_file(ARGV.fetch(0))' "$file"
}

render_text_file() {
  local source="$1" destination="$2"
  python3 - "$source" "$destination" "$APP_VERSION" <<'PY'
import sys
from pathlib import Path
source, destination = Path(sys.argv[1]), Path(sys.argv[2])
destination.write_text(
    source.read_text(encoding="utf-8").replace("__APP_VERSION__", sys.argv[3]),
    encoding="utf-8",
)
PY
}

render_compose_file() {
  local source="$1" destination="$2" env_file="$3"
  python3 - "$source" "$destination" "$APP_VERSION" "$env_file" <<'PY'
import re
import sys
from pathlib import Path

source, destination = Path(sys.argv[1]), Path(sys.argv[2])
version, env_path = sys.argv[3], Path(sys.argv[4])
environment = {}
for line in env_path.read_text(encoding="utf-8").splitlines():
    if line and not line.startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        environment[key] = value

text = source.read_text(encoding="utf-8").replace("__APP_VERSION__", version)
text = re.sub(
    r"\$\{([A-Z0-9_]+)(?::-[^}]*)?\}",
    lambda match: environment.get(match.group(1), match.group(0))
    if match.group(1).endswith("_IMAGE") else match.group(0),
    text,
)
destination.write_text(text, encoding="utf-8")
PY
}

latest_from_candidates() {
  local component="$1" repository="$2"
  shift 2
  local sheet image
  for sheet in "$@"; do
    if image="$(python3 "$FEISHU_HELPER" latest \
      --sheet "$sheet" \
      --component "$component" \
      --fallback-repository "$repository" 2>/dev/null)"; then
      [[ -n "$image" ]] && { printf '%s\n' "$image"; return 0; }
    fi
  done
  return 1
}

verify_package() {
  local package_path="$1" app_tarball="$2"
  local outer inner package_text compose_text manifest_text routers_text
  outer="$(tar tf "$package_path")"
  [[ "$outer" == "app.tar.gz" ]] || die "outer package must contain only app.tar.gz"
  inner="$(tar tzf "$app_tarball")"
  for required in .env manifest.yml docker-compose.yml configs.yml routers.yml icon.png README.zh-CN.md README.en.md; do
    printf '%s\n' "$inner" | grep -qx "$required" || die "app.tar.gz is missing ${required}"
  done
  python3 - "$app_tarball" <<'PY'
import struct
import sys
import tarfile

with tarfile.open(sys.argv[1], "r:gz") as archive:
    icon = archive.extractfile("icon.png")
    if icon is None:
        raise SystemExit("icon.png is missing")
    header = icon.read(26)
if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
    raise SystemExit("icon.png is not a valid PNG")
width, height, bit_depth, color_type = struct.unpack(">IIBB", header[16:26])
if (width, height, bit_depth, color_type) != (256, 256, 8, 6):
    raise SystemExit(
        f"icon.png must be 256x256 8-bit RGBA, got {width}x{height}, "
        f"bit_depth={bit_depth}, color_type={color_type}"
    )
PY

  package_text="$(printf '%s\n' "$inner" | while IFS= read -r file; do
    [[ "$file" == icon.png ]] && continue
    tar xOf "$app_tarball" "$file"
    printf '\n'
  done)"
  ! printf '%s' "$package_text" | grep -Eq '__[A-Z0-9_]+__' || die "unrendered template placeholder remains"

  compose_text="$(tar xOf "$app_tarball" docker-compose.yml)"
  ! printf '%s\n' "$compose_text" | grep -Eq '\$\{[^}]*_IMAGE[^}]*\}' || die "unrendered image variable remains"
  if printf '%s\n' "$compose_text" | awk '/^[[:space:]]*image:/ {print $2}' \
    | grep -Ev '^[^/[:space:]]+\.[^/[:space:]]+/.+:[^/[:space:]]+$' | grep -q .; then
    die "docker-compose.yml contains a short or untagged image reference"
  fi
  printf '%s\n' "$compose_text" | grep -Fq 'HeaderRegexp(`Sec-Fetch-Dest`, `document`)' \
    || die "top-level document redirect is missing"
  printf '%s\n' "$compose_text" | grep -Fq "$ROUTER_HASH_PATH" \
    || die "top-level document redirect targets the wrong VOS route"
  printf '%s\n' "$compose_text" | grep -Fq 'external: true' || die "vos_default must be external"
  printf '%s\n' "$compose_text" | grep -Fq 'v-chatcut-frontend' || die "frontend network alias is missing"
  printf '%s\n' "$compose_text" | grep -Fq 'v-chatcut-backend' || die "backend network alias is missing"

  manifest_text="$(tar xOf "$app_tarball" manifest.yml)"
  printf '%s\n' "$manifest_text" | grep -Fq "  basePath: ${FRONTEND_BASE_PATH}" \
    || die "manifest frontend basePath is invalid"

  routers_text="$(tar xOf "$app_tarball" routers.yml)"
  printf '%s\n' "$routers_text" | grep -Fq "  - id: ${ROUTER_PAGE_ID}" || die "router page id is invalid"
  printf '%s\n' "$routers_text" | grep -Fq "    kind: page" || die "router must be a top-level page"
  ! printf '%s\n' "$routers_text" | grep -q 'kind:[[:space:]]*group' || die "router must not declare a group"
  printf '%s\n' "$routers_text" | grep -Fq "    iframe-src: /app/${APP_ID}/?v=${APP_VERSION}" \
    || die "router iframe-src is invalid"
  printf '%s\n' "$routers_text" | grep -q 'entry-point:[[:space:]]*true' || die "entry-point is missing"
  printf '%s\n' "$routers_text" | grep -q 'embed:[[:space:]]*true' || die "embed is missing"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-source)
      [[ "${2:-}" == pull ]] || die "only pull mode is supported"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

require_cmd python3
require_cmd tar
[[ -f "$FEISHU_HELPER" ]] || die "missing Feishu helper: $FEISHU_HELPER"

mkdir -p "$DIST_DIR"
while ! mkdir "$LOCK_DIR" 2>/dev/null; do sleep 1; done
trap 'rm -rf "$LOCK_DIR"' EXIT

APP_VERSION="${PACKAGE_VERSION:-$(tr -d '[:space:]' < "$VERSION_FILE")}"
[[ "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid package version: $APP_VERSION"
log "Package version: ${APP_VERSION}"

rm -rf "$STAGE_DIR" "$PACKAGE_ROOT"
mkdir -p "$STAGE_DIR" "$PACKAGE_ROOT"
ENV_FILE="${STAGE_DIR}/.env"
: > "$ENV_FILE"

amd_frontend="$(latest_from_candidates "$FRONTEND_COMPONENT" "$FRONTEND_REPOSITORY" AMD_with_mxn100 AMD_with_cuda)" \
  || die "failed to resolve AMD frontend image"
arm_frontend="$(latest_from_candidates "$FRONTEND_COMPONENT" "$FRONTEND_REPOSITORY" ARM_without_cuda ARM_with_cuda l4t thor_spark)" \
  || die "failed to resolve ARM frontend image"
printf 'V_CHATCUT_FRONTEND_AMD_IMAGE=%s\n' "$amd_frontend" >> "$ENV_FILE"
printf 'V_CHATCUT_FRONTEND_ARM_IMAGE=%s\n' "$arm_frontend" >> "$ENV_FILE"

for profile_spec in "${PROFILES[@]}"; do
  IFS='|' read -r profile_key sheet <<< "$profile_spec"
  image="$(latest_from_candidates "$BACKEND_COMPONENT" "$BACKEND_REPOSITORY" "$sheet")" \
    || die "failed to resolve backend image for ${sheet}"
  printf 'V_CHATCUT_BACKEND_%s_IMAGE=%s\n' "$profile_key" "$image" >> "$ENV_FILE"
done

for file in manifest.yml configs.yml routers.yml README.zh-CN.md README.en.md; do
  render_text_file "${SRC_DIR}/${file}" "${STAGE_DIR}/${file}"
done
cp "${SRC_DIR}/icon.png" "${STAGE_DIR}/icon.png"
render_compose_file "${SRC_DIR}/docker-compose.yml" "${STAGE_DIR}/docker-compose.yml" "$ENV_FILE"

for file in manifest.yml configs.yml routers.yml docker-compose.yml; do
  validate_yaml_file "${STAGE_DIR}/${file}"
done

APP_TARBALL="${DIST_DIR}/app.tar.gz"
PACKAGE_PATH="${DIST_DIR}/${APP_NAME}_${APP_VERSION}_pull.tar"
TAR_FILES=(.env manifest.yml docker-compose.yml configs.yml routers.yml icon.png README.zh-CN.md README.en.md)
tar czf "$APP_TARBALL" -C "$STAGE_DIR" "${TAR_FILES[@]}"
cp "$APP_TARBALL" "${PACKAGE_ROOT}/app.tar.gz"
tar cf "$PACKAGE_PATH" -C "$PACKAGE_ROOT" app.tar.gz
verify_package "$PACKAGE_PATH" "$APP_TARBALL"
log "Package created: ${PACKAGE_PATH}"
