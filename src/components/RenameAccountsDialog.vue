<script setup lang="ts">
import { ListRestart, Sparkles, X } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";

interface RenameAccount {
  id: number;
  name: string;
}

interface RenameItem {
  accountId: number;
  name: string;
}

const props = withDefaults(defineProps<{
  open: boolean;
  accounts: readonly RenameAccount[];
  busy?: boolean;
  error?: string | null;
}>(), {
  busy: false,
  error: null,
});

const emit = defineEmits<{
  cancel: [];
  apply: [payload: { template: string; startIndex: number; padding: number; items: RenameItem[] }];
}>();

const templateInput = ref<HTMLInputElement | null>(null);
const namingTemplate = ref("{{name}}");
const startIndex = ref(1);
const padding = ref(2);

const templateError = computed(() => {
  if (!namingTemplate.value.trim()) return "请输入命名模板。";
  if (!Number.isSafeInteger(startIndex.value) || startIndex.value < 1) return "起始序号必须是大于 0 的整数。";
  if (!Number.isSafeInteger(padding.value) || padding.value < 0 || padding.value > 12) return "补零位数需要是 0 到 12 之间的整数。";
  return null;
});

const previewItems = computed(() => props.accounts.slice(0, 4).map((account, offset) => ({
  ...account,
  nextName: renderName(account, offset),
})));

const canSubmit = computed(() => !templateError.value && props.accounts.length > 0 && !props.busy);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    namingTemplate.value = "{{name}}";
    startIndex.value = 1;
    padding.value = 2;
  },
);

function renderName(account: RenameAccount, offset: number) {
  const index = String(startIndex.value + offset).padStart(Math.max(0, padding.value), "0");
  return namingTemplate.value
    .split("{{name}}").join(account.name || "未命名账号")
    .split("{{id}}").join(String(account.id))
    .split("{{index}}").join(index)
    .trim();
}

function insertToken(token: "{{name}}" | "{{id}}" | "{{index}}") {
  const input = templateInput.value;
  const start = input?.selectionStart ?? namingTemplate.value.length;
  const end = input?.selectionEnd ?? namingTemplate.value.length;
  namingTemplate.value = `${namingTemplate.value.slice(0, start)}${token}${namingTemplate.value.slice(end)}`;
  nextTick(() => {
    input?.focus();
    input?.setSelectionRange(start + token.length, start + token.length);
  });
}

function resetTemplate() {
  namingTemplate.value = "{{name}}";
  startIndex.value = 1;
  padding.value = 2;
  nextTick(() => templateInput.value?.focus());
}

function submit() {
  if (!canSubmit.value) return;
  const items = props.accounts.map((account, offset) => ({ accountId: account.id, name: renderName(account, offset) }));
  if (items.some((item) => !item.name)) return;
  emit("apply", {
    template: namingTemplate.value,
    startIndex: startIndex.value,
    padding: padding.value,
    items,
  });
}
</script>

