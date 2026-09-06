#!/usr/bin/env bash
#
# One-time setup for a fresh Amazon Lightsail instance (Ubuntu 22.04+).
#
# Builds the container on the instance itself, which avoids needing Docker locally,
# and puts Caddy in front for automatic HTTPS. Run it once; after that, redeploys are
# `deploy/redeploy.sh`.
#
#   ssh ubuntu@<static-ip>
#   curl -fsSL https://raw.githubusercontent.com/hammad-khan1/Tabeeb/main/deploy/lightsail-setup.sh | bash
#
# Then write /opt/tabeeb/.env (see .env.example) and run deploy/redeploy.sh.

set -euo pipefail

REPO="${REPO:-https://github.com/hammad-khan1/Tabeeb.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/tabeeb

echo "==> Installing Docker"
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -qq
sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"

echo "==> Adding swap"
# A 2GB instance building a Next app can exhaust RAM during the build and be OOM-killed
# with no useful message. Swap makes the build survive; it is not for runtime.
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

echo "==> Cloning the repository"
sudo mkdir -p "$APP_DIR"
sudo chown "$USER:$USER" "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin && git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

echo "==> Installing Caddy for automatic HTTPS"
# Caddy obtains and renews a Let's Encrypt certificate on its own, which is the whole
# reason it is here rather than nginx: no certbot, no cron, no renewal to forget.
sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
sudo apt-get update -qq
sudo apt-get install -y -qq caddy

cat <<'CADDY' | sudo tee /etc/caddy/Caddyfile > /dev/null
# Replace the placeholder with your domain, then: sudo systemctl reload caddy
#
# Without a domain, use the instance's public IP and Caddy serves plain HTTP — fine
# for a first check, but Clerk requires HTTPS for a production instance.
:80 {
	reverse_proxy 127.0.0.1:3000
}
CADDY
sudo systemctl reload caddy

echo
echo "Setup complete."
echo
echo "Next:"
echo "  1. Write $APP_DIR/.env  (copy .env.example and fill it in)"
echo "  2. bash $APP_DIR/deploy/redeploy.sh"
echo
echo "Log out and back in first, so your shell picks up docker group membership."
