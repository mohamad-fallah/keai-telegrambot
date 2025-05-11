require('dotenv').config();
const { Telegraf } = require('telegraf');
const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
const fs = require('fs/promises');
const pdfParse = require('pdf-parse');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function downloadTelegramFile(fileId) {
  const file = await bot.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
  const filePath = `/tmp/${fileId}.pdf`;
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(buffer));
  return filePath;
}

bot.start((ctx) => {
  ctx.reply('سلام! یک فایل PDF برای من بفرست تا متن صفحاتش رو استخراج و ذخیره کنم.');
});

bot.on('document', async (ctx) => {
  const doc = ctx.message.document;

  if (doc.mime_type !== 'application/pdf') {
    return ctx.reply('فقط فایل PDF قابل پردازشه.');
  }

  await ctx.reply('در حال دریافت و پردازش فایل...');

  try {
    const localPath = await downloadTelegramFile(doc.file_id);
    const buffer = await fs.readFile(localPath);
    const pdfData = await pdfParse(buffer);
    const pages = pdfData.text.split(/\f/);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        'INSERT INTO documents(user_id, file_id, file_name) VALUES ($1, $2, $3) RETURNING id',
        [ctx.from.id, doc.file_id, doc.file_name]
      );

      const documentId = result.rows[0].id;

      for (let i = 0; i < pages.length; i++) {
        const pageText = pages[i].trim();
        await client.query(
          'INSERT INTO pages(document_id, page_number, text_content) VALUES ($1, $2, $3)',
          [documentId, i + 1, pageText]
        );
      }

      await client.query('COMMIT');
      await ctx.reply(`✅ فایل با موفقیت ذخیره شد. تعداد صفحات: ${pages.length}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      await ctx.reply('❌ خطا در ذخیره داده‌ها.');
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    ctx.reply('❌ پردازش فایل با خطا مواجه شد.');
  }
});

bot.launch();
console.log('🤖 ربات با موفقیت راه‌اندازی شد.');

