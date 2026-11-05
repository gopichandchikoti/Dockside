import type { AlertRule } from '@dockside/shared';

export function evaluateRule(
  rule: AlertRule,
  value: number | null,
  at: number,
): Pick<AlertRule, 'state' | 'pendingSince' | 'silencedUntil' | 'value'> {
  const base = { pendingSince: rule.pendingSince, silencedUntil: rule.silencedUntil, value };
  if (!rule.enabled) return { ...base, state: 'ok', pendingSince: null };
  if ((rule.silencedUntil ?? 0) > at) return { ...base, state: 'silenced' };
  if (value === null) return { ...base, state: missingState(rule), pendingSince: null };
  const breached = thresholdBreached(rule, value);
  if (!breached) return { ...base, state: 'ok', pendingSince: null, silencedUntil: null };
  if (rule.state === 'acknowledged') return { ...base, state: 'acknowledged' };
  if (rule.state === 'firing') return { ...base, state: 'firing' };
  const pendingSince = rule.pendingSince ?? at;
  return {
    ...base,
    state: at - pendingSince >= rule.durationSeconds ? 'firing' : 'pending',
    pendingSince,
    silencedUntil: null,
  };
}
function thresholdBreached(rule: AlertRule, value: number): boolean {
  return rule.operator === 'gt' ? value > rule.threshold : value < rule.threshold;
}
function missingState(rule: AlertRule): AlertRule['state'] {
  return rule.state === 'pending' ? 'ok' : rule.state;
}
