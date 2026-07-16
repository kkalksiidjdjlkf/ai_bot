import { RAGService } from './nomad-whatsapp-bot/src/services/rag_service';
import * as path from 'path';

async function runTest() {
  const dataPath = path.join(__dirname, 'nomad-whatsapp-bot/src/data');
  const rag = new RAGService('http://localhost', dataPath);
  rag['hasOllama'] = false;
  
  const sessionId = 'test-session-1234';
  rag['sessionLanguages'].set(sessionId, 'kz');

  const messages = [
    "мрт",
    "3",
    "кешен",
    "Maks Test",
    "30",
    "ия", // confirm phone from JID? wait, my test jid is 'test-session-1234', so extractPhoneFromJid will fail and return null. So it will ask for phone. Let's send phone instead!
    "+77001234567",
    "27 шилде",
    "15",
    "ия"
  ];

  for (const msg of messages) {
    console.log(`\n==========================================`);
    console.log(`👤 USER: ${msg}`);
    const res = await rag.processMessage(sessionId, msg);
    console.log(`🤖 BOT:\n${typeof res === 'string' ? res : res.text}`);
  }
}

runTest().catch(console.error);
