# SECOP Intelligence · Foton Colombia × Croma

Sistema de **inteligencia de oportunidades de compra pública** de vehículos en SECOP II.
Detecta procesos, los **clasifica a la línea Foton** correspondiente, **puntúa la oportunidad**,
genera **alertas** para KAMs, analiza la **competencia** y hace **seguimiento post-adjudicación**.

Construido para el **IA-Hackathon GOV-TECH de Croma**. Toda la data proviene de la
plataforma **Croma** (API SECOP de Colombia Compra Eficiente) — Croma es el motor, no un adorno.

---

## Qué hace

| Módulo | Descripción | Croma |
|---|---|---|
| **Monitoring** | Lista procesos por entidad → pre-filtro barato → detalle → clasifica → puntúa → alertas | `processes-by-entity` + `process` |
| **Classification** | Motor jerárquico (first-match) que mapea el objeto a línea Foton con confianza | — |
| **Competitive** | Perfil de un competidor: contratos ganados, agrupados por línea, top entidades, sanciones | `contracts-by-provider` + `sanctions-by-provider` |
| **Tracking** | Ejecución %, retrasos, adiciones, garantías y health-score de un contrato ganado | `contract` (+ `sanctions-by-provider`) |
| **Alerting** | Reglas configurables (alto valor, cierre urgente, NEW ENERGY, MHEV, comprador recurrente) | — |
| **Seen (memoria)** | Huella de estado por proceso: distingue lo NUEVO de lo ya visto entre corridas | — |
| **Notify** | Digest por Telegram con la cita (`notice_uid` + chip del guard) en cada dato | — |

Líneas Foton soportadas: `NEW_ENERGY_PICKUP`, `PICKUP_MHEV`, `PICKUP`, `LDT`, `HDT`,
`NEW_ENERGY`, `AUV_VAN`, `SPECIAL`, `UNKNOWN`.

---

## Arranque rápido

```bash
cd secop-intelligence
npm install
cp .env.example .env         # y pega tu CROMA_API_KEY (usecroma.com → Get API key)

npm run demo                 # motor end-to-end SIN key → genera data/test-run.json
npm run dev                  # servidor + dashboard en http://localhost:8096
npm run monitor -- --from 2026-08-01 --limit 50   # corrida CLI, guarda data/cache/opportunities.json
npm run sweep -- --dry-run   # latido del agente en seco (no envía a Telegram ni escribe memoria)
npm run eval                 # gate del núcleo determinista (18 casos)
```

> Sin `CROMA_API_KEY`, el servidor arranca igual: `/api/health` responde y las rutas de datos
> devuelven un error claro pidiendo la key. `npm run demo` funciona sin key (valida el motor).

---

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado + si la key está configurada |
| GET | `/api/opportunities` | Top oportunidades. Query: `entity_nits` (coma), `from_date`, `limit`, `min_score`, `format=csv` |
| POST | `/api/competitor-analysis` | Body: `{ competitor_nit, period:{from_date,to_date} }` |
| GET | `/api/contracts/:contract_id/tracking` | Query opcional: `provider_document` (añade sanciones) |

Ejemplos:

```bash
curl "http://localhost:8096/api/opportunities?entity_nits=890980040&from_date=2026-06-01&limit=20"
curl "http://localhost:8096/api/opportunities?format=csv&from_date=2026-06-01" -o oportunidades.csv
curl -X POST http://localhost:8096/api/competitor-analysis \
  -H "Content-Type: application/json" -d '{"competitor_nit":"860001100"}'
curl "http://localhost:8096/api/contracts/CO1.PCCNTR.6794799/tracking"
```

El **dashboard** (raíz `/`) permite filtrar por NITs/fecha, ver el score, la línea Foton,
las alertas y el enlace directo a SECOP, y exportar a CSV.

---

## El agente vivo (latido + Telegram)

El sistema no espera a que alguien abra el tablero: **corre solo y avisa primero**.

```
systemd timer (06/12/18 hora Colombia)
  └─ npm run sweep
       ├─ runMonitoring()                    ← el pipeline de siempre
       ├─ memoria: huella(fase|estado|valor|cierre) por notice_uid
       │     new / changed / known           ← solo lo nuevo se cuenta
       ├─ digest → Telegram (con notice_uid + chip de verificación)
       └─ guarda memoria SOLO si el envío salió bien
```

