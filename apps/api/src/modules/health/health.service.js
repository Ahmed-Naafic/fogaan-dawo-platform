/** Business logic lives in services. Health reports process status only. */
export function getHealth() {
  return {
    status: 'ok',
    service: 'fogaan-dawo-api',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
