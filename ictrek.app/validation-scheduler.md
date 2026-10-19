# V-Scheduler migration verification

Date: 2026-10-19. Scope: VOS model discovery, endpoint routing, UI naming and existing user settings. Production installations were not upgraded during candidate verification.

## Contract and preservation

- All VOS inference and model discovery use `http://v-scheduler-gateway:8080` with the current authenticated user's token. No shared or anonymous credential replaces the user identity.
- `/api/v1/models` supplies visible model IDs, endpoints and capabilities. Explicit endpoints take precedence; endpoint-less native models follow the gateway's declared-capability fallback. Untyped legacy rows are excluded.
- Vision choices require both a chat-compatible interface and declared vision capability. OCR and embedding endpoints are not vision-chat choices.
- Stored `vrouter`, `LLM_VROUTER_*` and `V_ROUTER_*` values remain compatible. Discovery does not clear saved selections. A removed saved TTS model does not block discovery of replacement models.
- User directories, projects, media, default providers, model/voice selections and storage mounts are retained. No configuration rewrite is needed to roll back.

## Verification

- TypeScript build, generated server-tool catalog and published-dependency resolver tests passed.
- User isolation, per-request Alice/Bob identity forwarding, saved configuration preservation and removed-model discovery tests passed.
- Focused LLM proxy, video provider, voice, transcription, music, media-model-field and English/Italian localization checks passed.
- On host 232, an isolated V-ChatCut candidate authenticated against real VOS and discovered 5 chat, 2 vision, 1 image, 0 video, 1 TTS, 5 ASR and 1 music model. Counts describe that account and time, not fixed expected deployment data.
- Real non-streaming and streaming Chat Completions calls passed through V-ChatCut to the unified gateway and the installed small Ollama verification model. The SSE stream completed with `[DONE]`.
- Rendered browser checks passed for automatic discovery, refresh, preserved selection, the vision dropdown and V-Scheduler naming. No page runtime error was observed. Browser plugin was not available; regular Playwright on the build host was used. Screenshots and machine-readable evidence are under `~/dev/build/v-chatcut-migration/` on host 232.
- Hosts 192 and 229 authenticated and returned their real model catalogs. Additional inference attempts were correctly rejected with `WAIT_MEMORY_HEADROOM` and `WAIT_RESOURCE`, respectively. These are resource-admission limits, not successful inference results; no workload was interrupted and no admission bypass was used.
- No video model was configured for the tested account. Empty video discovery was verified; video generation was not claimed as a live success.

Image publication, per-profile smoke results and package publication are recorded by the image-build logs and VOS release workflow. A release tag alone is not verification of publication.
