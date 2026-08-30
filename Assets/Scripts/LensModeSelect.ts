import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"

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

    this.createEvent("OnStartEvent").bind(() => {
      this.textureModeButton.onTriggerUp.add(() => this.selectMode(this.textureModeRoot))
      this.modelModeButton.onTriggerUp.add(() => this.selectMode(this.modelModeRoot))
      this.aiGenModeButton.onTriggerUp.add(() => this.selectMode(this.aiGenModeRoot))
      this.codeModeButton.onTriggerUp.add(() => this.toggleMode(this.codeModeRoot))
      this.codeModeCloseButton.onTriggerUp.add(() => (this.codeModeRoot.enabled = false))
    })
  }

  private selectMode(root: SceneObject) {
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
