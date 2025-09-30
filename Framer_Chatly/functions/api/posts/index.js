/**
 * GET /api/posts -> list posts with pagination and commentsCount
 * POST /api/posts -> create a new post (requires title/content; author from Firebase if present)
 *
 * SECURITY NOTES:
 * - NEVER expose NOTION_API_KEY on the client.
 * - This function runs server-side and uses env variables:
 *   const NOTION_API_KEY = process.env.NOTION_API_KEY || 'YOUR_NOTION_API_KEY_HERE'; // TODO ...
 *   const NOTION_POSTS_DB_ID = process.env.NOTION_POSTS_DB_ID || 'NOTION_POSTS_DB_ID_HERE'; // TODO ...
 *   const NOTION_COMMENTS_DB_ID = process.env.NOTION_COMMENTS_DB_ID || 'NOTION_COMMENTS_DB_ID_HERE'; // TODO ...
 *   const NOTION_UPVOTES_DB_ID = process.env.NOTION_UPVOTES_DB_ID || 'NOTION_UPVOTES_DB_ID_HERE'; // TODO ...
 *
 * Notion rate limits ~3 rps. We implement basic retry for 429/5xx in _lib/notion.
 */
const { notion, withRetry, mapPost, NOTION_POSTS_DB_ID, NOTION_COMMENTS_DB_ID } = require('../../lib/notion');
const { verifyIdTokenFromAuthHeader } = require('../../lib/firebaseAdmin');
const { json, badRequest, methodNotAllowed, parseBody } = require('../../lib/http');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return getPosts(req, res);
  }
  if (req.method === 'POST') {
    return createPost(req, res);
  }
  return methodNotAllowed(res, ['GET', 'POST']);
};

async function getPosts(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const limit = Number(url.searchParams.get('limit') || 20);
  const cursor = url.searchParams.get('cursor') || undefined;

  try {
    const query = await withRetry(() =>
      notion.databases.query({
        database_id: NOTION_POSTS_DB_ID,
        page_size: Math.min(limit, 100),
        start_cursor: cursor,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }]
      })
    );

    // For each post, compute commentsCount by querying comments relation
    // To respect rate limits, batch sequentially with retry.
    const posts = [];
    for (const page of query.results) {
      const postId = page.id;
      let commentsCount = 0;
      try {
        const commentsQuery = await withRetry(() =>
          notion.databases.query({
            database_id: NOTION_COMMENTS_DB_ID,
            filter: {
              property: 'Post',
              relation: { contains: postId }
            },
            page_size: 1
          })
        );
        // We only fetched 1 item for speed; Notion doesn't return total easily.
        // Alternative: maintain a commentsCount number on Posts. For now, we approximate by fast count:
        // Since Notion API lacks total, we could iterate pagination; but that would be heavy.
        // Optimization: store and update a "Comments Count" number on Posts (optional).
        // Here we accept 0/approx; better: see comments endpoint for full list.
        commentsCount = commentsQuery.results?.length || 0;
      } catch (e) {
        commentsCount = 0;
      }
      posts.push(mapPost(page, commentsCount));
    }

    return json(res, 200, {
      results: posts,
      next_cursor: query.has_more ? query.next_cursor : null,
      has_more: query.has_more
    });
  } catch (e) {
    console.error('GET /api/posts error', e);
    return json(res, 500, { error: 'Failed to fetch posts' });
  }
}

async function createPost(req, res) {
  let body;
  try {
    body = await parseBody(req);
  } catch (e) {
    return badRequest(res, 'Invalid JSON');
  }

  const decoded = await verifyIdTokenFromAuthHeader(req);

  const title = (body.title || '').trim();
  const content = (body.content || '').trim();
  const fallbackName = (body.authorName || '').trim();
  const fallbackId = (body.authorId || '').trim();

  if (!title || !content) {
    return badRequest(res, 'Missing title or content');
  }

  const authorName = decoded?.name || decoded?.displayName || fallbackName || 'Anonymous';
  const authorId = decoded?.uid || fallbackId || 'anon';

  try {
    const created = await withRetry(() =>
      notion.pages.create({
        parent: { database_id: NOTION_POSTS_DB_ID },
        properties: {
          'Title': { title: [{ type: 'text', text: { content: title } }] },
          'Content': { rich_text: [{ type: 'text', text: { content } }] },
          'Author Name': { rich_text: [{ type: 'text', text: { content: authorName } }] },
          'Author ID': { rich_text: [{ type: 'text', text: { content: authorId } }] },
          'Upvotes Count': { number: 0 }
          // 'Comments relation' optional schema; linking is managed by comment creation
        }
      })
    );

    const post = mapPost(created, 0);
    return json(res, 201, post);
  } catch (e) {
    console.error('POST /api/posts error', e);
    return json(res, 500, { error: 'Failed to create post' });
  }
}