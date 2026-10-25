/**
 * Начальные данные: челлендж «30 дней без сахара» (активен, 30 заданий, поток с 20 октября),
 * остальные идеи как черновики и их наполнение из prisma/data (описание, правила и 30 дней у каждого;
 * у холодного душа ещё поток с 1 ноября). Повторный запуск не дублирует данные и не трогает ручные правки из админки.
 */
import { PrismaClient } from "@prisma/client";
import { COLD_SLUG } from "./data/coldShower.js";
import { CONTENT } from "./data/index.js";
import { NO_QUIT_CHECKLIST } from "./data/noQuit.js";
import type { ChallengeContent } from "./data/types.js";

const prisma = new PrismaClient();

const VIOLATIONS = "Что считается нарушением: сладкая газировка, конфеты, шоколад, сладкая выпечка, сахар в кофе/чае, сладкие соусы. Фрукты разрешены.";

type DaySeed = { title: string; task: string; description?: string; hint?: string; proofType?: string; proofPrompt?: string };

const SUGAR_DAYS: DaySeed[] = [
  // Неделя 1 — осознание
  {
    title: "Убери добавленный сахар",
    description: "Неделя 1 — осознание. Первый шаг самый важный.",
    task: "Сегодня твоя задача: не употреблять продукты и напитки с добавленным сахаром.",
    hint: VIOLATIONS,
    proofPrompt: "Что сегодня было самым сложным?",
  },
  {
    title: "Проверь состав 5 продуктов",
    task: "Возьми 5 продуктов из своего холодильника или магазина и прочитай состав. Найди, где есть сахар.",
    hint: "Сахар прячется под названиями: сироп, декстроза, мальтоза, фруктоза, патока, мёд.",
    proofType: "photo_or_text",
    proofPrompt: "В каких продуктах нашёлся сахар?",
  },
  {
    title: "Откажись от сладких напитков",
    task: "Весь день без газировки, сока из пакета, сладкого чая и энергетиков.",
    hint: "Жажду утоляй водой, минералкой, чаем без сахара.",
  },
  {
    title: "Чай и кофе без сахара",
    task: "Пей чай и кофе без сахара и сиропов. Попробуй корицу или кардамон вместо сладкого.",
    hint: "Первые дни вкус кажется непривычным. Через неделю рецепторы перестроятся.",
  },
  {
    title: "Найди 3 продукта со скрытым сахаром",
    task: "Найди 3 продукта, в которых ты не ожидал увидеть сахар: соусы, хлеб, колбаса, йогурты.",
    proofPrompt: "Какие 3 продукта ты нашёл?",
  },
  {
    title: "Замени одну сладость",
    task: "Выбери сладость, которую ешь чаще всего, и найди ей замену: орехи, ягоды, фрукт, сыр.",
    proofPrompt: "Чем ты заменил сладость?",
  },
  {
    title: "Первый недельный отчёт",
    task: "Неделя позади. Напиши, что изменилось: самочувствие, тяга к сладкому, сон, энергия.",
    proofType: "text",
    proofPrompt: "Что изменилось за первую неделю?",
  },
  // Неделя 2 — привычка
  {
    title: "Завтрак без добавленного сахара",
    description: "Неделя 2 — привычка.",
    task: "Собери завтрак без сладких хлопьев, джема, сладких йогуртов и выпечки.",
    hint: "Яйца, каша без сахара с ягодами, творог, овощи, цельнозерновой хлеб.",
    proofPrompt: "Сфотографируй свой завтрак",
  },
  {
    title: "Перекус без сладостей",
    task: "Все перекусы сегодня — без сладкого. Подготовь их заранее.",
    hint: "Орехи, фрукт, овощные палочки, сыр, варёное яйцо.",
  },
  {
    title: "Не покупай сладости",
    task: "Сегодня в магазине ни одной сладости, даже «на потом» или «для гостей».",
    proofPrompt: "Сфотографируй чек или корзину",
  },
  {
    title: "Вода вместо сладкого напитка",
    task: "Каждый раз, когда захочется сладкого напитка, выпей стакан воды.",
    hint: "Добавь в воду лимон, мяту или огурец.",
  },
  {
    title: "Изучи этикетки",
    task: "Сравни этикетки двух похожих продуктов (например, двух йогуртов) и выбери тот, где меньше сахара.",
    proofPrompt: "Какие продукты сравнил и что выбрал?",
  },
  {
    title: "Приготовь десерт без сахара",
    task: "Приготовь десерт без добавленного сахара: запечённое яблоко, ягоды с творогом, банановое мороженое.",
    proofPrompt: "Сфотографируй свой десерт",
  },
  {
    title: "Второй недельный отчёт",
    task: "Две недели позади. Что стало проще? Где всё ещё тянет к сладкому?",
    proofType: "text",
    proofPrompt: "Что изменилось за вторую неделю?",
  },
  // Неделя 3 — контроль
  {
    title: "Половина челленджа",
    description: "Неделя 3 — контроль. Ты на середине пути.",
    task: "Ты прошёл половину. Сегодня просто держи режим и запиши, ради чего продолжаешь.",
    proofType: "text",
    proofPrompt: "Ради чего ты продолжаешь?",
  },
  { title: "День без сладких напитков", task: "Ни одного сладкого напитка, включая смузи из магазина и «полезные» соки." },
  { title: "День без сладкой выпечки", task: "Без булочек, круассанов, печенья и пирожков. Даже к чаю." },
  {
    title: "Проверь соусы",
    task: "Проверь состав кетчупа, соусов и заправок дома. Найди замену с меньшим количеством сахара.",
    hint: "Соус из йогурта с зеленью, горчица, оливковое масло с лимоном.",
  },
  {
    title: "Проверь молочные продукты",
    task: "Проверь йогурты, творожки, сырки и молочные напитки. Отложи те, где есть добавленный сахар.",
  },
  {
    title: "День без импульсивных покупок",
    task: "Ни одной сладости «по пути»: у кассы, в автомате, на заправке.",
    hint: "Выходи из дома сытым и бери с собой перекус.",
  },
  {
    title: "Третий недельный отчёт",
    task: "Три недели — привычка почти сформирована. Как ты себя чувствуешь?",
    proofType: "text",
    proofPrompt: "Что изменилось за третью неделю?",
  },
  // Неделя 4 — закрепление
  {
    title: "Определи свои триггеры",
    description: "Неделя 4 — закрепление.",
    task: "Запиши ситуации, в которых тебя тянет к сладкому: стресс, скука, вечер, кофе с коллегами.",
    proofType: "text",
    proofPrompt: "Какие у тебя триггеры?",
  },
  {
    title: "Замена вечерней сладости",
    task: "Придумай и попробуй ритуал на вечер вместо сладкого: травяной чай, прогулка, орехи, душ.",
    proofPrompt: "Что будет твоей заменой?",
  },
  { title: "День без десертов", task: "Сегодня никаких десертов, даже без сахара. Завершай еду без сладкого." },
  {
    title: "Читай этикетку за 30 секунд",
    task: "Потренируйся: возьми 3 продукта и за 30 секунд на каждый найди сахар в составе и в таблице углеводов.",
  },
  {
    title: "Составь меню на завтра",
    task: "Распиши завтрак, обед, ужин и перекусы на завтра без добавленного сахара.",
    proofPrompt: "Сфотографируй или напиши меню",
  },
  {
    title: "Расскажи о своём результате",
    task: "Расскажи близким или в соцсетях, что ты почти месяц без добавленного сахара.",
    proofPrompt: "Кому рассказал и как отреагировали?",
  },
  {
    title: "Подготовься к завершению",
    task: "Реши, какие правила оставишь себе после челленджа. Например: сладкое только по выходным.",
    proofType: "text",
    proofPrompt: "Какие правила ты оставишь?",
  },
  {
    title: "Сравни себя с Днём 1",
    task: "Перечитай свой первый отчёт. Сравни самочувствие, вес, сон, тягу к сладкому.",
    proofType: "text",
    proofPrompt: "Чем ты сегодня отличаешься от себя в День 1?",
  },
  {
    title: "Финальный день",
    task: "Последний день без добавленного сахара. Заверши челлендж и забери сертификат.",
    proofPrompt: "Что ты скажешь себе через месяц?",
  },
];

