import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { DEFAULT_CONCURRENCY } from "../lib/defaults";
import type { LoginResult, ProfilePreferences, RestoreResult, SessionView } from "../types";

export interface LoginRequest {
  serverUrl: string;
  email: string;
  password: string;
  rememberLogin: boolean;
}

const defaultPreferences: ProfilePreferences = {
  serverUrl: "",
  email: "",
  rememberLogin: true,
  lastModelId: "",
  concurrency: DEFAULT_CONCURRENCY,
  autoRefreshSeconds: 0,
};

type MutablePreferenceField = "lastModelId" | "concurrency" | "autoRefreshSeconds";

type PreferenceValue = string | number;

function runningInTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useSession() {
  const session = ref<SessionView | null>(null);
  const preferences = ref<ProfilePreferences>({ ...defaultPreferences });
  const busy = ref(false);
  const message = ref<string | null>(null);
  const totpRequired = ref(false);
  const userEmailMasked = ref("");

  // Every accepted session and logout forms a boundary. Responses started for
  // an earlier boundary must not change the current user's local state.
  let sessionEpoch = 0;
  let sessionRequestRevision = 0;
  const preferenceRevisions: Record<MutablePreferenceField, number> = {
    lastModelId: 0,
    concurrency: 0,
    autoRefreshSeconds: 0,
  };
  let unlistenExpiredSession: UnlistenFn | undefined;

  const authenticated = computed(() => session.value !== null);

  function applyPreferences(next: ProfilePreferences | null) {
    if (next) {
      preferences.value = { ...defaultPreferences, ...next };
    }
  }

  function acceptSession(nextSession: SessionView | null, nextPreferences: ProfilePreferences | null) {
    sessionEpoch += 1;
    session.value = nextSession;
    applyPreferences(nextPreferences);
  }

  function isCurrentSession(epoch: number) {
    return sessionEpoch === epoch;
  }

  function startSessionRequest() {
    sessionRequestRevision += 1;
    busy.value = true;
    return sessionRequestRevision;
  }

  function isCurrentSessionRequest(epoch: number, revision: number) {
    return isCurrentSession(epoch) && sessionRequestRevision === revision;
  }

  function finishSessionRequest(revision: number) {
    if (sessionRequestRevision === revision) {
      busy.value = false;
    }
  }

  function getPreferenceValue(field: MutablePreferenceField): PreferenceValue {
    return preferences.value[field];
  }

  function setPreferenceValue(field: MutablePreferenceField, value: PreferenceValue) {
    switch (field) {
      case "lastModelId":
        preferences.value = { ...preferences.value, lastModelId: value as string };
        return;
      case "concurrency":
        preferences.value = { ...preferences.value, concurrency: value as number };
        return;
      case "autoRefreshSeconds":
        preferences.value = { ...preferences.value, autoRefreshSeconds: value as number };
        return;
    }
  }

  function applyLoginResult(result: LoginResult, epoch: number, revision: number) {
    if (!isCurrentSessionRequest(epoch, revision)) {
      return;
    }

    if (result.kind === "authenticated") {
      acceptSession(result.session, result.preferences);
      totpRequired.value = false;
      userEmailMasked.value = "";
      message.value = null;
      return;
    }

    totpRequired.value = true;
    userEmailMasked.value = result.userEmailMasked;
    message.value = null;
  }

  function isCurrentPreferenceMutation(field: MutablePreferenceField, epoch: number, revision: number) {
    return isCurrentSession(epoch) && preferenceRevisions[field] === revision;
  }

  async function restore() {
    if (!runningInTauri()) {
      return;
    }

    const epoch = sessionEpoch;
    const requestRevision = startSessionRequest();
    try {
      const result = await invoke<RestoreResult>("restore_session");
      if (!isCurrentSessionRequest(epoch, requestRevision)) {
        return;
      }

      acceptSession(result.session, result.preferences);
      message.value = result.message;
    } catch (error) {
      if (isCurrentSessionRequest(epoch, requestRevision)) {
        message.value = readableError(error);
      }
    } finally {
      finishSessionRequest(requestRevision);
    }
  }

  async function login(request: LoginRequest) {
    const epoch = sessionEpoch;
    const requestRevision = startSessionRequest();
    message.value = null;
    try {
      const result = await invoke<LoginResult>("login", { input: request });
      applyLoginResult(result, epoch, requestRevision);
      return result;
    } catch (error) {
      if (isCurrentSessionRequest(epoch, requestRevision)) {
        message.value = readableError(error);
      }
      throw error;
    } finally {
      finishSessionRequest(requestRevision);
    }
  }

  async function completeTotp(code: string) {
    const epoch = sessionEpoch;
    const requestRevision = startSessionRequest();
    message.value = null;
    try {
      const result = await invoke<LoginResult>("complete_totp", { input: { code } });
      applyLoginResult(result, epoch, requestRevision);
      return result;
    } catch (error) {
      if (isCurrentSessionRequest(epoch, requestRevision)) {
        message.value = readableError(error);
      }
      throw error;
    } finally {
      finishSessionRequest(requestRevision);
    }
  }

  async function logout() {
    sessionEpoch += 1;
    const logoutEpoch = sessionEpoch;
    const requestRevision = startSessionRequest();
    try {
      if (runningInTauri()) {
        await invoke("logout");
      }
      if (isCurrentSessionRequest(logoutEpoch, requestRevision)) {
        message.value = null;
      }
    } catch (error) {
      if (isCurrentSessionRequest(logoutEpoch, requestRevision)) {
        message.value = readableError(error);
      }
    } finally {
      // Local logout must complete even when Windows Credential Manager cannot
      // update the remembered-login entry. The backend has already cancelled
      // active batches before it attempts that cleanup.
      if (isCurrentSession(logoutEpoch)) {
        session.value = null;
        totpRequired.value = false;
        userEmailMasked.value = "";
      }
      finishSessionRequest(requestRevision);
    }
  }

  async function savePreference(
    field: MutablePreferenceField,
    value: PreferenceValue,
    command: string,
    payload: Record<string, PreferenceValue>,
  ) {
    const epoch = sessionEpoch;
    const revision = preferenceRevisions[field] + 1;
    preferenceRevisions[field] = revision;
    const previousValue = getPreferenceValue(field);
    setPreferenceValue(field, value);

    if (!runningInTauri()) {
      return;
    }

    try {
      const saved = await invoke<ProfilePreferences>(command, payload);
      if (isCurrentPreferenceMutation(field, epoch, revision)) {
        setPreferenceValue(field, saved[field]);
      }
    } catch (error) {
      if (isCurrentPreferenceMutation(field, epoch, revision)) {
        setPreferenceValue(field, previousValue);
        message.value = readableError(error);
      }
      throw error;
    }
  }

  async function setDefaultModel(modelId: string) {
    const lastModelId = modelId.trim();
    if (!lastModelId) return;

    await savePreference("lastModelId", lastModelId, "set_default_model", { modelId: lastModelId });
  }

  async function setDefaultConcurrency(concurrency: number) {
    if (![5, 10, 20, 50, 100].includes(concurrency)) return;

    await savePreference("concurrency", concurrency, "set_default_concurrency", { concurrency });
  }

  async function setAutoRefreshSeconds(autoRefreshSeconds: number) {
    if (!Number.isInteger(autoRefreshSeconds) || (autoRefreshSeconds !== 0 && (autoRefreshSeconds < 5 || autoRefreshSeconds > 3600))) {
      return;
    }

    await savePreference("autoRefreshSeconds", autoRefreshSeconds, "set_auto_refresh_seconds", { autoRefreshSeconds });
  }

  async function restartLogin() {
    sessionRequestRevision += 1;
    busy.value = true;
    totpRequired.value = false;
    userEmailMasked.value = "";
    message.value = null;
    // Local revisioning prevents an old response from updating the form, while
    // the backend command invalidates the corresponding password/TOTP request
    // so it cannot install a session after the user starts over.
    try {
      if (runningInTauri()) {
        await invoke("cancel_authentication");
      }
    } catch (error) {
      message.value = readableError(error);
    } finally {
      busy.value = false;
    }
  }

  function expireSession() {
    // The backend has already cancelled active batch work and cleared its
    // session. Advance local revisions so no older request can revive UI state.
    sessionEpoch += 1;
    sessionRequestRevision += 1;
    busy.value = false;
    session.value = null;
    totpRequired.value = false;
    userEmailMasked.value = "";
    message.value = "登录令牌已失效，请重新登录。";
  }

  onMounted(() => {
    if (!runningInTauri()) return;
    void listen("session://expired", () => expireSession())
      .then((unlisten) => {
        unlistenExpiredSession = unlisten;
      })
      .catch(() => undefined);
  });

  onUnmounted(() => {
    unlistenExpiredSession?.();
  });

  return {
    authenticated,
    busy,
    completeTotp,
    login,
    logout,
    message,
    preferences,
    restartLogin,
    restore,
    setAutoRefreshSeconds,
    setDefaultConcurrency,
    setDefaultModel,
    session,
    totpRequired,
    userEmailMasked,
  };
}

function readableError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "操作未完成，请检查站点地址和登录状态。";
}
