# Marketing Project — מדריך הרצה

תשתית **שיווק יוצא** מבוססת FastAPI + React. מצורף Docker מלא להפעלה במחשב חדש בלי התקנות ידניות.

## דרישות

- **Docker Desktop** ([הורדה](https://www.docker.com/products/docker-desktop)) — וזהו. אין צורך ב-Python, Node, או כל תלות אחרת.
- ודאי ש-Docker Desktop רץ (אייקון הלוויתן ב-tray לא מהבהב).

## הרצה ראשונה

מתיקיית השורש של הפרויקט (CMD/Terminal):

```bash
docker compose up --build
```

הבנייה הראשונה לוקחת 2–5 דקות (מורידה את ה-images ובונה). כשתראי את השורה:
```
backend-1   | INFO:     Application startup complete.
```
המערכת מוכנה.

## זריעת נתוני דוגמה (חד-פעמי)

בחלון טרמינל **נוסף**, מאותה תיקייה:

```bash
docker compose --profile seed run --rm seed python scripts/seed_large.py --reset
```

זה ייצור 100 לקוחות · 1,000 ישויות · 2,500 טלפונים · 200 משימות.

## כניסה למערכת

- כתובת: **http://localhost** (פורט 80, לא 5173)
- שם משתמש: `alice`
- סיסמה: `change-me-on-first-deploy`

> ⚠️ הסיסמה היא ברירת-מחדל פיתוחית. לפני העלאה לסביבה אמיתית, ערכי `backend/admins.example.json` (או הוסיפי `admins.json` ומאונטי אותו ב-`docker-compose.yml` — יש שם שורה מוכנה תחת תגובה).

## פקודות יומיומיות

| מה | פקודה |
|---|---|
| לעצור | `Ctrl+C` בחלון של compose |
| לעצור ולמחוק את ה-DB | `docker compose down -v` |
| להריץ ברקע (בלי לתפוס טרמינל) | `docker compose up -d` |
| לראות לוגים אחרי `-d` | `docker compose logs -f` |
| לבדוק מה רץ | `docker compose ps` |

## פתרון תקלות

**`unable to get image ... 500 Internal Server Error`**
Docker Desktop לא רץ או דורש restart. קליק ימני על אייקון הלוויתן → Restart.

**`Virtualization support not detected`**
תמיכת וירטואליזציה כבויה במחשב. ב-Task Manager → Performance → CPU בדקי "Virtualization". אם כתוב Disabled — להפעיל ב-BIOS (חפשי `Intel VT-x` / `AMD-V` / `SVM Mode`). אם כתוב "not available" — המעבד לא תומך וצריך מחשב אחר.

**שגיאת login ("שם משתמש או סיסמה שגויים") במצב Mongo/API**
תוקן בקומיט `253efbc`. אם זה צץ — לוודא שהענף `claude/design-platform-milestones-FLjN0` משוך עד הסוף.

## ארכיטקטורה בקצרה

- **`backend/`** — FastAPI + SQLModel. ברירת מחדל SQLite; ניתן להחליף ל-Mongo או ל-REST API חיצוני דרך **System Settings** במערכת (admin בלבד).
- **`frontend/`** — React + Vite, ממשק עברי RTL.
- **System Settings** (גלגל שיניים → admin בלבד) — מאפשר לערוך עמודות טבלאות, פילטרים מותאמים, שדות קלט דינמיים, אוצרות מילים, ובחירת backend.

מסמך התכנון המלא: `CLAUDE.md` בשורש.
