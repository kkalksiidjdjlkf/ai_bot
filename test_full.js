const { config } = require('dotenv');
const { RAGService } = require('./dist/services/rag_service');
const path = require('path');

config();

const OLLAMA_URL = process.env.OLLAMA_BASE_URL;
const dataDir = path.join(__dirname, 'src', 'data');

console.log('\n🧪 ПОЛНЫЙ ТЕСТ RAG (3 цикла)\n');

const rag = new RAGService(OLLAMA_URL, dataDir);
rag.loadDocuments();

const tests = [
    // === ЦИКЛ 1: Базовые команды ===
    { cycle: 1, name: 'Приветствие', q: 'привет', expect: ['Добрый день', 'МРТ', 'УЗИ'], id: 'c1_user' },
    { cycle: 1, name: 'Список МРТ', q: 'мрт', expect: ['МРТ', 'тг'], id: 'c1_mrt' },
    { cycle: 1, name: 'Список УЗИ', q: 'узи', expect: ['УЗИ', 'тг'], id: 'c1_uzi' },
    { cycle: 1, name: 'Адрес', q: 'адрес', expect: ['Абая', 'Достык'], id: 'c1_addr' },
    { cycle: 1, name: 'График', q: 'график', expect: ['08:00', '20:00'], id: 'c1_sched' },
    { cycle: 1, name: 'Врачи', q: 'врачи', expect: ['Врач'], id: 'c1_doc' },
    
    // === ЦИКЛ 2: Бронирование (ОДИН sessionId!) ===
    { cycle: 2, name: 'Начало', q: 'да', expect: ['имя', 'фамилию'], id: 'booking_user' },
    { cycle: 2, name: 'Имя', q: 'Иван Иванов', expect: ['возраст'], id: 'booking_user' },
    { cycle: 2, name: 'Возраст', q: '30', expect: ['телефон'], id: 'booking_user' },
    { cycle: 2, name: 'Телефон', q: '+77771234567', expect: ['день'], id: 'booking_user' },
    { cycle: 2, name: 'Время вместо даты', q: '09:00', expect: ['время', 'ДАТУ'], id: 'booking_user' },
    { cycle: 2, name: 'Дата', q: 'завтра', expect: ['время'], id: 'booking_user' },
    { cycle: 2, name: 'Время', q: '14:00', expect: ['Проверьте'], id: 'booking_user' },
    { cycle: 2, name: 'Подтверждение', q: 'да', expect: ['Запись подтверждена'], id: 'booking_user' },
    
    // === ЦИКЛ 3: Симптомы ===
    { cycle: 3, name: 'Головная боль', q: 'болит голова', expect: ['МРТ', 'головного'], id: 'c3_head' },
    { cycle: 3, name: 'Болит поясница', q: 'болит поясница', expect: ['МРТ', 'поясничного'], id: 'c3_back' },
    { cycle: 3, name: 'Болит шея', q: 'болит шея', expect: ['МРТ', 'шейного'], id: 'c3_neck' },
    { cycle: 3, name: 'КТ', q: 'кт', expect: ['Компьютерная', 'тг'], id: 'c3_ct' },
    { cycle: 3, name: 'Рентген', q: 'рентген', expect: ['Рентгенография', 'тг'], id: 'c3_xray' },
    { cycle: 3, name: 'Спасибо', q: 'спасибо', expect: ['Здоровья'], id: 'c3_thx' },
    { cycle: 3, name: 'Отмена', q: 'отмена', expect: ['завершаю'], id: 'c3_cancel' }
];

async function run() {
    let passed = 0, failed = 0;
    const errors = [];
    
    for (let i = 0; i < tests.length; i++) {
        const t = tests[i];
        const ans = await rag.processMessage(t.id, t.q);
        const allPass = t.expect.every(e => ans.toLowerCase().includes(e.toLowerCase()));
        
        if (allPass) {
            console.log(`✅ [Цикл ${t.cycle}] ${t.name}`);
            passed++;
        } else {
            console.log(`❌ [Цикл ${t.cycle}] ${t.name}`);
            console.log(`   Ожид: ${t.expect.join(', ')}`);
            console.log(`   Получ: "${ans.substring(0, 100)}"`);
            errors.push(`${t.name}: не найдено ${t.expect.filter(e => !ans.toLowerCase().includes(e.toLowerCase())).join(', ')}`);
            failed++;
        }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 ИТОГИ');
    console.log('='.repeat(60));
    console.log(`✅ Пройдено: ${passed}/${tests.length}`);
    console.log(`❌ Провалено: ${failed}/${tests.length}`);
    console.log(`📈 Успешность: ${Math.round((passed/tests.length)*100)}%`);
    
    if (errors.length > 0) {
        console.log('\n⚠️  ОШИБКИ:');
        errors.forEach((e, i) => console.log(`   ${i+1}. ${e}`));
    } else {
        console.log('\n🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ!');
    }
    
    process.exit(failed > 0 ? 1 : 0);
}

run();
