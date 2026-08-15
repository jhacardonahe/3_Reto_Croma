# Sistema de Inteligencia de Oportunidades SECOP - Foton Colombia
## Brief Técnico para Claude Code

**Fecha**: 15 de agosto de 2026  
**Entrega**: Mañana (16 de agosto)  
**Propósito**: MVP funcional de detección de oportunidades, análisis competitivo y seguimiento de procesos públicos SECOP

---

## 1. OBJETIVO DEL PROYECTO

Crear un sistema automatizado que permita:
- **Detectar oportunidades** de compra pública de vehículos en SECOP (municipios, gobernaciones, empresas públicas)
- **Clasificar automáticamente** procesos por línea de vehículos Foton (LDT, HDT, New Energy, Pick-up, AUV/VAN, Special)
- **Analizar competencia** (histórico de ganancia, precios, márgenes vs. competidores)
- **Generar alertas** para KAMs con scoring de oportunidad
- **Seguimiento post-adjudicación** de contratos ganados (ejecución, multas, adiciones)

**Resultado esperado**: Dashboard funcional + API que alimente alertas automáticas en N8N

---

## 2. CONECTORES DISPONIBLES (CROMA SECOP)

Tienes acceso nativo a 5 conectores:

```javascript
// 1. Listar procesos por entidad contratante
secop_processes_by_entity({
  document_number: "890980040",  // NIT municipio
  from_date: "2026-01-01",
  to_date: "2026-08-15",
  page: 1
})
// Retorna: lista de procesos publicados por esa entidad

// 2. Detalles completos de un proceso (adjudicaciones + contratos)
secop_process({
  notice_uid: "CO1.NTC.12345678"  // ID de la licititud
})
// Retorna: objeto proceso, proponentes, contratista ganador, contratos

// 3. Histórico de contratos ganados por un proveedor
secop_contracts_by_provider({
  document_number: "860001100",  // NIT del competidor (ej: Toyota)
  from_date: "2025-01-01",
  page: 1
})
// Retorna: todos los contratos ganados en ese período

// 4. Detalles de un contrato específico (ejecución, adiciones, multas)
secop_contract({
  contract_id: "CO1.PCCNTR.987654"
})
// Retorna: estado, adiciones, garantías, ejecución %

// 5. Sanciones contra un proveedor
secop_sanctions_by_provider({
  document_number: "860001100"
})
// Retorna: multas, sanciones, fechas, montos
```

---

## 3. ARQUITECTURA DEL SISTEMA

```
┌─ INPUTS ──────────────────────────────────────────┐
│ • NITs de entidades target (municipios, gobos)    │
│ • NITs de competidores (Toyota, Renault, etc)    │
│ • Palabras clave por línea Foton                 │
└─────────────────────────────────────────────────┘
           │
           ↓
┌─ CROMA SECOP APIs ────────────────────────────────┐
│ 1. Crawl diario: secop_processes_by_entity       │
│ 2. Detalle: secop_process                        │
│ 3. Competencia: secop_contracts_by_provider      │
│ 4. Seguimiento: secop_contract                   │
│ 5. Screening: secop_sanctions_by_provider        │
└─────────────────────────────────────────────────┘
           │
           ↓
┌─ PROCESSING ──────────────────────────────────────┐
│ • Clasificación: palabras clave → línea Foton    │
│ • Scoring: valor, urgencia, histórico entidad   │
│ • Análisis competitivo: precio promedio, margen │
│ • Flag: adiciones, multas, retrasos en ejecución│
└─────────────────────────────────────────────────┘
           │
           ↓
┌─ OUTPUTS ─────────────────────────────────────────┐
│ JSON API para:                                    │
│ • Dashboard React (visualización)                │
│ • N8N Webhooks (alertas automáticas)             │
│ • CSV export (análisis offline)                  │
└─────────────────────────────────────────────────┘
```

---

## 4. FUNCIONALIDADES A IMPLEMENTAR (MVP)

### 4.1 MODULE: Entity Monitoring
**Descripción**: Monitorear nuevos procesos publicados por entidades clave

```typescript
interface MonitoringRequest {
  entity_nits: string[];  // [890980040, 800158527, ...]
  from_date: string;      // YYYY-MM-DD
  keywords: string[];     // ["camioneta", "pick-up", "vehículos"]
}

interface OpportunityResult {
  notice_uid: string;
  entity_name: string;
  object: string;
  estimated_value: number;
  publication_date: string;
  closing_date: string;
  foton_line: string;     // LDT | HDT | NEW_ENERGY | PICKUP | AUV_VAN | SPECIAL | UNKNOWN
  confidence: number;     // 0-100 (cuán seguro estoy de la clasificación)
  scoring: {
    value_score: number;  // qué tan alto es el valor
    urgency_score: number; // días para cierre
    entity_score: number;  // historial de compra
  }
  total_score: number;    // 0-100 (oportunidad general)
}
```

