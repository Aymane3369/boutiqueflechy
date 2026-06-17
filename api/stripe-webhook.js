const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const WEB3FORMS_ACCESS_KEY = process.env.WEB3FORMS_ACCESS_KEY;
const ADMIN_EMAIL = 'admin@styleshop.com';

const SUPABASE_URL = 'https://xrocqhazpmjcnqjdyytd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhyb2NxaGF6cG1qY25xamR5eXRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NjEwOTMsImV4cCI6MjA5NzEzNzA5M30.he8Gqs2h57Sq-knzKCr_C7BmZGHg76knhm0e3Y5EvF0';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['stripe-signature'];
  
  if (!signature || !WEBHOOK_SECRET) {
    console.error('❌ Signature manquante ou secret non configuré');
    return res.status(400).send('Webhook Error: Missing signature');
  }

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      req.body,
      signature,
      WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`❌ Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`📩 Webhook reçu: ${stripeEvent.type}`);

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const metadata = session.metadata || {};

    // === RÉCUPÉRER LES INFORMATIONS CLIENT DEPUIS STRIPE ===
    const clientEmail = session.customer_details?.email || metadata.client_email || 'client@email.com';
    const clientName = session.customer_details?.name || '';
    const phoneNumber = session.customer_details?.phone || '';

    // Récupérer l'adresse de livraison
    const shippingDetails = session.shipping_details || null;
    const shippingName = shippingDetails?.name || '';
    const shippingAddress = shippingDetails?.address || null;

    const orderId = metadata.order_id || `ORD-${Date.now().toString(36).toUpperCase()}`;
    const items = JSON.parse(metadata.items || '[]');
    const total = session.amount_total / 100;
    const promoCode = metadata.promo_code || null;
    const discount = parseFloat(metadata.discount || '0');

    console.log(`✅ Commande ${orderId} - Client: ${clientEmail} - Total: ${total}€`);

    // === CONSTRUIRE LA COMMANDE AVEC TOUTES LES INFOS ===
    const order = {
      id: orderId,
      client: clientEmail,
      client_name: clientName,
      phone: phoneNumber,
      shipping_name: shippingName,
      shipping_address: shippingAddress,
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      items: items.map(i => ({
        productId: i.productId,
        variantId: i.variantId || null,
        qty: i.qty,
        price: i.price
      })),
      total: total,
      status: 'Payée',
      admin_followup: 'À traiter',
      promo_code: promoCode,
      discount: discount
    };

    // 1. Sauvegarder la commande dans Supabase
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(order)
      });
      console.log(`✅ Commande ${orderId} enregistrée dans Supabase`);
    } catch (error) {
      console.error('❌ Erreur sauvegarde commande:', error);
    }

    // 2. Mettre à jour les stocks
    for (const item of items) {
      try {
        const prodId = item.productId;
        const variantId = item.variantId;
        const qty = item.qty;

        const response = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${prodId}`, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          }
        });
        const product = await response.json();

        if (product && product.length > 0) {
          const prod = product[0];

          if (prod.type === 'simple') {
            const newStock = Math.max(0, (prod.stock || 0) - qty);
            await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${prodId}`, {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ stock: newStock })
            });
            console.log(`✅ Stock mis à jour pour ${prod.name}: ${newStock}`);
          } else if (prod.variants) {
            const variant = prod.variants.find(v => v.id === variantId);
            if (variant) {
              variant.stock = Math.max(0, (variant.stock || 0) - qty);
              await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${prodId}`, {
                method: 'PATCH',
                headers: {
                  'apikey': SUPABASE_KEY,
                  'Authorization': `Bearer ${SUPABASE_KEY}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ variants: prod.variants })
              });
              console.log(`✅ Stock mis à jour pour ${prod.name} - ${variant.attributes.taille}/${variant.attributes.couleur}: ${variant.stock}`);
            }
          }
        }
      } catch (error) {
        console.error('❌ Erreur mise à jour stock:', error);
      }
    }

    // 3. Envoyer les emails via Web3Forms
    if (WEB3FORMS_ACCESS_KEY) {
      const itemsList = items.map(i => `${i.name} x${i.qty}`).join(', ');
      
      // Construire l'adresse de livraison formatée
      let addressStr = 'Non renseignée';
      if (shippingAddress) {
        addressStr = `${shippingAddress.line1 || ''}`;
        if (shippingAddress.line2) addressStr += `\n${shippingAddress.line2}`;
        if (shippingAddress.postal_code || shippingAddress.city) {
          addressStr += `\n${shippingAddress.postal_code || ''} ${shippingAddress.city || ''}`;
        }
        if (shippingAddress.country) addressStr += `\n${shippingAddress.country}`;
      }

      // Email au client
      try {
        await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_key: WEB3FORMS_ACCESS_KEY,
            from_name: 'StyleShop',
            subject: `✅ Confirmation de commande ${orderId}`,
            to: clientEmail,
            message: `
Bonjour${clientName ? ' ' + clientName : ''},

Votre commande ${orderId} a été confirmée avec succès !

📦 Montant total : ${total.toFixed(2)} €
📋 Articles : ${itemsList}
${promoCode ? `🏷️ Code promo : ${promoCode} (-${discount}€)` : ''}

📮 Adresse de livraison :
${shippingName || clientName || 'Non renseigné'}
${addressStr}

📧 Email : ${clientEmail}
📱 Téléphone : ${phoneNumber || 'Non renseigné'}

Merci pour votre confiance,
L'équipe StyleShop
            `,
            reply_to: 'no-reply@styleshop.com'
          })
        });
        console.log(`✅ Email client envoyé à ${clientEmail}`);
      } catch (error) {
        console.error('❌ Erreur envoi email client:', error);
      }

      // Email à l'admin
      try {
        await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_key: WEB3FORMS_ACCESS_KEY,
            from_name: 'StyleShop (admin)',
            subject: `📦 Nouvelle commande ${orderId}`,
            to: aymaneabidine@gmail.com ,
            message: `
📋 Nouvelle commande ${orderId} reçue !

👤 Client : ${clientName || clientEmail}
📧 Email : ${clientEmail}
📱 Téléphone : ${phoneNumber || 'Non renseigné'}

📮 Adresse de livraison :
${shippingName || clientName || 'Non renseigné'}
${addressStr}

💶 Montant total : ${total.toFixed(2)} €
📦 Articles : ${itemsList}
🏷️ Promo : ${promoCode || 'Aucun'} ${promoCode ? `(-${discount}€)` : ''}

✅ Commande enregistrée dans Supabase.
            `
          })
        });
        console.log(`✅ Email admin envoyé à ${ADMIN_EMAIL}`);
      } catch (error) {
        console.error('❌ Erreur envoi email admin:', error);
      }
    } else {
      console.warn('⚠️ WEB3FORMS_ACCESS_KEY non configurée');
    }
  }

  return res.status(200).json({ received: true });
};
