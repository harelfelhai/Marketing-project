/**
 * classifyStatus — Hebrew label + Badge-variant mappers.
 *
 * Phase DX added taskStatusVariant / taskStatusLabel / taskTypeVariant /
 * taskTypeLabel; this suite covers the new mappings plus their unknown-
 * value fallbacks.
 */

import { describe, it, expect } from 'vitest';

import {
  taskStatusVariant, taskStatusLabel,
  taskTypeVariant,   taskTypeLabel,
  verificationVariant, verificationLabel,
  actionVariant,     actionLabel,
} from '../../src/utils/classifyStatus';


describe('taskStatusVariant', () => {
  it.each([
    ['pending',  'pending'],
    ['assigned', 'retry'],
    ['resolved', 'good'],
    ['rejected', 'failed'],
  ])('maps %s → %s', (status, variant) => {
    expect(taskStatusVariant(status)).toBe(variant);
  });

  it('falls back to "info" for unknown status', () => {
    expect(taskStatusVariant('nonsense')).toBe('info');
    expect(taskStatusVariant(undefined)).toBe('info');
    expect(taskStatusVariant(null)).toBe('info');
  });
});


describe('taskStatusLabel', () => {
  it.each([
    ['pending',  'ממתין לטיפול'],
    ['assigned', 'בטיפול'],
    ['resolved', 'טופל'],
    ['rejected', 'נדחה'],
  ])('maps %s → %s', (status, label) => {
    expect(taskStatusLabel(status)).toBe(label);
  });

  it('echoes the input when unknown (operator can still see the raw token)', () => {
    expect(taskStatusLabel('weird_status')).toBe('weird_status');
  });

  it('returns "לא ידוע" for null/empty input', () => {
    expect(taskStatusLabel(null)).toBe('לא ידוע');
    expect(taskStatusLabel('')).toBe('לא ידוע');
  });
});


describe('taskTypeVariant', () => {
  it.each([
    ['remediation_failure',   'failed'],
    ['approval_required',     'pending'],
    ['manual_recommendation', 'info'],
  ])('maps %s → %s', (taskType, variant) => {
    expect(taskTypeVariant(taskType)).toBe(variant);
  });

  it('falls back to "info" for unknown task_type', () => {
    expect(taskTypeVariant('new_kind')).toBe('info');
  });
});


describe('taskTypeLabel', () => {
  it.each([
    ['remediation_failure',   'תיקון כשל'],
    ['approval_required',     'דרוש אישור'],
    ['manual_recommendation', 'המלצה ידנית'],
  ])('maps %s → %s', (taskType, label) => {
    expect(taskTypeLabel(taskType)).toBe(label);
  });

  it('echoes unknown task_type tokens', () => {
    expect(taskTypeLabel('my_custom_type')).toBe('my_custom_type');
  });
});


describe('verification + action mappers — sanity (legacy mappings)', () => {
  it('verification still maps the three legacy values', () => {
    expect(verificationVariant('verified_good')).toBe('good');
    expect(verificationLabel('verified_bad')).toBe('אומת - פסול');
  });

  it('action still maps the lifecycle vocabulary', () => {
    expect(actionVariant('scheduled_retry')).toBe('retry');
    expect(actionLabel('delivered')).toBe('נמסר');
  });
});
