const { config } = require('dotenv');
const { RAGService } = require('./dist/services/rag_service');
const path = require('path');
const fs = require('fs');

// Load env manually like in index.ts
const PROJECT_ROOT = path.join(__dirname);
const envPath = path.join(PROJECT_ROOT, '.env');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      const cleanValue = value.replace(/^["']|["']$/g, '');
      process.env[key] = cleanValue;
    }
  }
}

console.log('\n' + '='.repeat(60));
console.log('🧪 КОМПЛЕКСНЫЙ ТЕСТ БОТА');
console.log('='.repeat(60) + '\n');

// Test 1: Environment Variables
console.log('📋 Тест 1: Переменные окружения');
console.log('-'.repeat(60));
const envVars = {
  'GOOGLE_SHEETS_ENABLED': process.env.GOOGLE_SHEETS_ENABLED,
  'GOOGLE_CALENDAR_ENABLED': process.env.GOOGLE_CALENDAR_ENABLED,
  'GOOGLE_SHEETS_ID': process.env.GOOGLE_SHEETS_ID ? '✅ установлен' : '❌ не установлен',
  'GOOGLE_APPLICATION_CREDENTIALS': process.env.GOOGLE_APPLICATION_CREDENTIALS,
};

let envPassed = true;
for (const [key, value] of Object.entries(envVars)) {
  const status = value === 'true' || (typeof value === 'string' && value.includes('✅')) ? '✅' : '⚠️';
  console.log(`  ${status} ${key}: ${value}`);
  if (status === '❌') envPassed = false;
}
console.log();

// Test 2: Data Files
console.log('📋 Тест 2: Файлы данных');
console.log('-'.repeat(60));
const dataDir = path.join(__dirname, 'src', 'data');
const requiredFiles = ['services.json', 'config.json', 'knowledge_base.json'];
let filesPassed = true;

for (const file of requiredFiles) {
  const filePath = path.join(dataDir, file);
  const exists = fs.existsSync(filePath);
  const status = exists ? '✅' : '❌';
  console.log(`  ${status} ${file}`);
  if (!exists) filesPassed = false;
}
console.log();

// Test 3: RAG Service Initialization
console.log('📋 Тест 3: Инициализация RAG сервиса');
console.log('-'.repeat(60));
let ragPassed = false;
try {
  const rag = new RAGService(process.env.OLLAMA_BASE_URL, dataDir);
  rag.loadDocuments();
  console.log(`  ✅ RAG сервис инициализирован`);
  console.log(`  ✅ Загружено документов: ${rag.documents.length}`);
  ragPassed = rag.documents.length > 0;
  console.log();

  // Test 4: Basic Message Processing
  console.log('📋 Тест 4: Обработка сообщений');
  console.log('-'.repeat(60));
  
  const basicTests = [
    { name: 'Приветствие', msg: 'привет', shouldInclude: ['добрый', 'день'] },
    { name: 'Услуга МРТ', msg: 'мрт', shouldInclude: ['мрт'] },
    { name: 'Услуга УЗИ', msg: 'узи', shouldInclude: ['узи'] },
    { name: 'Контакты', msg: 'адрес', shouldInclude: ['астана'] },
    { name: 'График работы', msg: 'график', shouldInclude: ['08:00', '20:00'] },
  ];

  async function runBasicTests() {
    let basicPassed = 0;
    for (const test of basicTests) {
      const response = await rag.processMessage('test_' + test.name, test.msg);
      const passed = test.shouldInclude.every(word => 
        response.toLowerCase().includes(word.toLowerCase())
      );
      const status = passed ? '✅' : '❌';
      console.log(`  ${status} ${test.name}`);
      if (passed) basicPassed++;
    }
    console.log();

    // Test 5: Date Validation
    console.log('📋 Тест 5: Валидация дат');
    console.log('-'.repeat(60));
    
    const dateTests = [
      { name: 'Некорректная дата (31 февраля)', msg: '31 февраля', shouldReject: true },
      { name: 'Некорректная дата (32 января)', msg: '32 января', shouldReject: true },
      { name: 'Корректная дата (завтра)', msg: 'завтра', shouldReject: false },
      { name: 'Корректная дата на казахском (ертең)', msg: 'ертең', shouldReject: false },
    ];

    let datePassed = 0;
    for (const test of dateTests) {
      // Simulate booking flow
      const sid = 'booking_' + test.name;
      await rag.processMessage(sid, 'да');        // Booking confirmation
      await rag.processMessage(sid, 'Тестов Тест'); // Name
      await rag.processMessage(sid, '30');         // Age
      await rag.processMessage(sid, '+77771234567'); // Phone
      
      const dateResponse = await rag.processMessage(sid, test.msg);
      
      const isRejected = dateResponse.toLowerCase().includes('ошиб') || 
                        dateResponse.toLowerCase().includes('день должен') ||
                        dateResponse.toLowerCase().includes('только') ||
                        dateResponse.toLowerCase().includes('уже прошла');
      
      const passed = isRejected === test.shouldReject;
      const status = passed ? '✅' : '❌';
      console.log(`  ${status} ${test.name}`);
      if (passed) datePassed++;
    }
    console.log();

    // Test 6: Compilation Check
    console.log('📋 Тест 6: Статус компиляции');
    console.log('-'.repeat(60));
    const distDir = path.join(__dirname, 'dist');
    const indexJs = path.join(distDir, 'index.js');
    const distExists = fs.existsSync(indexJs);
    console.log(`  ${distExists ? '✅' : '❌'} dist/index.js скомпилирован`);
    console.log();

    // Summary
    console.log('='.repeat(60));
    console.log('📊 ИТОГОВЫЙ РЕЗУЛЬТАТ');
    console.log('='.repeat(60));
    
    const results = {
      '✅ Переменные окружения': envPassed,
      '✅ Файлы данных': filesPassed,
      '✅ RAG сервис': ragPassed,
      '✅ Обработка сообщений': basicPassed === basicTests.length,
      '✅ Валидация дат': datePassed === dateTests.length,
      '✅ Компиляция': distExists,
    };

    let allPassed = true;
    for (const [name, passed] of Object.entries(results)) {
      const status = passed ? '✅' : '❌';
      console.log(`${status} ${name}`);
      if (!passed) allPassed = false;
    }
    console.log('='.repeat(60) + '\n');

    process.exit(allPassed ? 0 : 1);
  }

  runBasicTests().catch(err => {
    console.error('❌ Ошибка при тестировании:', err.message);
    process.exit(1);
  });

} catch (error) {
  console.error(`  ❌ Ошибка инициализации: ${error.message}`);
  console.log();
  process.exit(1);
}
