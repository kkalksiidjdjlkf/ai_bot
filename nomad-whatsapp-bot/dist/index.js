"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const baileys_2 = require("@whiskeysockets/baileys");
const boom_1 = require("@hapi/boom");
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const pino_1 = __importDefault(require("pino"));
const dotenv_1 = require("dotenv");
const path_1 = __importDefault(require("path"));
const fs = __importStar(require("fs"));
const helpers_1 = require("./utils/helpers");
const rag_service_1 = require("./services/rag_service");
// Загрузка .env
(0, dotenv_1.config)();
// Инициализация RAG
const OLLAMA_URL = process.env.OLLAMA_BASE_URL;
let ragService = null;
if (OLLAMA_URL) {
    console.log('\n🤖 Инициализация RAG с Llama 3.1 8B (Ollama)...');
    // Путь к данным: ищем в dist/data, потом в src/data, потом в data
    const possiblePaths = [
        path_1.default.join(__dirname, 'data'),
        path_1.default.join(__dirname, '..', 'src', 'data'),
        path_1.default.join(__dirname, '..', 'data'),
    ];
    let dataDir = null;
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            dataDir = p;
            break;
        }
    }
    if (!dataDir) {
        console.log('⚠️  Папка data/ не найдена. RAG отключен.\n');
    }
    else {
        ragService = new rag_service_1.RAGService(OLLAMA_URL, dataDir);
        try {
            ragService.loadDocuments();
            console.log('✅ RAG готов к работе\n');
        }
        catch (error) {
            console.log(`⚠️  RAG не загружен: ${error.message}\n`);
            ragService = null;
        }
    }
}
else {
    console.log('⚠️  OLLAMA_BASE_URL не установлен. RAG отключен.\n');
}
async function connectToWhatsApp() {
    const { state, saveCreds } = await (0, baileys_2.useMultiFileAuthState)('./auth_info/');
    const { version, isLatest } = await (0, baileys_1.fetchLatestBaileysVersion)();
    console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);
    const sock = (0, baileys_1.default)({
        version,
        logger: (0, pino_1.default)({ level: 'silent' }),
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
            qrcode_terminal_1.default.generate(qr, { small: true });
            console.log('\n⏱ У вас есть 2 минуты на сканирование!\n');
        }
        if (connection === 'close') {
            const reason = new boom_1.Boom(lastDisconnect?.error)?.output?.statusCode;
            // Не переподключаемся при 440 (Session Timeout) — нужно сканировать QR заново
            if (reason === 440) {
                console.log('❌ Сессия устарела (440). Удалите папку auth_info и отсканируйте QR заново.');
                console.log('💡 Команда: rm -rf auth_info && npm start');
                // Не вызываем connectToWhatsApp() — ждём пока пользователь сам перезапустит
                return;
            }
            if (reason === baileys_1.DisconnectReason.connectionClosed) {
                console.log('🔄 Переподключение...');
                connectToWhatsApp();
            }
            else if (reason === 515) {
                console.log('❌ QR-код истёк. Переподключение...');
                connectToWhatsApp();
            }
            else {
                console.log(`🔄 Переподключение (причина: ${reason})...`);
                connectToWhatsApp();
            }
        }
        else if (connection === 'open') {
            console.log('✅ Бот успешно подключен и работает!');
            console.log('💬 Напишите боту сообщение (например: "Привет" или "МРТ")\n');
        }
    });
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message.message || message.key.fromMe)
            return;
        const text = message.message.conversation || message.message.extendedTextMessage?.text || '';
        const sessionId = message.key.remoteJid;
        // Игнорируем только группы (@g.us), принимаем все остальные чаты
        if (!sessionId || sessionId.includes('@g.us')) {
            console.log(`⚠️  Игнорируем группу: ${sessionId}`);
            return;
        }
        if (!text)
            return;
        const fixedText = (0, helpers_1.fixKazakhTransliteration)(text);
        console.log(`[${sessionId}]: ${fixedText}`);
        await sock.sendPresenceUpdate('composing', sessionId);
        try {
            let response;
            // Если RAG активен - используем его
            if (ragService) {
                response = await ragService.processMessage(sessionId, fixedText);
                // Если пустой ответ (группа) - не отправляем
                if (!response || response.trim() === '') {
                    return;
                }
            }
            else {
                response = "Извините, бот временно недоступен. Позвоните: +7 777 123 45 67";
            }
            await sock.sendMessage(sessionId, { text: response });
        }
        catch (error) {
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
connectToWhatsApp();
