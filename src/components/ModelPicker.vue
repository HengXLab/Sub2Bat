<script setup lang="ts">
import { Check, ChevronDown, LoaderCircle, SlidersHorizontal } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ModelOption } from "../types";

const props = defineProps<{
  modelId: string;
  defaultModelId: string;
  modelOptions: ModelOption[];
  loading: boolean;
  disabled: boolean;
}>();

const emit = defineEmits<{
  "update:modelId": [value: string];
  setDefault: [value: string];
  openModels: [];
}>();

const picker = ref<HTMLElement | null>(null);
const menuOpen = ref(false);

const selectedModel = computed(() => props.modelOptions.find((model) => model.id === props.modelId));

function modelLabel(model: ModelOption): string {
  if (model.requestedAccounts <= 0) {
    return model.displayName;
  }
  return `${model.displayName} (${model.availableOn}/${model.requestedAccounts})`;
}

const selectedModelLabel = computed(() => {
  if (props.loading) {
    return "正在获取模型...";
  }

  if (selectedModel.value) return modelLabel(selectedModel.value);
  return props.modelId || "请选择测试模型";
});

function openMenu() {
  if (props.disabled || menuOpen.value) {
    return;
  }

  menuOpen.value = true;
  emit("openModels");
}

function toggleMenu() {
  if (menuOpen.value) {
    closeMenu();
    return;
  }

  openMenu();
}

function closeMenu() {
  menuOpen.value = false;
}

function selectModel(modelId: string) {
  emit("update:modelId", modelId);
  closeMenu();
}

function setDefaultModel(modelId: string) {
  emit("setDefault", modelId);
}

function handlePointerDown(event: PointerEvent) {
  if (menuOpen.value && picker.value && !picker.value.contains(event.target as Node)) {
    closeMenu();
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && menuOpen.value) {
    closeMenu();
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", handlePointerDown);
  document.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handlePointerDown);
  document.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div ref="picker" class="model-picker">
    <button
      class="model-picker__trigger"
      type="button"
      :disabled="disabled"
      :aria-expanded="menuOpen"
      aria-haspopup="listbox"
      aria-label="测试模型"
      @click="toggleMenu"
    >
      <SlidersHorizontal class="model-picker__trigger-icon" :size="17" aria-hidden="true" />
      <span class="model-picker__trigger-label">{{ selectedModelLabel }}</span>
      <LoaderCircle v-if="loading" class="model-picker__loading spin" :size="16" aria-label="正在获取模型" />
      <ChevronDown v-else class="model-picker__trigger-chevron" :size="16" aria-hidden="true" />
    </button>

    <div v-if="menuOpen" class="model-picker__menu" role="listbox" aria-label="测试模型">
      <div v-if="loading" class="model-picker__empty">
        <LoaderCircle class="model-picker__loading spin" :size="16" aria-hidden="true" />
        <span>正在获取模型...</span>
      </div>

      <div v-else-if="modelOptions.length === 0" class="model-picker__empty">暂无可用模型</div>

      <template v-else>
        <div
          v-for="model in modelOptions"
          :key="model.id"
          class="model-picker__option"
          :class="{ 'model-picker__option--selected': model.id === modelId }"
          role="option"
          :aria-selected="model.id === modelId"
          tabindex="0"
          @click="selectModel(model.id)"
          @keydown.enter.prevent="selectModel(model.id)"
          @keydown.space.prevent="selectModel(model.id)"
        >
          <span class="model-picker__default-slot">
            <span v-if="model.id === defaultModelId" class="model-picker__default-marker">默认</span>
            <button
              v-else
              class="model-picker__set-default"
              type="button"
              title="设为默认模型"
              @click.stop="setDefaultModel(model.id)"
              @keydown.stop
            >
              设为默认
            </button>
          </span>
          <span class="model-picker__option-name">{{ model.displayName }}</span>
          <span class="model-picker__option-range">
            {{ model.requestedAccounts > 0 ? `(${model.availableOn}/${model.requestedAccounts})` : "尚未读取" }}
          </span>
          <Check v-if="model.id === modelId" class="model-picker__selected-icon" :size="16" aria-label="当前模型" />
        </div>
      </template>
    </div>
  </div>
</template>
