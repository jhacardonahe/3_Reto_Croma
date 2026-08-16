# Deploy — SECOP Intelligence → autodata.jyrmecatronica.com

Deploy al VPS Hetzner (`root@46.225.123.7`) con **un solo comando**, sin exponer
el passphrase ni la API key en el chat.

## Pasos (desde tu PC, cuando estés frente a él)

```bash
# 1) Cargar la llave del VPS en el agente (te pide el passphrase, NO queda en disco)
eval $(ssh-agent)
ssh-add ~/.ssh/hetzner_N8N_Letin_IA_key
ssh-add -l                       # verifica que aparece la llave

# 2) Desplegar
cd ~/3_Reto_Croma/secop-intelligence
bash deploy/deploy-vps.sh
```

El script es **idempotente**: instala Node 20 si falta, sube el código por rsync,
crea `.env` remoto (600) con tu `CROMA_API_KEY` local, `npm ci` + `npm run build`,
instala el servicio `systemd` y el sitio `nginx`, y hace un health check.

## Después del deploy (una vez)

```bash
# DNS: crea un registro A  autodata.jyrmecatronica.com -> 46.225.123.7
# Luego, SSL:
ssh root@46.225.123.7 'certbot --nginx -d autodata.jyrmecatronica.com --non-interactive --agree-tos -m jhacardonahe@gmail.com'
```

## Operación

```bash
ssh root@46.225.123.7 'systemctl status secop-intelligence'
ssh root@46.225.123.7 'journalctl -u secop-intelligence -f'      # logs en vivo
ssh root@46.225.123.7 'systemctl restart secop-intelligence'     # reiniciar
```

## Archivos

| Archivo | Rol |
|---|---|
| `deploy-vps.sh` | Orquestador idempotente (corre desde tu PC) |
| `secop-intelligence.service` | Unit systemd (`node dist/index.js`, puerto 8096) |
| `nginx-autodata.conf` | Reverse proxy `autodata.jyrmecatronica.com` → `127.0.0.1:8096` |
