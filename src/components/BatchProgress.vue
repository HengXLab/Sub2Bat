<script setup lang="ts">
import { LoaderCircle } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { BatchSummary } from "../types";

const props = withDefaults(defineProps<{
  summary: BatchSummary;
  running: boolean;
  /** Snapshot of selected accounts whose existing Sub2API state is inactive. */
  inactiveCount?: number;
}>(), {
  inactiveCount: 0,
});

const completed = computed(() => props.summary.succeeded + props.summary.failed + props.summary.quotaExhausted + props.summary.connectionInterrupted + props.summary.cancelled);
const percent = computed(() => (props.summary.total ? Math.round((completed.value / props.summary.total) * 100) : 0));
const hasStarted = computed(() => props.summary.total > 0);
const completionText = computed(() => `${completed.value}/${props.summary.total}`);
const state = computed(() => (hasStarted.value ? (props.running ? "running" : "complete") : "idle"));
const testStartedAt = ref<Date | null>(null);
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function completedCount(summary: BatchSummary) {
  return summary.succeeded + summary.failed + summary.quotaExhausted + summary.connectionInterrupted + summary.cancelled;
}

function markTestStarted() {
  testStartedAt.value = new Date();
}

// A new run replaces the completed summary with an all-pending one before the
// backend emits its first event. Keep that timestamp after the run completes.
watch(
  () => props.summary,
  (summary, previousSummary) => {
    if (
      summary.total > 0
      && completedCount(summary) === 0
      && (!testStartedAt.value || (previousSummary && completedCount(previousSummary) > 0))
    ) {
      markTestStarted();
    }
  },
  { immediate: true },
);

watch(
  () => props.running,
  (running, wasRunning) => {
    if (running && !wasRunning) {
      markTestStarted();
    }
  },
);

const heading = computed(() => {
  if (state.value === "idle") return "请选择账号后开始测试";
  return testStartedAt.value ? `日期：${dateFormatter.format(testStartedAt.value)}` : "日期：-";
});
const runState = computed(() => {
  if (props.summary.cancelled > 0) return { label: "已取消", tone: "cancelled" as const };
  return null;
});
</script>

<template>
  <section class="batch-progress" :class="`batch-progress--${state}`" aria-live="polite">
    <div class="batch-progress__heading">
      <strong>{{ heading }}</strong>
      <span v-if="hasStarted && !runState" class="batch-progress__completion" :aria-label="`已完成 ${completionText} 个选中账号`">
        <LoaderCircle v-if="running" class="spin" :size="14" aria-hidden="true" />
        {{ completionText }}
      </span>
      <span v-else-if="runState" class="batch-progress__run-state" :class="`batch-progress__run-state--${runState.tone}`">
        {{ runState.label }}
      </span>
    </div>
    <div class="batch-progress__stats" :class="{ 'batch-progress__stats--muted': !hasStarted }">
      <span class="result-stat result-stat--success">正常 {{ summary.succeeded }}</span>
      <span class="result-stat result-stat--quota">限流中 {{ summary.quotaExhausted }}</span>
      <span class="result-stat result-stat--interrupted">连接中断 {{ summary.connectionInterrupted }}</span>
      <span class="result-stat result-stat--failure">错误 {{ summary.failed }}</span>
      <span class="result-stat result-stat--inactive">停用 {{ inactiveCount }}</span>
    </div>
    <div
      class="progress-track"
      role="progressbar"
      aria-label="测试进度"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="percent"
      :aria-valuetext="`${percent}%`"
    >
      <span class="progress-track__fill" :style="{ width: `${percent}%` }"></span>
      <span class="progress-track__label" :class="{ 'progress-track__label--on-fill': percent >= 50 }">{{ percent }}%</span>
    </div>
  </section>
</template>
