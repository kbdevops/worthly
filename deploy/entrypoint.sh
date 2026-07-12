#!/bin/sh
# Copy template files to the data directory if they don't exist (first run)
DATA_DIR="${DATA_DIR:-/app}"

for f in transactions cash_accounts super_holdings snapshots country_overrides; do
  if [ ! -f "${DATA_DIR}/${f}.json" ]; then
    cp "/app/data/${f}.example.json" "${DATA_DIR}/${f}.json"
    echo "[entrypoint] Created ${f}.json from template in ${DATA_DIR}"
  fi
done

exec python app.py