**Algoritmo de clasificación** (evaluación en orden - first match wins):
```javascript
function classifyFotonLine(processObject: string): { line: string; confidence: number } {
  const text = processObject.toLowerCase();
  
  // 1. NEW_ENERGY PICKUP: camioneta + (eléctrica O eléctrico)
  if (text.includes("camioneta") && (text.includes("eléctrica") || text.includes("eléctrico"))) {
    return { line: "NEW_ENERGY_PICKUP", confidence: 0.95 };
  }
  
  // 2. PICKUP MHEV: camioneta + (hibrida O hybrid O MHEV)
  if (text.includes("camioneta") && (text.includes("hibrida") || text.includes("hybrid") || text.includes("mhev"))) {
    return { line: "PICKUP_MHEV", confidence: 0.93 };
  }
  
  // 3. PICKUP: camioneta + diesel (sin eléctrica/hibrida)
  if (text.includes("camioneta") && text.includes("diesel") && 
      !text.includes("eléctrica") && !text.includes("eléctrico")) {
    return { line: "PICKUP", confidence: 0.90 };
  }
  
  // 4. LDT: camión (sin "camioneta")
  if (text.includes("camión") && !text.includes("camioneta")) {
    return { line: "LDT", confidence: 0.88 };
  }
  
  // 5. NEW_ENERGY: vehículo + (eléctrico O eléctrica)
  if (text.includes("vehículo") && (text.includes("eléctrico") || text.includes("eléctrica"))) {
    return { line: "NEW_ENERGY", confidence: 0.85 };
  }
  
  // 6. PICKUP: SUV
  if (text.includes("suv")) {
    return { line: "PICKUP", confidence: 0.80 };
  }
  
  // 7. AUV_VAN: furgón, van, microbus
  if (text.includes("furgón") || text.includes("van") || text.includes("microbus")) {
    return { line: "AUV_VAN", confidence: 0.85 };
  }
  
  // 8. GENERIC KEYWORDS
  if (text.includes("pick-up") || text.includes("pickup")) {
    return { line: "PICKUP", confidence: 0.75 };
  }
  
  // No match
  return { line: "UNKNOWN", confidence: 0.0 };
}
```

---

### 4.2 MODULE: Competitive Intelligence
**Descripción**: Analizar histórico de competencia (precios, ganancia, márgenes)

```typescript
interface CompetitorAnalysis {
  competitor_nit: string;
  competitor_name: string;
  period: {
    from_date: string;
    to_date: string;
  };
  statistics: {
    total_contracts: number;
    total_value: number;
    average_contract_value: number;
    win_rate: number;           // % de procesos donde participó vs ganó
    average_unit_price: number; // si es divisible
    price_gap: number;          // % por debajo del valor estimado
  };
  by_line: {
    [key: string]: {             // LDT, HDT, etc
      contracts_won: number;
      average_price: number;
      margin: number;
    }
  };
  trend: "increasing" | "stable" | "decreasing";
}

// Ejemplo de salida:
{
  competitor_nit: "860001100",
  competitor_name: "Toyota",
  period: { from_date: "2025-01-01", to_date: "2026-08-15" },
  statistics: {
    total_contracts: 24,
    total_value: 2200000000,
    average_contract_value: 91666667,
    win_rate: 0.85,
    price_gap: -0.12,  // gana 12% por debajo
  },
  by_line: {
    PICKUP: {
      contracts_won: 8,
      average_price: 88000000,
      margin: -0.10
    }
  },
  trend: "stable"
}
```

---

### 4.3 MODULE: Post-Award Tracking
**Descripción**: Seguimiento de contratos ganados (ejecución, riesgos)

```typescript
interface ContractTracking {
  contract_id: string;
  entity: string;
  value: number;
  foton_line: string;
  status: {
    execution_percentage: number;  // 0-100
    planned_end_date: string;
    actual_end_date?: string;
    is_delayed: boolean;
  };
  alerts: {
    has_sanctions: boolean;
    sanctions: Sanction[];
    modifications: Modification[];
    has_delays: boolean;
    has_insurance: boolean;
  };
  health_score: number;  // 0-100 (qué tan bien va la ejecución)
}

interface Modification {
  type: "addition" | "deduction" | "time_extension";
  value: number;
  date: string;
  percentage_of_contract: number;
}

interface Sanction {
  entity: string;
  resolution: string;
  value: number;
  date_published: string;
  date_final: string;
  reason: string;
}
```

