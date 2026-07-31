# Texture Grab — project spec

**One line:** Pinch on Spectacles → capture a real-world surface → a web companion turns it into a tileable PBR material set (BaseColor / Normal / Roughness / AO / Height) you download as a ZIP.

Everything heavy runs in the browser. The Lens only captures and uploads. No accounts, no backend beyond a 40-line relay.

---

## 1. System

```
Spectacles Lens          Relay (Cloudflare Worker + KV)         Web companion
─────────────────        ──────────────────────────────         ──────────────────
pinch                    POST /upload  {image: b64}             GET /grab/CODE
  ↓                        → returns 4-char code                  ↓
requestImage()             (KV, 15 min TTL)                     decode → process
  ↓                                                               ↓
Base64.encodeTextureAsync                                       5 PBR maps + 3D preview
  ↓                                                               ↓
InternetModule.fetch  ──────────────────────────────────────►   download ZIP
  ↓
show CODE on HUD
```

User flow: pinch → HUD shows `K4TQ` → type `K4TQ` into the web app → maps appear → download.

---

## 2. Component A — Lens (Lens Studio 5.9+, TypeScript)

### APIs to use

| Need | API |
|---|---|
| High-res capture | `CameraModule.createImageRequest()` + `await cameraModule.requestImage(req)` → **3200×2400** ImageFrame. Do NOT use `requestCamera` (that's the low-res live stream). |
| Gesture | SIK: `SIK.HandInputData.getHand("right").onPinchDown.add(cb)`. Import path `SpectaclesInteractionKit.lspkg/SIK`. |
| Encode | `Base64.encodeTextureAsync(tex, ok, fail, CompressionQuality.HighQuality, EncodingType.Jpg)` — callback style, wrap in a Promise. |
| Upload | `internetModule.fetch(url, {method, headers, body})` — standard Fetch API. Requires an **Internet Module** asset dragged into the script input. |

### Script: `TextureGrab.ts`

Inputs: `relayUrl: string`, `internetModule: InternetModule`, `statusText: Text` (optional), `previewImage: Image` (optional).

Behaviour:
1. On start, bind pinch (both hands) + a `TapEvent` fallback. Show "Pinch to grab a texture".
2. On pinch, guard with a `busy` flag. Status: Grabbing → Encoding → Uploading.
3. Show the captured texture on `previewImage.mainPass.baseTex` so the user sees what they got.
4. POST `{ image, t: getTime() }` to `${relayUrl}/upload`, read `data.code`, display it large.
5. On any failure, print the error and show "Failed — pinch to retry".

### Gotchas — bake these in

- **Still image capture does not work in the Lens Studio editor preview.** Must run on device.
- Camera Access requires **Extended Permissions** in Project Settings. Check current publishing policy before planning distribution.
- A 3200×2400 JPEG as base64 is ~4–8 MB of string. Log `b64.length`. If it OOMs, drop compression quality first, then consider chunked upload.
- Use `getTime()`, not `Date.now()`.
- If the `CompressionQuality` / `EncodingType` enum names error out, `print()` the enum object and read the real member names.

---

## 3. Component B — Relay (Cloudflare Worker + KV)

Stateless, ~40 lines, free tier.

```
POST /upload    { image: "<base64 jpeg>" }   → { code: "K4TQ", expiresIn: 900 }
GET  /grab/K4TQ                              → { image: "<base64 jpeg>" }
```

- KV binding `GRABS`, `expirationTtl: 900`.
- Code alphabet: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I/O/0/1), 4 chars, from `crypto.getRandomValues`.
- CORS `*` on everything, handle `OPTIONS`.
- Reject bodies over ~12 MB with 413. Reject missing/short `image` with 400.

---

## 4. Component C — Web companion (single-file HTML)

Single self-contained `.html`, no build step. CDN only: **three.js r128**, **JSZip 3.10**. No localStorage. All processing on CPU with typed arrays (fast enough at 1024²) — no server round trip.

### Intake

Three ways in, all equal:
- Type the 4-char code → `GET {relay}/grab/CODE` → base64 → Image.
- Drag & drop / file picker.
- Paste from clipboard (Ctrl+V).

Relay URL is a settings field, persisted in the URL hash (`#relay=...`) so it survives reload without storage.

### Processing pipeline

Center-crop to square, resize to working size (512 / **1024** / 2048), split into three `Float32Array` planes R/G/B in 0..1.

