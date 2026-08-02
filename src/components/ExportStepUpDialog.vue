<script setup lang="ts">
import { KeyRound, LoaderCircle, X } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  open: boolean;
  busy?: boolean;
  error?: string | null;
}>(), {
  busy: false,
  error: null,
});

const emit = defineEmits<{
  close: [];
  verify: [code: string];
}>();

const code = ref("");
const codeInput = ref<HTMLInputElement | null>(null);
const validCode = computed(() => /^\d{6}$/.test(code.value.trim()));

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    code.value = "";
    await nextTick();
    codeInput.value?.focus();
  },
);

function close() {
  if (!props.busy) emit("close");
}

function submit() {
  if (!validCode.value || props.busy) return;
  emit("verify", code.value.trim());
}
</script>

<template>
  <div v-if="open" class="export-step-up-backdrop" @mousedown.self="close">
    <section
      class="export-step-up-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-step-up-title"
      @keydown.esc="close"
    >
      <header class="export-step-up-dialog__header">
        <div class="export-step-up-dialog__title">
          <span class="export-step-up-dialog__icon"><KeyRound :size="20" aria-hidden="true" /></span>
          <div>
            <h2 id="export-step-up-title">导出前需要二次验证</h2>
            <p>此 Sub2API 服务器要求验证动态验证码后，才会提供账号备份数据。</p>
          </div>
        </div>
        <button class="export-step-up-dialog__close" type="button" title="关闭" aria-label="关闭" :disabled="busy" @click="close">
          <X :size="18" aria-hidden="true" />
        </button>
      </header>

      <form class="export-step-up-dialog__form" @submit.prevent="submit">
        <label class="export-step-up-dialog__field">
          <span>6 位动态验证码</span>
          <input
            ref="codeInput"
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="000000"
            :disabled="busy"
          />
        </label>

        <p v-if="error" class="export-step-up-dialog__error" role="alert">{{ error }}</p>

        <footer class="export-step-up-dialog__actions">
          <button class="button button--secondary" type="button" :disabled="busy" @click="close">取消</button>
          <button class="button button--primary" type="submit" :disabled="!validCode || busy">
            <LoaderCircle v-if="busy" class="spin" :size="17" aria-hidden="true" />
            <span>{{ busy ? "正在验证..." : "验证并继续导出" }}</span>
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.export-step-up-backdrop { position: fixed; z-index: 50; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: color-mix(in srgb, var(--ink) 42%, transparent); }
.export-step-up-dialog { width: min(100%, 460px); max-height: var(--dialog-content-max-height); overflow-y: auto; padding: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.export-step-up-dialog__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.export-step-up-dialog__title { display: flex; align-items: flex-start; min-width: 0; gap: 11px; }
.export-step-up-dialog__icon { display: inline-grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px; color: var(--warning); border-radius: 7px; background: var(--warning-subtle); }
.export-step-up-dialog__title h2 { margin: 1px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.export-step-up-dialog__title p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.export-step-up-dialog__close { display: inline-grid; flex: 0 0 auto; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border: 0; border-radius: 5px; background: transparent; cursor: pointer; }
.export-step-up-dialog__close:hover:not(:disabled) { color: var(--ink); background: var(--surface-hover); }
.export-step-up-dialog__form { display: grid; margin-top: 20px; gap: 14px; }
.export-step-up-dialog__field { display: grid; gap: 7px; color: var(--text-strong); font-size: 13px; font-weight: 650; }
.export-step-up-dialog__field input { width: 100%; height: 42px; padding: 0 11px; color: var(--ink); border: 1px solid var(--control-border); border-radius: 6px; background: var(--surface); font: inherit; font-variant-numeric: tabular-nums; letter-spacing: 3px; }
.export-step-up-dialog__field input:focus { border-color: var(--brand); outline: 0; box-shadow: 0 0 0 3px var(--focus-soft); }
.export-step-up-dialog__error { margin: 0; padding: 10px 12px; color: var(--danger); border: 1px solid var(--danger-border); border-radius: 6px; background: var(--danger-subtle); font-size: 13px; line-height: 1.5; }
.export-step-up-dialog__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
@media (max-width: 440px) { .export-step-up-backdrop { align-items: end; padding: 12px; } .export-step-up-dialog { padding: 17px; } }
</style>
