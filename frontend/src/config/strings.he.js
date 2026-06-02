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
export const NAV_ENTITIES      = 'ישויות';
export const NAV_DATA_ADMIN    = 'ניהול נתונים';

// EntitiesPage (UAT round-3 view tab).
export const PAGE_ENTITIES_TITLE  = 'ישויות';
export const PAGE_ENTITIES_SUB    = 'תצוגה של כל הישויות במערכת — ראשיות וטפלות.';
export const ENTITIES_COL_ID      = 'מזהה';
export const ENTITIES_COL_NAME    = 'שם';
export const ENTITIES_COL_RELATION = 'סוג קרבה';
export const ENTITIES_COL_CLIENT  = 'לקוח';
export const ENTITIES_COL_PHONES  = 'מספרי טלפון';
export const ENTITIES_COL_CREATED = 'נוצר';
export const ENTITIES_COL_STRONG_ID = 'מזהה חזק';
export const ENTITIES_EMPTY       = 'לא נמצאו ישויות.';
export const ENTITIES_PHONES_POPOVER_TITLE = (name) => `מספרים של ${name}`;
export const ENTITIES_PHONES_POPOVER_EMPTY = 'אין מספרים מקושרים לישות זו.';
export const ENTITIES_PHONES_POPOVER_CONFIDENCE = (pct) =>
  pct == null ? 'אמינות: —' : `אמינות: ${pct}%`;

// DataAdminPage (UAT round-3 admin tab).
export const ADMIN_PAGE_TITLE  = 'ניהול נתונים';
export const ADMIN_PAGE_SUB    = 'עריכה ומחיקה רכה של ישויות וטלפונים. נמחקים נשמרים במאגר לתיעוד.';
export const ADMIN_TAB_PERSONS = 'אנשים';
export const ADMIN_TAB_PHONES  = 'טלפונים';
export const ADMIN_TOGGLE_INCLUDE_DELETED = 'הצג נמחקים';
export const ADMIN_BTN_EDIT    = 'ערוך';
export const ADMIN_BTN_DELETE  = 'מחק';
export const ADMIN_BTN_RESTORE = 'שחזר';
export const ADMIN_BTN_SAVE    = 'שמור';
export const ADMIN_BTN_CANCEL  = 'ביטול';
export const ADMIN_CONFIRM_DELETE_ENTITY = (name, phonesCount) =>
  `האם למחוק את "${name}"?\n` +
  `פעולה זו תמחק גם את ${phonesCount} מספרי הטלפון השייכים אליו.\n` +
  `הנתונים יישמרו במאגר לתיעוד וניתן לשחזרם.`;
export const ADMIN_CONFIRM_DELETE_PHONE = (num) =>
  `האם למחוק את הטלפון ${num}?\nהנתונים יישמרו במאגר לתיעוד וניתן לשחזרם.`;
export const ADMIN_TOAST_SAVED    = 'השינוי נשמר.';
export const ADMIN_TOAST_DELETED  = 'הרשומה נמחקה (מחיקה רכה).';
export const ADMIN_TOAST_RESTORED = 'הרשומה שוחזרה.';
export const ADMIN_TOAST_ERROR    = (msg) => `שגיאה: ${msg}`;
export const ADMIN_FIELD_FIRST_NAME    = 'שם פרטי';
export const ADMIN_FIELD_LAST_NAME     = 'שם משפחה';
export const ADMIN_FIELD_RELATION      = 'סוג קרבה';
export const ADMIN_FIELD_PHONE_NUMBER  = 'מספר טלפון';
export const ADMIN_FIELD_VERIFICATION  = 'סטטוס אימות';
export const ADMIN_FIELD_STRONG_ID     = 'מזהה חזק';
export const ADMIN_FIELD_CLIENT_ID     = 'מזהה לקוח';
export const ADMIN_FIELD_TARGET_ENTITY = 'ישות-אב (מזהה)';
export const ADMIN_FIELD_PHONE_ENTITY  = 'ישות בעלים (מזהה)';
export const ADMIN_FIELD_CLASSIFICATION = 'סיווג';
export const ADMIN_FIELD_INGEST_SOURCE = 'מקור הקליטה';
export const ADMIN_FIELD_INGEST_REASON = 'סיבת הקליטה';
export const ADMIN_FIELD_VERIF_SOURCE  = 'מקור האימות';
export const ADMIN_FIELD_VERIF_REASON  = 'הערת אימות';
export const ADMIN_COL_STRONG_ID       = 'מזהה חזק';

