import { findServiceByKeyword, formatPrice, loadServices, loadConfig } from '../utils/helpers';
import { BookingStore } from '../data/booking_store';

export enum Step {
    GREETING = 'greeting',
    COLLECTING_NAME = 'collecting_name',
    COLLECTING_AGE = 'collecting_age',
    COLLECTING_PHONE = 'collecting_phone',
    COLLECTING_DATE = 'collecting_date',
    COLLECTING_TIME = 'collecting_time',
    CONFIRMING = 'confirming'
}

export class MedicalBot {
    private bookingStore = new BookingStore();
    private servicesData = loadServices();
    private configData = loadConfig();
    private sessionStates: Record<string, any> = {};

    processMessage(sessionId: string, text: string): string {
        const now = Date.now();
        if (!this.sessionStates[sessionId]) {
            this.sessionStates[sessionId] = { lastRequest: now, count: 0 };
        }
        const state = this.sessionStates[sessionId];
        if (now - state.lastRequest < 60000) {
            state.count++;
        } else {
            state.count = 0;
            state.lastRequest = now;
        }
        if (state.count > 10) return "Подождите немного, пожалуйста.";

        text = text.trim();
        if (!text) return "Извините, не понял Ваш вопрос.";

        const lowerText = text.toLowerCase();

        if (['нет', 'не хочу', 'отмена', 'стоп', 'хватит'].some((k: string) => lowerText.includes(k))) {
            delete this.sessionStates[sessionId];
            return "Хорошо, завершаю. Если решите записаться — обращайтесь!";
        }
        if (['спасибо', 'благодарю'].some((k: string) => lowerText.includes(k))) {
            delete this.sessionStates[sessionId];
            return "Всегда рады помочь! Здоровья Вам!";
        }

        if (this.servicesData.operator_keywords?.some((k: string) => lowerText.includes(k))) {
            return `Понимаю важность вопроса. Звоните оператору: ${this.configData.clinic.phones[0]}`;
        }

        const doctor = this.servicesData.doctors?.find((d: any) => d.name.toLowerCase().includes(lowerText));
        if (doctor) {
            return `Отличный выбор! ${doctor.name} — ${doctor.specialty}, стаж ${doctor.experience}. Какое исследование хотите пройти?`;
        }

        const service = findServiceByKeyword(this.servicesData.services, text);
        if (service) {
            return this.handleServiceInquiry(service, sessionId);
        }

        if (lowerText.includes('мрт')) {
            const mrtServices = this.servicesData.services.filter((s: any) => s.type === 'mrt');
            let list = mrtServices.map((s: any) => `• ${s.name} — ${formatPrice(s.price)} тг`).join('\n');
            return `У нас есть МРТ:\n${list}\n\nКакое исследование Вас интересует?`;
        }
        if (lowerText.includes('узи')) {
            const uziServices = this.servicesData.services.filter((s: any) => s.type === 'uzi');
            let list = uziServices.map((s: any) => `• ${s.name} — ${formatPrice(s.price)} тг`).join('\n');
            return `У нас есть УЗИ:\n${list}\n\nКакое исследование Вас интересует?`;
        }
        if (lowerText.includes('адрес') || lowerText.includes('где')) {
            return `Мы находимся: ${this.configData.clinic.address}\n${this.configData.clinic.landmarks}`;
        }
        if (lowerText.includes('график') || lowerText.includes('режим')) {
            const h = this.configData.clinic.work_hours;
            return `Работаем ${this.configData.clinic.work_days} с ${h.start} до ${h.end}.`;
        }
        if (lowerText.includes('врач') || lowerText.includes('доктор')) {
            const list = this.servicesData.doctors?.map((d: any) => `• ${d.name} (${d.specialty})`).join('\n') || 'Список врачей недоступен';
            return `👨‍⚕️ Наши специалисты:\n${list}`;
        }

        // Приветствия
        if (['привет', 'здравствуй', 'здравствуйте', 'добрый', 'hello', 'hi', 'хай'].some(k => lowerText.includes(k))) {
            return "Добрый день! 👋 Я бот клиники Nomad Clinic. Могу помочь записаться на МРТ или УЗИ.\n\nНапишите 'мрт' или 'узи' для просмотра услуг.";
        }

        const sessionState = this.getSessionState(sessionId);
        if (sessionState.step !== Step.GREETING) {
            return this.handleBookingFlow(sessionState, text, lowerText);
        }

        if (['да', 'хочу записаться', 'записаться'].some((k: string) => lowerText.includes(k))) {
            sessionState.step = Step.COLLECTING_NAME;
            return "Отлично! Подскажите, пожалуйста, Ваше имя и фамилию.";
        }

        return "Извините, не совсем понял. Я могу помочь с записью на МРТ, УЗИ или рассказать про врачей.";
    }

