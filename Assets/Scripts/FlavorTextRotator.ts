const ROTATE_INTERVAL_SECONDS = 5

// Fills the dead air during a generation wait with rotating flavor text. Call the
// returned stop function when a real status update needs to take over, or when the
// generation finishes/fails.
export function startFlavorRotation(owner: BaseScriptComponent, words: string[], onTick: (word: string) => void): () => void {
  let cancelled = false
  let event: DelayedCallbackEvent | null = null

  const scheduleNext = () => {
    event = owner.createEvent("DelayedCallbackEvent")
    event.bind(() => {
      if (cancelled) {
        return
      }
      onTick(words[Math.floor(Math.random() * words.length)])
      scheduleNext()
    })
    event.reset(ROTATE_INTERVAL_SECONDS)
  }
  scheduleNext()

  return () => {
    cancelled = true
    if (event) {
      event.cancel()
      event = null
    }
  }
}
