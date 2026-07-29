<script setup lang="ts">
import wingSource from "../assets/startup-bat-wings-transparent.png";
</script>

<template>
  <main class="startup-splash" role="status" aria-label="正在启动" aria-live="polite">
    <div class="startup-bat" aria-hidden="true">
      <span class="startup-bat__wing startup-bat__wing--left">
        <img :src="wingSource" alt="" />
      </span>
      <span class="startup-bat__wing startup-bat__wing--right">
        <img :src="wingSource" alt="" />
      </span>
    </div>
  </main>
</template>

<style scoped>
.startup-splash {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 32px;
  background: #0b1028;
}

.startup-bat {
  position: relative;
  width: min(240px, 46vw);
  aspect-ratio: 2.28 / 1;
  perspective: 760px;
  transform-style: preserve-3d;
}

.startup-bat__wing {
  position: absolute;
  top: 0;
  width: 38%;
  height: 100%;
  overflow: hidden;
  backface-visibility: hidden;
  will-change: transform, opacity;
}

.startup-bat__wing img {
  position: absolute;
  top: -56%;
  display: block;
  width: 331%;
  max-width: none;
  height: auto;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

.startup-bat__wing--left {
  left: 6%;
  transform-origin: 91% 57%;
  animation: bat-wing-flap-left 0.92s cubic-bezier(0.42, 0, 0.58, 1) infinite;
}

.startup-bat__wing--left img {
  left: -26%;
}

.startup-bat__wing--right {
  right: 6%;
  transform-origin: 9% 57%;
  animation: bat-wing-flap-right 0.92s cubic-bezier(0.42, 0, 0.58, 1) infinite;
}

.startup-bat__wing--right img {
  left: -196%;
}

@keyframes bat-wing-flap-left {
  0%, 100% { transform: translate3d(5px, 9px, 0) rotateX(14deg) rotateZ(-12deg) scaleY(0.94); opacity: 0.9; }
  50% { transform: translate3d(-4px, -10px, 0) rotateX(-19deg) rotateZ(18deg) scaleY(1.04); opacity: 1; }
}

@keyframes bat-wing-flap-right {
  0%, 100% { transform: translate3d(-5px, 9px, 0) rotateX(14deg) rotateZ(12deg) scaleY(0.94); opacity: 0.9; }
  50% { transform: translate3d(4px, -10px, 0) rotateX(-19deg) rotateZ(-18deg) scaleY(1.04); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .startup-bat__wing { animation: none; opacity: 1; }
}
</style>
