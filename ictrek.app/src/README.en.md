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

### Importing media

- **Computer and phone**: upload from the browser or use the temporary phone upload channel.
- **VOS storage / Samba**: grant a user or public directory to V-ChatCut in VOS, then choose it from “Import from VOS / WebDAV / AI Album”. VOS owns the Samba mount and authorization; V-ChatCut does not store SMB credentials.
- **WebDAV**: configure the optional WebDAV URL and account during installation or upgrade.
- **AI Album**: configure an Immich URL and API key to browse recent assets or use semantic search.

Selected external media is copied into V-ChatCut's private `/media/uploads/` area. Existing projects therefore remain usable after a directory grant is revoked or a remote service goes offline, at the cost of additional application storage.

### Project packages

The project dashboard exports and imports `.ccproj` packages containing editable project data and referenced uploaded media. Media imported from an external source is included after it has entered V-ChatCut. The current per-media package limit is 512 MiB; missing, empty, or oversized items are reported after export.

## Performance

CUDA profiles prefer NVIDIA NVENC. When the encoder or driver is unavailable, V-ChatCut falls back to libx264 so the job can still complete at a lower speed.
