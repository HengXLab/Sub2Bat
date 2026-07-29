<script setup lang="ts">
import { FolderInput } from "@lucide/vue";
import { computed } from "vue";

const props = withDefaults(defineProps<{
  directory: string;
  disabled?: boolean;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  pick: [];
}>();

const selectedDirectory = computed(() => props.directory.trim());
</script>

<template>
  <section class="export-directory-field" aria-label="保存目录">
    <div class="export-directory-field__value">
      <span>保存目录</span>
      <output :class="{ 'export-directory-field__placeholder': !selectedDirectory }" :title="selectedDirectory || undefined" aria-live="polite">
        {{ selectedDirectory || "请先选择保存目录" }}
      </output>
    </div>
    <button class="button button--secondary export-directory-field__button" type="button" :disabled="disabled" @click="emit('pick')">
      <FolderInput :size="16" aria-hidden="true" />选择目录
    </button>
  </section>
</template>

<style scoped>
.export-directory-field { display: flex; align-items: end; margin-top: 12px; gap: 10px; }
.export-directory-field__value { display: grid; flex: 1 1 auto; min-width: 0; gap: 7px; color: var(--text-strong); font-size: 13px; font-weight: 650; }
.export-directory-field__value output { overflow: hidden; display: block; width: 100%; height: 40px; padding: 10px; color: var(--text); border: 1px solid var(--control-border); border-radius: 6px; background: var(--surface-subtle); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; font-weight: 400; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.export-directory-field__value output.export-directory-field__placeholder { color: var(--muted); font-family: inherit; }
.export-directory-field__button { flex: 0 0 auto; height: 40px; }
@media (max-width: 440px) { .export-directory-field { align-items: stretch; flex-direction: column; } .export-directory-field__button { width: 100%; } }
</style>
