<template>
  <div class='number-picker'>
    <div ref='list_el' class='wheel' @scroll='onScroll'>
      <div class='spacer'/>
      <button
        v-for='value in values()'
        :key='value'
        type='button'
        class='item'
        :class='{ selected: value === modelValue }'
        @click='select(value)'
      >
        {{ value }}
      </button>
      <div class='spacer'/>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

/**
 * Vertical scroll-wheel number picker mirroring the `numberpicker` package
 * used in the Flutter settings dialogs: three visible rows with the selected
 * value enlarged in the middle, scroll-snapped.
 */
const props = defineProps<{
  modelValue: number;
  min: number;
  max: number;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: number]; }>();

const ITEM_HEIGHT = 36;

const list_el = ref<HTMLElement | null>(null);
let scroll_debounce: ReturnType<typeof setTimeout> | undefined;
let suppress_scroll = false;

function values(): number[] {
  return Array.from({ length: props.max - props.min + 1 }, (_, i) => props.min + i);
}

function scrollToValue(value: number, smooth = false): void {
  const el = list_el.value;
  if (!el) return;
  suppress_scroll = true;
  el.scrollTo({
    top: (value - props.min) * ITEM_HEIGHT,
    behavior: smooth ? 'smooth' : 'instant',
  });
  setTimeout(() => {
    suppress_scroll = false;
  }, smooth ? 300 : 50);
}

function onScroll(): void {
  if (suppress_scroll) return;
  if (scroll_debounce !== undefined) clearTimeout(scroll_debounce);
  scroll_debounce = setTimeout(() => {
    const el = list_el.value;
    if (!el) return;
    const index = Math.round(el.scrollTop / ITEM_HEIGHT);
    const value = Math.min(props.max, Math.max(props.min, props.min + index));
    if (value !== props.modelValue) emit('update:modelValue', value);
  }, 80);
}

function select(value: number): void {
  emit('update:modelValue', value);
  scrollToValue(value, true);
}

onMounted(() => {
  scrollToValue(props.modelValue);
});

watch(
  () => [props.min, props.max],
  () => {
    const clamped = Math.min(props.max, Math.max(props.min, props.modelValue));
    if (clamped !== props.modelValue) emit('update:modelValue', clamped);
    scrollToValue(clamped);
  },
);

watch(
  () => props.modelValue,
  (value) => {
    const el = list_el.value;
    if (!el) return;
    const current = props.min + Math.round(el.scrollTop / ITEM_HEIGHT);
    if (current !== value) scrollToValue(value, true);
  },
);
</script>

<style scoped>
.number-picker {
  border: 1px solid rgb(from var(--secondary) r g b / 0.75);
  border-radius: 12px;
  overflow: hidden;
  width: 64px;
}

.wheel {
  height: calc(36px * 3);
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  scrollbar-width: none;
}

.wheel::-webkit-scrollbar {
  display: none;
}

.spacer {
  height: 36px;
}

.item {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  width: 100%;
  scroll-snap-align: center;
  font-size: 14px;
  color: var(--on-surface);
}

.item.selected {
  font-size: 24px;
  color: var(--primary);
}
</style>
