import { Router } from 'express';
import { getHealth, getOpportunities, postCompetitorAnalysis, getContractTracking } from './handlers.js';

export const api = Router();

api.get('/health', getHealth);
api.get('/opportunities', getOpportunities);
api.post('/competitor-analysis', postCompetitorAnalysis);
api.get('/contracts/:contract_id/tracking', getContractTracking);
