import {createClient, type SupabaseClient} from "SupabaseClient.lspkg/supabase-snapcloud"
import {BaseButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton"
import {TextInputField} from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField"
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {Imagen} from "RemoteServiceGateway.lspkg/HostedExternal/Imagen"
import {GoogleGenAITypes} from "RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes"

const SILENCE_TERMINATION_MS = 1200
const LISTENING_TIMEOUT_SECONDS = 10
const MIC_TAP_DEBOUNCE_SECONDS = 0.35
const IDLE_STATUS_MESSAGE = "Tap the mic to speak, or type a prompt"
const UPLOAD_CONFIRMATION_SECONDS = 2.5
const IMAGEN_MODEL = "imagen-3.0-generate-002"

@component
export class GeminiTextureGenerate extends BaseScriptComponent {
  @input supabaseProject!: SupabaseProject
  @input statusText!: Text
  @input micButton!: BaseButton
  @input promptInput!: TextInputField
  @input generateButton!: BaseButton
  @input pushButton!: BaseButton
  @input discardButton!: BaseButton
  @input previewImage!: RenderMeshVisual
  @input loadingObject!: SceneObject
  @input activityRenderMesh!: RenderMeshVisual
  @input titleScreen!: SceneObject

  private supabase!: SupabaseClient
  private asrModule: AsrModule = require("LensStudio:AsrModule")
  private asrSettings: AsrModule.AsrTranscriptionOptions | null = null
  private activityMaterial!: Material
  private isRecording = false
  private lastMicTapTime = 0
  private busy = false
  private listeningTimeoutEvent: DelayedCallbackEvent | null = null

  private previewTexture: Texture | null = null
  private previewPrompt: string | null = null

  private statusRevertEvent: DelayedCallbackEvent | null = null

  onAwake() {
    this.supabase = createClient(this.supabaseProject.url, this.supabaseProject.publicToken)

    this.activityMaterial = this.activityRenderMesh.mainMaterial.clone()
    this.activityRenderMesh.clearMaterials()
    this.activityRenderMesh.mainMaterial = this.activityMaterial
    this.activityMaterial.mainPass.in_out = 0

    this.asrSettings = AsrModule.AsrTranscriptionOptions.create()
    this.asrSettings.mode = AsrModule.AsrMode.Balanced
    this.asrSettings.silenceUntilTerminationMs = SILENCE_TERMINATION_MS
    this.asrSettings.onTranscriptionUpdateEvent.add((asrOutput) => {
      print("GeminiTextureGenerate AsrUpdate: text=" + asrOutput.text + ", isFinal=" + asrOutput.isFinal)
      if (asrOutput.text !== undefined && asrOutput.text !== null) {
        this.promptInput.text = asrOutput.text
      }
      if (!asrOutput.isFinal) {
        this.startListeningTimeout()
        return
      }
      this.finishListening(null)
      const text = asrOutput.text ? asrOutput.text.trim() : ""
      this.setStatus(text ? "Tap Generate when ready" : "Didn't catch that — tap the mic to retry")
    })
    this.asrSettings.onTranscriptionErrorEvent.add((errorCode) => {
      print("GeminiTextureGenerate AsrError: errorCode=" + errorCode)
      this.finishListening(null)
      this.setStatus("Mic error — tap to retry: " + errorCode)
    })

    if (this.loadingObject) {
      this.loadingObject.enabled = false
    }
    this.previewImage.getSceneObject().enabled = false

    this.createEvent("OnDisableEvent").bind(() => {
      if (this.isRecording) {
        this.finishListening(null)
      }
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

  private onMicPressed = () => {
    if (this.busy) {
      return
    }
    const now = getTime()
    if (now - this.lastMicTapTime < MIC_TAP_DEBOUNCE_SECONDS) {
      return
    }
    this.lastMicTapTime = now

    if (this.isRecording) {
      this.finishListening(IDLE_STATUS_MESSAGE)
      return
    }
    this.clearPreview()
    this.startListening()
  }

  private startListening() {
    this.isRecording = true
    this.promptInput.text = ""
    this.setStatus("Listening…")
    this.animateActivityIndicator(true)
    this.startListeningTimeout()

    if (this.asrSettings) {
      this.asrModule.startTranscribing(this.asrSettings)
    }
  }

  private startListeningTimeout() {
    this.cancelListeningTimeout()
    this.listeningTimeoutEvent = this.createEvent("DelayedCallbackEvent")
    this.listeningTimeoutEvent.bind(() => {
      this.listeningTimeoutEvent = null
      if (!this.isRecording) {
        return
      }
      print("GeminiTextureGenerate AsrTimeout: no final transcription after " + LISTENING_TIMEOUT_SECONDS + "s")
      this.finishListening("Didn't catch that — tap the mic to retry")
    })
    this.listeningTimeoutEvent.reset(LISTENING_TIMEOUT_SECONDS)
  }

  private cancelListeningTimeout() {
    if (this.listeningTimeoutEvent) {
      this.listeningTimeoutEvent.cancel()
      this.listeningTimeoutEvent = null
    }
  }

  private finishListening(statusMessage: string | null) {
    this.cancelListeningTimeout()
    this.isRecording = false
    this.animateActivityIndicator(false)
    this.asrModule.stopTranscribing()
    if (statusMessage !== null) {
      this.setStatus(statusMessage)
    }
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
    if (this.busy || this.isRecording) {
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
    this.setStatus('Generating "' + prompt + '"…')
    this.showLoading()

    try {
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
        throw new Error("Imagen didn't return an image — try rewording the prompt")
      }
      const texture = await this.decodeTexture(prediction.bytesBase64Encoded)
      this.showPreview(texture, prompt)
    } catch (error) {
      print("GeminiTextureGenerate error: " + error)
      this.setStatus("Failed — tap Generate to retry")
    } finally {
      this.busy = false
      this.hideLoading()
    }
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
        this.setStatus("Failed — tap to retry")
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
      body: {image, t: getTime(), source: "ai", prompt},
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
