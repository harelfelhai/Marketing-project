/**
 * strings.he.js — Hebrew UI strings (centralized translation layer).
 *
 * All user-visible text in the application is defined here.
 * Components import named exports and never hard-code display strings.
 *
 * Dynamic strings are exported as functions receiving interpolation args.
 *
 * // HOOK FOR ENTERPRISE LABELS — to swap back to English or add a second
 * // locale, replace this file's exports without touching any component.
 */

// ---------------------------------------------------------------------------
// Layout & Navigation
// ---------------------------------------------------------------------------

export const APP_NAME          = 'אוטומציה שיווקית';
export const NAV_CLIENT_HUB    = 'מרכז לקוחות';
export const NAV_PHONE_GRID    = 'רשת טלפונים';
export const NAV_SYSTEM_OPS    = 'מבצעי מערכת';
export const NAV_DASHBOARD     = 'לוח בקרה';
export const NAV_OPERATIONS    = 'מרכז משימות';
export const BTN_INGEST_NEW    = 'קליטת מספר חדש';
export const ROLE_TITLE        = (role) => `תפקיד: ${role}`;

// ---------------------------------------------------------------------------
// Accessibility / ARIA
// ---------------------------------------------------------------------------

export const ARIA_DISMISS_NOTIFICATION = 'סגור התראה';
export const ARIA_CLOSE_MODAL          = 'סגור חלון';
export const ARIA_PHONE_DETAIL         = 'פרטי טלפון';
export const ARIA_CLOSE_DRAWER         = 'סגור מגירה';
export const ARIA_ENGINE_PROCESSING    = 'המנוע מעבד רשומות';
export const ARIA_LOADING_CONTENT      = 'טוען תוכן';

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export const PAGE_CLIENT_HUB_TITLE    = 'מרכז לקוחות';
export const PAGE_CLIENT_HUB_SUB      = 'סקירת צינור לכל לקוח. לחץ על כרטיסייה לסינון רשת הטלפונים לאותו לקוח.';

export const PAGE_PHONE_GRID_TITLE    = 'רשת טלפונים';
export const PAGE_PHONE_GRID_SUB      = 'סנן, בדוק ופעל על כל טלפון בצינור.';

export const PAGE_SYSTEM_OPS_TITLE    = 'מבצעי מערכת';
export const PAGE_SYSTEM_OPS_SUB      = 'בקרות מנוע, תקינות צינור ושחזור פעולות שנכשלו.';
export const PAGE_SYSTEM_OPS_ENGINES  = 'לוח בקרת המנוע';
export const PAGE_SYSTEM_OPS_HEALTH   = 'תקינות הצינור';
export const PAGE_SYSTEM_OPS_RECOVERY = 'שחזור פעולות שנכשלו';

export const PAGE_DASHBOARD_TITLE     = 'לוח בקרה';
export const PAGE_DASHBOARD_SUB       = 'מגמות תפוקה, משפך איכות וניטור SLA עבור כל הלקוחות.';

// ---------------------------------------------------------------------------
// Phone Table
// ---------------------------------------------------------------------------

export const TABLE_HEADER_PHONE        = 'טלפון / סוג';
export const TABLE_HEADER_ASSOCIATION  = 'קשר';
export const TABLE_HEADER_VERIFICATION = 'אימות';
export const TABLE_HEADER_ACTIONS      = 'פעולות אחרונות';
export const TABLE_HEADER_UPDATED      = 'עודכן';
export const TABLE_EMPTY_PHONES        = 'אין טלפונים התואמים את הסינון הנוכחי.';
export const TABLE_SHOWING             = (shown, total) =>
  `מציג ${shown} מתוך ${total} טלפון${total !== 1 ? 'ים' : ''}`;

// ---------------------------------------------------------------------------
// Phone Filter Bar
// ---------------------------------------------------------------------------

