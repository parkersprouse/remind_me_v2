<template>
  <span class='badged-icon' :style='{ fontSize: `${size}px` }'>
    <i :class='icon' aria-hidden='true'/>
    <span v-if='badge' class='badge'>
      <i :class='badge' aria-hidden='true'/>
    </span>
  </span>
</template>

<script setup lang="ts">
/**
 * A Font Awesome icon with a small circular badge icon at its bottom-right.
 * Stands in for the FA Pro combined glyphs the Flutter app used
 * (bell-circle-plus, bell-circle-bolt, bell-circle-snooze) using free icons.
 */
withDefaults(
  defineProps<{
    icon: string;
    badge?: string;
    size?: number;
  }>(),
  {
    badge: undefined,
    size: 24,
  },
);
</script>

<style scoped>
.badged-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.badge {
  position: absolute;
  right: -0.2em;
  bottom: -0.15em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.55em;
  background-color: var(--surface);
  border-radius: 50%;
  padding: 0.08em;
}
</style>
