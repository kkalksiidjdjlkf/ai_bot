import re

with open('nomad-whatsapp-bot/src/services/rag_service.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Insert parseDateAndTime method
parse_func = """
  public parseDateAndTime(text: string): { extractedDateText?: string, extractedTimeStr?: string } {
    const lowerTextStr = text.toLowerCase().trim();
    let extractedDateText = '';
    let extractedTimeStr = '';
    let extractedHour = -1;
    let extractedMinute = -1;
    
    const monthNames = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря',
                        'январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь',
                        'қаңтар','ақпан','наурыз','сәуір','мамыр','маусым','шілде','тамыз','қыркүйек','қазан','қараша','желтоқсан',
                        'қантар','акпан','сауир','шилде','кыркуйек','казан','караша','желтоксан'];
    
    const relativeDates = ['сегодня', 'завтра', 'послезавтра', 'бүгін', 'ертең', 'ертен', 'бүрсігүні'];
    let dateFound = false;
    for (const rel of relativeDates) {
      if (lowerTextStr.includes(rel)) { extractedDateText = rel; dateFound = true; break; }
    }
    
    let remainingTextForTime = lowerTextStr;
    if (!dateFound) {
       const numDateMatch = lowerTextStr.match(/(\\d{1,2}[.\\-/]\\d{1,2}(?:[.\\-/]\\d{2,4})?)/);
       if (numDateMatch) { extractedDateText = numDateMatch[1]; dateFound = true; remainingTextForTime = lowerTextStr.replace(numDateMatch[1], ''); }
    } else { remainingTextForTime = lowerTextStr.replace(extractedDateText, ''); }
    
    if (!dateFound) {
       const monthPattern = monthNames.join('|');
       const textDateMatch = lowerTextStr.match(new RegExp(`(\\d{1,2})[^\\d\\p{L}]*(${monthPattern})`, 'iu'));
       if (textDateMatch) { extractedDateText = textDateMatch[0].trim(); dateFound = true; remainingTextForTime = lowerTextStr.replace(textDateMatch[0], ''); }
    }

    const timeSuffixes = ['ке', 'қе', 'ге', 'қа', 'де', 'те', 'та', 'да', 'ға', 'га'];
    const suffixPattern = timeSuffixes.join('|');
    const exactTimeMatch = remainingTextForTime.match(/([0-2]?\\d)[:.]([0-5]\\d)/);
    const suffixTimeMatch = remainingTextForTime.match(new RegExp(`([0-2]?\\d)[^\\d\\p{L}]*(?:${suffixPattern})(?!\\p{L})`, 'iu'));
    const prefixTimeMatch = remainingTextForTime.match(/(?:в|сағат|сагат|к|на|сағ|уақыт)[^\\d\\p{L}]*([0-2]?\\d)(?:[^\\d\\p{L}]*([0-5]\\d))?/iu);
    const loneHourMatch = remainingTextForTime.match(/(?:^|\\s)(0?[8-9]|1[0-9]|20)(?=\\s|$)/);

    if (exactTimeMatch) { extractedHour = parseInt(exactTimeMatch[1]); extractedMinute = parseInt(exactTimeMatch[2]); }
    else if (suffixTimeMatch) { extractedHour = parseInt(suffixTimeMatch[1]); extractedMinute = 0; }
    else if (prefixTimeMatch) { extractedHour = parseInt(prefixTimeMatch[1]); extractedMinute = prefixTimeMatch[2] ? parseInt(prefixTimeMatch[2]) : 0; }
    else if (loneHourMatch) { extractedHour = parseInt(loneHourMatch[1]); extractedMinute = 0; }

    if (extractedHour >= 1 && extractedHour <= 7) extractedHour += 12;
    if (extractedHour >= 8 && extractedHour <= 20 && extractedMinute >= 0 && extractedMinute <= 59) {
      extractedTimeStr = `${extractedHour.toString().padStart(2, '0')}:${extractedMinute.toString().padStart(2, '0')}`;
    }
    return { extractedDateText: extractedDateText || undefined, extractedTimeStr: extractedTimeStr || undefined };
  }
"""

if "public parseDateAndTime" not in content:
    content = content.replace("private validatePhone(phoneStr: string):", parse_func + "\n  private validatePhone(phoneStr: string):")

with open('nomad-whatsapp-bot/src/services/rag_service.ts', 'w', encoding='utf-8') as f:
    f.write(content)
