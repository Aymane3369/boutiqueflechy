const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { items, total, clientEmail, promoCode, discount, orderId } = req.body;

    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : 'https://boutiqueflechy.vercel.app';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Commande StyleShop',
              description: items.map(i => `${i.name} x${i.qty}`).join(', '),
            },
            unit_amount: Math.round(total * 100),
          },
          quantity: 1,
        }
      ],
      success_url: `${baseUrl}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?cancel=true`,

      // === COLLECTE AUTOMATIQUE DES INFORMATIONS CLIENT ===
      // Stripe demandera lui-même l'email sur sa page de paiement

      // Adresse de livraison (Stripe affiche les champs)
      shipping_address_collection: {
        allowed_countries: ['FR', 'BE', 'CH', 'LU', 'DE', 'IT', 'ES', 'GB']
      },

      // Téléphone (optionnel)
      phone_number_collection: {
        enabled: true
      },

      metadata: {
        order_id: orderId || `ORD-${Date.now().toString(36).toUpperCase()}`,
        client_email: clientEmail,
        promo_code: promoCode || '',
        discount: String(discount || 0),
        items: JSON.stringify(items.map(i => ({
          productId: i.productId,
          variantId: i.variantId || null,
          qty: i.qty,
          price: i.price,
          name: i.name
        }))),
      },
    });

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error('❌ Erreur:', error);
    return res.status(500).json({ error: error.message });
  }
};
