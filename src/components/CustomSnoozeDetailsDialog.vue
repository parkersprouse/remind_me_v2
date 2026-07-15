<template>
  <AppDialog :open='open' @dismiss='emit("dismiss")'>
    <template #title>
      <i class='fa-regular fa-clock sub-icon' aria-hidden='true'/>
      <span>Custom Duration</span>
    </template>
    <div class='details-body'>
      <p>
        When enabled, the "Custom Duration" option will allow you to select a custom duration to snooze a notification
        for instead of only being able to select from your chosen fixed durations.
      </p>
      <p>
        Be aware that enabling this option will replace one of the three snooze options within the notification, leaving
        you with only two slots for fixed snooze durations.
      </p>
    </div>
    <template #actions>
      <span class='actions-spacer'/>
      <button type='button' class='btn-text' @click='emit("dismiss")'>Close</button>
    </template>
  </AppDialog>
</template>

<script setup lang="ts">
import AppDialog from '~components/AppDialog.vue';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  dismiss: [];
}>();
</script>
