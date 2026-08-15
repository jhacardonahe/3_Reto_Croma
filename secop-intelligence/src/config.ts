import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { FotonLine } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, '..', 'data');

export interface EntityConfig {
  nit: string;
  name: string;
  type: string;
  priority: 'high' | 'medium' | 'low';
}

export interface CompetitorConfig {
  nit: string;
  name: string;
  market_share: string;
}

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(dataDir, file), 'utf8')) as T;
}

export const config = {
  cromaApiKey: process.env.CROMA_API_KEY ?? '',
  cromaBaseUrl: process.env.CROMA_BASE_URL ?? 'https://api.croma.run',
  port: Number(process.env.PORT ?? 8096),
  maxCallsPerMin: Number(process.env.CROMA_MAX_CALLS_PER_MIN ?? 10),
  cacheTtlHours: Number(process.env.CACHE_TTL_HOURS ?? 6),
  cacheDir: resolve(dataDir, 'cache'),
};

export const entities: EntityConfig[] = loadJson<{ entities: EntityConfig[] }>('entities.json').entities;
export const competitors: CompetitorConfig[] = loadJson<{ competitors: CompetitorConfig[] }>('competitors.json').competitors;

// Pre-filtro a nivel de RESUMEN (barato, sin gastar detalle): los vehículos se compran
// como bienes ("Compraventa"/"Suministros"), nunca como "Prestación de servicios".
// Verificado con data real (UdeA: 320/500 eran servicios → se descartan).
export const GOODS_CONTRACT_TYPES: string[] = ['compraventa', 'suministro', 'suministros', 'otro'];

// Piso de precio para considerar un proceso como posible compra de vehículo (COP).
// Un vehículo institucional rara vez baja de ~30M; filtra papelería/insumos baratos.
export const MIN_VEHICLE_PRICE = 30_000_000;

// Pre-filtro de texto (se usa sobre la DESCRIPCIÓN del detalle, no sobre el resumen).
export const GENERAL_FILTER: string[] = [
  'camioneta', 'pick-up', 'pickup', 'vehículo', 'vehiculo', 'vehículos', 'vehiculos',
  'automotor', 'automóvil', 'automovil', 'camión', 'camion', 'transporte', 'suv',
  'furgón', 'furgon', 'van', 'microbus', 'volqueta',
];

// Palabras clave por línea (referencia/documentación; la clasificación fina vive en classification.ts).
export const FOTON_KEYWORDS: Record<Exclude<FotonLine, 'UNKNOWN'>, string[]> = {
  NEW_ENERGY_PICKUP: ['camioneta eléctrica', 'camioneta eléctrico'],
  PICKUP_MHEV: ['camioneta hibrida', 'camioneta híbrida', 'camioneta hybrid', 'camioneta mhev'],
  PICKUP: ['pick-up', 'pickup', 'camioneta diesel', 'camioneta 4x4', 'doble cabina', 'suv'],
  NEW_ENERGY: ['vehículo eléctrico', 'vehículo eléctrica', 'cero emisiones', 'sostenible'],
  LDT: ['camión', 'volqueta', 'caja seca', 'transporte de carga'],
  HDT: ['tractocamión', 'tractomula', 'cabezote', 'carga pesada'],
  AUV_VAN: ['furgón', 'van', 'microbus', 'transporte de pasajeros'],
  SPECIAL: ['ambulancia', 'blindado', 'especial', 'bomberos'],
};