// ProfilePage — UAT round-3 user profile editor.
export const PROFILE_TITLE                  = 'הפרופיל שלי';
export const PROFILE_SUB                    = 'עדכן את שם התצוגה ואת רשימת הלקוחות שבמעקב שלך.';
export const PROFILE_FIELD_DISPLAY_NAME     = 'שם תצוגה';
export const PROFILE_FIELD_MANAGED_CLIENTS  = 'לקוחות במעקב שלי';
export const PROFILE_HINT_EMPTY_CLIENTS     =
  'ניתן להשאיר ריק — במצב זה כפתור הפרסונליזציה לא יסנן.';
export const PROFILE_BTN_SAVE     = 'שמור שינויים';
export const PROFILE_BTN_SAVING   = 'שומר…';
export const PROFILE_BTN_BACK     = 'חזרה';
export const PROFILE_TOAST_SAVED  = 'הפרופיל עודכן.';
export const PROFILE_TOAST_ERROR  = (msg) => `שגיאה: ${msg}`;

// SingleIngestionPanel — UAT round-3 simplified phone-add form.
export const INGEST_FIELD_PHONE        = 'מספר טלפון';
export const INGEST_FIELD_REASON       = 'סיבת הצפה';
export const INGEST_MODE_LABEL         = 'קישור לישות';
export const INGEST_MODE_EXISTING      = 'ישות קיימת';
export const INGEST_MODE_NEW           = 'ישות חדשה';
export const INGEST_MODE_ENVELOPE      = 'מעטפת כללית';
export const INGEST_PICK_ENTITY        = 'בחר ישות קיימת';
export const INGEST_PICK_CLIENT        = 'בחר לקוח';
export const INGEST_PICK_TARGET        = 'ישות ראשית';
export const INGEST_NEW_FIRST          = 'שם פרטי';
export const INGEST_NEW_LAST           = 'שם משפחה';
export const INGEST_NEW_RELATION       = 'סוג קרבה';
export const INGEST_ERR_PHONE_DIGITS   = 'מספר טלפון חייב להכיל ספרות בלבד.';
export const INGEST_ERR_PICK_ENTITY    = 'יש לבחור ישות.';
export const INGEST_ERR_PICK_CLIENT    = 'יש לבחור לקוח.';
export const INGEST_ERR_PICK_TARGET    = 'יש לבחור ישות ראשית.';
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
// Phase E1 — Bulk Ingestion (multi-tab modal)
// ---------------------------------------------------------------------------

// Tab labels on the modal header.
export const INGEST_TAB_SINGLE     = 'מספר בודד';
export const INGEST_TAB_MULTI_TEXT = 'הדבקת רשימה';
export const INGEST_TAB_FILE       = 'העלאת קובץ';

// Wrapper modal title (replaces the single-entry title when multi-tab).
export const INGEST_MODAL_TITLE_BULK = 'קליטת מספרי טלפון';

// --- Multi-Text tab labels --------------------------------------------------
export const BULK_TEXT_INTRO =
  'הדבק רשימת מספרי טלפון. כל קריטריון ה"מעטפת" שלמטה (לקוח, סוג ישות, מקור) חל על כל המספרים בבקשה.';

export const BULK_TEXT_FIELD_NUMBERS         = 'מספרי טלפון';
export const BULK_TEXT_FIELD_NUMBERS_HELP    =
  'הפרד מספרים בפסיק, נקודה-פסיק, רווח או שורה חדשה. ניתן להדביק עד 10,000 תווים.';
export const BULK_TEXT_FIELD_NUMBERS_PLACE   =
  '+972521234567, +972529876543\n+1 415 555 0123';

export const BULK_TEXT_FIELD_CLIENT          = 'לקוח';
export const BULK_TEXT_FIELD_ENTITY_TYPE     = 'סוג ישות';
export const BULK_TEXT_FIELD_SOURCE          = 'מקור הקליטה';
export const BULK_TEXT_FIELD_REASON          = 'סיבת הצפה';
export const BULK_TEXT_FIELD_REASON_PLACE    = 'למשל: חבילת קמפיין Q2';
export const BULK_TEXT_FIELD_TARGET          = 'מזהה ישות-יעד (לא חובה)';
export const BULK_TEXT_FIELD_TARGET_HELP     =
  'אם המספרים משויכים לישות-יעד קיימת — הכנס את מזהה הישות המספרי כאן. השאר ריק כדי ליצור ישות חדשה.';