---

### 4.4 MODULE: Alerts & Scoring
**Descripción**: Sistema de alertas y scoring de oportunidades

```typescript
interface AlertRule {
  id: string;
  name: string;
  condition: {
    min_value?: number;
    max_days_to_close?: number;
    foton_lines?: string[];
    entity_nits?: string[];
  };
  severity: "high" | "medium" | "low";
}

interface Alert {
  rule_id: string;
  opportunity_id: string;
  severity: string;
  message: string;
  recommendation: string;
  recipient: string;  // KAM email
  timestamp: string;
}

// Reglas por defecto:
const DEFAULT_ALERT_RULES = [
  {
    id: "high_value",
    name: "Oportunidad alto valor",
    condition: { min_value: 200000000 },
    severity: "high"
  },
  {
    id: "urgent_close",
    name: "Cierre urgente (< 14 días)",
    condition: { max_days_to_close: 14 },
    severity: "high"
  },
  {
    id: "repeated_buyer",
    name: "Entidad con historial de compra",
    condition: {},
    severity: "medium"
  },
  {
    id: "new_energy_segment",
    name: "Segmento NEW ENERGY (oportunidad estratégica)",
    condition: { foton_lines: ["NEW_ENERGY", "NEW_ENERGY_PICKUP"] },
    severity: "high"
  },
  {
    id: "pickup_mhev",
    name: "Línea PICKUP MHEV (híbrida)",
    condition: { foton_lines: ["PICKUP_MHEV"] },
    severity: "medium"
  }
];
```

---

## 5. ENDPOINTS API REQUERIDOS

### 5.1 Monitoring
```
GET /api/opportunities
  Params:
    entity_nits: string[] (opcional)
    from_date: string (default: hoy-7d)
    sort_by: "score" | "value" | "closing_date" (default: score)
    limit: number (default: 20)
  
  Response:
    opportunities: OpportunityResult[]
    total_count: number
    timestamp: string
```

### 5.2 Competitive Intelligence
```
POST /api/competitor-analysis
  Body:
    competitor_nit: string
    period: { from_date, to_date }
    group_by_line: boolean (default: true)
  
  Response:
    CompetitorAnalysis
```

### 5.3 Contract Tracking
```
GET /api/contracts/:contract_id/tracking
  Response:
    ContractTracking
```

### 5.4 Alerts
```
POST /api/alerts/test
  Body:
    opportunity_id: string
  
  Response:
    alerts: Alert[]
```

---

## 6. STACK TÉCNICO

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: En-memory (JSON) o SQLite para MVP
- **API Client**: Croma (suministrado vía herramientas)
- **Logging**: console.log (simple)
- **Export**: CSV, JSON

---

## 7. ESTRUCTURA DE ARCHIVOS

```
secop-intelligence/
├── src/
│   ├── index.ts              # Entry point
│   ├── config.ts             # Configuración (NITs, keywords, etc)
│   ├── types.ts              # Tipos TypeScript
│   ├── modules/
│   │   ├── monitoring.ts     # Detección de oportunidades
│   │   ├── competitive.ts    # Análisis competencia
│   │   ├── tracking.ts       # Seguimiento contratos
│   │   ├── classification.ts # Clasificación línea Foton
│   │   └── alerting.ts       # Sistema de alertas
│   ├── api/
│   │   ├── routes.ts         # Rutas Express
│   │   └── handlers.ts       # Manejadores
│   ├── croma/
│   │   └── client.ts         # Wrapper de APIs Croma
│   └── utils/
│       ├── scoring.ts        # Lógica de scoring
│       ├── csv-export.ts     # Export CSV
│       └── date.ts           # Helpers de fecha
├── data/
│   ├── entities.json         # NITs de entidades target
│   ├── competitors.json      # NITs de competidores
│   └── cache/
│       └── opportunities.json # Cache local
├── package.json
└── README.md
```

---

## 8. DATOS INICIALES (CONFIGURATION)

### 8.1 Entidades Target (ejemplos)
```json
{
  "entities": [
    {
      "nit": "890980040",
      "name": "Municipio de Medellín",
      "type": "municipality",
      "priority": "high"
    },
    {
      "nit": "800158527",
      "name": "Gobernación de Antioquia",
      "type": "department",
      "priority": "high"
    },
    {
      "nit": "800254670",
      "name": "EPM (Empresa de Medellín)",
      "type": "public_company",
      "priority": "medium"
    }
  ]
}
```

