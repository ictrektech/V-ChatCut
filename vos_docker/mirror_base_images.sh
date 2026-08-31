#!/usr/bin/env bash
set -euo pipefail

REGISTRY="${V_CHATCUT_REGISTRY:-swr.cn-southwest-2.myhuaweicloud.com/ictrek}"
SOURCE_MIRRORS="${V_CHATCUT_SOURCE_MIRRORS:-docker.1ms.run docker.m.daocloud.io/library}"

log() { echo "[INFO] $*"; }
die() { echo "[ERROR] $*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

case "$(uname -m)" in
  x86_64|amd64)
    HOST_ARCH=amd
    EXPECTED_ARCH=amd64
    ;;
  aarch64|arm64)
    HOST_ARCH=arm
    EXPECTED_ARCH=arm64
    ;;
  *) die "unsupported mirror-host architecture: $(uname -m)" ;;
esac

require_cmd docker

mirror_image() {
  local repository="$1"
  local source_tag="$2"
  local target_tag="$3"
  local mirror source source_arch target
  local pulled=""

  for mirror in $SOURCE_MIRRORS; do
    source="${mirror}/${repository}:${source_tag}"
    log "Pull ${source}"
    if docker pull "$source"; then
      pulled="$source"
      break
    fi
  done
  [[ -n "$pulled" ]] || die "could not pull ${repository}:${source_tag} from configured mirrors"

  source_arch="$(docker image inspect "$pulled" --format '{{.Architecture}}')"
  [[ "$source_arch" == "$EXPECTED_ARCH" ]] \
    || die "${pulled} is ${source_arch}, expected ${EXPECTED_ARCH}"

  target="${REGISTRY}/${repository}:${HOST_ARCH}_${target_tag}"
  docker tag "$pulled" "$target"
  docker push "$target"
  log "Published ${target} (${source_arch})"
}

# Keep this list in sync with every external FROM image used by vos_docker/.
mirror_image node 24-bookworm-slim 24-bookworm-slim
mirror_image node 24-alpine 24-alpine
mirror_image nginx 1.29-alpine 1.29-alpine

log "Base-image mirror completed for ${HOST_ARCH}"
