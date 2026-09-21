// Envoi SMTP Infomaniak — port de send_email() (send_agent.py).
//
// Client SMTP minimal écrit directement avec les primitives TCP/TLS de Deno (pas de librairie
// tierce) : denomailer lève ses erreurs de façon asynchrone ("event loop error"), hors de portée
// d'un try/catch classique, ce qui plantait toute l'Edge Function (503) au lieu de renvoyer une
// erreur propre. Ici, chaque étape du protocole est awaited directement dans sendEmail(), donc
// toute erreur reste capturable normalement.

const INFOMANIAK_EMAIL = Deno.env.get("INFOMANIAK_EMAIL") ?? "";
const INFOMANIAK_PASSWORD = Deno.env.get("INFOMANIAK_PASSWORD") ?? "";
const INFOMANIAK_SMTP_HOST = Deno.env.get("INFOMANIAK_SMTP_HOST") ?? "mail.infomaniak.com";
const INFOMANIAK_SMTP_PORT = Number(Deno.env.get("INFOMANIAK_SMTP_PORT") ?? "587");
const SENDER_NAME = Deno.env.get("SENDER_NAME") ?? "FynUp Consulting";

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function wrapBase64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join("\r\n");
}

async function writeAll(conn: Deno.Conn, text: string): Promise<void> {
  const data = new TextEncoder().encode(text);
  let written = 0;
  while (written < data.length) {
    written += await conn.write(data.subarray(written));
  }
}

async function readResponse(conn: Deno.Conn): Promise<string> {
  const decoder = new TextDecoder();
  const buf = new Uint8Array(4096);
  let data = "";
  while (true) {
    const n = await conn.read(buf);
    if (n === null) throw new Error("Connexion SMTP fermée de manière inattendue par le serveur.");
    data += decoder.decode(buf.subarray(0, n), { stream: true });
    if (!data.endsWith("\r\n")) continue;
    const lines = data.trim().split("\r\n");
    const lastLine = lines[lines.length - 1];
    if (/^\d{3} /.test(lastLine)) return data; // ligne finale (espace, pas tiret) => réponse complète
  }
}

function codeOf(response: string): number {
  return Number(response.trim().split("\r\n")[0].slice(0, 3));
}

function expect(response: string, codes: number[], step: string): void {
  const code = codeOf(response);
  if (!codes.includes(code)) {
    throw new Error(`SMTP ${step} : code inattendu ${code} — ${response.trim().split("\r\n")[0]}`);
  }
}

async function sendCmd(conn: Deno.Conn, cmd: string, step: string, okCodes: number[]): Promise<string> {
  await writeAll(conn, `${cmd}\r\n`);
  const resp = await readResponse(conn);
  expect(resp, okCodes, step);
  return resp;
}

export async function sendEmail(
  toEmail: string,
  subject: string,
  body: string,
): Promise<{ success: boolean; error?: string }> {
  if (!INFOMANIAK_EMAIL || !INFOMANIAK_PASSWORD) {
    return { success: false, error: "INFOMANIAK_EMAIL / INFOMANIAK_PASSWORD manquants." };
  }

  let conn: Deno.Conn | undefined;

  try {
    conn = INFOMANIAK_SMTP_PORT === 465
      ? await Deno.connectTls({ hostname: INFOMANIAK_SMTP_HOST, port: INFOMANIAK_SMTP_PORT })
      : await Deno.connect({ hostname: INFOMANIAK_SMTP_HOST, port: INFOMANIAK_SMTP_PORT });

    expect(await readResponse(conn), [220], "connexion");
    await sendCmd(conn, "EHLO fynup-lead-gen.local", "EHLO", [250]);

    if (INFOMANIAK_SMTP_PORT !== 465) {
      await sendCmd(conn, "STARTTLS", "STARTTLS", [220]);
      conn = await Deno.startTls(conn, { hostname: INFOMANIAK_SMTP_HOST });
      await sendCmd(conn, "EHLO fynup-lead-gen.local", "EHLO (TLS)", [250]);
    }

    await sendCmd(conn, "AUTH LOGIN", "AUTH LOGIN", [334]);
    await sendCmd(conn, toBase64(INFOMANIAK_EMAIL), "AUTH (utilisateur)", [334]);
    await sendCmd(conn, toBase64(INFOMANIAK_PASSWORD), "AUTH (mot de passe)", [235]);

    await sendCmd(conn, `MAIL FROM:<${INFOMANIAK_EMAIL}>`, "MAIL FROM", [250]);
    await sendCmd(conn, `RCPT TO:<${toEmail}>`, "RCPT TO", [250, 251]);
    await sendCmd(conn, "DATA", "DATA", [354]);

    const message =
      `From: ${SENDER_NAME} <${INFOMANIAK_EMAIL}>\r\n` +
      `To: ${toEmail}\r\n` +
      `Subject: =?UTF-8?B?${toBase64(subject)}?=\r\n` +
      `Date: ${new Date().toUTCString()}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset=UTF-8\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${wrapBase64(toBase64(body))}\r\n.\r\n`;

    await writeAll(conn, message);
    expect(await readResponse(conn), [250], "corps du message");

    await sendCmd(conn, "QUIT", "QUIT", [221]).catch(() => {});
    conn.close();
    return { success: true };
  } catch (e) {
    try {
      conn?.close();
    } catch {
      // déjà fermée
    }
    // Erreur fréquente Infomaniak : "550 Relay denied" — voir README (vérifier l'adresse
    // exacte du compte, ou tenter le port 465/SSL).
    return { success: false, error: `Erreur SMTP : ${e instanceof Error ? e.message : String(e)}` };
  }
}
