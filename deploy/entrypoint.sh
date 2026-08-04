#!/bin/sh
# Gunicorn rather than app.run(): Flask's built-in server is a development server and
# should not face the internet.
#
# ONE worker, threads for concurrency. This is deliberate and load-bearing:
#   - APScheduler starts at import, so N workers would run N copies of the price sync.
#   - The login throttle in app.py is an in-process dict; extra workers would each get
#     their own counter and multiply the effective attempt limit.
# Raise WEB_CONCURRENCY only after moving both of those out of process.
exec gunicorn \
  --bind 0.0.0.0:5050 \
  --workers "${WEB_CONCURRENCY:-1}" \
  --threads "${WEB_THREADS:-8}" \
  --timeout "${WEB_TIMEOUT:-120}" \
  --access-logfile - \
  --error-logfile - \
  app:app
