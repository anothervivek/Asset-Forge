# How `screenCropTexture` works (and the result-crop mechanism)

This documents exactly what `Assets/Scripts/TextureGrab.ts` does with Lens Studio's crop-texture
system, as of the current file (single shared `screenCropTexture`, no separate `resultCropTexture`
— that was consolidated at some point after the two-texture version was originally built).

## 1. The underlying Lens Studio mechanism

A **Crop Texture** asset (the `.screenCropTexture` file type, created in the Asset Browser) is a
`Texture` whose `.control` is a `RectCropTextureProvider`. That provider has exactly two properties
that matter here:

- `inputTexture: Texture` — the *source* texture it reads from.
- `cropRect: Rect` — the sub-region of that source (in **normalized -1..1 local space**, not
  pixels) to output. A `Rect` has `.setCenter(vec2)` / `.setSize(vec2)`.

Whatever the crop texture asset is currently pointed at (`inputTexture`) and however its
`cropRect` is set, sampling the texture (displaying it, or feeding it to `Base64.encodeTextureAsync`)
always gives you *that cropped region of that source* — live, re-evaluated continuously if the
source is itself live (like a camera feed).

Nothing here does the actual pixel cropping in your script — you're just pointing a GPU
texture-provider at a source and telling it which rectangle to output. The provider renders that
crop on its own internal pass.

## 2. One texture asset, two different jobs

`screenCropTexture` is a single `@input Texture` field, but it's used for two completely different
purposes depending on the phase, by swapping what `inputTexture` points at:

| Phase | `inputTexture` points at | `cropRect` | What it shows |
|---|---|---|---|
| **Framing** (both hands pinched) | the live camera feed (`liveCameraTexture`, cached once — see §3) | updated every frame from your hand positions | a live, low-res, cropped viewfinder |
| **Capture / result** (just after release) | the freshly-captured high-res still (`fullTex`) | the *locked* crop rect from the moment you released | the high-res cropped photo — this is what you see on the card and what gets uploaded |

Same texture asset, same `RectCropTextureProvider`, just re-pointed at a different source
depending on what's needed at that moment.

## 3. Where the "live camera feed" reference comes from

`screenCropTexture` doesn't originate in `TextureGrab.ts` at all — it's set up by
`ImageAnchor.lspkg/Scripts/CameraService.ts`:

```ts
// CameraService.ts, start() — bound to OnStartEvent
this.camTexture = this.camModule.requestCamera(camRequest)   // the actual live camera feed
this.cropProvider = this.screenCropTexture.control as CameraTextureProvider
this.cropProvider.inputTexture = this.camTexture              // <- this is the "live" state
```

`TextureGrab.onAwake()` caches whatever `inputTexture` is at that moment:

```ts
// TextureGrab.ts, onAwake()
if (this.screenCropTexture) {
  this.liveCameraTexture = (this.screenCropTexture.control as RectCropTextureProvider).inputTexture
}
```

`this.liveCameraTexture` is the "restore point" — it's what `startFraming()` points
`inputTexture` back to every time a new framing session begins, so that reframing after a
capture shows the live feed again instead of a frozen photo. It's cached **lazily, inside
`startFraming()` itself**, the first time it ever runs — not in `onAwake()`:

```ts
// TextureGrab.ts, startFraming()
const liveProvider = this.screenCropTexture.control as RectCropTextureProvider
if (!this.liveCameraTexture) {
  this.liveCameraTexture = liveProvider.inputTexture
} else {
  liveProvider.inputTexture = this.liveCameraTexture
}
```

> ### ✅ Fixed: onAwake()/OnStartEvent ordering bug
> This used to be cached in `onAwake()`. But `onAwake()` runs for **every object in the scene**
> before `OnStartEvent` fires for **any** object, while `CameraService.start()` — the thing that
> actually sets `inputTexture` to the real live camera feed — is bound to `OnStartEvent`. Reading
> `inputTexture` in `onAwake()` would grab whatever the asset's default/empty value was, not the
> real feed, silently breaking the restore-to-live-feed step on any reframe after the first
> capture (second framing attempt would show a blank/broken viewfinder instead of the live feed).
>
> Fixed by moving the caching into `startFraming()` itself, guarded on "only cache if not already
> cached" — by the time a real pinch gesture can happen, `CameraService`'s `OnStartEvent` handler
> has long since run, so this is race-free without depending on execution order between two
> different components' `OnStartEvent` handlers.

## 4. Full lifecycle walkthrough

