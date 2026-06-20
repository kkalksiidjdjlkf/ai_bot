# 🏥 Nomad Clinic WhatsApp Bot с RAG

## ✅ ГОТОВО К РАБОТЕ!

WhatsApp бот для Nomad Clinic с AI ассистентом на базе RAG (Retrieval Augmented Generation).

## 🚀 Быстрый старт

### 1. Запуск бота

```bash
cd nomad-whatsapp-bot
npm run build
npm start
```

### 2. Сканирование QR кода

Бот покажет QR код. Отсканируйте через WhatsApp:
- Настройки → Подключенные устройства → Подключить устройство

### 3. Готово! 🎉

Бот отвечает на вопросы о услугах, ценах, врачах и т.д.

## 🤖 RAG (AI Ассистент)

Бот использует Llama 3.1 8B (Ollama) для ответов на вопросы на основе базы знаний.

### Как работает:
1. Клиент пишет вопрос
2. BOT ищет информацию в JSON файлах
3. Llama 3.1 8B генерирует ответ
4. Ответ отправляется клиенту

### Установка Ollama:
```bash
# 1. Установите Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. Загрузите модель Llama 3.1 8B
ollama pull llama3.1:8b

# 3. Проверьте
ollama run llama3.1:8b "Привет"
```

### База знаний:
- `src/data/services.json` - услуги и цены
- `src/data/config.json` - контакты и часы работы

## 📊 Что умеет бот:

✅ Отвечает на вопросы о услугах  
✅ Называет цены и длительность  
✅ Предлагает запись на процедуры  
✅ Знает о врачах и акциях  
✅ Поддерживает историю чатов  
✅ Работает на русском и казахском  
✅ Transliteration (кириллица ↔ латиница)  

## 🔧 Настройка

### Ollama:
```bash
# Убедитесь что Ollama запущен
ollama ps

# Файл .env уже создан
cat .env
```

### Изменить URL Ollama (если не localhost):
```bash
# .env
OLLAMA_BASE_URL=http://your-ollama-server:11434
```

### Добавить новые услуги:
Редактируйте `src/data/services.json`:
```json
{
    "services": [
        {
            "id": "new_service",
            "name": "Новая услуга",
            "price": 10000,
            "duration": "30 мин",
            "keywords": ["ключевое", "слово"]
        }
    ]
}
```

### Добавить врачей:
```json
{
    "doctors": [
        {"id": "doc_4", "name": "Имя Фамилия", "specialty": "Врач", "experience": "5 лет"}
    ]
}
```

## 📁 Структура проекта

```
nomad-whatsapp-bot/
├── .env                    # OLLAMA_BASE_URL
├── src/
│   ├── index.ts            # Главный файл (RAG + WhatsApp)
│   ├── services/
│   │   └── rag_service.ts  # RAG система
│   ├── bot/
│   │   └── bot_logic.ts    # Логика бота
│   ├── data/               # База знаний
│   │   ├── services.json
│   │   └── config.json
│   └── utils/
│       └── helpers.ts      # Утилиты
├── auth_info/              # Сессия WhatsApp
└── test_rag.ts             # Тест RAG
```

## 🧪 Тестирование

### Тест RAG:
```bash
npx ts-node test_rag.ts
```

### Запуск dev режима:
```bash
npx ts-node src/index.ts
```

## ⚠️ Известные ограничения

### Ollama:
- Модель llama3.1:8b требует ~5 ГБ RAM
- Убедитесь что Ollama запущен: `ollama ps`
- Если модель не загружена: `ollama pull llama3.1:8b`

### QR код:
- Действует 2 минуты
- Если просрочен - бот перезапустится и покажет новый

## 📞 Поддержка

Если бот не работает:
```bash
# Проверить Ollama
ollama ps

# Пересобрать
npm run build

# Проверить конфиг
cat .env

# Проверить данные
ls src/data/
```

## 🎯 Следующие шаги

- [ ] Добавить PDF прайс-лист
- [ ] Добавить FAQ в базу знаний
- [ ] Добавить аналитику сообщений
- [ ] Мультиязычность (EN, KZ)

## 📄 Лицензия

MIT