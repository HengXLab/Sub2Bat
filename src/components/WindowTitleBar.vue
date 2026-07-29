<script setup lang="ts">
import { Maximize2, Minimize2, Minus, X } from "@lucide/vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onBeforeUnmount, onMounted, ref } from "vue";
import appIcon from "../assets/app-icon.png";

const desktopWindow = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  ? getCurrentWindow()
  : null;
const emit = defineEmits<{ "request-close": [] }>();
const maximized = ref(false);
let unlistenResize: (() => void) | undefined;

async function syncMaximized() {
  if (!desktopWindow) return;
  maximized.value = await desktopWindow.isMaximized();
}

function runWindowAction(action: () => Promise<void>) {
  void action().catch(() => undefined);
}

function minimizeWindow() {
  if (!desktopWindow) return;
  runWindowAction(() => desktopWindow.minimize());
}

function toggleMaximize() {
  if (!desktopWindow) return;
  runWindowAction(async () => {
    await desktopWindow.toggleMaximize();
    await syncMaximized();
  });
}

function startDragging() {
  if (!desktopWindow) return;
  runWindowAction(() => desktopWindow.startDragging());
}

onMounted(() => {
  if (!desktopWindow) return;

  void syncMaximized();
  void desktopWindow
    .onResized(() => {
      void syncMaximized();
    })
    .then((unlisten) => {
      unlistenResize = unlisten;
    })
    .catch(() => undefined);
});

onBeforeUnmount(() => {
  unlistenResize?.();
});
</script>

<template>
  <header class="window-titlebar" aria-label="应用标题栏">
    <div class="window-titlebar__drag" @mousedown.left="startDragging" @dblclick="toggleMaximize">
      <img :src="appIcon" alt="" aria-hidden="true" />
      <span>Sub2Bat</span>
    </div>
    <div class="window-titlebar__controls" aria-label="窗口控制">
      <button class="window-titlebar__button" type="button" title="最小化" aria-label="最小化" @click="minimizeWindow">
        <Minus :size="18" stroke-width="2.5" aria-hidden="true" />
      </button>
      <button
        class="window-titlebar__button"
        type="button"
        :title="maximized ? '还原窗口' : '最大化'"
        :aria-label="maximized ? '还原窗口' : '最大化'"
        @click="toggleMaximize"
      >
        <Minimize2 v-if="maximized" :size="15" aria-hidden="true" />
        <Maximize2 v-else :size="15" aria-hidden="true" />
      </button>
      <button class="window-titlebar__button window-titlebar__button--close" type="button" title="关闭" aria-label="关闭" @click="emit('request-close')">
        <X :size="17" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.window-titlebar {
  position: relative;
  z-index: 100;
  display: flex;
  flex: 0 0 36px;
  align-items: stretch;
  height: 36px;
  color: #f5f3ff;
  border-bottom: 1px solid rgba(177, 156, 255, 0.26);
  background: #111632;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.18);
  user-select: none;
}

.window-titlebar__drag {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 12px;
  gap: 8px;
}

.window-titlebar__drag img {
  width: 20px;
  height: 20px;
  border-radius: 5px;
}

.window-titlebar__drag span {
  overflow: hidden;
  color: inherit;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.window-titlebar__controls {
  display: flex;
  align-items: stretch;
  flex: 0 0 auto;
}

.window-titlebar__button {
  display: inline-grid;
  place-items: center;
  width: 46px;
  padding: 0;
  color: #e9e7ff;
  background: transparent;
  cursor: pointer;
  transition: color 0.14s ease, background 0.14s ease;
}

.window-titlebar__button:hover { color: #ffffff; background: rgba(164, 143, 255, 0.2); }
.window-titlebar__button:focus-visible { outline: 2px solid #8adcf5; outline-offset: -3px; }
.window-titlebar__button--close:hover { background: #c83f64; }
</style>
