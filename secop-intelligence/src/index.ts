import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from './config.js';
import { api } from './api/routes.js';
import { croma } from './croma/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use('/api', api);
app.use(express.static(resolve(__dirname, '..', 'public')));

app.listen(config.port, () => {
  console.log(`\n🚗  SECOP Intelligence (Foton × Croma) escuchando en http://localhost:${config.port}`);
  console.log(`    Dashboard:  http://localhost:${config.port}/`);
  console.log(`    API health: http://localhost:${config.port}/api/health`);
  if (!croma.hasKey) {
    console.warn('\n⚠️  CROMA_API_KEY no configurada — copia .env.example a .env y añade tu key.');
  }
});
