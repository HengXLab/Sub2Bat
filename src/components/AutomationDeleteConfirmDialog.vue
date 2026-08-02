<script setup lang="ts">
import { AlertTriangle, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  open: boolean;
  ruleName: string;
  protectedStatuses: readonly string[];
  busy?: boolean;
}>(), {
  busy: false,
});

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const doubleClickHintVisible = ref(false);
const protectedSummary = computed(() => {
  const labels: Record<string, string> = {
    normal: "正常",
    rate_limited: "限流中",
    connection_interrupted: "连接异常",
    untested: "未测试",
    cancelled: "已取消",
    other: "其他非错误或非停用状态",
  };
  return props.protectedStatuses.map((status) => labels[status] ?? status).join("、");
});
const requiresDoubleConfirmation = computed(() => props.protectedStatuses.length > 0);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) doubleClickHintVisible.value = false;
  },
);

function armDoubleClick() {
  doubleClickHintVisible.value = true;
}

function confirm() {
  if (!props.busy) emit("confirm");
}
</script>

<template>
  <div v-if="open" class="automation-delete-confirm-backdrop">
    <section class="automation-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="automation-delete-confirm-title" @keydown.esc="!busy && emit('cancel')">
      <header class="automation-delete-confirm__header">
        <span class="automation-delete-confirm__icon"><AlertTriangle :size="20" aria-hidden="true" /></span>
        <div>
          <h2 id="automation-delete-confirm-title">确认执行含删除操作的自动化</h2>
          <p>“{{ ruleName }}”包含删除账号动作，执行后无法恢复。</p>
        </div>
        <button class="automation-delete-confirm__close" type="button" title="关闭" aria-label="关闭" :disabled="busy" @click="emit('cancel')"><X :size="18" /></button>
      </header>

      <p v-if="requiresDoubleConfirmation" class="automation-delete-confirm__warning">
        该规则允许删除：{{ protectedSummary }}。请确认规则条件准确后双击确认执行。
      </p>
      <p v-if="doubleClickHintVisible && requiresDoubleConfirmation" class="automation-delete-confirm__hint">请双击“{{ busy ? "正在执行" : "双击确认执行" }}”继续。</p>

      <footer class="automation-delete-confirm__actions">
        <button class="button button--secondary" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
        <button
          class="button button--danger-solid"
          type="button"
          :disabled="busy"
          @click="requiresDoubleConfirmation ? armDoubleClick() : confirm()"
          @dblclick="requiresDoubleConfirmation && confirm()"
        >{{ requiresDoubleConfirmation ? "双击确认执行" : "确认执行" }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.automation-delete-confirm-backdrop { position: fixed; z-index: 34; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: color-mix(in srgb, var(--ink) 42%, transparent); }
.automation-delete-confirm { width: min(100%, 500px); padding: 20px; border: 1px solid var(--danger-border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.automation-delete-confirm__header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: flex-start; gap: 11px; }
.automation-delete-confirm__icon { display: inline-grid; place-items: center; width: 34px; height: 34px; color: var(--danger); border-radius: 7px; background: var(--danger-subtle); }
.automation-delete-confirm h2 { margin: 2px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.automation-delete-confirm p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.automation-delete-confirm__close { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.automation-delete-confirm__close:hover:not(:disabled) { color: var(--ink); background: var(--surface-hover); }
.automation-delete-confirm__warning, .automation-delete-confirm__hint { margin-top: 18px !important; padding: 10px 12px; border-radius: 6px; }
.automation-delete-confirm__warning { color: var(--warning) !important; border: 1px solid var(--warning-border); background: var(--warning-subtle); }
.automation-delete-confirm__hint { border: 1px solid var(--divider); background: var(--surface-subtle); }
.automation-delete-confirm__actions { display: flex; justify-content: flex-end; margin-top: 20px; gap: 8px; }
.button--danger-solid { color: var(--surface); background: var(--danger); }
.button--danger-solid:not(:disabled):hover { background: color-mix(in srgb, var(--danger) 85%, var(--ink)); }
@media (max-width: 440px) { .automation-delete-confirm-backdrop { align-items: end; padding: 12px; } .automation-delete-confirm { padding: 17px; } .automation-delete-confirm__actions { flex-direction: column-reverse; } .automation-delete-confirm__actions .button { width: 100%; } }
</style>
