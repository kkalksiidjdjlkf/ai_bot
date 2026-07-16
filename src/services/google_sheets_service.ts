/**
 * Google Sheets Service для Nomad Clinic
 * Сохранение записей в Google Таблицы
 */

import { google } from 'googleapis';
import * as path from 'path';
import * as fs from 'fs';

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

export class GoogleSheetsService {
  public sheets: any;
  public spreadsheetId: string;
  public sheetName: string;
  public initialized: boolean = false;

  constructor() {
    this.spreadsheetId = '';
    this.sheetName = 'Sheet1';
  }

  /**
   * Обновить ID таблицы и имя листа (вызывается после загрузки .env)
   */
  updateConfig(): void {
    const newId = process.env.GOOGLE_SHEETS_ID;
    const newName = process.env.GOOGLE_SHEETS_SHEET_NAME;
    if (newId && newId !== this.spreadsheetId) {
      this.spreadsheetId = newId;
      console.log('📋 Google Sheets ID установлен:', this.spreadsheetId);
    }
    if (newName && newName !== this.sheetName) {
      this.sheetName = newName;
    }
  }

  /**
   * Получить путь к текущему листу
   */
  private getSheetRange(rangeSuffix: string = ''): string {
    return `${this.sheetName}!${rangeSuffix}`;
  }

