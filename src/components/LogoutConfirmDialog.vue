<script setup lang="ts">
import { LogOut, X } from "@lucide/vue";

defineProps<{ open: boolean }>();

defineEmits<{
  cancel: [];
  confirm: [];
}>();
</script>

<template>
  <div v-if="open" class="logout-dialog-backdrop" @mousedown.self="$emit('cancel')">
    <section class="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-dialog-title" tabindex="-1" @keydown.esc="$emit('cancel')">
      <header class="logout-dialog__header">
        <span class="logout-dialog__icon"><LogOut :size="20" aria-hidden="true" /></span>
        <div>
          <h2 id="logout-dialog-title">确认退出登录？</h2>
          <p>退出后将清除当前登录会话，需要重新登录后才能继续操作。</p>
        </div>
        <button class="logout-dialog__dismiss" type="button" title="取消退出登录" aria-label="取消退出登录" @click="$emit('cancel')">
          <X :size="18" aria-hidden="true" />
        </button>
      </header>

      <footer class="logout-dialog__actions">
        <button class="button button--secondary" type="button" @click="$emit('cancel')">取消</button>
        <button class="button logout-dialog__confirm" type="button" @click="$emit('confirm')">确认退出</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.logout-dialog-backdrop { position: fixed; z-index: 60; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: color-mix(in srgb, var(--ink) 42%, transparent); }
.logout-dialog { width: min(100%, 400px); padding: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.logout-dialog__header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: flex-start; gap: 11px; }
.logout-dialog__icon { display: inline-grid; place-items: center; width: 34px; height: 34px; color: var(--brand); border-radius: 7px; background: var(--brand-subtle); }
.logout-dialog__header h2 { margin: 1px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.logout-dialog__header p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.logout-dialog__dismiss { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.logout-dialog__dismiss:hover { color: var(--ink); background: var(--surface-hover); }
.logout-dialog__actions { display: flex; justify-content: flex-end; margin-top: 20px; gap: 8px; }
.logout-dialog__confirm { color: var(--surface); background: var(--brand); }
.logout-dialog__confirm:hover { background: var(--brand-hover); }
@media (max-width: 440px) { .logout-dialog-backdrop { align-items: end; padding: 12px; } .logout-dialog { padding: 17px; } }
</style>
