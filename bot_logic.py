    # Логика медицинского бота

import re
import random
from datetime import datetime, timedelta
from knowledge_base import SERVICES, COMPLEXES, OPERATOR_CASES, PROMOTIONS
from config import CLINIC_NAME, WORK_HOURS, WORK_DAYS, ADDRESS, LANDMARKS, GEO_LOCATION, PHONES, WHATSAPP
from response_templates import (
    GREETINGS, PRICE_RESPONSES, COMPLEX_OFFERS, SYMPTOM_RESPONSES,
    NAME_REQUESTS, AGE_REQUESTS, PHONE_REQUESTS, DATE_REQUESTS,
    TIME_OFFERS, CONFIRMATION_REQUESTS, BOOKING_SUCCESS,
    ADDRESS_RESPONSES, SCHEDULE_RESPONSES, PHONE_INFO_RESPONSES,
    NO_DIAGNOSIS_RESPONSES, OPERATOR_TRANSFER, SOFT_SELL_PHRASES,
    get_random, format_price
)

class MedicalBot:
    def __init__(self):
        self.patient_data = {}
        self.current_step = "greeting"
        self.appointment_data = {}
        self.has_offered_promo = False  # Флаг: предлагали ли уже акцию
        self.last_service = None  # Последняя обсуждаемая услуга
        
    def get_greeting(self):
        """Приветственное сообщение"""
        return random.choice(GREETINGS).format(clinic=CLINIC_NAME)
        
    def get_resume_message(self):
        """Сообщение для возврата к сбору данных после вопроса"""
        if self.current_step == "collecting_name":
            return "Вернёмся к записи. Подскажите Ваше имя и фамилию."
        elif self.current_step == "collecting_age":
            return "Вернёмся к записи. Укажите, пожалуйста, возраст цифрами."
        elif self.current_step == "collecting_phone":
            return "Вернёмся к записи. Оставьте номер телефона для связи."
        elif self.current_step == "collecting_date":
            return "Вернёмся к записи. На какой день записать? Например: сегодня, завтра, 25 января."
        elif self.current_step == "collecting_time":
            return "Вернёмся к записи. Какое время из предложенных Вам подходит?"
        elif self.current_step == "confirming":
            return "Вернёмся к записи. Подтверждаете запись? (да/нет)"
        return ""
    
    def handle_question_in_process(self, message):
        """Обработка вопроса во время процесса записи"""
        message_lower = message.lower()
        
        if any(word in message_lower for word in ["шея", "шейн", "шейный"]):
            return "МРТ шейного отдела стоит 33 333 тенге. Его часто делают вместе с МРТ поясницы — есть комплекс «Здоровая спина» со скидкой 15% за 40 800 тг. Хотите изменить запись на комплекс?"
        
        if any(word in message_lower for word in ["голова", "головн", "головы"]):
            return "МРТ головного мозга стоит 11 111 тенге. Назначают при головных болях, мигренях, головокружениях. Хотите добавить к записи?"
        
        if any(word in message_lower for word in ["колени", "колено", "сустав"]):
            return "МРТ коленного сустава стоит 24 000 тенге. Назначают при болях в коленях, травмах. Интересует?"
        
        if any(word in message_lower for word in ["живот", "брюшн", "брюшной"]):
            return "МРТ брюшной полости стоит 44 444 тенге. Исследование 45 мин, нельзя есть 4-6 часов до него. Записать?"
        
        if any(word in message_lower for word in ["щитовид", "щитовидка"]):
            return "УЗИ щитовидной железы стоит 55 555 тенге. Быстро (15 мин), без подготовки. Сделать?"
        
        if any(word in message_lower for word in ["сосуды", "бца", "допплер"]):
            return "УЗИ сосудов шеи (БЦА) стоит 66 666 тг. Показывает состояние артерий. Делается за 20 мин. Интересно?"
        
        if any(word in message_lower for word in ["проблемы", "болезни", "обнаруж", "найдут", "покажет"]):
            return "Обследование покажет точную картину. Если найдут что-то ещё — врачи порекомендуют дополнительное исследование. Продолжим запись?"
        
        if any(word in message_lower for word in ["комплекс", "скидк", "выгодн", "два вместе"]):
            return "Комплекс «Здоровая спина» — это МРТ поясницы + МРТ шеи. Обычная цена 48 000 тг, со скидкой 15% — 40 800 тг. Оформить?"
        
        return "Могу рассказать про любую услугу (МРТ головы, шеи, живота, коленей, УЗИ). Что именно Вас интересует?"
        
    def detect_service(self, message):
        """Определение услуги по ключевым словам"""
        message_lower = message.lower()
        
        # Сначала ищем точные совпадения по ключевым словам (кроме общего "мрт" и "узи")
        for service_key, service_data in SERVICES.items():
            for keyword in service_data["keywords"]:
                # Пропускаем слишком короткие ключевые слова чтобы избежать ложных срабатываний
                if len(keyword) < 4:
                    continue
                if keyword in message_lower:
                    return service_key, service_data
        
        # Если нашли просто "мрт" или "узи" без уточнения — предлагаем выбрать
        # Проверяем что нет других уточняющих слов
        mrt_patterns = ["мрт головного", "мрт пояснич", "мрт шейн", "мрт брюш", "мрт спины", "мрт живота"]
        uzi_patterns = ["узи щитовид", "узи сосудов", "узи шеи", "узи бца"]
        
        has_specific_mrt = any(pattern in message_lower for pattern in mrt_patterns)
        has_specific_uzi = any(pattern in message_lower for pattern in uzi_patterns)
        
        if not has_specific_mrt and "мрт" in message_lower:
            return "мрт_general", None
        if not has_specific_uzi and "узи" in message_lower:
            return "узи_general", None
        
        return None, None
    
    def detect_symptom(self, message):
        """Определение услуги по симптомам/жалобам"""
        message_lower = message.lower()
        
        # Сопоставление симптомов с услугами
        symptom_map = {
            "мрт поясничного отдела": ["болит поясница", "спина болит", "боль в спине", "отдает в ногу", "поясница ноет", "болит спина", "спина боль", "боль в пояснице", "поясница болит"],
            "мрт головного мозга": ["голова болит", "головная боль", "мигрень", "голова кружится", "болит голова", "частые головные боли"],
            "мрт шейного отдела": ["болит шея", "шея хрустит", "боль в шее", "воротниковая зона", "шея болит", "боль шея"],
            "мрт коленного сустава": ["болит колено", "колено опухло", "боль в колене", "колено болит"],
            "узи щитовидной железы": ["щитовидка", "гормоны шалят", "шея увеличена", "щитовидная"],
        }
        
        for service_key, symptoms in symptom_map.items():
            for symptom in symptoms:
                if symptom in message_lower:
                    if service_key in SERVICES:
                        return SERVICES[service_key]
        
        return None
    
    def check_operator_transfer(self, message):
        """Проверка необходимости передачи оператору"""
        message_lower = message.lower()
        
        for case in OPERATOR_CASES:
            if case in message_lower:
                return True
        
        return False
    
    def find_complex(self, service_key):
        """Поиск комплекса с выбранной услугой"""
        for complex_item in COMPLEXES:
            if service_key in complex_item["services"]:
                other_services = [s for s in complex_item["services"] if s != service_key]
                return complex_item, other_services
        return None, None
    
    def get_available_times(self, date_str):
        """Генерация доступного времени"""
        base_times = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00"]
        # Немного рандомизируем доступные времена для реалистичности
        count = random.randint(4, 6)
        return random.sample(base_times, count)
    
    def process_message(self, message):
        """Обработка сообщения пациента"""
        message_lower = message.lower().strip()
        
        # Проверка на пустой ввод
        if not message or not message.strip():
            return "Извините, не понял Ваш вопрос. Попробуйте перефразировать."
        
        # === ОБРАБОТКА ОТКАЗА/ЗАВЕРШЕНИЯ (на любом этапе) ===
        if any(p in message_lower for p in ["иди на", "пошёл на", "хуй", "пиздец", "нахуй", "отъебись"]):
            self.reset()
            return "Хорошо, всего доброго! Если понадобятся услуги — обращайтесь."
        
        if any(p in message_lower for p in ["нет не нужно", "прекратить", "закончить", "всё", "хватит", "не надо", "передумал", "спасибо не надо", "всё спасибо"]):
            self.reset()
            return "Понял, завершаю. Если решите записаться — обращайтесь в любое время!"
        
        if message_lower in ["спасибо", "благодарю", "спасибо большое"]:
            self.reset()
            return "Всегда рады помочь! Если понадобятся услуги — обращайтесь. Здоровья Вам!"
        
        if message_lower in ["нет", "не хочу", "отмена", "stop", "стоп"]:
            if self.current_step != "greeting":
                self.reset()
                return "Хорошо, отменил запись. Чем ещё могу помочь?"
            else:
                return "Хорошо, не буду настаивать. Если что — обращайтесь!"
            
        # === ПРИОРИТЕТ 1: Проверка на передачу оператору ===
        if self.check_operator_transfer(message):
            return self.transfer_to_operator(message)
        
        # === ПРИОРИТЕТ 2: Проверка на симптомы/жалобы (САМЫЙ ВАЖНЫЙ!) ===
        symptom_service = self.detect_symptom(message)
        if symptom_service:
            return self.handle_symptom(message, symptom_service)
        
        # === ПРИОРИТЕТ 3: Поиск услуги в сообщении ===
        service_key, service_data = self.detect_service(message)
        
        if service_key == "мрт_general":
            return "У нас есть несколько видов МРТ:\n• МРТ головного мозга — 11 111 тг\n• МРТ поясничного отдела — 22 222 тг\n• МРТ шейного отдела — 33 333 тг\n• МРТ брюшной полости — 44 444 тг\n\nКакое исследование Вас интересует?"
        
        if service_key == "узи_general":
            return "У нас есть несколько видов УЗИ:\n• УЗИ щитовидной железы — 55 555 тг\n• УЗИ сосудов шеи (БЦА) — 66 666 тг\n\nКакое исследование Вас интересует?"
        
        if service_data:
            return self.handle_service_inquiry(service_key, service_data, message)
        
        # === ПРИОРИТЕТ 4: Обработка шагов сбора данных ===
        if self.current_step != "greeting":
            # Вопросы во время сбора данных
            if any(p in message_lower for p in ["что если", "а что", "а как", "а если", "узнать", "расскажите", "объясните", "почему", "другие проблемы", "ещё проблемы", "шейн", "голова", "колени", "живот", "щитовид", "сосуды"]):
                response = self.handle_question_in_process(message)
                response += "\n\n" + self.get_resume_message()
                return response
            
            # "Да" на комплекс
            if message_lower in ["да", "хочу комплекс", "комплекс", "оформить комплекс"]:
                service_key = None
                service_name = self.appointment_data.get("service", "")
                for key, data in SERVICES.items():
                    if data["name"] == service_name:
                        service_key = key
                        break
                if service_key:
                    complex_item, other_services = self.find_complex(service_key)
                    if complex_item:
                        self.appointment_data["service"] = f"Комплекс \"{complex_item['name']}\" ({complex_item['services'][0]} + {complex_item['services'][1]})"
                        return f"Отлично! Записываю на комплекс \"{complex_item['name']}\" за {format_price(complex_item['discounted_price'])} тг вместо {format_price(complex_item['original_price'])} тг.\n\n" + self.get_resume_message()
            
            # Сбор данных по шагам
            if self.current_step == "collecting_name":
                # Проверка что это не дата/число/согласие
                if message_lower in ["да", "ок", "ok", "yes", "хорошо", "ага"]:
                    return "Подскажите Ваше имя и фамилию (например: Иван Петров)."
                if message.strip().isdigit() or any(m in message_lower for m in ["число", "июля", "июня", "января", "февраля", "марта", "апреля", "мая", "августа", "сентября", "октября", "ноября", "декабря"]):
                    return "Сначала нужно Ваше имя и фамилия. На какой день записать — спросю потом."
                self.patient_data["name"] = message.strip()
                self.current_step = "collecting_age"
                return get_random(NAME_REQUESTS)
            
            elif self.current_step == "collecting_age":
                try:
                    age = int(message.strip())
                    if 0 < age < 120:
                        self.patient_data["age"] = age
                        self.current_step = "collecting_phone"
                        return get_random(PHONE_REQUESTS)  # ← Исправил: должен быть запрос телефона
                    else:
                        return "Пожалуйста, укажите корректный возраст (0-120 лет)."
                except ValueError:
                    return "Пожалуйста, укажите возраст цифрами."
            
            elif self.current_step == "collecting_phone":
                # Проверка что это похоже на телефон
                if any(c in message for c in ["+", "7", "8", "(", ")"]) or len(message.replace(" ", "")) >= 10:
                    self.patient_data["phone"] = message.strip()
                    self.current_step = "collecting_date"
                    return get_random(DATE_REQUESTS)
                else:
                    return "Пожалуйста, укажите номер телефона (например: +7 777 123 45 67)."
            
            elif self.current_step == "collecting_date":
                self.appointment_data["date"] = message.strip()
                times = self.get_available_times(message.strip())
                times_str = ", ".join(times[:5])
                self.current_step = "collecting_time"
                return get_random(TIME_OFFERS).format(date=message.strip(), times=times_str)
            
            elif self.current_step == "collecting_time":
                self.appointment_data["time"] = message.strip()
                self.current_step = "confirming"
                return self.create_confirmation_message()
            
            elif self.current_step == "confirming":
                if message_lower in ["да", "подтверждаю", "yes", "ок", "ok"]:
                    return self.complete_booking()
                else:
                    self.current_step = "collecting_date"
                    return "Хорошо, давайте выберем другую дату. Когда Вам удобно?"
        
        # === ПРИОРИТЕТ 5: Запросы на консультацию врача ===
        if any(p in message_lower for p in ["к врачу", "к максат", "к доктору", "к специалисту", "консультация врача", "посоветоваться с врачом", "узнать болезнь", "какая болезнь", "диагноз"]):
            return "Понимаю Ваше беспокойство. Для консультации врача нужно сначала пройти обследование (МРТ или УЗИ). По результатам врач сможет дать рекомендации.\n\nКакое исследование хотите пройти? Или опишите симптомы — подскажу какое МРТ/УЗИ нужно."
        
        # === ПРИОРИТЕТ 6: Общие вопросы ===
        if message_lower in ["да", "хочу записаться", "запишите", "записаться", "ок", "ok"]:
            self.current_step = "collecting_name"
            return "Отлично! Для записи подскажите, пожалуйста, Ваше имя и фамилию."
        
        return self.handle_general_inquiry(message)
    
    def handle_service_inquiry(self, service_key, service_data, message):
        """Обработка запроса об услуге"""
        self.last_service = service_key
        
        # Основная информация с вариативностью
        response = get_random(PRICE_RESPONSES).format(
            service=service_data["name"],
            price=format_price(service_data["price"]),
            duration=service_data["duration"]
        )
    
        # Проверка на комплекс (предлагаем с вероятностью 80%)
        complex_item, other_services = self.find_complex(service_key)
        if complex_item and random.random() < 0.8:
            other_names = [SERVICES[s]["name"] for s in other_services]
            response += get_random(COMPLEX_OFFERS).format(
                complex_name=complex_item["name"],
                services=f"{service_data['name']} + {' + '.join(other_names)}",
                discount=complex_item["discount"],
                price=format_price(complex_item["discounted_price"]),
                original=format_price(complex_item["original_price"])
            )
            self.has_offered_promo = True
        
        # Добавляем мягкую продажу если ещё не предлагали
        if not self.has_offered_promo and random.random() < 0.5:
            response += "\n\n" + get_random(SOFT_SELL_PHRASES)
            self.has_offered_promo = True
        
        self.current_step = "collecting_name"
        self.appointment_data["service"] = service_data["name"]
        
        return response
    
    def handle_general_inquiry(self, message):
        """Обработка общих вопросов"""
        message_lower = message.lower()
        
        if any(word in message_lower for word in ["адрес", "где находитесь", "как добраться", "где вы", "расположение", "метро", "район"]):
            response = get_random(ADDRESS_RESPONSES).format(
                address=ADDRESS,
                landmarks=LANDMARKS,
                geo=GEO_LOCATION
            )
            return response
        
        elif any(word in message_lower for word in ["график", "режим работы", "когда работаете", "часы работы", "время работы", "открываетесь", "закрываетесь"]):
            response = get_random(SCHEDULE_RESPONSES).format(
                days=WORK_DAYS,
                start=WORK_HOURS["start"],
                end=WORK_HOURS["end"]
            )
            return response
        
        elif any(word in message_lower for word in ["телефон", "контакт", "связаться", "позвонить", "номер", "звонок"]):
            return get_random(PHONE_INFO_RESPONSES).format(
                phones=", ".join(PHONES),
                whatsapp=WHATSAPP
            )
        
        elif any(word in message_lower for word in ["акция", "скидка", "специальное предложение", "выгодно", "дешево", "недорого"]):
            response = "🎁 Действующие акции:\n"
            for promo in PROMOTIONS:
                response += f"• {promo['title']} — {promo['description']} (до {promo['valid_until']})\n"
            response += "\n" + get_random(SOFT_SELL_PHRASES)
            return response
        
        elif any(word in message_lower for word in ["врач", "доктор", "специалист", "медик"]):
            # Проверяем контекст - если это "консультация врача" или "лечение", то не передаём сразу
            if any(word in message_lower for word in ["консультация", "лечение назнач", "диагноз постав"]):
                return get_random(NO_DIAGNOSIS_RESPONSES)
            
            from knowledge_base import DOCTORS
            response = "👨‍⚕️ Наши специалисты:\n"
            for doc in DOCTORS:
                response += f"• {doc['name']} — {doc['specialty']}, стаж {doc['experience']}\n"
            return response
        
        elif any(word in message_lower for word in ["цена", "стоимость", "сколько стоит", "прайс", "ценник", "дорого"]):
            return "У нас есть МРТ и УЗИ исследования. Подскажите, какое направление Вас интересует? Например: МРТ головного мозга, МРТ поясницы, УЗИ щитовидной железы."
        
        elif any(word in message_lower for word in ["записаться", "запись", "запишит", "приём", "время", "окно"]):
            return "Конечно, помогу записаться! Какое исследование Вам нужно? Например: МРТ головного мозга, УЗИ щитовидной железы."
        
        elif any(word in message_lower for word in ["привет", "здравствуй", "добрый", "hello", "hi"]):
            return self.get_greeting()
        
        elif any(word in message_lower for word in ["спасибо", "благодарю", "пока", "до свидания"]):
            return "Всегда рады помочь! Если будут ещё вопросы — обращайтесь. Здоровья Вам!"
        
        else:
            # Не поняли вопрос — предлагаем помощь
            response = "Извините, не совсем понял Ваш вопрос. Я могу помочь с записью на МРТ или УЗИ исследования.\n\n"
            response += "Что Вас интересует:\n"
            response += "• МРТ (головного мозга, поясницы, шеи, брюшной полости)\n"
            response += "• УЗИ (щитовидной железы, сосудов шеи)\n\n"
            response += "Или задайте вопрос про адрес, график работы, цены."
            return response
            
    def handle_symptom(self, message, service_data):
        """Обработка жалобы с эмпатией и предложением услуги"""
        # Находим ключ услуги
        service_key = None
        for key, data in SERVICES.items():
            if data == service_data:
                service_key = key
                break
        
        self.last_service = service_key
        
        response = get_random(SYMPTOM_RESPONSES).format(
            service=service_data["name"],
            price=format_price(service_data["price"])
        )
    
        complex_item, other_services = self.find_complex(self.last_service)
        if complex_item and random.random() < 0.7:
            other_names = [SERVICES[s]["name"] for s in other_services]
            response += get_random(COMPLEX_OFFERS).format(
                complex_name=complex_item["name"],
                services=f"{service_data['name']} + {' + '.join(other_names)}",
                discount=complex_item["discount"],
                price=format_price(complex_item["discounted_price"]),
                original=format_price(complex_item["original_price"])
            )
        
        self.current_step = "collecting_name"
        self.appointment_data["service"] = service_data["name"]
        
        return response
    
    def transfer_to_operator(self, message):
        """Передача оператору"""
        return get_random(OPERATOR_TRANSFER).format(phone=PHONES[0])
    
    def create_confirmation_message(self):
        """Создание сообщения подтверждения"""
        details = (
            f"👤 {self.patient_data.get('name', '')}\n"
            f"📋 {self.appointment_data.get('service', '')}\n"
            f"📅 {self.appointment_data.get('date', '')} в {self.appointment_data.get('time', '')}\n"
            f"📞 {self.patient_data.get('phone', '')}"
        )
        return get_random(CONFIRMATION_REQUESTS).format(details=details)
    
    def complete_booking(self):
        """Завершение записи"""
        # Здесь можно добавить сохранение в БД
        self.reset()
        return get_random(BOOKING_SUCCESS)
    
    def reset(self):
        """Сброс состояния бота"""
        self.patient_data = {}
        self.current_step = "greeting"
        self.appointment_data = {}
        self.has_offered_promo = False
        self.last_service = None
