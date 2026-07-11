#!/bin/sh
# Copy template files to real data files if they don't exist (first run)
for f in transactions cash_accounts super_holdings snapshots country_overrides; do
  if [ ! -f "/app/${f}.json" ]; then
    cp "/app/${f}.example.json" "/app/${f}.json"
    echo "[entrypoint] Created ${f}.json from template"
  fi
done

exec python app.py