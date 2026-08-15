# RETO — IA-Hackathon GOV-TECH de Croma

> **Documento guía del proyecto.** Cada paso que se ejecute en este repositorio debe
> apuntar a ganar este reto. Antes de escribir código o tomar una decisión, valida contra
> la sección **"Regla de oro"** y los **criterios de evaluación** de abajo.

Fuente: `Guia-IA-Hackathon GOV-TECH de Croma _ Croma.pdf` (usecroma.com/es/changelog/hackathon-govtech)

---

## 0. Datos del reto (no negociables)

| Dato | Valor |
|---|---|
| Evento | IA-Hackathon GOV-TECH de Croma |
| Ventana | 12 – 16 de agosto de 2026, 6:30 p. m. |
| **Cierre de entrega** | **16 de agosto de 2026, 6:30 p. m.** (mañana desde hoy 15-ago) |
| Equipo | 1 a 5 personas |
| Stack | Libre. **Única condición obligatoria: la solución DEBE usar Croma** (por API o por MCP) |
| Premio | 1 solo ganador: **USD 300** + **6 meses de Croma gratis** |
| Entrega | Formulario de entrega de Croma |

### ⚠️ Regla de oro
Si un paso **no** hace que Croma sea más central en la solución, o no acerca la entrega
al cierre de mañana, **no se ejecuta**. Croma no es una integración más: es el corazón.

---

## 1. Criterios de evaluación → cómo los atacamos

| Criterio | La pregunta que responde | Cómo lo maximizamos en cada paso |
|---|---|---|
| **Originalidad** | ¿Es una idea que nadie más trajo? | Evitar los 4 ejemplos "de arranque" tal cual; darles un giro o cruzar fuentes que nadie cruza. |
| **Uso de Croma** | ¿Qué tan central es la plataforma? | Que Croma sea el motor de datos, no un adorno. Documentar cada herramienta MCP/endpoint usado. |
| **Impacto y production readiness** | ¿Resuelve un problema real y qué tan cerca está de usarse? | Un usuario objetivo claro, un flujo end-to-end funcional y desplegado. Demo real > mockup. |

> "Buscamos soluciones de impacto: proyectos que conviertan datos públicos en algo que la
> gente realmente pueda usar."

---

## 2. Entregables (checklist de cierre)

- [ ] **[OBLIGATORIO] Integrantes del equipo** — cada persona con: correo registrado en Luma + WhatsApp de contacto.
- [ ] **[OBLIGATORIO] Video de 1 minuto** — vende el problema y la solución (puede incluir demo).
- [ ] **[RECOMENDADO] Link al producto desplegado** — que lo puedan probar.
- [ ] **[OPCIONAL] Presentación** — refuerza el pitch.
- [ ] **[OPCIONAL] Repositorio de código** — **debe ser público**.
- [ ] **Envío en el formulario de entrega** antes del 16-ago 6:30 p. m.

---

## 3. Ideas de arranque de Croma (referencia, no copiar tal cual)

1. Agente de **due diligence** que cruza RUES + Supersociedades + antecedentes judiciales.
2. **Tracker de contratos** de SECOP.
3. **Verificación y análisis con IA** consultando Registraduría + RUNT + Policía Nacional.
4. Agente que **avisa proactivamente** de nuevas leyes/circulares en México (DOF, Banxico).

> Estas son las que "traerá todo el mundo". La originalidad se premia → usarlas como base,
> no como destino.

---

## 4. Fuentes Croma disponibles vía MCP (inventario de munición)

Confirmadas activas en este entorno (servidor MCP *"Croma | The API for government data"*):

- **🇨🇴 Colombia** — RUES (empresas), SECOP (contratos/procesos/sanciones), Supersociedades
  (estados financieros), Rama Judicial, Consejo de Estado, SAMAI, RUNT (vehículos por placa),
  Registraduría (estado vital), Policía (antecedentes), Procuraduría (disciplinarios),
  Contraloría (fiscales), Contaduría (deudores), DIAN (doctrina + docs electrónicos),
  SECOP sanciones, Superfinanciera (quejas), SICAAC (insolvencia), SIMIT (comparendos).
- **🇵🇪 Perú** — SUNAT (RUC/nombre/documento), SBS/APESEG (SOAT), SUTRAN/Callao/SAT Lima
  (infracciones/papeletas), RREE (carnés de extranjería).
- **🇲🇽 México** — DOF (publicaciones), Banxico (circulares), CNBV, Diputados (leyes federales),
  SCJN (tesis), CNDJ, fiscalías estatales (boletines).
- **Utilidad** — `research`, `web_search`, `extract_json`, `extract_markdown`, `generate_json`.

> **Paso 1 técnico:** validar en vivo 2-3 de estas herramientas con una consulta real antes
> de comprometer la idea (evita construir sobre una fuente que devuelve `found: false`).

---

## 5. Plan de ejecución (secuencia orientada al cierre)

Cada fase tiene un *gate*: no se avanza sin cumplir el criterio de salida.

### Fase A — Definir la idea ganadora (hoy, primero)
- [ ] Elegir **1 problema real** con usuario concreto (¿quién paga/sufre por no tener esto?).
- [ ] Mapear qué fuentes Croma lo resuelven y **por qué el cruce es original**.
- [ ] *Gate:* frase de una línea "Para [usuario], esto hace [valor] usando Croma [fuentes]".

### Fase B — Validar datos (antes de codear)
- [ ] Probar las herramientas MCP con datos reales; guardar respuestas de ejemplo.
- [ ] *Gate:* tener respuestas reales que demuestren que el flujo es posible.

### Fase C — Construir el MVP end-to-end
- [ ] Flujo mínimo funcional: entrada → consulta Croma → procesamiento IA → salida útil.
- [ ] *Gate:* un caso completo funciona de punta a punta.

### Fase D — Desplegar
- [ ] Publicar el producto (link probable) + repo público.
- [ ] *Gate:* un tercero puede abrir el link y usarlo.

### Fase E — Empaquetar la entrega
- [ ] Grabar video de 1 min (problema → solución → demo).
- [ ] Reunir integrantes (correos Luma + WhatsApp), presentación opcional.
- [ ] *Gate:* formulario enviado antes del cierre.

---

## 6. Registro de decisiones

> Anota aquí cada decisión importante y su justificación contra la Regla de oro.

| Fecha | Decisión | Por qué acerca la victoria |
|---|---|---|
| 2026-08-15 | Creado documento guía a partir del PDF oficial | Fija el norte; evita esfuerzo que no suma a los 3 criterios |
| | | |

---

## 7. Estado actual

- **Idea:** _por definir (Fase A)_
- **Fuentes Croma comprometidas:** _por definir_
- **Deploy:** _pendiente_
- **Entrega:** _pendiente — cierre 16-ago 6:30 p. m._
