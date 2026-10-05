<template>
  <button>{{ t('common.save') }}</button>
  <span>{{ t('common.nope') }}</span>
  <span>{{ t(`home.${page}`) }}</span>
  <!-- 這是註解不該被抓 -->
  <h1>硬編碼標題</h1>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
// 註解中文也不該被抓
const label = t('common.' + kind)
</script>