const SUGAR_RULES = `Как проходит челлендж

• 30 дней, каждый день — одно задание. Утром бот пришлёт его, вечером напомнит, если отчёта нет.
• День закрывается в полночь по твоему времени.
• Нажми «Я выполнил» и добавь доказательство: фото или пару слов. Или честно отметь «Нарушил».

Что считается нарушением
Сладкая газировка, конфеты, шоколад, сладкая выпечка, сахар в кофе/чае, сладкие соусы. Фрукты разрешены.

Баллы
+10 за выполнение, +5 за доказательство, −10 за нарушение.
Бонусы за серию: 3 дня +10, 7 дней +25, 14 дней +50, 21 день +75, 30 дней +150.

Срыв
Серия обнуляется, но выполненные дни сохраняются и челлендж продолжается. Один раз за челлендж серию можно спасти за 50 баллов.

Честность
Админы могут отклонить доказательство, тогда баллы за него снимаются.`;

const DRAFTS: Array<[string, string, string]> = [
  ["wake-0500", "Встаю в 05:00", "Подъём до 05:00 каждый день"],
  ["pushups-100", "100 отжиманий", "Постепенно выйти на 100 отжиманий в день"],
  ["steps-10000", "10 000 шагов", "Минимум 10 000 шагов ежедневно"],
  ["plank-5", "Планка 5 минут", "Постепенно увеличить время планки"],
  ["abs-daily", "Пресс каждый день", "Ежедневная короткая тренировка"],
  ["squats-100", "100 приседаний", "Дойти до 100 приседаний ежедневно"],
  ["cold-shower", "Холодный душ", "Каждый день принимать холодный душ"],
  ["morning-workout", "Зарядка 10 минут", "Утренняя зарядка без пропусков"],
  ["stretching-15", "Растяжка 15 минут", "Ежедневная растяжка"],
  ["english-zero", "Английский с нуля", "20 минут английского каждый день"],
  ["read-10", "Читаю 10 страниц", "10 страниц книги ежедневно"],
  ["water-2l", "Вода 2 литра", "Выпивать установленный объём воды"],
  ["journal-30", "Дневник 30 дней", "Каждый вечер записывать итоги дня"],
  ["meditation-10", "Медитация 10 минут", "Медитировать ежедневно"],
  ["declutter", "Наведи порядок дома", "Ежедневно убрать/выбросить/организовать одну зону"],
  ["content-30", "Контент 30 дней", "Каждый день публиковать пост/сторис/Reels"],
  ["gratitude-30", "30 дней благодарности", "Каждый день фиксировать 3 вещи, за которые благодарен"],
];

