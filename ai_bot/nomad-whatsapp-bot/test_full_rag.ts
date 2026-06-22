/**
 * Полный тест RAG системы - 3 цикла тестирования
 * Проверяет все сценарии диалога
 */

import { config } from 'dotenv';
import { RAGService } from './src/services/rag_service';

config();

const OLLAMA_URL = process.env.OLLAMA_BASE_URL;
const dataDir = './src/data';

console.log('\n🧪 ПОЛНЫЙ ТЕСТ RAG СИСТЕМЫ\n');
console.log('Ollama URL:', OLLAMA_URL ? '✅ Установлен' : '❌ Не установлен');

if (!OLLAMA_URL) {
    console.error('❌ Установите OLLAMA_BASE_URL в .env');
    process.exit(1);
}

const rag = new RAGService(OLLAMA_URL, dataDir);

interface TestCase {
    name: string;
    question: string;
    expectedContains?: string[];
    expectedNotContains?: string[];
    sessionId: string;
}

// ======================== ЦИКЛ 1: Базовые команды ========================
const cycle1Tests: TestCase[] = [
    {
        name: 'Приветствие',
        question: 'привет',
        expectedContains: ['Добрый день', 'МРТ', 'УЗИ', 'бот'],
        sessionId: 'cycle1_greeting'
    },
    {
        name: 'Список МРТ',
        question: 'мрт',
        expectedContains: ['МРТ', 'тг'],
        sessionId: 'cycle1_mrt'
    },
    {
        name: 'Список УЗИ',
        question: 'узи',
        expectedContains: ['УЗИ', 'тг'],
        sessionId: 'cycle1_uzi'
    },
    {
        name: 'Адрес',
        question: 'адрес',
        expectedContains: ['Абая', 'Достык Плаза'],
        sessionId: 'cycle1_address'
    },
    {
        name: 'График работы',
        question: 'график работы',
        expectedContains: ['08:00', '20:00'],
        sessionId: 'cycle1_schedule'
    },
    {
        name: 'Врачи',
        question: 'врачи',
        expectedContains: ['Врач'],
        sessionId: 'cycle1_doctors'
    }
];

// ======================== ЦИКЛ 2: Бронирование ========================
const cycle2Tests: TestCase[] = [
    {
        name: 'Начало бронирования',
        question: 'да',
        expectedContains: ['имя', 'фамилию'],
        sessionId: 'cycle2_booking_start'
    },
    {
        name: 'Имя (шаг 1)',
        question: 'Иван Иванов',
        expectedContains: ['возраст'],
        sessionId: 'cycle2_booking_name'
    },
    {
        name: 'Возраст (шаг 2)',
        question: '30',
        expectedContains: ['телефон'],
        sessionId: 'cycle2_booking_age'
    },
    {
        name: 'Телефон (шаг 3)',
        question: '+7 777 1234567',
        expectedContains: ['день'],
        sessionId: 'cycle2_booking_phone'
    },
    {
        name: 'Дата - время вместо даты',
        question: '09:00',
        expectedContains: ['время', 'ДАТУ'],
        sessionId: 'cycle2_booking_time_as_date'
    },
    {
        name: 'Дата - нормальный ввод',
        question: 'завтра',
        expectedContains: ['время'],
        sessionId: 'cycle2_booking_date'
    },
    {
        name: 'Время',
        question: '14:00',
        expectedContains: ['Проверьте данные'],
        sessionId: 'cycle2_booking_time'
    },
    {
        name: 'Подтверждение',
        question: 'да',
        expectedContains: ['Запись подтверждена'],
        sessionId: 'cycle2_booking_confirm'
    }
];

// ======================== ЦИКЛ 3: Поиск услуги по симптому ========================
const cycle3Tests: TestCase[] = [
    {
        name: 'Симптом: головная боль',
        question: 'у меня болит голова',
        expectedContains: ['МРТ головного мозга', 'тг'],
        sessionId: 'cycle3_head'
    },
    {
        name: 'Симптом: болит поясница',
        question: 'болит поясница',
        expectedContains: ['МРТ поясничного', 'тг'],
        sessionId: 'cycle3_back'
    },
    {
        name: 'Симптом: болит шея',
        question: 'болит шея',
        expectedContains: ['МРТ шейного', 'тг'],
        sessionId: 'cycle3_neck'
    },
    {
        name: 'Поиск КТ',
        question: 'кт',
        expectedContains: ['Компьютерная томография', 'тг'],
        sessionId: 'cycle3_ct'
    },
    {
        name: 'Поиск рентген',
        question: 'рентген',
        expectedContains: ['Рентгенография', 'тг'],
        sessionId: 'cycle3_xray'
    },
    {
        name: 'Благодарность',
        question: 'спасибо',
        expectedContains: ['Здоровья'],
        sessionId: 'cycle3_thanks'
    },
    {
        name: 'Отмена',
        question: 'отмена',
        expectedContains: ['завершаю'],
        sessionId: 'cycle3_cancel'
    }
];

