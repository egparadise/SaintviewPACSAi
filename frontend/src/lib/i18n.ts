/**
 * 다국어(i18n) — 설정 ▸ 환경 ▸ 표시 언어에서 고른 언어로 UI 문자열을 바꾼다.
 *
 * ## 설계: **키 = 한국어 원문**
 * 이 저장소에는 이미 3,000개가 넘는 한국어 문자열이 코드에 직접 박혀 있다.
 * 인위적인 키(`worklist.title` 같은)를 새로 만들면 전 파일을 한 번에 고쳐야 하고,
 * 번역이 빠진 자리는 키가 그대로 노출돼 화면이 깨진다.
 * 그래서 **한국어 원문 자체를 키로** 쓴다:
 *   · 적용은 `t("워크리스트")` 처럼 감싸기만 하면 된다(점진 적용 가능).
 *   · 번역이 없으면 **한국어가 그대로** 나온다 — 깨지지 않는다.
 *   · 원문을 고치면 번역이 끊기지만, 그때는 한국어로 폴백하므로 사고가 아니라 '미번역'이 된다.
 *
 * ## 적용 범위
 * 지금 카탈로그에 담긴 것은 **가장 많이 보는 화면**(설정 트리·워크리스트 조작·뷰어 도구·
 * 공통 버튼/상태)이다. 나머지 문자열(특히 설정 화면의 긴 설명문)은 아직 한국어로 나온다.
 * 번역을 추가하려면 이 파일의 `CATALOG` 에 줄을 더하면 되고, 코드는 건드리지 않아도 된다.
 *
 * ## 저장·적용
 * 언어는 `viewer.prefs.locale` 에 저장하되, 화면이 뜨기 전에 필요하므로
 * `localStorage.sv_locale` 에도 미러링한다(서버 응답을 기다리지 않고 즉시 적용).
 */

export interface LocaleDef {
  code: string;
  /** 그 언어 사용자가 자기 언어로 읽을 이름 */
  label: string;
  /** 오른쪽에서 왼쪽으로 쓰는 언어(아랍어) — document.dir 을 바꾼다 */
  rtl?: boolean;
}

export const LOCALES: LocaleDef[] = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "ar", label: "العربية", rtl: true },
];

export const DEFAULT_LOCALE = "ko";
const LS_KEY = "sv_locale";

/** 번역 한 줄 — 한국어 원문(키) → 언어별 문자열. 없는 언어는 한국어로 폴백한다. */
type Row = Partial<Record<string, string>>;

/**
 * 번역 카탈로그. 순서: en · ru · zh · ja · es · de · fr · vi · ar
 * (의료 용어는 각 언어의 관용 표기를 따랐다 — 예: Study/Исследование/检查/検査)
 */
