import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { cart } = req.body;

  const line_items = cart.map(item => ({
    price_data: {
      currency: "eur",
      product_data: {
        name: item.name
      },
      unit_amount: Math.round(item.price * 100)
    },
    quantity: item.quantity
  }));

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items,
    success_url: `${req.headers.origin}/?success=1`,
    cancel_url: `${req.headers.origin}/?cancel=1`
  });

  res.json({ url: session.url });
}
