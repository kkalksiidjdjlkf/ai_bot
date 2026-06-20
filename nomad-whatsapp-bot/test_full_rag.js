const { config } = require('dotenv');
const { RAGService } = require('./dist/services/rag_service');

config();

const OLLAMA_URL = process.env.OLLAMA_BASE_URL;
const dataDir = './src/data';

console.log('\n🧪 ПОЛНЫЙ ТЕСТ RAG СИСТЕМЫ\n');
console.log('Ollama:', OLLAMA_URL ? '✅' : '❌');

const rag = new RAGService(OLLAMA_URL, dataDir);
rag.loadDocuments();

console.log(`\n✅ Загружено документов: ${rag['documents'].length}`);
rag['documents'].forEach(d => {
    console.log(`   📄 ${d.metadata.source} (${d.content.length} символов)`);
});

// ======================== ТЕСТОВЫЕ ДАННЫЕ ========================
const tests = [
    // ЦИКЛ 1: Базовые команды
    { name: 'Приветствие', question: 'привет', expected: ['Добрый день', 'МРТ', 'УЗИ'], id: 't1' },
    { name: 'МРТ', question: 'мрт', expected: ['МРТ', 'тг'], id: 't2' },
    { name: 'УЗИ', question: 'узи', expected: ['УЗИ', 'тг'], id: 't3' },
    { name: 'Адрес', question: 'адрес', expected: ['Абая', 'Достык Плаза'], id: 't4' },
    { name: 'График', question: 'график работы', expected: ['08:00', '20:00'], id: 't5' },
    { name: 'Врачи', question: 'врачи', expected: ['Врач'], id: 't6' },
    
    // ЦИКЛ 2: Бронирование
    { name: 'Начало бронирования', question: 'да', expected: ['имя', 'фамилию'], id: 't7' },
    { name: 'Имя', question: 'Иван Иванов', expected: ['возраст'], id: 't8' },
    { name: 'Возраст', question: '30', expected: ['телефон'], id: 't9' },
    { name: 'Телефон', question: '+7 777 1234567', expected: ['день'], id: 't10' },
    { name: 'Время вместо даты', question: '09:00', expected: ['время', 'ДАТУ'], id: 't11' },
    { name: 'Дата', question: 'завтра', expected: ['время'], id: 't12' },
    { name: 'Время', question: '14:00', expected: ['Проверьте данные'], id: 't13' },
    { name: 'Подтверждение', question: 'да', expected: ['Запись подтверждена'], id: 't14' },
    
    // ЦИКЛ 3: Симптомы и услуги
    { name: 'Головная боль', question: 'у меня болит голова', expected: ['МРТ головного мозга', 'тг'], id: 't15' },
    { name: 'Болит поясница', question: 'болит поясница', expected: ['МРТ поясничного', 'тг'], id: 't16' },
    { name: 'Болит шея', question: 'болит шея', expected: ['МРТ шейного', 'тг'], id: 't17' },
    { name: 'КТ', question: 'кт', expected: ['Компьютерная томография', 'тг'], id: 't18' },
    { name: 'Рентген', question: 'рентген', expected: ['Рентгенография', 'тг'], id: 't19' },
    { name: 'Спасибо', question: 'спасибо', expected: ['Здоровья'], id: 't20' },
    { name: 'Отмена', question: 'отмена', expected: ['завершаю'], id: 't21' }
];

// ======================== ЗАПУСК ТЕСТОВ ========================
let passed = 0;
let failed = 0;
const errors = [];

async function runTest(test, index) {
    return new Promise(async (resolve) => {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`[${index + 1}/${tests.length}] ${test.name}`);
        console.log(`   Вопрос: "${test.question}"`);
        
        try {
            const answer = await rag.processMessage(test.id, test.question);
            
            console.log(`   Ответ: ${answer.substring(0, 120)}${answer.length > 120 ? '...' : ''}`);
            
            let testPassed = true;
            const testErrors = [];
            
            for (const expected of test.expected) {
                if (!answer.toLowerCase().includes(expected.toLowerCase())) {
                    testPassed = false;
                    testErrors.push(`❌ Не найдено: "${expected}"`);
                }
            }
            
            if (testPassed) {
                console.log(`   ✅ ПРОЙДЕНО`);
                passed++;
            } else {
                console.log(`   ❌ ПРОВАЛЕНО:`);
                testErrors.forEach(e => console.log(`      ${e}`));
                errors.push(`${test.name}: ${testErrors.join('; ')}`);
                failed++;
            }
            
        } catch (error) {
            console.log(`   ❌ ОШИБКА: ${error.message}`);
            errors.push(`${test.name}: ${error.message}`);
            failed++;
        }
        
        setTimeout(resolve, 200);
    });
}

async function runAll() {
    for (let i = 0; i < tests.length; i++) {
        await runTest(tests[i], i);
    }
    
    // Итог
    console.log(`\n${'='.repeat(70)}`);
    console.log('📊 ИТОГОВЫЙ ОТЧЁТ');
    console.log('='.repeat(70));
    console.log(`✅ Пройдено: ${passed}`);
    console.log(`❌ Провалено: ${failed}`);
    console.log(`📈 Успешность: ${Math.round((passed / tests.length) * 100)}%`);
    
    if (errors.length > 0) {
        console.log(`\n⚠️  ОШИБКИ (${errors.length}):`);
        errors.forEach((err, i) => console.log(`   ${i + 1}. ${err}`));
    } else {
        console.log('\n🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ!');
    }
    
    process.exit(failed > 0 ? 1 : 0);
}

runAll();
