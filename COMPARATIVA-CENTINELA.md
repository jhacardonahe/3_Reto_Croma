# Comparativa: `centinela` (S-kkipie) vs `3_Reto_Croma` (SECOP Intelligence)

> Análisis hecho el 2026-08-18 sobre `S-kkipie/centinela@main` (clon superficial) y el HEAD
> de este repo. Objetivo: entender cómo funciona Centinela y decidir **qué vale la pena
> aplicar aquí**, medido contra los 3 criterios del reto (`RETO.md` §1):
> originalidad · **uso de Croma (ponderado)** · impacto / production-readiness.

---

## 1. Resumen en una línea

Centinela es **más agente y más Croma**; SECOP Intelligence es **más verificable y más
vertical**. Lo que hay que importar no es su stack (Cloudflare/Next/monorepo — no compensa
reescribir), sino **cuatro ideas de producto**: el agente que *inicia* (heartbeat + memoria
de lo ya visto), vigilar **contratistas** y no solo entidades, **encadenar más fuentes de
Croma** por hallazgo, y **entregables descargables** que el usuario se lleva.

---

## 2. Comparativa lado a lado

| Dimensión | `centinela` | `3_Reto_Croma` (este) |
|---|---|---|
| **Usuario objetivo** | Dos caras: PYME que quiere ganar + ciudadano/periodista que destapa | Uno: KAM de Foton Colombia (vertical vehículos) |
| **Modelo de operación** | **Agente vivo**: heartbeat cada 2h (Durable Object + alarm) → barre → encola → investiga | **On-demand**: el usuario abre el dashboard o corre el CLI; nada corre solo |
| **Memoria entre corridas** | `SeenMap` en SQLite del DO: `noticeUid → hash(status\|valor)`; re-investiga cuando cambia la fase (convocatoria→adjudicado) | Ninguna. Caché de HTTP con TTL, pero cada corrida re-clasifica todo y no sabe qué es "nuevo" |
| **Endpoints Croma** | **9**, 6 fuentes: SECOP (procesos, proceso, contratos-por-proveedor, sanciones), **RUES**, **Supersociedades**, **Rama Judicial**, **Procuraduría**, **Contraloría** | **5**, 1 fuente: SECOP (processes-by-entity, process, contracts-by-provider, contract, sanctions-by-provider) |
| **Razonamiento** | Gemini en 2 etapas con `responseSchema` (Flash-Lite triage → Pro scoring), evidencia citada por el modelo | **Determinista**: clasificador jerárquico first-match + score ponderado. Cero LLM en el pipeline (el LLM vive solo en el chat n8n) |
| **Garantía de veracidad** | Aristas del grafo derivadas del dossier, no del modelo (`mapping.ts`). El texto de `evidence` **lo escribe el LLM** — no se contrasta contra el payload crudo | **`utils/verify.ts`: guard de citas determinista.** Cada dato afirmado se compara contra el payload crudo de Croma (tolerancia 2%), con controles negativos en el eval. **Aquí vamos por delante** |
| **Persistencia** | Supabase Postgres (findings, watchlists, graph_edges) + auth multiusuario (Better Auth) | Archivos JSON + caché en disco. Un solo "usuario" implícito |
| **Frontend** | Next 16, landing pública, consola, grafo React Flow, **copiloto CopilotKit** que actúa sobre la UI | HTML/JS plano (585 líneas), tabla + filtros + CSV + **panel SSE de trazabilidad en vivo** + widget de chat n8n |
| **Entregables al usuario** | Genera y descarga: derecho de petición (Ley 1755), dossier citado, hilo para redes, propuesta | CSV de oportunidades |
| **Tests** | 42 archivos `__tests__` (vitest) sobre módulos puros | 0 tests unitarios; sí **eval harness** `npm run eval` (11 casos, gate de despliegue) |
| **CI** | No hay `.github/workflows` | No hay |
| **Despliegue** | Vercel (web) + Cloudflare Worker (agente), dominio propio | VPS propio: systemd + nginx + TLS + n8n, script `deploy-vps.sh` |
| **Cuota Croma** | Token-bucket genérico; presupuesto anual documentado (500/24h por endpoint) | **Failover pegajoso a key de respaldo en 429 + lectura de headers `X-RateLimit-*` + barra de cuota en la UI.** Más maduro operativamente |
| **LOC (ts/tsx)** | ~30.300 | ~2.200 |

---

## 3. Cómo funciona Centinela (el mecanismo, no el marketing)

