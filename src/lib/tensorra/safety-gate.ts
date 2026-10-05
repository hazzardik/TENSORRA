export type SafetyCategory =
  | "credential_phishing"
  | "account_takeover"
  | "malware"
  | "service_disruption"
  | "security_evasion"
  | "cheat_evasion";

export type SafetyDecision =
  | { action: "allow" }
  | {
      action: "block";
      category: SafetyCategory;
      response: string;
      confidence: "high";
    };

const hasAny = (text: string, signals: string[]) =>
  signals.some((signal) => text.includes(signal));

const defensiveContext = [
  "как защититься",
  "как обнаружить",
  "как распознать",
  "как предотвратить",
  "защита от",
  "антифиш",
  "безопасност",
  "объясни что такое",
  "объясни как работает",
  "для доклада",
  "для урока",
  "теория",
  "история",
  "признаки",
  "детект",
  "detection",
  "defensive",
  "mitigation",
  "how to protect",
  "how to detect",
];

const buildSignals = [
  "сделай",
  "создай",
  "напиши",
  "разработай",
  "сгенерируй",
  "дай код",
  "скрипт",
  "реализуй",
  "собери",
  "обойди",
  "обход",
  "запусти",
  "build",
  "create",
  "write",
  "code",
  "script",
  "bypass",
  "evade",
  "deploy",
];

const explicitHarmSignals = [
  "украсть",
  "красть",
  "воровать",
  "перехватить пароль",
  "собрать пароли",
  "собирать пароли",
  "получить чужой пароль",
  "украсть куки",
  "украсть cookie",
  "сессии пользователей",
  "взломать аккаунт",
  "взломать почту",
  "без ведома",
  "незаметно",
  "скрытно",
  "steal",
  "harvest credentials",
  "credential theft",
  "session hijack",
  "account takeover",
];

function isDefensive(text: string) {
  return hasAny(text, defensiveContext) && !hasAny(text, explicitHarmSignals);
}

export function evaluateSafetyRequest(
  message: string,
  recentUserContext = "",
): SafetyDecision {
  const current = message.toLocaleLowerCase().replace(/ё/g, "е");
  const continuation =
    current.length <= 320 &&
    /^(?:а\b|и\b|да\b|нет\b|тогда\b|ещ[её]\b|продолж|сделай|добавь|измени|переделай|так\s*же|также|тот\s*же|такой\s*же|what about|then|continue|same)/i.test(
      current.trim(),
    );

  const defensiveCurrent = isDefensive(current);
  const inherited = continuation && !defensiveCurrent
    ? recentUserContext.toLocaleLowerCase().replace(/ё/g, "е").slice(-4000)
    : "";

  const text = inherited ? `${inherited}\n${current}` : current;
  const asksToBuild = hasAny(text, buildSignals);
  const explicitlyHarmful = hasAny(text, explicitHarmSignals);

  const phishingSignals = [
    "фишинг",
    "phishing",
    "credential harvester",
    "поддельная страница входа",
    "копия страницы входа",
    "форма для сбора паролей",
    "сбор логинов и паролей",
  ];

  if (
    hasAny(text, phishingSignals) &&
    (asksToBuild || explicitlyHarmful) &&
    !isDefensive(text)
  ) {
    return {
      action: "block",
      category: "credential_phishing",
      confidence: "high",
      response:
        "Я не буду создавать фишинговый сайт, форму для кражи логинов/паролей или инструменты для перехвата учётных данных. Могу вместо этого сделать безопасный учебный макет без сбора данных, антифишинговую проверку, страницу для тренинга сотрудников или разобрать способы защиты.",
    };
  }

  if (
    explicitlyHarmful ||
    hasAny(text, [
      "bruteforce чужого аккаунта",
      "брутфорс чужого аккаунта",
      "обойти 2fa",
      "обход 2fa",
      "bypass 2fa",
      "украсть токен",
      "steal token",
    ])
  ) {
    return {
      action: "block",
      category: "account_takeover",
      confidence: "high",
      response:
        "Я не буду помогать получать несанкционированный доступ к чужим аккаунтам, паролям, токенам или сессиям. Могу помочь с защитой аккаунта, аудитом собственной системы авторизации, безопасным тестовым стендом или восстановлением доступа законным способом.",
    };
  }

  const malwareSignals = [
    "ransomware",
    "шифровальщик",
    "стилер",
    "stealer",
    "keylogger",
    "кейлоггер",
    "rat malware",
    "remote access trojan",
    "ботнет",
    "botnet",
    "вредонос",
    "malware",
    "trojan",
    "троян",
  ];

  if (
    hasAny(text, malwareSignals) &&
    (asksToBuild || explicitlyHarmful) &&
    !isDefensive(text)
  ) {
    return {
      action: "block",
      category: "malware",
      confidence: "high",
      response:
        "Я не буду писать или дорабатывать вредоносное ПО, стилеры, кейлоггеры, ransomware, RAT или код для скрытого захвата устройств. Могу помочь разобрать образец с точки зрения защиты, написать детектор, правила мониторинга, безопасную демонстрацию в песочнице или укрепить систему.",
    };
  }

  if (
    hasAny(text, ["ddos", "ддос", "ботнет для атаки", "завалить сайт", "положить сайт"]) &&
    (asksToBuild || explicitlyHarmful) &&
    !hasAny(text, ["свой сайт", "мой сервер", "localhost", "локальный стенд", "load test", "нагрузочн"])
  ) {
    return {
      action: "block",
      category: "service_disruption",
      confidence: "high",
      response:
        "Я не буду помогать с DDoS, выводом чужого сервиса из строя или созданием инфраструктуры для такой атаки. Могу помочь провести безопасное нагрузочное тестирование собственного сервиса, настроить rate limiting, WAF и защиту от перегрузки.",
    };
  }

  const evasionSignals = [
    "обойти антивирус",
    "обойти edr",
    "обойти защиту",
    "bypass antivirus",
    "bypass edr",
    "undetected payload",
    "fud malware",
    "скрыть от антивируса",
  ];

  if (hasAny(text, evasionSignals) && asksToBuild && !isDefensive(text)) {
    return {
      action: "block",
      category: "security_evasion",
      confidence: "high",
      response:
        "Я не буду помогать обходить антивирус, EDR или другие защитные механизмы ради скрытого выполнения вредоносного кода. Могу помочь проверить собственную защиту безопасными методами, построить лабораторный тест или улучшить детектирование.",
    };
  }

  const cheatSignals = [
    "чит для",
    "читы для",
    "aimbot",
    "wallhack",
    "esp cheat",
    "спуфер для античита",
    "обход античита",
    "bypass anticheat",
    "anti-cheat bypass",
    "undetected cheat",
  ];

  if (
    hasAny(text, cheatSignals) &&
    (asksToBuild || hasAny(text, ["обход", "bypass", "undetected", "инжект", "inject"])) &&
    !hasAny(text, ["как обнаружить", "античит", "детект", "защита от читов"])
  ) {
    return {
      action: "block",
      category: "cheat_evasion",
      confidence: "high",
      response:
        "Я не буду писать читы или помогать обходить античит и скрывать вмешательство в игру. Могу помочь сделать легальный мод для разрешённой среды, тренировочный симулятор, игрового бота для собственного проекта или систему обнаружения читов.",
    };
  }

  return { action: "allow" };
}
