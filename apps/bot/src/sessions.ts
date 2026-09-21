import { optionalEnv } from '@autopilot/analytics-core';
import { MemorySession } from '@openai/agents';

/**
 * Per-chat state: conversation memory, the active app, and a mutex so one chat
 * never has two agent runs interleaving their tool calls.
 */
type ChatState = { session: MemorySession; app: string; busy: boolean };

const chats = new Map<number, ChatState>();

function state(chatId: number): ChatState {
  let s = chats.get(chatId);
  if (!s) {
    s = { session: new MemorySession(), app: optionalEnv('DEFAULT_APP', 'plusfit'), busy: false };
    chats.set(chatId, s);
  }
  return s;
}

export const sessionFor = (chatId: number): MemorySession => state(chatId).session;
export const appFor = (chatId: number): string => state(chatId).app;

export function setApp(chatId: number, app: string): void {
  const s = state(chatId);
  s.app = app;
  // A different app means different events; stale history would mislead the agent.
  s.session = new MemorySession();
}

export function resetSession(chatId: number): void {
  state(chatId).session = new MemorySession();
}

/** Returns a release function, or null when the chat already has a run in flight. */
export function tryLock(chatId: number): (() => void) | null {
  const s = state(chatId);
  if (s.busy) return null;
  s.busy = true;
  return () => {
    s.busy = false;
  };
}