```
cron "0 */2 * * *"  →  Durable Object CentinelaAgent.sweep()
   por cada target vigilado (entidad contratante o CONTRATISTA):
     · contratante → secop-processes-by-entity (ventana 3 días)
     · contratista → secop-contracts-by-provider → se mapean a "tenders"
   detectNewTenders(fetched, seenMap)      ← memoria: uid → hash(status|valor)
   cap MAX_ENQUEUE_PER_SWEEP (25) → Queue: 1 mensaje = 1 proceso
        │
        ▼  Workflow durable (cada paso reintenta solo)
   step "secop-detail"     → secop-process-by-notice (salta ids CO1.REQ.*)
   step "gemini-sweep"     → Flash-Lite: ¿vale la pena investigar? (si no, corta)
   step "croma-crossref"   → buildDossier: por cada proveedor del proceso
                              RUES (primero: da el NOMBRE oficial)
                                └→ Rama Judicial (busca por NOMBRE, no por NIT)
                              Supersociedades · sanciones SECOP · Procuraduría ·
                              Contraloría · contratos históricos   (en paralelo)
   step "gemini-scoring"   → Pro: OPORTUNIDAD | BANDERA_ROJA + score + evidencia
   step "persist-finding"  → POST /api/agent/findings (x-agent-key) al Next
```

Cuatro decisiones suyas que son buenas de verdad:

1. **La memoria es un hash de estado, no una lista de vistos** (`detect.ts`). Hashear
   `status|valor` hace que el proceso vuelva a entrar al pipeline cuando pasa a
   *adjudicado* — que es justo el momento en que hay información nueva.
2. **Triage barato antes del análisis caro.** Una llamada mínima decide si se gasta el
   cruce completo. Aquí el equivalente ya existe (el pre-filtro por texto), pero solo
   ahorra *detalle*, no ahorra clasificación.
3. **Vigilar contratistas invierte el problema de cobertura** (`contractor.ts`): una sola
   llamada `contracts-by-provider` devuelve lo que ese proveedor ganó **en todo el país**,
   incluidas entidades que nadie vigilaba. Es exactamente el "método ganador" que este
   repo descubrió a mano ("cosechar compradores de los contratos de AUTOMAYOR/EPIA") —
   ellos lo tienen automatizado como modo de barrido.
4. **Las aristas del grafo se derivan del dossier, no del LLM** (`mapping.ts`), para que
   `from`/`to` sean siempre NITs. Misma filosofía que nuestro guard de citas.

Y una debilidad suya que conviene tener presente: **el texto de la evidencia y el score los
produce Gemini** y nada los contrasta contra el payload crudo. Nuestro `verify.ts` es
estrictamente más fuerte en el eje "no afirmar sin cita".

---

## 4. Dónde este repo ya está por delante (no tocar)

- **Guard de citas determinista** (`src/utils/verify.ts`) + controles negativos en el eval.
  Es el activo diferencial: podemos decir "cero alucinaciones" y demostrarlo.
- **Panel SSE de trazabilidad**: el evaluador *ve* el pipeline naciendo de Croma en vivo.
  Centinela no tiene nada equivalente.
- **Gestión de cuota** (failover de key + headers `X-RateLimit-*` + barra en UI).
- **Verticalidad**: clasificar a línea Foton con confianza y estimar unidades/specs es
  valor concreto para un usuario que paga. Centinela es horizontal y por eso más genérico.
- **Despliegue propio** (VPS + systemd + nginx + n8n), sin dependencia de plataformas.

---

## 5. Qué aplicar aquí — priorizado

Orden = impacto sobre los criterios ÷ esfuerzo. P0 son horas, no días.

### P0-1 · Memoria de barrido + "novedades" (ataca: originalidad + impacto)
El pipeline hoy no distingue lo nuevo de lo ya visto. Portar `detect.ts`:

- `data/cache/seen.json`: `notice_uid → hash(estado|valor_estimado|fecha_cierre)`.
- En `runMonitoring`, marcar cada oportunidad como `new` | `changed` | `known`.
- En la UI: chip "NUEVO" y contador "N novedades desde tu última visita".

Coste: ~80 líneas y un archivo JSON. Es el prerequisito de todo lo demás.

### P0-2 · Heartbeat: que el sistema *inicie* (ataca: originalidad — su mayor ventaja)
No hace falta Cloudflare. Con la infra que ya está:

- `deploy/secop-intelligence.timer` (systemd timer, cada 6h) → `npm run monitor` con la
  ventana por defecto → escribe `data/cache/opportunities.json` + actualiza `seen.json`.
- O más barato aún: **workflow n8n con Schedule Trigger** (n8n ya está en producción)
  que llame `GET /api/opportunities` y empuje las oportunidades `new` a WhatsApp/correo
  del KAM. El "agente que avisa proactivamente" queda cerrado en una tarde.

Ojo con la cuota: 4 corridas/día × 6 entidades × (1 lista + ~10 detalles) cabe sobrado en
el bucket de 600/día, pero hay que fijar `maxDetail` por corrida y dejarlo escrito.

### P0-3 · Modo "vigilar contratista" (ataca: uso de Croma + impacto)
Portar la idea de `contractor.ts`: un target puede ser un **competidor** (AUTOMAYOR
`860034604`, EPIA `830096621`), no solo una entidad compradora.

