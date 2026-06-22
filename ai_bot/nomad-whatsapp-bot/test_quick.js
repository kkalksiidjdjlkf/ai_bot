const { config } = require('dotenv');
const { RAGService } = require('./dist/services/rag_service');
const path = require('path');

config();

const OLLAMA_URL = process.env.OLLAMA_BASE_URL;
// Правильный путь: от dist/ назад к src/data
const dataDir = path.join(__dirname, 'src', 'data');

console.log('\n🧪 БЫСТРЫЙ ТЕСТ\n');
console.log('Data dir:', dataDir);

const rag = new RAGService(OLLAMA_URL, dataDir);
rag.loadDocuments();

console.log(`Документов: ${rag.documents.length}\n`);

const tests = [
    { name: 'Привет', q: 'привет', expect: ['Добрый день'] },
    { name: 'МРТ', q: 'мрт', expect: ['МРТ'] },
    { name: 'УЗИ', q: 'узи', expect: ['УЗИ'] },
    { name: 'Адрес', q: 'адрес', expect: ['Абая', 'Достык'] },
    { name: 'График', q: 'график', expect: ['08:00', '20:00'] },
    { name: 'Врачи', q: 'врачи', expect: ['Врач', 'лет'] },
    { name: 'Запись', q: 'да', expect: ['имя'] },
    { name: 'Спасибо', q: 'спасибо', expect: ['Здоровья'] },
    { name: 'Отмена', q: 'отмена', expect: ['завершаю'] }
];

async function run() {
    let passed = 0, failed = 0;

    for (const t of tests) {
        const ans = await rag.processMessage('q' + t.name, t.q);
        const allPass = t.expect.every(e => ans.toLowerCase().includes(e.toLowerCase()));
        
        if (allPass) {
            console.log(`✅ ${t.name}`);
            passed++;
        } else {
            console.log(`❌ ${t.name}: "${ans.substring(0, 100)}"`);
            failed++;
        }
    }

    console.log(`\nРезультат: ${passed}/${tests.length}`);
    process.exit(failed > 0 ? 1 : 0);
}

run();
