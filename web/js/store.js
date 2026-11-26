// Stockage local des ROMs préparées (IndexedDB) : elles restent sur l'ordinateur du joueur.
const DB = 'pokelink', STORE = 'roms';
const open = () => new Promise((resolve, reject) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
};
export const saveRom = (key, value) => tx('readwrite', s => s.put(value, key));
export const loadRom = key => tx('readonly', s => s.get(key));
export const deleteRom = key => tx('readwrite', s => s.delete(key));
