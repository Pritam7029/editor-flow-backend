const { supabaseAdmin } = require('../config/supabase');
let stripe = null;

if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

/**
 * Create a checkout session for Stripe or returns a mock URL.
 */
async function createCheckoutSessionService(userId, priceId) {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

    if (stripe) {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'subscription',
            success_url: `${clientUrl}/onboarding/plan?success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${clientUrl}/onboarding/plan?canceled=true`,
            client_reference_id: userId,
            metadata: { userId }
        });
        return { url: session.url, isMock: false };
    } else {
        // Fallback mock session URL
        const mockSessionId = `mock_session_${Date.now()}`;
        const mockUrl = `${clientUrl}/onboarding/plan?success=true&session_id=${mockSessionId}`;
        return { url: mockUrl, isMock: true };
    }
}

/**
 * Handle Stripe Webhook Events
 */
async function handleStripeWebhookService(sig, rawBody) {
    if (!stripe) {
        throw new Error('Stripe is not configured');
    }

    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
        event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        throw new Error(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const userId = session.client_reference_id || (session.metadata && session.metadata.userId);
            const subscriptionId = session.subscription;

            if (userId && subscriptionId) {
                await upgradeBillingAccount(userId, subscriptionId, 'growth', 'stripe');
                console.log(`Stripe subscription upgraded successfully for user: ${userId}`);
            }
            break;
        }
        case 'invoice.payment_succeeded': {
            const invoice = event.data.object;
            // Additional logging / processing if needed
            break;
        }
        case 'customer.subscription.deleted': {
            const subscription = event.data.object;
            await cancelBillingAccountSubscription(subscription.id);
            console.log(`Stripe subscription deleted successfully: ${subscription.id}`);
            break;
        }
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    return { received: true };
}

/**
 * Upgrade a user's billing account and sync subscription details.
 */
async function upgradeBillingAccount(userId, providerSubscriptionId, planKey = 'growth', provider = 'stripe') {
    // 1. Fetch or create billing account
    let { data: billingAccount, error: baError } = await supabaseAdmin
        .from('billing_accounts')
        .select('*')
        .eq('owner_id', userId)
        .maybeSingle();

    if (baError) throw baError;

    if (!billingAccount) {
        const { data: newAccount, error: createError } = await supabaseAdmin
            .from('billing_accounts')
            .insert({
                owner_id: userId,
                plan_key: planKey,
                status: 'active'
            })
            .select()
            .single();

        if (createError) throw createError;
        billingAccount = newAccount;
    } else {
        const { data: updatedAccount, error: updateError } = await supabaseAdmin
            .from('billing_accounts')
            .update({
                plan_key: planKey,
                status: 'active',
                updated_at: new Date()
            })
            .eq('id', billingAccount.id)
            .select()
            .single();

        if (updateError) throw updateError;
        billingAccount = updatedAccount;
    }

    // 2. Upsert subscription record
    const currentStart = new Date();
    const currentEnd = new Date();
    currentEnd.setDate(currentEnd.getDate() + 30); // 30 days renewal

    const { data: subscription, error: subError } = await supabaseAdmin
        .from('subscriptions')
        .upsert({
            billing_account_id: billingAccount.id,
            provider: provider,
            provider_subscription_id: providerSubscriptionId,
            status: 'active',
            current_period_start: currentStart,
            current_period_end: currentEnd,
            cancel_at_period_end: false,
            updated_at: new Date()
        }, { onConflict: 'provider_subscription_id' })
        .select()
        .single();

    if (subError) throw subError;

    return { billingAccount, subscription };
}

/**
 * Cancel/disable a subscription when it is deleted in Stripe.
 */
async function cancelBillingAccountSubscription(providerSubscriptionId) {
    const { data: subscription, error: subError } = await supabaseAdmin
        .from('subscriptions')
        .update({
            status: 'canceled',
            updated_at: new Date()
        })
        .eq('provider_subscription_id', providerSubscriptionId)
        .select()
        .single();

    if (subError || !subscription) {
        console.error('Subscription cancellation failed:', subError || 'Subscription not found');
        return;
    }

    // Set billing account to inactive
    await supabaseAdmin
        .from('billing_accounts')
        .update({
            plan_key: 'free',
            updated_at: new Date()
        })
        .eq('id', subscription.billing_account_id);
}

module.exports = {
    createCheckoutSessionService,
    handleStripeWebhookService,
    upgradeBillingAccount
};
