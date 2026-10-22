'use client';

import { useSyncExternalStore } from 'react';
import type { User } from '../types';
import { getCurrentUserId, setCurrentUserId } from './prefs';
import { store } from './store';
import { FIRST_USER_NAME } from './store/store';

// Who is practising. Every page shares one copy of the user list and the
// current user, loaded on first use, so switching in the header updates the
// page underneath it.

export type Users =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; list: User[]; current: User };

let users: Users = { state: 'loading' };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Users) {
  users = next;
  listeners.forEach((listener) => listener());
}

/** Reads the users again, keeping `currentId` (or this device's choice) when it still exists. */
export async function reloadUsers(currentId = getCurrentUserId()): Promise<void> {
  try {
    let list = await store.listUsers();
    if (list.length === 0) {
      const first: User = { id: crypto.randomUUID(), name: FIRST_USER_NAME, addedAt: Date.now() };
      await store.putUser(first);
      list = [first];
    }
    const current = list.find((user) => user.id === currentId) ?? list[0];
    setCurrentUserId(current.id);
    publish({ state: 'ready', list, current });
  } catch (e) {
    publish({ state: 'error', message: e instanceof Error ? e.message : 'Could not load the players.' });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  loading ??= reloadUsers();
  return () => listeners.delete(listener);
}

const LOADING: Users = { state: 'loading' };

export function useUsers(): Users {
  return useSyncExternalStore(subscribe, () => users, () => LOADING);
}

export function selectUser(id: string): Promise<void> {
  return reloadUsers(id);
}

/** Adds a player and, unless `select` is false, makes them the current one. */
export async function addUser(name: string, select = true): Promise<User> {
  const user: User = { id: crypto.randomUUID(), name, addedAt: Date.now() };
  await store.putUser(user);
  await reloadUsers(select ? user.id : undefined);
  return user;
}

export async function renameUser(user: User, name: string): Promise<void> {
  await store.putUser({ ...user, name });
  await reloadUsers();
}

/** Deletes the user and all of their runs. */
export async function removeUser(id: string): Promise<void> {
  await store.deleteUser(id);
  await reloadUsers();
}
