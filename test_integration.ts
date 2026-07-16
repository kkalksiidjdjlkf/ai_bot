/**
 * Тест валидации дат и Google интеграции
 */

import { config } from 'dotenv';
config(); // Загружаем .env

import { RAGService } from './src/services/rag_service';

async function testDateValidation() {
    console.log('\n🧪 Тестирование валидации дат\n');
    console.log('=' .repeat(50));
    
    const ragService = new RAGService('', './src/data');
    
    const today = new Date();
    const futureDate = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000); // +10 дней
    const futureMonth = futureDate.toLocaleString('ru', { month: 'long' });
    const futureDay = futureDate.getDate();
    
    const testCases = [
        { date: '31 февраля', shouldPass: false },
        { date: '29 февраля', shouldPass: false }, // 2026 не високосный
        { date: '28 февраля', shouldPass: false }, // уже прошло (июнь 2026)
        { date: '31 марта', shouldPass: false }, // уже прошло
        { date: '32 января', shouldPass: false },
        { date: '15.13', shouldPass: false },
        { date: 'сегодня', shouldPass: true },
        { date: 'завтра', shouldPass: true },
        { date: 'послезавтра', shouldPass: true },
        { date: '25.06', shouldPass: true }, // будущее
        { date: '25.06.26', shouldPass: true },
        { date: `${futureDay} ${futureMonth}`, shouldPass: true },
        { date: 'бүгін', shouldPass: true },
        { date: 'ертең', shouldPass: true },
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const testCase of testCases) {
        const result = (ragService as any).validateDate(testCase.date);
        const success = result.valid === testCase.shouldPass;
        
        const status = success ? '✅' : '❌';
        const expected = testCase.shouldPass ? 'OK' : 'FAIL';
        const actual = result.valid ? 'OK' : 'FAIL';
        
        console.log(`${status} "${testCase.date}" — ожидалось: ${expected}, получилось: ${actual}`);
        if (!result.valid && !testCase.shouldPass) {
            console.log(`   Ошибка: ${result.error}`);
        }
        
        if (success) passed++;
        else failed++;
    }
    
    console.log('=' .repeat(50));
    console.log(`\nИтого: ${passed} прошло, ${failed} провалилось\n`);
    
    return failed === 0;
}

async function testGoogleSheets() {
    console.log('\n🧪 Тестирование Google Sheets\n');
    console.log('=' .repeat(50));
    
    // Устанавливаем правильный путь к credentials
    process.env.GOOGLE_APPLICATION_CREDENTIALS = './google-credentials.json';
    
    const { sheetsService } = await import('./src/services/google_sheets_service');
    
    const initialized = await sheetsService.initialize();
    console.log(`Инициализация: ${initialized ? '✅' : '❌'}`);
    
    if (initialized) {
        const testBooking = {
            id: `TEST_${Date.now()}`,
            patient_name: 'Тестовый Пациент',
            phone: '+77771234567',
            age: 25,
            service_name: 'Тестовая услуга',
            date: '28 февраля',
            time: '15:00',
            created_at: new Date().toISOString(),
            status: 'test',
        };
        
        console.log('\nДобавление тестовой записи...');
        const added = await sheetsService.addBooking(testBooking);
        console.log(`Добавлено: ${added ? '✅' : '❌'}`);
        
        if (added) {
            console.log('\nЧтение всех записей...');
            const bookings = await sheetsService.getAllBookings();
            console.log(`Найдено записей: ${bookings.length}`);
            
            const testRecord = bookings.find(b => b.id === testBooking.id);
            console.log(`Тестовая запись найдена: ${testRecord ? '✅' : '❌'}`);
        }
    }
    
    console.log('=' .repeat(50));
    console.log();
    
    return initialized;
}

async function testGoogleCalendar() {
    console.log('\n🧪 Тестирование Google Calendar\n');
    console.log('=' .repeat(50));
    
    // Устанавливаем правильный путь к credentials
    process.env.GOOGLE_APPLICATION_CREDENTIALS = './google-credentials.json';
    process.env.GOOGLE_CALENDAR_ENABLED = 'true';
    process.env.GOOGLE_CALENDAR_ID = 'primary';
    
    const { calendarService } = await import('./src/services/google_calendar_service');
    
    const initialized = await calendarService.initialize();
    console.log(`Инициализация: ${initialized ? '✅' : '❌'}`);
    
    if (initialized) {
        const testBooking = {
            id: `CAL_TEST_${Date.now()}`,
            patient_name: 'Тестовый Пациент',
            phone: '+77771234567',
            age: 25,
            service_name: 'МРТ головного мозга',
            date: '28 февраля',
            time: '15:00',
        };
        
        console.log('\nСоздание тестового события...');
        const created = await calendarService.createEvent(testBooking);
        console.log(`Создано: ${created ? '✅' : '❌'}`);
    }
    
    console.log('=' .repeat(50));
    console.log();
    
    return initialized;
}

async function main() {
    console.log('\n🚀 Запуск тестов Nomad Clinic Bot\n');
    
    const dateTestPassed = await testDateValidation();
    const sheetsTestPassed = await testGoogleSheets();
    const calendarTestPassed = await testGoogleCalendar();
    
    console.log('\n' + '=' .repeat(50));
    console.log('📊 ИТОГИ ТЕСТИРОВАНИЯ');
    console.log('=' .repeat(50));
    console.log(`Валидация дат:    ${dateTestPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Google Sheets:    ${sheetsTestPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Google Calendar:  ${calendarTestPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log('=' .repeat(50));
    
    if (dateTestPassed && sheetsTestPassed && calendarTestPassed) {
        console.log('\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ!\n');
        process.exit(0);
    } else {
        console.log('\n❌ НЕКОТОРЫЕ ТЕСТЫ ПРОВАЛИЛИСЬ\n');
        process.exit(1);
    }
}

main().catch(console.error);
