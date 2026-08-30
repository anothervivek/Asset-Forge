const DEVICE_ID_KEY = "assetForgeDeviceId"

function randomHex(): string {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0")
}

export function getOrCreateDeviceId(): string {
  const store = global.persistentStorageSystem.store
  if (store.has(DEVICE_ID_KEY)) {
    return store.getString(DEVICE_ID_KEY)
  }
  const id = `${randomHex()}-${randomHex()}-${randomHex()}-${randomHex()}`
  store.putString(DEVICE_ID_KEY, id)
  return id
}