const CATALOG: Record<string, Row> = {
  // ── 공통 동작 ───────────────────────────────────────────────
  "저장": { en: "Save", ru: "Сохранить", zh: "保存", ja: "保存", es: "Guardar", de: "Speichern", fr: "Enregistrer", vi: "Lưu", ar: "حفظ" },
  "취소": { en: "Cancel", ru: "Отмена", zh: "取消", ja: "キャンセル", es: "Cancelar", de: "Abbrechen", fr: "Annuler", vi: "Hủy", ar: "إلغاء" },
  "닫기": { en: "Close", ru: "Закрыть", zh: "关闭", ja: "閉じる", es: "Cerrar", de: "Schließen", fr: "Fermer", vi: "Đóng", ar: "إغلاق" },
  "삭제": { en: "Delete", ru: "Удалить", zh: "删除", ja: "削除", es: "Eliminar", de: "Löschen", fr: "Supprimer", vi: "Xóa", ar: "حذف" },
  "추가": { en: "Add", ru: "Добавить", zh: "添加", ja: "追加", es: "Añadir", de: "Hinzufügen", fr: "Ajouter", vi: "Thêm", ar: "إضافة" },
  "적용": { en: "Apply", ru: "Применить", zh: "应用", ja: "適用", es: "Aplicar", de: "Anwenden", fr: "Appliquer", vi: "Áp dụng", ar: "تطبيق" },
  "검색": { en: "Search", ru: "Поиск", zh: "搜索", ja: "検索", es: "Buscar", de: "Suchen", fr: "Rechercher", vi: "Tìm kiếm", ar: "بحث" },
  "설정": { en: "Settings", ru: "Настройки", zh: "设置", ja: "設定", es: "Ajustes", de: "Einstellungen", fr: "Paramètres", vi: "Cài đặt", ar: "الإعدادات" },
  "새로고침": { en: "Refresh", ru: "Обновить", zh: "刷新", ja: "更新", es: "Actualizar", de: "Aktualisieren", fr: "Actualiser", vi: "Làm mới", ar: "تحديث" },
  "전체": { en: "All", ru: "Все", zh: "全部", ja: "すべて", es: "Todo", de: "Alle", fr: "Tout", vi: "Tất cả", ar: "الكل" },
  "기본": { en: "Default", ru: "По умолчанию", zh: "默认", ja: "既定", es: "Predeterminado", de: "Standard", fr: "Défaut", vi: "Mặc định", ar: "افتراضي" },

  // ── 설정 트리 ───────────────────────────────────────────────
  "환경 (Environment)": { en: "Environment", ru: "Среда", zh: "环境", ja: "環境", es: "Entorno", de: "Umgebung", fr: "Environnement", vi: "Môi trường", ar: "البيئة" },
  "워크리스트": { en: "Worklist", ru: "Рабочий список", zh: "工作列表", ja: "ワークリスト", es: "Lista de trabajo", de: "Arbeitsliste", fr: "Liste de travail", vi: "Danh sách công việc", ar: "قائمة العمل" },
  "리포트": { en: "Report", ru: "Отчёт", zh: "报告", ja: "レポート", es: "Informe", de: "Bericht", fr: "Rapport", vi: "Báo cáo", ar: "التقرير" },
  "판독 (Reading)": { en: "Reading", ru: "Описание", zh: "阅片", ja: "読影", es: "Lectura", de: "Befundung", fr: "Lecture", vi: "Đọc kết quả", ar: "القراءة" },
  "뷰어 공통": { en: "Viewer (Common)", ru: "Просмотр (общее)", zh: "查看器（通用）", ja: "ビューア（共通）", es: "Visor (común)", de: "Viewer (allgemein)", fr: "Visionneuse (commun)", vi: "Trình xem (chung)", ar: "العارض (عام)" },
  "모니터 (Display)": { en: "Display", ru: "Мониторы", zh: "显示器", ja: "モニター", es: "Pantallas", de: "Monitore", fr: "Écrans", vi: "Màn hình", ar: "الشاشات" },
  "단축키 (Mouse·Key)": { en: "Shortcuts (Mouse/Key)", ru: "Горячие клавиши", zh: "快捷键", ja: "ショートカット", es: "Atajos", de: "Tastenkürzel", fr: "Raccourcis", vi: "Phím tắt", ar: "الاختصارات" },
  "정책 (Policy)": { en: "Policy", ru: "Политика", zh: "策略", ja: "ポリシー", es: "Política", de: "Richtlinie", fr: "Politique", vi: "Chính sách", ar: "السياسة" },
  "행잉 (HP)": { en: "Hanging Protocol", ru: "Протокол раскладки", zh: "悬挂协议", ja: "ハンギングプロトコル", es: "Protocolo de colgado", de: "Hanging-Protokoll", fr: "Protocole d'affichage", vi: "Giao thức bố trí", ar: "بروتوكول العرض" },
  "속도 측정 (Speed Test)": { en: "Speed Test", ru: "Тест скорости", zh: "速度测试", ja: "速度テスト", es: "Prueba de velocidad", de: "Geschwindigkeitstest", fr: "Test de vitesse", vi: "Kiểm tra tốc độ", ar: "اختبار السرعة" },
  "정보 (About)": { en: "About", ru: "О программе", zh: "关于", ja: "情報", es: "Acerca de", de: "Info", fr: "À propos", vi: "Giới thiệu", ar: "حول" },
  "서버 네트워크 (공유 루트)": { en: "Server Network (Shared Root)", ru: "Сеть сервера", zh: "服务器网络", ja: "サーバーネットワーク", es: "Red del servidor", de: "Servernetzwerk", fr: "Réseau serveur", vi: "Mạng máy chủ", ar: "شبكة الخادم" },

  // ── 워크리스트 ─────────────────────────────────────────────
  "환자명": { en: "Patient Name", ru: "ФИО пациента", zh: "患者姓名", ja: "患者名", es: "Nombre del paciente", de: "Patientenname", fr: "Nom du patient", vi: "Tên bệnh nhân", ar: "اسم المريض" },
  "환자 ID": { en: "Patient ID", ru: "ID пациента", zh: "患者ID", ja: "患者ID", es: "ID del paciente", de: "Patienten-ID", fr: "ID patient", vi: "Mã bệnh nhân", ar: "معرّف المريض" },
  "검사일": { en: "Study Date", ru: "Дата исследования", zh: "检查日期", ja: "検査日", es: "Fecha del estudio", de: "Untersuchungsdatum", fr: "Date d'examen", vi: "Ngày chụp", ar: "تاريخ الفحص" },
  "검사명": { en: "Study Description", ru: "Описание исследования", zh: "检查名称", ja: "検査名", es: "Descripción del estudio", de: "Untersuchungsbeschreibung", fr: "Description de l'examen", vi: "Tên khảo sát", ar: "وصف الفحص" },
  "검사부위": { en: "Body Part", ru: "Область", zh: "检查部位", ja: "検査部位", es: "Región anatómica", de: "Körperregion", fr: "Région examinée", vi: "Vùng khảo sát", ar: "المنطقة" },
  "모달리티": { en: "Modality", ru: "Модальность", zh: "设备类型", ja: "モダリティ", es: "Modalidad", de: "Modalität", fr: "Modalité", vi: "Phương thức", ar: "الطريقة" },
  "상태": { en: "Status", ru: "Статус", zh: "状态", ja: "ステータス", es: "Estado", de: "Status", fr: "Statut", vi: "Trạng thái", ar: "الحالة" },
  "판독": { en: "Reading", ru: "Описание", zh: "阅片", ja: "読影", es: "Lectura", de: "Befundung", fr: "Lecture", vi: "Đọc kết quả", ar: "القراءة" },
  "성별": { en: "Sex", ru: "Пол", zh: "性别", ja: "性別", es: "Sexo", de: "Geschlecht", fr: "Sexe", vi: "Giới tính", ar: "الجنس" },
  "생년월일": { en: "Birth Date", ru: "Дата рождения", zh: "出生日期", ja: "生年月日", es: "Fecha de nacimiento", de: "Geburtsdatum", fr: "Date de naissance", vi: "Ngày sinh", ar: "تاريخ الميلاد" },
  "과거검사": { en: "Prior Studies", ru: "Предыдущие исследования", zh: "既往检查", ja: "過去検査", es: "Estudios previos", de: "Voruntersuchungen", fr: "Examens antérieurs", vi: "Khảo sát trước", ar: "الفحوصات السابقة" },
  "비교세트": { en: "Comparison Set", ru: "Набор сравнения", zh: "对比组", ja: "比較セット", es: "Conjunto de comparación", de: "Vergleichsset", fr: "Jeu de comparaison", vi: "Bộ so sánh", ar: "مجموعة المقارنة" },
  "응급": { en: "Emergency", ru: "Экстренно", zh: "急诊", ja: "緊急", es: "Urgencia", de: "Notfall", fr: "Urgence", vi: "Cấp cứu", ar: "طارئ" },
  "확정": { en: "Finalize", ru: "Утвердить", zh: "确认", ja: "確定", es: "Finalizar", de: "Freigeben", fr: "Valider", vi: "Xác nhận", ar: "اعتماد" },
  "내보내기": { en: "Export", ru: "Экспорт", zh: "导出", ja: "エクスポート", es: "Exportar", de: "Exportieren", fr: "Exporter", vi: "Xuất", ar: "تصدير" },
  "가져오기": { en: "Import", ru: "Импорт", zh: "导入", ja: "インポート", es: "Importar", de: "Importieren", fr: "Importer", vi: "Nhập", ar: "استيراد" },

  // ── 뷰어 도구 ──────────────────────────────────────────────
  "확대": { en: "Zoom", ru: "Масштаб", zh: "缩放", ja: "拡大", es: "Zoom", de: "Zoom", fr: "Zoom", vi: "Phóng to", ar: "تكبير" },
  "이동": { en: "Pan", ru: "Сдвиг", zh: "平移", ja: "移動", es: "Desplazar", de: "Verschieben", fr: "Déplacer", vi: "Di chuyển", ar: "تحريك" },
  "반전": { en: "Invert", ru: "Инверсия", zh: "反相", ja: "反転", es: "Invertir", de: "Invertieren", fr: "Inverser", vi: "Đảo màu", ar: "عكس" },
  "회전": { en: "Rotate", ru: "Поворот", zh: "旋转", ja: "回転", es: "Rotar", de: "Drehen", fr: "Pivoter", vi: "Xoay", ar: "تدوير" },
  "길이": { en: "Length", ru: "Длина", zh: "长度", ja: "距離", es: "Longitud", de: "Länge", fr: "Longueur", vi: "Chiều dài", ar: "الطول" },
  "각도": { en: "Angle", ru: "Угол", zh: "角度", ja: "角度", es: "Ángulo", de: "Winkel", fr: "Angle", vi: "Góc", ar: "الزاوية" },
  "주석": { en: "Annotation", ru: "Аннотация", zh: "标注", ja: "注釈", es: "Anotación", de: "Annotation", fr: "Annotation", vi: "Chú thích", ar: "التعليق" },
  "측정": { en: "Measure", ru: "Измерение", zh: "测量", ja: "計測", es: "Medición", de: "Messung", fr: "Mesure", vi: "Đo", ar: "قياس" },
  "시리즈": { en: "Series", ru: "Серия", zh: "序列", ja: "シリーズ", es: "Serie", de: "Serie", fr: "Série", vi: "Chuỗi", ar: "السلسلة" },
  "이미지": { en: "Image", ru: "Изображение", zh: "图像", ja: "画像", es: "Imagen", de: "Bild", fr: "Image", vi: "Hình ảnh", ar: "الصورة" },
  "분할": { en: "Layout", ru: "Раскладка", zh: "布局", ja: "分割", es: "Distribución", de: "Aufteilung", fr: "Disposition", vi: "Bố cục", ar: "التقسيم" },
  "키이미지": { en: "Key Image", ru: "Ключевое изображение", zh: "关键图像", ja: "キー画像", es: "Imagen clave", de: "Schlüsselbild", fr: "Image clé", vi: "Ảnh chính", ar: "الصورة الرئيسية" },
  "비교": { en: "Compare", ru: "Сравнить", zh: "对比", ja: "比較", es: "Comparar", de: "Vergleichen", fr: "Comparer", vi: "So sánh", ar: "مقارنة" },

  // ── 언어 설정 ──────────────────────────────────────────────
  "표시 언어": { en: "Display Language", ru: "Язык интерфейса", zh: "显示语言", ja: "表示言語", es: "Idioma de la interfaz", de: "Anzeigesprache", fr: "Langue d'affichage", vi: "Ngôn ngữ hiển thị", ar: "لغة العرض" },
};

