const admin = require('firebase-admin');
const ALLOWED_ORIGINS = new Set([
  'https://lucassoares8087-maker.github.io',
  'https://mj-confeitaria-pedidos.netlify.app'
]);
function corsHeaders(event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://lucassoares8087-maker.github.io',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}
function reply(event, statusCode, body) {
  return { statusCode, headers: corsHeaders(event), body: typeof body === 'string' ? body : JSON.stringify(body) };
}
function getAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON não configurada');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)), projectId: 'mj-confeitaria' });
  }
  return admin;
}
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(event), body: '' };
  if (event.httpMethod !== 'POST') return reply(event, 405, { error: 'Método não permitido' });
  try {
    const a = getAdmin();
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) return reply(event, 401, { error: 'Faça login no painel administrativo.' });
    const decoded = await a.auth().verifyIdToken(authHeader.slice(7));
    if (!process.env.ADMIN_UID || decoded.uid !== process.env.ADMIN_UID) return reply(event, 403, { error: 'Usuário sem permissão para registrar notificações.' });
    const body = JSON.parse(event.body || '{}');
    const token = String(body.token || '');
    if (token.length < 50 || token.length > 4096) return reply(event, 400, { error: 'Token push inválido.' });
    const id = require('crypto').createHash('sha256').update(token).digest('hex');
    await a.firestore().collection('pushSubscriptions').doc(id).set({ token, uid: decoded.uid, updatedAt: a.firestore.FieldValue.serverTimestamp(), platform: 'web' }, { merge: true });
    return reply(event, 200, { ok: true });
  } catch (e) {
    console.error('register-push:', e.message);
    return reply(event, 500, { error: 'Não foi possível registrar o dispositivo. Confira as variáveis seguras do Netlify.' });
  }
};
