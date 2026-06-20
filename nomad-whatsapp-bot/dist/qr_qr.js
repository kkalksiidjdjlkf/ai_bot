"use strict";
/**
 * Отдельный файл для вывода QR кода
 */
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
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const pino_1 = __importDefault(require("pino"));
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
async function showQR() {
    console.log('\n📷 ========================================');
    console.log('📷  QR КОД ДЛЯ WHATSAPP');
    console.log('📷 ========================================\n');
    console.log('📱 На телефоне: Настройки → Подключенные устройства → Подключить устройство');
    console.log('👇 QR-код ниже:\n');
    const { state } = await (0, baileys_2.useMultiFileAuthState)('./auth_info/');
    const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
    const sock = (0, baileys_1.default)({
        version,
        logger: (0, pino_1.default)({ level: 'silent' }),
        auth: state,
        syncFullHistory: false,
    });
    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log('\n⏱ У вас есть 2 минуты на сканирование!\n');
            console.log('QR CODE BELOW:');
            console.log('====================');
            qrcode_terminal_1.default.generate(qr, { small: true });
            console.log('====================\n');
            // Ждём подключения
            await new Promise((resolve) => {
                const checkConnection = setInterval(() => {
                    // Проверяем подключение каждые 2 секунды
                }, 2000);
                // Таймаут через 2 минуты
                setTimeout(() => {
                    clearInterval(checkConnection);
                    console.log('\n⏰ Время вышло. Запустите снова: npm run qr\n');
                    resolve();
                }, 120000);
            });
        }
        if (connection === 'open') {
            console.log('\n✅ УСПЕШНО ПОДКЛЮЧЕНО!');
            console.log('💬 Бот готов к работе!');
            setTimeout(() => process.exit(0), 1000);
        }
        if (connection === 'close') {
            console.log('\n❌ Подключение потеряно. Перезапустите: npm run qr\n');
            setTimeout(() => process.exit(1), 1000);
        }
    });
    sock.ev.on('creds.update', () => {
        // Автосохранение
    });
}
showQR().catch(err => {
    console.error('❌ Ошибка:', err.message);
    process.exit(1);
});
