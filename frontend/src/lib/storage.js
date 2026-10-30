// Saves documents on the device (IndexedDB) so the app works offline.
const open = () =>
  new Promise((res, rej) => {
    const r = indexedDB.open('pagemark', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'name' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })

async function run(mode, fn) {
  try {
    const db = await open()
    return await new Promise((res, rej) => {
      const t = db.transaction('docs', mode)
      const req = fn(t.objectStore('docs'))
      t.oncomplete = () => res(req && req.result)
      t.onerror = () => rej(t.error)
    })
  } catch {
    return null
  }
}
export const saveDoc = (d) => run('readwrite', (s) => s.put(d))
export const deleteDoc = (name) => run('readwrite', (s) => s.delete(name))
export const loadDocs = () => run('readonly', (s) => s.getAll())
