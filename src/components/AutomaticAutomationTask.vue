<script setup lang="ts">
import { Clock3, LoaderCircle } from "@lucide/vue";
import { computed } from "vue";

export type AutomaticAutomationTaskPhase = "waiting" | "claiming" | "executing";

const props = withDefaults(defineProps<{
  ruleName: string;
  phase: AutomaticAutomationTaskPhase;
  progress?: number | null;
  noticeVisible?: boolean;
}>(), {
  progress: null,
  noticeVisible: false,
});

const emit = defineEmits<{
  open: [];
}>();

const phaseLabel = computed(() => {
  if (props.phase === "executing") return "正在执行";
  if (props.phase === "claiming") return "正在准备";
  return "间隔等待";
});

const taskTitle = computed(() => `${props.ruleName}：${phaseLabel.value}`);
const measuredProgress = computed(() => (
  typeof props.progress === "number" && Number.isFinite(props.progress)
));
const progressStyle = computed(() => {
  if (!measuredProgress.value) return undefined;
  const progress = Math.max(0, Math.min(1, props.progress ?? 0));
  return { "--automatic-task-progress-offset": String(113.1 * (1 - progress)) };
});
</script>

<template>
  <aside
    :class="[
      'automatic-automation-task',
      `automatic-automation-task--${phase}`,
      {
        'automatic-automation-task--with-notice': noticeVisible,
        'automatic-automation-task--measured-progress': measuredProgress,
      },
    ]"
    :style="progressStyle"
    aria-live="polite"
  >
    <button class="automatic-automation-task__button" type="button" :title="taskTitle" :aria-label="`打开批量自动化“${ruleName}”，${phaseLabel}`" @click="emit('open')">
      <span class="automatic-automation-task__icon" aria-hidden="true">
        <LoaderCircle v-if="phase !== 'waiting'" class="automatic-automation-task__spinner" :size="19" />
        <Clock3 v-else :size="19" />
        <svg class="automatic-automation-task__progress" viewBox="0 0 44 44" focusable="false">
          <circle class="automatic-automation-task__progress-track" cx="22" cy="22" r="18" />
          <circle class="automatic-automation-task__progress-value" cx="22" cy="22" r="18" />
        </svg>
        <span class="automatic-automation-task__status-dot" />
      </span>
      <span class="automatic-automation-task__copy">
        <strong :title="ruleName">{{ ruleName }}</strong>
        <small>{{ phaseLabel }}</small>
      </span>
    </button>
  </aside>
</template>

