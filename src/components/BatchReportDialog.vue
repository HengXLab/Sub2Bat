<script setup lang="ts">
import { ChevronDown, FileDown, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import ExportDirectoryField from "./ExportDirectoryField.vue";
import ExportFileNameField from "./ExportFileNameField.vue";
import { DEFAULT_REPORT_COLUMNS, REPORT_COLUMN_OPTIONS } from "../lib/batchReport";
import type { ReportColumnId } from "../lib/batchReport";
import { readVisibleAccountTableColumnIds } from "../lib/accountTableColumns";
import { formatExportFileName } from "../lib/exportFile";

const REPORT_PREFERENCES_KEY = "sub2bat.batch-report.preferences.v1";
const DEFAULT_FILE_NAME_TEMPLATE = "批量测活-{datetime}-{count}";

interface ReportPreferences {
  columns: ReportColumnId[];
  fileNameTemplate: string;
}

const props = withDefaults(defineProps<{
  open: boolean;
  selectedCount: number;
  directory?: string;
  busy?: boolean;
  testing?: boolean;
  error?: string | null;
}>(), {
  directory: "",
  busy: false,
  testing: false,
  error: null,
});

const emit = defineEmits<{
  cancel: [];
  cancelTest: [];
  pickDirectory: [];
  generate: [payload: { columns: string[]; fileName: string; testBeforeExport: boolean }];
}>();

const selectedColumns = ref<ReportColumnId[]>([...DEFAULT_REPORT_COLUMNS]);
const fileNameTemplate = ref(DEFAULT_FILE_NAME_TEMPLATE);
const exportTimestamp = ref(new Date());
const fieldsExpanded = ref(false);
const testBeforeExport = ref(false);

const allSelected = computed(() => selectedColumns.value.length === REPORT_COLUMN_OPTIONS.length);
const resolvedFileName = computed(() => formatExportFileName(fileNameTemplate.value, {
  count: props.selectedCount,
  format: "xlsx",
  extension: "xlsx",
  timestamp: exportTimestamp.value,
}));
const canGenerate = computed(() => (
  props.selectedCount > 0
  && selectedColumns.value.length > 0
  && fileNameTemplate.value.trim().length > 0
  && props.directory.trim().length > 0
  && !props.busy
));

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    const preferences = readReportPreferences();
    selectedColumns.value = preferences.columns;
    fileNameTemplate.value = preferences.fileNameTemplate;
    exportTimestamp.value = new Date();
    fieldsExpanded.value = false;
    testBeforeExport.value = false;
  },
);

watch(fileNameTemplate, () => {
  persistCurrentPreferences();
});

function toggleColumn(columnId: ReportColumnId, checked: boolean) {
  const next = new Set(selectedColumns.value);
  if (checked) next.add(columnId);
  else next.delete(columnId);
  selectedColumns.value = normalizeReportColumns([...next]);
  persistCurrentPreferences();
}

function toggleAll() {
  selectedColumns.value = allSelected.value ? [] : REPORT_COLUMN_OPTIONS.map((column) => column.id);
  persistCurrentPreferences();
}

function submit() {
  if (!canGenerate.value) return;
  persistCurrentPreferences();
  exportTimestamp.value = new Date();
  emit("generate", {
    columns: [...selectedColumns.value],
    fileName: resolvedFileName.value,
    testBeforeExport: testBeforeExport.value,
  });
}

function readReportPreferences(): ReportPreferences {
  const fallback: ReportPreferences = {
    columns: defaultReportColumns(),
    fileNameTemplate: DEFAULT_FILE_NAME_TEMPLATE,
  };
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(REPORT_PREFERENCES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(parsed)) return fallback;

    const columns = Array.isArray(parsed.columns) ? normalizeReportColumns(parsed.columns) : fallback.columns;
    const fileNameTemplate = typeof parsed.fileNameTemplate === "string" && parsed.fileNameTemplate.trim()
      ? parsed.fileNameTemplate
      : fallback.fileNameTemplate;
    return {
      columns: columns.length ? columns : fallback.columns,
      fileNameTemplate,
    };
  } catch {
    return fallback;
  }
}

function persistCurrentPreferences() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(REPORT_PREFERENCES_KEY, JSON.stringify({
      columns: selectedColumns.value,
      fileNameTemplate: fileNameTemplate.value,
    } satisfies ReportPreferences));
  } catch {
    // Preferences cannot be restored after this dialog is closed when storage is unavailable.
  }
}

function defaultReportColumns(): ReportColumnId[] {
  const fromTable = readVisibleAccountTableColumnIds();
  const columns = normalizeReportColumns([...fromTable, "testTime"]);
  return columns.length ? columns : [...DEFAULT_REPORT_COLUMNS];
}