const NO_QUIT_TITLE = "30 дней — не сливаюсь";
const NO_QUIT_TAGLINE = "Каждый день 5 пунктов: шаги, обучение, зарядка, вода, ранний подъём";

async function main() {
  const sugar = await prisma.challenge.upsert({
    where: { slug: "no-sugar" },
    update: {},
    create: {
      slug: "no-sugar",
      title: "30 дней без сахара",
      tagline: "Измени привычку за 30 дней. Каждый день — одно простое действие.",
      intro:
        "<b>30 дней.\nБез добавленного сахара.</b>\n\nКаждый день — небольшое задание.\nОтчёт занимает 30 секунд.\nУчастники соревнуются за место в рейтинге и получают награды.",
      rules: SUGAR_RULES,
      status: "ACTIVE",
      priceRub: 490,
      paymentMode: "SUBSCRIPTION",
      sortOrder: 0,
    },
  });
  for (let i = 0; i < SUGAR_DAYS.length; i++) {
    const d = SUGAR_DAYS[i];
    await prisma.challengeDay.upsert({
      where: { challengeId_dayNumber: { challengeId: sugar.id, dayNumber: i + 1 } },
      update: {},
      create: {
        challengeId: sugar.id,
        dayNumber: i + 1,
        title: d.title,
        description: d.description ?? "",
        task: d.task,
        hint: d.hint ?? (i === 0 ? "" : "Главное правило дня 1 действует весь челлендж: без добавленного сахара."),
        proofType: d.proofType ?? "photo_or_text",
        proofPrompt: d.proofPrompt ?? "Что сегодня было самым сложным?",
      },
    });
  }
  if (!(await prisma.stream.count({ where: { challengeId: sugar.id } }))) {
    await prisma.stream.create({ data: { challengeId: sugar.id, startDate: "2026-10-20", title: "Поток 1" } });
  }

  let order = 1;
  for (const [slug, title, tagline] of DRAFTS) {
    await prisma.challenge.upsert({
      where: { slug },
      update: {},
      create: { slug, title, tagline, status: "DRAFT", priceRub: slug === "wake-0500" ? 990 : 490, sortOrder: order++ },
    });
  }

  const cold = await prisma.challenge.findUniqueOrThrow({ where: { slug: COLD_SLUG } });
  if (!(await prisma.stream.count({ where: { challengeId: cold.id } }))) {
    await prisma.stream.create({ data: { challengeId: cold.id, startDate: "2026-11-01", title: "Поток 1" } });
  }

  const noQuit = await prisma.challenge.upsert({
    where: { slug: "no-quit" },
    update: {},
    create: {
      slug: "no-quit",
      title: NO_QUIT_TITLE,
      tagline: NO_QUIT_TAGLINE,
      status: "DRAFT",
      priceRub: 990,
      sortOrder: order++,
    },
  });
  for (let n = 1; n <= 30; n++) {
    await prisma.challengeDay.upsert({
      where: { challengeId_dayNumber: { challengeId: noQuit.id, dayNumber: n } },
      update: {},
      create: {
        challengeId: noQuit.id,
        dayNumber: n,
        title: `День ${n}: все 5 пунктов`,
        task: "Выполни все 5 пунктов и отметь их в чек-листе.",
        checklist: NO_QUIT_CHECKLIST,
        proofType: "photo_or_text",
        proofPrompt: "Скрин шагов или пара слов о дне",
      },
    });
  }
  const defaults = new Map<string, [string, string]>(DRAFTS.map(([slug, title, tagline]) => [slug, [title, tagline]]));
  defaults.set("no-quit", [NO_QUIT_TITLE, NO_QUIT_TAGLINE]);
  for (const content of CONTENT) await fillChallenge(content, defaults.get(content.slug));
  console.log("Seed готов");
}

