<script setup lang="ts">
import { Play, X } from "@lucide/vue";
import { computed } from "vue";
import BatchProgress from "./BatchProgress.vue";
import ConcurrencyPicker from "./ConcurrencyPicker.vue";
import ModelPicker from "./ModelPicker.vue";
import type { BatchSummary, ModelOption } from "../types";

const props = defineProps<{
  modelId: string;
  defaultModelId: string;
  concurrency: number;
  defaultConcurrency: number;
  modelOptions: ModelOption[];
  loadingModels: boolean;
  selectedCount: number;
  running: boolean;
  disabled?: boolean;
  summary: BatchSummary;
  inactiveCount?: number;
}>();

const testDisabled = computed(() => {
  if (props.disabled) return true;
  return !props.running && (
    props.loadingModels
    || !props.modelId.trim()
    || props.selectedCount === 0
  );
});

const testDisabledReason = computed(() => {
  if (props.running || props.disabled) return undefined;
  if (props.loadingModels) return "正在获取测试模型，请稍后。";
  if (!props.modelId.trim()) return "请先选择测试模型";
  if (props.selectedCount === 0) return "需先选择账号";
  return undefined;
});

const emit = defineEmits<{
  "update:modelId": [value: string];
  "update:concurrency": [value: number];
  openModels: [];
  setDefaultModel: [value: string];
  setDefaultConcurrency: [value: number];
  testSelected: [];
  cancel: [];
}>();
</script>

<template>
  <section class="batch-test-panel" aria-labelledby="batch-test-heading">
    <h2 id="batch-test-heading" class="batch-test-panel__heading">批量测试</h2>

    <div class="batch-test-panel__controls">
      <div class="batch-test-panel__field">
        <span class="batch-test-panel__label">测试模型</span>
        <ModelPicker
          :model-id="modelId"
          :default-model-id="defaultModelId"
          :model-options="modelOptions"
          :loading="loadingModels"
          :disabled="running || Boolean(disabled)"
          @update:model-id="emit('update:modelId', $event)"
          @set-default="emit('setDefaultModel', $event)"
          @open-models="emit('openModels')"
        />
      </div>

      <div class="batch-test-panel__field">
        <span class="batch-test-panel__label">并发</span>
        <ConcurrencyPicker
          :concurrency="concurrency"
          :default-concurrency="defaultConcurrency"
          :disabled="running || Boolean(disabled)"
          @update:concurrency="emit('update:concurrency', $event)"
          @set-default="emit('setDefaultConcurrency', $event)"
        />
      </div>

      <BatchProgress :summary="summary" :running="running" :inactive-count="inactiveCount" />

      <span class="selection-required-tooltip batch-test-panel__submit-wrap" :title="testDisabledReason">
        <button
          class="button batch-test-panel__submit"
          :class="running ? 'batch-test-panel__submit--cancel' : 'button--primary'"
          type="button"
          :disabled="testDisabled"
          @click="running ? emit('cancel') : emit('testSelected')"
        >
          <X v-if="running" :size="22" />
          <Play v-else :size="22" />
          <span>{{ running ? "取消测试" : `测试选中 ${selectedCount}` }}</span>
        </button>
      </span>
    </div>
  </section>
</template>
