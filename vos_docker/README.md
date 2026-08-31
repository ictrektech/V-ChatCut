# V-ChatCut VOS images

The frontend uses `Dockerfile.frontend` and is built once on AMD64 and once on ARM64.

Backend Dockerfiles map one-to-one to VOS profiles:

| Profile | Dockerfile | Frontend architecture |
| --- | --- | --- |
| `amd-with-cuda` | `Dockerfile.backend.amd-with-cuda` | AMD64 |
| `amd-without-cuda` | `Dockerfile.backend.amd-without-cuda` | AMD64 |
| `arm-with-cuda` | `Dockerfile.backend.arm-with-cuda` | ARM64 |
| `arm-without-cuda` | `Dockerfile.backend.arm-without-cuda` | ARM64 |
| `l4t` | `Dockerfile.backend.l4t` | ARM64 |
| `thor-spark` | `Dockerfile.backend.thor-spark` | ARM64 |

CUDA profiles request the NVIDIA runtime and prefer `h264_nvenc`. V-ChatCut probes the encoder at runtime and falls back to `libx264` when it is unavailable. CPU profiles explicitly use software encoding and Chromium's `swangle` renderer.

The npm package already contains the CPU ONNX Runtime used by local analysis.
Image builds skip the optional ONNX CUDA EP download because its upstream
installer does not follow feed redirects; CUDA profiles still accelerate
video encoding and Chromium rendering through the NVIDIA runtime.

All backend images use Node.js 24, system FFmpeg/FFprobe, Chromium, and the VOS server entrypoint in `server.ts`.

All Dockerfile base images are mirrored to ictrek SWR before application
builds. Run `mirror_base_images.sh` once on each architecture host (tc232 for
AMD64 and tc192 for ARM64) whenever a base image is added or upgraded. The
script pulls only through configured Docker mirrors and publishes explicit
`amd_...` / `arm_...` tags; application builds never depend on Docker Hub.

```bash
./vos_docker/mirror_base_images.sh
```

Current mirrored inputs are Node.js `24-bookworm-slim`, Node.js `24-alpine`,
and Nginx `1.29-alpine`.

Brand assets use `assets/branding/v-chatcut-logo-master.png` as the generated
transparent master. The browser and embedded page use the 512×512
`public/openchatcut-icon.png`; VOS packages use the 256×256
`ictrek.app/src/icon.png`; macOS packaging uses the derived ICNS asset.

## Build and publish images

`build_image.sh` must run on the matching architecture host and requires an
explicit Feishu sheet. It never connects to another build host itself.

Build-host assignments are enforced from the machine architecture and Jetson
release: tc232 builds both AMD profiles, tc192 (L4T R36) builds ARM CPU and
L4T, and tc229 (Thor R39) builds ARM CUDA and Thor/Spark.

Backend images start through a root-owned, idempotent entrypoint that prepares
the VOS bind-mounted `/data/users` and media directories, then drops privileges
to the `node` user. VOS users never need to change host or container permissions
manually, and the application process does not remain privileged.

```bash
# Build both the shared AMD frontend and AMD CUDA backend.
./vos_docker/build_image.sh --sheet AMD_with_cuda

# Build only an ARM CPU backend.
./vos_docker/build_image.sh --sheet ARM_without_cuda --component backend

# Build the shared ARM frontend once and write the same tag to all ARM sheets.
./vos_docker/build_image.sh --sheet ARM_with_cuda --component frontend
```

Sheet mapping:

| Feishu sheet | Backend tag prefix | Profile |
| --- | --- | --- |
| `AMD_with_cuda` | `amd_cu128_YYYYMMDD` | `amd-with-cuda` |
| `AMD_with_mxn100` | `amd_YYYYMMDD` | `amd-without-cuda` |
| `ARM_with_cuda` | `arm_cu128_YYYYMMDD` | `arm-with-cuda` |
| `ARM_without_cuda` | `arm_YYYYMMDD` | `arm-without-cuda` |
| `l4t` | `l4t_YYYYMMDD` | `l4t` |
| `thor_spark` | `thor_YYYYMMDD` | `thor-spark` |

The script expects Feishu credentials in `~/.feishu.json` or
`~/.feishu.components.json`. Registry and base images can be overridden with
`V_CHATCUT_REGISTRY`, `V_CHATCUT_NODE_BASE_IMAGE`,
`V_CHATCUT_FRONTEND_NODE_BASE_IMAGE`, and `V_CHATCUT_NGINX_BASE_IMAGE`. Its
defaults are the architecture-specific mirrors under
`swr.cn-southwest-2.myhuaweicloud.com/ictrek`; direct Docker Hub fallbacks are
intentionally not provided. Backend system packages default to Huawei Cloud's
Debian mirrors; `DEBIAN_MIRROR` and `DEBIAN_SECURITY_MIRROR` remain build-arg
overrides for an installation that maintains its own APT mirror.
