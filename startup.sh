#!/usr/bin/env bash
# NASAQ dev server — kept in sync with package.json `dev`.
set -u
cd "$(dirname "$0")"
PORT=8080
if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
  echo "nasaq dev already up on :${PORT}"
  exit 0
fi
nohup npm run dev >/tmp/nasaq-dev.log 2>&1 &
echo "nasaq dev starting on :${PORT} (pid $!)"