- `contractsByProvider(nit)` → contratos ganados en todo el país.
- Entidades compradoras que **no** están en `entities.json` → sugerencia automática
  "¿añadir este comprador?" (esto **cierra el pendiente abierto** de "ampliar la lista de
  entidades compradoras", y lo cierra con el método que ya se validó a mano).
- Coste: 1 llamada por competidor y por corrida. Baratísimo en cuota.

### P1-1 · Encadenar más fuentes de Croma en el perfil de competidor (ataca: **uso de Croma**, el criterio ponderado)
Hoy se usan 5 endpoints de una sola fuente. El salto más rentable del reto es enriquecer
**solo el top-N** (no todo el barrido, por cuota) con:

| Endpoint | Qué aporta al KAM de Foton |
|---|---|
| `rues-entity-by-nit` | ¿El competidor existe, desde cuándo, quiénes lo representan? Empresa recién constituida ganando flotas = señal |
| `supersociedades-financial-statements` | ¿Su capital aguanta un contrato de $3.000M? Un competidor sin músculo financiero es una licitación ganable |
| `procuraduria-disciplinary-records` / `contraloria-fiscal-records` | Inhabilidades → **el competidor no puede presentarse** → oportunidad directa |
| `rama-judicial-cases-by-entity` | Litigios (ojo: se consulta por **NOMBRE**, hay que resolver NIT→nombre por RUES primero — es la dependencia que Centinela documenta en `investigate.ts`) |

Pasa de 5 a 9 endpoints y de 1 a 5 fuentes, **sin cambiar el producto**: sigue siendo
inteligencia comercial, solo que ahora responde "¿puedo desplazar a este competidor?".
Y todo lo nuevo debe pasar por `verify.ts` igual que lo demás.

### P1-2 · Concentración de adjudicaciones (HHI) + representantes compartidos
`analyzeConcentration` (su `concentration.ts`) sobre lo que ya tenemos: por entidad
compradora, cuánta cuota se lleva cada proveedor (HHI 0–1; >0,25 = concentrado) y qué
"competidores" comparten representante legal en RUES. Doble lectura, igual que ellos:
comercialmente es *"esta cuenta está capturada, entra con estrategia distinta"*; cívicamente
es una bandera roja. Es la señal que ningún humano saca de una lista de procesos.

### P1-3 · Entregables descargables (ataca: impacto — "valor sentido")
Portar la idea de `deliverables/documents.ts`: funciones **puras** que convierten una
oportunidad ya verificada en algo que sale de la app:

- **Ficha de licitación** (1 página, markdown/PDF) para el KAM: objeto, entidad, valor,
  cierre, línea Foton, specs detectadas, competencia esperada, y **las citas Croma**.
- **Checklist de requisitos habilitantes** a partir del texto del proceso.
- **Derecho de petición** (Ley 1755) para pedir pliegos/anexos — resuelve por vía legal el
  pendiente de "los PDF de SECOP II no son accesibles".

Al ser puras, se testean sin red y quedan reproducibles (ellos inyectan `generatedAt`).

### P2 (si sobra ventana)
- **Tests unitarios** (vitest) sobre `classification`, `scoring`, `verify`, `estimate`.
  Tenemos el eval, pero 0 tests; ellos tienen 42 archivos. Es credibilidad barata.
- **Grafo de red** entidad↔proveedor con los datos que ya se traen.
- **`design.md`** como fuente única de verdad visual antes de tocar el HTML otra vez.
- **CI** (typecheck + build + eval en GitHub Actions). Ninguno de los dos lo tiene.

---

## 6. Qué **NO** copiar

- **Migrar a Cloudflare (Durable Objects + Queues + Workflows).** Resuelve un problema que
  aquí no existe: nuestro barrido cabe en un timer de systemd sobre el VPS que ya corre.
- **Monorepo Turborepo + Next 16 + auth multiusuario.** Semanas de trabajo para un cambio
  que no mueve ninguno de los 3 criterios.
- **Sustituir el clasificador determinista por un LLM.** Perderíamos lo único que nadie
  más va a poder demostrar (el guard de citas). Si se mete LLM, que sea **encima** de datos
  ya verificados: redactar la narrativa de un hallazgo, no decidirlo.
- **Que el LLM emita la evidencia.** Ese es el punto débil de Centinela, no su fortaleza.

---

## 7. Nota sobre la ventana de entrega

`RETO.md` fija el cierre el **16-ago-2026 6:30 p. m.**; hoy es 18-ago. El `CONTEXT.md` de
Centinela menciona una *"ventana extendida ~10 días"*. Si esa extensión aplica, el orden
P0-1 → P0-2 → P0-3 → P1-1 es lo que más mueve la aguja por hora invertida. Si no aplica,
esta lista sigue siendo el roadmap correcto del producto, con P1-1 (más fuentes de Croma)
como la mejora de mayor valor real para el usuario Foton.
