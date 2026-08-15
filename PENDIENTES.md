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

---

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

## 🚀 Deploy (pendiente) — notas
- Servidor Express + estático; Node 18. Setear `CROMA_API_KEY` y `PORT` como env vars en la plataforma.
- Opciones rápidas: Render (free web service), Railway, Fly.io.
- Comando de arranque: `npm run build && npm start` (o `npx tsx src/index.ts`).

---

## ⚠️ Recordatorios
- `.env` (con la API key) es **local y gitignored** — no se sube. Al reabrir, sigue ahí.
- No commitear datos comerciales sensibles ni `CLAUDE.md` al repo público.
- Ruta crítica sugerida: **NIT real → corrida con matches → deploy → video → enviar formulario.**
