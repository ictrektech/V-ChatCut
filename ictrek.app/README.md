# V-ChatCut VOS package

This directory contains the VOS application definition for `com.ictrek.v-chatcut`.

The frontend has two architecture images: AMD64 and ARM64. Backend images are profile-specific:

- `amd-with-cuda`
- `amd-without-cuda`
- `arm-with-cuda`
- `arm-without-cuda`
- `l4t`
- `thor-spark`

Source templates live in `src/`. Generated package output belongs in `dist/` and must not be committed.
The VOS icon is `src/icon.png`, a 256×256 8-bit RGBA PNG with transparent
corners. `package.sh` stages it at the root of `app.tar.gz` and validates its
PNG dimensions and color type before producing the pull package.

## VOS media sources

The backend mounts `${VOS_APP_EXPOSED_PATH}` read-only at `/exposed`. After a
user or public directory is granted to the app, the editor can browse it from
the media-pool import dialog. This is also the supported Samba/NAS path: VOS
owns the Samba mount and directory authorization; V-ChatCut does not store SMB
credentials.

Optional WebDAV and Immich/AI Album connections are configured with:

- `OPENCHATCUT_WEBDAV_URL`, `OPENCHATCUT_WEBDAV_USERNAME`, `OPENCHATCUT_WEBDAV_PASSWORD`
- `OPENCHATCUT_IMMICH_URL`, `OPENCHATCUT_IMMICH_API_KEY`

All selected remote media is streamed into the private `/data/media/uploads`
directory before editing. `.ccproj` exports include referenced uploaded media,
with the existing 512 MiB per-media package limit.

## Release flow

Build images on the matching build host with an explicit Feishu sheet:

```bash
./vos_docker/build_image.sh --sheet AMD_with_cuda
./vos_docker/build_image.sh --sheet ARM_with_cuda
./vos_docker/build_image.sh --sheet l4t
```

The build script pushes `v-chatcut-frontend` and `v-chatcut-backend` images to
SWR, then records their standard date tags in Feishu. Frontend tags are shared
per CPU architecture; backend tags remain profile-specific.

After all six backend records and both frontend records exist, commit the code
and run:

```bash
./ictrek.app/scripts/update_version.sh patch
```

The version script pushes only the `vos-v-chatcut-vX.Y.Z` trigger tag. GitHub
Actions reads the image records from Feishu, builds `v_chatcut_X.Y.Z_pull.tar`,
creates the public `vX.Y.Z` release, and publishes the package to VOS App Store.
