<script setup lang="ts">
import { ref } from 'vue';
import AccentColorPicker from '../components/AccentColorPicker.vue';
import BadgedIcon from '../components/BadgedIcon.vue';
import DurationEditDialog from '../components/DurationEditDialog.vue';
import LabeledSwitch from '../components/LabeledSwitch.vue';
import ThemeSelector from '../components/ThemeSelector.vue';
import { durationFromElements, type DurationOption } from '../lib/duration';
import { useSettingsStore } from '../stores/settings';

/**
 * Mirrors SettingsPage: theme selector, Quick-Schedule section, and Reminder
 * Snooze section, each with three editable duration chips.
 */
const settings = useSettingsStore();

type OptionGroup = 'quick' | 'snooze';

const editing = ref<{ group: OptionGroup; index: number; option: DurationOption } | null>(null);

function edit(group: OptionGroup, index: number, option: DurationOption): void {
  editing.value = { group, index, option };
}

function saveEdit(value: number, unit: 'minutes' | 'hours'): void {
  if (editing.value === null) return;
  const { group, index } = editing.value;
  const source =
    group === 'quick' ? [...settings.quickScheduleOptions] : [...settings.notifSnoozeOptions];
  source[index] = durationFromElements(value, unit);
  if (group === 'quick') settings.setQuickScheduleOptions(source);
  else settings.setNotifSnoozeOptions(source);
  editing.value = null;
}
</script>

<template>
  <div class="settings">
    <section class="settings-container theme-section">
      <ThemeSelector />
      <div class="accent-divider">
        <AccentColorPicker />
      </div>
    </section>

    <section class="settings-container">
      <LabeledSwitch
        :model-value="settings.pageTransitions"
        @update:model-value="settings.setPageTransitions($event)"
      >
        <span class="section-title">
          <i class="fa-solid fa-arrow-right-arrow-left section-icon plain-icon" aria-hidden="true"></i>
          Page Transitions
        </span>
      </LabeledSwitch>
    </section>

    <section class="settings-container">
      <LabeledSwitch
        :model-value="settings.showQuickSchedule"
        @update:model-value="settings.setShowQuickSchedule($event)"
      >
        <span class="section-title">
          <BadgedIcon icon="fa-solid fa-bell" badge="fa-solid fa-bolt" :size="17" class="section-icon" />
          Quick-Schedule
        </span>
      </LabeledSwitch>
      <div class="option-chips">
        <button
          v-for="(option, index) in settings.quickOptions"
          :key="`quick-${index}`"
          type="button"
          class="chip chip-pill option-chip"
          @click="edit('quick', index, option)"
        >
          <i class="fa-solid fa-pencil chip-avatar edit-icon" aria-hidden="true"></i>
          {{ option.label }}
        </button>
      </div>
    </section>

    <section class="settings-container">
      <LabeledSwitch
        :model-value="settings.showNotifSnooze"
        @update:model-value="settings.setShowNotifSnooze($event)"
      >
        <span class="section-title">
          <BadgedIcon icon="fa-solid fa-bell" badge="fa-solid fa-circle-pause" :size="17" class="section-icon" />
          Reminder Snooze
        </span>
      </LabeledSwitch>

      <div class="sub-option">
        <LabeledSwitch
          :model-value="settings.notifSnoozeCustomButton"
          @update:model-value="settings.setNotifSnoozeCustomButton($event)"
        >
          <span class="sub-title">
            <i class="fa-regular fa-clock sub-icon" aria-hidden="true"></i>
            Custom duration button
          </span>
        </LabeledSwitch>
      </div>

      <!-- Live preview of the notification's action buttons: the editable
           presets that fit, plus the fixed "Custom…" action when enabled. -->
      <div class="option-chips">
        <button
          v-for="(option, index) in settings.visibleSnoozeOptions"
          :key="`snooze-${index}`"
          type="button"
          class="chip chip-pill option-chip"
          @click="edit('snooze', index, option)"
        >
          <i class="fa-solid fa-pencil chip-avatar edit-icon" aria-hidden="true"></i>
          {{ option.label }}
        </button>
        <span
          v-if="settings.notifSnoozeCustomButton"
          class="chip chip-pill option-chip custom-chip"
        >
          <i class="fa-regular fa-clock chip-avatar" aria-hidden="true"></i>
          Custom…
        </span>
      </div>
    </section>

    <DurationEditDialog
      :option="editing?.option ?? null"
      @save="saveEdit"
      @dismiss="editing = null"
    />
  </div>
</template>

<style scoped>
.settings {
  height: 100%;
  overflow-y: auto;
  padding: 30px 16px;
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.settings-container {
  background-color: var(--surface-variant);
  border-radius: 16px;
  padding: 12px 0;
}

.theme-section {
  padding: 12px 24px;
}

/* Accent sits under the light/dark control as a second theme choice, using the
   same separator idiom as the nested toggles further down the page. */
.accent-divider {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--divider);
}

.section-title {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  font-size: 20px;
  font-weight: 400;
}

.section-icon {
  color: var(--secondary);
}

/* Match the footprint of the BadgedIcon-based section icons */
.plain-icon {
  font-size: 17px;
}

/* Nested sub-toggle within a section, one step down the visual hierarchy. */
.sub-option {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--divider);
}

.sub-title {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  font-size: 16px;
  color: var(--on-surface-variant);
}

.sub-icon {
  color: var(--secondary);
  font-size: 15px;
  width: 17px;
  text-align: center;
}

.option-chips {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 14px 12px 0;
  flex-wrap: wrap;
}

.option-chip {
  font-size: 15px;
  padding: 8px 12px;
}

/* Fixed preview of the "Custom…" action: styled like a preset chip but
   accent-tinted and non-editable (no pencil, not clickable). */
.custom-chip,
.custom-chip:hover {
  color: var(--primary);
  background-color: rgb(from var(--primary) r g b / 0.1);
  cursor: default;
}

.custom-chip .chip-avatar {
  color: var(--primary);
}

.edit-icon {
  font-size: 10px;
}
</style>
