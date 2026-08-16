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

### ✅ Cerrado 2026-08-16 (guard de citas — práctica traída de agentsprint-weg)
- **Guard de citas determinista** en `src/utils/verify.ts`: cada dato afirmado de una
  oportunidad (notice_uid, NIT, valor, cierre, publicación) se compara contra el payload
  CRUDO de Croma (summary+header) antes de emitir. Cero llamadas a modelo, tolerancia 2%.
  Los campos "aprox." (cantidad/unitario/specs) NO se verifican — se rotulan como estimación.
- Campo `verification` añadido a `OpportunityResult`; se calcula en `monitoring.ts` (datos reales)
  y en `demo.ts` (offline). **Chip "✓ Verificado N/N · Croma"** en el dashboard con tooltip por dato.
- **Control negativo pasado**: bloquea valor fabricado (ok:false, señala "Valor estimado"),
  bloquea notice_uid sin ancla, acepta redondeo dentro del 2%. typecheck + build limpios.
- Cierra la regla #1 de AGENTS.md ("ninguna afirmación sin cita") → refuerza criterio *Uso de Croma*.

### ✅ Cerrado 2026-08-16 (2 extensiones del guard)
- **Guard de agregados para competidor** (`verifyCompetitor` en `verify.ts`): recompone la suma
  sobre el set CRUDO completo y verifica que cada peso venga de un contrato con `contract_id`
  citable. Campo `verification` en `CompetitorAnalysis` + chip en la cabecera de la sección.
  **E2E real:** AUTOMAYOR `860034604` → "6 contratos citados (6/6 con ID Croma) · suma verificada",
  $3.33B, con los contract_id reales en el tooltip. Controles negativos OK (bloquea contrato sin ID
  y suma que no cuadra).
- **Eval harness offline** `npm run eval` (`src/cli/eval.ts` + `data/golden.json`, 11 casos):
  clasificador (5 líneas) + trampas (`trap-udea-editorial` real de Croma, `trap-aseo` → UNKNOWN) +
  controles negativos del guard (valor fabricado / sin fuente → deben bloquear). **11/11 pasan**;
  sale con exit≠0 si algo falla → sirve de GATE antes de desplegar. Corre sin CROMA_API_KEY.

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

## ✅ Panel de trazabilidad en vivo (SSE) — HECHO (2026-08-16)
> Hace VISIBLE el guard de citas: el evaluador ve cada dato del tablero naciendo de un `notice_uid`
> oficial y confirmándose contra el payload crudo de Croma. Refuerza el criterio "Uso de Croma".
- **Pipeline instrumentado** (`src/modules/monitoring.ts`): callback opcional `onEvent` + tipo
  `MonitorEvent` (`stage` / `entity` / `counts` / `progress` / `opportunity` / `summary`). Es
  **puramente observacional** — no altera el resultado de la corrida (los endpoints existentes y el
  CSV siguen intactos).
- **Endpoint SSE** `GET /api/opportunities/stream` (`src/api/handlers.ts` → `streamOpportunities`,
  ruta en `routes.ts`). Mismos filtros que `/api/opportunities`; emite eventos `event:` y cierra con
  `done` (payload idéntico al JSON de la tabla) o `failed` (nombre propio para no chocar con el
  `error` nativo de EventSource). Header `X-Accel-Buffering: no` para no bufferizar tras nginx.
- **Panel lateral** (`public/index.html`, `<aside id="trace">`): rail fijo derecho (colapsa abajo en
  <1100px). Muestra las 6 etapas con su explicación y estado en vivo (○→⟳→✓), métricas
  (procesados/pre-filtrados/detalles/verificadas) y feed por oportunidad con `✓ cita completa` /
  `⚠ parcial` + `notice_uid`. Cliente sobre `EventSource` con guarda `finished` (evita la
  reconexión automática que dispararía una corrida nueva y cara).
- **Verificado local (2026-08-16)** contra Croma real: typecheck + build limpios; stream emite todos
  los eventos; oportunidad real confirmada 5/5 (DILOF PICKUP_MHEV, `CO1.NTC.10661726`); evento `done`
  con la forma exacta que consume la tabla.
- **Nota de deploy (importante):** `deploy-vps.sh` NO reescribe el nginx.conf vivo porque ya tiene SSL
  (línea 79: solo instala si falta `listen 443`). El SSE funciona igual por el header
  `X-Accel-Buffering: no`. La plantilla `deploy/nginx-autodata.conf` ya trae un `location` dedicado
  con `proxy_buffering off` (para instalaciones limpias). **Si en producción el panel se ve "a
  saltos"/todo al final**, añadir a mano en el conf vivo del 443, en un `location = /api/opportunities/stream`:
  `proxy_buffering off; proxy_read_timeout 600s;` y `nginx -t && systemctl reload nginx`.

## 🔧 Pendientes técnicos (en orden de impacto)

