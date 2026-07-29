<script setup lang="ts">
import { Check, ChevronDown, Gauge } from "@lucide/vue";
import { onBeforeUnmount, onMounted, ref } from "vue";

const CONCURRENCY_OPTIONS = [5, 10, 20, 50, 100] as const;

const props = defineProps<{
  concurrency: number;
  defaultConcurrency: number;
  disabled: boolean;
}>();

const emit = defineEmits<{
  "update:concurrency": [value: number];
  setDefault: [value: number];
}>();

const picker = ref<HTMLElement | null>(null);
const menuOpen = ref(false);

function closeMenu() {
  menuOpen.value = false;
}

function openMenu() {
  if (props.disabled || menuOpen.value) {
    return;
  }

  menuOpen.value = true;
}

function toggleMenu() {
  if (menuOpen.value) {
    closeMenu();
    return;
  }

  openMenu();
}

function selectConcurrency(value: number) {
  emit("update:concurrency", value);
  closeMenu();
}

function setDefaultConcurrency(value: number) {
  emit("setDefault", value);
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
  <div ref="picker" class="concurrency-picker">
    <button
      class="concurrency-picker__trigger"
      type="button"
      :disabled="disabled"
      :aria-expanded="menuOpen"
      aria-haspopup="listbox"
      aria-label="批量测试并发"
      @click="toggleMenu"
    >
      <Gauge class="concurrency-picker__trigger-icon" :size="17" aria-hidden="true" />
      <span class="concurrency-picker__trigger-label">{{ concurrency }} 并发</span>
      <ChevronDown class="concurrency-picker__trigger-chevron" :size="16" aria-hidden="true" />
    </button>

    <div v-if="menuOpen" class="concurrency-picker__menu" role="listbox" aria-label="批量测试并发">
      <div
        v-for="value in CONCURRENCY_OPTIONS"
        :key="value"
        class="concurrency-picker__option"
        :class="{ 'concurrency-picker__option--selected': value === concurrency }"
        role="option"
        :aria-selected="value === concurrency"
        tabindex="0"
        @click="selectConcurrency(value)"
        @keydown.enter.prevent="selectConcurrency(value)"
        @keydown.space.prevent="selectConcurrency(value)"
      >
        <span class="concurrency-picker__default-slot">
          <span v-if="value === defaultConcurrency" class="concurrency-picker__default-marker">默认</span>
          <button
            v-else
            class="concurrency-picker__set-default"
            type="button"
            title="设为默认并发"
            @click.stop="setDefaultConcurrency(value)"
            @keydown.stop
          >
            设为默认
          </button>
        </span>
        <span class="concurrency-picker__option-name">{{ value }} 并发</span>
        <Check v-if="value === concurrency" class="concurrency-picker__selected-icon" :size="16" aria-label="当前并发" />
      </div>
    </div>
  </div>
</template>
