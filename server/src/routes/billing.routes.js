const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

/**
 * POST /api/contact-sales
 * Log sales lead for Custom plans (Public/Authenticated)
 */
router.post('/contact-sales', async (req, res, next) => {
    try {
        const { companyName, contactName, email, phone, expectedMembers, expectedStorage, message } = req.body;

        if (!contactName || !email) {
            return res.status(400).json({
                success: false,
                message: 'Contact name and email are required'
            });
        }

        const userId = req.user ? req.user.id : null;

        const { data: lead, error } = await supabaseAdmin
            .from('sales_leads')
            .insert({
                user_id: userId,
                company_name: companyName || null,
                contact_name: contactName,
                email: email,
                phone: phone || null,
                expected_members: expectedMembers ? Number(expectedMembers) : null,
                expected_storage: expectedStorage || null,
                message: message || null,
                status: 'new'
            })
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json({
            success: true,
            message: 'Custom plan request submitted successfully. Our sales team will get in touch.',
            data: { lead }
        });
    } catch (error) {
        next(error);
    }
});

router.use(requireAuth);

/**
 * GET /api/plans
 * List all public plans
 */
router.get('/plans', async (req, res, next) => {
    try {
        const { data: plans, error } = await supabaseAdmin
            .from('plans')
            .select('*')
            .eq('is_public', true)
            .order('price_amount', { ascending: true });

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: 'Plans fetched successfully',
            data: { plans }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/billing/me
 * Get current user's billing account and subscription
 */
router.get('/billing/me', async (req, res, next) => {
    try {
        const { data: billingAccount, error: baError } = await supabaseAdmin
            .from('billing_accounts')
            .select('*')
            .eq('owner_id', req.user.id)
            .maybeSingle();

        if (baError) throw baError;

        let subscription = null;
        if (billingAccount) {
            const { data: sub, error: subError } = await supabaseAdmin
                .from('subscriptions')
                .select('*')
                .eq('billing_account_id', billingAccount.id)
                .maybeSingle();

            if (subError) throw subError;
            subscription = sub;
        }

        return res.status(200).json({
            success: true,
            message: 'Billing profile retrieved successfully',
            data: {
                billingAccount,
                subscription
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/billing/select-free
 * Onboard user onto the default Free plan
 */
router.post('/billing/select-free', async (req, res, next) => {
    try {
        // Check if billing account already exists
        let { data: billingAccount, error: baError } = await supabaseAdmin
            .from('billing_accounts')
            .select('*')
            .eq('owner_id', req.user.id)
            .maybeSingle();

        if (baError) throw baError;

        if (billingAccount) {
            return res.status(200).json({
                success: true,
                message: 'Billing account already exists',
                data: { billingAccount }
            });
        }

        // Create new free billing account
        const { data: newAccount, error: createError } = await supabaseAdmin
            .from('billing_accounts')
            .insert({
                owner_id: req.user.id,
                plan_key: 'free',
                status: 'active'
            })
            .select()
            .single();

        if (createError) throw createError;

        return res.status(201).json({
            success: true,
            message: 'Free plan selected successfully',
            data: { billingAccount: newAccount }
        });
    } catch (error) {
        next(error);
    }
});

// Import Razorpay service
const { 
    createCheckoutSessionService, 
    handleRazorpayWebhookService, 
    upgradeBillingAccount 
} = require('../services/razorpay.service');

/**
 * POST /api/billing/create-checkout-session
 * Create a Razorpay checkout session/payment link for Growth plan
 */
router.post('/billing/create-checkout-session', async (req, res, next) => {
    try {
        const { priceId } = req.body;
        const result = await createCheckoutSessionService(req.user.id, priceId);
        
        return res.status(200).json({
            success: true,
            message: result.isMock ? 'Mock checkout session created' : 'Checkout session created successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/billing/confirm-mock-checkout
 * Explicit mock confirmation endpoint to upgrade user to growth plan instantly in mock mode
 */
router.post('/billing/confirm-mock-checkout', async (req, res, next) => {
    try {
        const { sessionId } = req.body;
        
        // Upgrade user to growth plan using mock session ID
        const result = await upgradeBillingAccount(req.user.id, sessionId || `mock_sub_${Date.now()}`, 'growth', 'manual');
        
        return res.status(200).json({
            success: true,
            message: 'Mock subscription confirmed successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/billing/webhooks/razorpay
 * Razorpay Webhook Endpoint (requires raw body parser for signature checking)
 */
router.post('/billing/webhooks/razorpay', async (req, res, next) => {
    try {
        const sig = req.headers['x-razorpay-signature'];
        const rawBody = req.rawBody || req.body;
        
        const result = await handleRazorpayWebhookService(sig, rawBody);
        
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
