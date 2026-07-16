const { config } = require('dotenv');
const { RAGService } = require('./dist/services/rag_service');
const path = require('path');

config();
const rag = new RAGService(process.env.OLLAMA_BASE_URL, path.join(__dirname, 'src', 'data'));
rag.loadDocuments();

const tests = [
    // Приветствия
    { q: 'привет', expect: ['Добрый'], id: 't1' },
    { q: 'сәлем', expect: ['Добрый'], id: 't2' },
    { q: 'хай', expect: ['Добрый'], id: 't3' },
    
    // Благодарность
    { q: 'спасибо', expect: ['Здоровья'], id: 't4' },
    { q: 'рахмет', expect: ['Здоровья'], id: 't5' },
    { q: 'рақмет', expect: ['Здоровья'], id: 't6' },
    
    // Отмена
    { q: 'отмена', expect: ['завершаю'], id: 't7' },
    { q: 'жоқ', expect: ['завершаю'], id: 't8' },
    { q: 'ой', expect: ['завершаю'], id: 't9' },
    
    // Подтверждение
    { q: 'да', expect: ['имя'], id: 't10' },
    { q: 'оке', expect: ['имя'], id: 't11' },
    { q: 'окей', expect: ['имя'], id: 't12' },
    { q: 'ага', expect: ['имя'], id: 't13' },
    { q: 'иә', expect: ['имя'], id: 't14' },
    
    // Время (разные форматы)
    { q: '9:00', expect: ['время', 'ДАТУ'], id: 't15' },
    { q: '09:00', expect: ['время', 'ДАТУ'], id: 't16' },
    { q: '14:30', expect: ['время', 'ДАТУ'], id: 't17' },
    
    // Даты (разные форматы)
    { q: '21.06.26', expect: ['время'], id: 't18' },
    { q: '21.06', expect: ['время'], id: 't19' },
    { q: '21/06', expect: ['время'], id: 't20' },
    { q: 'бүгін', expect: ['время'], id: 't21' },
    { q: 'ертең', expect: ['время'], id: 't22' },
];

async function run() {
    let passed = 0, failed = 0;
    
    for (const t of tests) {
        const ans = await rag.processMessage(t.id, t.q);
        const allPass = t.expect.every(e => ans.toLowerCase().includes(e.toLowerCase()));
        
        if (allPass) {
            console.log(`✅ "${t.q}"`);
            passed++;
        } else {
            console.log(`❌ "${t.q}" → ${ans.substring(0, 60)}`);
            failed++;
        }
    }
    
    console.log(`\nРезультат: ${passed}/${tests.length}`);
    process.exit(failed > 0 ? 1 : 0);
}

run();
