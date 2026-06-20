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
Object.defineProperty(exports, "__esModule", { value: true });
exports.findServiceByKeyword = exports.formatPrice = exports.fixKazakhTransliteration = exports.loadConfig = exports.loadServices = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const loadServices = () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'data', 'services.json'), 'utf-8');
    return JSON.parse(content);
};
exports.loadServices = loadServices;
const loadConfig = () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf-8');
    return JSON.parse(content);
};
exports.loadConfig = loadConfig;
const fixKazakhTransliteration = (text) => {
    const kazakhPatterns = [
        'мын', 'мін', 'быз', 'міз', 'сың', 'сің', 'ды', 'ді', 'ты', 'ті',
        'ға', 'ге', 'қа', 'ке', 'дан', 'ден', 'тан', 'тен', 'мен', 'бен', 'пен',
        'нда', 'нде', 'лар', 'лер', 'дар', 'дер', 'тар', 'тер', 'шы', 'ші',
        'лық', 'лік', 'сыз', 'сіз', 'сәлем', 'қалай', 'рақмет', 'болады', 'жоқ'
    ];
    const lower = text.toLowerCase();
    const hasKazakh = kazakhPatterns.some(p => lower.includes(p));
    if (!hasKazakh)
        return text;
    const rules = [
        [new RegExp('([бвгджзйклмнпрстфхцчшщ])а', 'g'), '$1ә'],
        [new RegExp('([бвгджзйклмнпрстфхцчшщ])о', 'g'), '$1ө'],
        [new RegExp('([бвгджзйклмнпрстфхцчшщ])у', 'g'), '$1ұ'],
        [new RegExp('([бвгджзйклмнпрстфхцчшщ])у([бвгджзйклмнпрстфхцчшщ])', 'g'), '$1ү$2'],
        [new RegExp('га', 'g'), 'ға'],
        [new RegExp('го', 'g'), 'ғо'],
        [new RegExp('гу', 'g'), 'ғу'],
    ];
    let result = text;
    rules.forEach(([pattern, replacement]) => {
        result = result.replace(pattern, replacement);
    });
    return result;
};
exports.fixKazakhTransliteration = fixKazakhTransliteration;
const formatPrice = (price) => {
    return new Intl.NumberFormat('ru-RU').format(price);
};
exports.formatPrice = formatPrice;
const findServiceByKeyword = (services, keyword) => {
    const lowerKeyword = keyword.toLowerCase();
    if (['кто врач', 'какие врач', 'список врач', 'наши врач', 'врач', 'доктор', 'специалист'].some(k => lowerKeyword.includes(k))) {
        return null;
    }
    const prioritySymptoms = ["головная боль", "мигрень", "болит голова", "голова болит",
        "болит поясница", "спина болит", "боль в спине", "болит шея", "шея болит"];
    for (const symptom of prioritySymptoms) {
        if (lowerKeyword.includes(symptom)) {
            const svc = services.find(s => s.symptoms?.some((sy) => sy === symptom));
            if (svc)
                return svc;
        }
    }
    for (const svc of services) {
        if (svc.symptoms && svc.symptoms.some((s) => lowerKeyword.includes(s))) {
            return svc;
        }
    }
    for (const svc of services) {
        if (svc.keywords && svc.keywords.some((k) => k.length >= 2 && lowerKeyword.includes(k))) {
            return svc;
        }
    }
    return null;
};
exports.findServiceByKeyword = findServiceByKeyword;
