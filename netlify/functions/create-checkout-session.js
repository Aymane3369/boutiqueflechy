// supabase/functions/create-checkout/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0";

// Récupérer la clé secrète depuis Vault
const stripe = new Stripe(Deno.env.get('stripe_secret_key') || '', {
    apiVersion: '2023-10-16',
});

serve(async (req) => {
    try {
        // Récupérer les données du panier envoyées par le frontend
        const { items, total, clientEmail, promoCode, discount, orderId } = await req.json();

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
            success_url: `${req.headers.get('origin')}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.headers.get('origin')}/?cancel=true`,
            metadata: {
                order_id: orderId,
                client_email: clientEmail,
                promo_code: promoCode || '',
                discount: String(discount || 0),
                items: JSON.stringify(items),
            },
        });

        // Retourner l'URL de redirection vers Stripe
        return new Response(JSON.stringify({ url: session.url }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error) {
        console.error('Error creating checkout session:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});
