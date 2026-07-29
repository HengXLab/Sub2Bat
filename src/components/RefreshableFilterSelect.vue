<script setup lang="ts">
import { ChevronDown } from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

export interface RefreshableFilterOption {
  value: string;
  label: string;
}

const props = withDefaults(defineProps<{
  modelValue: string;
  options: readonly RefreshableFilterOption[];
  label: string;
  disabled?: boolean;
  refreshOptions?: () => Promise<boolean>;
}>(), {
  disabled: false,
  refreshOptions: undefined,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const menuOpen = ref(false);
const refreshing = ref(false);
const selectedLabel = computed(() => props.options.find((option) => option.value === props.modelValue)?.label ?? props.label);

async function toggleMenu() {
  if (props.disabled || refreshing.value) return;
  if (menuOpen.value) {
    menuOpen.value = false;
    return;
  }

  refreshing.value = true;
  try {
    const refreshed = props.refreshOptions ? await props.refreshOptions() : true;
    if (!refreshed || props.disabled) return;
    menuOpen.value = true;
    await nextTick();
  } finally {
    refreshing.value = false;
  }
}

function select(value: string) {
  if (props.disabled) return;
  emit("update:modelValue", value);
  menuOpen.value = false;
  trigger.value?.focus();
}

function closeOnOutsidePointer(event: PointerEvent) {
  if (menuOpen.value && root.value && !root.value.contains(event.target as Node)) {
    menuOpen.value = false;
  }
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape" && menuOpen.value) {
    menuOpen.value = false;
    trigger.value?.focus();
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", closeOnOutsidePointer);
  document.addEventListener("keydown", closeOnEscape);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeOnOutsidePointer);
  document.removeEventListener("keydown", closeOnEscape);
});
</script>

<template>
  <div ref="root" class="refreshable-filter-select">
    <button
      ref="trigger"
      class="refreshable-filter-select__trigger"
      type="button"
      :disabled="disabled || refreshing"
      :aria-label="label"
      aria-haspopup="listbox"
      :aria-expanded="menuOpen"
      @click="toggleMenu"
    >
      <span>{{ refreshing ? "正在刷新..." : selectedLabel }}</span>
      <ChevronDown :size="15" aria-hidden="true" />
    </button>
    <section v-if="menuOpen" class="refreshable-filter-select__menu" role="listbox" :aria-label="label">
      <button
        v-for="option in options"
        :key="option.value"
        class="refreshable-filter-select__option"
        :class="{ 'is-selected': option.value === modelValue }"
        type="button"
        role="option"
        :aria-selected="option.value === modelValue"
        @click="select(option.value)"
      >
        {{ option.label }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.refreshable-filter-select { position: relative; min-width: 0; }
.refreshable-filter-select__trigger { display: flex; align-items: center; justify-content: space-between; width: 100%; height: 34px; padding: 0 9px 0 10px; gap: 8px; color: var(--text-strong); border: 1px solid var(--control-border); border-radius: 5px; background: var(--surface); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.refreshable-filter-select__trigger:hover:not(:disabled) { border-color: var(--border-hover); background: var(--surface-hover); }
.refreshable-filter-select__trigger:focus-visible { border-color: var(--brand); outline: 0; box-shadow: 0 0 0 3px var(--focus-soft); }
.refreshable-filter-select__trigger:disabled { cursor: wait; opacity: 0.62; }
.refreshable-filter-select__trigger span { overflow: hidden; min-width: 0; text-overflow: ellipsis; white-space: nowrap; }
.refreshable-filter-select__trigger svg { flex: 0 0 auto; color: var(--muted); }
.refreshable-filter-select__menu { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; display: grid; width: max-content; min-width: 100%; max-width: min(280px, calc(100vw - 32px)); max-height: min(320px, calc(100vh - 160px)); overflow-y: auto; padding: 4px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); box-shadow: 0 12px 30px var(--shadow); }
.refreshable-filter-select__option { min-width: 0; padding: 7px 9px; color: var(--text); border-radius: 4px; background: transparent; font: inherit; font-size: 12px; text-align: left; cursor: pointer; white-space: nowrap; }
.refreshable-filter-select__option:hover, .refreshable-filter-select__option:focus-visible { color: var(--text-strong); background: var(--surface-hover); outline: 0; }
.refreshable-filter-select__option.is-selected { color: var(--brand-ink); background: var(--brand-subtle); font-weight: 650; }
</style>
