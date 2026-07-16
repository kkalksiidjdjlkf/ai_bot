import { RAGService } from './nomad-whatsapp-bot/src/services/rag_service';

const rag = new RAGService('./nomad-whatsapp-bot/src/data');
const sessionId = 'test1';
console.log(rag.processMessage(sessionId, 'мрт'));
console.log(rag.processMessage(sessionId, '1'));
