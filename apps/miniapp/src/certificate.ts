import QRCode from "qrcode";

/** Рисует сертификат 1080×1350 на canvas и возвращает PNG */
export async function drawCertificate(opts: {
  name: string;
  title: string;
  done: number;
  duration: number;
  year: number;
  link: string;
}): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;

  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#fff8ec");
  grad.addColorStop(1, "#ffe3c2");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#e0952f";
  g.lineWidth = 14;
  g.strokeRect(40, 40, W - 80, H - 80);
  g.lineWidth = 3;
  g.strokeRect(68, 68, W - 136, H - 136);

  g.textAlign = "center";
  g.fillStyle = "#3a2410";
  const font = (size: number, weight = 400) => `${weight} ${size}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

  g.font = font(84, 800);
  g.fillText("СЕРТИФИКАТ", W / 2, 230);
  g.font = font(38);
  g.fillText("Подтверждается, что", W / 2, 340);

  let size = 96;
  g.font = font(size, 800);
  const name = opts.name.toUpperCase();
  while (g.measureText(name).width > W - 200 && size > 40) g.font = font((size -= 4), 800);
  g.fillStyle = "#c2410c";
  g.fillText(name, W / 2, 470);

  g.fillStyle = "#3a2410";
  g.font = font(38);
  g.fillText("успешно завершил челлендж", W / 2, 570);
  size = 60;
  g.font = font(size, 800);
  const title = `«${opts.title.toUpperCase()}»`;
  while (g.measureText(title).width > W - 200 && size > 28) g.font = font((size -= 2), 800);
  g.fillText(title, W / 2, 665);

  g.font = font(54, 700);
  g.fillText(`${opts.done} / ${opts.duration} дней`, W / 2, 790);
  g.font = font(40);
  g.fillText(String(opts.year), W / 2, 860);

  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, opts.link, { width: 260, margin: 1, color: { dark: "#3a2410", light: "#fff8ec" } });
  g.drawImage(qr, W / 2 - 130, 930);
  g.font = font(26);
  g.fillText("Присоединяйся к следующему потоку", W / 2, 1230);

  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
}
