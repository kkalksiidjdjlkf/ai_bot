import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import path from 'path';
import * as fs from 'fs';
import { fixKazakhTransliteration } from './utils/helpers';
import { RAGService } from './services/rag_service';

const BASE_RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30000;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
let isShuttingDown = false;

// Читаем .env вручную (dotenvx конфликтует с dotenv)
const PROJECT_ROOT = path.resolve(__dirname, '..');
const envPath = path.join(PROJECT_ROOT, '.env');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    // Пропускаем пустые строки и комментарии
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      // Убираем кавычки
      const cleanValue = value.replace(/^["']|["']$/g, '');
      process.env[key] = cleanValue;
    }
  }
  console.log('✅ .env загружен вручную из:', envPath);
} else {
  console.log('❌ .env не найден:', envPath);
}

console.log('   OLLAMA_BASE_URL:', process.env.OLLAMA_BASE_URL);
console.log('   GOOGLE_SHEETS_ENABLED:', process.env.GOOGLE_SHEETS_ENABLED);
console.log('   GOOGLE_CALENDAR_ENABLED:', process.env.GOOGLE_CALENDAR_ENABLED);
console.log('   GOOGLE_SHEETS_ID:', process.env.GOOGLE_SHEETS_ID);



// Инициализация RAG (работает с Ollama или без него)
const OLLAMA_URL = process.env.OLLAMA_BASE_URL;
let ragService: RAGService | null = null;

// Ищем папку data
const possiblePaths = [
    path.join(__dirname, 'data'),
    path.join(__dirname, '..', 'src', 'data'),
    path.join(__dirname, '..', 'data'),
];
let dataDir: string | null = null;
for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
        dataDir = p;
        break;
    }
}

if (!dataDir) {
    console.log('⚠️  Папка data/ не найдена. Бот работает без базы знаний.\n');
} else {
    try {
        // Инициализируем RAGService ВСЕ, даже без Ollama
        // Бот будет работать с базой знаний и обработкой бронирования
        ragService = new RAGService(OLLAMA_URL || '', dataDir);
        ragService.loadDocuments();
        
        if (OLLAMA_URL) {
            console.log('✅ RAG инициализирован с Ollama\n');
        } else {
            console.log('✅ RAG инициализирован (без Ollama LLM, базовая логика работает)\n');
        }
    } catch (error: any) {
        console.log(`⚠️  RAG не загружен: ${error.message}\n`);
        ragService = null;
    }
}

async function connectToWhatsApp() {
    if (isShuttingDown) return;

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info/');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        keepAliveIntervalMs: 30000,
        printQRInTerminal: false,
        retryRequestDelayMs: 10,
        maxMsgRetryCount: 5,
        fireInitQueries: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n📷 ========================================');
            console.log('📷  СКАНИРУЙТЕ QR-КОД ЧЕРЕЗ WHATSAPP');
            console.log('📷 ========================================');
            console.log('📱 На телефоне: Настройки → Подключенные устройства → Подключить устройство');
            console.log('👇 QR-код ниже:\n');
            qrcode.generate(qr, { small: true });
            console.log('\n⏱ У вас есть 2 минуты на сканирование!\n');
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut || reason === 440) {
                console.log('⚠️ Сессия авторизации обновляется. Будет запрошен новый QR-код.');
            }

            scheduleReconnect(`disconnect reason: ${reason ?? 'unknown'}`);
        } else if (connection === 'open') {
            console.log('✅ Бот успешно подключен и работает!');
            console.log('💬 Напишите боту сообщение (например: "Привет" или "МРТ")\n');
            reconnectAttempts = 0;
        }
    });
            
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message.message || message.key.fromMe) return;

        const text = message.message.conversation || message.message.extendedTextMessage?.text || '';
        const sessionId = message.key.remoteJid;
        
        // Игнорируем только группы (@g.us), принимаем все остальные чаты
        if (!sessionId || sessionId.includes('@g.us')) {
            console.log(`⚠️  Игнорируем группу: ${sessionId}`);
            return;
        }
        
        if (!text) return;

        const fixedText = fixKazakhTransliteration(text);
        console.log(`[${sessionId}]: ${fixedText}`);

        await sock.sendPresenceUpdate('composing', sessionId);

        try {
            let response: string;
            
            // Обработка сообщения через RAG сервис (всегда инициализирован)
            if (ragService) {
                response = await ragService.processMessage(sessionId, fixedText);
                
                // Если пустой ответ (группа) - не отправляем
                if (!response || response.trim() === '') {
                    return;
                }
            } else {
                // Если RAG не инициализирован - отправляем справку
                response = "❌ Бот недоступен. Пожалуйста позвоните: +7 777 123 45 67";
            }
            
            await sock.sendMessage(sessionId, { text: response });
            
        } catch (error: any) {
            console.error('Error processing message:', error.message);
            // Не пытаемся отправить ошибку если соединение закрыто
            if (error.message !== 'Connection Closed') {
                await sock.sendMessage(sessionId, { 
                    text: '❌ Ошибка обработки. Попробуйте позже или позвоните: +7 777 123 45 67' 
                });
            }
        }
    });
}

function getReconnectDelayMs(): number {
        const backoff = BASE_RECONNECT_DELAY_MS * Math.pow(2, Math.min(reconnectAttempts, 4));
        return Math.min(backoff, MAX_RECONNECT_DELAY_MS);
}

function scheduleReconnect(reason: string): void {
        if (isShuttingDown) {
            return;
        }
        if (reconnectTimer) {
            return;
        }

        reconnectAttempts += 1;
        const delay = getReconnectDelayMs();
        console.log(`🔄 Переподключение через ${Math.round(delay / 1000)} сек (${reason})`);

        reconnectTimer = setTimeout(async () => {
            reconnectTimer = null;
            try {
                await connectToWhatsApp();
            } catch (error: any) {
                console.error(`❌ Ошибка переподключения: ${error?.message || error}`);
                scheduleReconnect('connectToWhatsApp failed');
            }
        }, delay);
}

function shutdown(signal: string): void {
    if (isShuttingDown) return;

    isShuttingDown = true;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    console.log(`\n⏹ Получен ${signal}. Останавливаю бот...`);
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason: unknown) => {
    console.error('❌ Unhandled rejection:', reason);
    scheduleReconnect('unhandledRejection');
});

process.on('uncaughtException', (error: Error) => {
    console.error('❌ Uncaught exception:', error);
    scheduleReconnect('uncaughtException');
});

connectToWhatsApp().catch((error: any) => {
    console.error(`❌ Ошибка первого запуска: ${error?.message || error}`);
    scheduleReconnect('initial startup failed');
});