function normalizeReportColumns(columns: readonly unknown[]): ReportColumnId[] {
  const requested = new Set(columns.filter((column): column is string => typeof column === "string"));
  return REPORT_COLUMN_OPTIONS.map((column) => column.id).filter((columnId) => requested.has(columnId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
</script>

<template>
  <div v-if="open" class="account-dialog-backdrop">
    <section class="account-dialog report-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-report-title" @keydown.esc="!busy && emit('cancel')">
      <header class="account-dialog__header">
        <div class="account-dialog__title">
          <span class="account-dialog__icon account-dialog__icon--report"><FileDown :size="20" aria-hidden="true" /></span>
          <div>
            <h2 id="batch-report-title">批量测活报告</h2>
            <p>为 {{ selectedCount }} 个已选账号导出 Excel 测活报告。</p>
          </div>
        </div>
        <button class="account-dialog__close" type="button" title="关闭" aria-label="关闭" :disabled="busy" @click="emit('cancel')">
          <X :size="18" />
        </button>
      </header>

      <ExportFileNameField
        v-model="fileNameTemplate"
        :count="selectedCount"
        format="xlsx"
        extension="xlsx"
        :timestamp="exportTimestamp"
        :disabled="busy"
        hint="选择保存目录后，报告会按此文件名直接导出。"
      />

      <section class="report-dialog__columns" aria-labelledby="report-columns-title">
        <div class="report-dialog__columns-heading">
          <button
            id="report-columns-title"
            class="report-dialog__columns-toggle"
            type="button"
            :disabled="busy"
            :aria-expanded="fieldsExpanded"
            aria-controls="report-column-list"
            @click="fieldsExpanded = !fieldsExpanded"
          >
            <span>
              <strong>报告内容</strong>
              <small>已保存 {{ selectedColumns.length }} 项，下次导出将沿用此配置</small>
            </span>
            <ChevronDown :size="17" :class="{ 'report-dialog__chevron--expanded': fieldsExpanded }" aria-hidden="true" />
          </button>
          <button v-if="fieldsExpanded" class="report-dialog__toggle-all" type="button" :disabled="busy" @click="toggleAll">
            {{ allSelected ? "取消全选" : "全选" }}
          </button>
        </div>
        <div v-if="fieldsExpanded" id="report-column-list" class="report-dialog__column-list">
          <label v-for="column in REPORT_COLUMN_OPTIONS" :key="column.id" class="report-dialog__column-option">
            <input
              type="checkbox"
              :checked="selectedColumns.includes(column.id)"
              :disabled="busy"
              @change="toggleColumn(column.id, ($event.target as HTMLInputElement).checked)"
            />
            <span>
              <strong>{{ column.label }}</strong>
              <small>{{ column.description }}</small>
            </span>
          </label>
        </div>
      </section>

      <label class="report-dialog__test-option">
        <input v-model="testBeforeExport" type="checkbox" :disabled="busy" />
        <span>
          <strong>导出前进行测试</strong>
          <small>按当前测试模型和并发先测试这 {{ selectedCount }} 个账号，再使用本次测试结果生成报告。</small>
        </span>
      </label>

      <ExportDirectoryField :directory="directory" :disabled="busy" @pick="emit('pickDirectory')" />

      <p v-if="selectedColumns.length === 0" class="report-dialog__validation" role="alert">请至少选择一项报告内容。</p>
      <p v-else-if="!fileNameTemplate.trim()" class="report-dialog__validation" role="alert">请输入文件名称模板。</p>
      <p v-else-if="!directory.trim()" class="report-dialog__validation" role="alert">请先选择保存目录。</p>
      <p v-if="error" class="account-dialog__error" role="alert">{{ error }}</p>

      <footer class="account-dialog__actions account-dialog__actions--end">
        <button v-if="testing" class="button button--secondary" type="button" @click="emit('cancelTest')">取消测试</button>
        <button v-else class="button button--secondary" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
        <button class="button button--primary" type="button" :disabled="!canGenerate" @click="submit">
          {{ testing ? "正在测试..." : busy ? "正在导出..." : "导出" }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.account-dialog-backdrop { position: fixed; z-index: 30; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: var(--shadow-lift); }
.account-dialog { width: min(100%, 620px); max-height: var(--dialog-content-max-height); overflow-y: auto; padding: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.account-dialog__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.account-dialog__title { display: flex; align-items: flex-start; gap: 11px; min-width: 0; }
.account-dialog__title h2 { margin: 1px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.account-dialog__title p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.account-dialog__icon { display: inline-grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px; border-radius: 7px; }
.account-dialog__icon--report { color: var(--plan-text); background: var(--plan-bg); }
.account-dialog__close { display: inline-grid; flex: 0 0 auto; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.account-dialog__close:hover:not(:disabled) { color: var(--ink); background: var(--surface-hover); }
.report-dialog__columns { margin-top: 16px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.report-dialog__columns-heading { display: flex; align-items: stretch; justify-content: space-between; min-height: 54px; gap: 10px; background: var(--surface-subtle); }
.report-dialog__columns-toggle { display: flex; flex: 1 1 auto; align-items: center; justify-content: space-between; min-width: 0; padding: 9px 12px; gap: 12px; color: var(--text); background: transparent; text-align: left; cursor: pointer; }
.report-dialog__columns-toggle:hover:not(:disabled) { background: var(--surface-hover); }
.report-dialog__columns-toggle:disabled { cursor: not-allowed; opacity: 0.58; }
.report-dialog__columns-toggle > span { display: grid; min-width: 0; gap: 2px; }
.report-dialog__columns-toggle strong { color: var(--text); font-size: 13px; }
.report-dialog__columns-toggle small { overflow: hidden; color: var(--muted); font-size: 12px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.report-dialog__columns-toggle svg { flex: 0 0 auto; color: var(--muted); transition: transform 0.15s ease; }
.report-dialog__chevron--expanded { transform: rotate(180deg); }
.report-dialog__toggle-all { flex: 0 0 auto; align-self: center; padding: 4px 12px 4px 0; color: var(--brand); background: transparent; font-size: 12px; font-weight: 650; cursor: pointer; }
.report-dialog__toggle-all:hover:not(:disabled) { color: var(--brand-hover); text-decoration: underline; }
.report-dialog__toggle-all:disabled { opacity: 0.48; cursor: not-allowed; }
.report-dialog__column-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--divider); }
.report-dialog__column-option { display: flex; align-items: flex-start; min-width: 0; min-height: 58px; padding: 10px 12px; gap: 9px; border-bottom: 1px solid var(--divider); color: var(--text); cursor: pointer; }
.report-dialog__column-option:nth-child(odd) { border-right: 1px solid var(--divider); }
.report-dialog__column-option:nth-last-child(-n + 2):nth-child(odd), .report-dialog__column-option:last-child { border-bottom: 0; }
.report-dialog__column-option:hover { background: var(--surface-subtle); }
.report-dialog__column-option input { width: 15px; height: 15px; margin: 2px 0 0; accent-color: var(--brand); }
.report-dialog__column-option span { display: grid; min-width: 0; gap: 2px; }
.report-dialog__column-option strong { color: var(--text); font-size: 13px; line-height: 1.25; }
.report-dialog__column-option small { overflow: hidden; color: var(--muted); font-size: 12px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.report-dialog__test-option { display: flex; align-items: flex-start; margin-top: 16px; padding: 11px 12px; gap: 9px; color: var(--text); border: 1px solid var(--border); border-radius: 6px; background: var(--surface); cursor: pointer; }
.report-dialog__test-option:hover { background: var(--surface-subtle); }
.report-dialog__test-option input { flex: 0 0 auto; width: 15px; height: 15px; margin: 2px 0 0; accent-color: var(--brand); }
.report-dialog__test-option span { display: grid; min-width: 0; gap: 2px; }
.report-dialog__test-option strong { color: var(--text); font-size: 13px; line-height: 1.35; }
.report-dialog__test-option small { color: var(--muted); font-size: 12px; line-height: 1.45; }
.report-dialog__validation { margin: 12px 0 0; color: var(--danger); font-size: 12px; line-height: 1.5; }
.account-dialog__error { margin: 14px 0 0; padding: 10px 12px; color: var(--danger); border: 1px solid var(--danger-border); border-radius: 6px; background: var(--danger-subtle); font-size: 13px; line-height: 1.5; }
.account-dialog__actions { display: flex; gap: 8px; margin-top: 20px; }
.account-dialog__actions--end { justify-content: flex-end; }
@media (max-width: 440px) { .account-dialog-backdrop { align-items: end; padding: 12px; } .account-dialog { padding: 17px; } .report-dialog__column-list { grid-template-columns: 1fr; } .report-dialog__column-option:nth-child(odd) { border-right: 0; } .report-dialog__column-option:nth-last-child(-n + 2):nth-child(odd) { border-bottom: 1px solid var(--divider); } .report-dialog__column-option:last-child { border-bottom: 0; } }
</style>
