const { config } = require('dotenv');
const { RAGService } = require('./dist/services/rag_service');
const path = require('path');

config();
const rag = new RAGService(process.env.OLLAMA_BASE_URL, path.join(__dirname, 'src', 'data'));
rag.loadDocuments();

async function testBooking(name, dateInput, timeInput) {
    const sid = 'test_' + name;
    
    console.log(`\n=== Тест: ${name} ===`);
    
    // Шаг 1-4: стандартные
    await rag.processMessage(sid, 'да');
    await rag.processMessage(sid, 'Иван');
    await rag.processMessage(sid, '30');
    await rag.processMessage(sid, '+77771234567');
    
    // Шаг 5: дата
    const dateResp = await rag.processMessage(sid, dateInput);
    const dateOk = dateResp.includes('время') || dateResp.includes('Выберите');
    console.log(`Дата "${dateInput}": ${dateOk ? '✅' : '❌'} → ${dateResp.substring(0, 50)}`);
    
    // Шаг 6: время
    const timeResp = await rag.processMessage(sid, timeInput);
    const timeOk = timeResp.includes('Проверьте') || timeResp.includes('подтверждения');
    console.log(`Время "${timeInput}": ${timeOk ? '✅' : '❌'} → ${timeResp.substring(0, 50)}`);
    
    return dateOk && timeOk;
}

async function run() {
    const results = [];
    
    results.push(await testBooking('9:00', 'завтра', '9:00'));
    results.push(await testBooking('09:00', 'завтра', '09:00'));
    results.push(await testBooking('14:30', 'завтра', '14:30'));
    results.push(await testBooking('21.06.26', '21.06.26', '10:00'));
    results.push(await testBooking('21.06', '21.06', '10:00'));
    results.push(await testBooking('бүгін', 'бүгін', '10:00'));
    results.push(await testBooking('ертең', 'ертең', '10:00'));
    
    const passed = results.filter(r => r).length;
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Результат: ${passed}/${results.length}`);
    process.exit(passed === results.length ? 0 : 1);
}

run();
