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
  pending:        'Pending',
  verified_good:  'Verified Good',
  verified_bad:   'Verified Bad',
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
  sent:             'Sent',
  delivered:        'Delivered',
  scheduled_retry:  'Scheduled Retry',
  failed:           'Failed',
  superseded:       'Superseded',
  pending:          'Pending',
};

export function verificationVariant(status) {
  return VERIFICATION_VARIANTS[status] || 'info';
}

export function verificationLabel(status) {
  return VERIFICATION_LABELS[status] || status || 'Unknown';
}

export function actionVariant(status) {
  return ACTION_VARIANTS[status] || 'info';
}

export function actionLabel(status) {
  return ACTION_LABELS[status] || status || 'Unknown';
}
