# 📊 Настройка Google Sheets для бота

## Шаг 1: Создание проекта в Google Cloud

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект (или выберите существующий)
3. Назовите его, например: `Nomad Clinic Bot`

## Шаг 2: Включение Google Sheets API

1. В меню выберите **APIs & Services** → **Library**
2. Найдите **Google Sheets API**
3. Нажмите **Enable**

## Шаг 3: Создание сервисного аккаунта

1. Перейдите в **APIs & Services** → **Credentials**
2. Нажмите **Create Credentials** → **Service Account**
3. Заполните:
   - **Service account name**: `nomad-bot-sheets`
   - **Service account ID**: заполнится автоматически
   - **Description**: `Доступ бота к таблицам`
4. Нажмите **Create and Continue**
5. Пропустите роль (Step 2) → **Continue**
6. Нажмите **Done**

## Шаг 4: Создание ключа сервисного аккаунта

1. В списке сервисных аккаунтов нажмите на созданный `nomad-bot-sheets`
2. Перейдите на вкладку **Keys**
3. Нажмите **Add Key** → **Create new key**
4. Выберите формат **JSON**
5. Нажмите **Create**
6. **Скачается файл** с ключом (например: `nomad-bot-xxxxx.json`)

## Шаг 5: Создание Google Таблицы

1. Создайте новую таблицу на [sheets.google.com](https://sheets.google.com)
2. Назовите: `Nomad Clinic - Записи`
3. Переименуйте первый лист в **Записи** (внизу, дважды кликните на название)
4. Скопируйте **ID таблицы** из URL:
   ```
   https://docs.google.com/spreadsheets/d/1a2b3c4d5e6f7g8h9i0j/edit
                                            ↑ это ID
   ```

## Шаг 6: Предоставление доступа таблице

1. В таблице нажмите **Настройки доступа** (кнопка справа вверху)
2. Вставьте **email сервисного аккаунта** (из JSON-ключа, поле `client_email`)
   ```
   nomad-bot-sheets@project-id.iam.gserviceaccount.com
   ```
3. Выберите роль: **Редактор**
4. Нажмите **Готово**

## Шаг 7: Настройка проекта

1. Поместите файл ключа в папку проекта:
   ```
   ai_bot/nomad-whatsapp-bot/google-credentials.json
   ```
   *(переименуйте скачанный файл в `google-credentials.json`)*

2. Добавьте в `.env` файл:
   ```env
   # Google Sheets
   GOOGLE_SHEETS_ENABLED=true
   GOOGLE_SHEETS_ID=ваш_ID_таблицы_из_шага_5
   GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json
   ```

## Шаг 8: Установка зависимостей

```bash
cd ai_bot/nomad-whatsapp-bot
npm install
npm run build
npm start
```

## ✅ Проверка

После запуска в логе должно быть:
```
✅ Google Sheets подключен
✅ Заголовки таблицы созданы
```

При подтверждении записи в логе появится:
```
📝 Запись BK1234567890 добавлена в Google Sheets
```

## 📋 Структура таблицы

| ID записи | Имя пациента | Телефон | Возраст | Услуга | Дата | Время | Создано | Статус |
|-----------|--------------|---------|---------|--------|------|-------|---------|--------|
| BK1234567 | Иванов Иван  | +77771234567 | 35 | МРТ коленного сустава | 25.06.2024 | 14:30 | 2024-06-20T10:30:00 | confirmed |

## 🔒 Безопасность

- Храните `google-credentials.json` в секрете
- Не коммитьте файл ключей в Git (добавьте в `.gitignore`)
- Используйте отдельный сервисный аккаунт для бота
