# V-ChatCut

V-ChatCut is a local-first, agent-native multitrack video editor with media management, captions, motion graphics, intelligent analysis, media generation, and video export.

## Profiles

- `amd-with-cuda`: AMD64 NVIDIA CUDA with NVENC and GPU rendering, falling back to software encoding when unavailable.
- `amd-without-cuda`: AMD64 CPU with software rendering and libx264.
- `arm-with-cuda`: Generic ARM64 NVIDIA CUDA with hardware encoder probing.
- `arm-without-cuda`: ARM64 CPU with software rendering and libx264.
- `l4t`: Jetson / L4T with NVIDIA runtime and hardware encoder probing.
- `thor-spark`: NVIDIA Thor / Spark with NVIDIA runtime and hardware encoder probing.

Only AMD64 and ARM64 frontend images are built. Every ARM64 backend profile reuses the ARM64 frontend image.

## Data

Projects, uploaded media, model caches, settings, and export state are stored under the VOS private application `data/` directory. Back up this directory before uninstalling when required.

## Performance

CUDA profiles prefer NVIDIA NVENC. When the encoder or driver is unavailable, V-ChatCut falls back to libx264 so the job can still complete at a lower speed.