export const FILTER_SEARCH_PLACEHOLDER   = 'חפש טלפון, מזהה ישות, או שם לקוח…';
export const FILTER_ALL_CLIENTS          = 'כל הלקוחות';
export const FILTER_ALL_STATUSES         = 'כל הסטטוסים';
export const FILTER_STATUS_PENDING       = 'ממתין';
export const FILTER_STATUS_GOOD          = 'אומת - תקין';
export const FILTER_STATUS_BAD           = 'אומת - פסול';
export const FILTER_ALL_SOURCES          = 'כל המקורות';
export const FILTER_SOURCE_API           = 'API';
export const FILTER_SOURCE_MANUAL        = 'ידני';
export const FILTER_SOURCE_IMPORT        = 'ייבוא';
export const FILTER_SOURCE_PARTNER       = 'הזנת שותף';
export const FILTER_ALL_CLASSIFICATIONS  = 'כל הסיווגים';
export const FILTER_BTN_CLEAR            = 'נקה';

// ---------------------------------------------------------------------------
// Phone Detail Drawer
// ---------------------------------------------------------------------------

export const DRAWER_LABEL_CLIENT   = 'לקוח';
export const DRAWER_LABEL_ENTITY   = 'ישות';
export const DRAWER_LABEL_INGESTED = 'נקלט';
export const DRAWER_LABEL_UPDATED  = 'עודכן';
export const DRAWER_VIA_SOURCE     = (src) => `דרך ${src}`;
export const DRAWER_BTN_TRIGGER    = 'הפעל פעולה';

// ---------------------------------------------------------------------------
// Action Mini Pipeline
// ---------------------------------------------------------------------------

export const ACTION_PIPELINE_EMPTY = 'אין פעולות עדיין';

// ---------------------------------------------------------------------------
// JSON Metadata Explorer
// ---------------------------------------------------------------------------

export const METADATA_HEADING       = 'מטא-דאטה';
export const METADATA_BTN_EDIT      = 'עריכה';
export const METADATA_BTN_CANCEL    = 'ביטול';
export const METADATA_BTN_SAVING    = 'שומר…';
export const METADATA_BTN_SAVE      = 'שמור עדכונים';
export const METADATA_EMPTY         = 'לא נרשמה מטא-דאטה.';
export const METADATA_KEY_PLACEHOLDER   = 'מפתח';
export const METADATA_VALUE_PLACEHOLDER = 'ערך';
export const METADATA_ARIA_REMOVE_ROW   = 'הסר שורה';
export const METADATA_BTN_ADD_ROW       = 'הוסף שורה';

// ---------------------------------------------------------------------------
// Vertical Audit Timeline
// ---------------------------------------------------------------------------

export const TIMELINE_HEADING      = 'ציר זמן ביקורת';
export const TIMELINE_EMPTY        = 'לא נרשמו אירועים עדיין.';
export const TIMELINE_INGESTED     = 'נקלט';
export const TIMELINE_SOURCE       = (src) => `מקור: ${src}`;
export const TIMELINE_RETRY        = (n) => `ניסיון חוזר מס׳ ${n}`;
export const TIMELINE_OPERATOR     = (id) => `מפעיל ${id}`;
export const TIMELINE_VERIFIED_GOOD = 'אומת - תקין';
export const TIMELINE_VERIFIED_BAD  = 'אומת - פסול';

// ---------------------------------------------------------------------------
// Verdict Split Buttons
// ---------------------------------------------------------------------------

export const VERDICT_BTN_APPROVE            = 'אשר';
export const VERDICT_BTN_REJECT             = 'דחה';
export const VERDICT_CONFIRM_GOOD           = 'מאשר פסיקה: אומת - תקין.';
export const VERDICT_CONFIRM_BAD            = 'מאשר פסיקה: אומת - פסול.';
export const VERDICT_REASON_PLACEHOLDER     =
  'אופציונלי: סיבה קצרה לפסיקה זו (לדוג׳: אושר בשיחה חוזרת, מספר מנותק, ציון ביטחון נמוך).';
export const VERDICT_BTN_CANCEL             = 'ביטול';
export const VERDICT_BTN_SUBMITTING         = 'שולח…';
export const VERDICT_BTN_CONFIRM_APPROVE    = 'אשר אישור';
export const VERDICT_BTN_CONFIRM_REJECT     = 'אשר דחייה';
export const VERDICT_TOAST_SUCCESS          = (label) => `פסיקה נרשמה — הטלפון סומן כ${label}.`;
export const VERDICT_TOAST_ERROR            = (msg) => `פסיקה נכשלה: ${msg}`;

