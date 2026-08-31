# Changelog

All notable changes to this project will be documented in this file.

## [Phase 4] - 2026-08-30
### Added
- **Device-Scoped Library:** New `device-code` Edge Function plus `DeviceId`/`DeviceLinkController` scripts give every headset a persistent, idempotent link code. `list`/`upload` now filter by `device_id` when a code is supplied, and the web companion gets live Realtime refresh.
- **Code Mode:** First-ever Lens launch automatically opens the device-link code screen so a new device gets linked before doing anything else.

### Fixed
- ASR no longer disarms on an empty or spurious "final" transcript, fixing dropped speech recognition caused by Spectacles' BLE mic warm-up latency.
- `GeminiTextureGenerate` now falls back from Gemini to OpenAI (`gpt-image-1`) on failure, with status text reflecting whichever provider is active.
- `Snap3DVoiceGenerate` reports real pipeline stages (base mesh / refining) instead of a single static "generating" message.

### Changed
- Migrated voice input to the native `AsrModule` asset (previously a third-party package), reskinned mic/button UI, replaced the loading spinner with an animated GIF.

## [Phase 3] - 2026-07-29
### Added
- **Snap3D Voice-to-Model Pipeline:** Speak or type a prompt and Snap3D sculpts a 3D model in-world via `RemoteServiceGateway.lspkg`. The generated mesh previews in front of the user before an explicit Push/Discard decision — nothing uploads automatically.
- **Typed-Prompt Fallback:** A `TextInputField`-based typed alternative alongside voice input for both AI generation modes.
- **Mode Select Menu:** `LensModeSelect` toggles between Texture Grab, Model Gen, and AI Gen by `SceneObject.enabled`, never destroying a mode's state — an in-flight generation survives being hidden.

### Changed
- UX pass: companion web app's pipeline strip reorganized into full-width docked rows, numeric slider readouts made directly editable, added a "Seamless" toggle to skip tiling for non-tileable hero captures, added multi-select + bulk delete.

## [Phase 2] - 2026-07-28
### Added
- **Persistent Library Mode:** Captures no longer expire after a pairing window — they're kept forever, browsable via a new `list` Edge Function and a Library panel (radial carousel + grid view) in the web companion, with lazy-loaded thumbnails and auto-polling.

## [Phase 1] - 2026-07-25
### Added
- **Texture Grab:** Pinch-both-hands framing gesture on Spectacles, hand-tracked crop rectangle, high-res still capture via `CameraModule`, JPEG upload to a Supabase relay.
- **Web Companion:** Single self-contained HTML file (three.js + JSZip, no build step) that turns a raw capture into a full PBR map set (BaseColor/Normal/Roughness/AO/Height) and offers it as a downloadable ZIP.
- **Supabase Relay:** `upload`/`grab` Edge Functions backed by a Snap Cloud (Supabase) project, matching a simple `POST /upload` / `GET /grab/CODE` contract.
