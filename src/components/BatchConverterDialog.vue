<script setup lang="ts">
import { ArrowLeftRight, ChevronLeft, ChevronRight, ClipboardPaste, FileDown, FolderInput, FolderOpen, Trash2, Upload, X } from "@lucide/vue";
import { computed, reactive, ref, watch } from "vue";
import {
  buildMergedSub2apiDocument,
  buildPastedInputItems,
  conversionTimestampedFileName,
  convertCpaRecord,
  convertSub2apiDocument,
  createConversionZip,
  MAX_CONVERSION_RECORDS,
  parsePastedJsonDocuments,
  type AccountConversionMode,
  type ConversionIssue,
  type ConversionRecord,
} from "../lib/accountConversion";
import {
  chooseDirectoryAndWriteFiles,
  chooseJsonDirectory,
  chooseJsonFiles,
  MAX_LOCAL_JSON_FILE_BYTES,
  MAX_LOCAL_JSON_FILES,
  MAX_LOCAL_JSON_TOTAL_BYTES,
  type LocalJsonSource,
} from "../lib/conversionFilePicker";
import { getExportFileName, saveExportFile } from "../lib/exportFile";

const props = withDefaults(defineProps<{
  open: boolean;
}>(), {});

const emit = defineEmits<{
  cancel: [];
}>();

interface ConversionPageState {
  seenKeys: Set<string>;
  totalImported: number;
  converted: ConversionRecord[];
  skipped: ConversionIssue[];
  skippedTotal: number;
  skippedTruncated: boolean;
  resultPage: number;
}

const RESULT_PAGE_SIZE = 10;
const DROP_FILE_READ_CONCURRENCY = 4;
const DROP_FILE_SCAN_LIMIT = MAX_LOCAL_JSON_FILES * 4;
const MAX_CONVERSION_ISSUES = 2_000;
const MAX_CONVERSION_INPUTS = MAX_CONVERSION_RECORDS + MAX_CONVERSION_ISSUES;
const mode = ref<AccountConversionMode>("cpaToSub2api");
const importMethod = ref<"files" | "paste">("files");
const pasteInput = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const dragActive = ref(false);
const pages = reactive<Record<AccountConversionMode, ConversionPageState>>({
  cpaToSub2api: createPageState(),
  sub2apiToCpa: createPageState(),
});

const currentPage = computed(() => pages[mode.value]);
const converted = computed(() => currentPage.value.converted);
const skipped = computed(() => currentPage.value.skipped);
const resultPageCount = computed(() => Math.max(1, Math.ceil(converted.value.length / RESULT_PAGE_SIZE)));
const resultPage = computed(() => clampResultPage(currentPage.value.resultPage, resultPageCount.value));
const pagedConverted = computed(() => {
  const start = (resultPage.value - 1) * RESULT_PAGE_SIZE;
  return converted.value.slice(start, start + RESULT_PAGE_SIZE);
});
const resultPageRange = computed(() => {
  if (!converted.value.length) return "0 / 0";
  const from = (resultPage.value - 1) * RESULT_PAGE_SIZE + 1;
  return `${from}-${Math.min(from + RESULT_PAGE_SIZE - 1, converted.value.length)} / ${converted.value.length}`;
});
const cpaToSub2api = computed(() => mode.value === "cpaToSub2api");
const importTitle = computed(() => (cpaToSub2api.value ? "导入 CPA 文件" : "导入 Sub2API 配置"));
const importDescription = computed(() => (
  cpaToSub2api.value
    ? "支持多个 CPA JSON 文件和目录，兼容 Codex、Claude、Antigravity、Gemini。"
    : "支持单账号文件、账号数组和包含 accounts 的官方备份 JSON。"
));
const dropTitle = computed(() => (cpaToSub2api.value ? "拖拽 CPA JSON 到这里" : "拖拽 Sub2API JSON 到这里"));
const resultTitle = computed(() => (cpaToSub2api.value ? "Sub2API 结果" : "CPA 结果"));
const individualExportLabel = computed(() => {
  if (cpaToSub2api.value && converted.value.length > 3) return "导出 Sub2API ZIP";
  return cpaToSub2api.value ? "选择目录导出 Sub2API" : "选择目录导出 CPA";
});
const mergedExportLabel = computed(() => (cpaToSub2api.value ? "导出合并 Sub2API JSON" : "导出 CPA ZIP 包"));
const summary = computed(() => {
  if (!currentPage.value.totalImported) return "尚未导入内容。";
  const issueNote = currentPage.value.skippedTruncated ? `（仅保留前 ${MAX_CONVERSION_ISSUES.toLocaleString()} 条详情）` : "";
  return `已读取 ${currentPage.value.totalImported} 项，成功转换 ${converted.value.length} 项，跳过 ${currentPage.value.skippedTotal} 项${issueNote}。`;
});
const canExport = computed(() => converted.value.length > 0 && !busy.value);

