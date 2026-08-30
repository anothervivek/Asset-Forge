import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"

const SILENCE_TERMINATION_MS = 1000
const LISTENING_TIMEOUT_SECONDS = 10
const MIC_TAP_DEBOUNCE_SECONDS = 1.2

@component
export class ASRQueryController extends BaseScriptComponent {
  public onListeningStarted: Event<void> = new Event<void>()
  public onListeningStopped: Event<void> = new Event<void>()
  public onPartialTranscript: Event<string> = new Event<string>()
  public onFinalTranscript: Event<string> = new Event<string>()
  public onError: Event<string> = new Event<string>()

  public isRecording = false

  private asrModule: AsrModule = require("LensStudio:AsrModule")
  private lastMicTapTime = 0
  private listeningTimeoutEvent: DelayedCallbackEvent | null = null
  private armed = false

  onAwake() {
    print("ASRQueryController: onAwake, creating ASR session")
    const asrSettings = AsrModule.AsrTranscriptionOptions.create()
    asrSettings.mode = AsrModule.AsrMode.HighAccuracy
    asrSettings.silenceUntilTerminationMs = SILENCE_TERMINATION_MS
    asrSettings.onTranscriptionUpdateEvent.add((asrOutput) => {
      print(
        "ASRQueryController: RAW update text=" +
          asrOutput.text +
          " isFinal=" +
          asrOutput.isFinal +
          " armed=" +
          this.armed
      )
      if (!this.armed) {
        return
      }
      if (asrOutput.text !== undefined && asrOutput.text !== null) {
        this.onPartialTranscript.invoke(asrOutput.text)
      }
      const text = asrOutput.text ? asrOutput.text.trim() : ""
      if (!asrOutput.isFinal || !text) {
        // An empty "final" is noise (e.g. mic warm-up silence on Spectacles' BLE audio
        // pipeline) rather than the user's answer - the ASR module starts a new phrase
        // automatically, so keep the session armed and waiting instead of ending it.
        this.startListeningTimeout()
        return
      }
      this.disarm()
      this.onFinalTranscript.invoke(text)
    })
    asrSettings.onTranscriptionErrorEvent.add((errorCode) => {
      print("ASRQueryController: RAW error code=" + errorCode + " armed=" + this.armed)
      if (!this.armed) {
        return
      }
      this.disarm()
      this.onError.invoke(String(errorCode))
    })

    // Started exactly once, forever: Snap's Spectacles team has confirmed calling
    // startTranscribing()/stopTranscribing() repeatedly is a known way to break the ASR
    // service. Mic taps below only toggle whether we act on the stream, never the session itself.
    try {
      this.asrModule.startTranscribing(asrSettings)
      print("ASRQueryController: startTranscribing() called successfully")
    } catch (error) {
      print("ASRQueryController: startTranscribing() threw: " + error)
    }
  }

  public toggleListening() {
    print("ASRQueryController: toggleListening() tapped, isRecording=" + this.isRecording)
    const now = getTime()
    if (now - this.lastMicTapTime < MIC_TAP_DEBOUNCE_SECONDS) {
      print("ASRQueryController: tap swallowed by debounce")
      return
    }
    this.lastMicTapTime = now

    if (this.isRecording) {
      this.disarm()
      return
    }
    this.arm()
  }

  public cancelListening() {
    if (this.isRecording) {
      this.disarm()
    }
  }

  private arm() {
    this.isRecording = true
    this.armed = true
    this.startListeningTimeout()
    this.onListeningStarted.invoke()
  }

  private disarm() {
    this.cancelListeningTimeout()
    if (!this.isRecording) {
      return
    }
    this.isRecording = false
    this.armed = false
    this.onListeningStopped.invoke()
  }

  private startListeningTimeout() {
    this.cancelListeningTimeout()
    this.listeningTimeoutEvent = this.createEvent("DelayedCallbackEvent")
    this.listeningTimeoutEvent.bind(() => {
      this.listeningTimeoutEvent = null
      if (!this.isRecording) {
        return
      }
      this.disarm()
      this.onError.invoke("timeout")
    })
    this.listeningTimeoutEvent.reset(LISTENING_TIMEOUT_SECONDS)
  }

  private cancelListeningTimeout() {
    if (this.listeningTimeoutEvent) {
      this.listeningTimeoutEvent.cancel()
      this.listeningTimeoutEvent = null
    }
  }
}