export const BULK_TEXT_FIELD_TARGET_PLACE    = 'למשל: 42';

// Live token counter.
export const BULK_TEXT_TOKEN_COUNT = (n) => `${n} מספרים זוהו`;

// Buttons.
export const BULK_TEXT_BTN_SUBMIT     = 'קלוט אצווה';
export const BULK_TEXT_BTN_SUBMITTING = 'קולט אצווה…';
export const BULK_TEXT_BTN_NEW_BATCH  = 'אצווה חדשה';

// Validation errors.
export const BULK_TEXT_ERR_EMPTY_BODY    = 'הזן לפחות מספר טלפון אחד.';
export const BULK_TEXT_ERR_MISSING_CLIENT = 'יש לבחור לקוח.';
export const BULK_TEXT_ERR_MISSING_ENTITY_TYPE = 'יש לבחור סוג ישות.';
export const BULK_TEXT_ERR_MISSING_SOURCE = 'יש לבחור מקור קליטה.';
export const BULK_TEXT_ERR_BAD_TARGET   = 'מזהה ישות-יעד חייב להיות מספר חיובי שלם.';

// Toasts.
export const BULK_TEXT_TOAST_PARTIAL = (ok, fail) =>
  `נקלטו ${ok} מספרים, ${fail} נכשלו — ראה פירוט בלשונית.`;
export const BULK_TEXT_TOAST_ALL_OK = (ok) => `כל ${ok} המספרים נקלטו בהצלחה.`;
export const BULK_TEXT_TOAST_NONE_OK = (fail) => `אף מספר לא נקלט — ${fail} שורות נכשלו.`;
export const BULK_TEXT_TOAST_ERROR   = (msg) => `קליטת אצווה נכשלה: ${msg}`;

// Summary panel.
export const BULK_SUMMARY_TITLE         = 'סיכום קליטה';
export const BULK_SUMMARY_SUCCESS_LABEL = 'נקלטו';
export const BULK_SUMMARY_FAILED_LABEL  = 'נכשלו';
export const BULK_SUMMARY_TOTAL_LABEL   = 'סה״כ שורות';
export const BULK_SUMMARY_FAILED_HEADER = 'שורות שנכשלו';
export const BULK_SUMMARY_COL_ROW       = 'שורה';
export const BULK_SUMMARY_COL_INPUT     = 'קלט';
export const BULK_SUMMARY_COL_ERROR     = 'שגיאה';
export const BULK_SUMMARY_SUBMISSION_ID = (id) => `מזהה אצווה: ${id}`;
export const BULK_SUMMARY_EMPTY_FAILED  = 'אין שורות שנכשלו — כל המספרים נקלטו בהצלחה.';

// --- File-Upload tab (Phase E1-D) ------------------------------------------
export const BULK_FILE_INTRO =
  'העלה קובץ Excel (.xlsx) או CSV. כל שורה תיקלט עם הקשר משלה (לקוח, סוג ישות, מקור). הורד את התבנית למבנה הצפוי של העמודות.';

export const BULK_FILE_DROPZONE        = 'גרור קובץ לכאן או לחץ לבחירה';
export const BULK_FILE_DROPZONE_HINT   = 'מותרות סיומות: .xlsx, .csv · מקסימום 5MB · עד 5,000 שורות';
export const BULK_FILE_BTN_BROWSE      = 'בחר קובץ';
export const BULK_FILE_BTN_REMOVE      = 'הסר';
export const BULK_FILE_BTN_DOWNLOAD    = 'הורד תבנית';
export const BULK_FILE_BTN_SUBMIT      = 'העלה והפעל קליטה';
export const BULK_FILE_BTN_SUBMITTING  = 'מעלה ומעבד…';

// Preflight errors (client-side, before upload).
export const BULK_FILE_ERR_EMPTY       = 'יש לבחור קובץ.';
export const BULK_FILE_ERR_EXTENSION   = (ext) =>
  `סיומת לא נתמכת${ext ? `: ${ext}` : ''}. מותרות: .xlsx, .csv`;