// ---------------------------------------------------------------------------
// Manual Action Modal
// ---------------------------------------------------------------------------

export const ACTION_MODAL_TITLE        = 'הפעלת פעולה ידנית';
export const ACTION_MODAL_TARGET_PHONE = 'טלפון יעד';
export const ACTION_MODAL_CLASSIFICATION = 'סיווג';
export const ACTION_MODAL_ACTION_TYPE  = 'סוג פעולה';
export const ACTION_MODAL_HELP         = 'אפשרויות הפעולה מוגבלות לפי סיווג הטלפון.';
export const ACTION_MODAL_BTN_CANCEL   = 'ביטול';
export const ACTION_MODAL_BTN_DISPATCH = 'שגר';
export const ACTION_MODAL_BTN_DISPATCHING = 'משגר…';
export const ACTION_MODAL_TOAST_SUCCESS = (label) => `פעולה "${label}" שוגרה.`;
export const ACTION_MODAL_TOAST_ERROR   = (msg) => `שיגור נכשל: ${msg}`;

// ---------------------------------------------------------------------------
// Ingestion Modal
// ---------------------------------------------------------------------------

export const INGEST_MODAL_TITLE        = 'קליטת מספר חדש';
export const INGEST_MODAL_LOADING      = 'טוען מבנה טופס…';
export const INGEST_MODAL_SCHEMA_ERROR = 'לא ניתן לטעון את מבנה הטופס. אנא סגור ונסה שוב.';
export const INGEST_MODAL_BTN_CANCEL   = 'ביטול';
export const INGEST_MODAL_BTN_SUBMIT   = 'שלח';
export const INGEST_MODAL_BTN_SUBMITTING = 'קולט…';
export const INGEST_MODAL_REQUIRED_NOTE  = 'שדות המסומנים ב-* הם שדות חובה.';
export const INGEST_TOAST_SCHEMA_ERROR   = 'טעינת מבנה הטופס נכשלה.';
export const INGEST_TOAST_SUCCESS        = 'מספר הטלפון נקלט ועומד בתור לעיבוד.';
export const INGEST_TOAST_ERROR          = (msg) => `קליטה נכשלה: ${msg}`;

// ---------------------------------------------------------------------------
// Dynamic Field
// ---------------------------------------------------------------------------

export const DYNAMIC_SELECT_DEFAULT = '— בחר —';

// ---------------------------------------------------------------------------
// Quality Funnel
// ---------------------------------------------------------------------------

export const FUNNEL_HEADING       = 'משפך המרת איכות';
export const FUNNEL_SUBTITLE      = 'תפוקת הצינור מקליטה עד פסיקה מאומתת';
export const FUNNEL_STAGE_INGESTED = 'נקלטו';
export const FUNNEL_STAGE_ACTIONED = 'הגיעו לפעולה';
export const FUNNEL_STAGE_GOOD     = 'אומתו - תקינים';
export const FUNNEL_STAGE_BAD      = 'אומתו - פסולים';
export const FUNNEL_STAGE_PENDING  = 'ממתינים לפסיקה';

// ---------------------------------------------------------------------------
// SLA Indicator
// ---------------------------------------------------------------------------

export const SLA_HEADING         = 'ביצועי SLA';
export const SLA_SUBTITLE        = 'זמן ממוצע מקליטה עד פסיקה מאומתת';
export const SLA_AVG_LABEL       = 'זמן ממוצע לפסיקה';
export const SLA_SAMPLE          = (n) =>
  `מבוסס על ${n} טלפון${n !== 1 ? 'ים' : ''} שנפסקו`;
export const SLA_TARGET          = (h) => `סף יעד: פחות מ-${h} שעות`;
export const SLA_BREACH_TITLE    = 'זוהתה חריגה מה-SLA.';
export const SLA_BREACH_BODY     = (display, hours) =>
  `הזמן הממוצע לפסיקה (${display}) חורג מסף ${hours} השעות.`;
