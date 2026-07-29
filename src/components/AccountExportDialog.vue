<script setup lang="ts">
import { FileDown, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import ExportDirectoryField from "./ExportDirectoryField.vue";
import ExportFileNameField from "./ExportFileNameField.vue";
import { formatExportFileName } from "../lib/exportFile";
import type { AccountExportFormat } from "../lib/accountExport";

const props = withDefaults(defineProps<{
  open: boolean;
  selectedCount: number;
  directory?: string;
  busy?: boolean;
  error?: string | null;
}>(), {
  directory: "",
  busy: false,
  error: null,
});

const emit = defineEmits<{
  cancel: [];
  pickDirectory: [];
  export: [payload: { fileName: string; includeProxies: boolean; format: AccountExportFormat }];
}>();

const exportFormat = ref<AccountExportFormat>("sub2api");
const fileNameTemplate = ref("账号导出-{format}-{datetime}-{count}");
const includeProxies = ref(true);
const exportTimestamp = ref(new Date());
const fileExtension = computed(() => exportFormat.value === "cpa" ? "zip" : "json");
const formatLabel = computed(() => exportFormat.value === "cpa" ? "CPA ZIP" : "Sub2API JSON");
const resolvedFileName = computed(() => formatExportFileName(fileNameTemplate.value, {
  count: props.selectedCount,
  format: fileExtension.value,
  extension: fileExtension.value,
  timestamp: exportTimestamp.value,
}));
const canExport = computed(() => (
  props.selectedCount > 0
  && fileNameTemplate.value.trim().length > 0
  && props.directory.trim().length > 0
  && !props.busy
));

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    exportFormat.value = "sub2api";
    fileNameTemplate.value = "账号导出-{format}-{datetime}-{count}";
    includeProxies.value = true;
    exportTimestamp.value = new Date();
  },
);

function submit() {
  if (!canExport.value) return;
  exportTimestamp.value = new Date();
  emit("export", {
    fileName: resolvedFileName.value,
    includeProxies: exportFormat.value === "sub2api" && includeProxies.value,
    format: exportFormat.value,
  });
}
</script>

