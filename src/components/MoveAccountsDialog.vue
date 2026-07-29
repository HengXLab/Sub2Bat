<script setup lang="ts">
import { FolderPlus, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { AccountGroup } from "../types";

const props = withDefaults(defineProps<{
  open: boolean;
  selectedCount: number;
  groups: AccountGroup[];
  platformLabel?: string | null;
  selectionError?: string | null;
  busy?: boolean;
  error?: string | null;
}>(), {
  platformLabel: null,
  selectionError: null,
  busy: false,
  error: null,
});

const emit = defineEmits<{
  cancel: [];
  move: [groupId: number];
  create: [name: string];
}>();

const selectedGroupId = ref<number | null>(null);
const creatingGroup = ref(false);
const newGroupName = ref("");
const canSubmit = computed(() => selectedGroupId.value !== null && !props.selectionError && !creatingGroup.value);
const canCreate = computed(() => newGroupName.value.trim().length > 0 && !props.selectionError);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    selectedGroupId.value = props.groups[0]?.id ?? null;
    creatingGroup.value = false;
    newGroupName.value = "";
  },
);

watch(
  () => props.groups,
  (groups) => {
    if (!groups.some((group) => group.id === selectedGroupId.value)) {
      selectedGroupId.value = groups[0]?.id ?? null;
    }
  },
);

function submit() {
  if (!canSubmit.value || props.busy) return;
  emit("move", selectedGroupId.value!);
}

function startCreating() {
  if (props.busy || props.selectionError) return;
  creatingGroup.value = true;
}

function cancelCreating() {
  if (props.busy) return;
  creatingGroup.value = false;
  newGroupName.value = "";
}

function submitCreate() {
  if (!canCreate.value || props.busy) return;
  emit("create", newGroupName.value.trim());
}
</script>

<template>
  <div v-if="open" class="account-dialog-backdrop">
    <section class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="move-accounts-title" @keydown.esc="!busy && emit('cancel')">
      <header class="account-dialog__header">
        <div class="account-dialog__title">
          <span class="account-dialog__icon account-dialog__icon--move"><FolderPlus :size="20" aria-hidden="true" /></span>
          <div>
            <h2 id="move-accounts-title">移动选中账号</h2>
            <p>{{ platformLabel ? `由于选中账号为 ${platformLabel} 平台类型账号，这里仅显示 ${platformLabel} 平台分组。` : `将 ${selectedCount} 个已选账号移动到指定分组。` }}</p>
          </div>
        </div>
        <button class="account-dialog__close" type="button" title="关闭" aria-label="关闭" :disabled="busy" @click="emit('cancel')">
          <X :size="18" />
        </button>
      </header>

      <p v-if="selectionError" class="move-dialog__selection-error">{{ selectionError }}</p>
      <label v-else-if="groups.length" class="move-dialog__field">
        <span>目标分组</span>
        <select v-model.number="selectedGroupId" :disabled="busy">
          <option v-for="item in groups" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
      </label>
      <p v-else class="move-dialog__empty">{{ platformLabel ? `暂无 ${platformLabel} 平台的可用分组，请先创建该平台分组后再移动账号。` : "暂无可用分组，请先创建分组后再移动账号。" }}</p>

      <label v-if="creatingGroup && !selectionError" class="move-dialog__field">
        <span>新分组名称</span>
        <input
          v-model="newGroupName"
          :disabled="busy"
          maxlength="120"
          placeholder="输入分组名称"
          @keydown.enter.prevent="submitCreate"
        />
        <small>创建后会立即将这 {{ selectedCount }} 个账号移动到新分组。</small>
      </label>

      <p v-if="error" class="account-dialog__error" role="alert">{{ error }}</p>

      <footer class="account-dialog__actions account-dialog__actions--end">
        <button class="button button--secondary" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
        <button
          v-if="creatingGroup"
          class="button button--secondary"
          type="button"
          :disabled="busy"
          @click="cancelCreating"
        >返回分组列表</button>
        <button
          v-else
          class="button button--secondary"
          type="button"
          :disabled="busy || Boolean(selectionError)"
          @click="startCreating"
        >新建分组</button>
        <button v-if="creatingGroup" class="button button--primary" type="button" :disabled="busy || !canCreate" @click="submitCreate">
          {{ busy ? "正在创建..." : "创建并移动" }}
        </button>
        <button v-else class="button button--primary" type="button" :disabled="busy || !canSubmit" @click="submit">
          {{ busy ? "正在移动..." : "确认移动" }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.account-dialog-backdrop { position: fixed; z-index: 30; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: color-mix(in srgb, var(--ink) 42%, transparent); }
.account-dialog { width: min(100%, 470px); padding: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.account-dialog__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.account-dialog__title { display: flex; align-items: flex-start; gap: 11px; min-width: 0; }
.account-dialog__title h2 { margin: 1px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.account-dialog__title p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.account-dialog__icon { display: inline-grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px; border-radius: 7px; }
.account-dialog__icon--move { color: var(--success); background: var(--success-subtle); }
.account-dialog__close { display: inline-grid; flex: 0 0 auto; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.account-dialog__close:hover:not(:disabled) { color: var(--ink); background: var(--surface-hover); }
.move-dialog__field { display: grid; margin-top: 14px; gap: 7px; color: var(--text); font-size: 13px; font-weight: 650; }
.move-dialog__field select, .move-dialog__field input { width: 100%; height: 40px; padding: 0 10px; color: var(--text-strong); border: 1px solid var(--control-border); border-radius: 6px; background: var(--surface); outline: 0; font: inherit; font-size: 13px; }
.move-dialog__field select:focus, .move-dialog__field input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--focus-soft); }
.move-dialog__field small { color: var(--muted); font-size: 12px; font-weight: 400; line-height: 1.45; }
.move-dialog__empty { margin: 14px 0 0; padding: 10px 12px; color: var(--muted); border: 1px solid var(--border); border-radius: 6px; background: var(--surface-subtle); font-size: 13px; line-height: 1.5; }
.move-dialog__selection-error { margin: 14px 0 0; padding: 10px 12px; color: var(--warning); border: 1px solid var(--warning-border); border-radius: 6px; background: var(--warning-subtle); font-size: 13px; line-height: 1.5; }
.account-dialog__error { margin: 14px 0 0; padding: 10px 12px; color: var(--danger); border: 1px solid var(--danger-border); border-radius: 6px; background: var(--danger-subtle); font-size: 13px; line-height: 1.5; }
.account-dialog__actions { display: flex; gap: 8px; margin-top: 20px; }
.account-dialog__actions--end { justify-content: flex-end; }
@media (max-width: 440px) { .account-dialog-backdrop { align-items: end; padding: 12px; } .account-dialog { padding: 17px; } }
</style>
