const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Récupérer le secret du webhook depuis les variables d'environnement
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const WEB3FORMS_ACCESS_KEY = process.env.WEB3FORMS_ACCESS_KEY;
const ADMIN_EMAIL = 'admin@styleshop.com';
const SUPABASE_URL = 'https://xrocqhazpmjcnqjdyytd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhyb2NxaGF6cG1qY25xamR5eXRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NjEwOTMsImV4cCI6MjA5NzEzNzA5M30.he8Gqs2h57Sq-knzKCr_C7BmZGHg76knhm0e3Y5EvF0';

exports.handler = async (event) => {
  // Vérifier la signature du webhook
  const signature = event.headers['stripe-signature'];
  
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      signature,
      WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`
    };
  }

  // Traiter uniquement les paiements réussis
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const metadata = session.metadata || {};

    const orderId = metadata.order_id || 'ORD-' + Math.random().toString(36).substring(2,8).toUpperCase();
    const clientEmail = metadata.client_email || 'client@email.com';
    const items = JSON.parse(metadata.items || '[]');
    const total = session.amount_total / 100;
    const promoCode = metadata.promo_code || null;
    const discount = parseFloat(metadata.discount || '0');

    // Créer la commande
    const order = {
      id: orderId,
      client: clientEmail,
      date: new Date().toISOString().slice(0,10),
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

    // Sauvegarder dans Supabase
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
    } catch (error) {
      console.error('Error saving order:', error);
    }

    // Mettre à jour les stocks
    for (const item of items) {
      try {
        const prodId = item.productId;
        const variantId = item.variantId;
        
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
            const newStock = Math.max(0, (prod.stock || 0) - item.qty);
            await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${prodId}`, {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ stock: newStock })
            });
          } else if (prod.variants) {
            const variant = prod.variants.find(v => v.id === variantId);
            if (variant) {
              variant.stock = Math.max(0, (variant.stock || 0) - item.qty);
              await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${prodId}`, {
                method: 'PATCH',
                headers: {
                  'apikey': SUPABASE_KEY,
                  'Authorization': `Bearer ${SUPABASE_KEY}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ variants: prod.variants })
              });
            }
          }
        }
      } catch (error) {
        console.error('Error updating stock:', error);
      }
    }

    // Envoyer les emails via Web3Forms
    const itemsList = items.map(i => `${i.name} x${i.qty}`).join(', ');
    const subject = `Confirmation de commande ${orderId}`;

    // Email au client
    try {
      await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          from_name: 'StyleShop',
          subject: subject,
          to: clientEmail,
          message: `Bonjour,\n\nVotre commande ${orderId} a été confirmée.\nMontant total : ${total.toFixed(2)} €\nArticles : ${itemsList}\n\nMerci pour votre confiance,\nL'équipe StyleShop`,
          reply_to: 'no-reply@styleshop.com'
        })
      });
    } catch (error) {
      console.error('Error sending client email:', error);
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
          to: ADMIN_EMAIL,
          message: `Nouvelle commande ${orderId} reçue.\nClient : ${clientEmail}\nMontant total : ${total.toFixed(2)} €\nArticles : ${itemsList}\nPromo : ${promoCode || 'Aucun'}`
        })
      });
    } catch (error) {
      console.error('Error sending admin email:', error);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true })
  };
};
