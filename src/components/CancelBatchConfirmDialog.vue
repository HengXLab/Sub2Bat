<script setup lang="ts">
import { CircleStop, X } from "@lucide/vue";

defineProps<{ open: boolean }>();

defineEmits<{
  cancel: [];
  confirm: [];
}>();
</script>

<template>
  <div v-if="open" class="cancel-batch-dialog-backdrop">
    <section class="cancel-batch-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-batch-dialog-title" tabindex="-1" @keydown.esc="$emit('cancel')">
      <header class="cancel-batch-dialog__header">
        <span class="cancel-batch-dialog__icon"><CircleStop :size="20" aria-hidden="true" /></span>
        <div>
          <h2 id="cancel-batch-dialog-title">确认取消测试？</h2>
          <p>当前批量测试将停止，尚未完成的账号会显示为已取消。</p>
        </div>
        <button class="cancel-batch-dialog__dismiss" type="button" title="继续测试" aria-label="继续测试" @click="$emit('cancel')">
          <X :size="18" aria-hidden="true" />
        </button>
      </header>

      <footer class="cancel-batch-dialog__actions">
        <button class="button button--secondary" type="button" @click="$emit('cancel')">继续测试</button>
        <button class="button cancel-batch-dialog__confirm" type="button" @click="$emit('confirm')">确认取消</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.cancel-batch-dialog-backdrop { position: fixed; z-index: 60; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: color-mix(in srgb, var(--ink) 42%, transparent); }
.cancel-batch-dialog { width: min(100%, 400px); padding: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.cancel-batch-dialog__header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: flex-start; gap: 11px; }
.cancel-batch-dialog__icon { display: inline-grid; place-items: center; width: 34px; height: 34px; color: var(--danger); border-radius: 7px; background: var(--danger-subtle); }
.cancel-batch-dialog__header h2 { margin: 1px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.cancel-batch-dialog__header p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.cancel-batch-dialog__dismiss { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.cancel-batch-dialog__dismiss:hover { color: var(--ink); background: var(--surface-hover); }
.cancel-batch-dialog__actions { display: flex; justify-content: flex-end; margin-top: 20px; gap: 8px; }
.cancel-batch-dialog__confirm { color: var(--surface); background: var(--danger); }
.cancel-batch-dialog__confirm:hover { background: color-mix(in srgb, var(--danger) 85%, var(--ink)); }
@media (max-width: 440px) { .cancel-batch-dialog-backdrop { align-items: end; padding: 12px; } .cancel-batch-dialog { padding: 17px; } }
</style>
