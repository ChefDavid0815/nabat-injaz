export interface ErrorMonitor {
  capture(event: { requestId: string; route: string; code: string }): void;
}
export class StructuredConsoleMonitor implements ErrorMonitor {
  capture(event: { requestId: string; route: string; code: string }) {
    console.error(JSON.stringify({ event: 'request.error', ...event }));
  }
}
export interface TraceHook {
  span(name: string, attributes: Record<string, string>, durationMs: number): void;
}
export const errorMonitor: ErrorMonitor = new StructuredConsoleMonitor();
export const traceHook: TraceHook = {
  span(name, attributes, durationMs) {
    console.info(JSON.stringify({ event: 'trace', name, ...attributes, durationMs }));
  },
};
