export * from '../../../node_modules/@tauri-apps/api/core.js'
export async function invoke<T>(): Promise<T> {
  throw new Error('Synthetic browser preview: native IPC is disabled')
}
