#!/bin/bash
# Unit 27b's P2: a throwaway GitLab CE on this Mac, as a self-hosted server on its own name
# (https://gitlab.mirai.test) with a certificate from a certificate authority made for the run.
# Then glab is logged in to it with a token made inside the server, and an empty private project
# root/mirai-sample-app is made. teardown.sh removes all of it.
#   bash test/probes/gitlab-ce/setup.sh
set -euo pipefail
NAME=mirai-gitlab-ce
HOST=gitlab.mirai.test
IMAGE=gitlab/gitlab-ce:19.5.1-ce.0
DIR="$HOME/.mirai-gitlab-ce"
GLAB="$(command -v glab)"
export GLAB_CHECK_UPDATE=false GLAB_SEND_TELEMETRY=false GLAB_SHOW_WHATS_NEW=false

say() { printf '%s\n' "$*"; }

# 0. What it needs first.
if ! grep -qE "^127\.0\.0\.1[[:space:]]+$HOST\b" /etc/hosts; then
  say "First add the server's name to /etc/hosts (your Mac password):"
  say "  echo '127.0.0.1 $HOST' | sudo tee -a /etc/hosts"
  exit 1
fi
MEM=$(docker info --format '{{.MemTotal}}')
if [ "$MEM" -lt 3800000000 ]; then
  say "Docker Desktop has $((MEM / 1024 / 1024)) MB of memory; GitLab needs 4 GB or more."
  say "  Docker Desktop > Settings > Resources > Memory: 4 GB or more, Apply & restart, then run this again."
  exit 1
fi
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  say "$NAME already exists: run teardown.sh first"
  exit 1
fi

# 1. The certificate authority and the server's certificate (2 days).
mkdir -p "$DIR/ssl"
chmod 700 "$DIR"
cd "$DIR"
openssl req -new -newkey rsa:2048 -nodes -subj "/CN=MIRAI probe CA" -keyout ca.key -out ca.csr 2>/dev/null
printf 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n' > ca.ext
openssl x509 -req -in ca.csr -signkey ca.key -days 2 -extfile ca.ext -out ca.pem 2>/dev/null
openssl req -new -newkey rsa:2048 -nodes -subj "/CN=$HOST" -keyout "ssl/$HOST.key" -out server.csr 2>/dev/null
printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:%s\nauthorityKeyIdentifier=keyid\n' "$HOST" > server.ext
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 -extfile server.ext -out "ssl/$HOST.crt" 2>/dev/null
rm -f ca.key ca.csr server.csr ca.srl
chmod 644 ca.pem "ssl/$HOST.crt" "ssl/$HOST.key"
say "1. certificate authority: $DIR/ca.pem"

# 2. The server, on 127.0.0.1:443 only.
docker run -d --name "$NAME" --hostname "$HOST" -p 127.0.0.1:443:443 --shm-size 256m \
  -e GITLAB_OMNIBUS_CONFIG="external_url 'https://$HOST'; letsencrypt['enable'] = false; nginx['listen_https'] = true; prometheus_monitoring['enable'] = false; puma['worker_processes'] = 0; sidekiq['concurrency'] = 5; gitlab_rails['usage_ping_enabled'] = false; gitlab_kas['enable'] = false; registry['enable'] = false" \
  -v "$DIR/ssl:/etc/gitlab/ssl:ro" "$IMAGE" >/dev/null
say "2. GitLab CE ($IMAGE) starting; this takes 5 to 15 minutes…"
for i in $(seq 1 120); do
  if curl -fsS --cacert "$DIR/ca.pem" "https://$HOST/users/sign_in" -o /dev/null 2>/dev/null; then break; fi
  sleep 10
  [ $((i % 6)) -eq 0 ] && say "   still starting ($((i / 6)) min)"
done
curl -fsS --cacert "$DIR/ca.pem" "https://$HOST/users/sign_in" -o /dev/null
say "   up, and its certificate checks out against the probe's authority"

# 3. A token for root, made inside the server, never printed; glab logged in with it.
TOKEN="glpat-$(openssl rand -hex 16)"
docker exec -e T="$TOKEN" "$NAME" gitlab-rails runner "t = User.find_by_username('root').personal_access_tokens.create!(scopes: [:api, :write_repository], name: 'mirai-probe', expires_at: 2.days.from_now); t.set_token(ENV['T']); t.save!" >/dev/null
"$GLAB" config set ca_cert "$DIR/ca.pem" --host "$HOST"
printf '%s\n' "$TOKEN" | "$GLAB" auth login --hostname "$HOST" --stdin --git-protocol https --api-protocol https >/dev/null
unset TOKEN
"$GLAB" auth status --hostname "$HOST" >/dev/null 2>&1 && say "3. glab logged in to $HOST as root (token in the Keychain)"

# 4. The project.
"$GLAB" api --hostname "$HOST" --method POST projects --raw-field name=mirai-sample-app --raw-field visibility=private >/dev/null
say "4. project root/mirai-sample-app made"
say ""
say "Now run P2:"
say "  cd ~/Projects/mirai && caffeinate -i node test/probes/gitlab-probes.js --yes --repo root/mirai-sample-app --host $HOST 2>&1 | tee ~/mirai-27b-p2.log"
