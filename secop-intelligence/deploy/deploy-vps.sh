#!/usr/bin/env bash
# =============================================================================
# Deploy de SECOP Intelligence al VPS Hetzner → autodata.jyrmecatronica.com
# Idempotente: se puede correr las veces que quieras.
#
# REQUISITOS EN TU PC (una sola vez, antes de correr esto):
#   eval $(ssh-agent)
#   ssh-add ~/.ssh/hetzner_N8N_Letin_IA_key      # te pide el passphrase (no queda en disco)
#   ssh-add -l                                    # debe listar la llave
#
# Uso:
#   bash deploy/deploy-vps.sh
# =============================================================================
set -euo pipefail

REMOTE="root@46.225.123.7"
DOMAIN="autodata.jyrmecatronica.com"
APPDIR="/opt/secop-intelligence"
PORT="8096"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="$(dirname "$SCRIPT_DIR")"          # carpeta secop-intelligence/
SSH="ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"

echo "==> [1/7] Verificando acceso SSH a $REMOTE ..."
if ! $SSH "$REMOTE" 'echo ok' >/dev/null 2>&1; then
  echo "ERROR: no hay acceso SSH. Carga la llave primero:" >&2
  echo "  eval \$(ssh-agent) && ssh-add ~/.ssh/hetzner_N8N_Letin_IA_key" >&2
  exit 1
fi

echo "==> [2/7] Leyendo CROMA_API_KEY del .env local ..."
if [[ ! -f "$APP_SRC/.env" ]]; then echo "ERROR: falta $APP_SRC/.env" >&2; exit 1; fi
CROMA_API_KEY="$(grep -E '^CROMA_API_KEY=' "$APP_SRC/.env" | head -1 | cut -d= -f2-)"
if [[ -z "${CROMA_API_KEY:-}" ]]; then echo "ERROR: CROMA_API_KEY vacía en .env" >&2; exit 1; fi
# Key de respaldo (opcional): failover automático en 429. Se propaga al .env remoto si existe.
CROMA_API_KEY_BACKUP="$(grep -E '^CROMA_API_KEY_BACKUP=' "$APP_SRC/.env" | head -1 | cut -d= -f2-)"
# Canal del agente (opcional): si están, el latido avisa por Telegram; si no, solo escribe en disco.
TELEGRAM_BOT_TOKEN="$(grep -E '^TELEGRAM_BOT_TOKEN=' "$APP_SRC/.env" | head -1 | cut -d= -f2-)"
TELEGRAM_CHAT_ID="$(grep -E '^TELEGRAM_CHAT_ID=' "$APP_SRC/.env" | head -1 | cut -d= -f2-)"

echo "==> [3/7] Asegurando Node 18+ en el VPS ..."
$SSH "$REMOTE" 'bash -s' <<'REMOTE_SETUP'
set -e
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
mkdir -p /opt/secop-intelligence/data/cache
node -v
REMOTE_SETUP

echo "==> [4/7] Subiendo código (rsync, sin node_modules/.env/dist/caché) ..."
rsync -az --delete \
  --exclude 'node_modules' --exclude 'dist' --exclude '.env' --exclude '.git' \
  --exclude 'data/cache/*.json' \
  "$APP_SRC"/ "$REMOTE:$APPDIR/"

echo "==> [5/7] Escribiendo .env remoto (600) e instalando dependencias + build ..."
# El .env se genera por stdin para no exponer la key en la línea de comandos.
$SSH "$REMOTE" "umask 077 && cat > $APPDIR/.env" <<ENVEOF
CROMA_API_KEY=$CROMA_API_KEY
CROMA_API_KEY_BACKUP=$CROMA_API_KEY_BACKUP
CROMA_BASE_URL=https://api.croma.run
PORT=$PORT
CROMA_MAX_CALLS_PER_MIN=10
CACHE_TTL_HOURS=6
PUBLIC_BASE_URL=https://$DOMAIN
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID
ENVEOF

$SSH "$REMOTE" "bash -s" <<REMOTE_BUILD
set -e
cd $APPDIR
mkdir -p data/cache
npm ci
npm run build
REMOTE_BUILD

echo "==> [6/7] Instalando servicio systemd + nginx ..."
$SSH "$REMOTE" "install -m 644 $APPDIR/deploy/secop-intelligence.service /etc/systemd/system/secop-intelligence.service && systemctl daemon-reload && systemctl enable --now secop-intelligence && systemctl restart secop-intelligence"

# Latido del agente: unidad oneshot + timer (06/12/18 hora Colombia). El timer es lo que
# convierte el sistema en un agente que INICIA, en vez de esperar a que alguien abra el tablero.
$SSH "$REMOTE" "install -m 644 $APPDIR/deploy/secop-intelligence-sweep.service /etc/systemd/system/secop-intelligence-sweep.service && install -m 644 $APPDIR/deploy/secop-intelligence-sweep.timer /etc/systemd/system/secop-intelligence-sweep.timer && systemctl daemon-reload && systemctl enable --now secop-intelligence-sweep.timer && systemctl list-timers --no-pager secop-intelligence-sweep.timer | head -3"

$SSH "$REMOTE" "bash -s" <<REMOTE_NGINX
set -e
if command -v nginx >/dev/null 2>&1; then
  # Solo (re)instalar el vhost base si aún NO tiene SSL, para no pisar la config de certbot.
  if ! grep -qE "listen 443|ssl_certificate" /etc/nginx/sites-available/$DOMAIN 2>/dev/null; then
    install -m 644 $APPDIR/deploy/nginx-autodata.conf /etc/nginx/sites-available/$DOMAIN
    ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
  fi
  nginx -t && systemctl reload nginx
  # Si ya existe certificado para el dominio, reinstalar el bloque SSL (idempotente).
  if [ -d /etc/letsencrypt/live/$DOMAIN ] && command -v certbot >/dev/null 2>&1; then
    certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m jhacardonahe@gmail.com --redirect >/dev/null 2>&1 && echo "nginx: SSL reinstalado por certbot"
  else
    echo "nginx: sitio $DOMAIN habilitado (falta DNS A -> IP y luego: certbot --nginx -d $DOMAIN)"
  fi
else
  echo "AVISO: nginx no está instalado; el servicio escucha en 127.0.0.1:$PORT"
fi
REMOTE_NGINX

echo "==> [7/7] Health check remoto ..."
sleep 2
$SSH "$REMOTE" "curl -s http://127.0.0.1:$PORT/api/health && echo"

echo
echo "✅ Deploy OK. Pendiente (tú): registro DNS A  $DOMAIN -> 46.225.123.7  y luego:"
echo "   ssh $REMOTE 'certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m jhacardonahe@gmail.com'"
echo "   Logs: ssh $REMOTE 'journalctl -u secop-intelligence -f'"
