/**
 * Google Calendar Service для Nomad Clinic
 * Интеграция с Google Calendar для проверки доступных слотов и добавления записей
 */

import { google } from 'googleapis';
import * as path from 'path';
import * as fs from 'fs';

interface CalendarEvent {
  id?: string;
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: { email: string }[];
}

interface AvailableSlot {
  start: string;
  end: string;
}

export class GoogleCalendarService {
  private calendar: any;
  private calendarId: string;
  private initialized: boolean = false;
  private enabled: boolean = false;

  constructor() {
    this.calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  }

  /**
   * Инициализация клиента Google Calendar
   */
  async initialize(): Promise<boolean> {
    // Проверяем enabled при инициализации (а не в constructor, когда .env ещё не загружен)
    this.enabled = process.env.GOOGLE_CALENDAR_ENABLED === 'true';
    if (!this.enabled) {
      console.log('ℹ️ Google Calendar отключен (GOOGLE_CALENDAR_ENABLED !== true)');
      return false;
    }

    try {
      const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
                      path.join(__dirname, '..', 'google-credentials.json');

      const alternativeKeys = [
        path.join(__dirname, '..', 'nomds_sheet_key.json'),
        path.join(__dirname, '..', 'nomad_sheet_key.json'),
      ];

      let foundKey = keyPath;
      if (!fs.existsSync(keyPath)) {
        for (const altKey of alternativeKeys) {
          if (fs.existsSync(altKey)) {
            foundKey = altKey;
            console.log(`🔑 Найден ключ: ${altKey}`);
            break;
          }
        }
      }

      if (!fs.existsSync(foundKey)) {
        console.log('⚠️ Файл ключа Google API не найден. Google Calendar отключен.');
        return false;
      }

      const auth = new google.auth.GoogleAuth({
        keyFile: foundKey,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });

      this.calendar = google.calendar({ version: 'v3', auth });
      this.initialized = true;
      console.log('✅ Google Calendar подключен');
      return true;
    } catch (error: any) {
      console.log(`⚠️ Ошибка подключения Google Calendar: ${error.message}`);
      return false;
    }
  }

  /**
   * Проверка доступности слота
   */
  async isSlotAvailable(date: Date, startTime: string, durationMinutes: number = 30): Promise<boolean> {
    if (!this.initialized) {
      const initialized = await this.initialize();
      if (!initialized) return true; // Если календарь не подключен, считаем слот доступным
    }

    try {
      const [hours, minutes] = startTime.split(':').map(Number);
      const startDateTime = new Date(date);
      startDateTime.setHours(hours, minutes, 0, 0);
      
      const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60000);

      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: startDateTime.toISOString(),
          timeMax: endDateTime.toISOString(),
          items: [{ id: this.calendarId }],
        },
      });

      const calendars = response.data.calendars;
      const calendar = calendars[this.calendarId];
      
      if (!calendar || !calendar.busy || calendar.busy.length === 0) {
        return true;
      }

      // Проверяем, есть ли пересечения
      for (const busy of calendar.busy) {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        
        if (startDateTime < busyEnd && endDateTime > busyStart) {
          return false;
        }
      }

      return true;
    } catch (error: any) {
      console.error(`❌ Ошибка проверки слота: ${error.message}`);
      return true; // В случае ошибки считаем слот доступным
    }
  }

  /**
   * Получить доступные слоты на дату
   */
  async getAvailableSlots(date: Date, baseTimes: string[], durationMinutes: number = 30): Promise<string[]> {
    if (!this.initialized) {
      const initialized = await this.initialize();
      if (!initialized) return baseTimes;
    }

    const availableSlots: string[] = [];

    for (const time of baseTimes) {
      const isAvailable = await this.isSlotAvailable(date, time, durationMinutes);
      if (isAvailable) {
        availableSlots.push(time);
      }
    }

    return availableSlots;
  }

  /**
   * Создать событие в календаре
   */
  async createEvent(booking: {
    id: string;
    patient_name: string;
    phone: string;
    age: number;
    service_name: string;
    date: string;
    time: string;
  }): Promise<boolean> {
    if (!this.initialized) {
      const initialized = await this.initialize();
      if (!initialized) {
        console.log('⚠️ Google Calendar не инициализирован');
        return false;
      }
    }

    try {
      // Парсим дату
      const eventDate = this.parseDate(booking.date);
      const [hours, minutes] = booking.time.split(':').map(Number);
      
      const startDateTime = new Date(eventDate);
      startDateTime.setHours(hours, minutes, 0, 0);
      
      const endDateTime = new Date(startDateTime.getTime() + 30 * 60000); // 30 минут по умолчанию

      const event: CalendarEvent = {
        summary: `🏥 ${booking.service_name} - ${booking.patient_name}`,
        description: `Номер записи: ${booking.id}\nПациент: ${booking.patient_name}\nТелефон: ${booking.phone}\nВозраст: ${booking.age}\nУслуга: ${booking.service_name}`,
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: 'Asia/Almaty',
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: 'Asia/Almaty',
        },
        attendees: [],
      };

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: event,
      });

      console.log(`✅ Событие создано в Google Calendar: ${response.data.id}`);
      return true;
    } catch (error: any) {
      console.error(`❌ Ошибка создания события: ${error.message}`);
      return false;
    }
  }

  /**
   * Парсинг даты из строки
   */
  private parseDate(dateStr: string): Date {
    const lower = dateStr.toLowerCase().trim();
    const today = new Date();
    
    if (lower === 'сегодня' || lower === 'бүгін') {
      return today;
    }
    
    if (lower === 'завтра' || lower === 'ертең') {
      return new Date(today.getTime() + 24 * 60 * 60 * 1000);
    }
    
    if (lower === 'послезавтра') {
      return new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
    }
    
    // Парсим формат 25.06 или 25.06.26
    const numMatch = lower.match(/^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?$/);
    if (numMatch) {
      const day = parseInt(numMatch[1]);
      const month = parseInt(numMatch[2]) - 1; // Месяцы в JS с 0
      let year = numMatch[3] ? parseInt(numMatch[3]) : today.getFullYear();
      if (year < 100) year = 2000 + year;
      return new Date(year, month, day);
    }
    
    // Парсим формат "25 июня"
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

  /**
   * Отменить событие в календаре
   */
  async cancelEvent(eventId: string): Promise<boolean> {
    if (!this.initialized) return false;

    try {
      await this.calendar.events.delete({
        calendarId: this.calendarId,
        eventId: eventId,
      });
      console.log(`✅ Событие ${eventId} удалено из календаря`);
      return true;
    } catch (error: any) {
      console.error(`❌ Ошибка удаления события: ${error.message}`);
      return false;
    }
  }
}

// Singleton instance
const calendarService = new GoogleCalendarService();
export { calendarService };
