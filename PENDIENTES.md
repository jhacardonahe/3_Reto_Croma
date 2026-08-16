# PENDIENTES — Reto Croma (SECOP Intelligence)

> Lista para retomar el proyecto. Actualizado: **2026-08-15**.
> ⏰ **CIERRE DE ENTREGA: 16 de agosto de 2026, 6:30 p. m.** (formulario de Croma)

---

## ▶️ Cómo retomar (arranque rápido)

```bash
cd /home/codevars/3_Reto_Croma/secop-intelligence
npm install                     # si es primera vez tras reabrir
# La CROMA_API_KEY ya está en .env (local, NO se sube a git)
npm run dev                     # dashboard en http://localhost:8096
npm run demo                    # motor sin key → data/test-run.json
npm run monitor -- --nits <NIT> --from 2026-06-01 --limit 20
```

Repo público: **https://github.com/jhacardonahe/3_Reto_Croma**
Documento-norte del reto: `RETO.md`

---

## ✅ Ya hecho
- MVP funcional (Monitoring, Classification, Competitive, Tracking, Alerting, API, Dashboard, CLI).
- Typecheck limpio; server arranca en :8096; `demo` genera `test-run.json`.
- `CROMA_API_KEY` configurada en `.env` (local); pipeline probado con datos reales.
- Pipeline endurecido: pre-filtro por `contract_type`+precio, guarda contra `notice_uid` null, tolerante a 502.
- Repo público sincronizado. `CLAUDE.md` retirado del repo/historial (guardado local fuera del repo).

### ✅ Cerrado 2026-08-15 (sesión Croma en vivo)
- **4 NITs de entidades VERIFICADOS** contra Croma y cargados en `data/entities.json`:
  DILOF/Policía `800141397` (⭐ camionetas SUV híbrida), Antioquia `890900286`, INVÍAS `800215807`,
  Distrito CT+i Medellín `890905211`. (UdeA retirada: compra servicios, no vehículos.)
- **Corrida real de monitoreo**: 2000 procesos → 454 pre-filtrados → **3 oportunidades clasificadas**
  (top: DILOF PICKUP_MHEV, score 68.95).
- **2 competidores REALES verificados** en `data/competitors.json`, derivados de contratos adjudicados
  (§8, no adivinados): AUTOMAYOR S.A. `860034604` (6 contratos, $3.33B) y EPIA SAS `830096621`.
- **Prueba e2e local PASADA**: health, opportunities, competitor-analysis, contracts/tracking y dashboard,
  todos 200 con datos reales de Croma.
- **`data/demo-run.json` generado** (respaldo salvavidas §11 con salidas reales de los 3 endpoints núcleo).

---