export const BULK_FILE_ERR_SIZE        = (size, max) =>
  `גודל הקובץ ${size} חורג מהמגבלה (${max}).`;

// Toasts.
export const BULK_FILE_TOAST_TEMPLATE_OK    = 'התבנית הורדה.';
export const BULK_FILE_TOAST_TEMPLATE_ERR   = (msg) => `הורדת התבנית נכשלה: ${msg}`;
export const BULK_FILE_TOAST_UPLOAD_ERR     = (msg) => `העלאה נכשלה: ${msg}`;

// File-size formatting helper label fragment.
export const BULK_FILE_SIZE_KB = (n) => `${n} KB`;
export const BULK_FILE_SIZE_MB = (n) => `${n} MB`;

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

// ---------------------------------------------------------------------------
// Phase EXP — Table export to Excel
// ---------------------------------------------------------------------------

// Split button on every exportable table.
export const EXPORT_BTN_LABEL            = 'ייצא לאקסל';
export const EXPORT_BTN_MENU_CURRENT     = 'ייצא עם הגדרות נוכחיות';
export const EXPORT_BTN_MENU_CUSTOMIZE   = 'התאם שדות…';
export const EXPORT_BTN_PROCESSING       = 'מייצא…';

// Configurator modal.
export const EXPORT_MODAL_TITLE          = 'התאם שדות לייצוא';
export const EXPORT_MODAL_VISIBLE_HEADER = (n) => `שדות בייצוא (${n})`;
export const EXPORT_MODAL_AVAILABLE_HEADER = (n) => `שדות זמינים (${n})`;
export const EXPORT_MODAL_RESET          = 'אפס לברירת מחדל';
export const EXPORT_MODAL_CANCEL         = 'ביטול';
export const EXPORT_MODAL_SAVE_AND_GO    = 'שמור והורד';
export const EXPORT_MODAL_REMOVE_ARIA    = (label) => `הסר את ${label} מהייצוא`;
export const EXPORT_MODAL_ADD_ARIA       = (label) => `הוסף את ${label} לייצוא`;
export const EXPORT_MODAL_MOVE_UP_ARIA   = (label) => `הזז את ${label} למעלה`;
export const EXPORT_MODAL_MOVE_DOWN_ARIA = (label) => `הזז את ${label} למטה`;
export const EXPORT_MODAL_EMPTY_NOTE     = 'בחר לפחות שדה אחד לייצוא.';

// Toasts.
export const EXPORT_TOAST_SUCCESS        = 'הקובץ הורד.';
export const EXPORT_TOAST_TOO_MANY       = (n) =>
  `יותר מדי שורות (${n}). צמצם את הסינון ונסה שוב.`;
export const EXPORT_TOAST_ERROR          = (msg) => `ייצוא נכשל: ${msg}`;

// ---------------------------------------------------------------------------
// Phase NOTIF — inline notification opt-in panel
// ---------------------------------------------------------------------------

// Three visual states of the panel.
export const NOTIF_OPT_IN_COLLAPSED_CTA   = 'קבל התראות לרשומה זו';
export const NOTIF_OPT_IN_ACTIVE_LABEL    = (count) =>
  `התראות פעילות (${count})`;
export const NOTIF_OPT_IN_EDIT            = 'ערוך';

// Form labels in the expanded state.
export const NOTIF_FORM_EVENTS_LABEL      = 'על איזה אירוע להתריע?';
export const NOTIF_FORM_RECIPIENTS_LABEL  = 'לאן לשלוח?';
export const NOTIF_FORM_RECIPIENTS_PLACE  = 'בחר ערוצים…';

// Buttons.
export const NOTIF_BTN_SAVE               = 'שמור';
export const NOTIF_BTN_SUBMITTING         = 'שומר…';
export const NOTIF_BTN_CANCEL             = 'ביטול';
export const NOTIF_BTN_DELETE             = 'מחק התראות';

// Validation + empty-state.
export const NOTIF_ERR_NO_EVENTS          = 'יש לבחור לפחות אירוע אחד.';
export const NOTIF_ERR_NO_RECIPIENTS      = 'יש לבחור ערוץ אחד לפחות.';

