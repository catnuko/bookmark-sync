<template>
  <div>
    <h4
      class="mb-2 ml-3.5 text-caption font-semibold tracking-[0.06em] text-(--text-secondary-c) uppercase"
    >
      {{ t('spaceslist_title') }}
    </h4>
    <ListGroup>
      <!-- 空间行（+ 换绑确认条） -->
      <template v-for="s in state.spaces" :key="s.id">
        <ListRow>
          <template v-if="state.renamingId === s.id">
            <Input
              v-model="state.renameInput"
              class="min-w-0 flex-1"
              maxlength="50"
              :aria-label="t('spaceslist_nameAria')"
              @keyup.enter="submitRename(s)"
              @keyup.esc="state.renamingId = ''"
            />
            <Button
              variant="secondary"
              size="sm"
              :disabled="!state.renameInput.trim()"
              @click="submitRename(s)"
            >
              {{ t('common_save') }}
            </Button>
            <Button variant="ghost" size="sm" @click="state.renamingId = ''">
              {{ t('common_cancel') }}
            </Button>
          </template>
          <template v-else>
            <span
              class="size-2 flex-none rounded-full"
              :class="isBoundSpace(s.id) ? 'bg-primary' : 'bg-(--text-quaternary)'"
            ></span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 text-body font-medium [overflow-wrap:anywhere]">
                <button
                  type="button"
                  class="-m-1 rounded-xs p-1 text-left font-medium hover:bg-scrim"
                  :title="t('spaceslist_switchTitle')"
                  @click="armRebind(s)"
                >
                  {{ s.name }}
                </button>
                <Badge v-if="s.is_default" variant="secondary">{{ t('spaceslist_default') }}</Badge>
                <Badge v-if="isBoundSpace(s.id)" variant="success">{{
                  t('spaceslist_bound')
                }}</Badge>
              </div>
              <!-- 副行：该空间已登记的其它设备数（本机绑定态由徽标表达） -->
              <div
                v-if="deviceCountForSpace(s.id) > 0"
                class="text-body-sm leading-(--text-body-sm--line-height) text-(--text-secondary-c)"
              >
                {{ t('spaceslist_deviceCount', deviceCountForSpace(s.id)) }}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              :title="t('spaceslist_renameTitle', s.name)"
              :aria-label="t('spaceslist_rename')"
              @click="startRename(s)"
            >
              <Pencil :stroke-width="1.75" />
            </Button>
            <ArmedButton
              v-if="!s.is_default"
              :label="t('spaceslist_delete')"
              :confirm-label="t('spaceslist_deleteConfirm')"
              :armed="state.armed === `space:${s.id}`"
              :countdown="state.armed === `space:${s.id}` ? state.armedLeft : 0"
              @press="doDeleteSpace(s)"
            />
          </template>
        </ListRow>
        <!-- 换绑确认条：换绑 = 清空本机书签并从该空间重建，是破坏性动作，
             必须显式二次确认（不使用 ArmedButton，因为需要展示完整后果说明）。 -->
        <ListRow v-if="state.rebindTarget === s.id" class="bg-scrim">
          <span
            class="min-w-0 flex-1 text-body-sm leading-(--text-body-sm--line-height) text-(--text-secondary-c) [overflow-wrap:anywhere]"
          >
            {{
              t(state.activeSpace ? 'spaceslist_rebindConfirm' : 'spaceslist_bindConfirm', s.name)
            }}
          </span>
          <Button
            variant="outline-destructive"
            size="sm"
            :disabled="state.spaceBusy"
            @click="doRebindSpace(s)"
          >
            {{ t('spaceslist_rebindBtn') }}
          </Button>
          <Button variant="ghost" size="sm" @click="state.rebindTarget = ''">
            {{ t('common_cancel') }}
          </Button>
        </ListRow>
      </template>

      <!-- 新建空间：点击展开输入 -->
      <template v-if="state.creatingSpace">
        <ListRow>
          <Input
            v-model="state.newSpaceName"
            class="min-w-0 flex-1"
            :placeholder="t('spaceslist_newPh')"
            maxlength="50"
            :aria-label="t('spaceslist_newPh')"
            data-test="spaces-new-input"
            @keyup.enter="doCreateSpace"
          />
          <Button
            variant="default"
            size="sm"
            data-test="spaces-new-submit"
            :disabled="!state.newSpaceName.trim() || state.spaceBusy"
            @click="doCreateSpace"
          >
            {{ t('spaceslist_create') }}
          </Button>
          <Button variant="ghost" size="sm" @click="state.creatingSpace = false">
            {{ t('common_cancel') }}
          </Button>
        </ListRow>
      </template>
      <ListRow
        v-else
        as="button"
        clickable
        data-test="spaces-new"
        @click="state.creatingSpace = true"
      >
        <template #leading>
          <Plus :stroke-width="1.75" />
        </template>
        <div class="text-body font-medium">{{ t('spaceslist_new') }}</div>
        <template #tail>
          <span
            class="min-w-0 shrink text-right text-body-sm text-(--text-secondary-c) [overflow-wrap:anywhere]"
          >
            {{ t('spaceslist_limit', planLabel, spaceLimit, state.spaces.length) }}
          </span>
        </template>
      </ListRow>
    </ListGroup>
  </div>
</template>

<script setup>
import { Pencil, Plus } from '@lucide/vue';
import {
  state,
  isBoundSpace,
  armRebind,
  doRebindSpace,
  doCreateSpace,
  startRename,
  submitRename,
  doDeleteSpace,
  deviceCountForSpace,
  spaceLimit,
  planLabel,
} from '../../store.js';
import { t } from '../../lib/i18n.js';
import ArmedButton from './ArmedButton.vue';
import Badge from '../ui/badge/Badge.vue';
import Button from '../ui/button/Button.vue';
import Input from '../ui/input/Input.vue';
import ListGroup from './ListGroup.vue';
import ListRow from './ListRow.vue';
</script>
