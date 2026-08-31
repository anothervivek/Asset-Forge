import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"

const HAS_LAUNCHED_BEFORE_KEY = "assetForgeHasLaunchedBefore"

@component
export class LensModeSelect extends BaseScriptComponent {
  @input private titleScreen!: SceneObject
  @input private textureModeRoot!: SceneObject
  @input private modelModeRoot!: SceneObject
  @input private aiGenModeRoot!: SceneObject
  @input private codeModeRoot!: SceneObject
  @input private textureModeButton!: RectangleButton
  @input private modelModeButton!: RectangleButton
  @input private aiGenModeButton!: RectangleButton
  @input private codeModeButton!: RectangleButton
  @input private codeModeCloseButton!: RectangleButton

  private modeRoots: SceneObject[] = []

  onAwake() {
    this.modeRoots = [this.textureModeRoot, this.modelModeRoot, this.aiGenModeRoot, this.codeModeRoot]
    this.modeRoots.forEach((root) => (root.enabled = false))

    // First-ever launch on this device: surface the device-link code by default so the
    // user can link it before doing anything else. Every launch after that behaves
    // normally - code mode stays collapsed until the link button is tapped.
    const store = global.persistentStorageSystem.store
    if (!store.getBool(HAS_LAUNCHED_BEFORE_KEY)) {
      store.putBool(HAS_LAUNCHED_BEFORE_KEY, true)
      this.codeModeRoot.enabled = true
    }

    this.createEvent("OnStartEvent").bind(() => {
      this.textureModeButton.onTriggerUp.add(() => this.selectMode(this.textureModeRoot))
      this.modelModeButton.onTriggerUp.add(() => this.selectMode(this.modelModeRoot))
      this.aiGenModeButton.onTriggerUp.add(() => this.selectMode(this.aiGenModeRoot))
      this.codeModeButton.onTriggerUp.add(() => this.toggleMode(this.codeModeRoot))
      this.codeModeCloseButton.onTriggerUp.add(() => (this.codeModeRoot.enabled = false))
    })
  }

  private selectMode(root: SceneObject) {
    // Only ever toggle `enabled` here - never destroy/reset a mode's SceneObjects.
    // An in-flight AI generation or an unconfirmed preview in the mode being hidden
    // must keep running and survive in the background until the user returns.
    this.modeRoots.forEach((r) => (r.enabled = false))
    root.enabled = true
  }

  private toggleMode(root: SceneObject) {
    if (root.enabled) {
      root.enabled = false
    } else {
      this.selectMode(root)
    }
  }
}
