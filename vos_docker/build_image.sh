#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REGISTRY="${V_CHATCUT_REGISTRY:-swr.cn-southwest-2.myhuaweicloud.com/ictrek}"
BACKEND_COMPONENT="v-chatcut-backend"
FRONTEND_COMPONENT="v-chatcut-frontend"
BACKEND_REPOSITORY="${REGISTRY}/${BACKEND_COMPONENT}"
FRONTEND_REPOSITORY="${REGISTRY}/${FRONTEND_COMPONENT}"
FEISHU_HELPER="${ROOT_DIR}/vos_docker/feishu_components.py"

TARGET_SHEETS=()
COMPONENTS=()

log() { echo "[INFO] $*"; }
die() { echo "[ERROR] $*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

sheet_spec() {
  case "$1" in
    AMD_with_cuda)
      printf '%s|%s|%s|%s\n' amd-with-cuda amd_cu128 vos_docker/Dockerfile.backend.amd-with-cuda amd
      ;;
    AMD_with_mxn100)
      printf '%s|%s|%s|%s\n' amd-without-cuda amd vos_docker/Dockerfile.backend.amd-without-cuda amd
      ;;
    ARM_with_cuda)
      printf '%s|%s|%s|%s\n' arm-with-cuda arm_cu128 vos_docker/Dockerfile.backend.arm-with-cuda arm
      ;;
    ARM_without_cuda)
      printf '%s|%s|%s|%s\n' arm-without-cuda arm vos_docker/Dockerfile.backend.arm-without-cuda arm
      ;;
    l4t)
      printf '%s|%s|%s|%s\n' l4t l4t vos_docker/Dockerfile.backend.l4t arm
      ;;
    thor_spark)
      printf '%s|%s|%s|%s\n' thor-spark thor vos_docker/Dockerfile.backend.thor-spark arm
      ;;
    *) return 1 ;;
  esac
}

frontend_sheets() {
  case "$1" in
    amd) printf '%s\n' AMD_with_cuda AMD_with_mxn100 ;;
    arm) printf '%s\n' ARM_with_cuda ARM_without_cuda l4t thor_spark ;;
    *) return 1 ;;
  esac
}

