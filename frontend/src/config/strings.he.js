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
