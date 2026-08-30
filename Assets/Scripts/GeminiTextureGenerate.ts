import {createClient, type SupabaseClient} from "SupabaseClient.lspkg/supabase-snapcloud"
import {BaseButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton"
import {TextInputField} from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField"
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {Imagen} from "RemoteServiceGateway.lspkg/HostedExternal/Imagen"
import {GoogleGenAITypes} from "RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes"
import {OpenAI} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAI"
import {OpenAITypes} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAITypes"
import {Promisfy} from "RemoteServiceGateway.lspkg/Utils/Promisfy"
import {ASRQueryController} from "./ASRQueryController"
import {getOrCreateDeviceId} from "./DeviceId"

const IDLE_STATUS_MESSAGE = "Tap the mic to speak, or type a prompt"
const UPLOAD_CONFIRMATION_SECONDS = 2.5
// If this 404s with "not found or your project does not have access to it" for every
// model id, the RSG "Google Token" credential (see RemoteServiceGatewayCredentials) does
// not have Imagen access provisioned on Snap's side - it is not a wrong model name.
const IMAGEN_MODEL = "imagen-3.0-generate-002"
// OpenAI retired DALL-E (dall-e-2 and dall-e-3) on 2026-05-12; gpt-image-1 is its replacement
// and only supports 1024x1024 / 1024x1536 / 1536x1024 / auto sizes, no response_format param.
const OPENAI_IMAGE_MODEL: OpenAITypes.ImageGenerate.Model = "gpt-image-1"
const OPENAI_IMAGE_SIZE = "1024x1024"

@component
export class GeminiTextureGenerate extends BaseScriptComponent {
  @input supabaseProject!: SupabaseProject
  @input statusText!: Text
  @input voiceController!: ASRQueryController
  @input micButton!: BaseButton
  @input activityRenderMesh!: RenderMeshVisual
  @input promptInput!: TextInputField
  @input generateButton!: BaseButton
  @input pushButton!: BaseButton
  @input discardButton!: BaseButton
  @input previewImage!: RenderMeshVisual
  @input loadingObject!: SceneObject
  @input titleScreen!: SceneObject

  private supabase!: SupabaseClient
  private activityMaterial!: Material
  private internetModule = require("LensStudio:InternetModule") as InternetModule
  private remoteMediaModule = require("LensStudio:RemoteMediaModule") as RemoteMediaModule
  private modeRoot: SceneObject | null = null
  private busy = false

  private previewTexture: Texture | null = null
  private previewPrompt: string | null = null

  private statusRevertEvent: DelayedCallbackEvent | null = null

  onAwake() {
    this.supabase = createClient(this.supabaseProject.url, this.supabaseProject.publicToken)
    this.modeRoot = this.getSceneObject().getParent()

    this.activityMaterial = this.activityRenderMesh.mainMaterial.clone()
    this.activityRenderMesh.clearMaterials()
    this.activityRenderMesh.mainMaterial = this.activityMaterial
    this.activityMaterial.mainPass.in_out = 0

    this.voiceController.onListeningStarted.add(() => {
      if (!this.isModeActive()) {
        return
      }
      this.clearPreview()
      this.promptInput.text = ""
      this.setStatus("Listening…")
      this.animateActivityIndicator(true)
    })
    this.voiceController.onListeningStopped.add(() => {
      if (!this.isModeActive()) {
        return
      }
      this.setStatus(IDLE_STATUS_MESSAGE)
      this.animateActivityIndicator(false)
    })
    this.voiceController.onPartialTranscript.add((text) => {
      if (!this.isModeActive()) {
        return
      }
      this.promptInput.text = text
    })
    this.voiceController.onFinalTranscript.add((text) => {
      if (!this.isModeActive()) {
        return
      }
      this.setStatus(text ? "Tap Generate when ready" : "Didn't catch that, tap the mic to retry")
    })
    this.voiceController.onError.add((errorCode) => {
      if (!this.isModeActive()) {
        return
      }
      this.setStatus(
        errorCode === "timeout" ? "Didn't catch that, tap the mic to retry" : "Mic error, tap to retry: " + errorCode
      )
    })

    if (this.loadingObject) {
      this.loadingObject.enabled = false
    }
    this.previewImage.getSceneObject().enabled = false

    this.createEvent("OnDisableEvent").bind(() => {
      this.voiceController.cancelListening()
    })

    this.createEvent("OnStartEvent").bind(() => {
      this.micButton.onInitialized.add(() => {
        this.micButton.onTriggerUp.add(this.onMicPressed)
      })
      this.generateButton.onInitialized.add(() => {
        this.generateButton.onTriggerUp.add(this.onGeneratePressed)
      })
      this.pushButton.onInitialized.add(() => {
        this.pushButton.onTriggerUp.add(this.onPushPressed)
      })
      this.discardButton.onInitialized.add(() => {
        this.discardButton.onTriggerUp.add(this.onDiscardPressed)
      })
      this.promptInput.onReturnKeyPressed.add(() => this.onGeneratePressed())
      this.setHasPreview(false)

      if (this.titleScreen) {
        this.promptInput.onKeyboardStateChanged.add((isOpen) => {
          this.titleScreen.enabled = !isOpen
        })
      }
    })

    this.setStatus(IDLE_STATUS_MESSAGE)
  }

  private isModeActive(): boolean {
    return this.modeRoot != null && this.modeRoot.enabled
  }

  private onMicPressed = () => {
    if (this.busy) {
      return
    }
    this.voiceController.toggleListening()
  }

  private animateActivityIndicator(on: boolean) {
    if (on) {
      animate({
        duration: 0.5,
        easing: "linear",
        update: (t) => {
          this.activityMaterial.mainPass.in_out = t
        },
      })
    } else {
      animate({
        duration: 0.5,
        easing: "linear",
        update: (t) => {
          this.activityMaterial.mainPass.in_out = 1 - t
        },
      })
    }
  }

  private onGeneratePressed = () => {
    if (this.busy || this.voiceController.isRecording) {
      return
    }
    const prompt = this.promptInput.text.trim()
    if (!prompt) {
      this.setStatus("Type or say a prompt first")
      return
    }
    this.clearPreview()
    this.generate(prompt)
  }

  private async generate(prompt: string) {
    this.busy = true
    this.setStatus('Generating "' + prompt + '" with Imagen…')
    this.showLoading()

    try {
      let texture: Texture
      try {
        texture = await this.generateWithImagen(prompt)
      } catch (imagenError) {
        print("GeminiTextureGenerate: Imagen failed, falling back to OpenAI image generation: " + imagenError)
        this.setStatus('Imagen unavailable, trying OpenAI for "' + prompt + '"…')
        texture = await this.generateWithOpenAIImage(prompt)
      }
      this.showPreview(texture, prompt)
    } catch (error) {
      print("GeminiTextureGenerate error: " + error)
      this.setStatus("Failed. Tap Generate to retry")
    } finally {
      this.busy = false
      this.hideLoading()
    }
  }

  private async generateWithImagen(prompt: string): Promise<Texture> {
    const request: GoogleGenAITypes.Imagen.ImagenRequest = {
      model: IMAGEN_MODEL,
      body: {
        instances: [{prompt}],
        parameters: {
          sampleCount: 1,
          addWatermark: false,
          aspectRatio: "1:1",
          enhancePrompt: true,
          language: "en",
        },
      },
    }
    const response = await Imagen.generateImage(request)
    const prediction = response.predictions?.[0]
    if (!prediction || !prediction.bytesBase64Encoded) {
      throw new Error("Imagen didn't return an image")
    }
    return this.decodeTexture(prediction.bytesBase64Encoded)
  }

  private async generateWithOpenAIImage(prompt: string): Promise<Texture> {
    const request: OpenAITypes.ImageGenerate.Request = {
      model: OPENAI_IMAGE_MODEL,
      prompt,
      n: 1,
      size: OPENAI_IMAGE_SIZE,
    }
    const response = await OpenAI.imagesGenerate(request)
    const image = response.data?.[0]
    if (!image || (!image.b64_json && !image.url)) {
      throw new Error("OpenAI didn't return an image. Try rewording the prompt")
    }
    if (image.b64_json) {
      return this.decodeTexture(image.b64_json)
    }
    const httpRequest = RemoteServiceHttpRequest.create()
    httpRequest.url = image.url!
    const httpResponse = await Promisfy.InternetModule.performHttpRequest(this.internetModule, httpRequest)
    const resource = httpResponse.asResource()
    return Promisfy.RemoteMediaModule.loadResourceAsImageTexture(this.remoteMediaModule, resource)
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

  private showPreview(texture: Texture, prompt: string) {
    this.hideLoading()
    this.clearPreview()
    this.previewImage.mainPass.baseTex = texture
    this.previewTexture = texture
    this.previewPrompt = prompt
    this.promptInput.text = ""

    this.previewImage.getSceneObject().enabled = true
    this.setHasPreview(true)
    this.setStatus("Like it? Push to companion, or discard to retry")
  }

  private onPushPressed = () => {
    if (this.busy || !this.previewTexture) {
      return
    }
    this.busy = true
    this.setHasPreview(false)
    this.showLoading()
    this.uploadPreview(this.previewTexture)
      .catch((error) => {
        print("GeminiTextureGenerate error: " + error)
        this.setStatus("Failed. Tap to retry")
        this.setHasPreview(true)
      })
      .then(() => {
        this.busy = false
        this.hideLoading()
      })
  }

  private onDiscardPressed = () => {
    this.clearPreview()
    this.setStatus(IDLE_STATUS_MESSAGE)
  }

  private clearPreview() {
    this.cancelStatusRevert()
    this.previewImage.getSceneObject().enabled = false
    this.previewTexture = null
    this.previewPrompt = null
    this.setHasPreview(false)
  }

  private setStatusTemporary(message: string, seconds: number) {
    this.setStatus(message)
    this.cancelStatusRevert()
    this.statusRevertEvent = this.createEvent("DelayedCallbackEvent")
    this.statusRevertEvent.bind(() => {
      this.statusRevertEvent = null
      this.setStatus(IDLE_STATUS_MESSAGE)
    })
    this.statusRevertEvent.reset(seconds)
  }

  private cancelStatusRevert() {
    if (this.statusRevertEvent) {
      this.statusRevertEvent.cancel()
      this.statusRevertEvent = null
    }
  }

  private setHasPreview(hasPreview: boolean) {
    this.pushButton.getSceneObject().enabled = hasPreview
    this.discardButton.getSceneObject().enabled = hasPreview
    this.generateButton.getSceneObject().enabled = !hasPreview
  }

  private async uploadPreview(texture: Texture) {
    const prompt = this.previewPrompt
    this.setStatus("Uploading…")
    const image = await this.encodeTexture(texture)
    const {data, error} = await this.supabase.functions.invoke("upload", {
      body: {image, t: getTime(), source: "ai", prompt, deviceId: getOrCreateDeviceId()},
    })

    if (error || !data || !data.code) {
      throw new Error(error ? JSON.stringify(error) : "no code returned")
    }

    this.clearPreview()
    this.setStatusTemporary("Uploaded! Code: " + data.code, UPLOAD_CONFIRMATION_SECONDS)
  }

  private decodeTexture(base64: string): Promise<Texture> {
    return new Promise((resolve, reject) => {
      Base64.decodeTextureAsync(base64, resolve, () => reject(new Error("Failed to decode Imagen image")))
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
    print("GeminiTextureGenerate: " + message)
  }
}
