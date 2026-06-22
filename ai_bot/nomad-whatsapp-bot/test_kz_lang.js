const { config } = require('dotenv');
const { RAGService } = require('./dist/services/rag_service');
const path = require('path');

config();
const rag = new RAGService(process.env.OLLAMA_BASE_URL, path.join(__dirname, 'src', 'data'));
rag.loadDocuments();

const tests = [
    // Казахские приветствия
    { name: 'Сәлем', q: 'сәлем', expect: ['Добрый'], id: 'kz1' },
    { name: 'Салем', q: 'салем', expect: ['Добрый'], id: 'kz2' },
    
    // Казахская благодарность
    { name: 'Рахмет', q: 'рахмет', expect: ['Здоровья'], id: 'kz3' },
    { name: 'Рақмет', q: 'рақмет', expect: ['Здоровья'], id: 'kz4' },
    
    // Казахская отмена
    { name: 'Жоқ', q: 'жоқ', expect: ['завершаю'], id: 'kz5' },
    { name: 'Ой', q: 'ой', expect: ['завершаю'], id: 'kz6' },
    
    // Сленг подтверждения
    { name: 'Оке', q: 'оке', expect: ['имя'], id: 'kz7' },
    { name: 'Окей', q: 'окей', expect: ['имя'], id: 'kz8' },
    { name: 'Ага', q: 'ага', expect: ['имя'], id: 'kz9' },
    { name: 'Иә', q: 'иә', expect: ['имя'], id: 'kz10' },
    
    // Смешанный текст
    { name: 'Ой бө', q: 'ой бө', expect: ['завершаю'], id: 'kz11' },
    { name: 'Рахмет бот', q: 'рахмет бот', expect: ['Здоровья'], id: 'kz12' },
];

async function run() {
    let passed = 0, failed = 0;
    
    for (const t of tests) {
        const ans = await rag.processMessage(t.id, t.q);
        const allPass = t.expect.every(e => ans.toLowerCase().includes(e.toLowerCase()));
        
        if (allPass) {
            console.log(`✅ ${t.name} ("${t.q}")`);
            passed++;
        } else {
            console.log(`❌ ${t.name} ("${t.q}") → ${ans.substring(0, 60)}`);
            failed++;
        }
    }
    
    console.log(`\nРезультат: ${passed}/${tests.length}`);
    process.exit(failed > 0 ? 1 : 0);
}

run();
