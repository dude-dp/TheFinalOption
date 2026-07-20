// ============================================
// EventBus — Singleton Event Emitter
// ============================================
// Provides decoupled inter-module communication
// without creating circular dependencies.
//
// Usage:
//   import { eventBus } from './event-bus.js';
//   eventBus.emit('system:shutdown');
//   eventBus.on('system:shutdown', () => { ... });
// ============================================

import { EventEmitter } from 'events';

export type SystemEvent =
  | 'system:shutdown'       // StateEngine → WS client: close WebSocket cleanly
  | 'system:halt_recovery'; // StateEngine: user re-enabled RUNNING from HALT

class EventBus extends EventEmitter {}

export const eventBus = new EventBus();
eventBus.setMaxListeners(20);
