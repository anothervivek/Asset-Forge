@component
export class AsrExample extends BaseScriptComponent {
  private asrModule = require("LensStudio:AsrModule")

  @input
  textTest: Text

  private logToText(message: string): void {
    print(message)
    if (this.textTest) {
      this.textTest.text = message
    }
  }

  private onTranscriptionUpdate(eventArgs: AsrModule.TranscriptionUpdateEvent) {
    this.logToText(`onTranscriptionUpdateCallback text=${eventArgs.text}, isFinal=${eventArgs.isFinal}`)
  }

  private onTranscriptionError(eventArgs: AsrModule.AsrStatusCode) {
    this.logToText(`onTranscriptionErrorCallback errorCode: ${eventArgs}`)
    switch (eventArgs) {
      case AsrModule.AsrStatusCode.InternalError:
        this.logToText("stopTranscribing: Internal Error")
        break
      case AsrModule.AsrStatusCode.Unauthenticated:
        this.logToText("stopTranscribing: Unauthenticated")
        break
      case AsrModule.AsrStatusCode.NoInternet:
        this.logToText("stopTranscribing: No Internet")
        break
    }
  }

  onAwake(): void {
    const options = AsrModule.AsrTranscriptionOptions.create()
    options.silenceUntilTerminationMs = 1000
    options.mode = AsrModule.AsrMode.HighAccuracy
    options.onTranscriptionUpdateEvent.add((eventArgs) => this.onTranscriptionUpdate(eventArgs))
    options.onTranscriptionErrorEvent.add((eventArgs) => this.onTranscriptionError(eventArgs))

    this.asrModule.startTranscribing(options)
  }

  private stopSession(): void {
    this.asrModule.stopTranscribing()
  }
}
