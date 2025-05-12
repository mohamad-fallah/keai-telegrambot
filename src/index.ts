import { Telegraf, Context } from "telegraf";
import fetch from "node-fetch";
import * as fs from "fs/promises";
import pdfParse from "pdf-parse";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function downloadTelegramFile(fileId: string): Promise<string> {
  const file = await bot.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
  const filePath = `/tmp/${fileId}.pdf`;
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(buffer));
  return filePath;
}

bot.start((ctx: Context) => {
  ctx.reply(
    "سلام! یک فایل PDF برای من بفرست تا متن صفحاتش رو استخراج و ذخیره کنم."
  );
});

bot.on("document", async (ctx) => {
  const message = ctx.message;
  const doc = message && "document" in message ? message.document : undefined;

  if (!doc || doc.mime_type !== "application/pdf") {
    return ctx.reply("فقط فایل PDF قابل پردازشه.");
  }

  await ctx.reply("در حال دریافت و پردازش فایل...");

  try {
    const localPath = await downloadTelegramFile(doc.file_id);
    const buffer = await fs.readFile(localPath);

    const pageTexts: string[] = [];

    const pdfData = await pdfParse(buffer, {
      pagerender: async (pageData: any) => {
        const tc = await pageData.getTextContent();
        const txt = tc.items.map((i: any) => i.str).join(" ");
        pageTexts.push(txt.trim());
        return txt;
      },
    });

    const pages = pageTexts.length ? pageTexts : [pdfData.text];

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        "INSERT INTO documents(user_id, file_id, file_name) VALUES ($1, $2, $3) RETURNING id",
        [ctx.from?.id, doc.file_id, doc.file_name]
      );

      const documentId = result.rows[0].id;

      for (let i = 0; i < pages.length; i++) {
        await client.query(
          "INSERT INTO pages(document_id, page_number, text_content) VALUES ($1, $2, $3)",
          [documentId, i + 1, pages[i]]
        );
      }

      await client.query("COMMIT");
      await ctx.reply(
        `✅ فایل با موفقیت ذخیره شد. تعداد صفحات: ${pages.length}`
      );
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      await ctx.reply("❌ خطا در ذخیره داده‌ها.");
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    ctx.reply("❌ پردازش فایل با خطا مواجه شد.");
  }
});

bot.launch();
console.log("🤖 ربات TypeScript با موفقیت راه‌اندازی شد.");
