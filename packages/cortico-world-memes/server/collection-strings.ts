import type { Language } from 'cortico/core/language.ts';
const labels: Record<Language,[string,string]> = {
 zh:['收集收到的图片到待审核','每日收集上限（张，0 停止）'], 'zh-Hant':['收集收到的圖片至待審核','每日收集上限（張，0 停止）'],
 en:['Collect received images for review','Daily collection limit (0 stops collection)'],
 ja:['受信画像をレビュー待ちに収集','1日の収集上限（0で停止）'], ko:['받은 이미지를 검토 대기 목록에 수집','일일 수집 한도 (0이면 중지)'],
 fr:['Collecter les images reçues pour validation','Limite quotidienne de collecte (0 pour arrêter)'],
 de:['Empfangene Bilder zur Prüfung sammeln','Tägliches Sammellimit (0 stoppt die Sammlung)'],
 'es-419':['Recopilar imágenes recibidas para revisión','Límite diario de recopilación (0 para detener)'],
 'pt-BR':['Coletar imagens recebidas para revisão','Limite diário de coleta (0 para parar)'],
 it:['Raccogli immagini ricevute da approvare','Limite giornaliero di raccolta (0 per fermare)'],
 ru:['Собирать полученные изображения для проверки','Дневной лимит сбора (0 — остановить)'],
};
export function collectionLabels(language:Language){return labels[language];}
