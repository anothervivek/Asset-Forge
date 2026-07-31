@component
export class AudioTest extends BaseScriptComponent {
  @input transcriptText!: Text
  @input statusText!: Text

  private asrModule: AsrModule = require("LensStudio:AsrModule")
  private gestureModule: GestureModule = require("LensStudio:GestureModule")
  private isRecording = false

  onAwake() {
    if (global.deviceInfoSystem.isEditor()) {
      this.createEvent("TapEvent").bind(() => this.onTriggerPressed())
    } else {
      this.gestureModule.getPinchDownEvent(GestureModule.HandType.Right).add(() => this.onTriggerPressed())
    }
    this.setStatus("Ready — pinch (device) or click (editor) to start")
  }

  private onTriggerPressed = () => {
    print("AudioTest: triggered at t=" + getTime().toFixed(2) + "s, isRecording=" + this.isRecording)

    if (this.isRecording) {
      this.asrModule.stopTranscribing()
      this.isRecording = false
      this.setStatus("Stopped manually")
      return
    }

    this.isRecording = true
    if (this.transcriptText) {
      this.transcriptText.text = ""
    }
    this.setStatus("Listening…")

    const asrSettings = AsrModule.AsrTranscriptionOptions.create()
    asrSettings.mode = AsrModule.AsrMode.HighAccuracy
    asrSettings.silenceUntilTerminationMs = 1200

    asrSettings.onTranscriptionUpdateEvent.add((asrOutput) => {
      print(
        "AudioTest: UPDATE at t=" +
          getTime().toFixed(2) +
          's — text="' +
          asrOutput.text +
          '" isFinal=' +
          asrOutput.isFinal
      )
      if (this.transcriptText) {
        this.transcriptText.text = asrOutput.text
      }
      if (!asrOutput.isFinal) {
        this.setStatus("Listening… (partial update received)")
        return
      }
      this.isRecording = false
      this.asrModule.stopTranscribing()
      this.setStatus("Final received — done")
    })

    asrSettings.onTranscriptionErrorEvent.add((errorCode) => {
      print("AudioTest: ERROR at t=" + getTime().toFixed(2) + "s — code=" + errorCode)
      this.isRecording = false
      this.setStatus("Error: " + errorCode)
    })

    print("AudioTest: calling startTranscribing() at t=" + getTime().toFixed(2) + "s")
    this.asrModule.startTranscribing(asrSettings)
  }

  private setStatus(message: string) {
    if (this.statusText) {
      this.statusText.text = message
    }
    print("AudioTest: " + message)
  }
}