<template>
  <div v-if="open" class="account-dialog-backdrop">
    <section class="account-dialog rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-accounts-title" @keydown.esc="!busy && emit('cancel')">
      <header class="account-dialog__header">
        <div class="account-dialog__title">
          <span class="account-dialog__icon account-dialog__icon--rename"><Sparkles :size="20" aria-hidden="true" /></span>
          <div>
            <h2 id="rename-accounts-title">批量重命名</h2>
            <p>为 {{ accounts.length }} 个已选账号生成新的显示名称。</p>
          </div>
        </div>
        <button class="account-dialog__close" type="button" title="关闭" aria-label="关闭" :disabled="busy" @click="emit('cancel')">
          <X :size="18" />
        </button>
      </header>

      <label class="rename-dialog__field">
        <span>命名模板</span>
        <input ref="templateInput" v-model="namingTemplate" type="text" :disabled="busy" :placeholder="'例如：{{name}}-{{index}}'" @keydown.enter.prevent="submit" />
      </label>

      <div class="rename-dialog__tokens" aria-label="插入命名字段">
        <span>插入字段</span>
        <button type="button" :disabled="busy" @click="insertToken('{{name}}')">原名称</button>
        <button type="button" :disabled="busy" @click="insertToken('{{id}}')">账号 ID</button>
        <button type="button" :disabled="busy" @click="insertToken('{{index}}')">序号</button>
        <button class="rename-dialog__reset" type="button" title="恢复默认模板" :disabled="busy" @click="resetTemplate"><ListRestart :size="15" /></button>
      </div>
      <p class="rename-dialog__help">
        可组合使用原名称、账号 ID 和序号。例如：生产-<code v-text="'{{index}}'"></code> 或 <code v-text="'{{name}}-{{id}}'"></code>。
      </p>

      <div class="rename-dialog__numbers">
        <label class="rename-dialog__field">
          <span>起始序号</span>
          <input v-model.number="startIndex" type="number" inputmode="numeric" min="1" step="1" :disabled="busy" />
        </label>
        <label class="rename-dialog__field">
          <span>序号补零位数</span>
          <input v-model.number="padding" type="number" inputmode="numeric" min="0" max="12" step="1" :disabled="busy" />
        </label>
      </div>

      <section class="rename-dialog__preview" aria-labelledby="rename-preview-title">
        <div class="rename-dialog__preview-heading">
          <strong id="rename-preview-title">名称预览</strong>
          <span v-if="accounts.length > previewItems.length">显示前 {{ previewItems.length }} 项</span>
        </div>
        <div v-if="previewItems.length" class="rename-dialog__preview-list">
          <div v-for="item in previewItems" :key="item.id" class="rename-dialog__preview-item">
            <span :title="item.name || '未命名账号'">{{ item.name || "未命名账号" }}</span>
            <span aria-hidden="true">→</span>
            <strong :title="item.nextName">{{ item.nextName || "请输入有效的命名模板" }}</strong>
          </div>
        </div>
        <p v-else>没有可重命名的账号。</p>
      </section>

      <p v-if="templateError" class="rename-dialog__validation" role="alert">{{ templateError }}</p>
      <p v-if="error" class="account-dialog__error" role="alert">{{ error }}</p>

      <footer class="account-dialog__actions account-dialog__actions--end">
        <button class="button button--secondary" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
        <button class="button button--primary" type="button" :disabled="!canSubmit" @click="submit">
          {{ busy ? "正在重命名..." : "确认重命名" }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.account-dialog-backdrop { position: fixed; z-index: 30; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: color-mix(in srgb, var(--ink) 42%, transparent); }
.account-dialog { width: min(100%, 620px); max-height: var(--dialog-content-max-height); overflow-y: auto; padding: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.account-dialog__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.account-dialog__title { display: flex; align-items: flex-start; gap: 11px; min-width: 0; }
.account-dialog__title h2 { margin: 1px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.account-dialog__title p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.account-dialog__icon { display: inline-grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px; border-radius: 7px; }
.account-dialog__icon--rename { color: var(--warning); background: var(--warning-subtle); }
.account-dialog__close { display: inline-grid; flex: 0 0 auto; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.account-dialog__close:hover:not(:disabled) { color: var(--ink); background: var(--surface-hover); }
.rename-dialog__field { display: grid; margin-top: 15px; gap: 7px; color: var(--text); font-size: 13px; font-weight: 650; }
.rename-dialog__field input { width: 100%; height: 40px; padding: 0 10px; color: var(--text-strong); border: 1px solid var(--control-border); border-radius: 6px; background: var(--surface); outline: 0; font: inherit; }
.rename-dialog__field input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--focus-soft); }
.rename-dialog__tokens { display: flex; align-items: center; flex-wrap: wrap; margin-top: 9px; gap: 6px; color: var(--muted); font-size: 12px; }
.rename-dialog__tokens > span { margin-right: 2px; }
.rename-dialog__tokens button { min-height: 27px; padding: 0 8px; color: var(--brand-ink); border: 1px solid var(--border-hover); border-radius: 5px; background: var(--surface); font: inherit; font-weight: 650; cursor: pointer; }
.rename-dialog__tokens button:hover:not(:disabled) { border-color: var(--brand); background: var(--brand-hover-subtle); }
.rename-dialog__tokens button:disabled { opacity: 0.48; cursor: not-allowed; }
.rename-dialog__tokens .rename-dialog__reset { display: inline-grid; place-items: center; width: 27px; padding: 0; color: var(--muted); }
.rename-dialog__help, .rename-dialog__validation { margin: 8px 0 0; font-size: 12px; line-height: 1.5; }
.rename-dialog__help { color: var(--muted); }
.rename-dialog__validation { color: var(--danger); }
.rename-dialog__numbers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.rename-dialog__numbers .rename-dialog__field { min-width: 0; }
.rename-dialog__preview { margin-top: 16px; padding: 12px; border: 1px solid var(--divider); border-radius: 6px; background: var(--surface-subtle); }
.rename-dialog__preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--text); font-size: 13px; }
.rename-dialog__preview-heading span { color: var(--muted-soft); font-size: 12px; }
.rename-dialog__preview-list { display: grid; margin-top: 9px; gap: 7px; }
.rename-dialog__preview-item { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
.rename-dialog__preview-item > span:first-child, .rename-dialog__preview-item strong { overflow: hidden; min-width: 0; text-overflow: ellipsis; white-space: nowrap; }
.rename-dialog__preview-item strong { color: var(--text-strong); font-weight: 650; }
.rename-dialog__preview > p { margin: 9px 0 0; color: var(--muted); font-size: 12px; }
.account-dialog__error { margin: 14px 0 0; padding: 10px 12px; color: var(--danger); border: 1px solid var(--danger-border); border-radius: 6px; background: var(--danger-subtle); font-size: 13px; line-height: 1.5; }
.account-dialog__actions { display: flex; gap: 8px; margin-top: 20px; }
.account-dialog__actions--end { justify-content: flex-end; }
@media (max-width: 440px) { .account-dialog-backdrop { align-items: end; padding: 12px; } .account-dialog { padding: 17px; } .rename-dialog__numbers { grid-template-columns: 1fr; gap: 0; } .rename-dialog__preview-item { grid-template-columns: minmax(0, 1fr) auto; } .rename-dialog__preview-item strong { grid-column: 1 / -1; } }
</style>
