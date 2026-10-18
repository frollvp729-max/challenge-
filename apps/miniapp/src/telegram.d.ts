interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string; photo_url?: string }; start_param?: string };
  ready(): void;
  expand(): void;
  close(): void;
  openLink(url: string): void;
  openTelegramLink(url: string): void;
  showAlert(message: string, cb?: () => void): void;
  showConfirm(message: string, cb: (ok: boolean) => void): void;
  HapticFeedback?: { notificationOccurred(type: "error" | "success" | "warning"): void; impactOccurred(style: string): void };
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  colorScheme: "light" | "dark";
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
}
interface Window {
  Telegram?: { WebApp: TelegramWebApp };
}
