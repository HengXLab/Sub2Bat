<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  RotateCcw,
} from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import {
  DEFAULT_ACCOUNT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  clampPage,
  getPageRange,
  getPageSelectionState,
  getPaginationItems,
  sortItems,
  type PageSize,
  type SortDirection,
} from "../lib/pagination";
import {
  ACCOUNT_TABLE_COLUMNS as TABLE_COLUMNS,
  ACCOUNT_TABLE_DATE_COLUMN_IDS as DATE_COLUMN_IDS,
  DEFAULT_VISIBLE_ACCOUNT_TABLE_COLUMN_IDS as DEFAULT_VISIBLE_COLUMN_IDS,
  FIXED_RIGHT_ACCOUNT_TABLE_COLUMN_IDS as FIXED_RIGHT_COLUMN_IDS,
  persistVisibleAccountTableColumnIds as persistVisibleColumnIds,
  readVisibleAccountTableColumnIds as readVisibleColumnIds,
  type AccountSortKey,
  type AccountTableColumnDefinition as TableColumnDefinition,
  type AccountTableColumnId as TableColumnId,
} from "../lib/accountTableColumns";
import { getAccountGroupName, getAccountPlanTypeLabel, getAccountRuntimeStatus, getAccountSchedulable, getAccountStatusLabel, getLatestTestResult, type LatestTestFilter, type LatestTestResult } from "../lib/accounts";
import type { TestRowState } from "../lib/batch";
import type { Account } from "../types";

const LATEST_TEST_FILTER_OPTIONS: ReadonlyArray<{ value: LatestTestFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "untested", label: "未测试" },
  { value: "normal", label: "正常" },
  { value: "rateLimited", label: "限流中" },
  { value: "connectionInterrupted", label: "连接异常" },
  { value: "error", label: "错误" },
  { value: "queued", label: "等待测试" },
  { value: "testing", label: "测试中" },
  { value: "cancelled", label: "已取消" },
];


const props = withDefaults(defineProps<{
  accounts: Account[];
  selectedIds: number[];
  testStates?: Record<number, TestRowState>;
  /** Page metadata comes from the official server-side account list. */
  page?: number;
  pageSize?: PageSize;
  total?: number;
  pageCount?: number;
  /** The server exposed more than the bounded 999999-page navigation range. */
  truncated?: boolean;
  sortKey?: AccountSortKey | null;
  sortDirection?: SortDirection;
  /** False when a client-only filter cannot be resolved across unseen pages. */
  globalSelectionEnabled?: boolean;
  globalSelectionDisabledReason?: string;
  /** A cross-page selection request is in flight and can still be cancelled. */
  globalSelectionPending?: boolean;
  /** Prevents any selection from a page that is being replaced by a new filter. */
  interactionsDisabled?: boolean;
  /** The parent resolves latest-test outcomes across the current upper-filter scope. */
  latestTestFilter?: LatestTestFilter;
  loading?: boolean;
  /** Explains why the visible rows are filtered or sorted only within the loaded page. */
  pageOnlyReason?: string;
}>(), {
  testStates: () => ({}),
  page: 1,
  pageSize: DEFAULT_ACCOUNT_PAGE_SIZE,
  total: 0,
  pageCount: 1,
  truncated: false,
  sortKey: null,
  sortDirection: "asc",
  globalSelectionEnabled: true,
  globalSelectionDisabledReason: "",
  globalSelectionPending: false,
  latestTestFilter: "all",
  loading: false,
  pageOnlyReason: "",
  interactionsDisabled: false,
});

const emit = defineEmits<{
  toggle: [accountId: number, selected: boolean];
  togglePage: [accountIds: number[], selected: boolean];
  selectPage: [accountIds: number[]];
  selectAllFiltered: [];
  clearSelection: [];
  "update:latestTestFilter": [value: LatestTestFilter];
  updatePage: [page: number];
  updatePageSize: [pageSize: PageSize];
  updateSort: [key: AccountSortKey | null, direction: SortDirection];
}>();

