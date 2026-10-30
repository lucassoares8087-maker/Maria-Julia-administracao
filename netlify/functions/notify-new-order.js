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
    const a = getAdmin(); const db = a.firestore();
    const { orderId } = JSON.parse(event.body || '{}');
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(orderId)) return reply(event, 400, { error: 'Pedido inválido' });
    const orderRef = db.collection('pedidos').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return reply(event, 404, { error: 'Pedido não encontrado' });
    const order = orderSnap.data();
    const created = order.criadoEm && typeof order.criadoEm.toMillis === 'function' ? order.criadoEm.toMillis() : 0;
    if (!created || Date.now() - created > 10 * 60 * 1000 || created > Date.now() + 60 * 1000) return reply(event, 202, { ok: true, skipped: 'not_recent' });
    const sentRef = db.collection('pushSent').doc(orderId);
    const sentSnap = await sentRef.get();
    if (sentSnap.exists) return reply(event, 200, { ok: true, duplicate: true });
    const subs = await db.collection('pushSubscriptions').get();
    const tokens = [...new Set(subs.docs.map(d => d.data().token).filter(t => typeof t === 'string' && t.length > 40))];
    if (!tokens.length) return reply(event, 200, { ok: true, sent: 0, note: 'no_subscriptions' });
    const title = 'Novo pedido! 💗';
    const name = String(order.nome || 'Cliente').slice(0, 80);
    const total = Number(order.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const result = await a.messaging().sendEachForMulticast({
      tokens,
      data: { title, body: `${name} enviou um pedido • ${total}`, orderId, url: '/admin.html?tab=pedidos' },
      webpush: { headers: { TTL: '120', Urgency: 'high' } }
    });
    const invalid = [];
    result.responses.forEach((r, i) => { if (!r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(r.error?.code)) invalid.push(tokens[i]); });
    if (invalid.length) {
      const batch = db.batch();
      for (const token of invalid) { const id = require('crypto').createHash('sha256').update(token).digest('hex'); batch.delete(db.collection('pushSubscriptions').doc(id)); }
      await batch.commit();
    }
    await sentRef.set({ sentAt: a.firestore.FieldValue.serverTimestamp(), successCount: result.successCount, failureCount: result.failureCount });
    return reply(event, 200, { ok: true, sent: result.successCount, failed: result.failureCount });
  } catch (e) {
    console.error('notify-new-order:', e.message);
    return reply(event, 500, { error: 'Falha ao enviar notificação. Confira as variáveis do Netlify e a configuração do Firebase.' });
  }
};
