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

V-ChatCut authenticates the current user through the VOS OIDC Fastpath and uses the immutable OIDC `sub` claim to partition projects, uploaded media, settings, generation jobs, export state, localStorage, sessionStorage, and IndexedDB under `data/users/<subject-hash>/`.

VOS owns the project and media directory mapping, so authenticated VOS users do not see local path changes in Settings.

Legacy data at the shared `data/` root is not exposed automatically. A VOS administrator can explicitly call `POST /api/auth/claim-legacy-data` to claim it once; the operation refuses a non-empty target and requires an app restart.

### Importing media

- **Computer and phone**: upload from the browser or use the temporary phone upload channel.
- **VOS storage / Samba**: the exposed view is application-wide and is disabled by default in multi-user mode. Enable “Shared VOS Exposed Directory” only for a public library available to every V-ChatCut user.
- **WebDAV**: deployment may provide an endpoint default; every VOS user saves their own account and password in Settings → Assets & Transcription → Remote media → WebDAV.
- **AI Album**: inside the same VOS, V-ChatCut first tries the current user's OIDC token for `com.ictrek.ai-album`; if the AI Album API returns 401, or for standalone Immich, each VOS user saves their own API key in Settings → Assets & Transcription → Remote media → AI Album.

Selected external media is copied into V-ChatCut's private `/media/uploads/` area. Existing projects therefore remain usable after a directory grant is revoked or a remote service goes offline, at the cost of additional application storage.

### Project packages

The project dashboard exports and imports `.ccproj` packages containing editable project data and referenced uploaded media. Media imported from an external source is included after it has entered V-ChatCut. The current per-media package limit is 512 MiB; missing, empty, or oversized items are reported after export.

## Performance

CUDA profiles prefer NVIDIA NVENC. When the encoder or driver is unavailable, V-ChatCut falls back to libx264 so the job can still complete at a lower speed.