// Toasts.
export const NOTIF_TOAST_SAVED            = 'התראות הוגדרו בהצלחה.';
export const NOTIF_TOAST_UPDATED          = 'הגדרות ההתראות עודכנו.';
export const NOTIF_TOAST_DELETED          = 'ההתראות בוטלו.';
export const NOTIF_TOAST_ERROR            = (msg) => `שגיאה בהגדרת התראות: ${msg}`;

// ---------------------------------------------------------------------------
// Phase AUTH — login / register / guest landing page
// ---------------------------------------------------------------------------

// Login landing page.
export const AUTH_LANDING_TITLE       = 'ברוכים הבאים';
export const AUTH_LANDING_SUBTITLE    = 'אוטומציה שיווקית — דף כניסה';
export const AUTH_FIELD_USERNAME      = 'שם משתמש';
export const AUTH_FIELD_PASSWORD      = 'סיסמה';
export const AUTH_FIELD_PASSWORD_CONFIRM = 'אישור סיסמה';
export const AUTH_FIELD_DISPLAY_NAME  = 'שם תצוגה (אופציונלי)';

// Login form.
export const AUTH_BTN_LOGIN           = 'התחבר';
export const AUTH_BTN_LOGGING_IN      = 'מתחבר…';
export const AUTH_DIVIDER_OR          = 'או';
export const AUTH_BTN_GOTO_REGISTER   = 'הירשם כעת';
export const AUTH_REGISTER_PROMPT     = 'אין לך משתמש?';
export const AUTH_GUEST_PROMPT        = 'ללא משתמש?';
export const AUTH_BTN_CONTINUE_GUEST  = 'המשך כאורח';

// Register form.
export const AUTH_REGISTER_TITLE      = 'הרשמת משתמש חדש';
export const AUTH_REGISTER_CLIENTS_LABEL = 'באחריותי הלקוחות הבאים:';
export const AUTH_CLIENT_PICKER_PLACEHOLDER = 'חפש לקוח להוספה…';
export const AUTH_CLIENT_PICKER_EMPTY       = 'לא נמצאו לקוחות תואמים.';
export const AUTH_CLIENT_PICKER_REMOVE_ARIA = (name) => `הסר את ${name}`;
export const AUTH_BTN_REGISTER        = 'הירשם';
export const AUTH_BTN_REGISTERING     = 'נרשם…';
export const AUTH_BTN_BACK_TO_LOGIN   = 'חזור לכניסה';
export const AUTH_BTN_CANCEL          = 'ביטול';

// Validation.
export const AUTH_ERR_REQUIRED        = (label) => `${label} הוא שדה חובה.`;
export const AUTH_ERR_MIN_USERNAME    = 'שם משתמש חייב להכיל לפחות 2 תווים.';
export const AUTH_ERR_MIN_PASSWORD    = 'סיסמה חייבת להכיל לפחות 4 תווים.';
export const AUTH_ERR_PASSWORDS_MISMATCH = 'הסיסמאות אינן תואמות.';
export const AUTH_ERR_NO_CLIENTS      = 'יש לבחור לפחות לקוח אחד.';

// Toasts.
export const AUTH_TOAST_LOGIN_SUCCESS = (name) => `שלום, ${name}!`;
export const AUTH_TOAST_LOGIN_ERROR   = 'שם משתמש או סיסמה שגויים.';
export const AUTH_TOAST_REGISTER_SUCCESS = 'הרשמה הושלמה. ברוכים הבאים!';
export const AUTH_TOAST_REGISTER_TAKEN = 'שם המשתמש כבר תפוס.';
export const AUTH_TOAST_REGISTER_ERROR = (msg) => `הרשמה נכשלה: ${msg}`;
export const AUTH_TOAST_LOGOUT        = 'התנתקת בהצלחה.';

// Header — logged-in state.
export const AUTH_HEADER_GUEST_BADGE  = 'אורח';
export const AUTH_HEADER_LOGOUT       = 'התנתק';

// Default-hide toggle for resolved/rejected tasks. Off (= hide) by
// default so managers land on a clean "action required now" queue;
// when the operator wants the historical audit view, flipping this
// checkbox brings everything back.
export const TASK_FILTER_SHOW_RESOLVED       = 'הצג משימות שטופלו';

// ---------------------------------------------------------------------------
// Task Center bulk-action bar
// ---------------------------------------------------------------------------

export const TASK_BULK_BAR_SELECTED_COUNT   = (n) =>
  `${n} משימות נבחרו`;
