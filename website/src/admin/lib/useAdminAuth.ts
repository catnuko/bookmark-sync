'use client';

import { useSyncExternalStore } from 'react';
import { adminAuth, getAdminAuthVersion, subscribeAdminAuth } from './auth.js';

export function useAdminAuth() {
  useSyncExternalStore(subscribeAdminAuth, getAdminAuthVersion, getAdminAuthVersion);
  return adminAuth as {
    ready: boolean;
    user: { id: string; email?: string } | null;
    isAdmin: boolean;
    checkedAt: number;
  };
}
