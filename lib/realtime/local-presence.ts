export type LocalPresence = {
  connect(deviceId: string, connectionId: string): void;
  disconnect(deviceId: string, connectionId: string): void;
  has(deviceId: string): boolean;
};

export function createLocalPresence(): LocalPresence {
  const connections = new Map<string, Set<string>>();

  return {
    connect(deviceId, connectionId) {
      const current = connections.get(deviceId) ?? new Set<string>();
      current.add(connectionId);
      connections.set(deviceId, current);
    },

    disconnect(deviceId, connectionId) {
      const current = connections.get(deviceId);
      if (!current) return;
      current.delete(connectionId);
      if (!current.size) connections.delete(deviceId);
    },

    has(deviceId) {
      return (connections.get(deviceId)?.size ?? 0) > 0;
    },
  };
}
