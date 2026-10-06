import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/** Prometheus metrics (ADR-0003). A fresh registry per app instance keeps tests isolated. */
export function createMetrics() {
  const registry = new Registry();
  const wsConnections = new Gauge({
    name: 'qp_ws_connections',
    help: 'Open WebSocket connections',
    registers: [registry],
  });
  const rooms = new Gauge({
    name: 'qp_rooms_active',
    help: 'Rooms held in memory',
    registers: [registry],
  });
  const messages = new Counter({
    name: 'qp_ws_messages_total',
    help: 'Client messages by type and result',
    labelNames: ['type', 'result'],
    registers: [registry],
  });
  const inputDuration = new Histogram({
    name: 'qp_room_input_seconds',
    help: 'Time to reduce, persist and dispatch one room input',
    buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [registry],
  });
  const errors = new Counter({
    name: 'qp_errors_total',
    help: 'Internal errors by kind',
    labelNames: ['kind'],
    registers: [registry],
  });
  const security = new Counter({
    name: 'qp_security_events_total',
    help: 'Security events by kind',
    labelNames: ['kind'],
    registers: [registry],
  });
  return { registry, wsConnections, rooms, messages, inputDuration, errors, security };
}

export type Metrics = ReturnType<typeof createMetrics>;