const selectAllInput = ref<HTMLInputElement | null>(null);
const columnSettingsOpen = ref(false);
const columnSettingsRoot = ref<HTMLElement | null>(null);
const latestTestFilterOpen = ref(false);
const latestTestFilterRoot = ref<HTMLElement | null>(null);
const pageSizeMenuOpen = ref(false);
const pageSizeMenuRoot = ref<HTMLElement | null>(null);
const pageSizeMenuTrigger = ref<HTMLButtonElement | null>(null);
const latestTestFilter = computed(() => props.latestTestFilter);
const visibleColumnIds = ref<TableColumnId[]>(readVisibleColumnIds());
const accountSortCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

const visibleColumns = computed(() => {
  const selectedColumns = new Set(visibleColumnIds.value);
  for (const columnId of FIXED_RIGHT_COLUMN_IDS) selectedColumns.add(columnId);
  return TABLE_COLUMNS.filter((column) => selectedColumns.has(column.id));
});
const visibleColumnWeight = computed(() => Math.max(1, visibleColumns.value.reduce((sum, column) => sum + column.weight, 0)));
const displayedAccounts = computed(() => {
  // The official endpoint cannot globally order by a display-only group name.
  // Keep that requested sort truthful by applying it only to this server page.
  if (props.sortKey !== "group") return props.accounts;

  const sortable: Account[] = [];
  const missing: Account[] = [];
  for (const account of props.accounts) {
    if (accountSortValue(account, "group") === null) missing.push(account);
    else sortable.push(account);
  }

  return [
    ...sortItems(
      sortable,
      (left, right) => compareAccountSortValues(accountSortValue(left, "group"), accountSortValue(right, "group")),
      props.sortDirection,
    ),
    ...missing,
  ];
});
const effectivePageCount = computed(() => Math.max(1, Math.trunc(props.pageCount) || 1));
const effectivePage = computed(() => clampPage(props.page, effectivePageCount.value));
const pageAccountIds = computed(() => displayedAccounts.value.map((account) => account.id));
const pageSelectionState = computed(() => getPageSelectionState(pageAccountIds.value, props.selectedIds));
const pageRange = computed(() => getPageRange(props.total, effectivePage.value, props.pageSize));
const paginationItems = computed(() => getPaginationItems(effectivePage.value, effectivePageCount.value));
const canSelectAllFiltered = computed(() => (
  !props.interactionsDisabled
  &&
  props.globalSelectionEnabled
  && !props.globalSelectionPending
  && props.total > 0
));
const pageOnlyNotice = computed(() => {
  const reasons = [props.pageOnlyReason.trim()];
  return [...new Set(reasons.filter(Boolean))].join("；");
});
const selectAllFilteredTitle = computed(() => props.globalSelectionDisabledReason || "全选所有符合当前筛选条件的账号");

watch(
  visibleColumnIds,
  (columnIds) => {
    persistVisibleColumnIds(columnIds);
  },
  { deep: true },
);

watch(
  effectivePageCount,
  (value) => {
    if (effectivePage.value !== props.page) {
      emit("updatePage", clampPage(props.page, value));
    }
  },
  { immediate: true },
);

watchEffect(() => {
  if (selectAllInput.value) {
    selectAllInput.value.indeterminate = pageSelectionState.value.indeterminate;
  }
});

onMounted(() => {
  document.addEventListener("pointerdown", closeColumnSettingsOnOutsidePointer);
  document.addEventListener("keydown", closeColumnSettingsOnEscape);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeColumnSettingsOnOutsidePointer);
  document.removeEventListener("keydown", closeColumnSettingsOnEscape);
});

function selected(accountId: number) {
  return props.selectedIds.includes(accountId);
}

function cellValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function dateValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";

  const numeric = typeof value === "number" ? value : Number(value);
  const timestamp = Number.isFinite(numeric) && String(value).trim() !== "" && numeric < 100_000_000_000 ? numeric * 1000 : value;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/\//g, "-");
}