### 8.2 Competidores
```json
{
  "competitors": [
    {
      "nit": "860001100",
      "name": "Toyota",
      "market_share": "high"
    },
    {
      "nit": "900406621",
      "name": "Renault Colombia",
      "market_share": "high"
    },
    {
      "nit": "830002190",
      "name": "Chevrolet Colombia",
      "market_share": "medium"
    }
  ]
}
```

### 8.3 Palabras Clave por Línea Foton
```json
{
  "PICKUP": ["pick-up", "pickup", "camioneta diesel", "camioneta 4x4", "doble cabina", "suv"],
  "PICKUP_MHEV": ["camioneta hibrida", "camioneta hybrid", "camioneta MHEV"],
  "NEW_ENERGY_PICKUP": ["camioneta eléctrica", "camioneta eléctrico"],
  "NEW_ENERGY": ["vehículo eléctrico", "vehículo eléctrica", "sostenible", "cero emisiones"],
  "LDT": ["camión", "volqueta", "caja seca", "transporte carga"],
  "AUV_VAN": ["furgón", "van", "microbus", "transporte pasajeros"],
  "GENERAL_FILTER": ["camioneta", "pick-up", "vehículos", "transporte", "carga", "suv"]
}
```

**NOTA**: La columna `GENERAL_FILTER` se usa para el primer paso (retener procesos relevantes). La clasificación específica por línea se hace en el `classifyFotonLine()` según el algoritmo de orden jerárquico.

---

## 9. LOGICA DE SCORING (OPORTUNIDAD)

```javascript
function calculateOpportunityScore(opportunity: any, entityHistory: any): number {
  let score = 0;
  
  // 1. Value Score (30 puntos)
  const valueScore = Math.min((opportunity.estimated_value / 500000000) * 30, 30);
  
  // 2. Urgency Score (20 puntos)
  const daysToClose = daysBetween(now(), opportunity.closing_date);
  const urgencyScore = daysToClose < 14 ? 20 : daysToClose < 30 ? 15 : 10;
  
  // 3. Entity Score (25 puntos) - basado en histórico
  const entityScore = entityHistory.purchase_frequency > 2 ? 25 : 
                      entityHistory.purchase_frequency > 1 ? 15 : 5;
  
  // 4. Confidence Score (15 puntos) - clasificación Foton
  const confidenceScore = opportunity.classification.confidence * 15;
  
  score = valueScore + urgencyScore + entityScore + confidenceScore;
  
  return Math.min(score, 100);
}
```

---

## 10. EJEMPLO DE FLUJO END-TO-END

```
INPUT: Ejecutar monitoreo diario (N8N schedule)

1. Para cada entidad clave en target (municipios, gobernaciones, empresas públicas):
   GET secop_processes_by_entity(NIT, from_date=hoy-7días)
  
2. Para cada proceso retornado:
   a. Extraer objeto (descripción)
   b. Filtrar por palabras clave:
      ["camioneta", "pick-up", "vehículos", "transporte", "carga", "SUV"]
   c. Clasificar por línea Foton usando classifyFotonLine():
      → Si "camioneta eléctrica" → NEW_ENERGY_PICKUP
      → Si "camioneta hibrida" → PICKUP_MHEV
      → Si "camioneta diesel" (sin eléctrica/hibrida) → PICKUP
      → Si "camión" (sin "camioneta") → LDT
      → Si "vehículo eléctrico" → NEW_ENERGY
      → Si "suv" → PICKUP
      → Si "furgón" O "van" O "microbus" → AUV_VAN
      → Si no matchea → UNKNOWN (confidence 0, no incluir en TOP 50)
   d. Calcular scoring: value_score + urgency_score + entity_score + confidence_score
   e. Filtrar si: foton_line != "UNKNOWN" Y score >= 40
  
3. Almacenar en cache/opportunities.json
  
4. Retornar TOP 50 oportunidades ordenadas por:
   - total_score (descendente) [principal]
   - estimated_value (descendente) [secundaria]
   - days_to_close (ascendente) [terciaria]
  
5. Para cada oportunidad en TOP 50:
   Generar alertas usando AlertRules
   → Evaluar cada regla (high_value, urgent_close, repeated_buyer, etc)
   → Retornar: [Alert[], Alert[], ...]
  
6. Alert a KAMs vía email/Slack + link directo SECOP:
   - Entidad contratante
   - Objeto del proceso
   - Valor estimado
   - Línea Foton sugerida (confidence %)
   - Total scoring (0-100)
   - Días para cierre
   - Alertas aplicables
   - Link: https://www.secop.gov.co/... [notice_uid]

OUTPUT: 
{
  "timestamp": "2026-08-16T10:30:00Z",
  "total_processed": 245,
  "total_filtered": 87,
  "top_50_count": 50,
  "opportunities": [
    {
      "notice_uid": "CO1.NTC.12345678",
      "entity_name": "Municipio de Medellín",
      "entity_nit": "890980040",
      "object": "5 camionetas pick-up diesel 4x4",
      "estimated_value": 500000000,
      "publication_date": "2026-08-15",
      "closing_date": "2026-09-30",
      "days_to_close": 45,
      "foton_line": "PICKUP",
      "line_confidence": 0.90,
      "scoring": {
        "value_score": 30,
        "urgency_score": 15,
        "entity_score": 20,
        "confidence_score": 13.5,
        "total": 78.5
      },
      "alerts": ["high_value", "urgent_close", "repeated_buyer"],
      "secop_link": "https://www.secop.gov.co/web/guest/inicio"
    },
    {
      "notice_uid": "CO1.NTC.87654321",
      "entity_name": "Gobernación de Antioquia",
      "entity_nit": "800158527",
      "object": "3 camionetas eléctricas para transporte ejecutivo",
      "estimated_value": 450000000,
      "publication_date": "2026-08-14",
      "closing_date": "2026-09-10",
      "days_to_close": 25,
      "foton_line": "NEW_ENERGY_PICKUP",
      "line_confidence": 0.95,
      "scoring": {
        "value_score": 28,
        "urgency_score": 18,
        "entity_score": 18,
        "confidence_score": 14.25,
        "total": 78.25
      },
      "alerts": ["high_value", "new_energy_segment"],
      "secop_link": "https://www.secop.gov.co/web/guest/inicio"
    },
    ...
  ]
}
```

