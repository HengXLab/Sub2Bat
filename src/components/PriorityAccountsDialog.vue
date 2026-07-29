<script setup lang="ts">
import { ArrowUpDown, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";

type PriorityValue = number | null | undefined;

const props = withDefaults(defineProps<{
  open: boolean;
  selectedCount: number;
  originalPriorities: readonly PriorityValue[];
  priorityRangeText?: string | null;
  priorityOrderText?: string | null;
  minimum?: number | null;
  /** Kept configurable for compatible servers that use the reverse call order. */
  higherPriorityFirst?: boolean;
  busy?: boolean;
  error?: string | null;
}>(), {
  priorityRangeText: "0 及以上的整数（Sub2API 未设置固定业务上限）",
  priorityOrderText: "数值越小，越优先调用。",
  minimum: 0,
  higherPriorityFirst: true,
  busy: false,
  error: null,
});

const emit = defineEmits<{
  cancel: [];
  apply: [targetPriority: number];
}>();

const targetPriority = ref<number | "">("");

const priorityGroups = computed(() => {
  const counts = new Map<string, number>();
  for (const priority of props.originalPriorities) {
    const label = priority === null || priority === undefined ? "未设置" : String(priority);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  if (!counts.size && props.selectedCount > 0) {
    counts.set("未设置", props.selectedCount);
  }

  return [...counts.entries()].map(([label, count]) => ({ label, count }));
});

const originalPrioritySummary = computed(() => {
  if (!priorityGroups.value.length) return "未设置";
  if (priorityGroups.value.length === 1) return priorityGroups.value[0].label;
  return `不一致：${priorityGroups.value.map(({ label, count }) => `${label}（${count} 个）`).join("、")}`;
});

const uniformOriginalPriority = computed(() => {
  if (!props.originalPriorities.length || props.originalPriorities.length !== props.selectedCount) return null;
  const [first] = props.originalPriorities;
  if (typeof first !== "number" || !Number.isSafeInteger(first)) return null;
  return props.originalPriorities.every((priority) => priority === first) ? first : null;
});

const parsedTargetPriority = computed(() => {
  const value = targetPriority.value;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
});

const targetError = computed(() => {
  const value = parsedTargetPriority.value;
  if (value === null) return "请输入有效的整数优先级。";
  if (props.minimum !== null && value < props.minimum) return `优先级不能小于 ${props.minimum}。`;
  return null;
});

const canSubmit = computed(() => props.selectedCount > 0 && !targetError.value && !props.busy);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    targetPriority.value = uniformOriginalPriority.value ?? "";
  },
);

function submit() {
  if (!canSubmit.value || parsedTargetPriority.value === null) return;
  emit("apply", parsedTargetPriority.value);
}
</script>