function setPage(page: number) {
  emit("updatePage", clampPage(page, effectivePageCount.value));
}

function toggleSort(key: AccountSortKey) {
  if (props.sortKey === key) {
    emit("updateSort", key, props.sortDirection === "asc" ? "desc" : "asc");
  } else {
    emit("updateSort", key, "asc");
  }
}

function sortAria(key: AccountSortKey) {
  if (props.sortKey !== key) return "none";
  return props.sortDirection === "asc" ? "ascending" : "descending";
}

function sortLabel(key: AccountSortKey) {
  return {
    id: "账号 ID",
    group: "分组",
    lastUsedAt: "最近使用",
    createdAt: "创建时间",
  }[key];
}

function sortTitle(key: AccountSortKey) {
  const direction = props.sortKey === key && props.sortDirection === "asc" ? "降序" : "升序";
  const scope = key === "group" ? "（仅当前页）" : "";
  return `按${sortLabel(key)}${direction}排序${scope}`;
}

function accountSortValue(account: Account, key: AccountSortKey): string | number | null {
  if (key === "id") return account.id;
  if (key === "group") return getAccountGroupName(account) || null;
  return dateTimestamp(account[key]);
}

function compareAccountSortValues(left: string | number | null, right: string | number | null) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return accountSortCollator.compare(String(left), String(right));
}

function dateTimestamp(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;

  const numeric = typeof value === "number" ? value : Number(value);
  const timestamp = Number.isFinite(numeric) && String(value).trim() !== "" && numeric < 100_000_000_000 ? numeric * 1000 : value;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function formatLatency(latencyMs: number | undefined): string {
  if (latencyMs === undefined || !Number.isFinite(latencyMs)) return "";
  return `${Math.max(0, Math.round(latencyMs))} ms`;
}

function testResultTitle(result: LatestTestResult): string {
  const code = shouldShowTestResultCode(result) ? `（${result.httpStatus}）` : "";
  const status = [result.label, code].filter(Boolean).join("");
  const summary = [status, formatLatency(result.latencyMs)].filter(Boolean).join(" ");
  return [result.notice, summary, result.message].filter(Boolean).join("\n");
}

function shouldShowTestResultCode(result: LatestTestResult): boolean {
  return result.httpStatus !== undefined && !result.label.includes(`（${result.httpStatus}）`);
}

function testResultFor(account: Account): LatestTestResult {
  return getLatestTestResult(account, props.testStates[account.id]);
}

function toggleLatestTestFilter() {
  latestTestFilterOpen.value = !latestTestFilterOpen.value;
  if (latestTestFilterOpen.value) {
    columnSettingsOpen.value = false;
    pageSizeMenuOpen.value = false;
  }
}

function setLatestTestFilterRoot(element: unknown) {
  latestTestFilterRoot.value = element instanceof HTMLElement ? element : null;
}

function setLatestTestFilter(filter: LatestTestFilter) {
  emit("update:latestTestFilter", filter);
  latestTestFilterOpen.value = false;
}

function toggleColumnSettings() {
  columnSettingsOpen.value = !columnSettingsOpen.value;
  if (columnSettingsOpen.value) {
    latestTestFilterOpen.value = false;
    pageSizeMenuOpen.value = false;
  }
}

function tableColumnWidth(column: TableColumnDefinition): string {
  return `${(column.weight / visibleColumnWeight.value) * 97}%`;
}

function columnSortAria(column: TableColumnDefinition): "none" | "ascending" | "descending" | undefined {
  return column.sortKey ? sortAria(column.sortKey) : undefined;
}

function columnSortTitle(column: TableColumnDefinition): string {
  return column.sortKey ? sortTitle(column.sortKey) : "";
}

function toggleColumnSort(column: TableColumnDefinition) {
  if (column.sortKey) toggleSort(column.sortKey);
}

function isDateColumn(columnId: TableColumnId): boolean {
  return DATE_COLUMN_IDS.includes(columnId);
}

function isColumnVisible(columnId: TableColumnId): boolean {
  return isFixedColumn(columnId) || visibleColumnIds.value.includes(columnId);
}

function isFixedColumn(columnId: TableColumnId): boolean {
  return FIXED_RIGHT_COLUMN_IDS.some((fixedColumnId) => fixedColumnId === columnId);
}

function isOnlyVisibleColumn(columnId: TableColumnId): boolean {
  return !isFixedColumn(columnId)
    && isColumnVisible(columnId)
    && visibleColumnIds.value.filter((visibleColumnId) => !isFixedColumn(visibleColumnId)).length === 1;
}

function setColumnVisibility(columnId: TableColumnId, shouldShow: boolean) {
  if (isFixedColumn(columnId)) return;
  const currentlyVisible = isColumnVisible(columnId);
  if (shouldShow === currentlyVisible || (!shouldShow && isOnlyVisibleColumn(columnId))) return;

  const next = new Set(visibleColumnIds.value);
  if (shouldShow) {
    next.add(columnId);
  } else {
    next.delete(columnId);
    const column = TABLE_COLUMNS.find((item) => item.id === columnId);
    if (column?.sortKey === props.sortKey) {
      emit("updateSort", null, "asc");
    }
  }
  for (const fixedColumnId of FIXED_RIGHT_COLUMN_IDS) next.add(fixedColumnId);
  visibleColumnIds.value = TABLE_COLUMNS.map((column) => column.id).filter((id) => next.has(id));
}

function restoreDefaultColumns() {
  visibleColumnIds.value = [...DEFAULT_VISIBLE_COLUMN_IDS];
}

function closeColumnSettingsOnOutsidePointer(event: PointerEvent) {
  if (!(event.target instanceof Node)) return;
  if (!columnSettingsRoot.value?.contains(event.target)) columnSettingsOpen.value = false;
  if (!latestTestFilterRoot.value?.contains(event.target)) latestTestFilterOpen.value = false;
  if (!pageSizeMenuRoot.value?.contains(event.target)) pageSizeMenuOpen.value = false;
}

function closeColumnSettingsOnEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  columnSettingsOpen.value = false;
  latestTestFilterOpen.value = false;
  if (pageSizeMenuOpen.value) pageSizeMenuTrigger.value?.focus();
  pageSizeMenuOpen.value = false;
}

