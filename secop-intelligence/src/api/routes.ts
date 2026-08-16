import { Router } from 'express';
import { getHealth, getOpportunities, streamOpportunities, postCompetitorAnalysis, getMarket, getContractTracking } from './handlers.js';

export const api = Router();

api.get('/health', getHealth);
api.get('/opportunities', getOpportunities);
api.get('/opportunities/stream', streamOpportunities);
api.post('/competitor-analysis', postCompetitorAnalysis);
api.get('/market', getMarket);
api.get('/contracts/:contract_id/tracking', getContractTracking);