- [ ] **🔎 REVISAR ANTES DE DESPLEGAR — posibles cambios de procesos en paralelo.** Otras sesiones
      trabajaron el árbol a la vez (trabajo de "mercado": commits `6d9ad37`…`c9cbe14`) y **committearon
      también mis cambios del panel SSE** — `git status` solo mostró `PENDIENTES.md` y
      `deploy/nginx-autodata.conf` sin commitear. **Quedó a medias la verificación de integridad**
      (la interrumpí a pedido). Antes de `deploy-vps.sh`, confirmar en la próxima sesión:
      - `git log --oneline` y `git status` — entender qué entró y qué falta por commitear.
      - Que HEAD contiene INTACTO el panel: `streamOpportunities` + ruta `/api/opportunities/stream`,
        `onEvent`/`MonitorEvent` en `monitoring.ts`, y `id="trace"` en `public/index.html`.
      - Que el trabajo de `market.ts`/`getMarket` no rompió nada compartido (ambos usan
        `runMonitoring`/`croma.process`): correr **`npm run typecheck` + `npm run build` + `npm run eval`
        (gate 11/11)** — última corrida local dio verde ANTES de los commits de mercado; re-verificar.
      - Commitear `PENDIENTES.md` + `deploy/nginx-autodata.conf` (cambios míos aún sin commitear).
      - Recordar: `/api/market` sigue con el bug de "todo en cero" (abajo) — no bloquea el panel, pero
        no lucirlo en el video hasta arreglarlo.

- [ ] **⚡ Paralelizar la fase de detalle del pipeline** (mejora del panel en vivo). Hoy en
      `runMonitoring` los `croma.process(notice_uid)` se hacen **secuenciales** (uno tras otro),
      cada uno gateado por el `RateLimiter`; una corrida en frío con el tope `maxDetail=60` puede
      superar 60s. **Fix:** cola con concurrencia acotada (p.ej. 5 en vuelo) que tira de los
      candidatos; el `RateLimiter` ya garantiza el techo por minuto, así que la corrección se
      mantiene. Caveats a manejar: el tope `maxDetail` necesita contador atómico (no `if` dentro
      del loop), y el orden de los eventos `progress`/`opportunity` deja de ser determinista
      (el panel ya los pinta como llegan, así que es aceptable). Beneficio: corrida ~concurrencia
      veces más rápida ⇒ demo/video más ágil. Aplica igual a `market.ts` (misma fase secuencial).

- [ ] **🐞 `/api/market` devuelve TODO EN CERO en producción** (verificado e2e 2026-08-16, 02:05).
      Corrida real contra el VPS: `http=200`, `t=208s`, **detail_lookups=40 pero contracts=0**,
      total_value $0, providers 0, sectores/proveedores/entidades vacíos.
      - **Dónde:** `src/modules/market.ts` → `analyzeMarket`. Flujo: por cada NIT `processesByEntity`
        → filtra `isAwardedVehicle` (bien + precio ≥30M + estado en `AWARDED_STATUS`
        seleccion/adjudic/celebr/ejecu/termin/liquid) → por candidato `croma.process(notice_uid)`
        → **lee `detail.contracts[]`** → clasifica → agrega. Gasta 40 detalles ⇒ el filtro SÍ
        encuentra candidatos, pero **`detail.contracts` sale vacío (o todo clasifica UNKNOWN)**.
      - **Hipótesis de causa raíz:** el endpoint `co/secop/process` (detalle) NO trae el array de
        contratos adjudicados para estos procesos; la vía que SÍ devuelve contratos con proveedor es
        `co/secop/contracts-by-provider` (la que usa el guard de competidor, probado: AUTOMAYOR 6/6).
        Es decir: `market.ts` está leyendo contratos de la fuente equivocada.
      - **Fix sugerido:** o (a) tomar `provider_nit` de `detail.awards[]` y luego `contractsByProvider`,
        o (b) reconstruir el mercado agregando `contractsByProvider` sobre los proveedores conocidos,
        o (c) confirmar con `croma.process` de UN notice adjudicado si `contracts`/`awards` vienen
        poblados antes de barrer.
      - **⚠️ Ojo:** `market.ts` es **WIP de la sesión Claude paralela `f3d5`** (últimos commits
        01:47–01:53 "feat/fix(mercado)"). NO tocar sin coordinar para no pisarnos. El deploy del
        2026-08-16 subió su última versión commiteada (01:53), que es la que responde en cero.
        El resto del sistema (oportunidades + guard + competidor) NO se ve afectado.
      - ✅ **RESUELTO 2026-08-16 (~02:12):** la causa NO era la fuente de datos sino el barrido.
        Fixes aplicados y desplegados (`c9cbe14`): (1) filtrar a procesos **adjudicados**;
        (2) **repartir el presupuesto de detalles por entidad** (breadth, no depth-first);
        (3) **pre-clasificar por el NOMBRE del proceso** para descartar motos/embarcaciones sin
        gastar Croma; (4) **caché de resultado en memoria** (TTL 30m) + caché de detalles en disco.
        Verificado en vivo: 4 contratos, $7.95B, 3 proveedores (incl. IMPLESI, no sembrado),
        2 entidades, 3 sectores; endpoint público en ~0.5s tras warm-up.

- [ ] **📈 (Mejora mercado) Ampliar la lista de entidades compradoras para "engordar" el mercado.**
      Hoy `/api/market` barre solo las 4 entidades de `data/entities.json`, por eso el mercado sale
      real pero pequeño (4 contratos). Sumar más compradores verificados (gobernaciones grandes,
      Ejército/Fuerzas Militares, Agencia Logística FF.MM., alcaldías capitales, INVÍAS, empresas de
      servicios públicos) daría un mercado por sector mucho más rico. Verificar cada NIT con
      `secop_processes_by_entity` antes de cargarlo y subir `maxDetail`/`perEntity` en proporción.

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
