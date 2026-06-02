/**
 * classifyStatus — maps domain status tokens to <Badge variant=""> tokens
 * and to human-readable labels. All labels are intentionally generic.
 *
 * // HOOK FOR ENTERPRISE LABELS — swap the label maps below when proprietary
 * // terminology is introduced; do not change the variant taxonomy.
 */

const VERIFICATION_VARIANTS = {
  pending:   'pending',
  verified:  'good',
  rejected:  'bad',
};

const VERIFICATION_LABELS = {
  pending:   'ממתין',
  verified:  'אומת',
  rejected:  'נדחה',
};

export function verificationVariant(status) {
  return VERIFICATION_VARIANTS[status] || 'info';
}

export function verificationLabel(status) {
  return VERIFICATION_LABELS[status] || status || 'לא ידוע';
}

// ---------------------------------------------------------------------------
// Phase DX — PipelineTask classification
// ---------------------------------------------------------------------------

const TASK_STATUS_VARIANTS = {
  pending:  'pending',
  done:     'good',
  rejected: 'failed',
};

const TASK_STATUS_LABELS = {
  pending:  'ממתין לטיפול',
  done:     'טופל',
  rejected: 'נדחה',
};

const TASK_TYPE_VARIANTS = {
  remediation_failure:   'failed',
  approval_required:     'pending',
  manual_recommendation: 'info',
};

const TASK_TYPE_LABELS = {
  remediation_failure:   'תיקון כשל',
  approval_required:     'דרוש אישור',
  manual_recommendation: 'המלצה ידנית',
};

export function taskStatusVariant(status) {
  return TASK_STATUS_VARIANTS[status] || 'info';
}

export function taskStatusLabel(status) {
  return TASK_STATUS_LABELS[status] || status || 'לא ידוע';
}

export function taskTypeVariant(taskType) {
  return TASK_TYPE_VARIANTS[taskType] || 'info';
}

export function taskTypeLabel(taskType) {
  return TASK_TYPE_LABELS[taskType] || taskType || 'לא ידוע';
}

// Maps the numeric score (0.0–1.0) onto the Badge variant taxonomy.
export function scoreVariant(score) {
  if (score == null || Number.isNaN(score)) return 'gray';
  if (score >= 0.6) return 'good';
  if (score >= 0.3) return 'pending';
  return 'failed';
}
