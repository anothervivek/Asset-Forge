import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import {createClient, type SupabaseClient} from "SupabaseClient.lspkg/supabase-snapcloud"
import {CameraService} from "ImageAnchor.lspkg/Scripts/CameraService"
import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"

const MIN_FRAME_SIZE = 0.05
const CROP_SETTLE_FRAMES = 2
const USE_SOURCE_CROP = false
const IDLE_STATUS_MESSAGE = "Pinch with both hands and frame a surface"
const UPLOAD_CONFIRMATION_SECONDS = 2.5

type CropRect = {xMin: number; xMax: number; yMin: number; yMax: number}

@component
export class TextureGrab extends BaseScriptComponent {
  @input supabaseProject!: SupabaseProject
  @input statusText!: Text
  @input previewImage!: RenderMeshVisual
  @input capturedPreviewImage!: RenderMeshVisual
  @input cameraService!: CameraService
  @input screenCropTexture!: Texture
  @input confirmButton!: RectangleButton
  @input discardButton!: RectangleButton
  @input cardInteractable!: Interactable
  @input cardManipulation!: InteractableManipulation
  @input loadingObject!: SceneObject

  private supabase!: SupabaseClient
  private camera = WorldCameraFinderProvider.getInstance()
  private isEditor = global.deviceInfoSystem.isEditor()

  private rightHand = SIK.HandInputData.getHand("right")
  private leftHand = SIK.HandInputData.getHand("left")

  private modeRoot: SceneObject | null = null

  private leftDown = false
  private rightDown = false
  private framingEvent: SceneEvent | null = null
  private lastCropRect: CropRect | null = null
  private cardBeingManipulated = false

  private busy = false
  private cardAnchor!: SceneObject

  private pendingImage: string | null = null
  private pendingCropRect: CropRect | null = null

  private statusRevertEvent: DelayedCallbackEvent | null = null

  private liveCameraTexture: Texture | null = null

  onAwake() {
    this.supabase = createClient(this.supabaseProject.url, this.supabaseProject.publicToken)
    this.modeRoot = this.getSceneObject().getParent()

    if (this.previewImage) {
      this.cardAnchor = this.previewImage.getSceneObject().getParent() ?? this.previewImage.getSceneObject()
      this.cardAnchor.enabled = false
    }
    if (this.loadingObject) {
      this.loadingObject.enabled = false
    }
    if (this.capturedPreviewImage) {
      this.capturedPreviewImage.getSceneObject().enabled = false
    }

    this.leftHand.onPinchDown.add(this.onLeftPinchDown)
    this.leftHand.onPinchUp.add(this.onLeftPinchUp)
    this.rightHand.onPinchDown.add(this.onRightPinchDown)
    this.rightHand.onPinchUp.add(this.onRightPinchUp)
    this.createEvent("TapEvent").bind(this.onQuickCapture)

    this.createEvent("OnStartEvent").bind(() => {
      this.confirmButton.onTriggerUp.add(this.onConfirmPressed)
      this.discardButton.onTriggerUp.add(this.onDiscardPressed)
      this.setPreviewButtonsVisible(false)

      if (this.cardManipulation) {
        this.cardManipulation.onManipulationStart.add(() => {
          this.cardBeingManipulated = true
        })
        this.cardManipulation.onManipulationEnd.add(() => {
          this.cardBeingManipulated = false
        })
      }
      if (this.cardInteractable) {
        this.cardInteractable.enabled = false
      }
    })

    this.setStatus(IDLE_STATUS_MESSAGE)
  }

  private onLeftPinchDown = () => {
    this.leftDown = true
    if (!this.isModeActive()) {
      return
    }
    if (this.rightDown) {
      this.startFraming()
    }
  }
  private onRightPinchDown = () => {
    this.rightDown = true
    if (!this.isModeActive()) {
      return
    }
    if (this.leftDown) {
      this.startFraming()
    }
  }
  private onLeftPinchUp = () => {
    this.leftDown = false
    if (!this.isModeActive()) {
      return
    }
    if (!this.rightDown) {
      this.stopFramingAndCapture()
    }
  }
  private onRightPinchUp = () => {
    this.rightDown = false
    if (!this.isModeActive()) {
      return
    }
    if (!this.leftDown) {
      this.stopFramingAndCapture()
    }
  }

