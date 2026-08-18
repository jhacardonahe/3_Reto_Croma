# PENDIENTES — Reto Croma (SECOP Intelligence)

> Lista para retomar el proyecto. Actualizado: **2026-08-16**.
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

### ✅ Cerrado 2026-08-18 (AGENTE VIVO: memoria de barrido + latido + Telegram)
> Cierra P0-1 y P0-2 de `COMPARATIVA-CENTINELA.md`. Ataca **originalidad**: el sistema
> deja de esperar a que alguien abra el tablero y **habla primero**.
- **Memoria de barrido** (`src/modules/seen.ts`, práctica traída de `detect.ts` de Centinela):
  `notice_uid → hash(fase|estado|valor|cierre|línea)` en `data/cache/seen.json`. Clasifica cada
  oportunidad como `new` / `changed` / `known`. La huella **excluye score y días al cierre** a
  propósito: cambian solos con el tiempo y marcarían todo como "actualizado" cada latido.
  Poda a 120 días sin verse; un archivo corrupto arranca vacío (nunca tumba el barrido).
- **Latido** (`src/cli/sweep.ts` + `npm run sweep`): barre → compara contra la memoria →
  envía digest → **guarda la memoria SOLO si el envío salió bien** (si Telegram falla, el
  próximo latido reintenta; preferimos repetir un aviso a perderlo). `--dry-run` muestra el
  mensaje sin enviar ni escribir.
- **Telegram sin dependencias** (`src/notify/telegram.ts`): la Bot API es un POST JSON y
  `fetch` es nativo. Parte mensajes >4096 en frontera de línea, botones inline solo en el
  último trozo, y **ningún error se propaga** (notificar jamás tumba el barrido).
  Probado con fetch inyectado: payload, troceo (4 trozos, máx 4091), 429 y ECONNRESET.
- **Digest puro** (`src/notify/digest.ts`): un mensaje por corrida con el top-N. Cada
  oportunidad lleva `notice_uid` + chip del guard de citas → **el estándar de "nada afirmado
  sin fuente" viaja también al canal nuevo**. Sin novedades ⇒ `null` (el agente calla).
- **systemd**: `deploy/secop-intelligence-sweep.service` + `.timer` (11/17/23 UTC = 06/12/18
  Colombia; fijado en UTC para no depender de la zona del VPS). `deploy-vps.sh` instala y
  activa el timer y propaga `TELEGRAM_*` + `PUBLIC_BASE_URL` al `.env` remoto.
- **Tablero**: chips **NUEVO** / **ACTUALIZADO** + contador en la barra de meta, leyendo la
  misma memoria en **solo lectura** (solo el barrido la consume ⇒ abrir el tablero no
  silencia un aviso pendiente).
- **Conversación**: `n8n/asesor-telegram.workflow.json` — mismo asesor, Telegram Trigger en
  vez de Chat Trigger, memoria por `chat.id` y **lista blanca de chats** (sin ella, cualquiera
  que encuentre el bot gasta cuota de Croma y de OpenAI).
- **Gate**: `npm run eval` **18/18** (7 casos nuevos, 3 de ellos trampas: *solo pasa el tiempo*
  → `known`, *sin novedades* → silencio, *`<script>` en el objeto* → escapado). typecheck +
  build limpios.
- **Pendiente de operación**: crear el bot en @BotFather, poner `TELEGRAM_BOT_TOKEN` +
  `TELEGRAM_CHAT_ID` en el `.env` local, redesplegar (`deploy/deploy-vps.sh`) e importar el
  workflow de Telegram en n8n (reemplazar credencial y `REEMPLAZA_CON_TU_CHAT_ID`).

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

- [x] **🔎 REVISAR ANTES DE DESPLEGAR — posibles cambios de procesos en paralelo.** ✅ HECHO (2026-08-16):
      verificación de integridad completa — HEAD contiene INTACTO el panel SSE (`streamOpportunities`,
      ruta `/api/opportunities/stream`, `onEvent`/`MonitorEvent`, `id="trace"`); gate `typecheck`+`build`+
      `eval` **11/11** en verde; `PENDIENTES.md`+`nginx-autodata.conf` commiteados (`de2801c`); market no
      rompió nada compartido. Redeploy hecho y verificado. *(contexto histórico abajo)* Otras sesiones
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

