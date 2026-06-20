/**
 * Тест RAG системы
 */

import { config } from 'dotenv';
import { RAGService } from './src/services/rag_service';

config();

const API_KEY = process.env.GOOGLE_API_KEY;
const dataDir = './src/data';

console.log('\n🧪 ТЕСТ RAG СИСТЕМЫ\n');
console.log('API Key:', API_KEY ? '✅ Установлен' : '❌ Не установлен');

if (!API_KEY) {
    console.error('❌ Установите GOOGLE_API_KEY в .env');
    process.exit(1);
}

const rag = new RAGService(API_KEY, dataDir);

async function test() {
    try {
        // Загрузка
        rag.loadDocuments();
        
        // Тестовые вопросы
        const tests = [
            'привет',
            'Сколько стоит МРТ головного мозга?',
            'мрт',
            'узи',
            'адрес',
            'график работы',
            'врачи',
            'хочу записаться',
        ];
        
        console.log('\n📝 Тестирование:\n');
        
        const sessionId = 'test_session_' + Date.now();
        
        for (const question of tests) {
            console.log(`❓ ${question}`);
            console.log('💭 Обрабатываю...\n');
            
            const answer = await rag.processMessage(sessionId, question);
            
            console.log(`💬 ${answer}`);
            
            console.log('\n' + '='.repeat(60) + '\n');
            
            // Пауза между запросами
            await new Promise(r => setTimeout(r, 500));
        }
        
        console.log('✅ Тесты завершены!\n');
        
    } catch (error: any) {
        console.error('❌ Ошибка:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

test();