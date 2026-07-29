<script setup lang="ts">
import { Search } from "@lucide/vue";
import { computed } from "vue";
import {
  ACCOUNT_TYPE_FILTER_OPTIONS,
  ACCOUNT_STATUS_FILTER_OPTIONS,
  getAccountFilterOptions,
  getAccountPlanTypeFilterOptions,
  groupFilterValue,
  PLATFORM_FILTER_OPTIONS,
  PRIVACY_STATUS_FILTER_OPTIONS,
  UNASSIGNED_GROUP_FILTER_VALUE,
} from "../lib/accounts";
import RefreshableFilterSelect, { type RefreshableFilterOption } from "./RefreshableFilterSelect.vue";
import type { Account, AccountFilterValue, AccountGroup, AccountStatusFilter } from "../types";

const props = withDefaults(defineProps<{
  accounts?: Account[];
  /** Complete group catalog, used to preserve official numeric group IDs. */
  groups?: readonly AccountGroup[];
  search: string;
  platform?: AccountFilterValue;
  accountType?: AccountFilterValue;
  planType?: AccountFilterValue;
  /** Subscription labels aggregated across the full account collection. */
  planTypes?: readonly string[];
  /** Whether the complete account collection contains missing plan labels. */
  hasUnrecognizedPlanTypes?: boolean;
  group?: AccountFilterValue;
  status?: AccountStatusFilter;
  privacy?: AccountFilterValue;
  refreshOptions?: () => Promise<boolean>;
  refreshPlanTypes?: () => Promise<boolean>;
}>(), {
  accounts: () => [],
  groups: () => [],
  platform: "all",
  accountType: "all",
  planType: "all",
  planTypes: () => [],
  hasUnrecognizedPlanTypes: false,
  group: "all",
  status: "all",
  privacy: "all",
  refreshPlanTypes: undefined,
});

const emit = defineEmits<{
  "update:search": [value: string];
  "update:platform": [value: AccountFilterValue];
  "update:accountType": [value: AccountFilterValue];
  "update:planType": [value: AccountFilterValue];
  "update:group": [value: AccountFilterValue];
  "update:status": [value: AccountStatusFilter];
  "update:privacy": [value: AccountFilterValue];
}>();

const filterOptions = computed(() => getAccountFilterOptions(props.accounts));
const platformOptions = computed<readonly RefreshableFilterOption[]>(() => PLATFORM_FILTER_OPTIONS);
const accountTypeOptions = computed<readonly RefreshableFilterOption[]>(() => ACCOUNT_TYPE_FILTER_OPTIONS);
const planTypeOptions = computed<readonly RefreshableFilterOption[]>(() => getAccountPlanTypeFilterOptions(
  props.planTypes.length ? props.planTypes : filterOptions.value.planTypes,
  props.hasUnrecognizedPlanTypes,
));
const statusOptions = computed<readonly RefreshableFilterOption[]>(() => ACCOUNT_STATUS_FILTER_OPTIONS);
const privacyOptions = computed<readonly RefreshableFilterOption[]>(() => PRIVACY_STATUS_FILTER_OPTIONS);
const groupOptions = computed<readonly RefreshableFilterOption[]>(() => {
  const groups = props.groups
    .flatMap((item) => {
      const name = item.name.trim();
      return Number.isSafeInteger(item.id) && item.id > 0 && name
        ? [{ id: item.id, name, platform: item.platform?.trim() || "" }]
        : [];
    });
  const duplicateNames = new Map<string, number>();
  for (const item of groups) {
    const key = item.name.toLocaleLowerCase();
    duplicateNames.set(key, (duplicateNames.get(key) ?? 0) + 1);
  }

  return [
    { value: "all", label: "全部分组" },
    { value: UNASSIGNED_GROUP_FILTER_VALUE, label: "未分配分组" },
    ...groups
      .sort((left, right) => new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" }).compare(left.name, right.name))
      .map((item) => ({
        value: groupFilterValue(item.id),
        label: duplicateNames.get(item.name.toLocaleLowerCase())! > 1
          ? `${item.name}${item.platform ? `（${item.platform}）` : `（#${item.id}）`}`
          : item.name,
      })),
  ];
});
</script>

<template>
  <section class="account-toolbar" aria-label="账号筛选">
    <div class="toolbar-filters">
      <label class="toolbar-search">
        <Search :size="17" aria-hidden="true" />
        <input :value="search" placeholder="搜索账号..." @input="emit('update:search', ($event.target as HTMLInputElement).value)" />
      </label>

      <RefreshableFilterSelect
        :model-value="platform"
        :options="platformOptions"
        label="账号平台"
        :refresh-options="refreshOptions"
        @update:model-value="emit('update:platform', $event)"
      />
      <RefreshableFilterSelect
        :model-value="accountType"
        :options="accountTypeOptions"
        label="认证类型"
        :refresh-options="refreshOptions"
        @update:model-value="emit('update:accountType', $event)"
      />
      <RefreshableFilterSelect
        :model-value="planType"
        :options="planTypeOptions"
        label="账户类型"
        :refresh-options="refreshPlanTypes ?? refreshOptions"
        @update:model-value="emit('update:planType', $event)"
      />
      <RefreshableFilterSelect
        :model-value="status"
        :options="statusOptions"
        label="账号状态"
        :refresh-options="refreshOptions"
        @update:model-value="emit('update:status', $event as AccountStatusFilter)"
      />
      <RefreshableFilterSelect
        :model-value="privacy"
        :options="privacyOptions"
        label="Privacy 状态"
        :refresh-options="refreshOptions"
        @update:model-value="emit('update:privacy', $event)"
      />
      <RefreshableFilterSelect
        :model-value="group"
        :options="groupOptions"
        label="账号分组"
        :refresh-options="refreshOptions"
        @update:model-value="emit('update:group', $event)"
      />
    </div>
  </section>
</template>
