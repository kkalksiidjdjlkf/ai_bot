const { config } = require('dotenv');
const { RAGService } = require('./dist/services/rag_service');
const path = require('path');

config();
const rag = new RAGService(process.env.OLLAMA_BASE_URL, path.join(__dirname, 'src', 'data'));
rag.loadDocuments();

async function test() {
    const sid = 'debug_booking';
    
    for (const step of ['да', 'Иван Иванов', '30', '+77771234567', '09:00', 'завтра', '14:00', 'да']) {
        const stateBefore = rag['bookingStates'].get(sid);
        console.log(`\n[STEP: "${step}"] State before: ${stateBefore ? stateBefore.step : 'null'}`);
        
        const ans = await rag.processMessage(sid, step);
        
        const stateAfter = rag['bookingStates'].get(sid);
        console.log(`[State after: ${stateAfter ? stateAfter.step : 'null'}]`);
        console.log(`[Answer: ${ans.substring(0, 100).replace(/\n/g, '\\n')}]`);
    }
}

test();
