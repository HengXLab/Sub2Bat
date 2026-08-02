<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { FILE_NAME_TEMPLATE_TOKENS, formatExportFileName } from "../lib/exportFile";

const props = defineProps<{
  modelValue: string;
  count: number;
  format: string;
  extension: string;
  timestamp: Date;
  disabled?: boolean;
  hint?: string;
  hideHint?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const templateInput = ref<HTMLInputElement | null>(null);
const preview = computed(() => formatExportFileName(props.modelValue, {
  count: props.count,
  format: props.format,
  extension: props.extension,
  timestamp: props.timestamp,
}));

function insertToken(token: string) {
  const input = templateInput.value;
  const current = props.modelValue;
  const start = input?.selectionStart ?? current.length;
  const end = input?.selectionEnd ?? current.length;
  const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
  emit("update:modelValue", next);

  void nextTick(() => {
    if (!input) return;
    const position = start + token.length;
    input.focus();
    input.setSelectionRange(position, position);
  });
}
</script>

<template>
  <section class="export-file-name-field" aria-labelledby="export-file-name-template-title">
    <label>
      <span id="export-file-name-template-title">文件名称模板</span>
      <input
        ref="templateInput"
        :value="modelValue"
        type="text"
        :disabled="disabled"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <div class="export-file-name-field__tokens" aria-label="快速插入名称变量">
      <span>快速插入</span>
      <button v-for="token in FILE_NAME_TEMPLATE_TOKENS" :key="token" type="button" :disabled="disabled" @click="insertToken(token)">{{ token }}</button>
    </div>
    <div class="export-file-name-field__preview">
      <span>文件名预览</span>
      <output :title="preview">{{ preview }}</output>
    </div>
    <small v-if="!hideHint">{{ hint ?? "支持日期、时间、数量和导出格式；系统会在下一步选择保存目录。" }}</small>
  </section>
</template>

<style scoped>
.export-file-name-field { display: grid; margin-top: 16px; gap: 8px; }
.export-file-name-field > label { display: grid; gap: 7px; color: var(--text-strong); font-size: 13px; font-weight: 650; }
.export-file-name-field input { width: 100%; height: 40px; padding: 0 10px; color: var(--ink); border: 1px solid var(--control-border); border-radius: 6px; background: var(--surface); outline: 0; font: inherit; }
.export-file-name-field input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--focus-soft); }
.export-file-name-field__tokens { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.export-file-name-field__tokens > span { margin-right: 2px; color: var(--muted); font-size: 12px; }
.export-file-name-field__tokens button { min-height: 26px; padding: 0 7px; color: var(--brand-ink); border: 1px solid var(--border-hover); border-radius: 4px; background: var(--surface-subtle); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; cursor: pointer; }
.export-file-name-field__tokens button:hover:not(:disabled) { color: var(--brand-hover); border-color: var(--border-hover); background: var(--brand-hover-subtle); }
.export-file-name-field__tokens button:disabled { opacity: 0.5; cursor: not-allowed; }
.export-file-name-field__preview { display: flex; align-items: center; min-width: 0; padding: 8px 10px; gap: 9px; color: var(--muted); border: 1px solid var(--border); border-radius: 6px; background: var(--surface-subtle); font-size: 12px; }
.export-file-name-field__preview span { flex: 0 0 auto; }
.export-file-name-field__preview output { overflow: hidden; min-width: 0; color: var(--text); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
.export-file-name-field small { color: var(--muted); font-size: 12px; line-height: 1.45; }
</style>