function createPageState(): ConversionPageState {
  return {
    seenKeys: new Set<string>(),
    totalImported: 0,
    converted: [],
    skipped: [],
    skippedTotal: 0,
    skippedTruncated: false,
    resultPage: 1,
  };
}

watch(
  () => props.open,
  (open, wasOpen) => {
    if (open || !wasOpen || busy.value) return;

    // Converted files may contain credentials. Closing the dialog releases
    // both results and de-duplication keys instead of retaining them hidden.
    pages.cpaToSub2api = createPageState();
    pages.sub2apiToCpa = createPageState();
    pasteInput.value = "";
    error.value = null;
    notice.value = null;
    dragActive.value = false;
  },
);

function clampResultPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, Math.trunc(page) || 1), Math.max(1, pageCount));
}

function setResultPage(page: number) {
  currentPage.value.resultPage = clampResultPage(page, resultPageCount.value);
}

function switchMode(nextMode: AccountConversionMode) {
  if (busy.value || mode.value === nextMode) return;
  mode.value = nextMode;
  error.value = null;
  notice.value = null;
  pasteInput.value = "";
}

function switchImportMethod(nextMethod: "files" | "paste") {
  if (busy.value) return;
  importMethod.value = nextMethod;
  error.value = null;
  notice.value = null;
}

async function importFiles() {
  if (busy.value) return;
  const targetMode = mode.value;
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    const sources = await chooseJsonFiles(targetMode === "cpaToSub2api" ? "选择 CPA JSON 文件" : "选择 Sub2API JSON 文件");
    await processSources(sources, targetMode);
  } catch (cause) {
    error.value = `读取文件失败：${readableError(cause)}`;
  } finally {
    busy.value = false;
  }
}

async function importDirectory() {
  if (busy.value) return;
  const targetMode = mode.value;
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    const sources = await chooseJsonDirectory(targetMode === "cpaToSub2api" ? "选择 CPA 文件夹" : "选择 Sub2API 文件夹");
    await processSources(sources, targetMode);
  } catch (cause) {
    error.value = `读取文件夹失败：${readableError(cause)}`;
  } finally {
    busy.value = false;
  }
}

async function handleDrop(event: DragEvent) {
  dragActive.value = false;
  if (busy.value) return;
  const dropped = collectDroppedJsonFiles(event.dataTransfer?.files);
  if (!dropped.files.length) {
    error.value = dropped.truncated
      ? `拖入文件过多，本次最多检查前 ${DROP_FILE_SCAN_LIMIT.toLocaleString()} 个文件。请只拖入 JSON 文件。`
      : "请拖入 JSON 文件。";
    return;
  }

  const targetMode = mode.value;
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    const sources = await readDroppedJsonFiles(dropped.files);
    if (dropped.truncated) {
      sources.push({
        sourceName: "拖入文件",
        error: `拖入文件超过安全检查范围，本次只读取前 ${MAX_LOCAL_JSON_FILES.toLocaleString()} 个 JSON 文件。`,
      });
    }
    await processSources(sources, targetMode);
  } catch (cause) {
    error.value = `读取拖入文件失败：${readableError(cause)}`;
  } finally {
    busy.value = false;
  }
}

function convertPasted() {
  if (busy.value) return;
  const text = pasteInput.value;
  if (!text.trim()) {
    error.value = "请先粘贴一个或多个 JSON。";
    return;
  }

  const targetMode = mode.value;
  const page = pages[targetMode];
  const parsed = parsePastedJsonDocuments(text);
  const items = buildPastedInputItems(parsed.documents, targetMode);
  const appended = { converted: 0, skipped: 0 };
  let skippedForInputLimit = 0;

  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    for (const issue of parsed.issues) {
      if (!reserveInput(page)) {
        skippedForInputLimit += 1;
        continue;
      }
      appendIssue(page, issue);
      appended.skipped += 1;
    }
    const omittedParsedIssues = Math.max(0, parsed.issueCount - parsed.issues.length);
    if (omittedParsedIssues) {
      appendIssue(
        page,
        {
          sourceName: "粘贴内容",
          reason: `另有 ${omittedParsedIssues.toLocaleString()} 条解析问题未保留详情。`,
        },
        omittedParsedIssues,
      );
      page.skippedTruncated = page.skippedTruncated || parsed.issuesTruncated;
      appended.skipped += omittedParsedIssues;
    }

    for (const item of items) {
      if (!reserveInput(page)) {
        skippedForInputLimit += 1;
        continue;
      }
      if (page.converted.length >= MAX_CONVERSION_RECORDS) {
        appendIssue(page, { sourceName: item.sourceName, reason: `已达到 ${MAX_CONVERSION_RECORDS.toLocaleString()} 个转换结果上限。` });
        appended.skipped += 1;
        continue;
      }
      const serialized = JSON.stringify(item.document) ?? String(item.document);
      const key = `paste|${targetMode}|${fingerprintText(serialized)}`;
      if (page.seenKeys.has(key)) {
        appendIssue(page, { sourceName: item.sourceName, reason: "重复导入，已忽略。" });
        appended.skipped += 1;
        continue;
      }
      if (page.seenKeys.size < MAX_CONVERSION_INPUTS) page.seenKeys.add(key);
      try {
        const result = convertDocument(item.document, item.sourceName, targetMode);
        const accepted = takeWithinConversionLimit(page.converted, result.converted);
        page.converted.push(...accepted.records);
        appendIssues(page, result.skipped);
        appended.converted += accepted.records.length;
        appended.skipped += result.skipped.length + accepted.skipped;
        if (accepted.skipped) {
          appendIssue(page, { sourceName: item.sourceName, reason: `超过 ${MAX_CONVERSION_RECORDS.toLocaleString()} 个转换结果上限的项目已跳过。` });
        }
      } catch (cause) {
        appendIssue(page, { sourceName: item.sourceName, reason: readableError(cause) });
        appended.skipped += 1;
      }
    }

    if (skippedForInputLimit) {
      appendIssue(page, { sourceName: "本次导入", reason: `已达到 ${MAX_CONVERSION_INPUTS.toLocaleString()} 项导入上限，其余 ${skippedForInputLimit.toLocaleString()} 项未处理。` }, skippedForInputLimit);
      appended.skipped += skippedForInputLimit;
    }

    notice.value = `本次读取 ${items.length} 项，成功转换 ${appended.converted} 项，跳过 ${appended.skipped} 项。`;
    if (!appended.skipped) pasteInput.value = "";
  } finally {
    busy.value = false;
  }
}

