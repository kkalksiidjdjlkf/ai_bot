#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

stop_requested=0
child_pid=""

cleanup() {
  stop_requested=1
  if [[ -n "$child_pid" ]]; then
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  echo "Stop requested. Bot launcher exited."
  exit 0
}

trap cleanup INT TERM

if [[ ! -f dist/index.js ]]; then
  echo "Build artifacts not found. Running npm run build..."
  npm run build || exit 1
fi

while [[ $stop_requested -eq 0 ]]; do
  echo "Starting bot process..."
  node dist/index.js &
  child_pid=$!

  wait "$child_pid"
  exit_code=$?
  child_pid=""

  if [[ $stop_requested -eq 1 ]]; then
    break
  fi

  echo "Bot exited with code $exit_code. Restarting in 3 seconds..."
  sleep 3
done
