import { create } from 'zustand';

// Tiny i18n layer. Components call useT() -> t('key', {vars}); the toggle in
// the top bar flips the whole app between English and Spanish.
function initialLang() {
  try {
    const s = localStorage.getItem('helm_lang');
    if (s === 'en' || s === 'es') return s;
    const nav = (navigator.language || '').toLowerCase();
    if (nav.startsWith('es')) return 'es';
  } catch { /* ignore */ }
  return 'en';
}

export const useLangStore = create((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try { localStorage.setItem('helm_lang', lang); } catch { /* ignore */ }
    try { document.documentElement.setAttribute('lang', lang); } catch { /* ignore */ }
    set({ lang });
  },
}));

export function translate(lang, key, vars) {
  let s = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.en[key] ?? key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

export function useT() {
  const lang = useLangStore((s) => s.lang);
  return (key, vars) => translate(lang, key, vars);
}

export const STRINGS = {
  en: {
    'nav.today': 'Today', 'nav.chat': 'Chat', 'nav.library': 'Library',
    'nav.tasks': 'Tasks', 'nav.food': 'Food', 'nav.habits': 'Habits', 'nav.workouts': 'Workouts', 'nav.coach': 'Coach',
    'nav.goals': 'Goals', 'nav.vision': 'Vision', 'nav.checkins': 'Check-ins',
    'topbar.about': 'What is Helm?', 'topbar.lang': 'Switch to Spanish',

    'intro.skip': 'Skip', 'intro.next': 'Next', 'intro.back': 'Back', 'intro.start': 'Get started',
    'intro.s1.title': 'Welcome to Helm', 'intro.s1.body': 'Your life, with a coach who actually knows you. Most apps just track your life — Helm helps you build it.',
    'intro.s2.title': 'Everything in one place', 'intro.s2.body': 'Your vision, goals, habits, tasks, workouts, food and coaching — connected in one place, not scattered across ten different apps.',
    'intro.s3.title': 'A coach in your pocket', 'intro.s3.body': 'Talk to it like a person, or type. It knows your goals, keeps you honest, and turns big plans into today’s three things.',
    'intro.s4.title': 'Become who you want to be', 'intro.s4.body': 'Helm ties every small daily action back to the person you’re trying to become. That’s the whole game.',
    'intro.s5.title': 'Let’s find your north star', 'intro.s5.body': 'First, a short chat to map where you’re headed — just a few minutes. Then Helm builds everything around it.',

    'login.brand': 'Helm', 'login.setupWelcome': 'Welcome to Helm', 'login.setupTitle': 'Set a password',
    'login.setupSub': 'First time here — pick a password to protect your Helm workspace.',
    'login.loginSub': 'Enter your password to continue.',
    'login.password': 'Password', 'login.confirm': 'Confirm password',
    'login.create': 'Create password', 'login.unlock': 'Unlock', 'login.wait': 'Please wait…', 'login.loading': 'Loading…',
    'login.errMin': 'Use at least 6 characters.', 'login.errMatch': 'Passwords do not match.', 'login.errGeneric': 'Something went wrong.',

    'hint.today': '👋 This is your home base — your day, goals and habits at a glance. New here? Start with the card just below to set Helm up around you.',
    'hint.chat': '💬 This is your coach — talk or type. It can plan your day, log meals and workouts, set goals, and more. Tap the mic to dictate.',
    'hint.library': '📚 Everything in the simplified Helm workspace lives here — tap a section to open it. Goals and Vision are your direction; Tasks, Habits, Workouts and Food are the day-to-day.',
    'chat.crisisNote': 'Not a crisis service. In a crisis or if you are thinking about harming yourself, contact your local emergency services or a crisis helpline and reach out to someone you trust.',

    'composer.placeholder': 'Type a message, or tap the mic to talk', 'composer.transcribing': 'Transcribing…',
    'composer.recording': 'Recording… tap the mic to stop & transcribe',
    'composer.send': 'send', 'composer.stop': 'stop', 'composer.unavailable': 'Chat unavailable — the coach backend is not set up yet',

    'today.morning': 'Good morning', 'today.afternoon': 'Good afternoon', 'today.evening': 'Good evening', 'today.night': 'Good night', 'today.late': 'Up late',
    'today.loading': 'loading your day…', 'today.quickCapture': 'What’s on your mind? Press Enter to send to the coach.',
    'today.activeGoals': 'Active goals', 'today.habits': 'Today’s habits', 'today.reflections': 'Recent reflections',
    'today.noGoals': 'No goals yet. Start a vision review.', 'today.noHabits': 'Nothing scheduled today.', 'today.noReflections': 'No reflections yet.',

    'ob.vision.title': 'Welcome to Helm', 'ob.vision.body': 'Let’s find your north star — a short guided session to map who you’re becoming over the next 5–10 years.', 'ob.vision.cta': 'Start setup',
    'ob.goals.title': 'Turn your vision into goals', 'ob.goals.body': 'Next: reverse-engineer your vision into a few focused year → quarter → week goals.', 'ob.goals.cta': 'Continue setup',
    'ob.setup.title': 'Wire up your habits & tasks', 'ob.setup.body': 'Next: set up the habits, tasks, and routines that actually drive your goals.', 'ob.setup.cta': 'Continue setup',
    'ob.rhythm.title': 'Set your daily rhythm', 'ob.rhythm.body': 'Last step: pick your check-in times and run your first command meeting.', 'ob.rhythm.cta': 'Continue setup',

    'today.cadenceHeading': 'Your check-ins', 'today.setupHeading': 'Set up Helm',
    'cad.morning.title': 'Daily Command Meeting', 'cad.morning.body': 'Line up LIFE and WORK, then pick the one thing that has to happen today.', 'cad.morning.cta': 'Start',
    'cad.midday.title': 'Midday Recalibration', 'cad.midday.body': 'Two minutes: is today still going the way you decided this morning?', 'cad.midday.cta': 'Recalibrate',
    'cad.evening.title': 'Daily Closeout', 'cad.evening.body': 'Close out what got done, catch the loose ends, then look back on the day.', 'cad.evening.cta': 'Close out',
    'cad.weekly.title': 'Weekly review', 'cad.weekly.body': 'Pull the week into a single picture. ~10 min.', 'cad.weekly.cta': 'Review the week',
    'cad.vision.title': 'Vision review', 'cad.vision.body': "It's been {days} days since you looked at the long view.", 'cad.vision.cta': 'Review',
    'cad.vision.bodyUnset': 'Set your vision so the coach has a north star to anchor everything to.', 'cad.vision.ctaUnset': 'Set vision',
  },

  es: {
    'nav.today': 'Hoy', 'nav.chat': 'Chat', 'nav.library': 'Biblioteca',
    'nav.tasks': 'Tareas', 'nav.food': 'Comida', 'nav.habits': 'Hábitos', 'nav.workouts': 'Entrenamientos', 'nav.coach': 'Coach',
    'nav.goals': 'Metas', 'nav.vision': 'Visión', 'nav.checkins': 'Registros',
    'topbar.about': '¿Qué es Helm?', 'topbar.lang': 'Cambiar a inglés',

    'intro.skip': 'Saltar', 'intro.next': 'Siguiente', 'intro.back': 'Atrás', 'intro.start': 'Empezar',
    'intro.s1.title': 'Bienvenido a Helm', 'intro.s1.body': 'Tu vida, con un coach que de verdad te conoce. La mayoría de las apps solo registran tu vida — Helm te ayuda a construirla.',
    'intro.s2.title': 'Todo en un solo lugar', 'intro.s2.body': 'Tu visión, metas, hábitos, tareas, entrenamientos, comida y coaching — conectados en un solo lugar, no repartidos en diez apps distintas.',
    'intro.s3.title': 'Un coach en tu bolsillo', 'intro.s3.body': 'Háblale como a una persona, o escríbele. Conoce tus metas, te mantiene honesto y convierte grandes planes en las tres cosas de hoy.',
    'intro.s4.title': 'Conviértete en quien quieres ser', 'intro.s4.body': 'Helm conecta cada pequeña acción diaria con la persona en la que te quieres convertir. De eso se trata todo.',
    'intro.s5.title': 'Encontremos tu norte', 'intro.s5.body': 'Primero, una charla corta para mapear hacia dónde vas — solo unos minutos. Luego Helm construye todo a tu alrededor.',

    'login.brand': 'Helm', 'login.setupWelcome': 'Bienvenido a Helm', 'login.setupTitle': 'Crea una contraseña',
    'login.setupSub': 'Es tu primera vez — elige una contraseña para proteger tu panel.',
    'login.loginSub': 'Ingresa tu contraseña para continuar.',
    'login.password': 'Contraseña', 'login.confirm': 'Confirmar contraseña',
    'login.create': 'Crear contraseña', 'login.unlock': 'Entrar', 'login.wait': 'Un momento…', 'login.loading': 'Cargando…',
    'login.errMin': 'Usa al menos 6 caracteres.', 'login.errMatch': 'Las contraseñas no coinciden.', 'login.errGeneric': 'Algo salió mal.',

    'hint.today': '👋 Esta es tu base — tu día, metas y hábitos de un vistazo. ¿Nuevo por aquí? Empieza con la tarjeta de abajo para configurar Helm a tu medida.',
    'hint.chat': '💬 Este es tu coach — háblale o escríbele. Puede planear tu día, registrar comidas y entrenamientos, fijar metas y más. Toca el micrófono para dictar.',
    'hint.library': '📚 Todo lo que aparece en el espacio simplificado de Helm vive aquí — toca una sección para abrirla. Metas y Visión son tu rumbo; Tareas, Hábitos, Entrenamientos y Comida son el día a día.',
    'chat.crisisNote': 'No es un servicio de crisis. Si estás en crisis o pensando en hacerte daño, contacta a los servicios de emergencia locales o una línea de crisis, y busca a alguien de confianza.',

    'composer.placeholder': 'Escribe un mensaje, o toca el micrófono para hablar', 'composer.transcribing': 'Transcribiendo…',
    'composer.recording': 'Grabando… toca el micrófono para detener y transcribir',
    'composer.send': 'enviar', 'composer.stop': 'parar', 'composer.unavailable': 'Chat no disponible — el coach aún no está configurado',

    'today.morning': 'Buenos días', 'today.afternoon': 'Buenas tardes', 'today.evening': 'Buenas noches', 'today.night': 'Buenas noches', 'today.late': 'Trasnochando',
    'today.loading': 'cargando tu día…', 'today.quickCapture': '¿Qué tienes en mente? Pulsa Enter para enviárselo al coach.',
    'today.activeGoals': 'Metas activas', 'today.habits': 'Hábitos de hoy', 'today.reflections': 'Reflexiones recientes',
    'today.noGoals': 'Aún no hay metas. Empieza una revisión de visión.', 'today.noHabits': 'Nada programado hoy.', 'today.noReflections': 'Aún no hay reflexiones.',

    'ob.vision.title': 'Bienvenido a Helm', 'ob.vision.body': 'Encontremos tu norte — una sesión guiada corta para mapear en quién te estás convirtiendo en los próximos 5–10 años.', 'ob.vision.cta': 'Empezar',
    'ob.goals.title': 'Convierte tu visión en metas', 'ob.goals.body': 'Ahora: desglosa tu visión en unas pocas metas enfocadas de año → trimestre → semana.', 'ob.goals.cta': 'Continuar',
    'ob.setup.title': 'Conecta tus hábitos y tareas', 'ob.setup.body': 'Ahora: configura los hábitos, tareas y rutinas que realmente impulsan tus metas.', 'ob.setup.cta': 'Continuar',
    'ob.rhythm.title': 'Define tu ritmo diario', 'ob.rhythm.body': 'Último paso: elige tus horarios de check-in y haz tu primera reunión de mando.', 'ob.rhythm.cta': 'Continuar',

    'today.cadenceHeading': 'Tus check-ins', 'today.setupHeading': 'Configura Helm',
    'cad.morning.title': 'Reunión de mando diaria', 'cad.morning.body': 'Ordena LIFE y WORK, y elige lo único que sí o sí tiene que pasar hoy.', 'cad.morning.cta': 'Empezar',
    'cad.midday.title': 'Recalibración de mediodía', 'cad.midday.body': 'Dos minutos: ¿el día sigue yendo como lo decidiste esta mañana?', 'cad.midday.cta': 'Recalibrar',
    'cad.evening.title': 'Cierre del día', 'cad.evening.body': 'Cierra lo que se hizo, recoge los cabos sueltos y luego mira el día.', 'cad.evening.cta': 'Cerrar el día',
    'cad.weekly.title': 'Revisión semanal', 'cad.weekly.body': 'Resume la semana en una sola imagen. ~10 min.', 'cad.weekly.cta': 'Revisar la semana',
    'cad.vision.title': 'Revisión de visión', 'cad.vision.body': 'Han pasado {days} días desde que miraste el largo plazo.', 'cad.vision.cta': 'Revisar',
    'cad.vision.bodyUnset': 'Define tu visión para que el coach tenga un norte al que anclar todo.', 'cad.vision.ctaUnset': 'Definir visión',
  },
};