**Por qué la huella ignora el score y los días al cierre:** ambos cambian solos con el
paso del tiempo. Si entraran en la huella, cada latido marcaría todo como "actualizado"
y el bot repetiría el mismo aviso tres veces al día. Hay un caso trampa en `npm run eval`
que lo vigila (`mem-solo-pasa-el-tiempo`).

**El silencio es una respuesta válida:** si no hay novedades, no se envía nada
(`digest-silencio` en el eval).

### Puesta en marcha

```bash
# 1. Bot: @BotFather → /newbot → copia el token
# 2. chat_id: escríbele al bot y abre
#    https://api.telegram.org/bot<TOKEN>/getUpdates  → result[0].message.chat.id
# 3. .env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, PUBLIC_BASE_URL

npm run sweep -- --dry-run    # muestra el mensaje SIN enviar ni tocar la memoria
npm run sweep                 # latido real
```

En el VPS lo instala `deploy/deploy-vps.sh` (unidades
`secop-intelligence-sweep.service` + `.timer`):

```bash
systemctl list-timers secop-intelligence-sweep.timer   # próximo latido
systemctl start secop-intelligence-sweep.service       # latido manual
journalctl -u secop-intelligence-sweep -n 50           # qué pasó
```

### Conversar con el agente

`n8n/asesor-telegram.workflow.json` es el mismo asesor comercial del widget web, con
Telegram Trigger en vez de Chat Trigger. Al importarlo hay que ajustar **tres cosas**:

1. Credencial `telegramApi` (el token del bot) en los tres nodos de Telegram.
2. `REEMPLAZA_CON_TU_CHAT_ID` en el nodo **¿Chat autorizado?** — es la lista blanca.
   Sin ella, cualquiera que encuentre el bot gasta tu cuota de Croma y de OpenAI.
3. Activar el workflow (el webhook de Telegram se registra solo).

El dashboard marca cada oportunidad con **NUEVO** / **ACTUALIZADO** leyendo la misma
memoria — en modo **solo lectura**: solo el barrido la consume, para que abrir el
tablero no silencie un aviso que aún no ha salido.

---

## Cómo funciona (pipeline de monitoreo)

```
entidades (NITs) ──► processes-by-entity (Croma)
      │                        │  resumen ligero: name/reference/contract_type/base_price
      │                        ▼
      │              pre-filtro barato por texto  ─── descarta lo que no huele a vehículo
      │                        ▼
      │              process (Croma)  ── trae description + bid_deadline (el resumen NO)
      │                        ▼
      │              classifyFotonLine(description)  ── first-match jerárquico
      │                        ▼
      │              score = valor(30) + urgencia(20) + entidad(25) + confianza(15)
      │                        ▼
      └──────────────► alertas + orden por score  ──► top-N
```

Decisión clave (verificada contra la API real el 2026-08-15): **el endpoint de lista NO
devuelve la descripción ni la fecha de cierre** — el `name` suele ser un código interno.
Por eso la clasificación corre sobre el **detalle** (`process`), con caché en disco para no
reconsultar (respeta el límite de llamadas y acelera corridas repetidas).

---

## Robustez (production readiness)

- **Rate-limiting** configurable (`CROMA_MAX_CALLS_PER_MIN`, default 10/min).
- **Retry con backoff exponencial** ante 429/5xx/timeout.
- **Caché en disco** con TTL (`CACHE_TTL_HOURS`) para procesos ya vistos.
- **Degradación limpia**: sin key el server no crashea; `found:false` de Croma se maneja sin fallar.
- **Tipos TypeScript** modelados sobre respuestas reales de Croma.

---

## Notas y limitaciones

- **NITs de `data/*.json` son EJEMPLOS — verificar antes de producción.** Confirmado en vivo que
  `890980040` = **Universidad de Antioquia** (no Medellín, como asumía el brief original).
- `price_gap` competitivo requiere cruzar el valor del contrato con el valor estimado del
  proceso (en el roadmap).
- Integración N8N: apuntar el webhook a `GET /api/opportunities` en un schedule; el JSON ya
  trae las alertas por oportunidad.

---

## Stack

Node 18+ · TypeScript · Express · fetch nativo · sin base de datos (caché y memoria en archivos).
Latido: systemd timer. Canal: Telegram Bot API (sin librería: es un POST JSON).
Conversación: n8n (AI Agent con las mismas 3 herramientas de esta API).