    private getSessionState(sessionId: string) {
        if (!this.sessionStates[sessionId]) {
            this.sessionStates[sessionId] = {
                step: Step.GREETING,
                patientData: {},
                appointmentData: {}
            };
        }
        return this.sessionStates[sessionId];
    }

    private handleServiceInquiry(service: any, sessionId: string): string {
        let response = `${service.name} стоит ${formatPrice(service.price)} тенге. Исследование занимает ${service.duration}.`;
        
        const complex = this.servicesData.complexes?.find((c: any) => c.service_ids?.includes(service.id));
        if (complex) {
            const original = complex.service_ids.reduce((acc: number, id: string) => {
                const s = this.servicesData.services.find((x: any) => x.id === id);
                return acc + (s?.price || 0);
            }, 0);
            const discounted = Math.round(original * (1 - complex.discount_percent / 100));
            response += `\n\n🎁 Также рекомендуем комплекс "${complex.name}" со скидкой ${complex.discount_percent}% за ${formatPrice(discounted)} тг.`;
        }

        const sessionState = this.getSessionState(sessionId);
        sessionState.appointmentData.service = service.name;
        sessionState.step = Step.COLLECTING_NAME;
        
        return response + "\n\nДля записи подскажите, пожалуйста, Ваше имя и фамилию.";
    }

    private handleBookingFlow(state: any, text: string, lowerText: string): string {
        switch (state.step) {
            case Step.COLLECTING_NAME:
                state.patientData.name = text.trim();
                state.step = Step.COLLECTING_AGE;
                return "Спасибо! Укажите, пожалуйста, Ваш возраст цифрами.";

            case Step.COLLECTING_AGE:
                const age = parseInt(text);
                if (isNaN(age) || age < 0 || age > 120) return "Пожалуйста, укажите корректный возраст (0-120 лет).";
                state.patientData.age = age;
                state.step = Step.COLLECTING_PHONE;
                return "Оставьте, пожалуйста, контактный номер телефона для связи.";

            case Step.COLLECTING_PHONE:
                if (text.replace(/\D/g, '').length < 9) return "Пожалуйста, укажите корректный номер телефона.";
                state.patientData.phone = text.trim();
                state.step = Step.COLLECTING_DATE;
                return "На какой день Вам удобно пройти исследование? (например: сегодня, завтра, 25 января)";

            case Step.COLLECTING_DATE:
                state.appointmentData.date = text.trim();
                const times = this.configData.booking_slots.base_times;
                return `На ${text.trim()} есть время: ${times.slice(0, 5).join(', ')}. Какое Вам подходит?`;

            case Step.COLLECTING_TIME:
                state.appointmentData.time = text.trim();
                state.step = Step.CONFIRMING;
                const details = `👤 ${state.patientData.name}\n📋 ${state.appointmentData.service}\n📅 ${state.appointmentData.date} в ${state.appointmentData.time}\n📞 ${state.patientData.phone}`;
                return `Проверьте данные:\n${details}\n\nНапишите 'да' для подтверждения.`;

            case Step.CONFIRMING:
                if (['да', 'подтверждаю', 'ок', 'yes'].some((k: string) => lowerText.includes(k))) {
                    const success = this.bookingStore.add(
                        state.patientData.name,
                        state.appointmentData.service,
                        state.appointmentData.date,
                        state.appointmentData.time,
                        state.patientData.phone,
                        state.patientData.age
                    );
                    
                    if (success) {
                        delete this.sessionStates[state.sessionId];
                        return "✅ Запись подтверждена! Ожидаем Вас в клинике.";
                    } else {
                        state.step = Step.COLLECTING_DATE;
                        return "К сожалению, это время уже занято. Выберите другое.";
                    }
                } else {
                    state.step = Step.COLLECTING_DATE;
                    return "Хорошо, давайте выберем другую дату.";
                }
        }
        return "Что-то пошло не так. Напишите 'да' для начала записи заново.";
    }
}