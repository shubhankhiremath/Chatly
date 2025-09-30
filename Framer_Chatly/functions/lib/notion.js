/**
 * Server-side Notion client and helpers with retry.
 * SECURITY: NEVER expose NOTION_API_KEY on the client.
 */
const { Client } = require('@notionhq/client');

const NOTION_API_KEY = process.env.NOTION_API_KEY || 'YOUR_NOTION_API_KEY_HERE'; // TODO: Replace with your Notion integration key or set env var NOTION_API_KEY
const NOTION_POSTS_DB_ID = process.env.NOTION_POSTS_DB_ID || 'NOTION_POSTS_DB_ID_HERE'; // TODO: Add Posts DB ID
const NOTION_COMMENTS_DB_ID = process.env.NOTION_COMMENTS_DB_ID || 'NOTION_COMMENTS_DB_ID_HERE'; // TODO: Add Comments DB ID
const NOTION_UPVOTES_DB_ID = process.env.NOTION_UPVOTES_DB_ID || 'NOTION_UPVOTES_DB_ID_HERE'; // TODO: Add Upvotes DB ID

const notion = new Client({
  auth: NOTION_API_KEY
});

/**
 * Basic exponential backoff wrapper for Notion SDK calls.
 * Retries 429/5xx up to maxRetries.
 */
async function withRetry(fn, { maxRetries = 4, baseDelayMs = 400 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status || err?.statusCode;
      const isRateOrServer = status === 429 || (status >= 500 && status < 600);
      if (!isRateOrServer || attempt >= maxRetries) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

/**
 * Map a Notion post page to simplified JSON.
 */
function mapPost(page, commentsCount = 0) {
  const props = page.properties || {};
  const title = props['Title']?.title?.[0]?.plain_text || '';
  const content = props['Content']?.rich_text?.map(t => t.plain_text).join('') || '';
  const authorName = props['Author Name']?.rich_text?.[0]?.plain_text || props['Author Name']?.title?.[0]?.plain_text || props['Author Name']?.plain_text || props['Author Name']?.formula?.string || props['Author Name']?.rollup?.array?.[0]?.plain_text || props['Author Name']?.rich_text?.[0]?.plain_text || props['Author Name']?.text || props['Author Name']?.content || props['Author Name']?.value || props['Author Name']?.name || '';
  const authorId = props['Author ID']?.rich_text?.[0]?.plain_text || props['Author ID']?.plain_text || '';
  const upvotesCount = props['Upvotes Count']?.number || 0;
  const createdAt = page.created_time;

  return {
    id: page.id,
    title,
    content,
    authorName,
    authorId,
    created_at: createdAt,
    upvotesCount,
    commentsCount: typeof commentsCount === 'number' ? commentsCount : 0
  };
}

/**
 * Map a Notion comment page to simplified JSON.
 */
function mapComment(page) {
  const props = page.properties || {};
  const content = props['Content']?.rich_text?.map(t => t.plain_text).join('') || '';
  const authorName = props['Author Name']?.rich_text?.[0]?.plain_text || props['Author Name']?.plain_text || '';
  const authorId = props['Author ID']?.rich_text?.[0]?.plain_text || props['Author ID']?.plain_text || '';
  const createdAt = page.created_time;

  return {
    id: page.id,
    content,
    authorName,
    authorId,
    created_at: createdAt
  };
}

module.exports = {
  notion,
  withRetry,
  mapPost,
  mapComment,
  NOTION_POSTS_DB_ID,
  NOTION_COMMENTS_DB_ID,
  NOTION_UPVOTES_DB_ID
};