usage() {
  cat <<'EOF'
Usage:
  ./vos_docker/build_image.sh --sheet AMD_with_cuda [--component backend|frontend]
  ./vos_docker/build_image.sh --sheet ARM_with_cuda --sheet l4t

Supported sheets:
  AMD_with_cuda, AMD_with_mxn100, ARM_with_cuda, ARM_without_cuda, l4t, thor_spark

At least one --sheet is required. Backends are profile-specific. A frontend is
built once per selected CPU architecture and its shared tag is written to every
matching architecture sheet.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sheet)
      [[ -n "${2:-}" ]] || die "--sheet requires a value"
      TARGET_SHEETS+=("$2")
      shift 2
      ;;
    --component)
      [[ -n "${2:-}" ]] || die "--component requires a value"
      COMPONENTS+=("$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "unknown option: $1" ;;
  esac
done

[[ ${#TARGET_SHEETS[@]} -gt 0 ]] || die "at least one --sheet is required"
[[ ${#COMPONENTS[@]} -gt 0 ]] || COMPONENTS=(backend frontend)
for component in "${COMPONENTS[@]}"; do
  [[ "$component" == backend || "$component" == frontend ]] || die "unsupported component: $component"
done

for sheet in "${TARGET_SHEETS[@]}"; do
  sheet_spec "$sheet" >/dev/null || die "unsupported sheet: $sheet"
done

case "$(uname -m)" in
  x86_64|amd64)
    HOST_ARCH=amd
    BUILD_HOST_ROLE=amd
    ;;
  aarch64|arm64)
    HOST_ARCH=arm
    device_model="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || true)"
    tegra_release="$(cat /etc/nv_tegra_release 2>/dev/null || true)"
    if [[ "$device_model" == *Thor* || "$tegra_release" == *R39* ]]; then
      BUILD_HOST_ROLE=thor
    elif [[ "$tegra_release" == *R36* ]]; then
      BUILD_HOST_ROLE=l4t
    else
      die "unsupported ARM build host: expected tc192/L4T R36 or tc229/Thor R39"
    fi
    ;;
  *) die "unsupported build-host architecture: $(uname -m)" ;;
esac
for sheet in "${TARGET_SHEETS[@]}"; do
  IFS='|' read -r _ _ _ target_arch <<< "$(sheet_spec "$sheet")"
  [[ "$target_arch" == "$HOST_ARCH" ]] || die "sheet ${sheet} requires a ${target_arch} build host, current host is ${HOST_ARCH}"
  case "$BUILD_HOST_ROLE:$sheet" in
    amd:AMD_with_cuda|amd:AMD_with_mxn100|l4t:ARM_without_cuda|l4t:l4t|thor:ARM_with_cuda|thor:thor_spark) ;;
    *) die "sheet ${sheet} is not assigned to this ${BUILD_HOST_ROLE} build host" ;;
  esac
done

require_cmd docker
require_cmd python3
docker buildx version >/dev/null 2>&1 || die "docker buildx is required"
[[ -f "$FEISHU_HELPER" ]] || die "missing Feishu helper: $FEISHU_HELPER"

DATE="$(date +%Y%m%d)"
NODE_BASE_IMAGE="${V_CHATCUT_NODE_BASE_IMAGE:-${REGISTRY}/node:${HOST_ARCH}_24-bookworm-slim}"
FRONTEND_NODE_BASE_IMAGE="${V_CHATCUT_FRONTEND_NODE_BASE_IMAGE:-${REGISTRY}/node:${HOST_ARCH}_24-alpine}"
NGINX_BASE_IMAGE="${V_CHATCUT_NGINX_BASE_IMAGE:-${REGISTRY}/nginx:${HOST_ARCH}_1.29-alpine}"

if contains frontend "${COMPONENTS[@]}"; then
  selected_arches=()
  for sheet in "${TARGET_SHEETS[@]}"; do
    IFS='|' read -r _ _ _ target_arch <<< "$(sheet_spec "$sheet")"
    contains "$target_arch" "${selected_arches[@]:-}" || selected_arches+=("$target_arch")
  done
  for target_arch in "${selected_arches[@]}"; do
    tag="${target_arch}_${DATE}"
    image="${FRONTEND_REPOSITORY}:${tag}"
    log "Build shared ${target_arch} frontend: ${image}"
    docker buildx build \
      --builder default \
      --network host \
      --load \
      --provenance=false \
      --sbom=false \
      --build-arg "NODE_BASE_IMAGE=${FRONTEND_NODE_BASE_IMAGE}" \
      --build-arg "NGINX_BASE_IMAGE=${NGINX_BASE_IMAGE}" \
      -t "v-chatcut-frontend:${tag}" \
      -t "$image" \
      -f vos_docker/Dockerfile.frontend \
      .
    docker push "$image"
    while IFS= read -r update_sheet; do
      python3 "$FEISHU_HELPER" write \
        --sheet "$update_sheet" \
        --component "$FRONTEND_COMPONENT" \
        --repository "$FRONTEND_REPOSITORY" \
        --tag "$tag" \
        --date "$DATE"
    done < <(frontend_sheets "$target_arch")
  done
fi

if contains backend "${COMPONENTS[@]}"; then
  for sheet in "${TARGET_SHEETS[@]}"; do
    IFS='|' read -r profile tag_prefix dockerfile _ <<< "$(sheet_spec "$sheet")"
    tag="${tag_prefix}_${DATE}"
    image="${BACKEND_REPOSITORY}:${tag}"
    log "Build ${profile} backend: ${image}"
    docker buildx build \
      --builder default \
      --network host \
      --load \
      --provenance=false \
      --sbom=false \
      --build-arg "NODE_BASE_IMAGE=${NODE_BASE_IMAGE}" \
      -t "v-chatcut-backend:${tag}" \
      -t "$image" \
      -f "$dockerfile" \
      .
    docker push "$image"
    python3 "$FEISHU_HELPER" write \
      --sheet "$sheet" \
      --component "$BACKEND_COMPONENT" \
      --repository "$BACKEND_REPOSITORY" \
      --tag "$tag" \
      --date "$DATE"
  done
fi

log "Build, push, and Feishu registration completed"