```
Scene load
  → CameraService.onAwake()      binds start() to OnStartEvent
  → TextureGrab.onAwake()        (liveCameraTexture NOT cached here anymore — see fix above)
  → OnStartEvent fires for all objects
  → CameraService.start()        requests live camera texture, sets it as screenCropTexture's inputTexture
  → TextureGrab's OnStartEvent   wires confirmButton/cardManipulation

Idle
  screenCropTexture.inputTexture = live camera feed
  cardAnchor disabled — nothing visible

Both hands pinch → startFraming()
  cardAnchor enabled
  liveCameraTexture cached here on the very first call (real feed by now, guaranteed) —
    every call after that restores inputTexture back to it instead
  previewImage.mainPass.captureImage = screenCropTexture   ← the card now displays this crop texture
  updateFraming() bound to UpdateEvent, and called once immediately

Every frame while both hands are down → updateFraming()
  computeFrameCorners()             → 4 corners in 3D world space from your two thumb tips
  toScreenSpace() on all 4 corners  → normalized -1..1 bounding rect (lastCropRect)
  applyCropRect(screenCropTexture's provider, lastCropRect)
                                     → live feed crop updates to match your hands
  updateCardTransform(corners)      → card's position/rotation/scale set directly from
                                       the 3D corners (see docs on that separately — not a
                                       crop-texture concern, just uses the same corner data)

Release (one hand up while framing) → stopFramingAndCapture()
  if the locked rect is big enough → triggerCapture(lastCropRect)

triggerCapture() → showLoading(), then captureAndReveal(cropRect)
  CameraModule.requestImage()        → fullTex, the real 3200x2400 still
  screenCropTexture.inputTexture = fullTex      ← re-point the SAME provider at the still
  applyCropRect(provider, cropRect)             ← re-apply the locked rect to the still
  waitFrames(CROP_SETTLE_FRAMES)                ← let the provider actually render the new crop
                                                   (see §5 — it doesn't update synchronously)
  outputTex = screenCropTexture                 ← now represents "high-res photo, cropped"
  previewImage.mainPass.captureImage = outputTex
  revealCard()                                  ← card snaps to a fixed comfortable viewing spot
  hideLoading()                                 ← picture is visible now
  encodeTexture(outputTex) → base64              ← this is what gets uploaded, once Confirmed

Confirm pressed → uploadPending()
  sends the base64 from the exact outputTex above

Next framing session → startFraming() runs again
  screenCropTexture.inputTexture restored to liveCameraTexture
  → back to live low-res viewfinder (modulo the bug in §3)
```

## 5. Why `waitFrames(CROP_SETTLE_FRAMES)` exists

`RectCropTextureProvider` renders its cropped output on its own internal pass — it does **not**
update synchronously the instant you set `inputTexture` or `cropRect` in script. If you read
pixels out of it (via `Base64.encodeTextureAsync`) or display it immediately after re-pointing it,
you can get stale content — e.g. still showing the old crop, or briefly nothing.

`waitFrames(2)` (defined near the bottom of the file) waits for exactly 2 real `UpdateEvent` ticks
before the script treats `screenCropTexture` as "now showing the cropped still" — cheap insurance,
and far less noticeable than the flat 150ms wall-clock delay this used before (frame-based waiting
scales with actual framerate instead of guessing a duration).

## 6. The coordinate system

Everything crop-related here uses **normalized local space, -1..1 on both axes** — not pixels,
not 0..1 UV space. This comes from `CameraService.CameraToScreenSpace()`:

```ts
const localX = this.Remap(screenPoint.x, 0, 1, -1, 1)
const localY = this.Remap(screenPoint.y, 1, 0, -1, 1)   // note the flipped 1,0 vs 0,1 for Y
```

So: `x = -1` is the left edge of view, `x = 1` is the right edge. `y = 1` is the top, `y = -1` is
the bottom (the flip in the `Remap` call is what makes +1 correspond to the top rather than the
bottom). `CropRect` in `TextureGrab.ts` (`{xMin, xMax, yMin, yMax}`) is expressed in exactly this
space, and `applyCropRect()` converts it to the `Rect` a crop provider actually wants:

```ts
rect.setCenter(new vec2(xMin + xMax, yMin + yMax).uniformScale(0.5))
rect.setSize(new vec2(xMax - xMin, yMax - yMin))
```

A full-frame crop is `{xMin: -1, xMax: 1, yMin: -1, yMax: 1}` — center `(0,0)`, size `(2,2)`.

## 7. Why one texture instead of two

The original version of this script used a second, separate `resultCropTexture` asset
specifically for the high-res result, so the live viewfinder and the final crop never touched
the same provider. The current version consolidates to one asset (`screenCropTexture` doing both
jobs, swapped via `inputTexture`) — this removes the need to create/wire a duplicate Crop Texture
asset in the editor, at the cost of the restore-on-reframe step in `startFraming()` (and the bug
in §3 that step depends on).