export const TASK_BULK_BAR_CLEAR_SELECTION  = 'נקה בחירה';
export const TASK_BULK_BAR_RESOLVE          = 'סמן כטופלו';
export const TASK_BULK_BAR_REJECT           = 'סמן כנדחו';
export const TASK_BULK_BAR_PROCESSING       = 'מעדכן…';

export const TASK_BULK_TOAST_ALL_OK         = (n) =>
  `${n} משימות עודכנו בהצלחה.`;
export const TASK_BULK_TOAST_PARTIAL        = (ok, fail) =>
  `${ok} משימות עודכנו, ${fail} נכשלו.`;
export const TASK_BULK_TOAST_NONE_OK        = 'אף משימה לא עודכנה — ייתכן שכבר נסגרו.';
export const TASK_BULK_TOAST_ERROR          = (msg) =>
  `עדכון אצווה נכשל: ${msg}`;

// Accessible labels on the row + header checkboxes.
export const TASK_ROW_SELECT_ARIA           = (id) => `בחר משימה #${id}`;
export const TASK_HEADER_SELECT_ALL_ARIA    = 'בחר את כל המשימות הגלויות';

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

// ---------------------------------------------------------------------------
// Phase E2 — Entity Ingestion modal ("+ Add Person")
// ---------------------------------------------------------------------------

// Header button that opens the entity-ingestion modal.
export const BTN_ADD_PERSON          = 'הוסף אדם';

// Modal shell.
export const ENTITY_MODAL_TITLE      = 'הוספת אדם חדש';
export const ENTITY_TAB_SINGLE       = 'אדם בודד';
export const ENTITY_TAB_MULTI_TEXT   = 'הדבקת רשימה';
export const ENTITY_TAB_FILE         = 'העלאת קובץ';
export const ENTITY_TAB_COMING_SOON  = 'תכונה זו תהיה זמינה בקרוב.';

// Single-entry panel form labels.
export const ENTITY_FIELD_FIRST_NAME    = 'שם פרטי';
export const ENTITY_FIELD_LAST_NAME     = 'שם משפחה';
export const ENTITY_FIELD_RELATION      = 'סוג קרבה';
export const ENTITY_FIELD_CLIENT        = 'לקוח';
export const ENTITY_FIELD_TARGET        = 'ישות ראשית (לקוח)';
export const ENTITY_FIELD_STRONG_ID     = 'מזהה חזק (אופציונלי)';
export const ENTITY_PLACEHOLDER_PICK    = 'בחר…';
export const ENTITY_PLACEHOLDER_CLIENT_FIRST = 'בחר לקוח תחילה';
export const ENTITY_TARGET_LIST_EMPTY   = 'אין יעדים ראשיים זמינים.';
export const ENTITY_FIELD_REQUIRED      = (label) => `${label} הוא שדה חובה.`;

// Relation type options (operator-creatable subset).
export const ENTITY_OPTION_FAMILY     = 'משפחה';
export const ENTITY_OPTION_FRIEND     = 'חבר';
export const ENTITY_OPTION_COLLEAGUE  = 'עמית לעבודה';
export const ENTITY_OPTION_SPOUSE     = 'בן/בת זוג';

// Submit + cancel buttons.
// NOTE: the in-form submit verb is intentionally different from the
// header button ("הוסף אדם") so test selectors and screen readers can
// disambiguate the two buttons even though they share a domain concept.
export const ENTITY_BTN_SUBMIT        = 'שמור אדם';
export const ENTITY_BTN_SUBMITTING    = 'שומר…';
export const ENTITY_BTN_CANCEL        = 'ביטול';

// Friction-free success state.
export const ENTITY_SUCCESS_TITLE     = 'האדם נוסף בהצלחה';
export const ENTITY_SUCCESS_SUBLINE   = (fullName) =>
  `${fullName} נשמר במערכת. ניתן עכשיו להוסיף לו מספר טלפון.`;
export const ENTITY_SUCCESS_CTA       = 'הוסף מספר טלפון עבור אדם זה';
export const ENTITY_SUCCESS_DISMISS   = 'סיום';

// Toasts.
export const ENTITY_TOAST_SUCCESS     = 'האדם נוצר בהצלחה.';
export const ENTITY_TOAST_ERROR       = (msg) => `יצירת אדם נכשלה: ${msg}`;

