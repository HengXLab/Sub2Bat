<script setup lang="ts">
import appIcon from "../assets/app-icon.png";

defineProps<{ compact?: boolean }>();
</script>

<template>
  <div class="app-logo" :class="{ 'app-logo--compact': compact }">
    <img :src="appIcon" alt="Sub2Bat" />
    <div v-if="!compact" class="app-logo__text">
      <strong>Sub2Bat</strong>
    </div>
  </div>
</template>
