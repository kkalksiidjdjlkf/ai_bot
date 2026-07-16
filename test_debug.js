const { config } = require('dotenv');
const { RAGService } = require('./dist/services/rag_service');
const path = require('path');

config();
const rag = new RAGService(process.env.OLLAMA_BASE_URL, path.join(__dirname, 'src', 'data'));
rag.loadDocuments();

async function test() {
    const sid = 'booking_test';
    
    console.log('1. Начало:', await rag.processMessage(sid, 'да'));
    console.log('2. Имя:', await rag.processMessage(sid, 'Иван Иванов'));
    console.log('3. Возраст:', await rag.processMessage(sid, '30'));
    console.log('4. Телефон:', await rag.processMessage(sid, '+77771234567'));
    console.log('5. Время вместо даты:', await rag.processMessage(sid, '09:00'));
    console.log('6. Дата (завтра):', await rag.processMessage(sid, 'завтра'));
    console.log('7. Время (14:00):', await rag.processMessage(sid, '14:00'));
    console.log('8. Подтверждение:', await rag.processMessage(sid, 'да'));
}

test();
