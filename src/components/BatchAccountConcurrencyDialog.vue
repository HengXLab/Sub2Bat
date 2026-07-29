<script setup lang="ts">
import { Gauge, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";

type ConcurrencyValue = number | null | undefined;

const props = withDefaults(defineProps<{
  open: boolean;
  selectedCount: number;
  originalConcurrencies: readonly ConcurrencyValue[];
  minimum?: number | null;
  maximum?: number | null;
  concurrencyRangeText?: string | null;
  concurrencyOrderText?: string | null;
  helpText?: string | null;
  busy?: boolean;
  error?: string | null;
}>(), {
  minimum: 0,
  maximum: null,
  concurrencyRangeText: null,
  concurrencyOrderText: "每个账号独立受该上限限制，不会占用其他账号的并发额度。",
  helpText: "该值会覆盖所有已选账号当前的单个账号并发设置，不会修改批量测试的总并发。",
  busy: false,
  error: null,
});

const emit = defineEmits<{
  cancel: [];
  apply: [target: number];
}>();

const targetConcurrency = ref<number | "">("");

const concurrencyGroups = computed(() => {
  const counts = new Map<string, number>();
  for (const concurrency of props.originalConcurrencies) {
    const label = concurrency === null || concurrency === undefined ? "未设置" : String(concurrency);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  if (!counts.size && props.selectedCount > 0) {
    counts.set("未设置", props.selectedCount);
  }

  return [...counts.entries()].map(([label, count]) => ({ label, count }));
});

const originalConcurrencySummary = computed(() => {
  if (!concurrencyGroups.value.length) return "未设置";
  if (concurrencyGroups.value.length === 1) return concurrencyGroups.value[0].label;
  return `不一致：${concurrencyGroups.value.map(({ label, count }) => `${label}（${count} 个）`).join("、")}`;
});

const uniformOriginalConcurrency = computed(() => {
  if (!props.originalConcurrencies.length || props.originalConcurrencies.length !== props.selectedCount) return null;
  const [first] = props.originalConcurrencies;
  if (typeof first !== "number" || !Number.isSafeInteger(first)) return null;
  return props.originalConcurrencies.every((concurrency) => concurrency === first) ? first : null;
});

const parsedTargetConcurrency = computed(() => {
  const value = targetConcurrency.value;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
});

const targetError = computed(() => {
  const value = parsedTargetConcurrency.value;
  if (value === null) return "请输入有效的整数并发数。";
  if (props.minimum !== null && value < props.minimum) return `单个账号并发不能小于 ${props.minimum}。`;
  if (props.maximum !== null && value > props.maximum) return `单个账号并发不能大于 ${props.maximum}。`;
  return null;
});

const concurrencyRangeDescription = computed(() => {
  if (props.concurrencyRangeText) return props.concurrencyRangeText;
  if (props.minimum !== null && props.maximum !== null) return `${props.minimum} 到 ${props.maximum} 之间的整数`;
  if (props.minimum !== null) return `${props.minimum} 及以上的整数`;
  if (props.maximum !== null) return `不大于 ${props.maximum} 的非负整数`;
  return "非负整数";
});

const canSubmit = computed(() => props.selectedCount > 0 && !targetError.value && !props.busy);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    targetConcurrency.value = uniformOriginalConcurrency.value ?? "";
  },
);

function submit() {
  if (!canSubmit.value || parsedTargetConcurrency.value === null) return;
  emit("apply", parsedTargetConcurrency.value);
}
</script>

