import { test, expect } from 'vitest';
import { createApprovalGrant, verifyApprovalGrant } from '../../api/_lib/pclink.js';

const secret = 'device-secret-that-is-at-least-32-characters-long';

test('phone task grants are signed and bound to task, machine, and instructions', () => {
  const now = Date.now();
  const grant = createApprovalGrant({ taskId: 'task_123', uid: 'user_1', machineId: 'machine-1', instructions: 'run tests', secret, now });
  const payload = verifyApprovalGrant(grant, secret, { taskId: 'task_123', uid: 'user_1', machineId: 'machine-1' }, now + 1);
  expect(payload).not.toBeNull();
  expect(payload.instructionsHash).toHaveLength(64);
  expect(payload.allowedTools).toContain('run_command');
  expect(verifyApprovalGrant(grant, secret, { taskId: 'task_123', instructionsHash: 'wrong' }, now + 1)).toBeNull();
});

test('expired or tampered grants are rejected', () => {
  const now = Date.now();
  const grant = createApprovalGrant({ taskId: 'task_123', uid: 'user_1', machineId: 'machine-1', instructions: 'run tests', secret, now });
  expect(verifyApprovalGrant(grant, secret, {}, now + 16 * 60_000)).toBeNull();
  expect(verifyApprovalGrant(`${grant}x`, secret, {}, now + 1)).toBeNull();
  expect(verifyApprovalGrant(grant, 'wrong-secret-that-is-at-least-32-characters', {}, now + 1)).toBeNull();
});
