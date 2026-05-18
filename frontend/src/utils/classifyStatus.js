/**
 * classifyStatus — maps domain status tokens to <Badge variant=""> tokens
 * and to human-readable labels. All labels are intentionally generic.
 *
 * // HOOK FOR ENTERPRISE LABELS — swap the label maps below when proprietary
 * // terminology is introduced; do not change the variant taxonomy.
 */

const VERIFICATION_VARIANTS = {
  pending:        'pending',
  verified_good:  'good',
  verified_bad:   'bad',
};

const VERIFICATION_LABELS = {
  pending:        'ממתין',
  verified_good:  'אומת - תקין',
  verified_bad:   'אומת - פסול',
};

const ACTION_VARIANTS = {
  sent:             'good',
  delivered:        'good',
  scheduled_retry:  'retry',
  failed:           'failed',
  superseded:       'gray',
  pending:          'pending',
};

const ACTION_LABELS = {
  sent:             'נשלח',
  delivered:        'נמסר',
  scheduled_retry:  'מתוזמן לניסיון חוזר',
  failed:           'נכשל',
  superseded:       'הוחלף',
  pending:          'ממתין',
};

export function verificationVariant(status) {
  return VERIFICATION_VARIANTS[status] || 'info';
}

export function verificationLabel(status) {
  return VERIFICATION_LABELS[status] || status || 'לא ידוע';
}

export function actionVariant(status) {
  return ACTION_VARIANTS[status] || 'info';
}

export function actionLabel(status) {
  return ACTION_LABELS[status] || status || 'לא ידוע';
}

// ---------------------------------------------------------------------------
// Phase DX — PipelineTask classification
// ---------------------------------------------------------------------------

const TASK_STATUS_VARIANTS = {
  pending:   'pending',
  assigned:  'retry',     // in-flight; mirrors "scheduled_retry" semantic
  resolved:  'good',
  rejected:  'failed',
};

const TASK_STATUS_LABELS = {
  pending:   'ממתין לטיפול',
  assigned:  'בטיפול',
  resolved:  'טופל',
  rejected:  'נדחה',
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

// ---------------------------------------------------------------------------
// Phase DY — priority & confidence score classification
// ---------------------------------------------------------------------------
// Maps the numeric scores from the backend (0..100 by convention) onto
// the existing Badge variant taxonomy so the UI inherits the same colour
// palette as verification / action / task badges. Cutoffs are deliberately
// generous so scores spanning the boundary don't flicker.

export function priorityVariant(score) {
  if (score == null || Number.isNaN(score)) return 'gray';
  if (score >= 60) return 'good';     // emerald — high priority
  if (score >= 30) return 'pending';  // amber  — medium
  return 'failed';                    // rose   — low / suppressed
}

export function confidenceVariant(score) {
  if (score == null || Number.isNaN(score)) return 'gray';
  if (score >= 75) return 'good';
  if (score >= 40) return 'pending';
  return 'failed';
}

export function tierVariant(tier) {
  if (tier == null) return 'gray';
  if (tier === 1) return 'good';
  if (tier === 2) return 'pending';
  return 'info';
}