  /**
   * Инициализация клиента Google Sheets
   */
  async initialize(): Promise<boolean> {
    try {
      // Путь к ключу сервисного аккаунта
      const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
                      path.join(__dirname, '..', 'google-credentials.json');

      // Альтернативные имена файла ключа
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

      // ИСПРАВЛЕНО: проверка по foundKey, а не keyPath
      if (!fs.existsSync(foundKey)) {
        console.log('⚠️  Файл ключа Google API не найден. Google Sheets отключен.');
        console.log(`   Искал: ${keyPath}`);
        return false;
      }

      const auth = new google.auth.GoogleAuth({
        keyFile: foundKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      this.sheets = google.sheets({ version: 'v4', auth });
      this.initialized = true;
      console.log(`✅ Google Sheets подключен (лист: "${this.sheetName}")`);
      return true;
    } catch (error: any) {
      console.log(`⚠️  Ошибка подключения Google Sheets: ${error.message}`);
      return false;
    }
  }

  /**
   * Проверить существование листа и создать если нет
   */
  private async ensureSheetExists(): Promise<boolean> {
    try {
      // Получаем информацию о таблице
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const sheets = spreadsheet.data.sheets || [];
      const sheetExists = sheets.some((s: any) => 
        (s.properties as any)?.sheetName === this.sheetName
      );

      if (!sheetExists) {
        console.log(`📋 Создаю лист "${this.sheetName}"...`);
        try {
          await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests: [
                {
                  addSheet: {
                    properties: {
                      title: this.sheetName,
                    },
                  },
                },
              ],
            },
          });
          console.log(`✅ Лист "${this.sheetName}" создан`);
        } catch (addError: any) {
          // Игнорируем ошибку "лист уже существует"
          if (addError.message?.includes('already exists')) {
            console.log(`ℹ️  Лист "${this.sheetName}" уже существует, используем его`);
          } else {
            throw addError;
          }
        }
        return true;
      }

      console.log(`✅ Лист "${this.sheetName}" найден`);
      return true;
    } catch (error: any) {
      console.log(`⚠️  Не удалось проверить лист "${this.sheetName}": ${error.message}`);
      // Продолжаем работу — append может сработать и без явного создания
      return true;
    }
  }

  /**
   * Добавить запись в таблицу
   */
  async addBooking(booking: BookingRecord): Promise<boolean> {
    if (!this.initialized) {
      const initialized = await this.initialize();
      if (!initialized) {
        console.log('⚠️ Google Sheets не инициализирован');
        return false;
      }
    }

    if (!this.spreadsheetId) {
      console.log('⚠️ GOOGLE_SHEETS_ID не установлен');
      return false;
    }

    try {
      // Убеждаемся что лист существует
      await this.ensureSheetExists();

      const row = [
        booking.id,
        booking.patient_name,
        booking.phone,
        booking.age,
        booking.service_name,
        booking.date,
        booking.time,
        booking.created_at,
        booking.status,
      ];

      console.log(`📝 Добавляем запись в Google Sheets: ${booking.id}`);
      console.log(`   Пациент: ${booking.patient_name}, Услуга: ${booking.service_name}`);
      
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: this.getSheetRange('A:I'),
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [row],
        },
      });

      console.log(`✅ Запись ${booking.id} успешно добавлена в Google Sheets`);
      return true;
    } catch (error: any) {
      console.error(`❌ Ошибка записи в Google Sheets: ${error.message}`);
      console.error(`   Spreadsheet ID: ${this.spreadsheetId}`);
      console.error(`   Лист: ${this.sheetName}`);
      return false;
    }
  }

  /**
   * Получить все записи из таблицы
   */
  async getAllBookings(): Promise<BookingRecord[]> {
    if (!this.initialized) {
      const initialized = await this.initialize();
      if (!initialized) return [];
    }

    if (!this.spreadsheetId) {
      return [];
    }

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.getSheetRange('A:I'),
      });

      const rows = response.data.values || [];
      // Пропускаем заголовок (первая строка)
      return rows.slice(1).map((row: any[]) => ({
        id: row[0] || '',
        patient_name: row[1] || '',
        phone: row[2] || '',
        age: parseInt(row[3]) || 0,
        service_name: row[4] || '',
        date: row[5] || '',
        time: row[6] || '',
        created_at: row[7] || '',
        status: row[8] || 'confirmed',
      }));
    } catch (error: any) {
      console.error(`❌ Ошибка чтения Google Sheets: ${error.message}`);
      return [];
    }
  }

  /**
   * Обновить статус записи
   */
  async updateBookingStatus(bookingId: string, status: string): Promise<boolean> {
    if (!this.initialized) {
      const initialized = await this.initialize();
      if (!initialized) return false;
    }

    if (!this.spreadsheetId) {
      return false;
    }

    try {
      // Найти строку с записью
      const bookings = await this.getAllBookings();
      const rowIndex = bookings.findIndex(b => b.id === bookingId);
      
      if (rowIndex === -1) {
        console.log(`⚠️  Запись ${bookingId} не найдена`);
        return false;
      }

      // Обновить статус (строка = rowIndex + 2, потому что 1 = заголовок, 0-indexed)
      const range = this.getSheetRange(`I${rowIndex + 2}`);
      
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[status]],
        },
      });

      console.log(`📝 Статус записи ${bookingId} обновлён на ${status}`);
      return true;
    } catch (error: any) {
      console.error(`❌ Ошибка обновления Google Sheets: ${error.message}`);
      return false;
    }
  }

  /**
   * Создать заголовок таблицы (если нет)
   */
  async createHeaders(): Promise<boolean> {
    if (!this.initialized) {
      const initialized = await this.initialize();
      if (!initialized) return false;
    }

    if (!this.spreadsheetId) {
      return false;
    }

    try {
      // Убеждаемся что лист существует
      await this.ensureSheetExists();

      const headers = [
        'ID записи',
        'Имя пациента',
        'Телефон',
        'Возраст',
        'Услуга',
        'Дата',
        'Время',
        'Создано',
        'Статус',
      ];

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: this.getSheetRange('A1:I1'),
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [headers],
        },
      });

      console.log(`✅ Заголовки таблицы на листе "${this.sheetName}" созданы`);
      return true;
    } catch (error: any) {
      console.error(`❌ Ошибка создания заголовков: ${error.message}`);
      return false;
    }
  }
}

// Создаём сервис позже, после загрузки .env
let _sheetsService: GoogleSheetsService | null = null;

export function getSheetsService(): GoogleSheetsService {
  if (!_sheetsService) {
    _sheetsService = new GoogleSheetsService();
    _sheetsService.updateConfig();
  }
  return _sheetsService;
}