<template>
  <div v-if="open" class="account-dialog-backdrop">
    <section class="account-dialog account-export-dialog" role="dialog" aria-modal="true" aria-labelledby="account-export-title" @keydown.esc="!busy && emit('cancel')">
      <header class="account-dialog__header">
        <div class="account-dialog__title">
          <span class="account-dialog__icon account-dialog__icon--export"><FileDown :size="20" aria-hidden="true" /></span>
          <div>
            <h2 id="account-export-title">批量导出账号</h2>
            <p>为 {{ selectedCount }} 个已选账号生成可选择目录保存的导出文件。</p>
          </div>
        </div>
        <button class="account-dialog__close" type="button" title="关闭" aria-label="关闭" :disabled="busy" @click="emit('cancel')">
          <X :size="18" />
        </button>
      </header>

      <dl class="account-export-dialog__metadata">
        <div>
          <dt>导出范围</dt>
          <dd>已选 {{ selectedCount }} 个账号</dd>
        </div>
        <div>
          <dt>输出格式</dt>
          <dd>{{ formatLabel }}</dd>
        </div>
      </dl>

      <label class="account-export-dialog__format">
        <span>账号导出格式</span>
        <select v-model="exportFormat" :disabled="busy">
          <option value="sub2api">Sub2API 官方备份 JSON</option>
          <option value="cpa">CPA 格式 ZIP</option>
        </select>
      </label>

      <ExportFileNameField
        v-model="fileNameTemplate"
        :count="selectedCount"
        :format="fileExtension"
        :extension="fileExtension"
        :timestamp="exportTimestamp"
        :disabled="busy"
        hint="选择保存目录后，账号文件会按此文件名直接导出。"
      />

      <label v-if="exportFormat === 'sub2api'" class="account-export-dialog__option">
        <input v-model="includeProxies" type="checkbox" :disabled="busy" />
        <span>
          <strong>同时导出关联代理</strong>
          <small>使用官方 <code>include_proxies</code> 选项；关闭后仅导出账号配置。</small>
        </span>
      </label>

      <p v-else class="account-export-dialog__cpa-note">CPA 会按 CPA2sub2API 的兼容格式生成 ZIP，内含每个可转换 OAuth 账号各自的 <code>.cpa.json</code> 文件；代理、分组、优先级和并发设置不会写入 CPA。</p>

      <ExportDirectoryField :directory="directory" :disabled="busy" @pick="emit('pickDirectory')" />

      <p class="account-export-dialog__notice">账号导出可能包含凭据及代理连接信息，请仅保存到受信任的位置。</p>
      <p v-if="!fileNameTemplate.trim()" class="account-export-dialog__validation" role="alert">请输入文件名称模板。</p>
      <p v-else-if="!directory.trim()" class="account-export-dialog__validation" role="alert">请先选择保存目录。</p>
      <p v-if="error" class="account-dialog__error" role="alert">{{ error }}</p>

      <footer class="account-dialog__actions account-dialog__actions--end">
        <button class="button button--secondary" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
        <button class="button button--primary" type="button" :disabled="!canExport" @click="submit">
          {{ busy ? "正在导出..." : "导出" }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.account-dialog-backdrop { position: fixed; z-index: 30; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: var(--shadow-lift); }
.account-dialog { width: min(100%, 540px); max-height: var(--dialog-content-max-height); overflow-y: auto; padding: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.account-dialog__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.account-dialog__title { display: flex; align-items: flex-start; gap: 11px; min-width: 0; }
.account-dialog__title h2 { margin: 1px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.account-dialog__title p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.account-dialog__icon { display: inline-grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px; border-radius: 7px; }
.account-dialog__icon--export { color: var(--info); background: var(--cyan-subtle); }
.account-dialog__close { display: inline-grid; flex: 0 0 auto; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.account-dialog__close:hover:not(:disabled) { color: var(--ink); background: var(--surface-hover); }
.account-export-dialog__metadata { display: grid; margin: 16px 0 0; padding: 11px 12px; gap: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-subtle); }
.account-export-dialog__metadata div { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 10px; font-size: 12px; line-height: 1.45; }
.account-export-dialog__metadata dt { color: var(--muted); }
.account-export-dialog__metadata dd { min-width: 0; margin: 0; color: var(--text); }
.account-export-dialog__format { display: grid; margin-top: 16px; gap: 7px; color: var(--text-strong); font-size: 13px; font-weight: 650; }
.account-export-dialog__format select { width: 100%; height: 40px; padding: 0 10px; color: var(--ink); border: 1px solid var(--control-border); border-radius: 6px; background: var(--surface); font: inherit; cursor: pointer; }
.account-export-dialog__format select:focus { border-color: var(--brand); outline: 0; box-shadow: 0 0 0 3px var(--focus-soft); }
.account-export-dialog__option { display: flex; align-items: flex-start; margin-top: 15px; padding: 11px 12px; gap: 9px; color: var(--text); border: 1px solid var(--border); border-radius: 6px; background: var(--surface); cursor: pointer; }
.account-export-dialog__option:hover { background: var(--surface-subtle); }
.account-export-dialog__option input { flex: 0 0 auto; width: 15px; height: 15px; margin: 2px 0 0; accent-color: var(--brand); }
.account-export-dialog__option span { display: grid; min-width: 0; gap: 2px; }
.account-export-dialog__option strong { color: var(--text); font-size: 13px; line-height: 1.35; }
.account-export-dialog__option small { color: var(--muted); font-size: 12px; line-height: 1.45; }
.account-export-dialog__option code, .account-export-dialog__cpa-note code { padding: 0; color: inherit; background: transparent; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: inherit; }
.account-export-dialog__cpa-note, .account-export-dialog__notice { margin: 12px 0 0; padding: 9px 11px; border-radius: 6px; font-size: 12px; line-height: 1.5; }
.account-export-dialog__cpa-note { color: var(--info); border: 1px solid var(--cyan-border); background: var(--cyan-subtle); }
.account-export-dialog__notice { color: var(--warning); border: 1px solid var(--warning-border); background: var(--warning-subtle); }
.account-export-dialog__validation { margin: 10px 0 0; color: var(--danger); font-size: 12px; line-height: 1.5; }
.account-dialog__error { margin: 14px 0 0; padding: 10px 12px; color: var(--danger); border: 1px solid var(--danger-border); border-radius: 6px; background: var(--danger-subtle); font-size: 13px; line-height: 1.5; }
.account-dialog__actions { display: flex; gap: 8px; margin-top: 20px; }
.account-dialog__actions--end { justify-content: flex-end; }
@media (max-width: 440px) { .account-dialog-backdrop { align-items: end; padding: 12px; } .account-dialog { padding: 17px; } .account-export-dialog__metadata div { grid-template-columns: 1fr; gap: 2px; } }
</style>
