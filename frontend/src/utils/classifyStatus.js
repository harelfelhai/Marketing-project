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
