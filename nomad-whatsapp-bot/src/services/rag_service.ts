/**
 * RAG Система для Nomad Clinic
 * Полная логика бота + Llama 3.1 8B (Ollama)
 */

import * as fs from 'fs';
import * as path from 'path';
import { sheetsService } from './google_sheets_service';

interface Document {
  id: string;
  content: string;
  metadata: Record<string, any>;
}

interface BookingState {
  step: string;
  patientData: any;
  appointmentData: any;
}

interface BookingRecord {
  id: string;
  patient_name: string;
  phone: string;
  age: number;
  service_name: string;
  date: string;
  time: string;
  created_at: string;
  status: string;
}

interface OllamaResponse {
  response: string;
  done: boolean;
}

export class RAGService {
  private ollamaUrl: string;
  private documents: Document[] = [];
  private loaded: boolean = false;
  private dataDir: string;
  private hasOllama: boolean = false;

  // Состояния бронирования
  private bookingStates: Map<string, BookingState> = new Map();
  private bookings: any[] = [];
  private googleSheetsEnabled: boolean = false;

  constructor(ollamaUrl: string, dataDir: string) {
    this.dataDir = dataDir;
    this.ollamaUrl = (ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
    this.hasOllama = !!ollamaUrl;
    
    // Инициализация Google Sheets
    this.initGoogleSheets();
  }

  private async initGoogleSheets(): Promise<void> {
    const enabled = process.env.GOOGLE_SHEETS_ENABLED === 'true';
    if (enabled) {
      const initialized = await sheetsService.initialize();
      this.googleSheetsEnabled = initialized;
      if (initialized) {
        await sheetsService.createHeaders();
      }
    }
  }

  /**
   * Загрузка документов из JSON файлов
   */
  loadDocuments(): void {
    console.log('\n📚 Загрузка базы знаний...');
    const resolvedDir = path.resolve(this.dataDir);
    
    if (!fs.existsSync(resolvedDir)) {
      console.error(`❌ Папка не найдена: ${resolvedDir}`);
      return;
    }
    
    const files = fs.readdirSync(resolvedDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      try {
        const filePath = path.join(resolvedDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        const text = this.jsonToText(data, file);
        
        this.documents.push({
          id: `doc_${Date.now()}_${file}`,
          content: text,
          metadata: { source: file, type: 'json' }
        });
        
        console.log(`  ✅ ${file} (${text.length} символов)`);
      } catch (error: any) {
        console.error(`  ❌ Ошибка ${file}: ${error.message}`);
      }
    }
    
    console.log(`📄 Загружено: ${this.documents.length} документов\n`);
    this.loaded = true;
  }

  /**
   * Главная функция обработки сообщения
   */
  async processMessage(sessionId: string, text: string): Promise<string> {
    // Проверка: не группа ли это?
    if (!this.isPersonalChat(sessionId)) {
      return ''; // Игнорируем группы
    }
    
    const lowerText = text.toLowerCase().trim();

    // 1. Проверка на отмену/стоп (рус + каз)
    const cancelWords = ['нет', 'не хочу', 'отмена', 'стоп', 'хватит', 'жоқ', 'болмайды', 'қой', 'той', 'ой', 'ойбой'];
    if (cancelWords.some(k => lowerText.includes(k))) {
      this.bookingStates.delete(sessionId);
      return "Хорошо, завершаю. Если решите записаться — обращайтесь!";
    }

    // 2. Проверка на благодарность (рус + каз)
    const thanksWords = ['спасибо', 'благодарю', 'рахмет', 'рақмет', 'көп рахмет', 'спс'];
    if (thanksWords.some(k => lowerText.includes(k))) {
      this.bookingStates.delete(sessionId);
      return "Всегда рады помочь! Здоровья Вам!";
    }

    // 3. Проверка на перевод на оператора
    if (this.shouldTransferToOperator(lowerText)) {
      const config = this.loadConfig();
      const phone = config?.clinic?.phones?.[0] || '+7 777 123 45 67';
      return `Понимаю важность вопроса. Звоните оператору: ${phone}`;
    }

    // 4. Проверка на врача по имени
    const doctor = this.findDoctorByName(lowerText);
    if (doctor) {
      return `Отличный выбор! ${doctor.name} — ${doctor.specialty}, стаж ${doctor.experience}.\n\nКакое исследование хотите пройти? Напишите 'МРТ' или 'УЗИ' для выбора.`;
    }

    // 5. Проверка состояния бронирования
    const bookingState = this.bookingStates.get(sessionId);
    if (bookingState && bookingState.step !== 'greeting') {
      return await this.handleBookingFlow(sessionId, bookingState, text, lowerText);
    }

    // 6. Приветствия (рус + каз + ен)
    const greetingWords = ['привет', 'здравствуй', 'здравствуйте', 'добрый', 'hello', 'hi', 'хай', 'сәлем', 'сәлемет', 'салем', 'қайырлы', 'добр', 'прив', 'хайю', 'йоу'];
    if (greetingWords.some(k => lowerText.includes(k))) {
      return this.getGreetingResponse();
    }

    // 7. Поиск услуги по ключевым словам
    const service = this.findServiceByKeyword(text);
    if (service) {
      return this.handleServiceInquiry(service, sessionId);
    }

    // 8. Запрос списка МРТ
    if (lowerText.includes('мрт')) {
      return this.getMRTList();
    }

    // 9. Запрос списка УЗИ
    if (lowerText.includes('узи')) {
      return this.getUZIList();
    }

    // 10. Запрос КТ
    if (lowerText.includes('кт') || lowerText.includes('мскт') || lowerText.includes('томография')) {
      return this.getCTInfo();
    }

    // 11. Запрос рентгена
    if (lowerText.includes('рентген') || lowerText.includes('xray')) {
      return this.getXrayInfo();
    }

    // 12. Адрес
    if (lowerText.includes('адрес') || lowerText.includes('где') || lowerText.includes('наход') || lowerText.includes('куда')) {
      return this.getAddressInfo();
    }

    // 13. График работы
    if (lowerText.includes('график') || lowerText.includes('режим') || lowerText.includes('час') || lowerText.includes('работ')) {
      return this.getWorkHours();
    }

    // 14. Врачи
    if (lowerText.includes('врач') || lowerText.includes('доктор') || lowerText.includes('специалист')) {
      return this.getDoctorsList();
    }

    // 15. Запись (рус + каз + сленг)
    const confirmWords = ['да', 'хочу записаться', 'записаться', 'хочу', 'согласен', 'ок', 'подтверждаю', 'сгл', 'yes', 'оке', 'окей', 'окк', 'ага', 'угу', 'иә', 'йо', 'ладно', 'давай'];
    if (confirmWords.some(k => lowerText.includes(k))) {
      return this.startBooking(sessionId);
    }

    // 16. Если не поняли - используем Llama
    if (this.hasOllama) {
      return this.queryGemini(text, sessionId);
    }

    return "Извините, не совсем понял. Я могу помочь с записью на МРТ, УЗИ или рассказать про врачей.\n\nНапишите 'мрт' или 'узи' для просмотра услуг.";
  }

  /**
   * Обработка потока бронирования
   */
  private async handleBookingFlow(sessionId: string, state: BookingState, text: string, lowerText: string): Promise<string> {
    switch (state.step) {
      case 'collecting_name':
        state.patientData.name = text.trim();
        state.step = 'collecting_age';
        return "Спасибо! Подскажите, пожалуйста, Ваш возраст цифрами.";

      case 'collecting_age':
        const age = parseInt(text);
        if (isNaN(age) || age < 0 || age > 120) {
          return "Пожалуйста, укажите корректный возраст (0-120 лет).";
        }
        state.patientData.age = age;
        state.step = 'collecting_phone';
        return "Оставьте, пожалуйста, контактный номер телефона для связи.";

      case 'collecting_phone':
        if (text.replace(/\D/g, '').length < 9) {
          return "Пожалуйста, укажите корректный номер телефона.";
        }
        state.patientData.phone = text.trim();
        state.step = 'collecting_date';
        return `На какой день Вам удобно пройти ${state.appointmentData.service}? (например: сегодня, завтра, 25 января)`;

      case 'collecting_date':
        // Проверка: не время ли это ввёл пользователь? (принимает 9:00, 09:00, 9:0, 14:30 и т.д.)
        const timePattern = /^\d{1,2}:\d{2}$/;
        if (timePattern.test(text.trim())) {
          return `⚠️ Это время, а не дата!

Пожалуйста, напишите ДАТУ:
• сегодня
• завтра
• послезавтра
• 25 июня
• 25.06
• 21.06.26

А время выберем потом.`;
        }
        
        // Проверка: короткое слово без цифр — это не дата (кроме известных слов)
        const validDateWords = ['сегодня', 'завтра', 'послезавтра', 'сегодняшня', 'завтрашн', 'бүгін', 'ертең'];
        const hasValidWord = validDateWords.some(w => lowerText.includes(w));
        
        // Разрешаем даты с цифрами (21.06, 21.06.26, 21/06, 21-06)
        const hasDigits = /\d/.test(text);
        const hasDateSeparators = /[.\-\/]/.test(text);
        
        if (!hasValidWord && !hasDigits && text.trim().length < 5) {
          return `📅 Пожалуйста, напишите ДАТУ для записи:

• сегодня
• завтра
• послезавтра
• 25 июня
• 25.06
• бүгін
• ертең`;
        }
        
        // Проверка: только эмодзи или бессмыслица?
        const onlyEmojis = /^[\p{Emoji}\s]+$/u.test(text);
        if (onlyEmojis && text.length < 5) {
          return `📅 Пожалуйста, напишите дату для записи.

Примеры:
• сегодня
• завтра
• 25 июня`;
        }
        
        state.appointmentData.date = text.trim();
        state.step = 'collecting_time';
        
        // Получаем доступные времена
        const times = this.getBookingSlots();
        
        return `✅ Дата: ${text.trim()}\n\n🕐 Выберите время из доступных:\n${times.join(', ')}\n\nИли напишите своё время (например: 14:30).`;

      case 'collecting_time':
        // Проверка: не эмодзи ли?
        const timeOnlyEmojis = /^[\p{Emoji}\s]+$/u.test(text);
        if (timeOnlyEmojis || text.trim().length < 2) {
          const times = this.getBookingSlots();
          return `⏰ Пожалуйста, выберите время:\n\n${times.join(', ')}`;
        }
        
        // Проверка: похоже ли на время? (9:00, 09:00, 9:0, 14:30, 14:3)
        const timeMatch = text.trim().match(/^(\d{1,2}):(\d{2})$/);
        if (timeMatch) {
          const hour = parseInt(timeMatch[1]);
          const minute = parseInt(timeMatch[2]);
          
          // Проверка диапазона
          if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            return `⏰ Некорректное время. Укажите от 00:00 до 23:59.`;
          }
        }
        
        state.appointmentData.time = text.trim();
        state.step = 'confirming';
        
        const details = `👤 ${state.patientData.name}\n📋 ${state.appointmentData.service}\n📅 ${state.appointmentData.date} в ${state.appointmentData.time}\n📞 ${state.patientData.phone}\n🎂 Возраст: ${state.patientData.age}`;
        
        return `Проверьте данные:\n${details}\n\nНапишите 'да' для подтверждения.`;

      case 'confirming':
        if (['да', 'подтверждаю', 'ок', 'yes'].some(k => lowerText.includes(k))) {
          // Сохраняем бронирование
          const bookingId = `BK${Date.now()}`;
          const booking: BookingRecord = {
            id: bookingId,
            patient_name: state.patientData.name,
            phone: state.patientData.phone,
            age: state.patientData.age,
            service_name: state.appointmentData.service,
            date: state.appointmentData.date,
            time: state.appointmentData.time,
            created_at: new Date().toISOString(),
            status: 'confirmed',
          };
          
          this.bookings.push(booking);
          
          // Сохраняем в Google Sheets (если включено)
          if (this.googleSheetsEnabled) {
            await sheetsService.addBooking(booking);
          }
          
          this.bookingStates.delete(sessionId);
          return `✅ Запись подтверждена!\n\n📋 Номер записи: ${bookingId}\n📞 Приходите за 10 минут до записи.\n\nОжидаем Вас в клинике!`;
        } else {
          state.step = 'collecting_date';
          return "Хорошо, давайте выберем другую дату.";
        }
    }

    return "Что-то пошло не так. Напишите 'да' для начала записи заново.";
  }

  /**
   * Проверка: нужно ли переводить на оператора
   */
  private shouldTransferToOperator(text: string): boolean {
    const operatorKeywords = [
      // Русские
      'опухоль', 'онкология', 'рак', 'инсульт', 'конфликт', 
      'жалоба', 'лечение', 'назнач', 'диагноз', 'боль сильно',
      'температура', 'кровь', 'скорая', 'кризис', 'реаним',
      // Казахские
      'ісік', 'қан', 'ауыр', 'емдеу', 'диагноз', 'жедел',
      // Смешанные/сленг
      'ойбой', 'ой бө', 'ауырады'
    ];
    return operatorKeywords.some(k => text.includes(k));
  }

  /**
   * Поиск врача по имени
   */
  private findDoctorByName(text: string): any {
    const services = this.loadServices();
    const doctors = services?.doctors || [];
    return doctors.find((d: any) => d.name.toLowerCase().includes(text));
  }

  /**
   * Поиск услуги по ключевому слову
   */
  private findServiceByKeyword(text: string): any {
    const services = this.loadServices();
    const allServices = services?.services || [];
    
    const textLower = text.toLowerCase();
    
    // 1. Сначала ищем точное совпадение по названию
    for (const service of allServices) {
      if (service.name.toLowerCase() === textLower) {
        return service;
      }
    }
    
    // 2. Ищем по полному вхождению названия в текст
    for (const service of allServices) {
      if (textLower.includes(service.name.toLowerCase())) {
        return service;
      }
    }
    
    // 3. Ищем по ключевым словам с приоритетом типа
    // Определяем тип услуги из запроса
    const isUzi = textLower.includes('узи') || textLower.includes('ультразвук');
    const isMrt = textLower.includes('мрт') || textLower.includes('магнитно');
    const isCt = textLower.includes('кт') || textLower.includes('компьютерная томография');
    const isXray = textLower.includes('рентген') || textLower.includes('xray');
    
    const desiredType = isUzi ? 'uzi' : isMrt ? 'mrt' : isCt ? 'ct' : isXray ? 'xray' : null;
    
    // Сначала ищем в услугах нужного типа
    if (desiredType) {
      for (const service of allServices) {
        if (service.type === desiredType) {
          const keywords = service.keywords || [];
          for (const kw of keywords) {
            if (textLower.includes(kw.toLowerCase())) {
              return service;
            }
          }
          // Проверяем название
          if (textLower.includes(service.name.toLowerCase())) {
            return service;
          }
        }
      }
    }
    
    // 4. Если не нашли по типу — ищем во всех услугах
    for (const service of allServices) {
      const keywords = service.keywords || [];
      for (const kw of keywords) {
        if (textLower.includes(kw.toLowerCase())) {
          return service;
        }
      }
    }
    
    return null;
  }

  /**
   * Обработка запроса услуги
   */
  private handleServiceInquiry(service: any, sessionId: string): string {
    let response = `📋 ${service.name}\n`;
    response += `💰 Цена: ${this.formatPrice(service.price)} тг\n`;
    response += `⏱ Длительность: ${service.duration}\n`;
    
    // Проверка на комплексы
    const servicesData = this.loadServices();
    const complexes = servicesData?.complexes || [];
    const complex = complexes.find((c: any) => c.service_ids?.includes(service.id));
    
    if (complex) {
      const allServicesList = servicesData?.services || [];
      const original = complex.service_ids.reduce((acc: number, id: string) => {
        const s = allServicesList.find((x: any) => x.id === id);
        return acc + (s?.price || 0);
      }, 0);
      const discounted = Math.round(original * (1 - complex.discount_percent / 100));
      response += `\n🎁 Рекомендуем комплекс "${complex.name}" со скидкой ${complex.discount_percent}% за ${this.formatPrice(discounted)} тг.`;
    }
    
    // Начинаем бронирование
    this.startBookingWithService(sessionId, service.name);
    
    return response + "\n\nДля записи напишите 'да' или 'хочу записаться'.";
  }

  /**
   * Список МРТ
   */
  private getMRTList(): string {
    const services = this.loadServices();
    const mrtServices = (services?.services || []).filter((s: any) => s.type === 'mrt');
    
    let list = mrtServices.map((s: any) => 
      `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})`
    ).join('\n');
    
    return `🏥 МРТ исследования:\n\n${list}\n\nКакое исследование Вас интересует?`;
  }

  /**
   * Список УЗИ
   */
  private getUZIList(): string {
    const services = this.loadServices();
    const uziServices = (services?.services || []).filter((s: any) => s.type === 'uzi');
    
    let list = uziServices.map((s: any) => 
      `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})`
    ).join('\n');
    
    return `🏥 УЗИ исследования:\n\n${list}\n\nКакое исследование Вас интересует?`;
  }

  /**
   * Информация о КТ
   */
  private getCTInfo(): string {
    const services = this.loadServices();
    const ctService = (services?.services || []).find((s: any) => s.type === 'ct');
    
    if (ctService) {
      return `🏥 Компьютерная томография (КТ / МСКТ)\n💰 Цена: ${this.formatPrice(ctService.price)} тг\n⏱ Длительность: ${ctService.duration}\n\nНапишите 'хочу записаться' для записи.`;
    }
    
    return "КТ недоступен. Позвоните: +7 777 123 45 67";
  }

  /**
   * Информация о рентгене
   */
  private getXrayInfo(): string {
    const services = this.loadServices();
    const xrayService = (services?.services || []).find((s: any) => s.type === 'xray');
    
    if (xrayService) {
      return `🏥 Рентгенография (X-ray)\n💰 Цена: ${this.formatPrice(xrayService.price)} тг\n⏱ Длительность: ${xrayService.duration}\n\nНапишите 'хочу записаться' для записи.`;
    }
    
    return "Рентген недоступен. Позвоните: +7 777 123 45 67";
  }

  /**
   * Адрес
   */
  private getAddressInfo(): string {
    const config = this.loadConfig();
    const clinic = config?.clinic || {};
    
    return `📍 Наш адрес:\n${clinic.address}\n${clinic.landmarks || ''}\n\n📞 Телефон: ${clinic.phones?.[0] || '+7 777 123 45 67'}`;
  }

  /**
   * График работы
   */
  private getWorkHours(): string {
    const config = this.loadConfig();
    const clinic = config?.clinic || {};
    const hours = clinic.work_hours || {};
    
    return `🕐 График работы:\n📅 ${clinic.work_days || 'Пн-Сб'}\n⏰ ${hours.start || '08:00'} - ${hours.end || '20:00'}`;
  }

  /**
   * Список врачей
   */
  private getDoctorsList(): string {
    const services = this.loadServices();
    const doctors = services?.doctors || [];
    
    let list = doctors.map((d: any) => 
      `• ${d.name}\n  👨‍⚕️ ${d.specialty} (стаж ${d.experience})`
    ).join('\n\n');
    
    return `👨‍⚕️ Наши специалисты:\n\n${list}`;
  }

  /**
   * Приветствие
   */
  private getGreetingResponse(): string {
    return `Добрый день! 👋 Я бот клиники Nomad Clinic.\n\nМогу помочь:\n• Записаться на МРТ, УЗИ, КТ\n• Узнать цены и наличие\n• Рассказать про врачей\n• Найти адрес и график\n\nНапишите 'мрт' или 'узи' для просмотра услуг.`;
  }

  /**
   * Начало бронирования
   */
  private startBooking(sessionId: string): string {
    const state: BookingState = {
      step: 'collecting_name',
      patientData: {},
      appointmentData: { service: 'Не указано' }
    };
    
    this.bookingStates.set(sessionId, state);
    return "Отлично! Подскажите, пожалуйста, Ваше имя и фамилию.";
  }

  /**
   * Начало бронирования с услугой
   */
  private startBookingWithService(sessionId: string, serviceName: string): void {
    const state: BookingState = {
      step: 'collecting_name',
      patientData: {},
      appointmentData: { service: serviceName }
    };
    
    this.bookingStates.set(sessionId, state);
  }

  /**
   * Запрос к Llama 3.1 8B (если RAG не нашёл ответ)
   */
  private async queryGemini(query: string, sessionId: string): Promise<string> {
    if (!this.hasOllama) {
      return "Извините, я не нашел информацию. Позвоните: +7 777 123 45 67";
    }
    
    try {
      // Получаем контекст из документов
      const context = this.buildContext(query);
      
      // Получаем историю чата
      const history = this.getChatHistory(sessionId);
      const historyText = history.length > 0 
        ? `\n📜 ПРЕДЫДУЩИЙ ДИАЛОГ:\n${history.map(h => `${h.role === 'user' ? '👤' : '🤖'} ${h.content}`).join('\n')}`
        : '';
      
      const prompt = `Ты - профессиональный ассистент медицинского центра "Nomad Clinic" в Астане.

📋 ДОСТУПНАЯ ИНФОРМАЦИЯ:
${context}

${historyText}

❓ ВОПРОС: ${query}

📝 ПРАВИЛА:
1. Отвечай ТОЛЬКО на основе информации выше
2. Если информации нет - предложи позвонить: +7 777 123 45 67
3. Отвечай на русском языке
4. Будь вежливым, используй эмодзи
5. Если вопрос о записи - предложи помощь
6. НЕ ВЫДУМЫВАЙ!

💬 ОТВЕТ:`;

      const response = await this.ollamaChat(prompt);
      
      // Сохраняем в историю
      this.saveToHistory(sessionId, query, response);
      
      return response;
      
    } catch (error: any) {
      console.error('❌ Ошибка Llama:', error.message);
      return "Извините, временно недоступен. Позвоните: +7 777 123 45 67";
    }
  }

  /**
   * Запрос к Ollama (Llama 3.1 8B)
   */
  private async ollamaChat(prompt: string): Promise<string> {
    const response = await fetch(`${this.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.1:8b',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 512
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data: OllamaResponse = await response.json();
    return data.response;
  }

  /**
   * Построение контекста из документов
   */
  private buildContext(query: string): string {
    const queryLower = query.toLowerCase();
    let context = '';
    
    for (const doc of this.documents) {
      const contentLower = doc.content.toLowerCase();
      let score = 0;
      const words = queryLower.split(/\s+/);
      
      for (const word of words) {
        if (word.length < 2) continue;
        if (contentLower.includes(word)) {
          score += 2;
        }
      }
      
      if (score > 0) {
        context += `\n[${doc.metadata.source}]:\n${doc.content}`;
      }
    }
    
    return context || 'Нет доступной информации.';
  }

  /**
   * История чата (простая)
   */
  private chatHistories: Map<string, any[]> = new Map();
  
  private saveToHistory(sessionId: string, question: string, answer: string): void {
    if (!this.chatHistories.has(sessionId)) {
      this.chatHistories.set(sessionId, []);
    }
    const history = this.chatHistories.get(sessionId)!;
    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: answer });
    
    // Последние 10 сообщений
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }
  }

  private getChatHistory(sessionId: string): any[] {
    return this.chatHistories.get(sessionId) || [];
  }

  /**
   * Проверка: это личная переписка (не группа)?
   */
  private isPersonalChat(sessionId: string): boolean {
    // Игнорируем только группы (@g.us)
    return !sessionId.includes('@g.us');
  }

  // ==================== Вспомогательные методы ====================

  private loadServices(): any {
    try {
      const servicesPath = path.resolve(this.dataDir, 'services.json');
      return JSON.parse(fs.readFileSync(servicesPath, 'utf-8'));
    } catch {
      return {};
    }
  }

  private loadConfig(): any {
    try {
      const configPath = path.resolve(this.dataDir, 'config.json');
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      return {};
    }
  }

  private getBookingSlots(): string[] {
    try {
      const config = this.loadConfig();
      return config?.booking_slots?.base_times || ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
    } catch {
      return ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
    }
  }

  private formatPrice(price: number): string {
    return new Intl.NumberFormat('ru-RU').format(price);
  }

  private jsonToText(data: any, filename: string): string {
    let text = `=== ${filename} ===\n\n`;
    
    const process = (obj: any, indent: string = ''): void => {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'object' && !Array.isArray(value)) {
          text += `${indent}${key}:\n`;
          process(value, indent + '  ');
        } else if (Array.isArray(value)) {
          text += `${indent}${key}:\n`;
          value.forEach((item: any, idx: number) => {
            if (typeof item === 'object') {
              text += `${indent}  ${idx + 1}.\n`;
              process(item, indent + '    ');
            } else {
              text += `${indent}  - ${item}\n`;
            }
          });
        } else {
          text += `${indent}${key}: ${value}\n`;
        }
      }
    };
    
    process(data);
    return text;
  }
}