**Stage 1 — De-light** *(the single most important step; without it every map bakes in the room's shadows)*

Homomorphic filtering. For each channel: take a very large blur (radius ≈ size/8) to estimate the lighting field, then divide it out and renormalize to the blur's mean.

```
albedo = clamp( src / (blur(src, size/8) + ε) * mean(blur) )
out    = mix(src, albedo, delightAmount)   // slider, default 0.85
```

Then apply exposure and saturation sliders.

Implement blur as a **3-pass separable box blur with running sums** — O(n) regardless of radius, clamp-to-edge at borders. Write one `blurPlane(plane, w, h, r, passes)` helper and reuse it everywhere.

**Stage 2 — Make tileable** *(mirror-feather; simple and provably seamless)*

1. Wrap-offset by half: `out[y][x] = src[(y+h/2)%h][(x+w/2)%w]`. The old edge seam is now a cross through the middle.
2. Kill the vertical seam at `x = w/2` by blending the image with its own mirror about that axis:

```
mx = (w - x) % w
d  = |x - w/2|;  t = d / band
a  = 0.5 * (1 - smoothstep(t))      // a = 0.5 exactly at the seam, 0 at ±band
out[y][x] = (1-a)*img[y][x] + a*img[y][mx]
```

At the seam `a = 0.5`, which makes the result symmetric about the seam and therefore continuous across it. Away from the seam the mirror fades out entirely.

3. Repeat for the horizontal seam at `y = h/2`.

**Read from a snapshot, write to a copy** — doing this in place corrupts the mirrored source. Band width is a slider (default ~18% of size, 0 = off).

**Stage 3 — Derive maps** (all from the tiled, de-lit albedo)

| Map | Method |
|---|---|
| **BaseColor** | The tiled de-lit albedo. |
| **Height** | `0.5 + (L - blur(L, size/16)) * gain`, where L = luminance. High-pass keeps surface detail, drops macro shape. Sliders: gain, invert. Light 1px smooth afterwards to kill sensor noise. |
| **Normal** | Sobel on height → `normalize(vec3(-dx*strength, -dy*strength, 1))` → encode to 0..1. Sliders: strength, **flip green** (OpenGL vs DirectX). |
| **AO** | Cavity from height, two scales: `ao = clamp(1 - (blur(h,r) - h) * strength)` averaged over r ≈ 8 and r ≈ 32. |
| **Roughness** | Heuristic, not physical — everyone ships this: `base + |L - blur(L,4)| * detail`, plus an invert toggle. Sliders: base (0.55), detail (0.8). |
| **Metallic** | Flat constant from a slider, default 0. |

Only recompute downstream of whatever changed — cache stage 1 and stage 2 outputs, debounce sliders ~60 ms.

### 3D preview

three.js r128, `MeshStandardMaterial` with `map` (sRGB encoding), `normalMap`, `roughnessMap`, `aoMap`, `displacementMap`.

- `aoMap` needs UV2: `geo.setAttribute('uv2', new THREE.BufferAttribute(geo.attributes.uv.array, 2))`.
- Shape toggle: subdivided plane (256×256, for displacement) / sphere (128 segs).
- **Tiling toggle 1× / 2× / 3×** — this is what proves the tiling actually works, make it prominent.
- Hemisphere + directional light, optional slow orbit. Drag to rotate, scroll to zoom, hand-rolled (no OrbitControls in r128).
- `renderer.outputEncoding = THREE.sRGBEncoding`.

### Export

JSZip → PNGs with UE-style names so they drop straight into Blender/Substance:

```
T_<name>_BaseColor.png
T_<name>_Normal.png
T_<name>_Roughness.png
T_<name>_AmbientOcclusion.png
T_<name>_Height.png
material.json     ← all slider settings, working size, source code/timestamp
readme.txt        ← which socket each map plugs into in Blender's Principled BSDF
```

Also a per-map download button on each thumbnail.

### UI

Pipeline-strip layout — a row of live thumbnails across the top showing `SOURCE → DE-LIT → TILED → MAPS`, filling in as processing runs, so the transformation is legible rather than a black box. Quiet dark neutral chrome so the maps themselves are the only color on screen. Mono micro-labels for parameter names and values. Empty state: "Drop a photo, pick a file, or type the code from your Spectacles." Responsive down to mobile; visible keyboard focus; respect `prefers-reduced-motion`.

---

## 5. Build order

1. **Web companion with drag-and-drop only.** De-light → normal → three.js preview → ZIP. No relay, no Lens. This alone is a usable tool.
2. Add tiling + the rest of the maps + all sliders.
3. Deploy the relay. Add code entry to the companion.
4. Lens script: pinch → capture → upload → show code. **End-to-end done here.**
5. Polish: capture-quality rejection on device (variance-of-Laplacian for blur, mean luminance for darkness) so bad shots never leave the glasses.

## 6. Done means

- Pinch on device, type the code in the browser, maps appear in under ~10 s.
- 3× tiling preview shows no visible seam on concrete, plaster, fabric, wood.
- Exported ZIP drops into Blender and the material looks like the surface you pointed at.
- The whole companion is one HTML file you can host on a static site.

## 7. Stretch (not v1)

- **Perspective rectification:** raycast the capture's four corners with `WorldQueryModule` to get world-space points on the surface, send them with the image, compute a homography in the browser. Un-warps off-angle captures and gives you **real-world scale** (texels per cm) in the export metadata — nobody else has that.
- Two-hand "director's frame" gesture to define the crop region instead of full-frame capture.
- Depth Anything V2 Small via transformers.js/WebGPU for a real monocular depth height map instead of high-passed luminance.
- Min-cut seam (DP through the overlap band) instead of mirror-feather, for textures with strong directional structure like wood grain or brick.
