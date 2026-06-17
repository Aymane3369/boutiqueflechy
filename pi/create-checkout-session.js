const Stripe = require('stripe');

// Initialiser Stripe avec la clé secrète
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // Autoriser uniquement les requêtes POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Récupérer les données du panier envoyées par le frontend
    const { items, total, clientEmail, promoCode, discount, orderId } = req.body;

    // Vérifier que les données sont valides
    if (!items || !total || !clientEmail) {
      return res.status(400).json({ 
        error: 'Données manquantes. Merci de fournir items, total et clientEmail.' 
      });
    }

    // Déterminer l'URL de base (pour les redirections)
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : 'https://boutiqueflechy.vercel.app';

    // Créer la session Stripe Checkout
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
            unit_amount: Math.round(total * 100), // Stripe utilise les centimes
          },
          quantity: 1,
        }
      ],
      success_url: `${baseUrl}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?cancel=true`,
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

    // Retourner l'URL de redirection vers Stripe
    return res.status(200).json({ 
      url: session.url,
      sessionId: session.id
    });

  } catch (error) {
    console.error('❌ Erreur création session Stripe:', error);
    return res.status(500).json({ 
      error: error.message || 'Erreur lors de la création de la session de paiement' 
    });
  }
};