- [x] **⚡ Paralelizar la fase de detalle del pipeline** — HECHO (2026-08-16, commit `68fd885`).
      Pool de workers con concurrencia acotada (default 5, opción `detailConcurrency`) que tira de
      un cursor compartido, tanto en `runMonitoring` como en `analyzeMarket`. El tope `maxDetail`
      se **reserva de forma atómica** (sin `await` entre el check y el `++` ⇒ indivisible por ser
      monohilo), así que nunca se pasa. El `RateLimiter` del cliente sigue garantizando el techo/min
      ⇒ la corrección se mantiene; la paralelización colapsa la latencia dentro de cada ventana de
      60s (10 seriales ~20-30s de espera → concurrentes casi instantáneo). En `market.ts` además las
      listas por entidad van en `Promise.all` y el presupuesto por entidad se respeta con un `slice`.
      **Nota:** una corrida EN FRÍO de 60 detalles sigue teniendo piso ~6 min por `maxCallsPerMin=10`
      (el rate-limit, no la latencia, es el cuello); el beneficio se nota en corridas tibias/parciales.
      Verificado e2e: DILOF 500→102→60 (0 fallidos)→3 oportunidades, guard 5/5 OK en las tres.

- [x] **🐞 `/api/market` devuelve TODO EN CERO** — RESUELTO (`c9cbe14`) y **RE-VERIFICADO en producción
      2026-08-16** tras el redeploy que tocó `market.ts`: HTTP 200, 2 contratos reales $6.8B (EPIA SAS +
      AUTOMAYOR, `contract_id` CO1.PCCNTR.9546483/.9547105, DILOF). La paralelización no lo rompió.
      *(diagnóstico histórico abajo)* (verificado e2e 2026-08-16, 02:05).
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

- [~] **📈 (Mejora mercado) Ampliar la lista de entidades compradoras** — AVANCE (2026-08-16, `68fd885`).
      +1 verificada: **Departamento de Cundinamarca `899999114`** (COMPRAVENTA PARQUE AUTOMOTOR $2.70B,
      VEHÍCULOS ESPECIALES NECROMOVIL $2.67B, adjudicados). Ahora `entities.json` tiene **5** compradoras.
      **Descartadas** contra Croma en la misma sesión (0 adquisiciones de vehículos en la ventana):
      Agencia Logística FF.MM. `899999162` (solo mantenimiento/tecnomecánica), Valle/Sec. Paz `890399029`,
      Santander `890201235`. MinDefensa `899999095` → 0 procesos. Seguir sumando: probar alcaldías
      capitales y otras gobernaciones con `secop_processes_by_entity` (filtro: `contract_type`∈bienes +
      nombre vehículo + precio≥30M + estado adjudicado) antes de cargar. **Ojo:** subir `maxDetail`/`perEntity`
      en proporción al nº de entidades, o el barrido de mercado se reparte muy fino.
      ✅ **DESPLEGADO 2026-08-16**: `deploy-vps.sh` corrido; health remoto reporta `entities:5`, servicio
      `active`+`enabled`, HTTPS OK. Cundinamarca + la paralelización YA están en producción.
      **Fase 1 ampliada (`6231ac0`, 2026-08-16):** +6ª entidad **Dirección de Tránsito y Transporte Policía
      `830090486`** (cosechada de `contracts_by_provider(EPIA)` → compradores reales; necromóvil $2.12B).
      Método ganador: cosechar compradores de los contratos de los vendedores conocidos (AUTOMAYOR/EPIA),
      NO adivinar NITs. **Descartadas** por 0 aciertos Foton-relevantes en ventana reciente: Santa Marta
      891780009, DIJIN 800141338 (solo motos), Envigado, Barranquilla 890102018, Cali 890399011,
      Bogotá-Seguridad 899999061, Pasto 891280000, Nariño 800103923, Boyacá 891800498, ICBF 899999239,
      Meta 892000148, UNP 900576918. **HALLAZGO:** el mercado Foton se concentra en compradores de
      **camionetas tipo DILOF/Policía**; motos/necromóviles-genéricos/parque-automotor sin carrocería
      → UNKNOWN (bien descartados). ⚠️ La 6ª entidad aún NO está en producción (falta redeploy).

