/**
 * POST /api/posts/:postId/upvote -> toggle upvote for the authenticated user
 *
 * Flow:
 * - Verify Firebase ID token
 * - Check if Upvote record exists for (postId, userId)
 * - If exists -> delete it and decrement Posts.Upvotes Count
 * - If not -> create it and increment Posts.Upvotes Count
 *
 * SECURITY: DO NOT expose Notion key on client.
 */
const { notion, withRetry, NOTION_UPVOTES_DB_ID, NOTION_POSTS_DB_ID } = require('../../../lib/notion');
const { verifyIdTokenFromAuthHeader } = require('../../../lib/firebaseAdmin');
const { json, unauthorized, methodNotAllowed } = require('../../../lib/http');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const postId = pathParts[pathParts.length - 2] === 'posts' ? pathParts[pathParts.length - 1] : pathParts[pathParts.length - 2];
  // Vercel routing passes correctly; above is a fallback if mounted differently.

  if (!postId) {
    return json(res, 400, { error: 'Missing postId' });
  }

  const decoded = await verifyIdTokenFromAuthHeader(req);
  if (!decoded) {
    return unauthorized(res, 'You must be signed in to upvote');
  }

  const userId = decoded.uid;

  try {
    // Find existing upvote record
    const existing = await withRetry(() =>
      notion.databases.query({
        database_id: NOTION_UPVOTES_DB_ID,
        filter: {
          and: [
            { property: 'User ID', rich_text: { equals: userId } },
            { property: 'Post', relation: { contains: postId } }
          ]
        },
        page_size: 1
      })
    );

    let upvoted;
    if (existing.results.length > 0) {
      // Remove upvote
      const upvotePageId = existing.results[0].id;
      await withRetry(() => notion.pages.update({ page_id: upvotePageId, archived: true }));
      upvoted = false;
      await adjustPostUpvoteCount(postId, -1);
    } else {
      // Create upvote
      await withRetry(() =>
        notion.pages.create({
          parent: { database_id: NOTION_UPVOTES_DB_ID },
          properties: {
            'User ID': { rich_text: [{ type: 'text', text: { content: userId } }] },
            'Post': { relation: [{ id: postId }] }
          }
        })
      );
      upvoted = true;
      await adjustPostUpvoteCount(postId, +1);
    }

    // Fetch latest upvotes count
    const postPage = await withRetry(() => notion.pages.retrieve({ page_id: postId }));
    const upvotesCount = postPage.properties?.['Upvotes Count']?.number || 0;

    return json(res, 200, { upvoted, upvotesCount });
  } catch (e) {
    console.error('POST /api/posts/:postId/upvote error', e);
    return json(res, 500, { error: 'Failed to toggle upvote' });
  }
}

async function adjustPostUpvoteCount(postId, delta) {
  // Read current and update with new count
  const page = await withRetry(() => notion.pages.retrieve({ page_id: postId }));
  const current = page.properties?.['Upvotes Count']?.number || 0;
  const next = Math.max(0, current + delta);
  // NOTE: Notion does not support atomic increments; risk of race under high concurrency.
  // For this app, it's acceptable. Consider adding queue or lock if needed.
  await withRetry(() =>
    notion.pages.update({
      page_id: postId,
      properties: {
        'Upvotes Count': { number: next }
      }
    })
  );
}