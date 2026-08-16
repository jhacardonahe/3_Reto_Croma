import { Router } from 'express';
import { getHealth, getUsage, getOpportunities, streamOpportunities, postCompetitorAnalysis, getMarket, getRetrospective, getContractTracking, getTaxonomy, getSegments, postGenerateTaxonomy, postSetTaxonomy, postResetTaxonomy } from './handlers.js';

export const api = Router();

api.get('/health', getHealth);
api.get('/usage', getUsage);
api.get('/opportunities', getOpportunities);
api.get('/opportunities/stream', streamOpportunities);
api.post('/competitor-analysis', postCompetitorAnalysis);
api.get('/market', getMarket);
api.get('/retrospective', getRetrospective);
api.get('/taxonomy', getTaxonomy);
api.get('/segments', getSegments);
api.post('/taxonomy/generate', postGenerateTaxonomy);
api.post('/taxonomy', postSetTaxonomy);
api.post('/taxonomy/reset', postResetTaxonomy);
api.get('/contracts/:contract_id/tracking', getContractTracking);