<template>
  <div v-if="open" class="account-dialog-backdrop">
    <section class="account-dialog account-concurrency-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-account-concurrency-title" @keydown.esc="!busy && emit('cancel')">
      <header class="account-dialog__header">
        <div class="account-dialog__title">
          <span class="account-dialog__icon account-dialog__icon--concurrency"><Gauge :size="20" aria-hidden="true" /></span>
          <div>
            <h2 id="batch-account-concurrency-title">批量设置单个账号并发</h2>
            <p>将 {{ selectedCount }} 个已选账号统一设置为同一个单账号并发上限。</p>
          </div>
        </div>
        <button class="account-dialog__close" type="button" title="关闭" aria-label="关闭" :disabled="busy" @click="emit('cancel')">
          <X :size="18" />
        </button>
      </header>

      <div class="account-concurrency-dialog__field account-concurrency-dialog__field--readonly">
        <span>原本单个账号并发</span>
        <output class="account-concurrency-dialog__readonly-value" :title="originalConcurrencySummary">{{ originalConcurrencySummary }}</output>
      </div>

      <label class="account-concurrency-dialog__field">
        <span>统一设置为</span>
        <input
          v-model.number="targetConcurrency"
          type="number"
          inputmode="numeric"
          step="1"
          :min="minimum ?? undefined"
          :max="maximum ?? undefined"
          :disabled="busy"
          aria-describedby="account-concurrency-target-help"
          placeholder="输入并发数"
          @keydown.enter.prevent="submit"
        />
      </label>
      <p id="account-concurrency-target-help" class="account-concurrency-dialog__help">{{ helpText }}</p>
      <p v-if="targetError && targetConcurrency !== ''" class="account-concurrency-dialog__validation" role="alert">{{ targetError }}</p>

      <dl class="account-concurrency-dialog__metadata">
        <div>
          <dt>并发范围</dt>
          <dd>{{ concurrencyRangeDescription }}</dd>
        </div>
        <div v-if="concurrencyOrderText">
          <dt>生效说明</dt>
          <dd>{{ concurrencyOrderText }}</dd>
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
.account-dialog__icon--concurrency { color: var(--violet); background: var(--brand-subtle); }
.account-dialog__close { display: inline-grid; flex: 0 0 auto; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.account-dialog__close:hover:not(:disabled) { color: var(--ink); background: var(--surface-hover); }
.account-concurrency-dialog__field { display: grid; margin-top: 15px; gap: 7px; color: var(--text); font-size: 13px; font-weight: 650; }
.account-concurrency-dialog__field input, .account-concurrency-dialog__readonly-value { width: 100%; min-height: 40px; padding: 9px 10px; border: 1px solid var(--control-border); border-radius: 6px; color: var(--text-strong); background: var(--surface); font: inherit; font-variant-numeric: tabular-nums; }
.account-concurrency-dialog__field input { outline: 0; }
.account-concurrency-dialog__field input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--focus-soft); }
.account-concurrency-dialog__readonly-value { display: block; overflow: hidden; color: var(--muted); border-color: var(--divider); background: var(--surface-subtle); text-overflow: ellipsis; white-space: nowrap; }
.account-concurrency-dialog__help, .account-concurrency-dialog__validation { margin: 7px 0 0; font-size: 12px; line-height: 1.5; }
.account-concurrency-dialog__help { color: var(--muted); }
.account-concurrency-dialog__validation { color: var(--danger); }
.account-concurrency-dialog__metadata { display: grid; margin: 15px 0 0; padding: 11px 12px; gap: 8px; border: 1px solid var(--divider); border-radius: 6px; background: var(--surface-subtle); }
.account-concurrency-dialog__metadata div { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 10px; font-size: 12px; line-height: 1.45; }
.account-concurrency-dialog__metadata dt { color: var(--muted); }
.account-concurrency-dialog__metadata dd { min-width: 0; margin: 0; color: var(--text); }
.account-dialog__error { margin: 14px 0 0; padding: 10px 12px; color: var(--danger); border: 1px solid var(--danger-border); border-radius: 6px; background: var(--danger-subtle); font-size: 13px; line-height: 1.5; }
.account-dialog__actions { display: flex; gap: 8px; margin-top: 20px; }
.account-dialog__actions--end { justify-content: flex-end; }
@media (max-width: 440px) { .account-dialog-backdrop { align-items: end; padding: 12px; } .account-dialog { padding: 17px; } .account-concurrency-dialog__metadata div { grid-template-columns: 1fr; gap: 2px; } }
</style>
