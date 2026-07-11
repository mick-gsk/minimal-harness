/**
 * RFC 5322 rendering.
 *
 * One .eml per thread, carrying the newest message with the older ones quoted below in the
 * German Outlook style ("Von: / Gesendet: / An: / Betreff:"). That is how these files
 * actually look on a Mittelstand fileserver, and it means a thread's knowledge sits in one
 * retrievable document.
 *
 * Deliberately UTF-8: the CP1252 trap belongs on the ERP and DATEV exports, where it is
 * authentic. Putting it here too would only make the corpus unreadable without teaching
 * anything new.
 */
import { deLongDateTime, parseIsoDate, rfc5322Date } from "../lib/fmt.js";
import type { MailMessage, MailThread } from "../model/types.js";

function toEpoch(isoDateTime: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(isoDateTime);
  if (!match) throw new Error(`not an ISO datetime: ${isoDateTime}`);
  const [, date, hh, mm, ss] = match;
  if (!date || !hh || !mm || !ss) throw new Error(`not an ISO datetime: ${isoDateTime}`);
  return parseIsoDate(date) + (Number(hh) * 3600 + Number(mm) * 60 + Number(ss)) * 1000;
}

function quoteHistory(message: MailMessage, subject: string): string {
  // German Outlook writes "Donnerstag, 14. März 2024 16:42" here, not an RFC 5322 stamp.
  // The RFC form belongs in the Date: header, and only there.
  return [
    "",
    "-----Ursprüngliche Nachricht-----",
    `Von: ${message.from}`,
    `Gesendet: ${deLongDateTime(toEpoch(message.sentIso))}`,
    `An: ${message.to.join("; ")}`,
    ...(message.cc && message.cc.length > 0 ? [`Cc: ${message.cc.join("; ")}`] : []),
    `Betreff: ${subject}`,
    "",
    message.body,
  ].join("\r\n");
}

export function renderThread(thread: MailThread): string {
  const newest = thread.messages[thread.messages.length - 1];
  if (!newest) throw new Error(`thread ${thread.id} has no messages`);
  const older = thread.messages.slice(0, -1).reverse();

  const headers = [
    `Message-ID: <${thread.id.replace(":", ".")}@selkinghaus.de>`,
    `Date: ${rfc5322Date(toEpoch(newest.sentIso))}`,
    `From: ${newest.from}`,
    `To: ${newest.to.join(", ")}`,
    ...(newest.cc && newest.cc.length > 0 ? [`Cc: ${newest.cc.join(", ")}`] : []),
    `Subject: ${thread.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "X-Mailer: Microsoft Outlook 16.0",
  ];

  const body = [newest.body, ...older.map((m) => quoteHistory(m, thread.subject))].join("\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}\r\n`;
}
