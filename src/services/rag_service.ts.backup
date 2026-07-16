/**
 * RAG Система для Nomad Clinic
 * Полная логика бота + Llama 3.1 8B (Ollama)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getSheetsService } from './google_sheets_service';
import { calendarService } from './google_calendar_service';

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
  private googleCalendarEnabled: boolean = false;
  
  // Язык пользователя (определяется по первому сообщению)
  private sessionLanguages: Map<string, 'ru' | 'kz'> = new Map();

  constructor(ollamaUrl: string, dataDir: string) {
    this.dataDir = dataDir;
    this.ollamaUrl = (ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
    this.hasOllama = !!ollamaUrl;
    
    // Инициализация Google сервисов (асинхронно, не блокируем конструктор)
    setImmediate(() => this.initGoogleServices());
  }

  private async initGoogleServices(): Promise<void> {
    // Google Sheets
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
    // Казахские буквы: ә, ғ, і, ң, ө, ұ, ү, қ
    const kazakhLetters = /[әғіңөұүқ]/gi;
    // Русские буквы: ё, й, ц, ч, ш, щ, ъ, ь, ю, я
    const russianLetters = /[ёйцчшщъьюя]/gi;
    
    const kazakhCount = (text.match(kazakhLetters) || []).length;
    const russianCount = (text.match(russianLetters) || []).length;
    
    // Если казахских букв больше - это казахский
    if (kazakhCount > 0 && kazakhCount >= russianCount) {
      return 'kz';
    }
    
    // Иначе - русский
    return 'ru';
  }

  /**
   * Главная функция обработки сообщения
   */
  async processMessage(sessionId: string, text: string): Promise<string> {
    // Проверка: не группа ли это?
    if (!this.isPersonalChat(sessionId)) {
      return ''; // Игнорируем группы
    }
    
    // Определяем язык пользователя и сохраняем
    const language = this.detectLanguage(text);
    this.sessionLanguages.set(sessionId, language);
    
    const lowerText = text.toLowerCase().trim();
    
    // Команда очистки записей (только для админа)
    if (lowerText === '/clear' || lowerText === 'очисти записи' || lowerText === 'удалить все записи') {
      await this.clearAllBookings();
      // Очищаем локальные bookings
      this.bookings = [];
      this.bookingStates.clear();
      return '🗑️ Все записи удалены. Можно тестировать заново.';
    }

    // 1. Проверка на отмену/стоп (рус + каз)
    const cancelWords = ['нет', 'не хочу', 'отмена', 'стоп', 'хватит', 'жоқ', 'болмайды', 'қой', 'той', 'ой', 'ойбой'];
    if (cancelWords.some(k => lowerText.includes(k))) {
      this.bookingStates.delete(sessionId);
      const lang = language;
      return lang === 'kz' 
        ? "Жақсы, аяқтаймын. Егер тіркеле алсаңыз - байланысқа шығыңыз!"
        : "Хорошо, завершаю. Если решите записаться — обращайтесь!";
    }

    // 2. Проверка на благодарность (рус + каз)
    const thanksWords = ['спасибо', 'благодарю', 'рахмет', 'рақмет', 'көп рахмет', 'спс'];
    if (thanksWords.some(k => lowerText.includes(k))) {
      this.bookingStates.delete(sessionId);
      const lang = language;
      return lang === 'kz'
        ? "Әрқашан көмектеуге ризамыз! Сіздің денсаулығыңыз!"
        : "Всегда рады помочь! Здоровья Вам!";
    }

    // 3. Проверка на перевод на оператора
    if (this.shouldTransferToOperator(lowerText)) {
      const config = this.loadConfig();
      const phone = config?.clinic?.phones?.[0] || '+7 777 123 45 67';
      const lang = language;
      return lang === 'kz'
        ? `Сұрақтың маңыздылығын түсінемін. Оператор шақырыңыз: ${phone}`
        : `Понимаю важность вопроса. Звоните оператору: ${phone}`;
    }

    // 4. Проверка на врача по имени
    const doctor = this.findDoctorByName(lowerText);
    if (doctor) {
      const lang = language;
      return lang === 'kz'
        ? `Керемет таңдау! ${doctor.name} — ${doctor.specialty}, тәжірибе ${doctor.experience}.\n\nҚандай зерттеу өткіңіз келсе? 'МРТ' немесе 'УЗИ' жазыңыз.`
        : `Отличный выбор! ${doctor.name} — ${doctor.specialty}, стаж ${doctor.experience}.\n\nКакое исследование хотите пройти? Напишите 'МРТ' или 'УЗИ' для выбора.`;
    }

    // 5. Проверка состояния бронирования
    const bookingState = this.bookingStates.get(sessionId);
    if (bookingState && bookingState.step !== 'greeting') {
      return await this.handleBookingFlow(sessionId, bookingState, text, lowerText);
    }

    // 6. Приветствия (рус + каз + ен)
    const greetingWords = ['привет', 'здравствуй', 'здравствуйте', 'добрый', 'hello', 'hi', 'хай', 'сәлем', 'сәлемет', 'салем', 'қайырлы', 'добр', 'прив', 'хайю', 'йоу'];
    if (greetingWords.some(k => lowerText.includes(k))) {
      return this.getGreetingResponse(sessionId);
    }

    // 7. Поиск услуги по ключевым словам
    const service = this.findServiceByKeyword(text);
    if (service) {
      return this.handleServiceInquiry(service, sessionId);
    }

    // 8. Запрос списка МРТ
    if (lowerText.includes('мрт')) {
      return this.getMRTList(sessionId);
    }

    // 9. Запрос списка УЗИ
    if (lowerText.includes('узи')) {
      return this.getUZIList(sessionId);
    }

    // 10. Запрос КТ
    if (lowerText.includes('кт') || lowerText.includes('мскт') || lowerText.includes('томография')) {
      return this.getCTInfo(sessionId);
    }

    // 11. Запрос рентгена
    if (lowerText.includes('рентген') || lowerText.includes('xray')) {
      return this.getXrayInfo(sessionId);
    }

    // 12. Адрес (рус + каз)
    if (lowerText.includes('адрес') || lowerText.includes('где') || lowerText.includes('наход') || lowerText.includes('куда') || lowerText.includes('орналас') || lowerText.includes('мекен')) {
      return this.getAddressInfo(sessionId);
    }

    // 13. График работы (рус + каз)
    if (lowerText.includes('график') || lowerText.includes('режим') || lowerText.includes('час') || lowerText.includes('работ') || lowerText.includes('уақыт') || lowerText.includes('жұмыс')) {
      return this.getWorkHours(sessionId);
    }

    // 14. Врачи (рус + каз)
    if (lowerText.includes('врач') || lowerText.includes('доктор') || lowerText.includes('специалист') || lowerText.includes('дәрігер') || lowerText.includes('мамандар')) {
      return this.getDoctorsList(sessionId);
    }

    // 15. Запись (рус + каз + сленг)
    const confirmWords = ['да', 'хочу записаться', 'записаться', 'хочу', 'согласен', 'ок', 'подтверждаю', 'yes', 'оке', 'окей', 'окк', 'ага', 'угу', 'иә', 'ладно', 'давай'];
    if (confirmWords.some(k => lowerText.includes(k))) {
      return this.startBooking(sessionId);
    }

    // 16. Если не поняли - используем Llama
    if (this.hasOllama) {
      return this.queryGemini(text, sessionId);
    }

    const lang = language;
    return lang === 'kz'
      ? "Кешіріңіз, толық түсінбедім. Мен МРТ, УЗИ бойынша тіркеуге немесе дәрігерлер туралы айтуға көмектесе аламын.\n\nХызметтерді көру үшін 'МРТ' немесе 'УЗИ' жазыңыз."
      : "Извините, не совсем понял. Я могу помочь с записью на МРТ, УЗИ или рассказать про врачей.\n\nНапишите 'мрт' или 'узи' для просмотра услуг.";
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
          ? `⏰ Өтінішіміз, уақыт таңдаңыз:\n\n${times.join(', ')}`
          : `⏰ Пожалуйста, выберите время:\n\n${times.join(', ')}`;
        return msg;
      }
    }
    
    switch (state.step) {
      case 'waiting_confirmation':
        // Пользователь подтверждает запись после выбора услуги
        const confirmWords = ['да', 'хочу записаться', 'записаться', 'хочу', 'согласен', 'ок', 'подтверждаю', 'сгл', 'yes', 'оке', 'окей', 'окк', 'ага', 'угу', 'иә', 'йо', 'ладно', 'давай'];
        if (confirmWords.some(k => lowerText.includes(k))) {
          state.step = 'collecting_name';
          return lang === 'kz'
            ? "Керемет! Өтінішіміз, өзіңіздің атыңыз бен тегіңізді айтыңыз."
            : "Отлично! Подскажите, пожалуйста, Ваше имя и фамилию.";
        } else {
          // Если не подтверждает - сбрасываем состояние
          this.bookingStates.delete(sessionId);
          return lang === 'kz'
            ? "Жақсы! Егер тіркеле алсаңыз - байланысқа шығыңыз."
            : "Хорошо! Если решите записаться — обращайтесь.";
        }
        
      case 'collecting_name':
        // Проверка: не короткое ли это слово (например "да", "ок" и т.д.)
        if (text.trim().length < 3 || ['да', 'ок', 'yes', 'ага', 'угу', 'иә'].includes(lowerText.trim())) {
          return lang === 'kz'
            ? "Өтінішіміс, толық атыңызды жазыңыз (мысалы: Иван Иванов)."
            : "Пожалуйста, напишите Ваше полное имя (например: Иван Иванов).";
        }
        state.patientData.name = text.trim();
        state.step = 'collecting_age';
        return lang === 'kz'
          ? "Рахмет! Өтінішіміс, өзіңіздің жасыңызды цифр менен айтыңыз."
          : "Спасибо! Подскажите, пожалуйста, Ваш возраст цифрами.";

      case 'collecting_age':
        const age = parseInt(text);
        if (isNaN(age) || age < 0 || age > 120) {
          return lang === 'kz'
            ? "Өтінішіміс, ресімді жасыңызды көрсетіңіз (0-120 жыл)."
            : "Пожалуйста, укажите корректный возраст (0-120 лет).";
        }
        state.patientData.age = age;
        state.step = 'collecting_phone';
        return lang === 'kz'
          ? "Өтінішіміс, байланыс үшін телефон нөмерін қалдырыңыз."
          : "Оставьте, пожалуйста, контактный номер телефона для связи.";

      case 'collecting_phone':
        const phoneValidation = this.validatePhone(text);
        if (!phoneValidation.valid) {
          return phoneValidation.error ?? (lang === 'kz' ? "Қате телефон нөмері." : "Неверный номер телефона.");
        }
        state.patientData.phone = text.trim();
        state.step = 'collecting_date';
        const serviceName = state.appointmentData.service || (lang === 'kz' ? "зерттеу" : "исследование");
        return lang === 'kz'
          ? `${serviceName} өтпу үшін қандай күні ыңғайлы? (мысалы: бүгін, ертең, 25.06)`
          : `На какой день Вам удобно пройти ${serviceName}? (например: сегодня, завтра, 25.06)`;

      case 'collecting_date':
        // Проверка: не время ли это ввёл пользователь?
        const timePattern = /^\d{1,2}:\d{2}$/;
        if (timePattern.test(text.trim())) {
          return lang === 'kz'
            ? `⚠️ Бұл уақыт, ал күні емес!\n\nӨтінішіміс, ҚҰНЫ жазыңыз:\n• бүгін\n• ертең\n• қайтадан\n• 25.06\n• 25 маусым`
            : `⚠️ Это время, а не дата!\n\nПожалуйста, напишите ДАТУ:\n• сегодня\n• завтра\n• послезавтра\n• 25.06\n• 25 июня`;
        }
        
        // Проверка: только эмодзи?
        const onlyEmojis = /^[\p{Emoji}\s]+$/u.test(text);
        if (onlyEmojis && text.length < 5) {
          return lang === 'kz'
            ? `📅 Өтінішіміс, өжету үшін құны жазыңыз.\n\nМысалдар:\n• бүгін\n• ертең\n• 25.06`
            : `📅 Пожалуйста, напишите дату для записи.\n\nПримеры:\n• сегодня\n• завтра\n• 25.06`;
        }
        
        // Проверяем формат даты
        const lower = text.toLowerCase().trim();
        const validDateWords = ['сегодня', 'завтра', 'послезавтра', 'бүгін', 'ертең'];
        const hasValidWord = validDateWords.some(w => lower.includes(w));
        const hasDigits = /\d/.test(text);
        
        if (!hasValidWord && !hasDigits) {
          return lang === 'kz'
            ? `📅 Өтінішіміс, құны жазыңыз:\n• бүгін\n• ертең\n• қайтадан\n• 25.06\n• 25 маусым`
            : `📅 Пожалуйста, напишите дату:\n• сегодня\n• завтра\n• послезавтра\n• 25.06\n• 25 июня`;
        }
        
        // ВАЛИДАЦИЯ: проверяем корректность
        const dateValidation = this.validateDate(text.trim());
        if (!dateValidation.valid) {
          return lang === 'kz'
            ? `⚠️ ${dateValidation.error}\n\nӨтінішіміс, ресімді құны еңгізіңіз:\n• бүгін\n• ертең\n• 25.06`
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
          ? (lang === 'kz' ? '⚠️ Бұл күн өткіп барды!' : '⚠️ Эта дата уже прошла!')
          : resolved.dateLabel;
        
        return lang === 'kz'
          ? `📅 Құны: ${dateLabel}\n\n🕐 Ұсынылған уақыттардан таңдаңыз:\n${times.join(', ')}\n\nНемесе өзіңіздің уақытты жазыңыз (мысалы: 14:30).`
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
              ? `⏰ Қате уақыт. 00:00 ден 23:59 қа дейін көрсетіңіз.`
              : `⏰ Некорректное время. Укажите от 00:00 до 23:59.`;
          }
        } else {
          // Если не формат времени - показываем доступные слоты
          const times = await this.getBookingSlots(this.parseSavedDate(state.appointmentData.date));
          return lang === 'kz'
            ? `⏰ Өтінішіміс, ЧЧ:ММ форматында уақыт таңдаңыз немесе тағдыру ішінен:\n\n${times.join(', ')}`
            : `⏰ Пожалуйста, выберите время в формате ЧЧ:ММ или из списка:\n\n${times.join(', ')}`;
        }
        
        state.appointmentData.time = text.trim();
        state.step = 'confirming';
        
        const details = `👤 ${state.patientData.name}\n📋 ${state.appointmentData.service}\n📅 ${state.appointmentData.dateDisplay || state.appointmentData.date} в ${state.appointmentData.time}\n📞 ${state.patientData.phone}\n🎂 ${lang === 'kz' ? 'Жасы' : 'Возраст'}: ${state.patientData.age}`;
        
        return lang === 'kz'
          ? `Деректерді тексеріңіз:\n${details}\n\nРасталау үшін 'иә' жазыңыз.`
          : `Проверьте данные:\n${details}\n\nНапишите 'да' для подтверждения.`;

      case 'confirming':
        // Проверка: не перепутал ли пользователь подтверждение с чем-то ещё
        // Игнорируем короткие ответы без "да" (например "ла", "не", "а" и т.д.)
        const validConfirmWords = ['да', 'подтверждаю', 'ок', 'окей', 'yes', 'ага', 'угу', 'подтверждаю'];
        const hasValidConfirm = validConfirmWords.some(k => lowerText === k.trim() || lowerText.includes(k));
        
        if (hasValidConfirm) {
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
          let sheetsStatus = '';
          if (this.googleSheetsEnabled) {
            const saved = await getSheetsService().addBooking(booking);
            sheetsStatus = saved ? '✅' : '⚠️';
            console.log(`${sheetsStatus} Google Sheets: ${saved ? 'успешно' : 'ошибка'}`);
          }
          
          // Добавляем в Google Calendar (если включено)
          let calendarStatus = '';
          if (this.googleCalendarEnabled) {
            const calendarSaved = await calendarService.createEvent({
              id: bookingId,
              patient_name: booking.patient_name,
              phone: booking.phone,
              age: booking.age,
              service_name: booking.service_name,
              date: booking.date,
              time: booking.time,
            });
            calendarStatus = calendarSaved ? '✅' : '⚠️';
            console.log(`${calendarStatus} Google Calendar: ${calendarSaved ? 'успешно' : 'ошибка'}`);
          }
          
          this.bookingStates.delete(sessionId);
          
          let response = lang === 'kz'
            ? `✅ Өжету расталанды!\n\n📋 Өжету нөмері: ${bookingId}\n📞 Өжетудің 10 минут бұрын келіңіз.\n\nСіздіміз клиникада ойлап отырмыз!`
            : `✅ Запись подтверждена!\n\n📋 Номер записи: ${bookingId}\n📞 Приходите за 10 минут до записи.\n\nОжидаем Вас в клинике!`;
          
          // Добавляем статус сохранения
          if (this.googleSheetsEnabled || this.googleCalendarEnabled) {
            response += `\n\n📊 ${lang === 'kz' ? 'Сақтау құрылымы' : 'Статус сохранения'}:\n`;
            if (this.googleSheetsEnabled) response += `• Google Sheets: ${sheetsStatus}\n`;
            if (this.googleCalendarEnabled) response += `• Google Calendar: ${calendarStatus}\n`;
          }
          
          return response;
        } else {
          state.step = 'collecting_date';
          return lang === 'kz'
            ? "Жақсы, басқа құны таңдайық.\n\n📅 Құны жазыңыз (мысалы: бүгін, ертең, 25 маусым)."
            : "Хорошо, давайте выберем другую дату.\n\n📅 Напишите дату (например: сегодня, завтра, 25 июня).";
        }
    }

    return lang === 'kz'
      ? "Әйтпесе бірше болды. Қайта тіркеу үшін 'иә' жазыңыз."
      : "Что-то пошло не так. Напишите 'да' для начала записи заново.";
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
    
    return response + "\n\nДля записи напишите 'да' или 'хочу записаться'.";
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
      ? `🏥 МРТ зерттеулері:\n\n${list}\n\nҚандай зерттеу сіздің қызығушылығындыра?`
      : `🏥 МРТ исследования:\n\n${list}\n\nКакое исследование Вас интересует?`;
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
      ? `🏥 УЗИ зерттеулері:\n\n${list}\n\nҚандай зерттеу сіздің қызығушылығындыра?`
      : `🏥 УЗИ исследования:\n\n${list}\n\nКакое исследование Вас интересует?`;
  }

  /**
   * Информация о КТ
   */
  private getCTInfo(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    const services = this.loadServices();
    const ctService = (services?.services || []).find((s: any) => s.type === 'ct');
    
    if (ctService) {
      return lang === 'kz'
        ? `🏥 Компьютерлік томография (КТ / МСКТ)\n💰 Баға: ${this.formatPrice(ctService.price)} тг\n⏱ Ұзақтығы: ${ctService.duration}\n\nТіркеу үшін 'хочу записаться' жазыңыз.`
        : `🏥 Компьютерная томография (КТ / МСКТ)\n💰 Цена: ${this.formatPrice(ctService.price)} тг\n⏱ Длительность: ${ctService.duration}\n\nНапишите 'хочу записаться' для записи.`;
    }
    
    return lang === 'kz'
      ? "КТ қолжетімсіз. Шақырыңыз: +7 777 123 45 67"
      : "КТ недоступен. Позвоните: +7 777 123 45 67";
  }

  /**
   * Информация о рентгене
   */
  private getXrayInfo(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    const services = this.loadServices();
    const xrayService = (services?.services || []).find((s: any) => s.type === 'xray');
    
    if (xrayService) {
      return lang === 'kz'
        ? `🏥 Рентгенография (X-ray)\n💰 Баға: ${this.formatPrice(xrayService.price)} тг\n⏱ Ұзақтығы: ${xrayService.duration}\n\nТіркеу үшін 'хочу записаться' жазыңыз.`
        : `🏥 Рентгенография (X-ray)\n💰 Цена: ${this.formatPrice(xrayService.price)} тг\n⏱ Длительность: ${xrayService.duration}\n\nНапишите 'хочу записаться' для записи.`;
    }
    
    return lang === 'kz'
      ? "Рентген қолжетімсіз. Шақырыңыз: +7 777 123 45 67"
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
      ? `📍 Біздің мекен-жайымыз:\n${clinic.address}\n${clinic.landmarks || ''}\n\n📞 Телефон: ${clinic.phones?.[0] || '+7 777 123 45 67'}`
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
    
    return lang === 'kz'
      ? `🕐 Жұмыс уақыты:\n📅 ${clinic.work_days || 'Дс-Сб'}\n⏰ ${hours.start || '08:00'} - ${hours.end || '20:00'}`
      : `🕐 График работы:\n📅 ${clinic.work_days || 'Пн-Сб'}\n⏰ ${hours.start || '08:00'} - ${hours.end || '20:00'}`;
  }

  /**
   * Список врачей
   */
  private getDoctorsList(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    const services = this.loadServices();
    const doctors = services?.doctors || [];
    
    let list = doctors.map((d: any) => 
      `• ${d.name}\n  👨‍⚕️ ${d.specialty} (стаж ${d.experience})`
    ).join('\n\n');
    
    return lang === 'kz'
      ? `👨‍⚕️ Біздің мамандар:\n\n${list}`
      : `👨‍⚕️ Наши специалисты:\n\n${list}`;
  }

  /**
   * Приветствие
   */
  private getGreetingResponse(sessionId: string): string {
    const lang = this.sessionLanguages.get(sessionId) || 'ru';
    return lang === 'kz'
      ? `Сәлемет болыңыз! 👋 Мен Nomad Clinic ботымын.\n\nМен көмектесе аламын:\n• МРТ, УЗИ, КТ бойынша тіркеу\n• Бағаларды және ресурстарды білу\n• Дәрігерлер туралы айту\n• Мекен-жайы мен графикті табу\n\nХызметтерді көру үшін 'мрт' немесе 'узи' жазыңыз.`
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
      appointmentData: { service: 'Не указано' }
    };
    
    this.bookingStates.set(sessionId, state);
    return lang === 'kz'
      ? "Керемет! Өтінішіміз, өзіңіздің атыңыз бен тегіңізді айтыңыз."
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
        ? "Кешіріңіз, ақпараттарын таба алмадым. Шақырыңыз: +7 777 123 45 67"
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
    
    const textMatch = lower.match(/^(\d{1,2})\s+([а-яё]+)$/i);
    if (textMatch) {
      const day = parseInt(textMatch[1]);
      const monthName = textMatch[2].toLowerCase();
      const monthNames: Record<string, number> = {
        'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3,
        'мая': 4, 'июня': 5, 'июля': 6, 'августа': 7,
        'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11,
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
      return { 
        valid: false, 
        error: `Неверный номер. Формат: +7 или 8, затем код оператора (701, 702, 705, 706, 707, 708, 747, 771, 775, 776, 777, 778, 779) и 7 цифр.

Пример: +7 777 123 45 67` 
      };
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
      label = 'сегодня';
    } else if (lower === 'завтра' || lower === 'ертең') {
      targetDate = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      label = 'завтра';
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
        // Текстовый формат (25 июня)
        const textMatch = lower.match(/^(\d{1,2})\s+([а-яё]+)$/i);
        if (textMatch) {
          const day = parseInt(textMatch[1]);
          const monthNames: Record<string, number> = {
            'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3,
            'мая': 4, 'июня': 5, 'июля': 6, 'августа': 7,
            'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11,
          };
          const month = monthNames[textMatch[2].toLowerCase()] ?? 0;
          if (month === 0) {
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
    const textMatch = lower.match(/^(\d{1,2})\s+([а-яё]+)$/i);
    if (textMatch) {
      day = parseInt(textMatch[1]);
      const monthName = textMatch[2].toLowerCase();
      
      const monthNames: Record<string, number> = {
        'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4,
        'мая': 5, 'июня': 6, 'июля': 7, 'августа': 8,
        'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
        'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4,
        'май': 5, 'июнь': 6, 'июль': 7, 'август': 8,
        'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12,
      };
      
      month = monthNames[monthName];
      year = new Date().getFullYear();
      
      if (!month) {
        return { valid: false, error: `Не распознал месяц "${textMatch[2]}". Пожалуйста, используйте формат: 25.06 или 25 июня.` };
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
