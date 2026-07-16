import { RAGService } from './nomad-whatsapp-bot/src/services/rag_service';
import * as path from 'path';

const dataPath = path.join(__dirname, 'nomad-whatsapp-bot/src/data');
const rag = new RAGService('http://localhost', dataPath);
rag['hasOllama'] = false;
rag['sessionLanguages'].set('test-session', 'kz');
rag['bookingStates'].set('test-session', { step: 'waiting_confirmation', patientData: {}, appointmentData: { service: 'УЗИ сосудов шеи (БЦА)' } });

const res = rag.processMessage('test-session', 'кешен');
console.log("RESULT:", res);
