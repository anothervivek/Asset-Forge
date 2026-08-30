import {createClient, type SupabaseClient} from "SupabaseClient.lspkg/supabase-snapcloud"
import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {getOrCreateDeviceId} from "./DeviceId"

const CACHED_CODE_KEY = "assetForgeDeviceCode"

@component
export class DeviceLinkController extends BaseScriptComponent {
  @input supabaseProject!: SupabaseProject
  @input codeText!: Text
  @input retryButton!: RectangleButton

  private supabase!: SupabaseClient
  private busy = false

  onAwake() {
    this.supabase = createClient(this.supabaseProject.url, this.supabaseProject.publicToken)

    this.createEvent("OnStartEvent").bind(() => {
      this.retryButton.onInitialized.add(() => {
        this.retryButton.onTriggerUp.add(this.onRetryPressed)
      })
    })

    const store = global.persistentStorageSystem.store
    if (store.has(CACHED_CODE_KEY)) {
      this.codeText.text = store.getString(CACHED_CODE_KEY)
      return
    }

    this.fetchCode()
  }

  private onRetryPressed = () => {
    if (this.busy) {
      return
    }
    this.fetchCode()
  }

  private fetchCode() {
    this.busy = true
    this.codeText.text = "FETCHING…"

    this.supabase.functions
      .invoke("device-code", {body: {deviceId: getOrCreateDeviceId()}})
      .then(({data, error}) => {
        if (error || !data || !data.code) {
          this.codeText.text = "FAILED"
          return
        }
        global.persistentStorageSystem.store.putString(CACHED_CODE_KEY, data.code)
        this.codeText.text = data.code
      })
      .catch(() => {
        this.codeText.text = "FAILED"
      })
      .then(() => {
        this.busy = false
      })
  }
}
