// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of AgentDock Bridge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and ADDITIONAL_TERMS.zh-CN.md; ref: ADDITIONAL_TERMS.en.md).
export const HEARTBEAT_MAX_AGE = 65000;
export const FIRST_HEARTBEAT_GRACE = 10000;

export function connectionLiveness(acceptedAt, heartbeatAt, now = Date.now()) {
  const validHeartbeat = Number.isFinite(heartbeatAt) && heartbeatAt >= acceptedAt && heartbeatAt <= now;
  const online = validHeartbeat && now - heartbeatAt < HEARTBEAT_MAX_AGE;
  const reserved = online || (!validHeartbeat && Number.isFinite(acceptedAt) && acceptedAt <= now && now - acceptedAt < FIRST_HEARTBEAT_GRACE);
  return { online, reserved, expiresAt: validHeartbeat ? heartbeatAt + HEARTBEAT_MAX_AGE : acceptedAt + FIRST_HEARTBEAT_GRACE };
}
