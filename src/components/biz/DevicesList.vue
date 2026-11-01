<template>
  <div>
    <h4
      class="mb-2 ml-3.5 text-caption font-semibold tracking-[0.06em] text-(--text-secondary-c) uppercase"
    >
      {{ t('devices_title') }}
    </h4>
    <ListGroup v-if="state.devices.length">
      <ListRow v-for="d in state.devices" :key="d.device_id">
        <template #leading>
          <component :is="isMobile(d) ? Smartphone : Monitor" :stroke-width="1.75" />
        </template>
        <template v-if="state.renamingDeviceId === d.device_id">
          <Input
            v-model="state.deviceRenameInput"
            class="min-w-0 flex-1"
            maxlength="50"
            :placeholder="t('devices_namePh')"
            :aria-label="t('devices_namePh')"
            @keyup.enter="submitDeviceRename(d)"
            @keyup.esc="state.renamingDeviceId = ''"
          />
          <Button
            variant="secondary"
            size="sm"
            :disabled="!state.deviceRenameInput.trim()"
            @click="submitDeviceRename(d)"
          >
            {{ t('common_save') }}
          </Button>
          <Button variant="ghost" size="sm" @click="state.renamingDeviceId = ''">
            {{ t('common_cancel') }}
          </Button>
        </template>
        <template v-else>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 text-body font-medium [overflow-wrap:anywhere]">
              {{ deviceLabel(d) }}
              <Badge v-if="d.device_id === state.myDeviceId" variant="info">{{
                t('devices_thisDevice')
              }}</Badge>
            </div>
            <div
              v-if="deviceSpaceName(d) || d.last_sync_at"
              class="text-body-sm leading-(--text-body-sm--line-height) text-(--text-secondary-c)"
            >
              {{ deviceSpaceName(d) ? deviceSpaceName(d) + ' · ' : ''
              }}{{ d.last_sync_at ? t('devices_lastSync', fmtRelative(d.last_sync_at)) : '' }}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            :title="t('devices_renameTitle', deviceLabel(d))"
            :aria-label="t('devices_rename')"
            @click="startDeviceRename(d)"
          >
            <Pencil :stroke-width="1.75" />
          </Button>
          <ArmedButton
            v-if="d.device_id !== state.myDeviceId"
            :label="t('devices_disconnect')"
            :confirm-label="t('devices_disconnectConfirm')"
            :armed="state.armed === `device:${d.device_id}`"
            :countdown="state.armed === `device:${d.device_id}` ? state.armedLeft : 0"
            @press="doRemoveDevice(d)"
          />
        </template>
      </ListRow>
    </ListGroup>
    <Alert v-else variant="info">
      <Monitor :stroke-width="1.75" />
      <span>{{ t('devices_empty') }}</span>
    </Alert>
    <p
      class="mt-2 ml-3.5 text-caption leading-(--text-caption--line-height) text-(--text-secondary-c)"
    >
      {{ t('devices_foot') }}
    </p>
  </div>
</template>

<script setup>
import { Monitor, Pencil, Smartphone } from '@lucide/vue';
import {
  state,
  doRemoveDevice,
  startDeviceRename,
  submitDeviceRename,
  deviceLabel,
  deviceSpaceName,
  fmtRelative,
} from '../../store.js';
import { t } from '../../lib/i18n.js';
import ArmedButton from './ArmedButton.vue';
import Alert from '../ui/alert/Alert.vue';
import Badge from '../ui/badge/Badge.vue';
import Button from '../ui/button/Button.vue';
import Input from '../ui/input/Input.vue';
import ListGroup from './ListGroup.vue';
import ListRow from './ListRow.vue';

function isMobile(d) {
  const n = String(d.name ?? '').toLowerCase();
  return (
    n.includes('android') || n.includes('iphone') || n.includes('ipad') || n.includes('mobile')
  );
}
</script>