function schedulingLabel(account: Account): string {
  const schedulable = getAccountSchedulable(account);
  return schedulable === true ? "可调度" : schedulable === false ? "不可调度" : "-";
}

function schedulingClass(account: Account): string {
  const schedulable = getAccountSchedulable(account);
  return schedulable === true ? "scheduling-state--enabled" : schedulable === false ? "scheduling-state--disabled" : "scheduling-state--unknown";
}

function privacyValue(account: Account): string {
  return cellValue(account.privacyMode);
}

function sessionWindowValue(account: Account): string {
  const window = account.usageWindow;
  if (!window) return "-";

  const dates = [window.start, window.end]
    .filter((value): value is string => Boolean(value))
    .map((value) => dateValue(value));
  const range = dates.join(" - ");
  const status = window.status?.trim() ?? "";
  return [range, status].filter(Boolean).join(" · ") || "-";
}

function rateMultiplierValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}x` : "-";
}

function currencyValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "-";
}

function proxyValue(account: Account): string {
  const proxy = account.proxyName?.trim() || (account.proxyId === null || account.proxyId === undefined ? "" : `#${account.proxyId}`);
  if (!proxy) return "-";
  const fallback = account.proxyFallbackOriginName?.trim();
  return fallback ? `${proxy} · 回退自 ${fallback}` : proxy;
}

function booleanValue(value: boolean | null | undefined): string {
  return value === true ? "是" : value === false ? "否" : "-";
}

function togglePageSizeMenu() {
  pageSizeMenuOpen.value = !pageSizeMenuOpen.value;
  if (pageSizeMenuOpen.value) {
    columnSettingsOpen.value = false;
    latestTestFilterOpen.value = false;
  }
}

