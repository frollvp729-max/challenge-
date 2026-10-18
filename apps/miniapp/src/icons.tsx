import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BarbellIcon,
  BookOpenTextIcon,
  CalendarCheckIcon,
  CameraIcon,
  CaretRightIcon,
  ChatsCircleIcon,
  CheckCircleIcon,
  CheckIcon,
  CertificateIcon,
  CrownSimpleIcon,
  FireIcon,
  FlagCheckeredIcon,
  HourglassIcon,
  HouseIcon,
  LeafIcon,
  LifebuoyIcon,
  LightbulbIcon,
  LightningIcon,
  LockSimpleIcon,
  MedalIcon,
  NotePencilIcon,
  RankingIcon,
  SealCheckIcon,
  ShareNetworkIcon,
  SparkleIcon,
  StarIcon,
  SunIcon,
  TrophyIcon,
  UserIcon,
  XIcon,
  type IconWeight,
} from "@phosphor-icons/react";
import { theme } from "./theme";

const ICONS = {
  back: ArrowLeftIcon,
  arrow: ArrowRightIcon,
  muscle: BarbellIcon,
  rules: BookOpenTextIcon,
  progress: CalendarCheckIcon,
  camera: CameraIcon,
  chevron: CaretRightIcon,
  chat: ChatsCircleIcon,
  done: CheckCircleIcon,
  check: CheckIcon,
  cert: CertificateIcon,
  crown: CrownSimpleIcon,
  fire: FireIcon,
  flag: FlagCheckeredIcon,
  hourglass: HourglassIcon,
  home: HouseIcon,
  leaf: LeafIcon,
  lifebuoy: LifebuoyIcon,
  bulb: LightbulbIcon,
  bolt: LightningIcon,
  lock: LockSimpleIcon,
  medal: MedalIcon,
  note: NotePencilIcon,
  rating: RankingIcon,
  seal: SealCheckIcon,
  share: ShareNetworkIcon,
  sparkle: SparkleIcon,
  star: StarIcon,
  sun: SunIcon,
  trophy: TrophyIcon,
  profile: UserIcon,
  x: XIcon,
} as const;

export type IconName = keyof typeof ICONS;
export type Tone = "fire" | "star" | "rank" | "good" | "bad" | "task" | "neutral";

export function Icon({ name, size = 22, weight }: { name: IconName; size?: number; weight?: IconWeight }) {
  const C = ICONS[name];
  return <C size={size} weight={weight ?? theme.iconWeight} aria-hidden="true" />;
}

/** Иконка в цветной плашке */
export function IconTile({
  icon,
  tone = "neutral",
  size = "md",
  weight,
}: {
  icon: IconName;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  weight?: IconWeight;
}) {
  const px = { sm: 16, md: 20, lg: 30 }[size];
  return (
    <span className={`itile itile-${size} tone-${tone}`}>
      <Icon name={icon} size={px} weight={weight} />
    </span>
  );
}

/** Иконки наград по коду (эмодзи с сервера остаются запасным вариантом) */
export const REWARD_ICONS: Record<string, { icon: IconName; tone: Tone }> = {
  first_day: { icon: "flag", tone: "good" },
  streak_7: { icon: "fire", tone: "fire" },
  streak_14: { icon: "muscle", tone: "rank" },
  streak_21: { icon: "trophy", tone: "star" },
  finished: { icon: "crown", tone: "star" },
  perfect: { icon: "bolt", tone: "task" },
  top_10: { icon: "medal", tone: "rank" },
};

export function Avatar({ name, photo, size = 40 }: { name: string; photo?: string | null; size?: number }) {
  const clean = name.replace(/^@/, "").trim();
  const initial = (clean[0] ?? "?").toUpperCase();
  const tone = [...clean].reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
  return (
    <span className={`avatar av-${tone}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {photo ? <img src={photo} alt="" /> : initial}
    </span>
  );
}