export const SLA_BREACH_ACTION   = 'מומלץ להפעיל את מנוע האימות לניקוי תור הממתינים.';
export const SLA_OK              = 'בתוך ה-SLA — אין צורך בפעולה.';
export const SLA_NOTE            =
  'יעדי ה-SLA של כל לקוח מוגדרים ברמת החשבון. נתון זה משקף את המצרף של כל הלקוחות הפעילים.';

// ---------------------------------------------------------------------------
// Throughput Bars
// ---------------------------------------------------------------------------

export const THROUGHPUT_HEADING  = 'תפוקת פעולות יומית';
export const THROUGHPUT_SUBTITLE = '14 הימים האחרונים — רשומות יומן פעולות ליום';
export const THROUGHPUT_TOOLTIP  = (date, count) =>
  `${date}: ${count} פעולה${count !== 1 ? 'ות' : ''}`;

// ---------------------------------------------------------------------------
// Client Card
// ---------------------------------------------------------------------------

export const CLIENT_CARD_FAILED_TITLE  = (n) => `${n} פעולות שנכשלו`;
export const CLIENT_CARD_PENDING_TITLE = (n) => `${n} ממתינות לפסיקה`;
export const CLIENT_CARD_OK_TITLE      = 'אין פריטים תלויים';
export const CLIENT_CARD_ACTIVE        = 'פעיל';
export const CLIENT_CARD_PENDING       = 'ממתין';
export const CLIENT_CARD_FAILED        = 'נכשל';
export const CLIENT_CARD_GOOD          = 'תקין';
export const CLIENT_CARD_BAD           = 'פסול';
export const CLIENT_CARD_DECIDED       = (n) => `${n} שנפסקו`;
export const CLIENT_CARD_QUALITY_SLA   = 'איכות מול SLA';
// Phase DX — open-task badge on each client card.
export const CLIENT_CARD_OPEN_TASKS    = (n) => `${n} משימות פתוחות`;
export const CLIENT_CARD_NO_OPEN_TASKS = 'אין משימות פתוחות';
export const CLIENT_CARD_OPEN_TASKS_TITLE = (n) => `${n} משימות פתוחות עבור לקוח זה — לחץ לפתיחת מרכז המשימות.`;

// ---------------------------------------------------------------------------
// Failed Actions Table
// ---------------------------------------------------------------------------

export const FAILED_TABLE_HEADING      = 'פעולות שנכשלו';
export const FAILED_TABLE_SUBTITLE     = (n) =>
  `${n} רשומ${n !== 1 ? 'ות' : 'ה'} הדורשות טיפול`;
export const FAILED_TABLE_ENGINE_STATUS  = 'המנוע מעבד…';
export const FAILED_TABLE_REEVALUATING  = 'מעריך מחדש רשומות…';
export const FAILED_TABLE_EMPTY         = 'אין פעולות שנכשלו — הצינור תקין.';
export const FAILED_TABLE_COL_PHONE     = 'טלפון';
export const FAILED_TABLE_COL_CLIENT    = 'לקוח';
export const FAILED_TABLE_COL_TYPE      = 'סוג';
export const FAILED_TABLE_COL_ERROR     = 'פרטי שגיאה';
export const FAILED_TABLE_COL_REQUESTED = 'נדרש';
export const FAILED_TABLE_COL_ACTION    = 'פעולה';
export const FAILED_TABLE_BTN_RETRY     = 'כפה ניסיון חוזר';
export const FAILED_TABLE_BTN_RETRYING  = 'מנסה שוב…';
export const FAILED_TABLE_TOAST_SUCCESS = 'ניסיון חוזר שוגר — הפעולה הוכנסה לתור מחדש.';
export const FAILED_TABLE_TOAST_ERROR   = (msg) => `ניסיון חוזר נכשל: ${msg}`;

// ---------------------------------------------------------------------------
// Error Accordion Cell
// ---------------------------------------------------------------------------

export const ERROR_CELL_DEFAULT_MSG   =
  'הפעולה נכשלה לאחר מספר מרבי של ניסיונות — המטפל החזיר שגיאה שלא ניתן לנסות שוב.';