- [ ] **⚠️ HALLAZGO OPERATIVO — barrido profundo satura Croma (2026-08-16).** Barrido completo de las 6
      entidades (`--from 2025-01-01 --max-detail 400 --concurrency 5`, ventana amplia): 2660 procesos →
      668 prefiltrados → 400 detalles pero **331 FALLIDOS (83%)** por 502/timeout tras agotar reintentos;
      **2h28m** de corrida; solo **3 oportunidades** (todas DILOF, guard 5/5 OK). Dos lecturas: (1) la
      **corrección aguantó** — 83% de fallos y aun así completó y verificó las 3 válidas; el guard + el
      skip-on-error son robustos. (2) Un sweep agresivo (400 lookups sostenidos, conc. 5) hace que Croma
      **throttlee la API key**. **Recomendación:** para barridos profundos bajar `--concurrency` a 2-3 y/o
      subir el techo con espaciado; el **default de producción (maxDetail 60, ventana 7d)** es el sobre
      correcto y NO sufre esto (la corrida DILOF de 60 lookups dio 0 fallidos). NO regenerar `demo-run.json`
      desde esta corrida degradada — las 3 oportunidades son las mismas de la versión limpia.
      ✅ **CAUSA RAÍZ CONFIRMADA + MITIGADA (2026-08-16):** el límite real de Croma es el **Default Bucket**
      (docs.usecroma.com/rate-limits; header observado `X-RateLimit-Limit: 600`, reinicio diario 00:00 UTC),
      compartido por TODA la organización — mis sweeps + verificaciones de NITs por MCP lo agotaron y por eso
      `/api/market` y `/api/retrospective` daban 0 en producción. **Resuelto** (`fbbfebb`): (1) **key de
      respaldo** `CROMA_API_KEY_BACKUP` con **failover pegajoso en 429**; (2) el cliente **lee los headers
      `X-RateLimit-*`** y expone `/api/usage`; (3) **barra de cuota en la UI** (arriba) con restante/límite,
      key activa y hora de reinicio. Verificado en prod: retrospectiva 17 cerradas $55.31B; usage 70/600.

## ✅ Cuota Croma + failover (2026-08-16) — HECHO y DESPLEGADO
- **Key de respaldo** (`CROMA_API_KEY_BACKUP` en `.env` local + `.env` remoto vía deploy; NUNCA al repo).
  Failover automático y pegajoso cuando la primaria devuelve **429** (cuota agotada).
- **Contador de rate-limit desde los headers** `X-RateLimit-Limit/Remaining/Reset` + `Retry-After`
  (fails-open: sin headers no pisa lo conocido). Endpoint `GET /api/usage` y `health.usage`.
- **Barra superior en el dashboard**: capacidad restante (verde/ámbar/rojo), key activa (primaria/backup)
  y reinicio; refresca al cargar, cada 30s y tras cada consulta. Límite real = header (Default Bucket, 600 obs.).

- [~] **Conseguir 3–5 NITs de entidades que SÍ compran vehículos** — 5 cargadas y verificadas
      (DILOF, Antioquia, INVÍAS, Distrito CT+i Medellín, Cundinamarca). Se puede seguir sumando
      alcaldías capitales / gobernaciones (ver ítem 📈). *La UdeA no compra camionetas → 0 matches.*
- [x] **Correr monitoreo sobre una entidad compradora real** — HECHO varias veces; DILOF produce
      3 oportunidades reales clasificadas (PICKUP_MHEV score 69, AUV_VAN 67.5), guard 5/5 OK.
- [ ] **Verificar y cargar NITs reales de competidores OEM** en `data/competitors.json`
      (Toyota, Nissan, Ford, Isuzu, Mitsubishi, GWM, JMC — importadores en Colombia).
      Fuente de apoyo: docs de competencia en el proyecto Formación-Tunland (uso interno).
      *(Hoy hay 2 competidores REALES derivados de contratos: AUTOMAYOR + EPIA SAS.)*
- [x] **Actualizar `data/entities.json`** con NITs verificados — hecho; las 5 entidades son reales
      y verificadas en vivo contra Croma (ya no hay ejemplos "verificar").
- [ ] (Opcional) Enriquecer keywords del clasificador con la línea Tunland (G7/G9/V7/V9/eTunland, MHEV).
- [ ] (Roadmap) `price_gap` competitivo: cruzar valor de contrato vs. valor estimado del proceso.
- [ ] (Opcional) Cablear webhook N8N apuntando a `GET /api/opportunities` en un schedule.

---

## 📦 Entregables del formulario (obligatorios salvo indicación)

- [ ] **[OBLIGATORIO] Integrantes del equipo** — cada persona: correo registrado en Luma + WhatsApp.
- [ ] **[OBLIGATORIO] Video de 1 minuto** — problema → solución → demo.
- [x] **[RECOMENDADO] Link al producto desplegado** — ✅ **https://autodata.jyrmecatronica.com**
      (VPS Hetzner, systemd + nginx + HTTPS Let's Encrypt). Al día con la última versión.
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
