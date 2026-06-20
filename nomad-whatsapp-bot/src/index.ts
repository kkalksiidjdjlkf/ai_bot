import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { config } from 'dotenv';
import path from 'path';
import * as fs from 'fs';
import { fixKazakhTransliteration } from './utils/helpers';
import { RAGService } from './services/rag_service';

// Загрузка .env
config();

// Инициализация RAG
const OLLAMA_URL = process.env.OLLAMA_BASE_URL;
let ragService: RAGService | null = null;

if (OLLAMA_URL) {
    console.log('\n🤖 Инициализация RAG с Llama 3.1 8B (Ollama)...');
    // Путь к данным: ищем в dist/data, потом в src/data, потом в data
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
        console.log('⚠️  Папка data/ не найдена. RAG отключен.\n');
    } else {
        ragService = new RAGService(OLLAMA_URL, dataDir);
        try {
            ragService.loadDocuments();
            console.log('✅ RAG готов к работе\n');
        } catch (error: any) {
            console.log(`⚠️  RAG не загружен: ${error.message}\n`);
            ragService = null;
        }
    }
} else {
    console.log('⚠️  OLLAMA_BASE_URL не установлен. RAG отключен.\n');
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info/');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        syncFullHistory: false,
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
            if (reason === DisconnectReason.connectionClosed) {
                console.log('🔄 Переподключение...');
                connectToWhatsApp();
            } else {
                console.log(`❌ Отключено по причине: ${reason}. Переподключение...`);
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Бот успешно подключен и работает!');
            console.log('💬 Напишите боту сообщение (например: "Привет" или "МРТ")\n');
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
            
            // Если RAG активен - используем его
            if (ragService) {
                response = await ragService.processMessage(sessionId, fixedText);
                
                // Если пустой ответ (группа) - не отправляем
                if (!response || response.trim() === '') {
                    return;
                }
            } else {
                response = "Извините, бот временно недоступен. Позвоните: +7 777 123 45 67";
            }
            
            await sock.sendMessage(sessionId, { text: response });
            
        } catch (error: any) {
            console.error('Error processing message:', error.message);
            await sock.sendMessage(sessionId, { 
                text: '❌ Ошибка обработки. Попробуйте позже или позвоните: +7 777 123 45 67' 
            });
        }
    });
}

connectToWhatsApp();