export const ERROR_CELL_STACK_TRACE   = 'עקבות מחסנית';
export const ERROR_CELL_COPY_TITLE    = 'העתק פרטי שגיאה';
export const ERROR_CELL_BTN_COPY      = 'העתק';
export const ERROR_CELL_BTN_COPIED    = 'הועתק';
export const ERROR_CELL_NO_TRACE      = '(לא נרשמה עקבות מחסנית)';

// ---------------------------------------------------------------------------
// Pipeline Health Strip
// ---------------------------------------------------------------------------

export const HEALTH_TOTAL_PHONES   = 'סך טלפונים';
export const HEALTH_PENDING_VERDICT = 'ממתינים לפסיקה';
export const HEALTH_VERIFIED_GOOD  = 'אומתו - תקינים';
export const HEALTH_VERIFIED_BAD   = 'אומתו - פסולים';
export const HEALTH_FAILED_ACTIONS = 'פעולות שנכשלו';
export const HEALTH_RETRY_QUEUE    = 'תור ניסיונות חוזרים';

// ---------------------------------------------------------------------------
// JSON Metadata Explorer (toasts not covered above)
// ---------------------------------------------------------------------------

export const METADATA_TOAST_SUCCESS = 'מטא-דאטה של הטלפון עודכנה.';
export const METADATA_TOAST_ERROR   = (msg) => `עדכון נכשל: ${msg}`;

// ---------------------------------------------------------------------------
// Vertical Audit Timeline (dynamic detail strings)
// ---------------------------------------------------------------------------

export const TIMELINE_SYSTEM              = 'מערכת';
export const TIMELINE_VERIFICATION_DETAIL = (src, reason) => `${src} · ${reason}`;
export const TIMELINE_VERIFICATION_RECORDED = (src) => `נרשם על ידי ${src}`;

// ---------------------------------------------------------------------------
// Ingestion Modal — inline validation errors
// ---------------------------------------------------------------------------

export const INGEST_FIELD_REQUIRED  = (label) => `${label} הוא שדה חובה.`;
export const INGEST_FIELD_JSON_ERR  = 'תחביר JSON שגוי — בדוק גרשיים, פסיקים או סוגריים חסרים.';

// ---------------------------------------------------------------------------
// Engine Control Card
// ---------------------------------------------------------------------------

export const ENGINE_TOAST_SUCCESS    = (label, n) =>
  `${label} הושלם — עובדו ${n} רשומ${n !== 1 ? 'ות' : 'ה'}.`;
export const ENGINE_TOAST_ERROR      = (msg) => `הרצת המנוע נכשלה: ${msg}`;
export const ENGINE_STAT_LAST_RUN    = 'הרצה אחרונה';
export const ENGINE_STAT_PROCESSED   = 'עובדו';
export const ENGINE_STAT_RECORDS     = 'רשומות';
export const ENGINE_STATUS_PROCESSING = 'מעבד — אין להפעיל שוב';
export const ENGINE_STATUS_IDLE      = 'במנוחה — מוכן להרצה הבאה';
export const ENGINE_BTN_FORCE_RUN    = 'הפעל כעת';
export const ENGINE_BTN_RUNNING      = 'מריץ…';

// ---------------------------------------------------------------------------
// Phase DX — Operations Task Queue
// ---------------------------------------------------------------------------

export const PAGE_OPERATIONS_TITLE = 'מרכז משימות';
export const PAGE_OPERATIONS_SUB   = 'תור עבודה ייעודי למנהל מערכת — כשלים לטיפול, בקשות אישור והמלצות.';

// Filter bar
export const TASK_FILTER_SEARCH_PLACEHOLDER = 'חיפוש לפי טלפון, סוג משימה או שם לקוח…';
export const TASK_FILTER_ALL_STATUSES       = 'כל הסטטוסים';
export const TASK_FILTER_ALL_TYPES          = 'כל סוגי המשימות';
export const TASK_FILTER_BTN_CLEAR          = 'נקה סינון';
export const TASK_FILTER_PHONE_CHIP         = (id) => `מסונן לטלפון #${id}`;
export const TASK_FILTER_CLIENT_CHIP        = (id) => `מסונן ללקוח #${id}`;
export const TASK_FILTER_OPEN_ONLY_CHIP     = 'משימות פתוחות בלבד';

