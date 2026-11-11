#!/bin/bash
# Removes what setup.sh made: glab's login and settings for the server, the container and its
# volumes, the certificate authority. The /etc/hosts line is yours to remove (printed at the end).
#   bash test/probes/gitlab-ce/teardown.sh
set -uo pipefail
NAME=mirai-gitlab-ce
HOST=gitlab.mirai.test
DIR="$HOME/.mirai-gitlab-ce"
GLAB="$(command -v glab)"
export GLAB_CHECK_UPDATE=false GLAB_SEND_TELEMETRY=false GLAB_SHOW_WHATS_NEW=false
"$GLAB" auth logout --hostname "$HOST" >/dev/null 2>&1 && echo "glab logged out of $HOST"
"$GLAB" config set ca_cert "" --host "$HOST" >/dev/null 2>&1
docker rm -fv "$NAME" >/dev/null 2>&1 && echo "container $NAME and its volumes removed"
rm -rf "$DIR" && echo "$DIR removed"
if grep -q "$HOST" /etc/hosts; then
  echo "Last, remove the /etc/hosts line (your Mac password):"
  echo "  sudo sed -i '' '/gitlab\\.mirai\\.test/d' /etc/hosts"
fi