function setPageSize(size: PageSize) {
  pageSizeMenuOpen.value = false;
  emit("updatePageSize", size);
  pageSizeMenuTrigger.value?.focus();
}
</script>

<template>
  <div class="table-shell">
    <div class="table-settings-bar">
      <div class="table-settings-bar__selection">
        <button
          class="pagination-selection-button"
          type="button"
          :disabled="interactionsDisabled || pageAccountIds.length === 0"
          @click="emit('selectPage', pageAccountIds)"
        >
          全选本页
        </button>
        <button
          class="pagination-selection-button"
          type="button"
          :disabled="!canSelectAllFiltered"
          :title="selectAllFilteredTitle"
          @click="emit('selectAllFiltered')"
        >
          {{ globalSelectionPending ? "正在全选..." : "全选所有筛选结果" }}
        </button>
        <button
          class="pagination-selection-button"
          type="button"
          :disabled="interactionsDisabled || (selectedIds.length === 0 && !globalSelectionPending)"
          :title="globalSelectionPending ? '取消正在进行的全选' : undefined"
          @click="emit('clearSelection')"
        >
          取消选择
        </button>
        <span class="table-settings-bar__selected" aria-live="polite">已选 {{ selectedIds.length }} 个账号</span>
      </div>

      <div ref="columnSettingsRoot" class="column-settings">
        <button
          class="button button--secondary column-settings__trigger"
          type="button"
          title="配置表格显示列"
          aria-haspopup="dialog"
          :aria-expanded="columnSettingsOpen"
          aria-controls="account-table-column-settings"
          @click="toggleColumnSettings"
        >
          <Columns3 :size="16" aria-hidden="true" />
          <span>列设置</span>
        </button>

        <section v-if="columnSettingsOpen" id="account-table-column-settings" class="column-settings__menu" role="dialog" aria-label="表格列设置">
          <header class="column-settings__heading">
            <span>显示 {{ visibleColumns.length }}/{{ TABLE_COLUMNS.length }} 列</span>
            <button type="button" title="恢复默认列" @click="restoreDefaultColumns">
              <RotateCcw :size="14" aria-hidden="true" />
              <span>恢复默认</span>
            </button>
          </header>
          <div class="column-settings__list">
            <label v-for="column in TABLE_COLUMNS" :key="column.id" class="column-settings__option">
              <input
                type="checkbox"
                :checked="isColumnVisible(column.id)"
                :disabled="isFixedColumn(column.id) || isOnlyVisibleColumn(column.id)"
                :title="isFixedColumn(column.id) ? '固定显示' : isOnlyVisibleColumn(column.id) ? '至少保留一列' : undefined"
                @change="setColumnVisibility(column.id, ($event.target as HTMLInputElement).checked)"
              />
              <span>{{ column.label }}</span>
            </label>
          </div>
        </section>
      </div>
    </div>

    <table class="account-table" :aria-busy="loading">
      <colgroup>
        <col class="account-table__select-column" />
        <col v-for="column in visibleColumns" :key="column.id" :class="`account-table__${column.id}-column`" :style="{ width: tableColumnWidth(column) }" />
      </colgroup>
      <thead>
        <tr>
          <th class="select-cell">
            <input
              ref="selectAllInput"
              :checked="pageSelectionState.allSelected"
              type="checkbox"
              aria-label="选择当前页所有账号"
              :disabled="interactionsDisabled"
              @change="emit('togglePage', pageAccountIds, ($event.target as HTMLInputElement).checked)"
            />
          </th>
          <th
            v-for="column in visibleColumns"
            :key="column.id"
            :class="`account-table__${column.id}-column`"
            :aria-sort="columnSortAria(column)"
          >
            <button
              v-if="column.sortKey"
              class="table-sort-button"
              type="button"
              :title="columnSortTitle(column)"
              :aria-label="columnSortTitle(column)"
              @click="toggleColumnSort(column)"
            >
              <span>{{ column.label }}</span>
              <ArrowUp v-if="sortKey === column.sortKey && sortDirection === 'asc'" :size="14" aria-hidden="true" />
              <ArrowDown v-else-if="sortKey === column.sortKey" :size="14" aria-hidden="true" />
              <ArrowUpDown v-else :size="14" aria-hidden="true" />
            </button>
            <div v-else-if="column.id === 'testResult'" :ref="setLatestTestFilterRoot" class="test-result-filter">
              <button
                class="test-result-filter__trigger"
                :class="{ 'test-result-filter__trigger--active': latestTestFilter !== 'all' }"
                type="button"
                aria-haspopup="menu"
                :aria-expanded="latestTestFilterOpen"
                aria-controls="latest-test-filter-menu"
                aria-label="筛选当前账号范围的最新测试结果"
                title="筛选当前账号范围的最新测试结果"
                @click="toggleLatestTestFilter"
              >
                <span>{{ column.label }}</span>
                <ChevronDown :size="14" aria-hidden="true" />
              </button>

              <section v-if="latestTestFilterOpen" id="latest-test-filter-menu" class="test-result-filter__menu" role="menu" aria-label="筛选当前账号范围的最新测试">
                <button
                  v-for="option in LATEST_TEST_FILTER_OPTIONS"
                  :key="option.value"
                  class="test-result-filter__option"
                  :class="{ 'test-result-filter__option--selected': latestTestFilter === option.value }"
                  type="button"
                  role="menuitemradio"
                  :aria-checked="latestTestFilter === option.value"
                  @click="setLatestTestFilter(option.value)"
                >
                  <span>{{ option.label }}</span>
                  <Check v-if="latestTestFilter === option.value" :size="14" aria-hidden="true" />
                </button>
              </section>
            </div>
            <span v-else>{{ column.label }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="account in displayedAccounts" :key="account.id" :class="{ 'account-table__row--selected': selected(account.id) }">
          <td class="select-cell">
            <input
              :checked="selected(account.id)"
              type="checkbox"
              :aria-label="`选择 ${account.name || account.id}`"
              :disabled="interactionsDisabled"
              @change="emit('toggle', account.id, ($event.target as HTMLInputElement).checked)"
            />
          </td>
          <td
            v-for="column in visibleColumns"
            :key="column.id"
            :class="{
              'account-name': column.id === 'name',
              'date-cell': isDateColumn(column.id),
            }"
          >
            <template v-if="column.id === 'name'">
              <strong :title="account.name || `账号 ${account.id}`">{{ account.name || `账号 ${account.id}` }}</strong>
            </template>
            <template v-else-if="column.id === 'id'">
              <span class="account-id">{{ account.id }}</span>
            </template>
            <template v-else-if="column.id === 'platform'">
              <span class="platform-label table-cell-ellipsis" :title="cellValue(account.platform)">{{ cellValue(account.platform) }}</span>
            </template>
            <template v-else-if="column.id === 'accountType'">
              <span class="table-cell-ellipsis" :title="cellValue(account.accountType)">{{ cellValue(account.accountType) }}</span>
            </template>
            <template v-else-if="column.id === 'planType'">
              <span class="account-plan-type" :title="getAccountPlanTypeLabel(account.planType)">{{ getAccountPlanTypeLabel(account.planType) }}</span>
            </template>
            <template v-else-if="column.id === 'status'">
              <div class="account-status">
                <span class="status-dot" :class="`status-dot--${getAccountRuntimeStatus(account)}`"></span>
                <span>{{ getAccountStatusLabel(account) }}</span>
              </div>
            </template>
            <template v-else-if="column.id === 'scheduling'">
              <span class="scheduling-state" :class="schedulingClass(account)">{{ schedulingLabel(account) }}</span>
            </template>
            <template v-else-if="column.id === 'priority'">
              <span class="account-number">{{ cellValue(account.priority) }}</span>
            </template>
            <template v-else-if="column.id === 'concurrency'">
              <span class="account-number">{{ cellValue(account.concurrency) }}</span>
            </template>
            <template v-else-if="column.id === 'currentConcurrency'">
              <span class="account-number">{{ cellValue(account.currentConcurrency) }}</span>
            </template>
            <template v-else-if="column.id === 'loadFactor'">
              <span class="account-number">{{ cellValue(account.loadFactor) }}</span>
            </template>
            <template v-else-if="column.id === 'rateMultiplier'">
              <span class="account-number">{{ rateMultiplierValue(account.rateMultiplier) }}</span>
            </template>
            <template v-else-if="column.id === 'privacy'">
              <span class="table-cell-ellipsis" :title="privacyValue(account)">{{ privacyValue(account) }}</span>
            </template>
            <template v-else-if="column.id === 'proxy'">
              <span class="table-cell-ellipsis" :title="proxyValue(account)">{{ proxyValue(account) }}</span>
            </template>
            <template v-else-if="column.id === 'proxyExpiresAt'">
              {{ dateValue(account.proxyExpiresAt) }}
            </template>
            <template v-else-if="column.id === 'group'">
              <span class="table-cell-ellipsis" :title="cellValue(getAccountGroupName(account))">{{ cellValue(getAccountGroupName(account)) }}</span>
            </template>
            <template v-else-if="column.id === 'sessionWindow'">
              <span class="table-cell-ellipsis" :title="sessionWindowValue(account)">{{ sessionWindowValue(account) }}</span>
            </template>
            <template v-else-if="column.id === 'currentWindowCost'">
              <span class="account-number">{{ currencyValue(account.currentWindowCost) }}</span>
            </template>
            <template v-else-if="column.id === 'activeSessions'">
              <span class="account-number">{{ cellValue(account.activeSessions) }}</span>
            </template>
            <template v-else-if="column.id === 'currentRpm'">
              <span class="account-number">{{ cellValue(account.currentRpm) }}</span>
            </template>
            <template v-else-if="column.id === 'rateLimitedAt'">
              {{ dateValue(account.rateLimitedAt) }}
            </template>
            <template v-else-if="column.id === 'rateLimitResetAt'">
              {{ dateValue(account.rateLimitResetAt) }}
            </template>
            <template v-else-if="column.id === 'overloadUntil'">
              {{ dateValue(account.overloadUntil) }}
            </template>
            <template v-else-if="column.id === 'tempUnschedulableUntil'">
              {{ dateValue(account.tempUnschedulableUntil) }}
            </template>
            <template v-else-if="column.id === 'tempUnschedulableReason'">
              <span class="table-cell-ellipsis" :title="cellValue(account.tempUnschedulableReason)">{{ cellValue(account.tempUnschedulableReason) }}</span>
            </template>
            <template v-else-if="column.id === 'expiresAt'">
              {{ dateValue(account.expiresAt) }}
            </template>
            <template v-else-if="column.id === 'autoPauseOnExpired'">
              <span class="account-boolean">{{ booleanValue(account.autoPauseOnExpired) }}</span>
            </template>
            <template v-else-if="column.id === 'notes'">
              <span class="table-cell-ellipsis" :title="cellValue(account.notes)">{{ cellValue(account.notes) }}</span>
            </template>
            <template v-else-if="column.id === 'errorMessage'">
              <span class="table-cell-ellipsis" :title="cellValue(account.errorMessage)">{{ cellValue(account.errorMessage) }}</span>
            </template>
            <template v-else-if="column.id === 'lastUsedAt'">
              {{ dateValue(account.lastUsedAt) }}
            </template>
            <template v-else-if="column.id === 'createdAt'">
              {{ dateValue(account.createdAt) }}
            </template>
            <template v-else-if="column.id === 'updatedAt'">
              {{ dateValue(account.updatedAt) }}
            </template>
            <template v-else-if="column.id === 'testResult'">
              <span
                v-for="result in [getLatestTestResult(account, testStates[account.id])]"
                :key="account.id"
                class="test-result"
                :class="`test-result--${result.tone}`"
                :title="testResultTitle(result)"
              >
                <span class="test-result__label">{{ result.label }}</span>
                <span v-if="shouldShowTestResultCode(result)" class="test-result__code">（{{ result.httpStatus }}）</span>
              </span>
            </template>
            <template v-else-if="column.id === 'testTime'">
              {{ dateValue(testStates[account.id]?.testedAt) }}
            </template>
            <template v-else-if="column.id === 'latency'">
              <span class="test-result-latency" :title="formatLatency(testResultFor(account).latencyMs) || '暂无响应耗时'">
                {{ formatLatency(testResultFor(account).latencyMs) || "-" }}
              </span>
            </template>
          </td>
        </tr>
        <tr v-if="displayedAccounts.length === 0">
          <td class="empty-table" :colspan="visibleColumns.length + 1">{{ loading ? "正在读取符合条件的账号..." : "当前筛选条件下没有账号。" }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="table-pagination" aria-label="账号列表分页">
      <div class="table-pagination__summary">
        <span v-if="pageOnlyNotice">第 {{ effectivePage }} 页，本页显示 {{ displayedAccounts.length }} 个账号（{{ pageOnlyNotice }}）</span>
        <span v-else-if="total">
          显示 {{ pageRange.from }}-{{ pageRange.to }}，共 {{ total }} 个账号
          <template v-if="truncated">（结果已截断，仅可浏览前 999999 页）</template>
        </span>
        <span v-else>共 0 个账号</span>
      </div>

      <div class="table-pagination__controls">
        <div ref="pageSizeMenuRoot" class="page-size-control">
          <span>每页</span>
          <div class="page-size-control__picker">
            <button
              ref="pageSizeMenuTrigger"
              class="page-size-control__trigger"
              type="button"
              aria-label="每页显示账号数量"
              aria-haspopup="listbox"
              aria-controls="page-size-menu"
              :aria-expanded="pageSizeMenuOpen"
              @click="togglePageSizeMenu"
            >
              <span>{{ pageSize }}</span>
              <ChevronDown :size="14" aria-hidden="true" />
            </button>
            <section v-if="pageSizeMenuOpen" id="page-size-menu" class="page-size-control__menu" role="listbox" aria-label="每页显示账号数量">
              <button
                v-for="size in PAGE_SIZE_OPTIONS"
                :key="size"
                class="page-size-control__option"
                :class="{ 'page-size-control__option--selected': size === pageSize }"
                type="button"
                role="option"
                :aria-selected="size === pageSize"
                @click="setPageSize(size)"
              >
                {{ size }}
              </button>
            </section>
          </div>
          <span>条</span>
        </div>

        <div class="page-navigation">
          <button class="pagination-button pagination-button--icon" type="button" title="第一页" aria-label="第一页" :disabled="effectivePage === 1" @click="setPage(1)">
            <ChevronsLeft :size="16" />
          </button>
          <button class="pagination-button pagination-button--icon" type="button" title="上一页" aria-label="上一页" :disabled="effectivePage === 1" @click="setPage(effectivePage - 1)">
            <ChevronLeft :size="16" />
          </button>
          <template v-for="item in paginationItems" :key="item">
            <span v-if="typeof item === 'string'" class="pagination-ellipsis">...</span>
            <button
              v-else
              class="pagination-button"
              :class="{ 'pagination-button--active': item === effectivePage }"
              type="button"
              :aria-current="item === effectivePage ? 'page' : undefined"
              :aria-label="`第 ${item} 页`"
              @click="setPage(item)"
            >
              {{ item }}
            </button>
          </template>
          <button class="pagination-button pagination-button--icon" type="button" title="下一页" aria-label="下一页" :disabled="effectivePage === effectivePageCount" @click="setPage(effectivePage + 1)">
            <ChevronRight :size="16" />
          </button>
          <button class="pagination-button pagination-button--icon" type="button" title="最后一页" aria-label="最后一页" :disabled="effectivePage === effectivePageCount" @click="setPage(effectivePageCount)">
            <ChevronsRight :size="16" />
          </button>
        </div>
      </div>
    </footer>
  </div>
</template>
