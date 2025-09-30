/**
 * GET /api/posts/:postId/comments -> list comments sorted by created_time asc
 * POST /api/posts/:postId/comments -> create comment (auth optional; use authorName if not logged in)
 *
 * SECURITY: DO NOT expose Notion key on client.
 */
const { notion, withRetry, mapComment, NOTION_COMMENTS_DB_ID, NOTION_POSTS_DB_ID } = require('../../../../lib/notion');
const { verifyIdTokenFromAuthHeader } = require('../../../../lib/firebaseAdmin');
const { json, badRequest, methodNotAllowed, parseBody } = require('../../../../lib/http');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return getComments(req, res);
  }
  if (req.method === 'POST') {
    return createComment(req, res);
  }
  return methodNotAllowed(res, ['GET', 'POST']);
};

function getPostId(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('posts');
  return idx >= 0 ? parts[idx + 1] : null;
}

async function getComments(req, res) {
  const postId = getPostId(req);
  if (!postId) return badRequest(res, 'Missing postId');

  try {
    // paginate if needed; here we return up to 100 for simplicity
    const query = await withRetry(() =>
      notion.databases.query({
        database_id: NOTION_COMMENTS_DB_ID,
        filter: { property: 'Post', relation: { contains: postId } },
        sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
        page_size: 100
      })
    );

    const comments = query.results.map(mapComment);
    return json(res, 200, { results: comments });
  } catch (e) {
    console.error('GET /api/posts/:postId/comments error', e);
    return json(res, 500, { error: 'Failed to fetch comments' });
  }
}

async function createComment(req, res) {
  const postId = getPostId(req);
  if (!postId) return badRequest(res, 'Missing postId');

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return badRequest(res, 'Invalid JSON');
  }

  const decoded = await verifyIdTokenFromAuthHeader(req);
  const content = (body.content || '').trim();
  const fallbackName = (body.authorName || '').trim();

  if (!content) return badRequest(res, 'Missing content');

  const authorName = decoded?.name || decoded?.displayName || fallbackName || 'Anonymous';
  const authorId = decoded?.uid || body.authorId || 'anon';

  try {
    const created = await withRetry(() =>
      notion.pages.create({
        parent: { database_id: NOTION_COMMENTS_DB_ID },
        properties: {
          'Content': { rich_text: [{ type: 'text', text: { content } }] },
          'Post': { relation: [{ id: postId }] },
          'Author Name': { rich_text: [{ type: 'text', text: { content: authorName } }] },
          'Author ID': { rich_text: [{ type: 'text', text: { content: authorId } }] }
        }
      })
    );

    const comment = mapComment(created);

    // Optional: maintain a "Comments Count" on Posts page for performance.
    // You can add a number property "Comments Count" and increment here.

    return json(res, 201, comment);
  } catch (e) {
    console.error('POST /api/posts/:postId/comments error', e);
    return json(res, 500, { error: 'Failed to create comment' });
  }
}