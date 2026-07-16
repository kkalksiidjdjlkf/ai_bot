/**
 * Тест многоязычной поддержки (Казахский + Русский)
 */

const RAGService = require('./dist/services/rag_service').RAGService;
const path = require('path');

const dataDir = path.join(__dirname, '../data');
const ragService = new RAGService('http://localhost:11434', dataDir);

// Загружаем документы
ragService.loadDocuments();

async function runTests() {
  console.log('\n📝 ТЕСТ МНОГОЯЗЫЧНОЙ ПОДДЕРЖКИ\n');
  console.log('=' .repeat(60));
  
  const tests = [
    {
      lang: '🇷🇺 РУССКИЙ',
      sessionId: 'session_ru_001',
      messages: [
        { text: 'Привет', desc: '1. Приветствие (РУ)' },
        { text: 'Мне нужен МРТ', desc: '2. МРТ (РУ)' },
        { text: 'Графика работы', desc: '3. График (РУ)' },
        { text: 'Врачи', desc: '4. Врачи (РУ)' },
      ]
    },
    {
      lang: '🇰🇿 КАЗАХСКИЙ',
      sessionId: 'session_kz_001',
      messages: [
        { text: 'Сәлем', desc: '1. Приветствие (КЗ)' },
        { text: 'Маған МРТ керек', desc: '2. МРТ (КЗ)' },
        { text: 'Жұмыс уақыты', desc: '3. График (КЗ)' },
        { text: 'Дәрігерлер', desc: '4. Врачи (КЗ)' },
      ]
    }
  ];
  
  for (const testGroup of tests) {
    console.log(`\n${testGroup.lang}`);
    console.log('-'.repeat(60));
    
    for (const test of testGroup.messages) {
      try {
        const response = await ragService.processMessage(testGroup.sessionId, test.text);
        
        // Определяем язык ответа
        const isKZ = /[әғіңөұүқ]/i.test(response);
        const langLabel = isKZ ? '🇰🇿' : '🇷🇺';
        
        console.log(`\n${test.desc}`);
        console.log(`  Input:  "${test.text}"`);
        console.log(`  Output: ${langLabel}`);
        console.log(`  ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`);
        
      } catch (error) {
        console.error(`❌ Ошибка: ${error.message}`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ ТЕСТ ЗАВЕРШЁН\n');
}

runTests().catch(console.error);
