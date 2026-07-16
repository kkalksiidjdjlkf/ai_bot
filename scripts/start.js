#!/usr/bin/env node
/**
 * Запуск всех ботов Nomad Clinic
 * Запуск: npm start
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const IS_WINDOWS = os.platform() === 'win32';
const PROJECT_ROOT = path.resolve(__dirname, '..');

console.log('\n' + '='.repeat(60));
console.log('🏥  NOMAD CLINIC — ЗАПУСК ВСЕХ БОТОВ');
console.log('='.repeat(60) + '\n');

// ============================================
// WhatsApp Bot
// ============================================
console.log('📱 Запуск WhatsApp бота...');
const whatsappBot = spawn(
  IS_WINDOWS ? 'cmd.exe' : 'bash',
  IS_WINDOWS 
    ? ['/c', 'cd nomad-whatsapp-bot && npm run build && npm start']
    : ['-c', 'cd nomad-whatsapp-bot && npm run build && npm start'],
  {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: true,
  }
);

// ============================================
// Terminal Bot (Python)
// ============================================
console.log('💻 Запуск Terminal бота...');
const terminalBot = spawn(
  IS_WINDOWS ? 'python' : 'python3',
  ['terminal_bot.py'],
  {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: IS_WINDOWS,
  }
);

// ============================================
// Обработка завершения
// ============================================
function handleExit(signal) {
  console.log(`\n⚠️  Получен сигнал ${signal}. Остановка ботов...`);
  
  console.log('📱 Остановка WhatsApp бота...');
  whatsappBot.kill('SIGINT');
  
  console.log('💻 Остановка Terminal бота...');
  terminalBot.kill('SIGINT');
  
  console.log('✅ Все боты остановлены.\n');
  process.exit(0);
}

process.on('SIGINT', () => handleExit('SIGINT'));
process.on('SIGTERM', () => handleExit('SIGTERM'));

// Перенаправляем сигналы от дочерних процессов
whatsappBot.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.log(`\n⚠️  WhatsApp бот завершился с кодом ${code}`);
  }
});

terminalBot.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.log(`\n⚠️  Terminal бот завершился с кодом ${code}`);
  }
});

console.log('\n' + '-'.repeat(60));
console.log('✅ Боты запущены!');
console.log('   WhatsApp: подключается в фоне (сканируйте QR)');
console.log('   Terminal: доступен в этом же терминале');
console.log('   Нажмите Ctrl+C для остановки');
console.log('-'.repeat(60) + '\n');
