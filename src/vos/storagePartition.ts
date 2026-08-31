function scopedStorage(source: Storage, prefix: string): Storage {
  const scopedKeys = (): string[] => {
    const keys: string[] = [];
    for (let index = 0; index < source.length; index += 1) {
      const key = source.key(index);
      if (key?.startsWith(prefix)) keys.push(key.slice(prefix.length));
    }
    return keys;
  };
  return {
    get length() { return scopedKeys().length; },
    clear() { for (const key of scopedKeys()) source.removeItem(`${prefix}${key}`); },
    getItem(key: string) { return source.getItem(`${prefix}${key}`); },
    key(index: number) { return scopedKeys()[index] ?? null; },
    removeItem(key: string) { source.removeItem(`${prefix}${key}`); },
    setItem(key: string, value: string) { source.setItem(`${prefix}${key}`, value); },
  };
}

function installProperty(name: 'localStorage' | 'sessionStorage' | 'indexedDB', value: unknown): void {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

/** Install before application state modules execute. Failure is fatal: falling
 * back to the origin-wide stores would expose the previous VOS user's cache. */
export function installVOSStoragePartition(namespace: string): void {
  if (!/^[a-f0-9]{40}$/.test(namespace)) throw new Error('invalid VOS storage namespace');
  const prefix = `v-chatcut:${namespace}:`;
  const local = globalThis.localStorage;
  const session = globalThis.sessionStorage;
  const idb = globalThis.indexedDB;
  installProperty('localStorage', scopedStorage(local, prefix));
  installProperty('sessionStorage', scopedStorage(session, prefix));
  installProperty('indexedDB', new Proxy(idb, {
    get(target, property) {
      if (property === 'open') {
        return (name: string, version?: number) => version === undefined
          ? target.open(`${prefix}${name}`)
          : target.open(`${prefix}${name}`, version);
      }
      if (property === 'deleteDatabase') {
        return (name: string) => target.deleteDatabase(`${prefix}${name}`);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }));
}
