<script setup lang="ts">
import { RefreshCw, SlidersHorizontal } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const MIN_AUTO_REFRESH_SECONDS = 5;
const MAX_AUTO_REFRESH_SECONDS = 3600;
const DEFAULT_AUTO_REFRESH_SECONDS = 30;

const props = withDefaults(defineProps<{
  loading: boolean;
  autoRefreshSeconds: number;
  disabled?: boolean;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  refresh: [];
  setAutoRefreshSeconds: [value: number];
}>();

const control = ref<HTMLElement | null>(null);
const menuOpen = ref(false);
const automatic = ref(false);
const intervalSeconds = ref(String(DEFAULT_AUTO_REFRESH_SECONDS));

const parsedIntervalSeconds = computed(() => Number(intervalSeconds.value));
const intervalValid = computed(
  () =>
    Number.isInteger(parsedIntervalSeconds.value) &&
    parsedIntervalSeconds.value >= MIN_AUTO_REFRESH_SECONDS &&
    parsedIntervalSeconds.value <= MAX_AUTO_REFRESH_SECONDS,
);

function resetDraft() {
  const saved = Number.isFinite(props.autoRefreshSeconds) ? Math.trunc(props.autoRefreshSeconds) : 0;
  automatic.value = saved > 0;
  intervalSeconds.value = String(
    saved >= MIN_AUTO_REFRESH_SECONDS && saved <= MAX_AUTO_REFRESH_SECONDS ? saved : DEFAULT_AUTO_REFRESH_SECONDS,
  );
}

function closeMenu() {
  menuOpen.value = false;
}

function openMenu() {
  if (props.disabled || menuOpen.value) {
    return;
  }

  resetDraft();
  menuOpen.value = true;
}

function toggleMenu() {
  if (menuOpen.value) {
    closeMenu();
    return;
  }

  openMenu();
}

function updateAutomatic(event: Event) {
  automatic.value = (event.target as HTMLInputElement).checked;
  if (automatic.value && !intervalValid.value) {
    intervalSeconds.value = String(DEFAULT_AUTO_REFRESH_SECONDS);
  }
}

function updateInterval(event: Event) {
  intervalSeconds.value = (event.target as HTMLInputElement).value;
}

function applySettings() {
  if (props.disabled || (automatic.value && !intervalValid.value)) {
    return;
  }

  emit("setAutoRefreshSeconds", automatic.value ? parsedIntervalSeconds.value : 0);
  closeMenu();
}

function handlePointerDown(event: PointerEvent) {
  if (menuOpen.value && control.value && !control.value.contains(event.target as Node)) {
    closeMenu();
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && menuOpen.value) {
    closeMenu();
  }
}

watch(
  () => props.autoRefreshSeconds,
  () => {
    if (!menuOpen.value) {
      resetDraft();
    }
  },
  { immediate: true },
);

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
  <div ref="control" class="refresh-control">
    <button
      class="refresh-control__refresh-button"
      type="button"
      title="刷新账号列表"
      aria-label="刷新账号列表"
      :disabled="disabled || loading"
      @click="emit('refresh')"
    >
      <RefreshCw :class="{ spin: loading }" :size="22" aria-hidden="true" />
    </button>

    <button
      class="refresh-control__settings-button"
      type="button"
      title="刷新设置"
      aria-label="刷新设置"
      aria-haspopup="dialog"
      :aria-expanded="menuOpen"
      :disabled="disabled"
      @click="toggleMenu"
    >
      <SlidersHorizontal :size="17" aria-hidden="true" />
    </button>

    <section v-if="menuOpen" class="refresh-control__menu" role="dialog" aria-label="刷新设置">
      <header class="refresh-control__menu-heading">
        <strong>刷新设置</strong>
      </header>

      <label class="refresh-control__automatic-option">
        <strong>自动刷新</strong>
        <span class="refresh-control__switch">
          <input type="checkbox" :checked="automatic" :disabled="disabled" @change="updateAutomatic" />
          <span aria-hidden="true"></span>
        </span>
      </label>

      <label class="refresh-control__interval-field" :class="{ 'refresh-control__interval-field--disabled': !automatic }">
        <span>刷新间隔</span>
        <span>
          <input
            type="number"
            inputmode="numeric"
            :value="intervalSeconds"
            :min="MIN_AUTO_REFRESH_SECONDS"
            :max="MAX_AUTO_REFRESH_SECONDS"
            step="1"
            :disabled="disabled || !automatic"
            @input="updateInterval"
          />
          <em>秒</em>
        </span>
      </label>

      <p v-if="automatic && !intervalValid" class="refresh-control__validation" role="alert">
        请输入 {{ MIN_AUTO_REFRESH_SECONDS }} 到 {{ MAX_AUTO_REFRESH_SECONDS }} 之间的整数秒数。
      </p>

      <footer class="refresh-control__actions">
        <button class="button button--secondary" type="button" @click="closeMenu">取消</button>
        <button class="button button--primary" type="button" :disabled="automatic && !intervalValid" @click="applySettings">应用</button>
      </footer>
    </section>
  </div>
</template>