// ---------------------------------------------------------------------------
// Phase E2-D — Multi-Entity (Two-Step grid) Tab 3
// ---------------------------------------------------------------------------

// Step 1 — raw paste.
export const ENTITY_BULK_TEXT_INTRO         =
  'הדבק רשימת שמות. כל שורה תהפוך לאדם חדש. ניתן להפריד בפסיק, שורה חדשה, או טאב.';
export const ENTITY_BULK_TEXT_PASTE_LABEL   = 'רשימת שמות';
export const ENTITY_BULK_TEXT_PASTE_PLACE   = 'דנה כהן, יוסי לוי\nשירה מזרחי';
export const ENTITY_BULK_TEXT_PASTE_HELP    =
  'כל שם בשורה משלו. שם פרטי בלבד מקובל. ניתן להוסיף שם משפחה אחרי הרווח.';
export const ENTITY_BULK_TEXT_TOKEN_COUNT   = (n) => `${n} שמות זוהו`;
export const ENTITY_BULK_TEXT_CONTINUE      = 'המשך לעריכה';

// Step 1 — defaults.
export const ENTITY_BULK_DEFAULT_RELATION   = 'סוג קרבה (ברירת מחדל)';
export const ENTITY_BULK_DEFAULT_CLIENT     = 'לקוח';
export const ENTITY_BULK_DEFAULT_TARGET     = 'ישות ראשית (ברירת מחדל)';
export const ENTITY_BULK_DEFAULTS_HELP      =
  'הערכים האלה יחולו על כל שורה שלא תעקוף אותם בעצמה בשלב הבא.';

// Step 1 — validation errors.
export const ENTITY_BULK_ERR_EMPTY_TEXT     = 'נא להדביק לפחות שם אחד.';
export const ENTITY_BULK_ERR_MISSING_TARGET = 'יש לבחור ישות ראשית.';

// Step 2 — grid editor.
export const ENTITY_BULK_GRID_HEADER_TOKEN     = 'מקור';
export const ENTITY_BULK_GRID_HEADER_FIRST     = 'שם פרטי';
export const ENTITY_BULK_GRID_HEADER_LAST      = 'שם משפחה';
export const ENTITY_BULK_GRID_HEADER_RELATION  = 'קרבה';
export const ENTITY_BULK_GRID_HEADER_TARGET    = 'יעד';
export const ENTITY_BULK_GRID_HEADER_STRONG_ID = 'מזהה חזק';
export const ENTITY_BULK_GRID_HEADER_REMOVE    = '';
export const ENTITY_BULK_GRID_INHERIT          = 'ברירת מחדל';
export const ENTITY_BULK_GRID_BACK             = 'חזור לעריכת רשימה';
export const ENTITY_BULK_GRID_BACK_CONFIRM     =
  'חזרה תאפס את העריכות. להמשיך?';
export const ENTITY_BULK_GRID_REMOVE_ROW       = 'מחק שורה';
export const ENTITY_BULK_GRID_ERR_FIRST        = 'שם פרטי חובה';
export const ENTITY_BULK_GRID_SUMMARY_ISSUES   = (n) => `${n} שורות עם בעיות`;

// Step 3/4 — submit + result + toasts.
export const ENTITY_BULK_BTN_SUBMIT_ALL        = 'שמור הכל';
export const ENTITY_BULK_BTN_SUBMITTING        = 'שומר…';
export const ENTITY_BULK_BTN_NEW_BATCH         = 'אצווה חדשה';
export const ENTITY_BULK_TOAST_PARTIAL  = (ok, fail) =>
  `נקלטו ${ok} אנשים, ${fail} נכשלו.`;
export const ENTITY_BULK_TOAST_ALL_OK   = (ok) => `נקלטו ${ok} אנשים בהצלחה.`;
export const ENTITY_BULK_TOAST_NONE_OK  = 'אף שורה לא נקלטה — בדוק את השגיאות.';
export const ENTITY_BULK_TOAST_ERROR    = (msg) => `קליטת אצווה נכשלה: ${msg}`;

// ---------------------------------------------------------------------------
// Phase E2-D — Entity file-upload Tab 2
// ---------------------------------------------------------------------------

export const ENTITY_FILE_INTRO              =
  'העלה קובץ Excel או CSV עם רשימת אנשים. כל שורה תקלוט אדם חדש.';