// 5-column table headers
export const TASK_TABLE_COL_TYPE      = 'סוג משימה';
export const TASK_TABLE_COL_PHONE     = 'טלפון';
export const TASK_TABLE_COL_CLIENT    = 'לקוח';
export const TASK_TABLE_COL_STATUS    = 'סטטוס וייחוס';
export const TASK_TABLE_COL_UPDATED   = 'עודכן';

// Empty / loading / showing line
export const TASK_TABLE_EMPTY   = 'אין משימות התואמות לסינון הנוכחי.';
export const TASK_TABLE_SHOWING = (shown, total) => `מציג ${shown} מתוך ${total} משימות.`;

// Row caption fragments
export const TASK_ROW_REQUESTED_BY  = (who) => `נפתח ע"י ${who}`;
export const TASK_ROW_RESOLVED_BY   = (who) => `טופל ע"י ${who}`;
export const TASK_ROW_ENTITY_LINE   = (id, type) => `ישות #${id} · ${type}`;

// Permission gate fallback (used when RequireRole denies)
export const PERMISSION_DENIED_NOTICE = 'אין לך הרשאה לצפות בתוכן זה. פנה למנהל מערכת.';

// ---------------------------------------------------------------------------
// Phase DY — Scoring (priority + confidence + tier)
// ---------------------------------------------------------------------------

export const SCORE_PRIORITY_LABEL   = 'עדיפות';
export const SCORE_CONFIDENCE_LABEL = 'אמינות';
export const SCORE_TIER_LABEL       = 'דרגת לקוח';
export const SCORE_TIER_VALUE       = (n) => `דרגה ${n}`;
export const SCORE_TIER_UNKNOWN     = 'דרגה לא ידועה';
export const SCORE_NOT_AUDITED      = 'לא נבדק';
export const SCORE_ROW_TOOLTIP      = (priority, confidence, tier) =>
  `עדיפות ${priority?.toFixed(0) ?? '—'} · אמינות ${confidence?.toFixed(0) ?? '—'} · ${
    tier != null ? `דרגה ${tier}` : 'דרגה לא ידועה'
  }`;

// Sort toggle (DY-3) — labels for the PhoneFilterBar dropdown.
export const FILTER_SORT_LABEL_PRIORITY    = 'מיון: עדיפות';
export const FILTER_SORT_LABEL_INGESTED_AT = 'מיון: סדר כניסה';

// ---------------------------------------------------------------------------
// Phase DY-4 — Two-axis truth & envelope (Vector B) vocabulary
// ---------------------------------------------------------------------------

// Provenance — title attributes for the row's left-edge pip.
export const PROVENANCE_TITLE_VECTOR_A = 'מקור: ישות מזוהה';
export const PROVENANCE_TITLE_VECTOR_B = 'מקור: סביבה חברתית — זהות לא מאומתת';

// Envelope placeholder rendering — used in the entity column when the
// row's entity_type is 'social_envelope'.
export const ENVELOPE_LABEL              = (id) =>
  id ? `מעטפת חברתית · ${id}` : 'מעטפת חברתית';
export const ENVELOPE_TYPE_CAPTION       = 'social_envelope';
export const ENVELOPE_OWNER_UNKNOWN      = 'בעלים לא מזוהה';

// Truth axis micro-labels (rendered as title attributes on the dots).
export const TRUTH_AXIS_PHONE_PERSON     = 'הטלפון שייך לאדם';
export const TRUTH_AXIS_PERSON_TARGET    = 'האדם קשור ליעד';
export const TRUTH_AXIS_PHONE_IN_NETWORK = 'הטלפון בסביבת היעד';
export const TRUTH_AXIS_IDENTITY         = 'זהות בעל הטלפון';
export const TRUTH_STATE_VERIFIED        = 'מאומת';
export const TRUTH_STATE_PENDING         = 'ממתין';
export const TRUTH_STATE_DISPROVED       = 'הופרך';

