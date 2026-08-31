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

All backend images use Node.js 24, system FFmpeg/FFprobe, Chromium, and the VOS server entrypoint in `server.ts`.

Brand assets use `assets/branding/v-chatcut-logo-master.png` as the generated
transparent master. The browser and embedded page use the 512×512
`public/openchatcut-icon.png`; VOS packages use the 256×256
`ictrek.app/src/icon.png`; macOS packaging uses the derived ICNS asset.

## Build and publish images

`build_image.sh` must run on the matching architecture host and requires an
explicit Feishu sheet. It never connects to another build host itself.

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
`V_CHATCUT_FRONTEND_NODE_BASE_IMAGE`, and `V_CHATCUT_NGINX_BASE_IMAGE`.