export const ENTITY_FILE_BTN_DOWNLOAD       = 'הורד תבנית';
export const ENTITY_FILE_DROPZONE           = 'גרור קובץ לכאן או לחץ לבחירה';
export const ENTITY_FILE_DROPZONE_HINT      = '.xlsx או .csv · עד 5 מגה־בייט';
export const ENTITY_FILE_BTN_BROWSE         = 'בחר קובץ';
export const ENTITY_FILE_BTN_REMOVE         = 'הסר';
export const ENTITY_FILE_BTN_SUBMIT         = 'קלוט קובץ';
export const ENTITY_FILE_BTN_SUBMITTING     = 'קולט…';
export const ENTITY_FILE_ERR_EMPTY          = 'יש לבחור קובץ.';
export const ENTITY_FILE_ERR_EXTENSION      = (ext) =>
  `סיומת לא נתמכת${ext ? ` (${ext})` : ''}. מותר: .xlsx, .csv`;
export const ENTITY_FILE_ERR_SIZE           = (got, max) =>
  `הקובץ גדול מדי (${got}). מקסימום ${max}.`;
export const ENTITY_FILE_TOAST_TEMPLATE_OK  = 'התבנית הורדה.';
export const ENTITY_FILE_TOAST_TEMPLATE_ERR = (msg) => `הורדת התבנית נכשלה: ${msg}`;
export const ENTITY_FILE_TOAST_UPLOAD_ERR   = (msg) => `העלאת הקובץ נכשלה: ${msg}`;

// ---------------------------------------------------------------------------
// System Settings tab (admin-only infrastructure controls)
// ---------------------------------------------------------------------------
export const NAV_SYSTEM_SETTINGS            = 'הגדרות מערכת';
export const SYSSET_TITLE                   = 'הגדרות מערכת';
export const SYSSET_SUB                     =
  'בקרות תשתית למנהל מערכת. אפשרויות אלו אינן חלק מהשימוש היומיומי בתוכנה.';
export const SYSSET_LOADING                 = 'טוען הגדרות…';
export const SYSSET_DB_TITLE                = 'מסד נתונים';
export const SYSSET_DB_DESC                 =
  'בחירת מנוע מסד הנתונים שהמערכת קוראת וכותבת אליו. השינוי נשמר וייכנס לתוקף בהפעלה מחדש.';
export const SYSSET_APPLIES_ON_RESTART      = 'השינוי ייכנס לתוקף בהפעלה מחדש של השרת.';
export const SYSSET_BACKEND_UNAVAILABLE     = 'עדיין לא זמין';
export const SYSSET_BTN_SAVE                = 'שמור';
export const SYSSET_BTN_SAVING              = 'שומר…';
export const SYSSET_BTN_BACK                = 'חזרה';
export const SYSSET_TOAST_SAVED             = 'ההגדרות נשמרו.';
export const SYSSET_TOAST_ERROR             = (msg) => `שמירת ההגדרות נכשלה: ${msg}`;
// Display labels for the opaque backend ids the API returns.
export const SYSSET_BACKEND_LABELS          = {
  sql:   'SQL (PostgreSQL / SQLite)',
  mongo: 'MongoDB',
};

// ---------------------------------------------------------------------------
// System Settings — configurable display fields (feature 2)
// ---------------------------------------------------------------------------
export const SURFACE_LABEL_ENTITIES         = 'טבלת ישויות';
export const SYSSET_FIELDS_TITLE            = 'שדות תצוגה';
export const SYSSET_FIELDS_DESC             =
  'בחר אילו שדות יוצגו בכל טבלה, וסדר אותם. השינוי נשמר ומשפיע מיד על התצוגה.';
export const SYSSET_FIELDS_VISIBLE          = 'מוצג';
export const SYSSET_FIELDS_MOVE_UP          = 'הזז למעלה';
export const SYSSET_FIELDS_MOVE_DOWN        = 'הזז למטה';
export const SYSSET_FIELDS_TOAST_SAVED      = 'שדות התצוגה נשמרו.';
export const SYSSET_FIELDS_TOAST_ERROR      = (msg) => `שמירת שדות התצוגה נכשלה: ${msg}`;
export const SYSSET_FIELDS_RESET            = 'אפס לברירת מחדל';