<template>
  <div v-if="open" class="account-dialog-backdrop">
    <section class="account-dialog priority-dialog" role="dialog" aria-modal="true" aria-labelledby="priority-accounts-title" @keydown.esc="!busy && emit('cancel')">
      <header class="account-dialog__header">
        <div class="account-dialog__title">
          <span class="account-dialog__icon account-dialog__icon--priority"><ArrowUpDown :size="20" aria-hidden="true" /></span>
          <div>
            <h2 id="priority-accounts-title">批量设置优先级</h2>
            <p>将 {{ selectedCount }} 个已选账号统一设置为同一优先级。</p>
          </div>
        </div>
        <button class="account-dialog__close" type="button" title="关闭" aria-label="关闭" :disabled="busy" @click="emit('cancel')">
          <X :size="18" />
        </button>
      </header>

      <div class="priority-dialog__field priority-dialog__field--readonly">
        <span>原本优先级</span>
        <output class="priority-dialog__readonly-value" :title="originalPrioritySummary">{{ originalPrioritySummary }}</output>
      </div>

      <label class="priority-dialog__field">
        <span>统一设置为</span>
        <input
          v-model.number="targetPriority"
          type="number"
          inputmode="numeric"
          step="1"
          :min="minimum ?? undefined"
          :disabled="busy"
          aria-describedby="priority-target-help"
          placeholder="输入优先级"
          @keydown.enter.prevent="submit"
        />
      </label>
      <p id="priority-target-help" class="priority-dialog__help">该值会覆盖所有已选账号的原有优先级。</p>
      <p v-if="targetError && targetPriority !== ''" class="priority-dialog__validation" role="alert">{{ targetError }}</p>

      <dl class="priority-dialog__metadata">
        <div>
          <dt>优先级范围</dt>
          <dd>{{ priorityRangeText }}</dd>
        </div>
        <div>
          <dt>调用规则</dt>
          <dd>{{ priorityOrderText || (higherPriorityFirst ? "数值越小，越优先调用。" : "数值越大，越优先调用。") }}</dd>
        </div>
      </dl>

      <p v-if="error" class="account-dialog__error" role="alert">{{ error }}</p>

      <footer class="account-dialog__actions account-dialog__actions--end">
        <button class="button button--secondary" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
        <button class="button button--primary" type="button" :disabled="!canSubmit" @click="submit">
          {{ busy ? "正在设置..." : "确认设置" }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.account-dialog-backdrop { position: fixed; z-index: 30; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: color-mix(in srgb, var(--ink) 42%, transparent); }
.account-dialog { width: min(100%, 500px); padding: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.account-dialog__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.account-dialog__title { display: flex; align-items: flex-start; gap: 11px; min-width: 0; }
.account-dialog__title h2 { margin: 1px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.account-dialog__title p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.account-dialog__icon { display: inline-grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px; border-radius: 7px; }
.account-dialog__icon--priority { color: var(--cyan); background: var(--cyan-subtle); }
.account-dialog__close { display: inline-grid; flex: 0 0 auto; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.account-dialog__close:hover:not(:disabled) { color: var(--ink); background: var(--surface-hover); }
.priority-dialog__field { display: grid; margin-top: 15px; gap: 7px; color: var(--text); font-size: 13px; font-weight: 650; }
.priority-dialog__field input, .priority-dialog__readonly-value { width: 100%; min-height: 40px; padding: 9px 10px; border: 1px solid var(--control-border); border-radius: 6px; color: var(--text-strong); background: var(--surface); font: inherit; font-variant-numeric: tabular-nums; }
.priority-dialog__field input { outline: 0; }
.priority-dialog__field input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--focus-soft); }
.priority-dialog__readonly-value { display: block; overflow: hidden; color: var(--muted); border-color: var(--divider); background: var(--surface-subtle); text-overflow: ellipsis; white-space: nowrap; }
.priority-dialog__help, .priority-dialog__validation { margin: 7px 0 0; font-size: 12px; line-height: 1.5; }
.priority-dialog__help { color: var(--muted); }
.priority-dialog__validation { color: var(--danger); }
.priority-dialog__metadata { display: grid; margin: 15px 0 0; padding: 11px 12px; gap: 8px; border: 1px solid var(--divider); border-radius: 6px; background: var(--surface-subtle); }
.priority-dialog__metadata div { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 10px; font-size: 12px; line-height: 1.45; }
.priority-dialog__metadata dt { color: var(--muted); }
.priority-dialog__metadata dd { min-width: 0; margin: 0; color: var(--text); }
.account-dialog__error { margin: 14px 0 0; padding: 10px 12px; color: var(--danger); border: 1px solid var(--danger-border); border-radius: 6px; background: var(--danger-subtle); font-size: 13px; line-height: 1.5; }
.account-dialog__actions { display: flex; gap: 8px; margin-top: 20px; }
.account-dialog__actions--end { justify-content: flex-end; }
@media (max-width: 440px) { .account-dialog-backdrop { align-items: end; padding: 12px; } .account-dialog { padding: 17px; } .priority-dialog__metadata div { grid-template-columns: 1fr; gap: 2px; } }
</style>
