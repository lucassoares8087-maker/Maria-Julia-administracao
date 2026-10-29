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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers:{Allow:'POST'}, body:'Método não permitido' };
  try {
    const a = getAdmin(); const db = a.firestore();
    const { orderId } = JSON.parse(event.body || '{}');
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(orderId)) return { statusCode:400, body:JSON.stringify({error:'Pedido inválido'}) };
    const orderRef = db.collection('pedidos').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return { statusCode:404, body:JSON.stringify({error:'Pedido não encontrado'}) };
    const order = orderSnap.data();
    const created = order.criadoEm && typeof order.criadoEm.toMillis === 'function' ? order.criadoEm.toMillis() : 0;
    // Só permite avisar sobre pedido criado recentemente, evitando usar o endpoint para disparar alertas antigos.
    if (!created || Date.now() - created > 10 * 60 * 1000 || created > Date.now() + 60 * 1000) return { statusCode:202, body:JSON.stringify({ok:true, skipped:'not_recent'}) };
    const sentRef = db.collection('pushSent').doc(orderId);
    const sentSnap = await sentRef.get();
    if (sentSnap.exists) return { statusCode:200, body:JSON.stringify({ok:true, duplicate:true}) };
    const subs = await db.collection('pushSubscriptions').get();
    const tokens = [...new Set(subs.docs.map(d => d.data().token).filter(t => typeof t === 'string' && t.length > 40))];
    if (!tokens.length) return { statusCode:200, body:JSON.stringify({ok:true, sent:0, note:'no_subscriptions'}) };
    const title = 'Novo pedido! 💗';
    const name = String(order.nome || 'Cliente').slice(0,80);
    const total = Number(order.total || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    // Envia DATA-ONLY. O service worker cria a notificação; não enviar notification/webpush.notification
    // evita que o navegador mostre uma notificação automática duplicada.
    const result = await a.messaging().sendEachForMulticast({
      tokens,
      data:{
        title,
        body:`${name} enviou um pedido • ${total}`,
        orderId,
        url:'/admin.html?tab=pedidos'
      },
      webpush:{headers:{TTL:'120', Urgency:'high'}}
    });
    const invalid = [];
    result.responses.forEach((r,i)=>{ if (!r.success && ['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(r.error?.code)) invalid.push(tokens[i]); });
    if (invalid.length) {
      const batch = db.batch();
      for (const token of invalid) { const id = require('crypto').createHash('sha256').update(token).digest('hex'); batch.delete(db.collection('pushSubscriptions').doc(id)); }
      await batch.commit();
    }
    await sentRef.set({ sentAt:a.firestore.FieldValue.serverTimestamp(), successCount:result.successCount, failureCount:result.failureCount });
    return { statusCode:200, headers:{'Content-Type':'application/json'}, body:JSON.stringify({ok:true,sent:result.successCount,failed:result.failureCount}) };
  } catch(e) {
    console.error('notify-new-order:',e.message);
    return { statusCode:500, headers:{'Content-Type':'application/json'}, body:JSON.stringify({error:'Falha ao enviar notificação. Confira as variáveis do Netlify e a configuração do Firebase.'}) };
  }
};
        
