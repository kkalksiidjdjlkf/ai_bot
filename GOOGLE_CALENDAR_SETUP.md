<<<<<<< HEAD
# 📅 Настройка Google Calendar для Nomad Clinic

## Шаг 1: Создание проекта в Google Cloud Console

1. Перейдите на [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект (или используйте существующий)
3. Назовите его, например, "Nomad Clinic Bot"

## Шаг 2: Включение Google Calendar API

1. В навигации выберите **APIs & Services** → **Library**
2. Найдите **Google Calendar API**
3. Нажмите **Enable**

## Шаг 3: Создание сервисного аккаунта

1. Перейдите в **IAM & Admin** → **Service Accounts**
2. Нажмите **+ Create Service Account**
3. Введите имя, например, "nomad-bot-calendar"
4. Нажмите **Create and Continue**
5. Можно пропустить роли (или выбрать Basic → Viewer)
6. Нажмите **Done**

## Шаг 4: Создание ключа API

1. Нажмите на созданный сервисный аккаунт
2. Перейдите во вкладку **Keys**
3. Нажмите **Add Key** → **Create new key**
4. Выберите формат **JSON**
5. Нажмите **Create**
6. Файл `credentials.json` сохранится автоматически

## Шаг 5: Настройка прав доступа (если календарь общий)

Если вы используете общий календарь клиники:

1. Откройте Google Calendar
2. Найдите календарь клиники
3. Нажмите **⋮** → **Настройки и общие**
4. В разделе **Доступность доступа** добавьте сервисный аккаунт
5. Email сервисного аккаунта можно найти в `credentials.json` (поле `client_email`)
6. Дайте права **Вносить изменения и управлять**

## Шаг 6: Установка зависимостей

```bash
pip install -r requirements.txt
```

## Шаг 7: Настройка .env

```bash
cp .env.example .env
```

Отредактируйте `.env`:
```env
GOOGLE_CALENDAR_ID=primary
GOOGLE_CREDENTIALS_PATH=credentials.json
```

Если используете общий календарь, укажите его email вместо `primary`:
```env
GOOGLE_CALENDAR_ID=clinic@nomad.kz
```

## Шаг 8: Проверка

```bash
python -c "from google_calendar import get_google_calendar; gc = get_google_calendar(); gc.test_connection()"
```

Должно вывести:
```
✅ Подключено к календарю: Nomad Clinic Calendar
```

## Шаг 9: Тестовая запись

Запустите бота и запишите пациента:
```bash
python terminal_bot.py
```

Проверьте Google Calendar — должно появиться событие с:
- Уведомлением за 1 день (email)
- Уведомлением за 1 час (popup)

## Возможные проблемы

### "Quota exceeded"
- Проверьте, что API включён
- Подождите 24 часа (лимит для новых проектов)

### "Access not configured"
- Убедитесь что Google Calendar API включён
- Проверьте права сервисного аккаунта

### "Invalid credentials"
- Проверьте путь к credentials.json
- Убедитесь что файл не повреждён
- Пересоздайте ключ если нужно

### Календарь не отображается
- Добавьте сервисный аккаунт в общий доступ календаря
- Проверьте EMAIL в credentials.json
=======
# Настройка Google Calendar для Nomad Clinic Bot

## Возможности

✅ **Проверка доступных слотов** - бот проверяет реальные занятые времена в календаре
✅ **Автоматическое создание событий** - при подтверждении записи создаётся событие в Google Calendar
✅ **Синхронизация с Google Sheets** - данные дублируются в таблицу и календарь

## Шаг 1: Создание сервисного аккаунта Google

1. Откройте [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект или выберите существующий
3. Включите API:
   - **Google Calendar API**
   - **Google Sheets API** (если используете таблицы)

4. Перейдите в **APIs & Services → Credentials**
5. Нажмите **Create Credentials → Service Account**
6. Заполните данные и создайте сервисный аккаунт
7. На вкладке **Keys** создайте новый ключ в формате **JSON**
8. Скачайте файл ключа и сохраните как `google-credentials.json` в корень проекта

## Шаг 2: Настройка Google Calendar

### Вариант А: Использование личного календаря (primary)

Просто используйте календарь сервисного аккаунта по умолчанию.

### Вариант Б: Использование общего календаря клиники

1. Создайте новый календарь в Google Calendar
2. Откройте **Настройки календаря → Доступ для конкретных пользователей**
3. Добавьте email сервисного аккаунта (из google-credentials.json)
4. Предоставьте права **Вносить изменения в события**
5. Скопируйте **Calendar ID** из настроек календаря

## Шаг 3: Настройка переменных окружения

Скопируйте `.env.example` в `.env` и настройте:

```bash
# Google Sheets (опционально)
GOOGLE_SHEETS_ENABLED=true
GOOGLE_SHEETS_ID=ваш_id_таблицы

# Google Calendar
GOOGLE_CALENDAR_ENABLED=true
GOOGLE_CALENDAR_ID=ваш_id_календаря_или_primary

# Путь к ключу (если отличается от стандартного)
GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json
```

### Где найти GOOGLE_SHEETS_ID:
- Откройте Google Таблицу
- URL: `https://docs.google.com/spreadsheets/d/1ABC123xyz.../edit`
- ID = `1ABC123xyz...` (между `/d/` и `/edit`)

### Где найти GOOGLE_CALENDAR_ID:
- Откройте Google Calendar → Настройки
- Выберите календарь
- **Calendar ID** указан в разделе "Интеграция календаря"
- Обычно: `primary` или `xxxx@group.calendar.google.com`

## Шаг 4: Предоставление доступа к календарю

Для сервисного аккаунта нужен доступ к календарю:

1. Откройте Google Calendar
2. Нажмите на календарь → **Настройки и доступ**
3. В разделе **Доступ для конкретных пользователей** добавьте:
   - Email сервисного аккаунта (из JSON-ключа)
   - Права: **Вносить изменения в события**

## Шаг 5: Проверка работы

Запустите бота:

```bash
npm start
```

В логах должно быть:
```
✅ Google Sheets подключен
✅ Google Calendar подключен
```

## Структура событий в календаре

При создании записи бот создаёт событие:

- **Название**: 🏥 [Услуга] - [Имя пациента]
- **Описание**: Номер записи, телефон, возраст, услуга
- **Время**: [Дата] [Время] (длительность 30 мин)
- **Часовой пояс**: Asia/Almaty

## Переопределение слотов по умолчанию

В `src/data/config.json` можно настроить слоты:

```json
{
  "booking_slots": {
    "base_times": ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"],
    "min_slots": 4,
    "max_slots": 6
  }
}
```

## Отладка

### Проверка подключения к Calendar:

```bash
# Включите логирование
export DEBUG=google-calendar:*
npm start
```

### Тестовая запись:

1. Напишите боту: `МРТ`
2. Выберите услугу
3. Пройдите процесс бронирования
4. Проверьте Google Calendar - событие должно появиться

##常见问题

### ❌ "Google Calendar не инициализирован"

- Проверьте путь к `google-credentials.json`
- Убедитесь что `GOOGLE_CALENDAR_ENABLED=true`
- Проверьте права сервисного аккаунта

### ❌ "Нет доступных слотов"

- Calendar API работает, но все слоты заняты
- Проверьте календарь вручную
- Настройте `booking_slots` в config.json

### ❌ "Ошибка создания события"

- Проверьте права доступа к календарю
- Убедитесь что Calendar ID правильный
- Проверьте часовой пояс

## Безопасность

⚠️ **Никогда не коммитьте `google-credentials.json` в Git!**

Добавьте в `.gitignore`:
```
google-credentials.json
*.json
!package.json
!tsconfig.json
```
>>>>>>> 786a475b3a8f9a770012696d2fde67960925fa24