  private onQuickCapture = () => {
    if (!this.isModeActive()) {
      return
    }
    if (this.busy || this.framingEvent) {
      return
    }
    this.triggerCapture(null)
  }

  private isModeActive(): boolean {
    return this.modeRoot != null && this.modeRoot.enabled
  }

  private startFraming() {
    if (this.busy || this.framingEvent || this.cardBeingManipulated) {
      return
    }
    this.cancelStatusRevert()
    this.clearCapturedPreview()
    this.setStatus("Frame the surface…")

    if (this.cardAnchor) {
      this.cardAnchor.enabled = true
    }
    if (this.previewImage && this.screenCropTexture) {
      const liveProvider = this.screenCropTexture.control as RectCropTextureProvider
      if (!this.liveCameraTexture) {
        this.liveCameraTexture = liveProvider.inputTexture
      } else {
        liveProvider.inputTexture = this.liveCameraTexture
      }
      this.previewImage.mainPass.captureImage = this.screenCropTexture
    }
    if (this.cardInteractable) {
      this.cardInteractable.enabled = false
    }

    this.framingEvent = this.createEvent("UpdateEvent")
    this.framingEvent.bind(this.updateFraming)
    this.updateFraming()
  }

  private applyCropRect(provider: RectCropTextureProvider, cropRect: CropRect) {
    const rect = provider.cropRect
    rect.setCenter(new vec2(cropRect.xMin + cropRect.xMax, cropRect.yMin + cropRect.yMax).uniformScale(0.5))
    rect.setSize(new vec2(cropRect.xMax - cropRect.xMin, cropRect.yMax - cropRect.yMin))
    provider.cropRect = rect
  }

  private toScreenSpace(worldPos: vec3): vec2 {
    return this.isEditor
      ? this.cameraService.WorldToEditorCameraSpace(worldPos)
      : this.cameraService.WorldToTrackingRightCameraSpace(worldPos)
  }

  private computeFrameCorners(leftPos: vec3, rightPos: vec3): vec3[] {
    const centerPos = leftPos.add(rightPos).uniformScale(0.5)
    const camPos = this.camera.getWorldPosition()
    const directionToCenter = camPos.sub(centerPos).normalize()
    const right = this.camera.up().cross(directionToCenter).normalize()

    const inv = this.camera.getInvertedWorldTransform()
    const width = Math.abs(inv.multiplyPoint(rightPos).x - inv.multiplyPoint(leftPos).x)

    const topRight = leftPos.add(right.uniformScale(width))
    const bottomLeft = rightPos.add(right.uniformScale(-width))

    return [leftPos, topRight, rightPos, bottomLeft]
  }

  private updateCardTransform(corners: vec3[]) {
    const [topLeft, topRight, bottomRight, bottomLeft] = corners

    const centerPos = topLeft.add(bottomRight).uniformScale(0.5)
    const worldWidth = Math.max(bottomRight.distance(bottomLeft), 0.01)
    const worldHeight = Math.max(topRight.distance(bottomRight), 0.01)

    const rectRight = topRight.sub(topLeft).normalize()
    const rectUp = topLeft.sub(bottomLeft).normalize()
    const rectForward = rectRight.cross(rectUp).normalize()

    const basis = new mat3()
    basis.column0 = rectRight
    basis.column1 = rectUp
    basis.column2 = rectForward

    const cardTrans = this.cardAnchor.getTransform()
    cardTrans.setWorldPosition(centerPos)
    cardTrans.setWorldRotation(quat.fromRotationMat(basis))
    cardTrans.setWorldScale(new vec3(worldWidth, worldHeight, 1))
  }

  private updateFraming = () => {
    const corners = this.computeFrameCorners(this.leftHand.thumbTip.position, this.rightHand.thumbTip.position)
    const screenPoints = corners.map((c) => this.toScreenSpace(c))

    const xMin = Math.min(...screenPoints.map((p) => p.x))
    const xMax = Math.max(...screenPoints.map((p) => p.x))
    const yMin = Math.min(...screenPoints.map((p) => p.y))
    const yMax = Math.max(...screenPoints.map((p) => p.y))
    this.lastCropRect = {xMin, xMax, yMin, yMax}

    this.applyCropRect(this.screenCropTexture.control as RectCropTextureProvider, this.lastCropRect)

    if (this.cardAnchor) {
      this.updateCardTransform(corners)
    }
  }

