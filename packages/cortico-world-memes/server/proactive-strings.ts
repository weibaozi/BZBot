import type { Language } from 'cortico/core/language.ts';
const labels: Record<Language, [string, string]> = {
  zh: ['主动搜索提示概率（%）', '每批聊天消息抽取一次，仅追加搜索提醒，不强制发图。0 关闭随机提醒；用户明确要图不受影响。'],
  'zh-Hant': ['主動搜尋提示機率（%）', '每批聊天訊息抽取一次，僅追加搜尋提醒，不強制傳圖。0 關閉隨機提醒；使用者明確索圖不受影響。'],
  en: ['Proactive search hint probability (%)', 'One draw per chat batch adds a search reminder, not a forced image. Zero disables reminders; explicit image requests are unaffected.'],
  ja: ['自発的な検索リマインダーの確率（%）', '受信メッセージの一群ごとに抽選し、検索を促します。画像送信は強制しません。0で無効。明示的な画像要求は対象外です。'],
  ko: ['능동 검색 알림 확률 (%)', '채팅 메시지 묶음마다 한 번 추첨해 검색을 권합니다. 이미지 전송은 강제하지 않습니다. 0은 알림만 끄며 명시적 이미지 요청에는 영향이 없습니다.'],
  fr: ['Probabilité de rappel de recherche (%)', 'Un tirage par lot de messages suggère une recherche sans imposer une image. Zéro désactive les rappels, pas les demandes explicites.'],
  de: ['Wahrscheinlichkeit eines Suchhinweises (%)', 'Eine Ziehung pro Nachrichtenstapel regt die Suche an, ohne ein Bild zu erzwingen. Null deaktiviert Hinweise, nicht ausdrückliche Bildwünsche.'],
  'es-419': ['Probabilidad de sugerir una búsqueda (%)', 'Un sorteo por grupo de mensajes sugiere buscar sin obligar a enviar imágenes. Cero desactiva sugerencias, no solicitudes explícitas.'],
  'pt-BR': ['Probabilidade de sugerir uma busca (%)', 'Um sorteio por lote de mensagens sugere uma busca sem forçar imagens. Zero desativa sugestões, não pedidos explícitos.'],
  it: ['Probabilità di suggerire una ricerca (%)', 'Un sorteggio per gruppo di messaggi suggerisce una ricerca senza imporre immagini. Zero disattiva i suggerimenti, non le richieste esplicite.'],
  ru: ['Вероятность подсказки поиска (%)', 'Одна попытка на пакет сообщений добавляет подсказку поиска, не обязывая отправлять картинку. Ноль отключает подсказки, но не явные запросы изображений.'],
};
export function proactiveStrings(language: Language) { const [title, description] = labels[language]; return { title, description }; }
