export const entitlements = {
  personal: { plants: 25, team: 1, analytics: true, sensors: false },
  pro: { plants: 250, team: 5, analytics: true, sensors: false },
  business: { plants: 5000, team: 50, analytics: true, sensors: false },
} as const;
export interface BillingProvider {
  checkout(workspaceId: string, plan: string): Promise<{ url: string }>;
}
export interface SensorProvider {
  read(
    deviceId: string,
  ): Promise<{ moisture?: number; temperature?: number; light?: number; capturedAt: string }>;
}
export interface NotificationProvider {
  deliver(workspaceId: string, alertId: string): Promise<void>;
}
export interface OfflineCareQueue {
  enqueue(input: {
    plantId: string;
    type: string;
    idempotencyKey: string;
    occurredAt: string;
  }): Promise<void>;
  flush(): Promise<void>;
}
