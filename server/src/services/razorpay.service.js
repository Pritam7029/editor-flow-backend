const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');

let razorpay = null;

if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    const Razorpay = require('razorpay');
    razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
}

/**
 * Create a checkout payment link for Razorpay or returns a mock URL.
 */
async function createCheckoutSessionService(userId, priceId) {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

    if (razorpay) {
        // Fetch user profile info
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

        const paymentLink = await razorpay.paymentLink.create({
            amount: 2500, // $25.00 / 2500 paise
            currency: 'USD',
            accept_partial: false,
            description: 'EditorFlow Growth Plan Subscription Upgrade',
            customer: {
                name: profile?.full_name || 'Creative Member',
                email: profile?.email || ''
            },
            notify: {
                sms: false,
                email: true
            },
            reminder_enable: false,
            notes: {
                userId: userId,
                planKey: 'growth'
            },
            callback_url: `${clientUrl}/onboarding/plan?success=true&session_id=plink_${Date.now()}`,
            callback_method: 'get'
        });

        return { url: paymentLink.short_url, isMock: false };
    } else {
        // Fallback mock session URL
        const mockSessionId = `mock_session_razorpay_${Date.now()}`;
        const mockUrl = `${clientUrl}/onboarding/plan?success=true&session_id=${mockSessionId}`;
        return { url: mockUrl, isMock: true };
    }
}

/**
 * Handle Razorpay Webhook Events
 */
async function handleRazorpayWebhookService(sig, rawBody) {
    if (!razorpay) {
        throw new Error('Razorpay is not configured');
    }

    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    
    // Verify signature
    if (webhookSecret) {
        const shasum = crypto.createHmac('sha256', webhookSecret);
        shasum.update(rawBody);
        const digest = shasum.digest('hex');
        if (digest !== sig) {
            console.error('Razorpay Webhook Signature Verification Failed');
            throw new Error('Invalid signature');
        }
    }

    const event = JSON.parse(rawBody.toString());
    console.log(`Razorpay webhook received event: ${event.event}`);

    // Parse user notes and subscription details depending on event schema
    let userId = null;
    let subscriptionId = null;

    if (event.event === 'payment_link.paid') {
        const paymentLink = event.payload.payment_link.entity;
        userId = paymentLink.notes?.userId;
        subscriptionId = paymentLink.id;
    } else if (event.event === 'payment.captured') {
        const payment = event.payload.payment.entity;
        userId = payment.notes?.userId;
        subscriptionId = payment.id;
    } else if (event.event === 'subscription.charged') {
        const subCharged = event.payload.subscription.entity;
        userId = subCharged.notes?.userId;
        subscriptionId = subCharged.id;
    } else if (event.event === 'subscription.cancelled') {
        const subCancelled = event.payload.subscription.entity;
        subscriptionId = subCancelled.id;
        await cancelBillingAccountSubscription(subscriptionId);
        return { received: true };
    }

    if (userId && subscriptionId) {
        await upgradeBillingAccount(userId, subscriptionId, 'growth', 'razorpay');
        console.log(`Razorpay subscription/order upgraded successfully for user: ${userId}`);
    }

    return { received: true };
}

/**
 * Upgrade a user's billing account and sync subscription details.
 */
async function upgradeBillingAccount(userId, providerSubscriptionId, planKey = 'growth', provider = 'razorpay') {
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
 * Cancel/disable a subscription when it is deleted/cancelled in Razorpay.
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
    handleRazorpayWebhookService,
    upgradeBillingAccount
};
