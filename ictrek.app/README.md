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