## 🤖 Asesor Comercial (agente n8n + widget) — EN PRODUCCIÓN (2026-08-15)
- Workflow `n8n/asesor-comercial.workflow.json` importado y ACTIVO en el n8n del VPS
  (`docker-caddy-n8n-1`, https://n8n.jyrmecatronica.com), id `secopAsesorFoton01`.
- Chat Trigger (webhook `secop-asesor-foton`) → AI Agent (gpt-4.1-mini, cred "OpenAi account")
  con 3 herramientas `httpRequestTool`+`$fromAI` que consumen la API SECOP:
  **buscar_oportunidades** (segmento/departamento/palabra clave/NITs/fecha), **analizar_competidor**,
  **seguimiento_contrato**. Verificado e2e por chat con datos reales.
- Widget `@n8n/chat` (botón flotante) embebido en el dashboard; CORS habilitado para autodata.
- Nota infra: el 2º stack n8n (`n8n-n8n-1`+postgres) está roto/crash-loop (no lo tocamos).

## ✅ Opcionales técnicos — HECHOS (2026-08-16)
- **Widget autoalojado**: `@n8n/chat` servido desde `/vendor/*` (sin CDN jsdelivr).
- **price_gap** en seguimiento de contrato: `(valor adjudicado − estimado del proceso)/estimado`,
  tomando el noticeUID de la URL del contrato. Guard: solo compara si el contrato cubre ≥40% del
  estimado (evita ruido multi-lote). Verificado: CO1.PCCNTR.7874619 → −9.6% (bajo el estimado).
- **Especificaciones generales** del texto del objeto (`extractSpecs`): tracción, combustible,
  carrocería, blindaje con nivel, cilindraje. En oportunidades y contratos de competidor (pills + CSV).
  Nota: la vía de **pliegos PDF NO fue viable** (extract_markdown de Croma falla en SECOP II y los
  anexos no son accesibles) → se entregó la versión factible desde el texto.

## 🔧 Pendientes técnicos (en orden de impacto)

- [ ] **Conseguir 3–5 NITs de entidades que SÍ compran vehículos** y verificarlos con Croma
      (`secop_processes_by_entity`). Candidatos: gobernaciones, alcaldías grandes, Policía Nacional,
      Ejército, INVÍAS, empresas de servicios públicos. *La UdeA no compra camionetas → 0 matches.*
- [ ] **Correr monitoreo sobre una entidad compradora real** para obtener oportunidades positivas
      clasificadas (esto es lo que luce en el video/demo).
- [ ] **Verificar y cargar NITs reales de competidores** en `data/competitors.json`
      (Toyota, Nissan, Ford, Isuzu, Mitsubishi, GWM, JMC — importadores en Colombia).
      Fuente de apoyo: docs de competencia en el proyecto Formación-Tunland (uso interno).
- [ ] **Actualizar `data/entities.json`** con los NITs verificados (hoy son ejemplos "verificar").
- [ ] (Opcional) Enriquecer keywords del clasificador con la línea Tunland (G7/G9/V7/V9/eTunland, MHEV).
- [ ] (Roadmap) `price_gap` competitivo: cruzar valor de contrato vs. valor estimado del proceso.
- [ ] (Opcional) Cablear webhook N8N apuntando a `GET /api/opportunities` en un schedule.

---

## 📦 Entregables del formulario (obligatorios salvo indicación)

- [ ] **[OBLIGATORIO] Integrantes del equipo** — cada persona: correo registrado en Luma + WhatsApp.
- [ ] **[OBLIGATORIO] Video de 1 minuto** — problema → solución → demo.
- [ ] **[RECOMENDADO] Link al producto desplegado** — falta **deploy** (Render / Railway / Fly.io).
- [ ] **[OPCIONAL] Presentación**.
- [x] **[OPCIONAL] Repositorio público** — listo.
- [ ] **Enviar el formulario de entrega** antes del cierre.

---

## 🟢 Deploy en VPS → https://autodata.jyrmecatronica.com (EN PRODUCCIÓN)
- **DESPLEGADO y verificado 2026-08-15**: systemd `secop-intelligence` (active+enabled), nginx + **HTTPS
  (Let's Encrypt, expira 2026-11-14, auto-renovación)**, redirect http→https. E2E remoto OK:
  `/` 200, `/api/health` ok, `POST /api/competitor-analysis` con datos reales (AUTOMAYOR $3.33B).
- **Link para el formulario:** https://autodata.jyrmecatronica.com
- Operación: `ssh root@46.225.123.7 'systemctl status secop-intelligence'` · logs `journalctl -u secop-intelligence -f`.
- Re-deploy (tras cambios): cargar llave en el agente y `bash deploy/deploy-vps.sh` de nuevo (idempotente).

## 🚀 Deploy en VPS — notas del script (referencia)
- Destino: VPS Hetzner `root@46.225.123.7`, subdominio **autodata.jyrmecatronica.com**, puerto interno 8096.
- **Diagnóstico llave:** la del VPS es `~/.ssh/hetzner_N8N_Letin_IA_key` (CIFRADA con passphrase);
  `id_ed25519` no está autorizada. Antes fallaba solo porque `BatchMode` no podía desbloquear la cifrada.
- **Deploy turnkey ya preparado** en `secop-intelligence/deploy/` (build de prod validado local):
  - `deploy-vps.sh` — idempotente: instala Node, rsync, `.env` remoto (600), `npm ci`+build, systemd, nginx, health check.
  - `secop-intelligence.service` (systemd) + `nginx-autodata.conf` + `README.md`.
- **Para ejecutarlo (desde tu PC, cuando estés frente a él):**
  ```bash
  eval $(ssh-agent) && ssh-add ~/.ssh/hetzner_N8N_Letin_IA_key   # pide passphrase (no queda en disco)
  cd ~/3_Reto_Croma/secop-intelligence && bash deploy/deploy-vps.sh
  ```
- **Post-deploy (tú, una vez):** registro DNS A `autodata.jyrmecatronica.com -> 46.225.123.7`, luego
  `ssh root@46.225.123.7 'certbot --nginx -d autodata.jyrmecatronica.com --agree-tos -m jhacardonahe@gmail.com'`.
- Alternativa sin VPS: Render/Railway/Fly.io (`npm run build && npm start`, env `CROMA_API_KEY`/`PORT`).

---

## ⚠️ Recordatorios
- `.env` (con la API key) es **local y gitignored** — no se sube. Al reabrir, sigue ahí.
- No commitear datos comerciales sensibles ni `CLAUDE.md` al repo público.
- Ruta crítica sugerida: **NIT real → corrida con matches → deploy → video → enviar formulario.**
