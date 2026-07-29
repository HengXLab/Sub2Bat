<script setup lang="ts">
import { CircleCheck, X } from "@lucide/vue";

defineProps<{
  message: string | null;
}>();

defineEmits<{ dismiss: [] }>();
</script>

<template>
  <div v-if="message" class="operation-notice" role="status" aria-live="polite">
    <CircleCheck :size="19" aria-hidden="true" />
    <span>{{ message }}</span>
    <button type="button" title="关闭提示" aria-label="关闭提示" @click="$emit('dismiss')"><X :size="16" /></button>
  </div>
</template>

<style scoped>
.operation-notice { position: fixed; z-index: 25; right: 24px; bottom: 24px; display: flex; align-items: center; max-width: min(420px, calc(100vw - 32px)); min-height: 46px; padding: 10px 10px 10px 13px; gap: 9px; color: var(--success); border: 1px solid var(--success-border); border-radius: 7px; background: var(--success-subtle); box-shadow: 0 12px 30px var(--shadow); font-size: 13px; font-weight: 650; }
.operation-notice > svg { flex: 0 0 auto; color: var(--success); }
.operation-notice span { min-width: 0; line-height: 1.45; }
.operation-notice button { display: inline-grid; flex: 0 0 auto; place-items: center; width: 28px; height: 28px; padding: 0; margin-left: 2px; color: var(--muted); border: 0; border-radius: 5px; background: transparent; cursor: pointer; }
.operation-notice button:hover { color: var(--success); background: var(--success-track); }
@media (max-width: 720px) { .operation-notice { right: 12px; bottom: 12px; } }
</style>
