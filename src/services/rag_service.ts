/**
 * RAG Система для Nomad Clinic
 * Полная логика бота + Llama 3.1 8B (Ollama)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getSheetsService } from './google_sheets_service';
import { calendarService } from './google_calendar_service';
import { BookingStore as SharedBookingStore } from '../data/booking_store';

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

// Глобальное хранилище бронирований (общее с Python ботом)
let bookingStore: SharedBookingStore | null = null;

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
  private googleCalendarEnabled: boolean = false;
  
  // Язык пользователя (определяется по первому сообщению)
  private sessionLanguages: Map<string, 'ru' | 'kz'> = new Map();

  constructor(ollamaUrl: string, dataDir: string) {
    this.dataDir = dataDir;
    this.ollamaUrl = (ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
    this.hasOllama = !!ollamaUrl;
    
    // Инициализация Google сервисов (асинхронно, не блокируем конструктор)
    setImmediate(() => this.initGoogleServices());
    
    // Инициализация общего хранилища бронирований
    try {
      bookingStore = new SharedBookingStore();
      console.log('📅 BookingStore инициализирован (общий с Python ботом)');
    } catch (e) {
      console.log('⚠️ BookingStore не инициализирован:', e);
    }
  }

  private async initGoogleServices(): Promise<void> {
    // Google Shрeets
    const sheetsEnabled = process.env.GOOGLE_SHEETS_ENABLED === 'true';
    if (sheetsEnabled) {
      const initialized = await getSheetsService().initialize();
      this.googleSheetsEnabled = initialized;
      if (initialized) {
        await getSheetsService().createHeaders();
      }
    }
    
    // Google Calendar
    const calendarEnabled = process.env.GOOGLE_CALENDAR_ENABLED === 'true';
    if (calendarEnabled) {
      const initialized = await calendarService.initialize();
      this.googleCalendarEnabled = initialized;
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
   * Удалить все записи из Google Sheets (для сброса)
   */
  async clearAllBookings(): Promise<boolean> {
    try {
      const svc = getSheetsService();
      if (!svc.initialized) {
        await svc.initialize();
      }
      if (!svc.spreadsheetId) {
        console.log('⚠️ Google Sheets не настроен');
        return false;
      }
      
      // Получаем все данные
      const response = await svc.sheets.spreadsheets.values.get({
        spreadsheetId: svc.spreadsheetId,
        range: `${svc.sheetName}!A:I`,
      });
      
      const rows = response.data.values;
      if (!rows || rows.length <= 1) {
        console.log('✅ Записей нет, очищать нечего');
        return true;
      }
      
      // Удаляем всё кроме заголовка (строка 2 и далее)
      const lastRow = rows.length;
      await svc.sheets.spreadsheets.values.clear({
        spreadsheetId: svc.spreadsheetId,
        range: `${svc.sheetName}!A2:I${lastRow}`,
      });
      
      console.log(`🗑️ Удалено ${lastRow - 1} записей из Google Sheets`);
      return true;
    } catch (error: any) {
      console.error(`❌ Ошибка очистки: ${error.message}`);
      return false;
    }
  }

  /**
   * Определение языка текста (казахский или русский)
   */
  private detectLanguage(text: string): 'ru' | 'kz' {
    const lower = text.toLowerCase().trim();
    const tokens = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    
    // Казахские буквы (приоритет)
    const kazakhLetters = /[әғіңөұүқ]/gi;
    const kazakhLetterCount = (text.match(kazakhLetters) || []).length;
    
    if (kazakhLetterCount > 0) {
      return 'kz';
    }
    
    // Казахские слова и фразы
    const kazakhWords = [
      'сәлем', 'сәлемет', 'салем', 'қайырлы', 'қалай', 'рахмет', 'рақмет',
      'иә', 'жоқ', 'болады', 'болмайды', 'керек', 'қажет', 'бүгін', 'ертең',
      'дәрігер', 'емхана', 'денсаулық', 'көмек', 'қызмет', 'уақыт', 'жұмыс',
      'мекен', 'байланыс', 'тіркеу', 'қазақша', 'орысша'
    ];
    
    const hasKazakhWord = kazakhWords.some(word => tokens.includes(word));
    
    if (hasKazakhWord) {
      return 'kz';
    }
    
    // Русские буквы и слова
    const russianLetters = /[ёйцчшщъьэюя]/gi;
    const russianLetterCount = (text.match(russianLetters) || []).length;
    
    const russianWords = [
      'привет', 'здравствуйте', 'здравствуй', 'добрый', 'спасибо', 'благодарю',
      'нет', 'да', 'давай', 'хорошо', 'ок', 'понял', 'понимаю', 'узнаю',
      'мрт', 'узи', 'кт', 'рентген', 'врач', 'доктор', 'клиника', 'больница',
      'диагноз', 'болезнь', 'лечение', 'операция', 'анализ', 'лекарство',
      'цена', 'стоимость', 'деньги', 'рубль', 'тенге', 'тенге',
      'адрес', 'улица', 'дом', 'город', 'страна',
      'телефон', 'почта', 'email', 'сайт', 'интернет',
      'время', 'час', 'минута', 'секунда', 'день', 'неделя', 'месяц', 'год',
      'записаться', 'запись', 'записываю', 'записывает',
      'помогите', 'помощь', 'помогаю', 'помогает',
    ];
    
    const hasRussianWord = russianWords.some(word => tokens.includes(word));
    
    if (hasRussianWord && russianLetterCount > 0) {
      return 'ru';
    }
    
    // По умолчанию русский, если нет явных признаков казахского
    return 'ru';
  }

  private getLanguageSwitchCommand(lowerText: string): 'ru' | 'kz' | null {
    if (
      lowerText === '/lang kz' ||
      lowerText === '/til kz' ||
      lowerText === 'kazakh' ||
      lowerText === 'қазақша' ||
      lowerText === 'қазақ тілінде' ||
      lowerText === 'қазақшала'
    ) {
      return 'kz';
    }

    if (
      lowerText === '/lang ru' ||
      lowerText === '/til ru' ||
      lowerText === 'russian' ||
      lowerText === 'орысша' ||
      lowerText === 'орыс тілінде' ||
      lowerText === 'орысшала'
    ) {
      return 'ru';
    }

    return null;
  }

  private isExplicitBookingRequest(lowerText: string): boolean {
    const exactStartWords = ['да', 'иә', 'yes', 'ок', 'окей', 'оке', 'хочу', 'записаться'];
    if (exactStartWords.includes(lowerText)) {
      return true;
    }

    const phrases = ['хочу записаться', 'нужна запись', 'нужно записаться', 'жазылғым келеді', 'жазылу'];
    return phrases.some(phrase => lowerText.includes(phrase));
  }

  /**
   * Переключение языка сессии
   */
  private switchLanguage(sessionId: string, lang: 'ru' | 'kz'): boolean {
    this.sessionLanguages.set(sessionId, lang);
    return true;
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
    const existingLang = this.sessionLanguages.get(sessionId);
    const switchCommand = this.getLanguageSwitchCommand(lowerText);

    let language: 'ru' | 'kz';
    if (switchCommand) {
      language = switchCommand;
      this.sessionLanguages.set(sessionId, switchCommand);
    } else if (existingLang) {
      language = existingLang;
    } else {
      language = this.detectLanguage(text);
      this.sessionLanguages.set(sessionId, language);
    }
    
    // Команда переключения языка
    if (switchCommand === 'kz') {
      return "✅ Тіл орыс тілінен қазақ тіліне ауыстырылды. Сізге қалай көмектесе аламын?";
    }
    if (switchCommand === 'ru') {
      return "✅ Язык изменён на русский. Чем я могу вам помочь?";
    }
    
    // Команда очистки записей (только для админа)
    if (lowerText === '/clear' || lowerText === 'очисти записи' || lowerText === 'удалить все записи') {
      await this.clearAllBookings();
      // Очищаем локальные bookings
      this.bookingStates.clear();
      // Очищаем общее хранилище
      if (bookingStore) {
        bookingStore.clear();
      }
      return language === 'kz' 
        ? '🗑️ Барлық жазулар өшірілді. Қайтадан тексере аласыз.'
        : '🗑️ Все записи удалены. Можно тестировать заново.';
    }

    // 1. Проверка состояния бронирования (ПЕРЕД всем!)
    const bookingState = this.bookingStates.get(sessionId);
    if (bookingState && bookingState.step !== 'greeting') {
      return await this.handleBookingFlow(sessionId, bookingState, text, lowerText);
    }

    // Явный запрос на старт записи, даже без служебных ключевых слов
    if (this.isExplicitBookingRequest(lowerText)) {
      return this.startBooking(sessionId);
    }

    // Универсальная обработка отмены и благодарности, даже вне сценария записи
    const globalCancelWords = ['нет', 'не хочу', 'отмена', 'стоп', 'хватит', 'жоқ', 'болмайды', 'қой', 'той', 'ойбой'];
    if (globalCancelWords.some(k => lowerText.includes(k))) {
      this.bookingStates.delete(sessionId);
      return language === 'kz'
        ? "Жақсы, тоқтаймын. Егер тіркелгіңіз келсе — байланысыңыз!"
        : "Хорошо, завершаю. Если решите записаться — обращайтесь!";
    }

    const globalThanksWords = ['спасибо', 'благодарю', 'рахмет', 'рақмет', 'көп рахмет', 'спс'];
    if (globalThanksWords.some(k => lowerText.includes(k))) {
      this.bookingStates.delete(sessionId);
      return language === 'kz'
        ? "Әрқашан көмектесуге қуаныштымыз! Денсаулығыңызды сақтаңыз!"
        : "Всегда рады помочь! Здоровья Вам!";
    }

    // 2. Проверяем, содержит ли текст ключевые слова для конкретных запросов
    const serviceKeywords = ['мрт', 'узи', 'кт', 'рентген', 'мскт', 'томография', 'адрес', 'где', 'наход', 'куда', 'орналас', 'мекен', 'контакт', 'контакты', 'телефон', 'номер', 'whatsapp', 'график', 'режим', 'час', 'работ', 'уақыт', 'жұмыс', 'врач', 'доктор', 'специалист', 'дәрігер', 'мамандар', 'записаться', 'хочу записаться', 'все услуги', 'каталог', 'перечень', 'қызметтер', 'барлық', 'шея', 'шейн', 'голова', 'голов', 'грудь', 'грудн', 'поясн', 'пояс', 'спин', 'позвоночн', 'колени', 'колен', 'плечи', 'плеч', 'руки', 'рука', 'ноги', 'ног', 'таз', 'тазов', 'стоп', 'сустав', 'позвоночн', 'орган', 'мойын', 'бас', 'кеуде', 'бел', 'тізе', 'иық', 'қол', 'аяқ', 'жамбас', 'табан', 'буын', 'омыртқа', 'опухоль', 'онкология', 'рак', 'инсульт', 'жалоба', 'лечение', 'диагноз', 'температура', 'кровь', 'скорая', 'спасибо', 'благодарю', 'рахмет', 'рақмет', 'көп рахмет', 'спс', 'жоқ', 'болмайды', 'цены', 'цена', 'прайс', 'стоим', 'услуг', 'виды', 'какие услуги', 'что делаете', 'что предлагаете', 'какие исследования', 'узнать цены', 'узнать наличие', 'какой прайс', 'прайс лист'];
    const hasServiceKeyword = serviceKeywords.some(kw => lowerText.includes(kw));
    
    // 3. Если текст содержит ключевые слова - обрабатываем как обычно
    if (hasServiceKeyword) {
      // Проверка на отмену/стоп
      const cancelWords = ['нет', 'не хочу', 'отмена', 'стоп', 'хватит', 'жоқ', 'болмайды', 'қой', 'той', 'ойбой'];
      if (cancelWords.some(k => lowerText.includes(k))) {
        this.bookingStates.delete(sessionId);
        return language === 'kz'
          ? "Жақсы, тоқтаймын. Егер тіркелгіңіз келсе — байланысыңыз!"
          : "Хорошо, завершаю. Если решите записаться — обращайтесь!";
      }

      // Проверка на благодарность
      const thanksWords = ['спасибо', 'благодарю', 'рахмет', 'рақмет', 'көп рахмет', 'спс'];
      if (thanksWords.some(k => lowerText.includes(k))) {
        this.bookingStates.delete(sessionId);
        return language === 'kz'
          ? "Әрқашан көмектесуге қуаныштымыз! Денсаулығыңызды сақтаңыз!"
          : "Всегда рады помочь! Здоровья Вам!";
      }

      // Проверка на перевод на оператора
      if (this.shouldTransferToOperator(lowerText)) {
        const config = this.loadConfig();
        const phone = config?.clinic?.phones?.[0] || '+7 777 123 45 67';
        return language === 'kz'
          ? `Сұрақтыңыздың маңыздылығын түсінемін. Операторға хабарласыңыз: ${phone}`
          : `Понимаю важность вопроса. Звоните оператору: ${phone}`;
      }

      // Проверка на врача по имени
      if (text.trim().length >= 2) {
        const doctor = this.findDoctorByName(lowerText);
        if (doctor) {
          return language === 'kz'
            ? `Тамаша таңдау! ${doctor.name} — ${doctor.specialty}, тәжірибесі ${doctor.experience} жыл.\n\nҚандай зерттеу жасатқыңыз келеді? 'МРТ' немесе 'УЗИ' деп жазыңыз.`
            : `Отличный выбор! ${doctor.name} — ${doctor.specialty}, стаж ${doctor.experience}.\n\nКакое исследование хотите пройти? Напишите 'МРТ' или 'УЗИ' для выбора.`;
        }
      }
        
      // Приветствия
      const greetingWords = ['привет', 'здравствуй', 'здравствуйте', 'добрый', 'hello', 'hi', 'хай', 'сәлем', 'сәлемет', 'салем', 'қайырлы', 'добр', 'прив', 'хайю', 'йоу', 'дөбр', 'сәл', 'қайыр'];
      if (greetingWords.some(k => lowerText.includes(k))) {
        return this.getGreetingResponse(sessionId);
      }

      // Полный каталог услуг (цены и наличие)
      if (lowerText.includes('все услуги') || lowerText.includes('каталог') || lowerText.includes('перечень') || lowerText.includes('қызметтер') || lowerText.includes('барлық') ||
          lowerText.includes('цены') || lowerText.includes('цена') || lowerText.includes('прайс') || lowerText.includes('стоим') || lowerText.includes('услуг') ||
          lowerText.includes('виды') || lowerText.includes('какие услуги') || lowerText.includes('что делаете') || lowerText.includes('что предлагаете') ||
          lowerText.includes('какие исследования') || lowerText.includes('узнать цены') || lowerText.includes('узнать наличие') || lowerText.includes('какой прайс') || lowerText.includes('прайс лист')) {
        return this.getAllServicesList(sessionId);
      }

      // Поиск по области тела
      const bodyPartService = this.findServiceByBodyPart(text, sessionId);
      if (bodyPartService) {
        return bodyPartService;
      }

      // Поиск услуги по ключевым словам
      const service = this.findServiceByKeyword(text);
      if (service) {
        return this.handleServiceInquiry(service, sessionId);
      }

      // Запрос списка МРТ (если пользователь написал только "мрт" без уточнений)
      if (lowerText.includes('мрт') && !lowerText.includes('шея') && !lowerText.includes('пояс') && !lowerText.includes('голов') && !lowerText.includes('груд') && !lowerText.includes('живот')) {
        return this.getMRTList(sessionId);
      }

      // Запрос списка УЗИ (если пользователь написал только "узи" без уточнений)
      if (lowerText.includes('узи') && !lowerText.includes('щитовид') && !lowerText.includes('сосуд') && !lowerText.includes('живот') && !lowerText.includes('почки')) {
        return this.getUZIList(sessionId);
      }

      // Запрос КТ
      if (lowerText.includes('кт') || lowerText.includes('мскт') || lowerText.includes('томография')) {
        return this.getCTInfo(sessionId);
      }

      // Запрос рентгена
      if (lowerText.includes('рентген') || lowerText.includes('xray')) {
        return this.getXrayInfo(sessionId);
      }

      // Адрес
      if (lowerText.includes('адрес') || lowerText.includes('где') || lowerText.includes('наход') || lowerText.includes('куда') || lowerText.includes('орналас') || lowerText.includes('мекен') || lowerText.includes('контакт') || lowerText.includes('телефон') || lowerText.includes('номер') || lowerText.includes('whatsapp')) {
        return this.getAddressInfo(sessionId);
      }

      // График работы
      if (lowerText.includes('график') || lowerText.includes('режим') || lowerText.includes('час') || lowerText.includes('работ') || lowerText.includes('уақыт') || lowerText.includes('жұмыс')) {
        return this.getWorkHours(sessionId);
      }

      // Врачи
      if (lowerText.includes('врач') || lowerText.includes('доктор') || lowerText.includes('специалист') || lowerText.includes('дәрігер') || lowerText.includes('мамандар')) {
        return this.getDoctorsList(sessionId);
      }

      // Запись
      const confirmWords = ['да', 'хочу записаться', 'записаться', 'хочу', 'согласен', 'ок', 'подтверждаю', 'yes', 'оке', 'окей', 'окк', 'ага', 'угу', 'иә', 'ладно', 'давай', 'жазылу'];
      if (confirmWords.some(k => lowerText.includes(k))) {
        return this.startBooking(sessionId);
      }

      // Если не поняли - используем Llama
      if (this.hasOllama) {
        try {
          return await this.queryGemini(text, sessionId);
        } catch (e) {
          console.error('LLM error, using fallback:', e);
        }
      }

      const lang = language;
      return lang === 'kz'
        ? "Кешіріңіз, толық түсінбедім. Мен МРТ, УЗИ-ға жазылуға немесе дәрігерлер туралы айтуға көмектесе аламын.\n\nҚызметтерді көру үшін 'мрт' немесе 'узи' деп жазыңыз."
        : "Извините, не совсем понял. Я могу помочь с записью на МРТ, УЗИ или рассказать про врачей.\n\nНапишите 'мрт' или 'узи' для просмотра услуг.";
    }
    
    // 4. Если текст НЕ содержит ключевых слов - ВСЕГДА отвечаем приветствием!
    return this.getGreetingResponse(sessionId);
  }

  /**
   * Обработка потока бронирования
   */
  private async handleBookingFlow(sessionId: string, state: BookingState, text: string, lowerText: string): Promise<string> {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    
    // Проверка: не эмодзи ли время в состоянии collecting_time?
    if (state.step === 'collecting_time') {
      const timeOnlyEmojis = /^[\p{Emoji}\s]+$/u.test(text);
      if (timeOnlyEmojis || text.trim().length < 2) {
        const times = await this.getBookingSlots(this.parseSavedDate(state.appointmentData.date));
        const msg = lang === 'kz' 
          ? `⏰ Уақытты таңдаңыз:\n\n${times.join(', ')}`
          : `⏰ Пожалуйста, выберите время:\n\n${times.join(', ')}`;
        return msg;
      }
    }
    
    switch (state.step) {
      case 'selecting_service': {
        const candidates: any[] = state.appointmentData?.matchingServices || [];

        // Выбор по номеру (пользователь написал "3")
        const numSel = parseInt(lowerText.trim());
        if (!isNaN(numSel) && numSel >= 1 && numSel <= candidates.length) {
          const picked = candidates[numSel - 1];
          this.bookingStates.set(sessionId, {
            step: 'waiting_confirmation',
            patientData: {},
            appointmentData: { service: picked.name }
          });
          let response = `📋 ${picked.name}\n`;
          response += `💰 ${lang === 'kz' ? 'Бағасы' : 'Цена'}: ${this.formatPrice(picked.price)} тг\n`;
          response += `⏱ ${lang === 'kz' ? 'Ұзақтығы' : 'Длительность'}: ${picked.duration}\n`;
          if (picked.preparation) {
            response += `📝 ${lang === 'kz' ? 'Дайындық' : 'Подготовка'}: ${picked.preparation}\n`;
          }
          return response + (lang === 'kz'
            ? "\n\nЖазылу үшін 'иә' немесе 'жазылу' деп жазыңыз."
            : "\n\nДля записи напишите 'да' или 'хочу записаться'.");
        }

        // Если пользователь говорит "да/иә" — авто-выбор единственного кандидата
        const confirmSel = ['да', 'иә', 'yes', 'ок', 'окей', 'хочу', 'записаться', 'жазылу', 'ладно', 'давай'];
        if (confirmSel.some(k => lowerText === k || lowerText.includes(k))) {
          if (candidates.length === 1) {
            this.bookingStates.set(sessionId, {
              step: 'collecting_name',
              patientData: {},
              appointmentData: { service: candidates[0].name }
            });
            return lang === 'kz'
              ? `✅ ${candidates[0].name} таңдалды.\n\nТолық атыңызды жазыңыз.`
              : `✅ Выбрано: ${candidates[0].name}.\n\nПодскажите Ваше имя и фамилию.`;
          } else if (candidates.length > 1) {
            const list = candidates.map((s: any, i: number) => `${i+1}. ${s.name}`).join('\n');
            return lang === 'kz'
              ? `Қайсысын таңдайсыз? Нөмірін жазыңыз:\n${list}`
              : `Какое именно? Напишите номер:\n${list}`;
          }
        }
        // Пользователь выбирает услугу из списка по тексту
        const selectionResult = this.handleServiceSelection(sessionId, text, lowerText);
        if (selectionResult) {
          return selectionResult;
        }
        // Если не нашли - показываем список снова
        return lang === 'kz'
          ? `"${text}" табылмады. Жоғарыдағы тізімнен нақты атауын немесе нөмірін жазыңыз.`
          : `Не распознал "${text}". Напишите точное название или номер из списка выше.`;
      }

      case 'waiting_confirmation':
        // Пользователь подтверждает запись после выбора услуги
        const confirmWords = ['да', 'хочу записаться', 'записаться', 'хочу', 'согласен', 'ок', 'подтверждаю', 'сгл', 'yes', 'оке', 'окей', 'окк', 'ага', 'угу', 'иә', 'йо', 'ладно', 'давай'];
        if (confirmWords.some(k => lowerText.includes(k))) {
          state.step = 'collecting_name';
          return lang === 'kz'
            ? "Тамаша! Алдымен, толық атыңызды жазыңыз."
            : "Отлично! Подскажите, пожалуйста, Ваше имя и фамилию.";
        } else {
          // Если не подтверждает - сбрасываем состояние
          this.bookingStates.delete(sessionId);
          return lang === 'kz'
            ? "Жақсы! Егер тіркелгіңіз келсе — байланысыңыз."
            : "Хорошо! Если решите записаться — обращайтесь.";
        }
        
      case 'collecting_name':
        // Проверка: не короткое ли это слово (например "да", "ок" и т.д.)
        if (text.trim().length < 3 || ['да', 'ок', 'yes', 'ага', 'угу', 'иә'].includes(lowerText.trim())) {
          return lang === 'kz'
            ? "Толық атыңызды жазыңыз (мысалы: Иван Иванов)."
            : "Пожалуйста, напишите Ваше полное имя (например: Иван Иванов).";
        }
        state.patientData.name = text.trim();
        state.step = 'collecting_age';
        return lang === 'kz'
          ? "Рахмет! Енді жасыңызды цифрмен жазыңыз."
          : "Спасибо! Подскажите, пожалуйста, Ваш возраст цифрами.";

      case 'collecting_age':
        const age = parseInt(text);
        if (isNaN(age) || age < 0 || age > 120) {
          return lang === 'kz'
            ? "Дұрыс жасты көрсетіңіз (0-120 жас)."
            : "Пожалуйста, укажите корректный возраст (0-120 лет).";
        }
        state.patientData.age = age;
        state.step = 'collecting_phone';
        return lang === 'kz'
          ? "Байланыс үшін телефон нөміріңізді жазыңыз."
          : "Оставьте, пожалуйста, контактный номер телефона для связи.";

      case 'collecting_phone':
        const phoneValidation = this.validatePhone(text);
        if (!phoneValidation.valid) {
          return lang === 'kz'
            ? "Телефон нөмірі дұрыс емес. Формат: +7 немесе 8, оператор коды және 7 цифр.\nМысал: +7 777 123 45 67"
            : "Неверный номер. Формат: +7 или 8, код оператора и 7 цифр.\nПример: +7 777 123 45 67";
        }
        state.patientData.phone = text.trim();
        state.step = 'collecting_date';
        const serviceName = state.appointmentData.service || (lang === 'kz' ? "зерттеу" : "исследование");
        return lang === 'kz'
          ? `Қай күні ${serviceName} жасатқыңыз келеді? (мысалы: бүгін, ертең, 25.06)`
          : `На какой день Вам удобно пройти ${serviceName}? (например: сегодня, завтра, 25.06)`;

      case 'collecting_date':
        // Проверка: не время ли это ввёл пользователь?
        const timePattern = /^\d{1,2}:\d{2}$/;
        if (timePattern.test(text.trim())) {
          return lang === 'kz'
            ? `⚠️ Бұл уақыт, ал күн емес!\n\nКүн жазыңыз:\n• бүгін\n• ертең\n• 25.06\n• 25 маусым`
            : `⚠️ Это время, а не дата!\n\nПожалуйста, напишите ДАТУ:\n• сегодня\n• завтра\n• послезавтра\n• 25.06\n• 25 июня`;
        }
        
        // Проверка: только эмодзи?
        const onlyEmojis = /^[\p{Emoji}\s]+$/u.test(text);
        if (onlyEmojis && text.length < 5) {
          return lang === 'kz'
            ? `📅 Күн жазыңыз:\n\nМысалдар:\n• бүгін\n• ертең\n• 25.06`
            : `📅 Пожалуйста, напишите дату для записи.\n\nПримеры:\n• сегодня\n• завтра\n• 25.06`;
        }
        
        // Проверяем формат даты
        const lower = text.toLowerCase().trim();
        const validDateWords = ['сегодня', 'завтра', 'послезавтра', 'бүгін', 'ертең'];
        const hasValidWord = validDateWords.some(w => lower.includes(w));
        const hasDigits = /\d/.test(text);
        
        if (!hasValidWord && !hasDigits) {
          return lang === 'kz'
            ? `📅 Күн жазыңыз:\n• бүгін\n• ертең\n• 25.06\n• 25 маусым`
            : `📅 Пожалуйста, напишите дату:\n• сегодня\n• завтра\n• послезавтра\n• 25.06\n• 25 июня`;
        }
        
        // ВАЛИДАЦИЯ: проверяем корректность
        const dateValidation = this.validateDate(text.trim());
        if (!dateValidation.valid) {
          return lang === 'kz'
            ? `⚠️ ${dateValidation.error}\n\nДұрыс күн енгізіңіз:\n• бүгін\n• ертең\n• 25.06`
            : `⚠️ ${dateValidation.error}\n\nПожалуйста, введите корректную дату:\n• сегодня\n• завтра\n• 25.06`;
        }
        
        // ИСПРАВЛЕНИЕ: сохраняем конкретную дату (YYYY-MM-DD), а не "сегодня"/"завтра"
        const resolved = this.resolveDate(text.trim());
        state.appointmentData.date = resolved.date.toISOString().split('T')[0]; // YYYY-MM-DD
        state.appointmentData.dateDisplay = resolved.dateLabel; // для показа пользователю
        state.step = 'collecting_time';
        
        // Получаем доступные времена
        const times = await this.getBookingSlots(resolved.date);
        
        const dateLabel = resolved.isPast 
          ? (lang === 'kz' ? '⚠️ Бұл күн өтіп кетті!' : '⚠️ Эта дата уже прошла!')
          : resolved.dateLabel;
        
        return lang === 'kz'
          ? `📅 Күн: ${dateLabel}\n\n🕐 Уақытты таңдаңыз:\n${times.join(', ')}\n\nНемесе өз уақытыңызды жазыңыз (мысалы: 14:30).`
          : `📅 Дата: ${dateLabel}\n\n🕐 Выберите время из доступных:\n${times.join(', ')}\n\nИли напишите своё время (например: 14:30).`;

      case 'collecting_time':
        // Проверка: похоже ли на время? (9:00, 09:00, 9:0, 14:30, 14:3)
        const timeMatch = text.trim().match(/^(\d{1,2}):(\d{2})$/);
        if (timeMatch) {
          const hour = parseInt(timeMatch[1]);
          const minute = parseInt(timeMatch[2]);
          
          // Проверка диапазона
          if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            return lang === 'kz'
              ? `⏰ Уақыт дұрыс емес. 00:00 ден 23:59 қа дейін көрсетіңіз.`
              : `⏰ Некорректное время. Укажите от 00:00 до 23:59.`;
          }
        } else {
          // Если не формат времени - показываем доступные слоты
          const times = await this.getBookingSlots(this.parseSavedDate(state.appointmentData.date));
          return lang === 'kz'
            ? `⏰ Уақытты таңдаңыз (ЧЧ:ММ) немесе тізімнен:\n\n${times.join(', ')}`
            : `⏰ Пожалуйста, выберите время в формате ЧЧ:ММ или из списка:\n\n${times.join(', ')}`;
        }
        
        state.appointmentData.time = text.trim();
        state.step = 'confirming';
        
        const timePrep = lang === 'kz' ? 'сағат' : 'в';
        const details = `👤 ${state.patientData.name}\n📋 ${state.appointmentData.service}\n📅 ${state.appointmentData.dateDisplay || state.appointmentData.date} ${timePrep} ${state.appointmentData.time}\n📞 ${state.patientData.phone}\n🎂 ${lang === 'kz' ? 'Жас' : 'Возраст'}: ${state.patientData.age}`;
        
        return lang === 'kz'
          ? `Деректерді тексеріңіз:\n${details}\n\nРастау үшін 'иә' жазыңыз.`
          : `Проверьте данные:\n${details}\n\nНапишите 'да' для подтверждения.`;

      case 'confirming':
        // Проверка: не перепутал ли пользователь подтверждение с чем-то ещё
        // Игнорируем короткие ответы без "да" (например "ла", "не", "а" и т.д.)
        const validConfirmWords = ['да', 'подтверждаю', 'ок', 'окей', 'yes', 'ага', 'угу', 'иә'];
        const hasValidConfirm = validConfirmWords.some(k => lowerText === k.trim() || lowerText.includes(k));
        
        if (hasValidConfirm) {
          // Сохраняем бронирование через общее хранилище
          let bookingId: string | null = null;
          
          if (bookingStore) {
            // Проверяем конфликт через общее хранилище
            if (bookingStore.checkConflict(state.appointmentData.date, state.appointmentData.time)) {
              return lang === 'kz'
                ? `⚠️ ${state.appointmentData.date} күні ${state.appointmentData.time} уақытында жазылым бар. Басқа уақыт таңдаңыз.`
                : `⚠️ На ${state.appointmentData.date} в ${state.appointmentData.time} уже есть запись.\n\nПожалуйста, выберите другое время.`;
            }
            
            bookingId = bookingStore.add(
              state.patientData.name,
              state.appointmentData.service,
              state.appointmentData.date,
              state.appointmentData.time,
              state.patientData.phone,
              state.patientData.age,
            );
          }
          
          if (!bookingId) {
            return lang === 'kz'
              ? `⚠️ Сақтау қатесі. Кейінірек қайталап көріңіз.`
              : `⚠️ Ошибка сохранения. Попробуйте позже.`;
          }
          
          // Сохраняем в Google Sheets (если включено)
          let sheetsStatus = '';
          if (this.googleSheetsEnabled) {
            const saved = await getSheetsService().addBooking({
              id: bookingId,
              patient_name: state.patientData.name,
              phone: state.patientData.phone,
              age: state.patientData.age,
              service_name: state.appointmentData.service,
              date: state.appointmentData.date,
              time: state.appointmentData.time,
              created_at: new Date().toISOString(),
              status: 'confirmed',
            });
            sheetsStatus = saved ? '✅' : '⚠️';
            console.log(`${sheetsStatus} Google Sheets: ${saved ? 'успешно' : 'ошибка'}`);
          }
          
          // Добавляем в Google Calendar (если включено)
          let calendarStatus = '';
          if (this.googleCalendarEnabled) {
            const calendarSaved = await calendarService.createEvent({
              id: bookingId,
              patient_name: state.patientData.name,
              phone: state.patientData.phone,
              age: state.patientData.age,
              service_name: state.appointmentData.service,
              date: state.appointmentData.date,
              time: state.appointmentData.time,
            });
            calendarStatus = calendarSaved ? '✅' : '⚠️';
            console.log(`${calendarStatus} Google Calendar: ${calendarSaved ? 'успешно' : 'ошибка'}`);
          }
          
          this.bookingStates.delete(sessionId);
          
          let response = lang === 'kz'
            ? `✅ Жазылым расталды!\n\n📋 Жазылым нөмірі: ${bookingId}\n📞 Жазылымнан 10 минут бұрын келіңіз.\n\nКлиникада сізді күтеміз!`
            : `✅ Запись подтверждена!\n\n📋 Номер записи: ${bookingId}\n📞 Приходите за 10 минут до записи.\n\nОжидаем Вас в клинике!`;
          
          // Добавляем статус сохранения
          if (this.googleSheetsEnabled || this.googleCalendarEnabled) {
            response += `\n\n📊 ${lang === 'kz' ? 'Сақтау статусы' : 'Статус сохранения'}:\n`;
            if (this.googleSheetsEnabled) response += `• Google Sheets: ${sheetsStatus}\n`;
            if (this.googleCalendarEnabled) response += `• Google Calendar: ${calendarStatus}\n`;
          }
          
          return response;
        } else {
          state.step = 'collecting_date';
          return lang === 'kz'
            ? "Жақсы, басқа күн таңдайық.\n\n📅 Күн жазыңыз (мысалы: бүгін, ертең, 25 маусым)."
            : "Хорошо, давайте выберем другую дату.\n\n📅 Напишите дату (например: сегодня, завтра, 25 июня).";
        }
    }
    
    return lang === 'kz'
      ? "Бірдеңе дұрыс емес. Қайта жазылым бастау үшін 'иә' жазыңыз."
      : "Что-то пошло не так. Напишите 'да' для начала записи заново.";
  }

  /**
   * Полный каталог всех услуг
   */
  private getAllServicesList(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    const services = this.loadServices();
    const allServices = services?.services || [];
    
    let list = '';
    
    // Группируем по типам
    const groups: Record<string, any[]> = {
      'mrt': [],
      'uzi': [],
      'ct': [],
      'xray': [],
      'mammo': [],
      'ecg': [],
      'eeg': []
    };
    
    for (const service of allServices) {
      if (groups[service.type]) {
        groups[service.type].push(service);
      }
    }
    
    // МРТ
    if (groups.mrt.length > 0) {
      list += lang === 'kz'
        ? '📷 **МРТ (Магниттік-резонанстық томография)**\n'
        : '📷 **МРТ (Магнитно-резонансная томография)**\n';
      for (const s of groups.mrt) {
        list += `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})\n`;
      }
      list += '\n';
    }
    
    // УЗИ
    if (groups.uzi.length > 0) {
      list += lang === 'kz'
        ? '📡 **УЗИ (Ультрадыбыстық зерттеу)**\n'
        : '📡 **УЗИ (Ультразвуковое исследование)**\n';
      for (const s of groups.uzi) {
        list += `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})\n`;
      }
      list += '\n';
    }
    
    // КТ
    if (groups.ct.length > 0) {
      list += lang === 'kz'
        ? '💻 **КТ (Компьютерлік томография)**\n'
        : '💻 **КТ (Компьютерная томография)**\n';
      for (const s of groups.ct) {
        list += `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})\n`;
      }
      list += '\n';
    }
    
    // Рентген
    if (groups.xray.length > 0) {
      list += lang === 'kz'
        ? '📸 **Рентгенография (X-ray)**\n'
        : '📸 **Рентгенография (X-ray)**\n';
      for (const s of groups.xray) {
        list += `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})\n`;
      }
      list += '\n';
    }
    
    // Маммография
    if (groups.mammo.length > 0) {
      list += lang === 'kz' ? '🩺 **Маммография**\n' : '🩺 **Маммография**\n';
      for (const s of groups.mammo) {
        list += `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})\n`;
      }
      list += '\n';
    }
    
    // ЭКГ
    if (groups.ecg.length > 0) {
      list += lang === 'kz' ? '❤️ **ЭКГ (Электрокардиография)**\n' : '❤️ **ЭКГ (Электрокардиография)**\n';
      for (const s of groups.ecg) {
        list += `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})\n`;
      }
      list += '\n';
    }
    
    // ЭЭГ
    if (groups.eeg.length > 0) {
      list += lang === 'kz' ? '🧠 **ЭЭГ (Электроэнцефалография)**\n' : '🧠 **ЭЭГ (Электроэнцефалография)**\n';
      for (const s of groups.eeg) {
        list += `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})\n`;
      }
      list += '\n';
    }
    
    return lang === 'kz'
      ? `📋 **Барлық қызметтер мен бағалар:**\n\n${list}\n\nҚай зерттеу сізге қызықты? 'МРТ', 'УЗИ', 'КТ' немесе 'рентген' деп жазыңыз.`
      : `📋 **Все услуги и цены:**\n\n${list}\n\nКакое исследование Вас интересует? Напишите 'МРТ', 'УЗИ', 'КТ' или 'рентген' для записи.`;
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
    
    // 2. Определяем тип услуги из запроса
    const isUzi = textLower.includes('узи') || textLower.includes('ультразвук');
    const isMrt = textLower.includes('мрт') || textLower.includes('магнитно');
    const isCt = textLower.includes('кт') || textLower.includes('компьютерная томография');
    const isXray = textLower.includes('рентген') || textLower.includes('xray');
    
    // 3. Ищем по ключевым словам с приоритетом типа
    const desiredType = isUzi ? 'uzi' : isMrt ? 'mrt' : isCt ? 'ct' : isXray ? 'xray' : null;
    
    if (desiredType) {
      // Ищем в услугах нужного типа
      const typeServices = allServices.filter((s: any) => s.type === desiredType);
      for (const service of typeServices) {
        const keywords = service.keywords || [];
        for (const kw of keywords as string[]) {
          // Пропускаем общие слова - они обрабатываются отдельно
          if (kw.toLowerCase() === 'мрт' || kw.toLowerCase() === 'узи' || kw.toLowerCase() === 'кт' || kw.toLowerCase() === 'рентген') {
            continue;
          }
          if (textLower.includes(kw.toLowerCase())) {
            return service;
          }
        }
        if (textLower.includes(service.name.toLowerCase())) {
          return service;
        }
      }
      
      // Если не нашли в нужном типе - ищем по общим ключевым словам
      for (const service of typeServices) {
        const keywords = service.keywords || [];
        for (const kw of keywords as string[]) {
          // Пропускаем общие слова
          if (kw.toLowerCase() === 'мрт' || kw.toLowerCase() === 'узи' || kw.toLowerCase() === 'кт' || kw.toLowerCase() === 'рентген') {
            continue;
          }
          if (textLower.includes(kw.toLowerCase())) {
            return service;
          }
        }
      }
    }
    
    // 4. Если не нашли по типу — ищем во всех услугах
    for (const service of allServices) {
      const keywords = service.keywords || [];
      for (const kw of keywords as string[]) {
        // Пропускаем общие слова
        if (kw.toLowerCase() === 'мрт' || kw.toLowerCase() === 'узи' || kw.toLowerCase() === 'кт' || kw.toLowerCase() === 'рентген') {
          continue;
        }
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
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    let response = `📋 ${service.name}\n`;
    response += `💰 ${lang === 'kz' ? 'Бағасы' : 'Цена'}: ${this.formatPrice(service.price)} тг\n`;
    response += `⏱ ${lang === 'kz' ? 'Ұзақтығы' : 'Длительность'}: ${service.duration}\n`;
    if (service.preparation) {
      response += `📝 ${lang === 'kz' ? 'Дайындық' : 'Подготовка'}: ${service.preparation}\n`;
    }
    
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
    
    // Сохраняем выбранную услугу в состоянии, но НЕ начинаем сбор данных сразу
    // Сначала пользователь должен явно подтвердить запись
    const existingState = this.bookingStates.get(sessionId);
    if (existingState) {
      existingState.appointmentData.service = service.name;
      existingState.step = 'waiting_confirmation';
    } else {
      this.bookingStates.set(sessionId, {
        step: 'waiting_confirmation',
        patientData: {},
        appointmentData: { service: service.name }
      });
    }
    
    return response + (lang === 'kz' 
      ? "\n\nЖазылу үшін 'иә' немесе 'жазылу' деп жазыңыз."
      : "\n\nДля записи напишите 'да' или 'хочу записаться'.");
  }

  /**
   * Поиск по области тела (шея, пояс, нога и т.д.) - показывает варианты без цен
   */
  private findServiceByBodyPart(text: string, sessionId: string): string | null {
    const services = this.loadServices();
    const allServices = services?.services || [];
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    
    const textLower = text.toLowerCase();
    
    // Все возможные области тела
    const bodyParts: Record<string, string[]> = {
      'шея': ['шея', 'шейн', 'cervical', 'neck', 'мойын'],
      'голова': ['голова', 'голов', 'head', 'brain', 'мозг', 'бас'],
      'грудь': ['грудь', 'грудн', 'chest', 'thoracic', 'кеуде'],
      'поясница': ['поясн', 'пояс', 'spine', 'спин', 'lower back', 'позвоночн', 'бел'],
      'колени': ['колени', 'колен', 'knee', 'колено', 'тізе'],
      'плечи': ['плечи', 'плеч', 'плечев', 'shoulder', 'плечевой', 'иық'],
      'руки': ['руки', 'рука', 'ручн', 'hand', 'ручной', 'қол'],
      'ноги': ['ноги', 'ног', 'ножн', 'leg', 'ножной', 'аяқ'],
      'таз': ['таз', 'тазов', 'pelvis', 'тазобедренн', 'жамбас'],
      'стопы': ['стоп', 'стопа', 'foot', 'стопах', 'табан'],
      'суставы': ['сустав', 'joint', 'суставов', 'буын'],
      'позвоночник': ['позвоночн', 'позвонк', 'vertebra', 'позвоночник', 'омыртқа'],
      'орган': ['орган', 'organ', 'внутренн'],
    };
    
    // Ищем совпадение по области тела
    for (const [partName, keywords] of Object.entries(bodyParts)) {
      if (keywords.some(kw => textLower.includes(kw))) {
        // Нашли область тела - ищем все услуги для этой области
        const matchingServices = allServices.filter((s: any) => {
          const keywords: string[] = s.keywords || [];
          const name = s.name.toLowerCase();
          return keywords.some(kw => textLower.includes(kw.toLowerCase())) || 
                 name.includes(partName);
        });
        
        // Если не нашли по ключевым словам - берём все услуги нужного типа
        if (matchingServices.length === 0) {
          // Определяем тип услуги по области
          let targetType: string | null = null;
          if (partName === 'голова' || partName === 'шея' || partName === 'грудь' || partName === 'поясница' || partName === 'позвоночник') {
            targetType = 'mrt';
          } else if (partName === 'щитовидн' || partName === 'орган' || partName === 'печен' || partName === 'почк') {
            targetType = 'uzi';
          }
          
          if (targetType) {
            matchingServices.push(...allServices.filter((s: any) => s.type === targetType));
          }
        }
        
        if (matchingServices.length > 0) {
          // Группируем по типу
          const groups: Record<string, any[]> = {
            'mrt': [],
            'uzi': [],
            'ct': [],
            'xray': []
          };
          
          for (const service of matchingServices) {
            if (groups[service.type]) {
              groups[service.type].push(service);
            }
          }
          
          const bodyPartsKz: Record<string, string> = {
            'шея': 'мойын', 'голова': 'бас', 'грудь': 'кеуде',
            'поясница': 'бел', 'колени': 'тізе', 'плечи': 'иық',
            'руки': 'қол', 'ноги': 'аяқ', 'таз': 'жамбас',
            'стопы': 'табан', 'суставы': 'буын', 'позвоночник': 'омыртқа',
            'орган': 'орган',
          };
          const displayPartName = lang === 'kz' ? (bodyPartsKz[partName] || partName) : partName;

          let response = lang === 'kz'
            ? `🔍 "${displayPartName}" үшін зерттеулер табылды:\n\n`
            : `🔍 Нашёл исследования для "${displayPartName}":\n\n`;
          
          // МРТ
          if (groups.mrt.length > 0) {
            response += `📷 **МРТ (${displayPartName}):**\n`;
            for (const s of groups.mrt.slice(0, 5)) {
              response += `• ${s.name}\n`;
            }
            response += `\n`;
          }
          
          // УЗИ
          if (groups.uzi.length > 0) {
            response += `📡 **УЗИ (${displayPartName}):**\n`;
            for (const s of groups.uzi.slice(0, 5)) {
              response += `• ${s.name}\n`;
            }
            response += `\n`;
          }
          
          // КТ
          if (groups.ct.length > 0) {
            response += `💻 **КТ (${displayPartName}):**\n`;
            for (const s of groups.ct) {
              response += `• ${s.name}\n`;
            }
            response += `\n`;
          }
          
          // Рентген
          if (groups.xray.length > 0) {
            response += `📸 **Рентген (${displayPartName}):**\n`;
            for (const s of groups.xray) {
              response += `• ${s.name}\n`;
            }
            response += `\n`;
          }
          
          response += lang === 'kz'
            ? `💬 Жазылу үшін зерттеу атауын жазыңыз.\nМысалы: "МРТ мойын бөлімі" немесе жай ғана "мойын"\n\nНемесе типті жазыңыз: МРТ, УЗИ, КТ, рентген`
            : `💬 Напишите название исследования для записи.\nПример: "МРТ шейного отдела" или просто "шейный отдел"\n\nИли напишите тип: МРТ, УЗИ, КТ, рентген`;
          
          // Сохраняем контекст для последующего выбора
          this.bookingStates.set(sessionId, {
            step: 'selecting_service',
            patientData: {},
            appointmentData: { 
              service: '',
              bodyPart: partName,
              matchingServices: matchingServices.map((s: any) => ({
                id: s.id,
                name: s.name,
                type: s.type,
                price: s.price,
                duration: s.duration,
                keywords: s.keywords || []
              }))
            }
          });
          
          return response;
        }
      }
    }
    
    return null;
  }

  /**
   * Обработка выбора услуги после показа списка
   */
  private handleServiceSelection(sessionId: string, text: string, lowerText: string): string | null {
    const services = this.loadServices();
    const allServices = services?.services || [];
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    
    const state = this.bookingStates.get(sessionId);
    if (!state || state.step !== 'selecting_service') {
      return null;
    }
    
    const matchingServices = state.appointmentData.matchingServices || [];
    
    // Ищем выбранную услугу
    let selectedService: any = null;
    
    const stateServiceIds = new Set((matchingServices as any[]).map((s: any) => s.id));
    const candidateServices = stateServiceIds.size > 0
      ? allServices.filter((s: any) => stateServiceIds.has(s.id))
      : allServices;

    for (const service of candidateServices) {
      if (service.name.toLowerCase().includes(lowerText) || 
          lowerText.includes(service.name.toLowerCase())) {
        selectedService = service;
        break;
      }
    }
    
    // Если не нашли по названию - ищем по ключевым словам
    if (!selectedService) {
      for (const service of candidateServices) {
        const keywords = service.keywords || [];
        for (const kw of keywords as string[]) {
          if (lowerText.includes(kw.toLowerCase())) {
            selectedService = service;
            break;
          }
        }
        if (selectedService) break;
      }
    }
    
    if (selectedService) {
      // Показываем цену и начинаем бронирование
      let response = `📋 ${selectedService.name}\n`;
      response += `💰 ${lang === 'kz' ? 'Бағасы' : 'Цена'}: ${this.formatPrice(selectedService.price)} тг\n`;
      response += `⏱ ${lang === 'kz' ? 'Ұзақтығы' : 'Длительность'}: ${selectedService.duration}\n`;
      if (selectedService.preparation) {
        response += `📝 ${lang === 'kz' ? 'Дайындық' : 'Подготовка'}: ${selectedService.preparation}\n`;
      }
      
      // Проверка на комплексы
      const complexes = services?.complexes || [];
      const complex = complexes.find((c: any) => c.service_ids?.includes(selectedService.id));
      
      if (complex) {
        const allServicesList = services?.services || [];
        const original = complex.service_ids.reduce((acc: number, id: string) => {
          const s = allServicesList.find((x: any) => x.id === id);
          return acc + (s?.price || 0);
        }, 0);
        const discounted = Math.round(original * (1 - complex.discount_percent / 100));
        response += `\n🎁 Рекомендуем комплекс "${complex.name}" со скидкой ${complex.discount_percent}% за ${this.formatPrice(discounted)} тг.`;
      }
      
      // Начинаем бронирование
      this.bookingStates.set(sessionId, {
        step: 'waiting_confirmation',
        patientData: {},
        appointmentData: { service: selectedService.name }
      });
      
      return response + (lang === 'kz' 
        ? "\n\nЖазылу үшін 'иә' немесе 'жазылу' деп жазыңыз."
        : "\n\nДля записи напишите 'да' или 'хочу записаться'.");
    }
    
    return null;
  }

  /**
   * Список МРТ
   */
  private getMRTList(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    const services = this.loadServices();
    const mrtServices = (services?.services || []).filter((s: any) => s.type === 'mrt');
    
    let list = mrtServices.map((s: any) => 
      `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})`
    ).join('\n');
    
    return lang === 'kz'
      ? `📷 **МРТ зерттеулері:**\n\n${list}\n\nЖазылу үшін атауын жазыңыз.`
      : `🏥 **МРТ исследования:**\n\n${list}\n\nНапишите название для записи.`;
  }

  /**
   * Список УЗИ
   */
  private getUZIList(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    const services = this.loadServices();
    const uziServices = (services?.services || []).filter((s: any) => s.type === 'uzi');
    
    let list = uziServices.map((s: any) => 
      `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})`
    ).join('\n');
    
    return lang === 'kz'
      ? `📡 **УЗИ зерттеулері:**\n\n${list}\n\nЖазылу үшін атауын жазыңыз.`
      : `🏥 **УЗИ исследования:**\n\n${list}\n\nНапишите название для записи.`;
  }

  /**
   * Информация о КТ
   */
  private getCTInfo(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    const services = this.loadServices();
    const ctServices = (services?.services || []).filter((s: any) => s.type === 'ct');
    
    let list = ctServices.map((s: any) => 
      `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})`
    ).join('\n');
    
    if (ctServices.length > 0) {
      return lang === 'kz'
        ? `💻 **КТ / МСКТ зерттеулері:**\n\n${list}\n\nЖазылу үшін атауын жазыңыз.`
        : `🏥 **КТ / МСКТ исследования:**\n\n${list}\n\nНапишите название для записи.`;
    }
    
    return lang === 'kz'
      ? "КТ қолжетімді емес. Хабарласыңыз: +7 777 123 45 67"
      : "КТ недоступен. Позвоните: +7 777 123 45 67";
  }

  /**
   * Информация о рентгене
   */
  private getXrayInfo(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    const services = this.loadServices();
    const xrayServices = (services?.services || []).filter((s: any) => s.type === 'xray');
    
    let list = xrayServices.map((s: any) => 
      `• ${s.name} — ${this.formatPrice(s.price)} тг (${s.duration})`
    ).join('\n');
    
    if (xrayServices.length > 0) {
      return lang === 'kz'
        ? `📸 **Рентген зерттеулері:**\n\n${list}\n\nЖазылу үшін атауын жазыңыз.`
        : `🏥 **Рентген исследования:**\n\n${list}\n\nНапишите название для записи.`;
    }
    
    return lang === 'kz'
      ? "Рентген қолжетімді емес. Хабарласыңыз: +7 777 123 45 67"
      : "Рентген недоступен. Позвоните: +7 777 123 45 67";
  }

  /**
   * Адрес
   */
  private getAddressInfo(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    const config = this.loadConfig();
    const clinic = config?.clinic || {};
    
    return lang === 'kz'
      ? `📍 Мекен-жайымыз:\n${clinic.address}\n${clinic.landmarks || ''}\n\n📞 Телефон: ${clinic.phones?.[0] || '+7 777 123 45 67'}`
      : `📍 Наш адрес:\n${clinic.address}\n${clinic.landmarks || ''}\n\n📞 Телефон: ${clinic.phones?.[0] || '+7 777 123 45 67'}`;
  }

  /**
   * График работы
   */
  private getWorkHours(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    const config = this.loadConfig();
    const clinic = config?.clinic || {};
    const hours = clinic.work_hours || {};
    
    const workDaysRu = clinic.work_days || 'Пн-Сб';
    const workDaysKz = workDaysRu
      .replace(/Пн/g, 'Дс').replace(/Вт/g, 'Сс').replace(/Ср/g, 'Ср')
      .replace(/Чт/g, 'Бс').replace(/Пт/g, 'Жм').replace(/Сб/g, 'Сн').replace(/Вс/g, 'Жк');
    return lang === 'kz'
      ? `🕐 Жұмыс уақыты:\n📅 ${workDaysKz}\n⏰ ${hours.start || '08:00'} - ${hours.end || '20:00'}`
      : `🕐 График работы:\n📅 ${workDaysRu}\n⏰ ${hours.start || '08:00'} - ${hours.end || '20:00'}`;
  }

  /**
   * Список врачей
   */
  private getDoctorsList(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    const services = this.loadServices();
    const doctors = services?.doctors || [];
    
    const normalizeExperience = (value: string): string => {
      const match = String(value || '').match(/\d+/);
      return match ? match[0] : String(value || '').trim();
    };

    let list = doctors.map((d: any) => {
      const years = normalizeExperience(d.experience);
      const expText = lang === 'kz'
        ? `тәжірибе: ${years} жыл`
        : `стаж: ${years} лет`;
      return `• ${d.name}\n  👨‍⚕️ ${d.specialty} (${expText})`;
    }).join('\n\n');
    
    return lang === 'kz'
      ? `👨‍⚕️ Дәрігерлеріміз:\n\n${list}`
      : `👨‍⚕️ Наши специалисты:\n\n${list}`;
  }

  /**
   * Приветствие
   */
  private getGreetingResponse(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    return lang === 'kz'
      ? `Сәлеметсіз бе! 👋 Мен Nomad Clinic клиникасының ботымын.\n\nМаған мыналарда көмектесе аламын:\n• МРТ, УЗИ, КТ-ға жазылу\n• Бағаларды және қолжетімділікті білу\n• Дәрігерлер туралы ақпарат\n• Мекен-жай мен жұмыс графигін табу\n\nҚызметтерді көру үшін 'мрт' немесе 'узи' деп жазыңыз.`
      : `Добрый день! 👋 Я бот клиники Nomad Clinic.\n\nМогу помочь:\n• Записаться на МРТ, УЗИ, КТ\n• Узнать цены и наличие\n• Рассказать про врачей\n• Найти адрес и график\n\nНапишите 'мрт' или 'узи' для просмотра услуг.`;
  }

  /**
   * Начало бронирования
   */
  private startBooking(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    const state: BookingState = {
      step: 'collecting_name',
      patientData: {},
      appointmentData: { service: lang === 'kz' ? 'Көрсетілмеген' : 'Не указано' }
    };
    
    this.bookingStates.set(sessionId, state);
    return lang === 'kz'
      ? "Тамаша! Алдымен, толық атыңызды жазыңыз."
      : "Отлично! Подскажите, пожалуйста, Ваше имя и фамилию.";
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
      const lang = this.sessionLanguages.get(sessionId) || 'ru';
      const errorMsg = lang === 'kz' 
        ? "Кешіріңіз, ақпарат табылмады. Хабарласыңыз: +7 777 123 45 67"
        : "Извините, я не нашел информацию. Позвоните: +7 777 123 45 67";
      return errorMsg;
    }
    
    try {
      const lang = this.sessionLanguages.get(sessionId) || 'ru';
      
      // Получаем контекст из документов
      const context = this.buildContext(query);
      
      // Получаем историю чата
      const history = this.getChatHistory(sessionId);
      const historyText = history.length > 0 
        ? `\n📜 ${lang === 'kz' ? 'ӨТКЕН ДИАЛОГ' : 'ПРЕДЫДУЩИЙ ДИАЛОГ'}:\n${history.map(h => `${h.role === 'user' ? '👤' : '🤖'} ${h.content}`).join('\n')}`
        : '';
      
      const systemPrompt = lang === 'kz' 
        ? `Сен "Nomad Clinic" медициналық орталығының кәсіби ассистентісің Астанада.

📋 ҚОЛДАНЫЛАТЫН АҚПАРАТ:
${context}

${historyText}

❓ СҰРАҚ: ${query}

📝 ЕРЕЖЕЛЕР:
1. ТЕК жоғарыдағы ақпаратқа негізделіп жауап бер
2. Ақпарат болмаса - телефон шақыруға ұсын: +7 777 123 45 67
3. Қазақ тілінде жауап бер
4. Құрметті, эмодзи қолдан
5. Құжат туралы сұрақ болса - көмек ұсын
6. ОЙДАН ДӨНГЕН ДЕРЕКТЕР БЕРМЕ!

💬 ЖАУАП:`
        : `Ты - профессиональный ассистент медицинского центра "Nomad Clinic" в Астане.

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

      const response = await this.ollamaChat(systemPrompt);
      
      // Сохраняем в историю
      this.saveToHistory(sessionId, query, response);
      
      return response;
      
    } catch (error: any) {
      console.error('❌ Ошибка Llama:', error.message);
      const lang = this.sessionLanguages.get(sessionId) || 'ru';
      const errorMsg = lang === 'kz'
        ? "Кешіріңіз, уақытша қолжетімсіз. Шақырыңыз: +7 777 123 45 67"
        : "Извините, временно недоступен. Позвоните: +7 777 123 45 67";
      return errorMsg;
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

  private async getBookingSlots(targetDate: Date): Promise<string[]> {
    try {
      const config = this.loadConfig();
      const baseTimes = config?.booking_slots?.base_times || ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
      
      let availableTimes = baseTimes;
      
      // Если Google Calendar включен — проверяем занятость
      if (this.googleCalendarEnabled) {
        const availableSlots = await calendarService.getAvailableSlots(targetDate, baseTimes, 30);
        if (availableSlots.length > 0) {
          availableTimes = availableSlots;
        }
      }
      
      // ИСПРАВЛЕНИЕ: убираем прошедшие времена если дата "сегодня"
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (targetDate.getTime() === today.getTime()) {
        availableTimes = this.filterPastTimes(availableTimes);
      }
      
      return availableTimes;
    } catch {
      return ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
    }
  }

  /**
   * Парсинг даты для Google Calendar
   */
  private parseDateForCalendar(dateStr: string): Date {
    const lower = dateStr.toLowerCase().trim();
    const today = new Date();
    
    if (lower === 'сегодня' || lower === 'бүгін') return today;
    if (lower === 'завтра' || lower === 'ертең') return new Date(today.getTime() + 24 * 60 * 60 * 1000);
    if (lower === 'послезавтра') return new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
    
    const numMatch = lower.match(/^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?$/);
    if (numMatch) {
      const day = parseInt(numMatch[1]);
      const month = parseInt(numMatch[2]) - 1;
      let year = numMatch[3] ? parseInt(numMatch[3]) : today.getFullYear();
      if (year < 100) year = 2000 + year;
      return new Date(year, month, day);
    }
    
    const textMatch = lower.match(/^(\d{1,2})\s+([\p{L}]+)$/u);
    if (textMatch) {
      const day = parseInt(textMatch[1]);
      const monthName = textMatch[2].toLowerCase();
      const monthNames: Record<string, number> = {
        // Русские
        'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3,
        'мая': 4, 'июня': 5, 'июля': 6, 'августа': 7,
        'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11,
        // Казахские
        'қаңтар': 0, 'ақпан': 1, 'наурыз': 2, 'сәуір': 3,
        'мамыр': 4, 'маусым': 5, 'шілде': 6, 'тамыз': 7,
        'қыркүйек': 8, 'қазан': 9, 'қараша': 10, 'желтоқсан': 11,
      };
      const month = monthNames[monthName] ?? 0;
      return new Date(today.getFullYear(), month, day);
    }
    
    return today;
  }

  private formatPrice(price: number): string {
    return new Intl.NumberFormat('ru-RU').format(price);
  }

  private jsonToText(data: any, filename: string): string {
    let text = `=== ${filename} ===\n\n`;
    
    const process = (obj: any, indent: string = '', label?: string): void => {
      if (obj === null || obj === undefined) {
        if (label) {
          text += `${indent}${label}: null\n`;
        } else {
          text += `${indent}null\n`;
        }
        return;
      }

      if (Array.isArray(obj)) {
        if (label) {
          text += `${indent}${label}:\n`;
        }
        obj.forEach((item: any, idx: number) => {
          if (typeof item === 'object' && item !== null) {
            text += `${indent}  ${idx + 1}.\n`;
            process(item, indent + '    ');
          } else {
            text += `${indent}  - ${item}\n`;
          }
        });
        return;
      }

      if (typeof obj === 'object') {
        if (label) {
          text += `${indent}${label}:\n`;
        }
        for (const [key, value] of Object.entries(obj)) {
          process(value, indent + (label ? '  ' : ''), key);
        }
        return;
      }

      if (label) {
        text += `${indent}${label}: ${obj}\n`;
      } else {
        text += `${indent}${obj}\n`;
      }
    };
    
    process(data);
    return text;
  }

  /**
   * Валидация даты
   * @returns { valid: boolean, error?: string, parsedDate?: Date }
   */
  /**
   * Валидация номера телефона Казахстана
   * Формат: +7 или 8, затем код оператора (701/702/705/706/707/708/747/771/775/776/777/778/779), 7 цифр
   */
  private validatePhone(phoneStr: string): { valid: boolean; error?: string } {
    const cleaned = phoneStr.replace(/[\s\-\(\)]/g, '');
    const phoneRegex = /^(\+7|8)(701|702|705|706|707|708|747|771|775|776|777|778|779)\d{7}$/;
    
    if (!phoneRegex.test(cleaned)) {
      return { valid: false };
    }
    
    return { valid: true };
  }

  /**
   * Получить конкретную дату (YYYY-MM-DD) из строки
   * "сегодня" -> 2026-06-22
   * "завтра" -> 2026-06-23
   * "25.06" -> 2026-06-25
   */
  private resolveDate(dateStr: string): { date: Date; dateLabel: string; isPast: boolean } {
    const lower = dateStr.toLowerCase().trim();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let targetDate: Date;
    let label: string;
    
    if (lower === 'сегодня' || lower === 'бүгін') {
      targetDate = today;
      label = lower === 'бүгін' ? 'бүгін' : 'сегодня';
    } else if (lower === 'завтра' || lower === 'ертең') {
      targetDate = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      label = lower === 'ертең' ? 'ертең' : 'завтра';
    } else if (lower === 'послезавтра') {
      targetDate = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
      label = 'послезавтра';
    } else {
      // Парсим числовой формат (25.06, 21.06.26)
      const numMatch = lower.match(/^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?$/);
      if (numMatch) {
        let day = parseInt(numMatch[1]);
        let month = parseInt(numMatch[2]) - 1;
        let year = numMatch[3] ? parseInt(numMatch[3]) : today.getFullYear();
        if (year < 100) year = 2000 + year;
        targetDate = new Date(year, month, day);
        label = dateStr.trim();
      } else {
        // Текстовый формат (25 июня / 25 маусым)
        const textMatch = lower.match(/^(\d{1,2})\s+([\p{L}]+)$/u);
        if (textMatch) {
          const day = parseInt(textMatch[1]);
          const monthNames: Record<string, number> = {
            // Русские
            'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3,
            'мая': 4, 'июня': 5, 'июля': 6, 'августа': 7,
            'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11,
            // Казахские
            'қаңтар': 0, 'ақпан': 1, 'наурыз': 2, 'сәуір': 3,
            'мамыр': 4, 'маусым': 5, 'шілде': 6, 'тамыз': 7,
            'қыркүйек': 8, 'қазан': 9, 'қараша': 10, 'желтоқсан': 11,
          };
          const month = monthNames[textMatch[2].toLowerCase()] ?? -1;
          if (month === -1) {
            return { date: today, dateLabel: dateStr.trim(), isPast: false };
          }
          targetDate = new Date(today.getFullYear(), month, day);
          label = dateStr.trim();
        } else {
          return { date: today, dateLabel: dateStr.trim(), isPast: false };
        }
      }
    }
    
    const isPast = targetDate < today;
    return { date: targetDate, dateLabel: label, isPast };
  }

  /**
   * Парсить сохранённую дату (YYYY-MM-DD) в Date
   */
  private parseSavedDate(dateStr: string): Date {
    if (!dateStr) return new Date();
    // Если уже Date — возвращаем как есть
    if (typeof dateStr === 'object' && 'getTime' in dateStr) return dateStr as Date;
    // Если YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }

  /**
   * Отфильтровать прошедшие времена из списка
   */
  private filterPastTimes(times: string[]): string[] {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    return times.filter(time => {
      const [h, m] = time.split(':').map(Number);
      if (h > currentHour) return true;
      if (h === currentHour && m > currentMinute) return true;
      return false;
    });
  }

  private validateDate(dateStr: string): { valid: boolean; error?: string } {
    const monthNamesRu = [
      '', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ];
    
    const lower = dateStr.toLowerCase().trim();
    
    // Разрешаем относительные даты без проверки
    const relativeDates = ['сегодня', 'завтра', 'послезавтра', 'бүгін', 'ертең'];
    if (relativeDates.some(w => lower.includes(w))) {
      return { valid: true };
    }
    
    // Парсим дату с цифрами
    let day: number = 0;
    let month: number = 0;
    let year: number = new Date().getFullYear();
    
    // Числовой формат (25.06, 25/06, 25-06)
    const numMatch = lower.match(/^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?$/);
    if (numMatch) {
      day = parseInt(numMatch[1]);
      month = parseInt(numMatch[2]);
      year = numMatch[3] ? parseInt(numMatch[3]) : new Date().getFullYear();
      
      // Двухзначный год (26 -> 2026)
      if (year < 100) {
        year = 2000 + year;
      }
    }
    
    // Текстовый формат (25 июня)
    const textMatch = lower.match(/^(\d{1,2})\s+([\p{L}]+)$/u);
    if (textMatch) {
      day = parseInt(textMatch[1]);
      const monthName = textMatch[2].toLowerCase();
      
      const monthNames: Record<string, number> = {
        // Русские
        'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4,
        'мая': 5, 'июня': 6, 'июля': 7, 'августа': 8,
        'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
        'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4,
        'май': 5, 'июнь': 6, 'июль': 7, 'август': 8,
        'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12,
        // Казахские
        'қаңтар': 1, 'ақпан': 2, 'наурыз': 3, 'сәуір': 4,
        'мамыр': 5, 'маусым': 6, 'шілде': 7, 'тамыз': 8,
        'қыркүйек': 9, 'қазан': 10, 'қараша': 11, 'желтоқсан': 12,
      };
      
      month = monthNames[monthName];
      year = new Date().getFullYear();
      
      if (!month) {
        return { valid: false, error: `Не распознал месяц "${textMatch[2]}". Используйте формат: 25.06 или 25 июня / 25 маусым.` };
      }
    }
    
    // Если не удалось распарсить - пропускаем
    if (day === 0 || month === 0) {
      return { valid: true };
    }
    
    // Проверка диапазона месяца
    if (month < 1 || month > 12) {
      return { valid: false, error: `Месяц должен быть от 1 до 12. Вы ввели: ${month}` };
    }
    
    // Проверка диапазона дня
    if (day < 1 || day > 31) {
      return { valid: false, error: `День должен быть от 1 до 31. Вы ввели: ${day}` };
    }
    
    // Проверка количества дней в месяце
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day > daysInMonth) {
      return { valid: false, error: `В ${monthNamesRu[month]} ${year} года только ${daysInMonth} дней!` };
    }
    
    // Проверка: дата не в прошлом
    const inputDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (inputDate < today) {
      return { valid: false, error: `Эта дата (${day} ${monthNamesRu[month]}) уже прошла. Выберите будущую дату.` };
    }
    
    return { valid: true };
  }
}
