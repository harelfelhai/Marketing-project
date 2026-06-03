FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (layer-cached separately from source code)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Runtime data directory — SQLite DB + system_settings.json live here.
# Mount a named volume over /app/data so the DB survives container rebuilds.
RUN mkdir -p /app/data

# Default admins config: copy the example so the app can start without
# a host-mounted file. Override by mounting ./admins.json at runtime.
RUN cp admins.example.json /app/data/admins.json

ENV DATABASE_URL=sqlite:////app/data/app.db
ENV SYSTEM_SETTINGS_PATH=/app/data/system_settings.json
ENV ADMIN_CONFIG_PATH=/app/data/admins.json

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
