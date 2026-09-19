<template>
  <button
    type="button"
    class="switch"
    role="switch"
    :aria-checked="String(modelValue)"
    :aria-label="ariaLabel"
    @click="$emit('update:modelValue', !modelValue)"
  />
</template>

<script setup>
defineProps({
  modelValue: { type: Boolean, required: true },
  ariaLabel: { type: String, default: "" },
});
defineEmits(["update:modelValue"]);
</script>