async function processSources(sources: readonly LocalJsonSource[], targetMode: AccountConversionMode) {
  if (!sources.length) return;

  const page = pages[targetMode];
  const appended = { converted: 0, skipped: 0 };
  let skippedForInputLimit = 0;

  for (const source of sources) {
    if (!reserveInput(page)) {
      skippedForInputLimit += 1;
      continue;
    }
    if (page.converted.length >= MAX_CONVERSION_RECORDS) {
      appendIssue(page, { sourceName: source.sourceName, reason: `已达到 ${MAX_CONVERSION_RECORDS.toLocaleString()} 个转换结果上限。` });
      appended.skipped += 1;
      continue;
    }
    const key = `file|${targetMode}|${source.sourceName}|${fingerprintText(source.text ?? source.error ?? "")}`;
    if (page.seenKeys.has(key)) {
      appendIssue(page, { sourceName: source.sourceName, reason: "重复导入，已忽略。" });
      appended.skipped += 1;
      continue;
    }
    if (page.seenKeys.size < MAX_CONVERSION_INPUTS) page.seenKeys.add(key);

    if (source.error || source.text === undefined) {
      appendIssue(page, { sourceName: source.sourceName, reason: source.error || "无法读取文件。" });
      appended.skipped += 1;
      continue;
    }

    try {
      const document = JSON.parse(source.text) as unknown;
      const result = convertDocument(document, source.sourceName, targetMode);
      const accepted = takeWithinConversionLimit(page.converted, result.converted);
      page.converted.push(...accepted.records);
      appendIssues(page, result.skipped);
      appended.converted += accepted.records.length;
      appended.skipped += result.skipped.length + accepted.skipped;
      if (accepted.skipped) {
        appendIssue(page, { sourceName: source.sourceName, reason: `超过 ${MAX_CONVERSION_RECORDS.toLocaleString()} 个转换结果上限的项目已跳过。` });
      }
    } catch (cause) {
      appendIssue(page, { sourceName: source.sourceName, reason: readableError(cause) });
      appended.skipped += 1;
    }
  }

  if (skippedForInputLimit) {
    appendIssue(page, { sourceName: "本次导入", reason: `已达到 ${MAX_CONVERSION_INPUTS.toLocaleString()} 项导入上限，其余 ${skippedForInputLimit.toLocaleString()} 项未处理。` }, skippedForInputLimit);
    appended.skipped += skippedForInputLimit;
  }

  notice.value = `本次读取 ${sources.length} 个文件，成功转换 ${appended.converted} 项，跳过 ${appended.skipped} 项。`;
}

function convertDocument(document: unknown, sourceName: string, targetMode: AccountConversionMode): { converted: ConversionRecord[]; skipped: ConversionIssue[] } {
  if (targetMode === "cpaToSub2api") {
    return {
      converted: [convertCpaRecord(document, { sourceName })],
      skipped: [],
    };
  }
  return convertSub2apiDocument(document, { sourceName });
}

function clearResults() {
  if (busy.value) return;
  pages[mode.value] = createPageState();
  error.value = null;
  notice.value = null;
}

function reserveInput(page: ConversionPageState): boolean {
  if (page.totalImported >= MAX_CONVERSION_INPUTS) return false;
  page.totalImported += 1;
  return true;
}

function appendIssues(page: ConversionPageState, issues: readonly ConversionIssue[]) {
  for (const issue of issues) appendIssue(page, issue);
}