// ======================== Функция проверки ========================
async function runTests(cycleName: string, tests: TestCase[]): Promise<{passed: number, failed: number, errors: string[]}> {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🔄 ${cycleName}`);
    console.log('='.repeat(70));
    
    let passed = 0;
    let failed = 0;
    const errors: string[] = [];
    
    for (const test of tests) {
        console.log(`\n📝 Тест: ${test.name}`);
        console.log(`   Вопрос: "${test.question}"`);
        
        try {
            const answer = await rag.processMessage(test.sessionId, test.question);
            
            console.log(`   Ответ: ${answer.substring(0, 150)}${answer.length > 150 ? '...' : ''}`);
            
            let testPassed = true;
            const testErrors: string[] = [];
            
            // Проверка expectedContains
            if (test.expectedContains) {
                for (const expected of test.expectedContains) {
                    if (!answer.toLowerCase().includes(expected.toLowerCase())) {
                        testPassed = false;
                        testErrors.push(`❌ Не найдено: "${expected}"`);
                    }
                }
            }
            
            // Проверка expectedNotContains
            if (test.expectedNotContains) {
                for (const notExpected of test.expectedNotContains) {
                    if (answer.toLowerCase().includes(notExpected.toLowerCase())) {
                        testPassed = false;
                        testErrors.push(`❌ Не должно быть: "${notExpected}"`);
                    }
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
            
        } catch (error: any) {
            console.log(`   ❌ ОШИБКА: ${error.message}`);
            errors.push(`${test.name}: ${error.message}`);
            failed++;
        }
        
        await new Promise(r => setTimeout(r, 300));
    }
    
    console.log(`\n📊 Результат цикла: ${passed}/${tests.length} пройдено`);
    if (failed > 0) {
        console.log(`⚠️  Провалено: ${failed}`);
    }
    
    return { passed, failed, errors };
}

// ======================== ГЛАВНАЯ ФУНКЦИЯ ========================
async function test() {
    try {
        // Загрузка документов
        rag.loadDocuments();
        
        if (rag['documents'].length === 0) {
            console.error('❌ НЕ ЗАГРУЖЕНО ДОКУМЕНТОВ!');
            process.exit(1);
        }
        
        console.log(`✅ Загружено документов: ${rag['documents'].length}`);
        rag['documents'].forEach(d => {
            console.log(`   📄 ${d.metadata.source} (${d.content.length} символов)`);
        });
        
        // Запуск циклов
        const results = [];
        
        results.push(await runTests('ЦИКЛ 1: Базовые команды', cycle1Tests));
        results.push(await runTests('ЦИКЛ 2: Бронирование', cycle2Tests));
        results.push(await runTests('ЦИКЛ 3: Симптомы и услуги', cycle3Tests));
        
        // Итоговый отчёт
        console.log(`\n${'='.repeat(70)}`);
        console.log('📊 ИТОГОВЫЙ ОТЧЁТ');
        console.log('='.repeat(70));
        
        const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
        const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
        const totalErrors = results.flatMap(r => r.errors);
        
        console.log(`✅ Пройдено: ${totalPassed}`);
        console.log(`❌ Провалено: ${totalFailed}`);
        console.log(`📝 Всего тестов: ${totalPassed + totalFailed}`);
        console.log(`📈 Успешность: ${Math.round((totalPassed / (totalPassed + totalFailed)) * 100)}%`);
        
        if (totalErrors.length > 0) {
            console.log(`\n⚠️  ОШИБКИ (${totalErrors.length}):`);
            totalErrors.forEach((err, i) => {
                console.log(`   ${i + 1}. ${err}`);
            });
        } else {
            console.log('\n🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ!');
        }
        
    } catch (error: any) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

test();
