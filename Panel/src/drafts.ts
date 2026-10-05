//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

/// The text of a response being edited. Its headers and body may not be valid JSON yet.
export interface Draft {
  headersText: string;
  bodyText: string;
}

/// Keyed by `ruleID/responseName`. The rule id alone would let one response tab overwrite
/// another's body.
export interface DraftStore {
  get(key: string): Draft | undefined;
  set(key: string, draft: Draft): void;
  clear(key: string): void;
}

const storageKey = (key: string) => `maplocal.draft.${key}`;

function localStorageOrNone(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; /* a WebView with storage blocked throws on access */
  }
}

/// Necto recreates the panel when the app reconnects. Edits that could not be sent, because
/// the JSON was invalid or the write was rejected, are kept so they survive that.
export function localDrafts(given?: Storage): DraftStore {
  const storage = given ?? localStorageOrNone();
  return {
    get(key) {
      try {
        const text = storage?.getItem(storageKey(key));
        return text ? (JSON.parse(text) as Draft) : undefined;
      } catch {
        return undefined;
      }
    },
    set(key, draft) {
      try { storage?.setItem(storageKey(key), JSON.stringify(draft)); } catch { /* keeping drafts is a convenience */ }
    },
    clear(key) {
      try { storage?.removeItem(storageKey(key)); } catch { /* as above */ }
    },
  };
}

/// View choices such as the tab and the list mode. When storage is blocked the panel opens
/// with defaults.
export function localPrefs(given?: Storage): {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
} {
  const storage = given ?? localStorageOrNone();
  return {
    get(key) {
      try {
        return storage?.getItem(`maplocal.pref.${key}`) ?? undefined;
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      try {
        storage?.setItem(`maplocal.pref.${key}`, value);
      } catch {
        /* remembering is a convenience */
      }
    },
  };
}
