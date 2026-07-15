<template>
  <span class='badged-icon' :style='{ fontSize: `${size}px` }'>
    <i :class='icon' aria-hidden='true'/>
    <span v-if='badge' class='badge' :class='{ "badge-active": active }'>
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
    active?: boolean;
    badge?: string;
    icon: string;
    size?: number;
  }>(),
  {
    active: true,
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
  filter: saturate(150%) drop-shadow(0 0 1px var(--surface));
  font-size: 0.55em;
  border-radius: 100%;

}

.badge.badge-active {
  color: var(--on-tertiary-container);
}
</style>