function appendIssue(page: ConversionPageState, issue: ConversionIssue, total = 1) {
  page.skippedTotal += total;
  if (page.skipped.length < MAX_CONVERSION_ISSUES) {
    page.skipped.push(issue);
  } else {
    page.skippedTruncated = true;
  }
}

// Store a compact fingerprint rather than the imported JSON, which can include
// credentials and may be many megabytes long.
function fingerprintText(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${value.length}:${first.toString(16)}:${second.toString(16)}`;
}

async function exportIndividualRecords() {
  if (!canExport.value) return;
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    if (mode.value === "cpaToSub2api" && converted.value.length > 3) {
      const savedPath = await saveExportFile({
        title: "保存 Sub2API 转换结果 ZIP",
        fileName: conversionTimestampedFileName("sub2api", "zip"),
        extension: "zip",
        filterName: "Sub2API 转换结果 ZIP",
        contents: createConversionZip(converted.value),
      });
      if (savedPath) notice.value = `已导出 ${converted.value.length} 项：${getExportFileName(savedPath)}`;
      return;
    }

    const directory = await chooseDirectoryAndWriteFiles(
      mode.value === "cpaToSub2api" ? "选择 Sub2API 转换结果保存目录" : "选择 CPA 转换结果保存目录",
      converted.value.map((item) => ({
        fileName: item.outputFileName,
        contents: `${JSON.stringify(item.document, null, 2)}\n`,
      })),
    );
    if (directory) notice.value = `已导出 ${converted.value.length} 项到所选目录。`;
  } catch (cause) {
    error.value = `导出失败：${readableError(cause)}`;
  } finally {
    busy.value = false;
  }
}

async function exportMergedResult() {
  if (!canExport.value) return;
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    const cpaToSub2apiMode = mode.value === "cpaToSub2api";
    const savedPath = await saveExportFile({
      title: cpaToSub2apiMode ? "保存合并 Sub2API 配置" : "保存 CPA ZIP 包",
      fileName: conversionTimestampedFileName(cpaToSub2apiMode ? "sub2api" : "cpa", cpaToSub2apiMode ? "json" : "zip"),
      extension: cpaToSub2apiMode ? "json" : "zip",
      filterName: cpaToSub2apiMode ? "Sub2API JSON" : "CPA ZIP 包",
      contents: cpaToSub2apiMode
        ? `${JSON.stringify(buildMergedSub2apiDocument(converted.value), null, 2)}\n`
        : createConversionZip(converted.value),
    });
    if (savedPath) notice.value = `已导出：${getExportFileName(savedPath)}`;
  } catch (cause) {
    error.value = `导出失败：${readableError(cause)}`;
  } finally {
    busy.value = false;
  }
}

async function exportSingleRecord(record: ConversionRecord) {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    const savedPath = await saveExportFile({
      title: "保存转换结果",
      fileName: record.outputFileName,
      extension: "json",
      filterName: "JSON 文件",
      contents: `${JSON.stringify(record.document, null, 2)}\n`,
    });
    if (savedPath) notice.value = `已导出：${getExportFileName(savedPath)}`;
  } catch (cause) {
    error.value = `导出失败：${readableError(cause)}`;
  } finally {
    busy.value = false;
  }
}

function sourceLabel(record: ConversionRecord): string {
  const source = record.sourceName.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return record.entryLabel ? `${source || "未命名文件"} · ${record.entryLabel}` : source || "未命名文件";
}

function formatDate(value: string | undefined): string {
  if (!value) return "未提供";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function readableError(cause: unknown): string {
  return cause instanceof Error ? cause.message : "操作未完成。";
}

function takeWithinConversionLimit(existing: readonly ConversionRecord[], incoming: readonly ConversionRecord[]) {
  const remaining = Math.max(0, MAX_CONVERSION_RECORDS - existing.length);
  return {
    records: incoming.slice(0, remaining),
    skipped: Math.max(0, incoming.length - remaining),
  };
}

async function readDroppedJsonFiles(files: readonly File[]): Promise<LocalJsonSource[]> {
  const boundedFiles = files.slice(0, MAX_LOCAL_JSON_FILES);
  const results: Array<LocalJsonSource | undefined> = new Array(boundedFiles.length);
  let totalBytes = 0;
  const readable: Array<{ index: number; file: File }> = [];

  for (const [index, file] of boundedFiles.entries()) {
    const sourceName = file.webkitRelativePath || file.name;
    if (file.size > MAX_LOCAL_JSON_FILE_BYTES) {
      results[index] = { sourceName, error: `文件超过单文件 ${formatMegabytes(MAX_LOCAL_JSON_FILE_BYTES)} MB 上限，已跳过。` };
      continue;
    }
    if (totalBytes + file.size > MAX_LOCAL_JSON_TOTAL_BYTES) {
      results[index] = { sourceName, error: `已达到单次导入 ${formatMegabytes(MAX_LOCAL_JSON_TOTAL_BYTES)} MB 总大小上限，已跳过。` };
      continue;
    }
    totalBytes += file.size;
    readable.push({ index, file });
  }

  await runWithConcurrency(readable, DROP_FILE_READ_CONCURRENCY, async ({ index, file }) => {
    const sourceName = file.webkitRelativePath || file.name;
    try {
      results[index] = { sourceName, text: await file.text() };
    } catch (cause) {
      results[index] = { sourceName, error: readableError(cause) };
    }
  });

  const sources = results.filter((result): result is LocalJsonSource => Boolean(result));
  if (files.length > boundedFiles.length) {
    sources.push({
      sourceName: "拖入文件",
      error: `已超过单次 ${MAX_LOCAL_JSON_FILES.toLocaleString()} 个文件的读取上限，其余 ${(files.length - boundedFiles.length).toLocaleString()} 个文件未读取。`,
    });
  }
  return sources;
}

function collectDroppedJsonFiles(fileList: FileList | null | undefined): { files: File[]; truncated: boolean } {
  const files: File[] = [];
  const total = fileList?.length ?? 0;
  const scanLimit = Math.min(total, DROP_FILE_SCAN_LIMIT);

  for (let index = 0; index < scanLimit; index += 1) {
    const file = fileList?.item(index);
    if (!file || !file.name.toLocaleLowerCase().endsWith(".json")) continue;
    files.push(file);
    if (files.length >= MAX_LOCAL_JSON_FILES) {
      return { files, truncated: index + 1 < total };
    }
  }

  return { files, truncated: total > scanLimit };
}

async function runWithConcurrency<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }));
}

function formatMegabytes(bytes: number) {
  return Math.round(bytes / (1024 * 1024));
}
</script>

<template>
  <div v-if="props.open" class="converter-dialog-backdrop">
    <section class="converter-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-converter-title" @keydown.esc="!busy && emit('cancel')">
      <header class="converter-dialog__header">
        <div class="converter-dialog__title">
          <span class="converter-dialog__icon"><ArrowLeftRight :size="20" aria-hidden="true" /></span>
          <div>
            <h2 id="batch-converter-title">本地文件转换</h2>
          </div>
        </div>
        <button class="converter-dialog__close" type="button" title="关闭" aria-label="关闭" :disabled="busy" @click="emit('cancel')">
          <X :size="18" />
        </button>
      </header>

      <div class="converter-dialog__mode" role="tablist" aria-label="转换方向">
        <button class="converter-dialog__mode-button" type="button" :class="{ 'is-active': mode === 'cpaToSub2api' }" :disabled="busy" role="tab" :aria-selected="mode === 'cpaToSub2api'" @click="switchMode('cpaToSub2api')">
          CPA -&gt; Sub2API
        </button>
        <button class="converter-dialog__mode-button" type="button" :class="{ 'is-active': mode === 'sub2apiToCpa' }" :disabled="busy" role="tab" :aria-selected="mode === 'sub2apiToCpa'" @click="switchMode('sub2apiToCpa')">
          Sub2API -&gt; CPA
        </button>
      </div>

      <div class="converter-dialog__workspace">
        <section class="converter-dialog__import" aria-labelledby="converter-import-title">
          <div class="converter-dialog__section-heading">
            <div>
              <h3 id="converter-import-title">{{ importTitle }}</h3>
              <p>{{ importDescription }}</p>
            </div>
          </div>

          <div class="converter-dialog__import-tabs" role="tablist" aria-label="导入方式">
            <button class="converter-dialog__import-tab" type="button" :class="{ 'is-active': importMethod === 'files' }" :disabled="busy" role="tab" :aria-selected="importMethod === 'files'" @click="switchImportMethod('files')">
              <Upload :size="15" />
              <span>文件导入</span>
            </button>
            <button class="converter-dialog__import-tab" type="button" :class="{ 'is-active': importMethod === 'paste' }" :disabled="busy" role="tab" :aria-selected="importMethod === 'paste'" @click="switchImportMethod('paste')">
              <ClipboardPaste :size="15" />
              <span>粘贴导入</span>
            </button>
          </div>

          <div v-if="importMethod === 'files'" class="converter-dialog__dropzone" :class="{ 'is-dragging': dragActive }" @dragenter.prevent="dragActive = true" @dragover.prevent="dragActive = true" @dragleave.prevent="dragActive = false" @drop.prevent="handleDrop">
            <Upload :size="24" aria-hidden="true" />
            <strong>{{ dropTitle }}</strong>
            <p>支持拖入多个 JSON 文件；文件夹请使用“选择目录”，不会上传认证数据。</p>
            <div class="converter-dialog__dropzone-actions">
              <button class="button button--secondary" type="button" :disabled="busy" @click="importFiles">
                <FileDown :size="16" />
                <span>选择文件</span>
              </button>
              <button class="button button--secondary" type="button" :disabled="busy" @click="importDirectory">
                <FolderInput :size="16" />
                <span>选择目录</span>
              </button>
            </div>
          </div>

          <div v-else class="converter-dialog__paste">
            <textarea v-model="pasteInput" :disabled="busy" :placeholder="cpaToSub2api ? '粘贴一个或多个 CPA JSON，支持连续 JSON 或 JSONL。' : '粘贴一个或多个 Sub2API JSON，支持连续 JSON 或 JSONL。'"></textarea>
            <div class="converter-dialog__paste-actions">
              <button class="button button--secondary" type="button" :disabled="busy || !pasteInput" @click="pasteInput = ''">清空输入</button>
              <button class="button button--primary" type="button" :disabled="busy || !pasteInput.trim()" @click="convertPasted">解析并转换</button>
            </div>
          </div>
        </section>

        <section class="converter-dialog__results" aria-labelledby="converter-results-title">
          <div class="converter-dialog__section-heading converter-dialog__section-heading--results">
            <div>
              <h3 id="converter-results-title">{{ resultTitle }}</h3>
              <p>{{ summary }}</p>
            </div>
            <button class="icon-button" type="button" title="清空当前方向的结果" aria-label="清空当前方向的结果" :disabled="busy || (!converted.length && !currentPage.skippedTotal)" @click="clearResults">
              <Trash2 :size="17" />
            </button>
          </div>

          <div class="converter-dialog__summary">
            <span><strong>{{ converted.length }}</strong> 成功转换</span>
            <span><strong>{{ currentPage.skippedTotal }}</strong> 跳过项</span>
            <span><strong>4</strong> 种支持平台</span>
          </div>

          <div class="converter-dialog__export-actions">
            <button class="button button--secondary" type="button" :disabled="!canExport" @click="exportIndividualRecords">
              <FolderOpen :size="16" />
              <span>{{ individualExportLabel }}</span>
            </button>
            <button class="button button--primary" type="button" :disabled="!canExport" @click="exportMergedResult">
              <FileDown :size="16" />
              <span>{{ mergedExportLabel }}</span>
            </button>
          </div>

          <div class="converter-dialog__table-wrap">
            <table class="converter-dialog__table">
              <thead>
                <tr>
                  <th>来源</th>
                  <th>平台</th>
                  <th>邮箱</th>
                  <th>过期时间</th>
                  <th>导出</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!converted.length">
                  <td colspan="5" class="converter-dialog__empty">导入后将在这里显示可导出的转换结果。</td>
                </tr>
                <tr v-for="record in pagedConverted" :key="`${record.sourceName}-${record.entryLabel || ''}-${record.outputFileName}`">
                  <td :title="record.sourceName">{{ sourceLabel(record) }}</td>
                  <td><span class="converter-dialog__platform">{{ record.providerLabel }}</span></td>
                  <td :title="record.email || ''">{{ record.email || "未解析到邮箱" }}</td>
                  <td :title="record.expiresAt || ''">{{ formatDate(record.expiresAt) }}</td>
                  <td>
                    <button class="converter-dialog__row-export" type="button" :disabled="busy" @click="exportSingleRecord(record)">导出</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <nav v-if="converted.length" class="converter-dialog__pagination" aria-label="转换结果分页">
            <span class="converter-dialog__pagination-status">显示 {{ resultPageRange }} 项</span>
            <div class="converter-dialog__pagination-controls">
              <button type="button" title="上一页" aria-label="上一页" :disabled="resultPage === 1" @click="setResultPage(resultPage - 1)">
                <ChevronLeft :size="16" aria-hidden="true" />
              </button>
              <span>第 {{ resultPage }} / {{ resultPageCount }} 页</span>
              <button type="button" title="下一页" aria-label="下一页" :disabled="resultPage === resultPageCount" @click="setResultPage(resultPage + 1)">
                <ChevronRight :size="16" aria-hidden="true" />
              </button>
            </div>
          </nav>

          <section class="converter-dialog__issues" aria-labelledby="converter-issues-title">
            <div class="converter-dialog__issues-heading">
              <h4 id="converter-issues-title">跳过 / 错误</h4>
              <span v-if="currentPage.skippedTotal">共 {{ currentPage.skippedTotal }} 项{{ currentPage.skippedTruncated ? "（仅显示部分）" : "" }}</span>
            </div>
            <p v-if="!skipped.length">暂无问题。</p>
            <ul v-else>
              <li v-for="(issue, index) in skipped" :key="`${issue.sourceName}-${issue.entryLabel || ''}-${index}`">
                <strong>{{ issue.entryLabel ? `${issue.sourceName} · ${issue.entryLabel}` : issue.sourceName }}</strong>
                <span>{{ issue.reason }}</span>
              </li>
            </ul>
          </section>
        </section>
      </div>

      <p v-if="notice" class="converter-dialog__notice" role="status">{{ notice }}</p>
      <p v-if="error" class="converter-dialog__error" role="alert">{{ error }}</p>
    </section>
  </div>
</template>

<style scoped>
.converter-dialog-backdrop { position: fixed; z-index: 30; inset: var(--window-titlebar-height) 0 0; display: grid; overflow: hidden; place-items: center; padding: var(--dialog-backdrop-padding); background: color-mix(in srgb, var(--ink) 42%, transparent); }
.converter-dialog { box-sizing: border-box; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto auto; width: min(100%, 1060px); height: min(900px, var(--dialog-content-max-height)); overflow: hidden; padding: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.converter-dialog__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.converter-dialog__title { display: flex; align-items: flex-start; gap: 11px; min-width: 0; }
.converter-dialog__icon { display: inline-grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px; border-radius: 7px; color: var(--magenta); background: var(--brand-subtle); }
.converter-dialog__title h2 { margin: 5px 0; color: var(--heading); font-size: 16px; line-height: 1.35; }
.converter-dialog__close { display: inline-grid; flex: 0 0 auto; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.converter-dialog__close:hover:not(:disabled) { color: var(--ink); background: var(--surface-hover); }
.converter-dialog__mode { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 16px; padding: 3px; gap: 3px; border: 1px solid var(--border); border-radius: 7px; background: var(--canvas); }
.converter-dialog__mode-button { min-height: 36px; border-radius: 5px; color: var(--muted); background: transparent; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.converter-dialog__mode-button.is-active { color: var(--brand-ink); background: var(--surface); box-shadow: 0 1px 3px var(--shadow); }
.converter-dialog__mode-button:disabled { opacity: 0.5; cursor: not-allowed; }
.converter-dialog__workspace { display: grid; grid-template-columns: minmax(260px, 0.74fr) minmax(0, 1.26fr); min-height: 0; margin-top: 16px; gap: 20px; overflow: hidden; }
.converter-dialog__import { min-width: 0; min-height: 0; padding-right: 20px; border-right: 1px solid var(--divider); }
.converter-dialog__results { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.converter-dialog__section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.converter-dialog__section-heading h3, .converter-dialog__issues h4 { margin: 0; color: var(--heading); font-size: 14px; line-height: 1.4; }
.converter-dialog__section-heading p { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
.converter-dialog__import-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 15px; border-bottom: 1px solid var(--divider); }
.converter-dialog__import-tab { display: inline-flex; align-items: center; justify-content: center; min-height: 35px; gap: 6px; color: var(--muted); border-bottom: 2px solid transparent; background: transparent; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
.converter-dialog__import-tab.is-active { color: var(--brand); border-color: var(--brand); }
.converter-dialog__import-tab:disabled { opacity: 0.5; cursor: not-allowed; }
.converter-dialog__dropzone { display: flex; align-items: center; justify-content: center; min-height: 204px; margin-top: 16px; padding: 20px; gap: 8px; border: 1px dashed var(--border-hover); border-radius: 7px; color: var(--muted); background: var(--surface-subtle); text-align: center; flex-direction: column; transition: border-color 0.15s ease, background 0.15s ease; }
.converter-dialog__dropzone.is-dragging { border-color: var(--brand); background: var(--brand-hover-subtle); }
.converter-dialog__dropzone > svg { color: var(--brand); }
.converter-dialog__dropzone strong { color: var(--text-strong); font-size: 13px; }
.converter-dialog__dropzone p { max-width: 260px; margin: 0; font-size: 12px; line-height: 1.5; }
.converter-dialog__dropzone-actions { display: flex; justify-content: center; flex-wrap: wrap; margin-top: 5px; gap: 8px; }
.converter-dialog__dropzone-actions .button { min-height: 34px; padding: 0 10px; font-size: 12px; }
.converter-dialog__paste { margin-top: 16px; }
.converter-dialog__paste textarea { box-sizing: border-box; display: block; width: 100%; min-height: 204px; resize: vertical; padding: 10px; color: var(--text-strong); border: 1px solid var(--control-border); border-radius: 6px; background: var(--surface); font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; outline: 0; }
.converter-dialog__paste textarea:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--focus-soft); }
.converter-dialog__paste-actions { display: flex; justify-content: flex-end; margin-top: 9px; gap: 8px; }
.converter-dialog__paste-actions .button { min-height: 34px; font-size: 12px; }
.converter-dialog__summary { display: flex; align-items: center; flex-wrap: wrap; margin-top: 13px; padding: 9px 10px; gap: 13px; border-top: 1px solid var(--divider); border-bottom: 1px solid var(--divider); color: var(--muted); font-size: 12px; }
.converter-dialog__summary strong { margin-right: 3px; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.converter-dialog__export-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 12px; gap: 8px; }
.converter-dialog__export-actions .button { justify-content: center; min-width: 0; min-height: 38px; padding: 0 9px; font-size: 12px; }
.converter-dialog__table-wrap { flex: 1 1 auto; min-height: 150px; overflow: auto; margin-top: 14px; border: 1px solid var(--border); border-radius: 6px; scrollbar-color: var(--brand) var(--surface-subtle); scrollbar-width: thin; }
.converter-dialog__table-wrap::-webkit-scrollbar { width: 10px; height: 10px; }
.converter-dialog__table-wrap::-webkit-scrollbar-track { background: var(--surface-subtle); }
.converter-dialog__table-wrap::-webkit-scrollbar-thumb { border: 2px solid var(--surface-subtle); border-radius: 8px; background: var(--brand); }
.converter-dialog__table { width: 100%; min-width: 580px; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
.converter-dialog__table th, .converter-dialog__table td { overflow: hidden; min-height: 40px; padding: 8px 9px; border-bottom: 1px solid var(--divider); color: var(--text); text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.converter-dialog__table th { position: sticky; top: 0; z-index: 1; color: var(--muted); background: var(--surface-subtle); font-size: 11px; font-weight: 700; }
.converter-dialog__table tr:last-child td { border-bottom: 0; }
.converter-dialog__table th:nth-child(1) { width: 29%; }
.converter-dialog__table th:nth-child(2) { width: 19%; }
.converter-dialog__table th:nth-child(3) { width: 21%; }
.converter-dialog__table th:nth-child(4) { width: 20%; }
.converter-dialog__table th:nth-child(5) { width: 11%; }
.converter-dialog__empty { color: var(--muted) !important; text-align: center !important; }
.converter-dialog__platform { display: inline-block; max-width: 100%; overflow: hidden; padding: 2px 6px; color: var(--brand-ink); border: 1px solid var(--border-hover); border-radius: 4px; background: var(--brand-subtle); text-overflow: ellipsis; vertical-align: middle; }
.converter-dialog__row-export { padding: 0; color: var(--brand); background: transparent; font: inherit; font-weight: 700; cursor: pointer; }
.converter-dialog__row-export:hover:not(:disabled) { color: var(--brand-hover); text-decoration: underline; }
.converter-dialog__row-export:disabled { color: var(--disabled-text); cursor: not-allowed; }
.converter-dialog__pagination { display: flex; align-items: center; justify-content: space-between; min-height: 36px; margin-top: 8px; gap: 10px; color: var(--muted); font-size: 12px; }
.converter-dialog__pagination-status { font-variant-numeric: tabular-nums; }
.converter-dialog__pagination-controls { display: inline-flex; align-items: center; gap: 7px; color: var(--text); font-variant-numeric: tabular-nums; white-space: nowrap; }
.converter-dialog__pagination-controls button { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid var(--control-border); border-radius: 5px; color: var(--text); background: var(--surface); cursor: pointer; }
.converter-dialog__pagination-controls button:hover:not(:disabled) { color: var(--brand); border-color: var(--border-hover); background: var(--brand-subtle); }
.converter-dialog__pagination-controls button:disabled { color: var(--disabled-text); cursor: not-allowed; }
.converter-dialog__issues { flex: 0 1 auto; min-height: 0; margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--divider); }
.converter-dialog__issues-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.converter-dialog__issues-heading span { color: var(--muted); font-size: 12px; }
.converter-dialog__issues > p { margin: 8px 0 0; color: var(--muted); font-size: 12px; }
.converter-dialog__issues ul { display: grid; overflow: auto; max-height: 126px; margin: 9px 0 0; padding: 0; gap: 7px; list-style: none; }
.converter-dialog__issues li { display: grid; padding: 8px 9px; gap: 3px; border-left: 2px solid var(--warning); background: var(--surface-subtle); color: var(--muted); font-size: 12px; line-height: 1.45; }
.converter-dialog__issues strong { overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.converter-dialog__notice, .converter-dialog__error { margin: 16px 0 0; padding: 9px 10px; border-radius: 6px; font-size: 12px; line-height: 1.5; }
.converter-dialog__notice { color: var(--info); border: 1px solid var(--cyan-border); background: var(--cyan-subtle); }
.converter-dialog__error { color: var(--danger); border: 1px solid var(--danger-border); background: var(--danger-subtle); }
@media (max-width: 760px) { .converter-dialog-backdrop { align-items: end; padding: 12px; } .converter-dialog { height: calc(100dvh - var(--window-titlebar-height) - 24px); padding: 17px; } .converter-dialog__workspace { grid-template-columns: 1fr; gap: 18px; overflow-y: auto; scrollbar-color: var(--brand) var(--surface-subtle); scrollbar-width: thin; } .converter-dialog__import { padding: 0 0 18px; border-right: 0; border-bottom: 1px solid var(--divider); } .converter-dialog__results { min-height: 500px; } .converter-dialog__dropzone, .converter-dialog__paste textarea { min-height: 160px; } .converter-dialog__table-wrap { max-height: min(300px, 38vh); } }
@media (max-width: 440px) { .converter-dialog__export-actions { grid-template-columns: 1fr; } .converter-dialog__mode { gap: 2px; } .converter-dialog__mode-button { padding: 0 7px; font-size: 12px; } }
</style>