  private stopFramingAndCapture() {
    if (!this.framingEvent) {
      return
    }
    this.removeEvent(this.framingEvent)
    this.framingEvent = null

    const rect = this.lastCropRect
    this.lastCropRect = null

    if (!rect || rect.xMax - rect.xMin < MIN_FRAME_SIZE || rect.yMax - rect.yMin < MIN_FRAME_SIZE) {
      this.setStatus("Too small — pinch both hands to retry")
      return
    }
    this.triggerCapture(rect)
  }

  private triggerCapture(cropRect: CropRect | null) {
    if (this.busy) {
      return
    }
    this.busy = true
    this.cancelStatusRevert()
    this.showLoading()
    this.captureAndReveal(cropRect)
      .catch((error) => {
        print("TextureGrab error: " + error)
        this.setStatus("Failed — pinch to retry")
        this.hideLoading()
      })
      .then(() => {
        this.busy = false
      })
  }

  private showLoading() {
    if (!this.loadingObject) {
      return
    }
    this.enableObjectHierarchy(this.loadingObject, true)
    this.playLoadingGif()
  }

  private enableObjectHierarchy(obj: SceneObject, enabled: boolean) {
    if (!obj) return
    obj.enabled = enabled
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.enableObjectHierarchy(obj.getChild(i), enabled)
    }
  }

  private playLoadingGif() {
    if (!this.loadingObject) {
      return
    }
    const rmv = this.findRenderMeshVisual(this.loadingObject)
    if (rmv) {
      rmv.enabled = true
      const mainPass = rmv.mainMaterial?.mainPass
      if (mainPass) {
        const tex = mainPass.baseTexture || mainPass.baseTex || mainPass.mainTexture || mainPass.texture
        if (tex && tex.control) {
          const provider = tex.control as AnimatedTextureFileProvider
          if (provider && typeof provider.play === "function") {
            provider.play(-1, 0)
          }
        }
      }
    }
  }

  private findRenderMeshVisual(obj: SceneObject | null): RenderMeshVisual | null {
    if (!obj) {
      return null
    }
    let rmv = (obj.getComponent("Component.RenderMeshVisual") ??
      obj.getComponent("RenderMeshVisual")) as RenderMeshVisual | null
    if (rmv) {
      return rmv
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      const childRmv = this.findRenderMeshVisual(obj.getChild(i))
      if (childRmv) {
        return childRmv
      }
    }
    return null
  }

  private hideLoading() {
    if (!this.loadingObject) {
      return
    }
    const rmv = this.findRenderMeshVisual(this.loadingObject)
    if (rmv) {
      const mainPass = rmv.mainMaterial?.mainPass
      if (mainPass) {
        const tex = mainPass.baseTexture || mainPass.baseTex || mainPass.mainTexture || mainPass.texture
        if (tex && tex.control) {
          const provider = tex.control as AnimatedTextureFileProvider
          if (provider && typeof provider.stop === "function") {
            provider.stop()
          }
        }
      }
    }
    this.enableObjectHierarchy(this.loadingObject, false)
  }

  private async captureAndReveal(cropRect: CropRect | null) {
    this.setStatus("Grabbing…")
    const cameraModule: CameraModule = require("LensStudio:CameraModule")
    const imageRequest = CameraModule.createImageRequest()
    const useSourceCropForThisShot = USE_SOURCE_CROP && !!cropRect
    if (useSourceCropForThisShot) {
      const rect = imageRequest.crop
      rect.setCenter(new vec2(cropRect.xMin + cropRect.xMax, cropRect.yMin + cropRect.yMax).uniformScale(0.5))
      rect.setSize(new vec2(cropRect.xMax - cropRect.xMin, cropRect.yMax - cropRect.yMin))
      imageRequest.crop = rect
    }
    const imageFrame = await cameraModule.requestImage(imageRequest)
    const fullTex = imageFrame.texture
    print("TextureGrab: fullTex " + fullTex.getWidth() + "x" + fullTex.getHeight())

    let outputTex: Texture = fullTex
    if (cropRect && this.screenCropTexture && !useSourceCropForThisShot) {
      const resultProvider = this.screenCropTexture.control as RectCropTextureProvider
      resultProvider.inputTexture = fullTex
      this.applyCropRect(resultProvider, cropRect)
      await this.waitFrames(CROP_SETTLE_FRAMES)
      outputTex = this.screenCropTexture
    }
    print("TextureGrab: outputTex " + outputTex.getWidth() + "x" + outputTex.getHeight())

    this.revealCapturedPreview(outputTex)
    this.hideLoading()

    this.setStatus("Encoding…")
    const image = await this.encodeTexture(outputTex)
    print("TextureGrab: base64 length = " + image.length)

    this.pendingImage = image
    this.pendingCropRect = cropRect
    this.setStatus("Pinch Confirm to send")
  }

  private onConfirmPressed = () => {
    if (this.busy || !this.pendingImage) {
      return
    }
    this.busy = true
    this.setPreviewButtonsVisible(false)
    this.uploadPending()
      .catch((error) => {
        print("TextureGrab error: " + error)
        this.setStatus("Failed — pinch to retry")
        this.setPreviewButtonsVisible(true)
      })
      .then(() => {
        this.busy = false
      })
  }

  private onDiscardPressed = () => {
    this.clearCapturedPreview()
    this.setStatus(IDLE_STATUS_MESSAGE)
  }

  private async uploadPending() {
    const image = this.pendingImage
    const cropRect = this.pendingCropRect

    this.setStatus("Uploading…")
    const body: Record<string, unknown> = {image, t: getTime()}
    if (cropRect) {
      body.crop = cropRect
    }
    const {data, error} = await this.supabase.functions.invoke("upload", {body})

    if (error || !data || !data.code) {
      throw new Error(error ? JSON.stringify(error) : "no code returned")
    }

    this.pendingImage = null
    this.pendingCropRect = null
    this.setPreviewButtonsVisible(false)
    this.setStatusTemporary("Uploaded! Code: " + data.code, UPLOAD_CONFIRMATION_SECONDS, () => {
      if (this.capturedPreviewImage) {
        this.capturedPreviewImage.getSceneObject().enabled = false
      }
    })
  }

  private setStatusTemporary(message: string, seconds: number, onRevert?: () => void) {
    this.setStatus(message)
    this.cancelStatusRevert()
    this.statusRevertEvent = this.createEvent("DelayedCallbackEvent")
    this.statusRevertEvent.bind(() => {
      this.statusRevertEvent = null
      this.setStatus(IDLE_STATUS_MESSAGE)
      if (onRevert) {
        onRevert()
      }
    })
    this.statusRevertEvent.reset(seconds)
  }

  private cancelStatusRevert() {
    if (this.statusRevertEvent) {
      this.statusRevertEvent.cancel()
      this.statusRevertEvent = null
    }
  }

  private setPreviewButtonsVisible(visible: boolean) {
    if (this.confirmButton) {
      this.confirmButton.getSceneObject().enabled = visible
    }
    if (this.discardButton) {
      this.discardButton.getSceneObject().enabled = visible
    }
  }

  private clearCapturedPreview() {
    if (this.capturedPreviewImage) {
      this.capturedPreviewImage.getSceneObject().enabled = false
    }
    this.pendingImage = null
    this.pendingCropRect = null
    this.setPreviewButtonsVisible(false)
  }

  private revealCapturedPreview(tex: Texture) {
    if (this.cardAnchor) {
      this.cardAnchor.enabled = false
    }
    if (this.capturedPreviewImage) {
      this.capturedPreviewImage.mainPass.baseTex = tex
      const previewTrans = this.capturedPreviewImage.getSceneObject().getTransform()
      const scale = previewTrans.getLocalScale()
      const aspect = tex.getWidth() / tex.getHeight()
      previewTrans.setLocalScale(new vec3(scale.y * aspect, scale.y, scale.z))
      this.capturedPreviewImage.getSceneObject().enabled = true
    }
    this.setPreviewButtonsVisible(true)
  }

  private waitFrames(count: number): Promise<void> {
    return new Promise((resolve) => {
      let remaining = count
      const ev = this.createEvent("UpdateEvent")
      ev.bind(() => {
        remaining -= 1
        if (remaining <= 0) {
          this.removeEvent(ev)
          resolve()
        }
      })
    })
  }

  private encodeTexture(tex: Texture): Promise<string> {
    return new Promise((resolve, reject) => {
      Base64.encodeTextureAsync(
        tex,
        resolve,
        () => reject(new Error("Base64 encode failed")),
        CompressionQuality.HighQuality,
        EncodingType.Jpg
      )
    })
  }

  private setStatus(message: string) {
    if (this.statusText) {
      this.statusText.text = message
    }
    print("TextureGrab: " + message)
  }
}
