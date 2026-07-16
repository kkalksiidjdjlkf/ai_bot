import * as fs from 'fs';
import * as path from 'path';

export const loadServices = () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'data', 'services.json'), 'utf-8');
    return JSON.parse(content);
};

export const loadConfig = () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf-8');
    return JSON.parse(content);
};

export const fixKazakhTransliteration = (text: string): string => {
    const kazakhPatterns = [
        'мын', 'мін', 'быз', 'міз', 'сың', 'сің', 'ды', 'ді', 'ты', 'ті',
        'ға', 'ге', 'қа', 'ке', 'дан', 'ден', 'тан', 'тен', 'мен', 'бен', 'пен',
        'нда', 'нде', 'лар', 'лер', 'дар', 'дер', 'тар', 'тер', 'шы', 'ші',
        'лық', 'лік', 'сыз', 'сіз', 'сәлем', 'қалай', 'рақмет', 'болады', 'жоқ'
    ];
    
    const lower = text.toLowerCase();
    const hasKazakh = kazakhPatterns.some(p => lower.includes(p));
    
    if (!hasKazakh) return text;

    const rules: [RegExp, string][] = [
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

export const formatPrice = (price: number): string => {
    return new Intl.NumberFormat('ru-RU').format(price);
};

export const findServiceByKeyword = (services: any[], keyword: string) => {
    const lowerKeyword = keyword.toLowerCase();
    
    if (['кто врач', 'какие врач', 'список врач', 'наши врач', 'врач', 'доктор', 'специалист'].some(k => lowerKeyword.includes(k))) {
        return null;
    }

    const prioritySymptoms = ["головная боль", "мигрень", "болит голова", "голова болит", 
                              "болит поясница", "спина болит", "боль в спине", "болит шея", "шея болит"];
    
    for (const symptom of prioritySymptoms) {
        if (lowerKeyword.includes(symptom)) {
            const svc = services.find(s => s.symptoms?.some((sy: string) => sy === symptom));
            if (svc) return svc;
        }
    }

    for (const svc of services) {
        if (svc.symptoms && svc.symptoms.some((s: string) => lowerKeyword.includes(s))) {
            return svc;
        }
    }
    
    for (const svc of services) {
        if (svc.keywords && svc.keywords.some((k: string) => k.length >= 2 && lowerKeyword.includes(k))) {
            return svc;
        }
    }
    return null;
};