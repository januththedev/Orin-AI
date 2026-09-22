
/**
  * Orin Chat Neural Cache Engine
 * Centralized service for local persistence and session management.
 */

export enum CacheKey {
  USER = 'orin_user',
  HISTORY = 'orin_history_v3',
  ACTIVE_CONV = 'orin_active_conv_id',
  LANG = 'orin_lang',
  THEME = 'orin_theme',          // system dark/light
  USER_THEME = 'orin_user_theme', // Orin workspace visual theme
  VOICE_NAME = 'orin_voice_name',
  VOICE_TONE = 'orin_voice_tone',
  VOICE_PROACTIVE_AUDIO = 'orin_voice_proactive_audio',
  VOICE_AFFECTIVE_DIALOG = 'orin_voice_affective_dialog',
  USER_MARKOV = 'orin_markov_v1',
  STUDIO_HISTORY = 'orin_studio_history_v1',
  MATH_HISTORY = 'orin_math_history_v1',
  AGENT_USED_ONCE = 'orin_agent_used_once',
  FILE_SEARCH_STORE = 'orin_file_search_store',   // Firestore store name for user's files
  URL_CONTEXT_USED = 'orin_url_context_used',     // date string of last URL context use
  DEEP_RESEARCH_USED = 'orin_deep_research_used', // YYYY-MM string of last deep research
  CODE_EXEC_USED = 'orin_code_exec_used',         // count today
}

export class CacheService {
  /**
   * Stores an item in local storage with automatic serialization.
   */
  set<T>(key: CacheKey, value: T): void {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      // Quota or privacy mode; fail silently in production
    }
  }

  /**
   * Retrieves an item from local storage with safe deserialization.
   * set() stores strings as-is and other types via JSON.stringify, so we try
   * JSON.parse first to restore booleans, numbers, objects, arrays; plain
   * strings (e.g. "hello") are returned as-is when parse fails.
   */
  get<T>(key: CacheKey, fallback: T): T {
    try {
      const data = localStorage.getItem(key);
      if (data === null) return fallback;
      try {
        return JSON.parse(data) as T;
      } catch {
        return data as unknown as T;
      }
    } catch {
      return fallback;
    }
  }

  /**
   * Clears a specific key or all Orin-related data.
   */
  remove(key: CacheKey): void {
    localStorage.removeItem(key);
  }

  clearAll(): void {
    for (const key of Object.values(CacheKey)) localStorage.removeItem(key);
  }

  /**
   * Quick check for data existence.
   */
  has(key: CacheKey): boolean {
    return localStorage.getItem(key) !== null;
  }
}

export const cacheService = new CacheService();
