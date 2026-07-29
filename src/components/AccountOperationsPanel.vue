<script setup lang="ts">
import { ArrowLeftRight, Bot, FileDown, FileSpreadsheet, FolderInput, Gauge, ListOrdered, PencilLine, Trash2 } from "@lucide/vue";

defineProps<{
  selectedCount: number;
  running: boolean;
}>();

const emit = defineEmits<{
  deleteSelected: [];
  moveSelected: [];
  setPriority: [];
  setConcurrency: [];
  renameSelected: [];
  exportAccounts: [];
  exportReport: [];
  openConverter: [];
  openAutomation: [];
}>();
</script>

<template>
  <section class="account-operations-panel" aria-labelledby="account-operations-heading">
    <h2 id="account-operations-heading" class="account-operations-panel__heading">批量操作</h2>

    <div class="account-operations-panel__actions">
      <span class="selection-required-tooltip account-operations-panel__rename" :title="!running && selectedCount === 0 ? '需先选择账号' : undefined">
        <button class="button button--secondary" type="button" :disabled="running || selectedCount === 0" @click="emit('renameSelected')">
          <PencilLine :size="16" />
          <span>批量重命名</span>
        </button>
      </span>
      <span class="selection-required-tooltip" :title="!running && selectedCount === 0 ? '需先选择账号' : undefined">
        <button class="button button--danger" type="button" :disabled="running || selectedCount === 0" @click="emit('deleteSelected')">
          <Trash2 :size="16" />
          <span>删除选中账号</span>
        </button>
      </span>
      <span class="selection-required-tooltip" :title="!running && selectedCount === 0 ? '需先选择账号' : undefined">
        <button class="button button--secondary" type="button" :disabled="running || selectedCount === 0" @click="emit('moveSelected')">
          <FolderInput :size="16" />
          <span>移动选中账号</span>
        </button>
      </span>
      <span class="selection-required-tooltip" :title="!running && selectedCount === 0 ? '需先选择账号' : undefined">
        <button class="button button--secondary" type="button" :disabled="running || selectedCount === 0" @click="emit('setPriority')">
          <ListOrdered :size="16" />
          <span>批量设置优先级</span>
        </button>
      </span>
      <span class="selection-required-tooltip" :title="!running && selectedCount === 0 ? '需先选择账号' : undefined">
        <button class="button button--secondary" type="button" :disabled="running || selectedCount === 0" @click="emit('setConcurrency')">
          <Gauge :size="16" />
          <span>批量设置账号并发</span>
        </button>
      </span>
      <span class="selection-required-tooltip" :title="!running && selectedCount === 0 ? '需先选择账号' : undefined">
        <button class="button button--secondary" type="button" :disabled="running || selectedCount === 0" @click="emit('exportAccounts')">
          <FileDown :size="16" />
          <span>批量导出账号</span>
        </button>
      </span>
      <span class="selection-required-tooltip account-operations-panel__report" :title="!running && selectedCount === 0 ? '需先选择账号' : undefined">
        <button class="button button--secondary" type="button" :disabled="running || selectedCount === 0" @click="emit('exportReport')">
          <FileSpreadsheet :size="16" />
          <span>批量测活报告</span>
        </button>
      </span>
      <div class="account-operations-panel__divider" aria-hidden="true"></div>
      <button
        class="button button--secondary account-operations-panel__converter"
        type="button"
        title="本地文件转换"
        aria-label="本地文件转换"
        :disabled="running"
        @click="emit('openConverter')"
      >
        <ArrowLeftRight :size="16" />
        <span>本地文件转换</span>
      </button>
      <button
        class="button button--secondary account-operations-panel__automation"
        type="button"
        title="按条件批量执行账号操作"
        :disabled="running"
        @click="emit('openAutomation')"
      >
        <Bot :size="16" />
        <span>批量自动化</span>
      </button>
    </div>
  </section>
</template>