/**
 * Заполняет черновик готовыми текстами. Трогает только пустые поля, заголовок и подзаголовок по умолчанию
 * и дни-заготовки («День N» без описания и подсказки, как их создаёт кнопка в админке): правки из админки сохраняются.
 */
async function fillChallenge(content: ChallengeContent, draft?: [string, string]) {
  const ch = await prisma.challenge.findUnique({ where: { slug: content.slug } });
  if (!ch) return;
  await prisma.challenge.update({
    where: { id: ch.id },
    data: {
      title: draft && ch.title === draft[0] ? content.title : ch.title,
      tagline: !ch.tagline || ch.tagline === draft?.[1] ? content.tagline : ch.tagline,
      intro: ch.intro || content.intro,
      rules: ch.rules || content.rules,
    },
  });
  for (let i = 0; i < content.days.length; i++) {
    const d = content.days[i];
    const dayNumber = i + 1;
    const data = {
      title: d.title,
      description: d.description,
      task: d.task,
      hint: d.hint,
      proofType: d.proofType ?? "photo_or_text",
      proofPrompt: d.proofPrompt,
      ...(d.checklist ? { checklist: d.checklist } : {}),
    };
    const key = { challengeId_dayNumber: { challengeId: ch.id, dayNumber } };
    const existing = await prisma.challengeDay.findUnique({ where: key });
    const placeholder =
      existing &&
      !existing.description &&
      !existing.hint &&
      (existing.title === `День ${dayNumber}` || existing.title.startsWith(`День ${dayNumber}:`));
    if (!existing) await prisma.challengeDay.create({ data: { challengeId: ch.id, dayNumber, ...data } });
    else if (placeholder) await prisma.challengeDay.update({ where: key, data });
  }
}

main().finally(() => prisma.$disconnect());
