#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) = 0 ]] || { echo 'Run as root.' >&2; exit 1; }
release=$(realpath "${1:?Usage: install-release.sh /opt/match-editor/releases/VERSION}")
[[ "$release" =~ ^/opt/match-editor/releases/[a-zA-Z0-9._-]+$ ]] || { echo 'Invalid release path.' >&2; exit 1; }
test -f "$release/campus-dist/admin.html"
test -f "$release/server/main.mjs"
test -x /opt/match-editor/runtime/bin/node
test -f /etc/match-editor.env
id match-editor >/dev/null 2>&1 || useradd --system --home-dir /var/lib/match-editor --shell /usr/sbin/nologin match-editor
install -d -m 0700 -o match-editor -g match-editor /var/lib/match-editor
if test -f /var/lib/match-editor/rosters.sqlite; then
  python3 - <<'PY'
import datetime, os, sqlite3
os.umask(0o077)
directory='/var/lib/match-editor/'
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
with sqlite3.connect(directory+'rosters.sqlite') as source, sqlite3.connect(directory+'backup-'+stamp+'.sqlite') as destination:
    source.backup(destination)
PY
else
  test -f /var/lib/match-editor/initial-copy.json
fi
if test -f /var/lib/match-editor/initial-copy.json; then
  chown match-editor:match-editor /var/lib/match-editor/initial-copy.json
  chmod 0600 /var/lib/match-editor/initial-copy.json
fi
previous=$(readlink -f /opt/match-editor/current || true)
install -m 0644 "$release/deploy/match-editor.service" /etc/systemd/system/match-editor.service
ln -s "$release" "/opt/match-editor/.current-$$"
mv -Tf "/opt/match-editor/.current-$$" /opt/match-editor/current
systemctl daemon-reload
systemctl enable match-editor
if systemctl restart match-editor; then
  for attempt in {1..15}; do
    if curl --noproxy '*' --fail --silent --max-time 2 http://127.0.0.1:8083/health | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("ok") and d.get("databaseBound") and d.get("adminConfigured") else 1)' 2>/dev/null; then
      echo 'Match editor running at http://10.129.83.25:8083/'
      exit 0
    fi
    sleep 1
  done
fi
echo 'Release failed; restoring the previous code release when available.' >&2
if test -n "$previous" && test -d "$previous" && test "$previous" != /opt/match-editor/current; then
  ln -s "$previous" "/opt/match-editor/.rollback-$$"
  mv -Tf "/opt/match-editor/.rollback-$$" /opt/match-editor/current
  systemctl restart match-editor
else
  systemctl stop match-editor
fi
exit 1
