import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"

@component
export class LensModeSelect extends BaseScriptComponent {
  @input private titleScreen!: SceneObject
  @input private textureModeRoot!: SceneObject
  @input private modelModeRoot!: SceneObject
  @input private aiGenModeRoot!: SceneObject
  @input private textureModeButton!: RectangleButton
  @input private modelModeButton!: RectangleButton
  @input private aiGenModeButton!: RectangleButton

  private modeRoots: SceneObject[] = []

  onAwake() {
    this.modeRoots = [this.textureModeRoot, this.modelModeRoot, this.aiGenModeRoot]
    this.modeRoots.forEach((root) => (root.enabled = false))

    this.createEvent("OnStartEvent").bind(() => {
      this.textureModeButton.onTriggerUp.add(() => this.selectMode(this.textureModeRoot))
      this.modelModeButton.onTriggerUp.add(() => this.selectMode(this.modelModeRoot))
      this.aiGenModeButton.onTriggerUp.add(() => this.selectMode(this.aiGenModeRoot))
    })
  }

  private selectMode(root: SceneObject) {
    this.modeRoots.forEach((r) => (r.enabled = false))
    root.enabled = true
  }
}
