#!/bin/sh
# Restart contract: bring the app back up after a hibernate/revive.
#
# In the sandbox this runs from `/workspace/startup.sh`; this copy travels with
# the project, so it resolves its own directory and works from wherever the
# archive was unzipped.
set -eu
cd "$(dirname "$0")"

# Children are detached with nohup + setsid so they survive this script exiting.
# With a bare `&` the revive shell's exit sends SIGHUP to both processes, which
# leaves the app listening locally yet the public preview URLs answering 502.
start_detached() {
  log_file="$1"
  shift
  nohup setsid "$@" >>"$log_file" 2>&1 &
}

wait_for() {
  url="$1"
  attempts="$2"
  i=0
  while [ "$i" -lt "$attempts" ]; do
    if curl -sf -o /dev/null --max-time 2 "$url"; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

# 1. Dev server on 0.0.0.0:8080 (the binding contract in AGENTS.md §1).
#    Vite needs time to boot, so wait rather than assume it is instantly up.
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  if command -v npm >/dev/null 2>&1; then
    start_detached /tmp/app-startup.log npm run dev
  else
    start_detached /tmp/app-startup.log node scripts/with-app-env.mjs ./node_modules/.bin/vite dev --host 0.0.0.0 --port 8080
  fi
  wait_for http://127.0.0.1:8080/ 60 || echo "startup: dev server did not answer on 8080" >&2
fi

# 2. Preview bridge: the sandbox forwards its public hosts to 12000/12001 rather
#    than 8080, so without this the public preview URLs answer 502 even though
#    localhost is healthy. Outside the sandbox it is harmless — it only binds
#    those ports when they are free.
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:12000/; then
  start_detached /tmp/preview-bridge.log node scripts/preview-bridge.mjs
  wait_for http://127.0.0.1:12000/ 20 || echo "startup: preview bridge did not answer on 12000" >&2
fi
