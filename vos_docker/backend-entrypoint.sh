#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  data_dir="${OPENCHATCUT_DATA_DIR:-/data}"
  media_dir="${MEDIA_DIR:-${data_dir}/media/uploads}"
  media_parent="$(dirname "$media_dir")"

  mkdir -p "${data_dir}/users" "$media_dir"
  chown node:node "${data_dir}/users" "$media_parent" "$media_dir"

  exec gosu node "$@"
fi

exec "$@"