---

## 11. CRITERIOS DE ACEPTACION (ENTREGA)

✅ **MUST HAVE**:
1. Endpoint `GET /api/opportunities` funcional con scoring
2. Clasificación automática a línea Foton con confianza
3. Endpoint `POST /api/competitor-analysis` con histórico
4. Endpoint `GET /api/contracts/:id/tracking` con alerts
5. Archivo `opportunities.json` actualizado con resultados
6. Documentación README con ejemplos de uso

✅ **NICE TO HAVE**:
- CSV export de oportunidades
- Dashboard HTML simple (tabla interactiva)
- Cron job que corre monitoreo cada 6 horas
- Más de 50 entidades precargadas en config

---

## 12. NOTAS IMPORTANTES

- **Croma API timeout**: Los servidores de Croma pueden ser lentos. Implementar reintentos con backoff exponencial.
- **Rate limiting**: No llamar la misma API > 10 veces por minuto.
- **Caché**: Almacenar procesos en `cache/` para no re-queryar innecesariamente.
- **Dates**: Usar ISO 8601 (YYYY-MM-DD) en todas partes.
- **Errores**: Si Croma retorna `found: false`, loguear pero no fallar; retornar campo vacío.

---

## 13. REFERENCIAS CROMA SECOP

**Documentación**: Los 5 conectores están disponibles en tu catálogo.

**Test rápido para validar conexión**:
```javascript
// Verificar que Croma funciona llamando a una entidad conocida
await secop_processes_by_entity({
  document_number: "890980040", // Medellín
  from_date: "2026-08-01"
});
// Debería retornar procesossiblings sin error
```

---

## 14. FECHA DE ENTREGA Y CONTACTO

**Entrega**: Mañana (16 de agosto, 2026)  
**Formato**: 
- Código fuente en `/mnt/user-data/outputs/`
- `package.json` + `README.md`
- Al menos 1 archivo de demo/test (`test-run.json` con salida real)

**Dudas**: Preguntar antes de salir del contexto de Claude Code.

---

## 15. BONUS: Pautas de Prompting para Claude Code

Cuando invoques Claude Code, pide:

```
"Implementa el Sistema de Inteligencia SECOP siguiendo este brief.

Prioridad en orden:
1. Módulos de monitoring + classification (CORE)
2. Competitive intelligence (ANALYSIS)
3. APIs Express (EXPOSURE)
4. Post-award tracking (NICE TO HAVE)

Usa TypeScript, structure types.ts primero.
Para Croma APIs, asumir que están disponibles globalmente (ya estan inyectadas).

Test cada módulo con datos reales de ejemplos.
Retorna URL descargable del `.zip` al final."
```

---

**¡Éxito en la entrega! 🚀**
