const admin = require('firebase-admin');
function getAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON não configurada');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)), projectId: 'mj-confeitaria' });
  }
  return admin;
}
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { Allow: 'POST' }, body: 'Método não permitido' };
  try {
    const a = getAdmin();
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) return { statusCode: 401, body: JSON.stringify({error:'Faça login no painel administrativo.'}) };
    const decoded = await a.auth().verifyIdToken(authHeader.slice(7));
    if (!process.env.ADMIN_UID || decoded.uid !== process.env.ADMIN_UID) return { statusCode: 403, body: JSON.stringify({error:'Usuário sem permissão para registrar notificações.'}) };
    const body = JSON.parse(event.body || '{}');
    const token = String(body.token || '');
    if (token.length < 50 || token.length > 4096) return { statusCode: 400, body: JSON.stringify({error:'Token push inválido.'}) };
    const id = require('crypto').createHash('sha256').update(token).digest('hex');
    await a.firestore().collection('pushSubscriptions').doc(id).set({ token, uid: decoded.uid, updatedAt: a.firestore.FieldValue.serverTimestamp(), platform:'web' }, { merge:true });
    return { statusCode: 200, headers:{'Content-Type':'application/json'}, body: JSON.stringify({ok:true}) };
  } catch (e) {
    console.error('register-push:', e.message);
    return { statusCode: 500, headers:{'Content-Type':'application/json'}, body: JSON.stringify({error:'Não foi possível registrar o dispositivo. Confira as variáveis seguras do Netlify.'}) };
  }
};
