import type { Language } from 'cortico/core/language.ts';
export const permissionStrings: Record<Language, [string, string, string, string]> = {
  zh: ['额外可写目录', '允许命令联网', '允许网页搜索', '已有目录的绝对路径，多个目录用分号分隔。留空只允许写入任务目录。'],
  'zh-Hant': ['額外可寫目錄', '允許命令連網', '允許網頁搜尋', '現有目錄的絕對路徑，多個目錄以分號分隔。留空僅允許寫入任務目錄。'],
  en: ['Additional writable directories', 'Allow command network access', 'Allow web search', 'Absolute paths to existing directories, separated by semicolons. Leave empty for task-only writes.'],
  ja: ['追加の書き込み可能ディレクトリ', 'コマンドのネット接続を許可', 'ウェブ検索を許可', '既存ディレクトリの絶対パスをセミコロンで区切ります。空欄ではタスク内のみ書き込み可能。'],
  ko: ['추가 쓰기 가능 디렉터리', '명령 네트워크 접근 허용', '웹 검색 허용', '기존 디렉터리의 절대 경로를 세미콜론으로 구분합니다. 비우면 작업 디렉터리에만 쓸 수 있습니다.'],
  fr: ['Dossiers supplémentaires accessibles en écriture', 'Autoriser le réseau pour les commandes', 'Autoriser la recherche web', 'Chemins absolus existants séparés par des points-virgules. Vide : écriture limitée au dossier de tâche.'],
  de: ['Zusätzliche beschreibbare Verzeichnisse', 'Netzwerkzugriff für Befehle erlauben', 'Websuche erlauben', 'Absolute Pfade vorhandener Verzeichnisse, mit Semikolon getrennt. Leer: nur Aufgabenverzeichnis beschreibbar.'],
  'es-419': ['Directorios adicionales de escritura', 'Permitir red para comandos', 'Permitir búsqueda web', 'Rutas absolutas existentes separadas por punto y coma. Vacío: escritura solo en el directorio de la tarea.'],
  'pt-BR': ['Diretórios adicionais de escrita', 'Permitir rede para comandos', 'Permitir pesquisa na web', 'Caminhos absolutos existentes separados por ponto e vírgula. Vazio: escrita apenas no diretório da tarefa.'],
  it: ['Directory aggiuntive scrivibili', 'Consenti rete ai comandi', 'Consenti ricerca web', 'Percorsi assoluti esistenti separati da punti e virgola. Vuoto: scrittura solo nella directory del compito.'],
  ru: ['Дополнительные каталоги для записи', 'Разрешить сеть для команд', 'Разрешить веб-поиск', 'Абсолютные пути существующих каталогов через точку с запятой. Пусто: запись только в каталог задачи.'],
};