let current = DEFAULT_LOCALE;
try {
  const v = localStorage.getItem(LS_KEY);
  if (v && LOCALES.some((l) => l.code === v)) current = v;
} catch { /* 저장소 접근 불가(사생활 보호 모드 등) — 기본 언어 */ }

export const getLocale = (): string => current;
export const isRtl = (code = current): boolean => !!LOCALES.find((l) => l.code === code)?.rtl;

/** 언어 변경 — 즉시 반영(문서 lang/dir + 구독자 통지) */
export function setLocale(code: string): void {
  if (!LOCALES.some((l) => l.code === code)) return;
  current = code;
  try { localStorage.setItem(LS_KEY, code); } catch { /* 무시 */ }
  applyDocumentLocale();
  subs.forEach((fn) => { try { fn(code); } catch { /* 구독자 오류 격리 */ } });
}

/** <html lang/dir> 반영 — 아랍어는 RTL */
export function applyDocumentLocale(): void {
  try {
    document.documentElement.lang = current;
    document.documentElement.dir = isRtl() ? "rtl" : "ltr";
  } catch { /* SSR·비브라우저 */ }
}

const subs = new Set<(code: string) => void>();
/** 언어 변경 구독 — 해제 함수를 돌려준다 */
export function onLocaleChange(fn: (code: string) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/**
 * 번역. **키는 한국어 원문**이고, 번역이 없으면 원문을 그대로 돌려준다.
 * 그래서 어떤 문자열을 감싸든 화면이 깨지지 않는다(최악의 경우 한국어로 보인다).
 */
export function t(ko: string): string {
  if (current === DEFAULT_LOCALE) return ko;
  return CATALOG[ko]?.[current] ?? ko;
}

/** 지금 카탈로그가 덮는 범위 — 설정 화면에 진행률을 정직하게 보여주기 위함 */
export function coverage(code = current): { done: number; total: number } {
  const keys = Object.keys(CATALOG);
  if (code === DEFAULT_LOCALE) return { done: keys.length, total: keys.length };
  return { done: keys.filter((k) => CATALOG[k][code]).length, total: keys.length };
}
