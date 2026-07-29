<script setup lang="ts">
import { Eye, EyeOff, KeyRound, LoaderCircle, Server, ShieldCheck } from "@lucide/vue";
import { reactive, ref, watch } from "vue";
import { validateLogin, validateTotp } from "../lib/login";
import type { ProfilePreferences } from "../types";
import AppLogo from "./AppLogo.vue";

const props = defineProps<{
  preferences: ProfilePreferences;
  busy: boolean;
  message: string | null;
  totpRequired: boolean;
  userEmailMasked: string;
}>();

const emit = defineEmits<{
  login: [payload: { serverUrl: string; email: string; password: string; rememberLogin: boolean }];
  completeTotp: [code: string];
  restart: [];
}>();

const fields = reactive({
  serverUrl: "",
  email: "",
  password: "",
  rememberLogin: true,
});
const code = ref("");
const showPassword = ref(false);
const localError = ref<string | null>(null);

watch(
  () => props.preferences,
  (preferences) => {
    fields.serverUrl = preferences.serverUrl;
    fields.email = preferences.email;
    fields.rememberLogin = preferences.rememberLogin;
  },
  { immediate: true, deep: true },
);

function submitLogin() {
  localError.value = validateLogin(fields);
  if (localError.value) {
    return;
  }

  emit("login", { ...fields });
}

function submitTotp() {
  localError.value = validateTotp(code.value);
  if (localError.value) {
    return;
  }

  emit("completeTotp", code.value.trim());
}

function restart() {
  code.value = "";
  localError.value = null;
  emit("restart");
}
</script>

<template>
  <main class="login-page">
    <section class="login-panel" aria-label="管理员登录">
      <div class="login-panel__brand">
        <AppLogo compact />
        <div>
          <h1>Sub2Bat</h1>
          <p>管理员登录</p>
        </div>
      </div>

      <form v-if="!totpRequired" class="login-form" @submit.prevent="submitLogin">
        <label class="field">
          <span>站点地址</span>
          <div class="field__control">
            <Server :size="17" aria-hidden="true" />
            <input v-model="fields.serverUrl" autocomplete="url" placeholder="https://your-sub2api.example" />
          </div>
        </label>

        <label class="field">
          <span>管理员邮箱</span>
          <div class="field__control">
            <ShieldCheck :size="17" aria-hidden="true" />
            <input v-model="fields.email" type="email" autocomplete="username" placeholder="admin@example.com" />
          </div>
        </label>

        <label class="field">
          <span>密码</span>
          <div class="field__control">
            <KeyRound :size="17" aria-hidden="true" />
            <input
              v-model="fields.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="管理员密码"
            />
            <button
              class="icon-button field__action"
              type="button"
              :title="showPassword ? '隐藏密码' : '显示密码'"
              @click="showPassword = !showPassword"
            >
              <EyeOff v-if="showPassword" :size="17" />
              <Eye v-else :size="17" />
            </button>
          </div>
        </label>

        <label class="remember-option">
          <input v-model="fields.rememberLogin" type="checkbox" />
          <span>记住登录</span>
        </label>

        <p v-if="localError || message" class="form-message" role="alert">{{ localError || message }}</p>

        <button class="button button--primary login-submit" type="submit" :disabled="busy">
          <LoaderCircle v-if="busy" class="spin" :size="17" />
          <span>{{ busy ? "正在登录" : "登录" }}</span>
        </button>
      </form>

      <form v-else class="login-form" @submit.prevent="submitTotp">
        <div class="totp-heading">
          <div class="login-panel__icon"><KeyRound :size="23" /></div>
          <div>
            <h2>动态验证</h2>
            <p>{{ userEmailMasked }}</p>
          </div>
        </div>

        <label class="field">
          <span>6 位动态验证码</span>
          <div class="field__control field__control--code">
            <input v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" />
          </div>
        </label>

        <p v-if="localError || message" class="form-message" role="alert">{{ localError || message }}</p>

        <button class="button button--primary login-submit" type="submit" :disabled="busy">
          <LoaderCircle v-if="busy" class="spin" :size="17" />
          <span>{{ busy ? "正在验证" : "完成验证" }}</span>
        </button>
        <button class="text-button" type="button" :disabled="busy" @click="restart">重新登录</button>
      </form>
    </section>
  </main>
</template>
