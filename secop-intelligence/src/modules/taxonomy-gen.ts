import { config } from '../config.js';
import type { Taxonomy, TaxonomyRule } from '../types.js';

/**
 * Genera una TAXONOMÍA de categorías a partir de una descripción del negocio, usando Claude
 * (Anthropic Messages API, una sola llamada, offline del camino crítico). La clasificación por
 * proceso sigue siendo determinista y citable — la IA solo produce las REGLAS.
 *
 * Salida JSON estricta vía output_config.format (json_schema) — el modelo no puede devolver
 * texto libre. Endpoint POST /v1/messages, anthropic-version 2023-06-01, modelo claude-opus-4-8.
 */

// Esquema de salida estricto (structured outputs). additionalProperties:false en cada objeto.
const RULE_SCHEMA = {
  type: 'object',
  properties: {
    line: { type: 'string' },
    confidence: { type: 'number' },
    include: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    exclude: { type: 'array', items: { type: 'string' } },
    matched_on: { type: 'string' },
  },
  required: ['line', 'confidence', 'include', 'matched_on'],
  additionalProperties: false,
} as const;

const TAXONOMY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    prefilter: { type: 'array', items: { type: 'string' } },
    rules: { type: 'array', items: RULE_SCHEMA },
  },
  required: ['name', 'description', 'prefilter', 'rules'],
  additionalProperties: false,
} as const;

const SYSTEM = `Eres un experto en compra pública (SECOP, Colombia) y en clasificación de bienes.
A partir de la descripción del negocio de una empresa, defines una TAXONOMÍA de categorías de
producto para detectar oportunidades de licitación relevantes y descartar el ruido.

Reglas de salida (obligatorias):
- Devuelve categorías (líneas) con CÓDIGO en MAYÚSCULAS_CON_GUION_BAJO (p.ej. PICKUP, BUS_ELECTRICO).
- Cada regla: "include" = grupos en AND-de-ORs (la regla matchea si CADA grupo tiene ≥1 término
  presente en el texto del proceso). "exclude" = términos que, si aparecen, descartan la regla.
- Ordena las reglas de la MÁS específica a la MÁS general (first-match-wins): las variantes
  premium (eléctrico/híbrido/blindado) ANTES de la genérica.
- Palabras clave en MINÚSCULAS y SIN TILDES (el sistema normaliza así). Incluye sinónimos y las
  formas que usa SECOP (p.ej. "camioneta", "pick-up", "camion", "furgon", "bus", "buseta").
- "confidence" entre 0 y 1 (más específico ⇒ más alto; genérico ⇒ ~0.7).
- "prefilter": lista amplia de términos-gancho baratos (sin tildes) que huelen a los productos
  del negocio; se usa para descartar procesos irrelevantes sin gastar llamadas caras.
- NO inventes categorías que el negocio no vende. Si describe servicios (no bienes), refleja eso.
- Todo el texto de cara al usuario en español; los códigos de línea en inglés/mayúsculas.`;

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  error?: { message?: string };
}

export async function generateTaxonomy(description: string): Promise<Taxonomy> {
  const desc = (description ?? '').trim();
  if (!desc) throw new TaxonomyGenError('La descripción del negocio está vacía.', 400);
  if (!config.anthropicApiKey.trim()) {
    throw new TaxonomyGenError(
      'Falta ANTHROPIC_API_KEY en el servidor. Añádela al .env para generar taxonomías con IA.',
      401,
    );
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.claudeModel,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Descripción del negocio:\n"""\n${desc}\n"""\n\nGenera la taxonomía de categorías para detectar oportunidades de este negocio en SECOP.`,
        },
      ],
      output_config: { format: { type: 'json_schema', schema: TAXONOMY_SCHEMA } },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `Anthropic ${res.status}`;
    try {
      msg = (JSON.parse(text) as AnthropicResponse).error?.message ?? msg;
    } catch {
      /* deja el genérico */
    }
    throw new TaxonomyGenError(msg, res.status);
  }

  const data = (await res.json()) as AnthropicResponse;
  if (data.stop_reason === 'refusal') {
    throw new TaxonomyGenError('El modelo rechazó la solicitud. Reformula la descripción.', 422);
  }
  const jsonText = data.content?.find((b) => b.type === 'text')?.text;
  if (!jsonText) throw new TaxonomyGenError('Respuesta vacía del modelo.', 502);

  let parsed: Taxonomy;
  try {
    parsed = JSON.parse(jsonText) as Taxonomy;
  } catch {
    throw new TaxonomyGenError('El modelo no devolvió JSON válido.', 502);
  }
  return sanitize(parsed);
}

/** Valida y normaliza la taxonomía recibida (defensivo: la IA es la fuente, no confiamos a ciegas). */
function sanitize(t: Taxonomy): Taxonomy {
  if (!t || !Array.isArray(t.rules) || t.rules.length === 0) {
    throw new TaxonomyGenError('La taxonomía generada no tiene reglas.', 502);
  }
  const rules: TaxonomyRule[] = t.rules
    .filter((r) => r && typeof r.line === 'string' && Array.isArray(r.include) && r.include.length > 0)
    .map((r) => ({
      line: String(r.line).trim().toUpperCase().replace(/\s+/g, '_'),
      confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.7)),
      include: r.include
        .map((g) => (Array.isArray(g) ? g.map((k) => String(k).toLowerCase().trim()).filter(Boolean) : []))
        .filter((g) => g.length > 0),
      exclude: Array.isArray(r.exclude) ? r.exclude.map((k) => String(k).toLowerCase().trim()).filter(Boolean) : [],
      matched_on: typeof r.matched_on === 'string' ? r.matched_on : undefined,
    }))
    .filter((r) => r.include.length > 0);
  if (rules.length === 0) throw new TaxonomyGenError('Ninguna regla generada es válida.', 502);

  const prefilter = Array.isArray(t.prefilter)
    ? [...new Set(t.prefilter.map((k) => String(k).toLowerCase().trim()).filter(Boolean))]
    : [];
  if (prefilter.length === 0) {
    // fallback: usa los primeros términos de cada regla como prefiltro
    for (const r of rules) for (const g of r.include) prefilter.push(...g);
  }

  return {
    name: (typeof t.name === 'string' && t.name.trim()) || 'Taxonomía generada por IA',
    description: typeof t.description === 'string' ? t.description : undefined,
    prefilter: [...new Set(prefilter)],
    rules,
    generated_by: 'ai',
    generated_at: new Date().toISOString(),
  };
}

export class TaxonomyGenError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'TaxonomyGenError';
  }
}
