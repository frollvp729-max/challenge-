import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";

let transport: Transporter | null = null;

export const mailEnabled = () => Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);

function getTransport(): Transporter {
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transport;
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Письмо в стиле приложения: текст (можно с <b>, как в сообщениях бота), кнопка и строка внизу.
 * Возвращает false, если почта не настроена или письмо не ушло.
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  /** Текст в формате сообщений бота: HTML с <b>/<i>, пользовательский текст уже экранирован через esc() */
  text: string;
  button?: { text: string; url: string };
  footer?: string;
}): Promise<boolean> {
  if (!mailEnabled()) {
    console.log(`[mail disabled] → ${opts.to}: ${opts.subject}`);
    return false;
  }
  const body = opts.text.replace(/\n/g, "<br>");
  const plain =
    opts.text
      .replace(/<\/?(b|i)>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&") + (opts.button ? `\n\n${opts.button.text}: ${opts.button.url}` : "");
  const html = `<!doctype html><html><body style="margin:0;background:#eef1f6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border-radius:24px;padding:24px;font-size:16px;line-height:1.5">
<div style="font-weight:700;font-size:20px;margin-bottom:12px">Челленджи</div>
<div>${body}</div>
${
  opts.button
    ? `<p style="margin:20px 0 4px"><a href="${escHtml(opts.button.url)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:999px">${escHtml(opts.button.text)}</a></p>`
    : ""
}
</div>
${opts.footer ? `<p style="font-size:12px;color:#5a6377;text-align:center;margin:14px 8px">${opts.footer}</p>` : ""}
</div></body></html>`;
  try {
    await getTransport().sendMail({ from: config.smtp.from, to: opts.to, subject: opts.subject, text: plain, html });
    return true;
  } catch (err) {
    console.error("sendMail failed", err);
    return false;
  }
}