// Drawer Truth Panel (DY-4-B) — two-row identity + phone-line summary
// rendered immediately under the phone number, replacing the legacy
// single-badge verification row.
export const DRAWER_TRUTH_SECTION_IDENTITY      = 'הזהות';
export const DRAWER_TRUTH_SECTION_PHONE_LINE    = 'קו הטלפון';
// Phase DY-4-D — the `identified_envelope` token represents a partial
// identify (name supplied but no relation picked). We render it with a
// dedicated Hebrew label rather than echoing the raw token so operators
// never see internal vocabulary in the UI.
export const DRAWER_TRUTH_IDENTITY_PARTIAL      = 'אדם מזוהה · זיהוי חלקי';

// Phase DY-4-D — translate internal-only entity_type tokens into UI labels
// so operators never see raw vocabulary. Named relation tokens (family,
// friend, spouse, etc.) are already meaningful and pass through unchanged.
export const ENTITY_TYPE_DISPLAY = (entityType) => {
  if (entityType === 'identified_envelope') return 'זיהוי חלקי';
  if (entityType === 'social_envelope')     return 'מעטפת חברתית';
  return entityType || 'unknown';
};
export const DRAWER_TRUTH_IDENTITY_VECTOR_A     = (entityType) => {
  if (entityType === 'identified_envelope') return DRAWER_TRUTH_IDENTITY_PARTIAL;
  return `אדם מזוהה · ${entityType || 'unknown'}`;
};
export const DRAWER_TRUTH_IDENTITY_ENVELOPE     = 'מעטפת חברתית — זהות לא מאומתת';
export const DRAWER_TRUTH_SOURCE_MANUAL         = (when) => `מאומת ידנית · ${when}`;
export const DRAWER_TRUTH_SOURCE_AUTOMATED      = (when) => `מאומת אוטומטית · ${when}`;
export const DRAWER_TRUTH_SOURCE_AWAITING       = 'ממתין לאישור מבצע';
export const DRAWER_TRUTH_SOURCE_AMBIENT        = 'נמצא דרך סריקת סביבה';
export const DRAWER_TRUTH_SOURCE_DISPROVED      = 'הופרך · לא רלוונטי';

// ---------------------------------------------------------------------------
// Phase DY-4-C — Forked verdict surface (two-axis grid + envelope identify)
// ---------------------------------------------------------------------------

export const VERDICT_FORM_HEADING_VECTOR_A   = 'משוב משימת אימות';
export const VERDICT_FORM_HEADING_VECTOR_B   = 'משוב על מעטפת חברתית';
export const VERDICT_FORM_AXIS_PHONE_LABEL   = 'קו הטלפון';
export const VERDICT_FORM_AXIS_PHONE_NET     = 'הטלפון בסביבת היעד';
export const VERDICT_FORM_AXIS_RELATION_LBL  = 'הקשר ליעד';
export const VERDICT_AXIS_CONFIRM            = 'אשר';
export const VERDICT_AXIS_REFUTE             = 'הפרך';
export const VERDICT_REASON_PLACEHOLDER_V2   = 'הסבר קצר (אופציונלי)';
export const VERDICT_BTN_SUBMIT_AXES         = 'שלח משוב';
export const VERDICT_BTN_SUBMITTING_V2       = 'שולח…';
export const VERDICT_TOAST_SUCCESS_AXES      = 'המשוב נקלט בהצלחה';
export const VERDICT_TOAST_EMPTY_AXES        = 'בחר לפחות פעולה אחת לפני שליחה';

// Envelope identify form
export const IDENTIFY_FORM_HEADING           = 'זיהוי בעל הטלפון';
export const IDENTIFY_FORM_FIRST_NAME        = 'שם פרטי';
export const IDENTIFY_FORM_LAST_NAME         = 'שם משפחה';
export const IDENTIFY_FORM_RELATION          = 'קשר ליעד';
export const IDENTIFY_FORM_RELATION_NONE     = '— לא צוין (זיהוי חלקי) —';
export const IDENTIFY_FORM_RELATION_OPTIONS  = [
  { value: 'spouse',    label: 'בן/בת זוג' },
  { value: 'family',    label: 'בן משפחה' },
  { value: 'friend',    label: 'חבר' },
  { value: 'colleague', label: 'עמית לעבודה' },
  { value: 'unrelated', label: 'לא קשור (סגור משימה)' },
];
export const IDENTIFY_BTN_SAVE               = 'שמור זיהוי';

