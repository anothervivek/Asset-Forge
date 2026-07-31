import {createClient, type SupabaseClient} from "SupabaseClient.lspkg/supabase-snapcloud"
import {BaseButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton"
import {TextInputField} from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import {Snap3D} from "RemoteServiceGateway.lspkg/HostedSnap/Snap3D"
import {Snap3DTypes} from "RemoteServiceGateway.lspkg/HostedSnap/Snap3DTypes"

const SILENCE_TERMINATION_MS = 1200
const LISTENING_TIMEOUT_SECONDS = 10
const MIC_TAP_DEBOUNCE_SECONDS = 0.35
const IDLE_STATUS_MESSAGE = "Tap the mic to speak, or type a prompt"
const UPLOAD_CONFIRMATION_SECONDS = 2.5

@component
export class Snap3DVoiceGenerate extends BaseScriptComponent {
  @input supabaseProject!: SupabaseProject
  @input statusText!: Text
  @input micButton!: BaseButton
  @input promptInput!: TextInputField
  @input generateButton!: BaseButton
  @input pushButton!: BaseButton
  @input discardButton!: BaseButton
  @input modelParent!: SceneObject
  @input previewMaterial!: Material
  @input loadingObject!: SceneObject
  @input activityRenderMesh!: RenderMeshVisual
  @input titleScreen!: SceneObject
  @input refineMesh: boolean = true
  @input useVertexColor: boolean = false

  private supabase!: SupabaseClient
  private asrModule: AsrModule = require("LensStudio:AsrModule")
  private asrSettings: AsrModule.AsrTranscriptionOptions | null = null
  private camera = WorldCameraFinderProvider.getInstance()
  private activityMaterial!: Material
  private isRecording = false
  private lastMicTapTime = 0
  private busy = false
  private listeningTimeoutEvent: DelayedCallbackEvent | null = null
  private modelInteractable: Interactable | null = null
  private modelManipulation: InteractableManipulation | null = null
  private modelBeingManipulated = false

  private previewObj: SceneObject | null = null
  private previewUrl: string | null = null
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
      print("Snap3DVoiceGenerate AsrUpdate: text=" + asrOutput.text + ", isFinal=" + asrOutput.isFinal)
      if (asrOutput.text !== undefined && asrOutput.text !== null) {
        this.promptInput.text = asrOutput.text
      }
      if (!asrOutput.isFinal) {
        this.startListeningTimeout()
        return
      }
      this.finishListening(null)
      const text = asrOutput.text ? asrOutput.text.trim() : ""
      this.setStatus(text ? "Tap Generate 3D when ready" : "Didn't catch that — tap the mic to retry")
    })
    this.asrSettings.onTranscriptionErrorEvent.add((errorCode) => {
      print("Snap3DVoiceGenerate AsrError: errorCode=" + errorCode)
      this.finishListening(null)
      this.setStatus("Mic error — tap to retry: " + errorCode)
    })

    if (this.loadingObject) {
      this.loadingObject.enabled = false
    }

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

      this.modelInteractable = this.modelParent.getComponent(Interactable.getTypeName())
      this.modelManipulation = this.modelParent.getComponent(InteractableManipulation.getTypeName())
      if (this.modelManipulation) {
        this.modelManipulation.onManipulationStart.add(() => {
          this.modelBeingManipulated = true
        })
        this.modelManipulation.onManipulationEnd.add(() => {
          this.modelBeingManipulated = false
        })
      }
      if (this.modelInteractable) {
        this.modelInteractable.enabled = false
      }
    })

    this.setStatus(IDLE_STATUS_MESSAGE)
  }

  private onMicPressed = () => {
    if (this.busy || this.modelBeingManipulated) {
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
      print("Snap3DVoiceGenerate AsrTimeout: no final transcription after " + LISTENING_TIMEOUT_SECONDS + "s")
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
    if (this.busy || this.isRecording || this.modelBeingManipulated) {
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
      const submitGetStatus = await Snap3D.submitAndGetStatus({
        prompt,
        format: "glb",
        refine: this.refineMesh,
        use_vertex_color: this.useVertexColor,
      })

      await new Promise<void>((resolve, reject) => {
        submitGetStatus.event.add(([value, assetOrError]) => {
          const isDone = value === "refined_mesh" || (value === "base_mesh" && !this.refineMesh)
          if (isDone) {
            this.showPreview(assetOrError as Snap3DTypes.GltfAssetData, prompt)
            resolve()
          } else if (value === "failed") {
            reject(new Error((assetOrError as Snap3DTypes.ErrorData).errorMsg))
          }
        })
      })
    } catch (error) {
      print("Snap3DVoiceGenerate error: " + error)
      this.setStatus("Failed — tap Generate 3D to retry")
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

  private showPreview(gltfData: Snap3DTypes.GltfAssetData, prompt: string) {
    this.hideLoading()
    this.clearPreview()
    const settings = GltfSettings.create()
    settings.convertMetersToCentimeters = true
    this.previewObj = gltfData.gltfAsset.tryInstantiateWithSetting(this.modelParent, this.previewMaterial, settings)
    this.previewObj.getTransform().setWorldPosition(this.modelParent.getTransform().getWorldPosition())
    this.previewObj.getTransform().setWorldRotation(quat.lookAt(this.camera.forward(), vec3.up()))

    this.previewUrl = gltfData.url
    this.previewPrompt = prompt
    this.promptInput.text = ""
    this.setHasPreview(true)
    if (this.modelInteractable) {
      this.modelInteractable.enabled = true
    }
    this.setStatus("Like it? Push to companion, or discard to retry")
  }

  private onPushPressed = () => {
    if (this.busy || !this.previewUrl || !this.previewPrompt) {
      return
    }
    this.busy = true
    this.setHasPreview(false)
    this.showLoading()
    this.uploadModel(this.previewUrl, this.previewPrompt)
      .catch((error) => {
        print("Snap3DVoiceGenerate error: " + error)
        this.setStatus("Failed — tap to retry")
        this.setHasPreview(true)
      })
      .then(() => {
        this.busy = false
        this.hideLoading()
      })
  }

  private onDiscardPressed = () => {
    if (this.modelBeingManipulated) {
      return
    }
    this.clearPreview()
    this.setStatus(IDLE_STATUS_MESSAGE)
  }

  private clearPreview() {
    this.cancelStatusRevert()
    if (this.previewObj) {
      this.previewObj.destroy()
      this.previewObj = null
    }
    this.previewUrl = null
    this.previewPrompt = null
    this.setHasPreview(false)
    if (this.modelInteractable) {
      this.modelInteractable.enabled = false
    }
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

  private async uploadModel(url: string, prompt: string) {
    this.setStatus("Uploading model…")
    const {data, error} = await this.supabase.functions.invoke("upload-model", {body: {url, prompt}})

    if (error || !data || !data.code) {
      throw new Error(error ? JSON.stringify(error) : "no code returned")
    }

    this.clearPreview()
    this.setStatusTemporary("Uploaded! Code: " + data.code, UPLOAD_CONFIRMATION_SECONDS)
  }

  private setStatus(message: string) {
    if (this.statusText) {
      this.statusText.text = message
    }
    print("Snap3DVoiceGenerate: " + message)
  }
}