<style scoped>
.automatic-automation-task { position: fixed; z-index: 24; right: 24px; bottom: 24px; width: min(304px, calc(100vw - 48px)); transition: bottom 0.2s ease; }
.automatic-automation-task--with-notice { bottom: 112px; }
.automatic-automation-task__button { display: grid; grid-template-columns: 36px minmax(0, 1fr); align-items: center; width: 100%; min-height: 56px; padding: 8px 12px 8px 9px; gap: 10px; color: var(--text); border: 1px solid var(--border-strong); border-radius: 7px; background: var(--surface); box-shadow: 0 12px 30px var(--shadow); text-align: left; cursor: pointer; transition: border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease; }
.automatic-automation-task__button:hover { border-color: var(--brand); background: var(--surface-hover); box-shadow: 0 16px 34px var(--shadow-strong); }
.automatic-automation-task__button:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 3px; }
.automatic-automation-task__icon { position: relative; display: inline-grid; isolation: isolate; place-items: center; width: 36px; height: 36px; overflow: visible; color: var(--brand); border-radius: 7px; background: var(--brand-subtle); }
.automatic-automation-task__progress { position: absolute; z-index: 1; inset: -4px; width: 44px; height: 44px; overflow: visible; pointer-events: none; transform: rotate(-90deg); }
.automatic-automation-task__progress-track, .automatic-automation-task__progress-value { fill: none; stroke-width: 3; }
.automatic-automation-task__progress-track { stroke: var(--border-strong); opacity: 0.72; }
.automatic-automation-task__progress-value { stroke: var(--brand); stroke-dasharray: 66 48; stroke-linecap: round; transform-box: fill-box; transform-origin: center; animation: automatic-task-ring 3s ease-in-out infinite; }
.automatic-automation-task__status-dot { position: absolute; z-index: 2; right: -2px; bottom: -2px; width: 9px; height: 9px; border: 2px solid var(--surface); border-radius: 50%; background: var(--success); }
.automatic-automation-task__copy { display: grid; min-width: 0; gap: 2px; }
.automatic-automation-task__copy strong { overflow: hidden; color: var(--heading); font-size: 13px; font-weight: 700; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
.automatic-automation-task__copy small { color: var(--muted); font-size: 11px; font-weight: 650; line-height: 1.25; }
.automatic-automation-task--waiting .automatic-automation-task__icon { animation: automatic-task-idle 2.4s ease-in-out infinite; }
.automatic-automation-task--waiting .automatic-automation-task__status-dot { animation: automatic-task-dot 2.4s ease-in-out infinite; }
.automatic-automation-task--waiting .automatic-automation-task__progress-value { stroke: var(--brand); animation-duration: 3.4s; }
.automatic-automation-task--claiming .automatic-automation-task__icon { color: var(--warning); background: var(--warning-subtle); }
.automatic-automation-task--claiming .automatic-automation-task__status-dot { background: var(--warning-dot); }
.automatic-automation-task--claiming .automatic-automation-task__spinner { animation: automatic-task-spin 1.25s linear infinite; }
.automatic-automation-task--claiming .automatic-automation-task__progress-value { stroke: var(--warning); animation-duration: 1.55s; }
.automatic-automation-task--executing .automatic-automation-task__button { border-color: var(--cyan-border); background: var(--cyan-subtle); box-shadow: 0 14px 32px rgba(10, 139, 171, 0.18); }
.automatic-automation-task--executing .automatic-automation-task__icon { color: var(--cyan); background: var(--surface); animation: automatic-task-active 1.1s ease-in-out infinite; }
.automatic-automation-task--executing .automatic-automation-task__status-dot { background: var(--cyan); }
.automatic-automation-task--executing .automatic-automation-task__spinner { animation: automatic-task-spin 0.78s linear infinite; }
.automatic-automation-task--executing .automatic-automation-task__progress-value { stroke: var(--cyan); animation-duration: 0.92s; }
.automatic-automation-task--measured-progress .automatic-automation-task__progress-value { stroke-dasharray: 113.1; stroke-dashoffset: var(--automatic-task-progress-offset); animation: none; }
@keyframes automatic-task-idle { 0%, 100% { transform: translateY(0); box-shadow: 0 0 0 0 rgba(85, 70, 216, 0.14); } 50% { transform: translateY(-1px); box-shadow: 0 0 0 6px rgba(85, 70, 216, 0); } }
@keyframes automatic-task-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.58; transform: scale(0.82); } }
@keyframes automatic-task-active { 0%, 100% { box-shadow: 0 0 0 0 rgba(10, 139, 171, 0.12); } 50% { box-shadow: 0 0 0 7px rgba(10, 139, 171, 0); } }
@keyframes automatic-task-spin { to { transform: rotate(360deg); } }
@keyframes automatic-task-ring { 0% { stroke-dasharray: 18 96; stroke-dashoffset: 0; transform: rotate(0deg); } 50% { stroke-dasharray: 82 32; stroke-dashoffset: -26; transform: rotate(135deg); } 100% { stroke-dasharray: 18 96; stroke-dashoffset: -104; transform: rotate(270deg); } }
@media (max-width: 720px) { .automatic-automation-task { right: 12px; bottom: 12px; width: min(304px, calc(100vw - 24px)); } .automatic-automation-task--with-notice { bottom: 100px; } }
@media (prefers-reduced-motion: reduce) { .automatic-automation-task__icon, .automatic-automation-task__status-dot, .automatic-automation-task__spinner, .automatic-automation-task__progress-value { animation: none !important; } }
</style>
