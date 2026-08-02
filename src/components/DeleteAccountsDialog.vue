<script setup lang="ts">
import { AlertTriangle, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  open: boolean;
  selectedCount: number;
  normalCount: number;
  rateLimitedCount: number;
  connectionInterruptedCount: number;
  otherCount: number;
  busy?: boolean;
  error?: string | null;
}>(), {
  busy: false,
  error: null,
});

const emit = defineEmits<{
  cancel: [];
  deleteAll: [];
  excludeProtected: [];
}>();

type DeleteStep = "confirm" | "protected-warning";

const step = ref<DeleteStep>("confirm");
const doubleClickHintVisible = ref(false);
const protectedCount = computed(
  () => props.normalCount + props.rateLimitedCount + props.connectionInterruptedCount + props.otherCount,
);
const protectedAccountSummary = computed(() => {
  const categories: string[] = [];
  if (props.normalCount) categories.push(`${props.normalCount} 个正常账号`);
  if (props.rateLimitedCount) categories.push(`${props.rateLimitedCount} 个限流中账号`);
  if (props.connectionInterruptedCount) categories.push(`${props.connectionInterruptedCount} 个连接异常账号`);
  if (props.otherCount) categories.push(`${props.otherCount} 个其他非错误或非停用状态账号`);
  return categories.join("、");
});

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      step.value = "confirm";
      doubleClickHintVisible.value = false;
    }
  },
);

function continueDeletion() {
  if (protectedCount.value > 0) {
    step.value = "protected-warning";
    return;
  }
  emit("deleteAll");
}

function armDoubleClick() {
  doubleClickHintVisible.value = true;
}

function deleteAllWithDoubleClick() {
  if (!props.busy) {
    emit("deleteAll");
  }
}
</script>

<template>
  <div v-if="open" class="account-dialog-backdrop">
    <section class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-accounts-title" @keydown.esc="!busy && emit('cancel')">
      <header class="account-dialog__header">
        <div class="account-dialog__title">
          <span class="account-dialog__icon account-dialog__icon--danger"><AlertTriangle :size="20" aria-hidden="true" /></span>
          <div>
            <h2 id="delete-accounts-title">{{ step === "confirm" ? "删除选中账号" : "选中账号包含需保护账号" }}</h2>
            <p>{{ step === "confirm" ? `即将删除 ${selectedCount} 个账号，此操作无法恢复。` : `其中有 ${protectedAccountSummary}，请谨慎确认。` }}</p>
          </div>
        </div>
        <button class="account-dialog__close" type="button" title="关闭" aria-label="关闭" :disabled="busy" @click="emit('cancel')">
          <X :size="18" />
        </button>
      </header>

      <p v-if="step === 'protected-warning'" class="account-dialog__warning">
        删除全部账号需要双击左侧按钮；也可以排除上述需保护账号，仅删除其余已选账号。
      </p>
      <p v-if="doubleClickHintVisible && step === 'protected-warning'" class="account-dialog__hint">
        请双击“{{ busy ? "正在删除" : "双击确认" }}”完成删除。
      </p>
      <p v-if="error" class="account-dialog__error" role="alert">{{ error }}</p>

      <footer v-if="step === 'confirm'" class="account-dialog__actions account-dialog__actions--end">
        <button class="button button--secondary" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
        <button class="button button--danger-solid" type="button" :disabled="busy" @click="continueDeletion">
          {{ busy ? "正在删除..." : "确认删除" }}
        </button>
      </footer>

      <footer v-else class="account-dialog__actions account-dialog__actions--triple">
        <button class="button button--danger-solid" type="button" :disabled="busy" @click="armDoubleClick" @dblclick="deleteAllWithDoubleClick">
          {{ busy ? "正在删除..." : "双击确认" }}
        </button>
        <button class="button button--secondary" type="button" :disabled="busy || selectedCount === protectedCount" @click="emit('excludeProtected')">
          排除受保护账号删除
        </button>
        <button class="button button--secondary" type="button" :disabled="busy" @click="emit('cancel')">取消删除</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.account-dialog-backdrop { position: fixed; z-index: 30; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: color-mix(in srgb, var(--ink) 42%, transparent); }
.account-dialog { width: min(100%, 470px); padding: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.account-dialog__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.account-dialog__title { display: flex; align-items: flex-start; gap: 11px; min-width: 0; }
.account-dialog__title h2 { margin: 1px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.account-dialog__title p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.account-dialog__icon { display: inline-grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px; border-radius: 7px; }
.account-dialog__icon--danger { color: var(--danger); background: var(--danger-subtle); }
.account-dialog__close { display: inline-grid; flex: 0 0 auto; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.account-dialog__close:hover:not(:disabled) { color: var(--ink); background: var(--surface-hover); }
.account-dialog__warning, .account-dialog__hint, .account-dialog__error { margin: 18px 0 0; padding: 10px 12px; border-radius: 6px; font-size: 13px; line-height: 1.5; }
.account-dialog__warning { color: var(--warning); border: 1px solid var(--warning-border); background: var(--warning-subtle); }
.account-dialog__hint { color: var(--muted); border: 1px solid var(--divider); background: var(--surface-subtle); }
.account-dialog__error { color: var(--danger); border: 1px solid var(--danger-border); background: var(--danger-subtle); }
.account-dialog__actions { display: flex; gap: 8px; margin-top: 20px; }
.account-dialog__actions--end { justify-content: flex-end; }
.account-dialog__actions--triple { justify-content: space-between; }
.account-dialog__actions--triple .button { flex: 1 1 0; padding-right: 8px; padding-left: 8px; }
.button--danger-solid { color: var(--surface); background: var(--danger); }
.button--danger-solid:not(:disabled):hover { background: color-mix(in srgb, var(--danger) 85%, var(--ink)); }
@media (max-width: 440px) { .account-dialog-backdrop { align-items: end; padding: 12px; } .account-dialog { padding: 17px; } .account-dialog__actions--triple { flex-wrap: wrap; } .account-dialog__actions--triple .button { flex-basis: 100%; } }
</style>
