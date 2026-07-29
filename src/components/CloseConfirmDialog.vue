<script setup lang="ts">
import { Power, X } from "@lucide/vue";
import { ref, watch } from "vue";

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{
  cancel: [];
  confirm: [skipFutureConfirmations: boolean];
}>();

const skipFutureConfirmations = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) skipFutureConfirmations.value = false;
  },
);
</script>

<template>
  <div v-if="open" class="close-dialog-backdrop" @mousedown.self="emit('cancel')">
    <section class="close-dialog" role="dialog" aria-modal="true" aria-labelledby="close-dialog-title" tabindex="-1" @keydown.esc="emit('cancel')">
      <header class="close-dialog__header">
        <span class="close-dialog__icon"><Power :size="20" aria-hidden="true" /></span>
        <div>
          <h2 id="close-dialog-title">确认关闭 Sub2Bat？</h2>
          <p>关闭后将退出当前客户端。</p>
        </div>
        <button class="close-dialog__dismiss" type="button" title="取消关闭" aria-label="取消关闭" @click="emit('cancel')">
          <X :size="18" aria-hidden="true" />
        </button>
      </header>

      <label class="close-dialog__preference">
        <input v-model="skipFutureConfirmations" type="checkbox" />
        <span>下次不再提示</span>
      </label>

      <footer class="close-dialog__actions">
        <button class="button button--secondary" type="button" @click="emit('cancel')">取消</button>
        <button class="button close-dialog__confirm" type="button" @click="emit('confirm', skipFutureConfirmations)">确认关闭</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.close-dialog-backdrop { position: fixed; z-index: 60; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: color-mix(in srgb, var(--ink) 42%, transparent); }
.close-dialog { width: min(100%, 390px); padding: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.close-dialog__header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: flex-start; gap: 11px; }
.close-dialog__icon { display: inline-grid; place-items: center; width: 34px; height: 34px; color: var(--danger); border-radius: 7px; background: var(--danger-subtle); }
.close-dialog__header h2 { margin: 1px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.close-dialog__header p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.close-dialog__dismiss { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.close-dialog__dismiss:hover { color: var(--ink); background: var(--surface-hover); }
.close-dialog__preference { display: inline-flex; align-items: center; margin-top: 20px; gap: 8px; color: var(--text); font-size: 13px; cursor: pointer; }
.close-dialog__preference input { width: 15px; height: 15px; margin: 0; accent-color: var(--brand); }
.close-dialog__actions { display: flex; justify-content: flex-end; margin-top: 20px; gap: 8px; }
.close-dialog__confirm { color: var(--surface); background: var(--danger); }
.close-dialog__confirm:hover { background: color-mix(in srgb, var(--danger) 85%, var(--ink)); }
@media (max-width: 440px) { .close-dialog-backdrop { align-items: end; padding: 12px; } .close-dialog { padding: 17px; } }
</style>
