'use client';

import { useSyncExternalStore } from 'react';
import { account, getAccountVersion, subscribeAccount } from './account.js';

/**
 * 订阅模块级 account 单例。account 是「原地可变对象 + 版本号」，
 * getSnapshot 返回版本号，版本变化触发重渲染后读到的就是最新的 account 字段。
 */
export function useAccount() {
  useSyncExternalStore(subscribeAccount, getAccountVersion, getAccountVersion);
  return account as {
    ready: boolean;
    user: { id: string; email?: string } | null;
    plan: string | null;
    subscription: { plan: string; status: string; current_period_end?: string | null } | null;
    error: string | null;
  };
}
