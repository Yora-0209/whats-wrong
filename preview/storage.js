let connection;
export function database() {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const r = indexedDB.open("zala-paper-preview-v1", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("entries", { keyPath: "id" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => {
        connection = null;
        reject(r.error);
      };
    });
  return connection;
}
export async function operate(mode, fn) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("entries", mode);
    const r = fn(tx.objectStore("entries"));
    tx.oncomplete = () => resolve(r?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const saveEntry = (entry) => operate("readwrite", (s) => s.put(entry));
export const allEntries = () => operate("readonly", (s) => s.getAll());