// ---------------------------------------------------------------------------
// Task Detail Drawer (DX-4)
// ---------------------------------------------------------------------------

export const ARIA_TASK_DETAIL        = 'פרטי משימה';
export const ARIA_CLOSE_TASK_DRAWER  = 'סגור פרטי משימה';

export const TASK_DRAWER_LABEL_PHONE       = 'טלפון';
export const TASK_DRAWER_LABEL_CLIENT      = 'לקוח';
export const TASK_DRAWER_LABEL_ENTITY      = 'ישות';
export const TASK_DRAWER_LABEL_CREATED     = 'נפתח';
export const TASK_DRAWER_LABEL_UPDATED     = 'עודכן';
export const TASK_DRAWER_LABEL_RESOLVED    = 'טופל';
export const TASK_DRAWER_LABEL_REQUESTED   = 'מבקש';
export const TASK_DRAWER_LABEL_RESOLVER    = 'מטפל';

export const TASK_DRAWER_SECTION_PAYLOAD   = 'מטא-דאטה';
export const TASK_DRAWER_SECTION_SOURCE    = 'פעולת מקור';
export const TASK_DRAWER_SECTION_TIMELINE  = 'היסטוריית טלפון';

export const TASK_DRAWER_EMPTY_PAYLOAD     = 'אין מטא-דאטה.';
export const TASK_DRAWER_NO_SOURCE_LOG     = 'משימה זו נפתחה ע"י משתמש — אין פעולה מקורית.';
export const TASK_DRAWER_OPEN_PHONE        = 'פתח כרטיס טלפון';
export const TASK_DRAWER_TERMINAL_NOTICE   = (status) =>
  status === 'resolved' ? 'משימה זו טופלה — לא ניתן לחזור עליה.'
                        : 'משימה זו נדחתה — לא ניתן לחזור עליה.';

export const TASK_DRAWER_BTN_RESOLVE  = 'אישור וטיפול';
export const TASK_DRAWER_BTN_REJECT   = 'דחייה';

// ---------------------------------------------------------------------------
// Resolve Task Modal (DX-4)
// ---------------------------------------------------------------------------

export const RESOLVE_MODAL_TITLE_RESOLVE    = 'אישור משימה';
export const RESOLVE_MODAL_TITLE_REJECT     = 'דחיית משימה';
export const RESOLVE_MODAL_NOTE_LABEL       = 'הערת טיפול';
export const RESOLVE_MODAL_NOTE_PLACEHOLDER = 'הסבר קצר על ההחלטה (חובה)';
export const RESOLVE_MODAL_NOTE_REQUIRED    = 'יש להזין הערת טיפול לפני סיום.';
export const RESOLVE_MODAL_BTN_CANCEL       = 'ביטול';
export const RESOLVE_MODAL_BTN_CONFIRM      = (outcome) =>
  outcome === 'resolved' ? 'אישור וטיפול' : 'דחה משימה';
export const RESOLVE_MODAL_BTN_SUBMITTING   = 'שולח…';

export const RESOLVE_TOAST_SUCCESS = (outcome) =>
  outcome === 'resolved' ? 'המשימה אושרה ונסגרה.' : 'המשימה נדחתה ונסגרה.';
export const RESOLVE_TOAST_ERROR   = (msg) => `שגיאה בטיפול במשימה: ${msg}`;

// ---------------------------------------------------------------------------
// Cross-link pill on PhoneDetailDrawer header
// ---------------------------------------------------------------------------

export const PHONE_DRAWER_TASK_PILL = (n) => `${n} משימות`;
export const PHONE_DRAWER_TASK_PILL_ZERO = 'אין משימות';
