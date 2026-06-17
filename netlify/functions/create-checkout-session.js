const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  try {
    // Récupérer les données du panier
    const { items, total, clientEmail, promoCode, discount, orderId } = JSON.parse(event.body);

    // Créer la session Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Commande StyleShop",
              description: items.map(i => `${i.name} x${i.qty}`).join(', '),
            },
            unit_amount: Math.round(total * 100),
          },
          quantity: 1,
        }
      ],
      success_url: `${process.env.URL}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.URL}/?cancel=true`,
      metadata: {
        order_id: orderId,
        client_email: clientEmail,
        promo_code: promoCode || '',
        discount: String(discount || 0),
        items: JSON.stringify(items),
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };

  } catch (error) {
    console.error('Error creating checkout session:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
