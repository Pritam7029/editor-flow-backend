require('dotenv').config();
const Razorpay = require('razorpay');

async function checkRazorpay() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    console.log('--- Razorpay Gateway Integration Checker ---\n');
    console.log(`RAZORPAY_KEY_ID: ${keyId ? 'Found (starts with ' + keyId.substring(0, 8) + '...)' : 'MISSING'}`);
    console.log(`RAZORPAY_KEY_SECRET: ${keySecret ? 'Found (configured)' : 'MISSING'}`);
    console.log(`RAZORPAY_WEBHOOK_SECRET: ${process.env.RAZORPAY_WEBHOOK_SECRET ? 'Found' : 'NOT CONFIGURED (Signature check will be skipped or webhook will fail signature checks)'}`);
    console.log('');

    if (!keyId || !keySecret) {
        console.warn('⚠️  WARNING: Real Razorpay keys are not configured.');
        console.warn('The application is currently running in MOCK mode.');
        console.warn('Checkout flows will generate mock URLs, and confirm-mock-checkout will upgrade accounts without actual payments.\n');
        return;
    }

    try {
        console.log('Testing credentials with Razorpay API...');
        const rzp = new Razorpay({
            key_id: keyId,
            key_secret: keySecret
        });

        // Make a light-weight API request (fetch first payment)
        const response = await rzp.payments.all({ count: 1 });
        
        console.log('✅ SUCCESS: Razorpay credentials are valid and successfully authenticated!');
        console.log(`Connection test completed. Fetched ${response.items?.length || 0} recent payments.`);
    } catch (error) {
        console.error('❌ ERROR: Razorpay validation failed!');
        console.error('Please check if your key ID and key secret are correct.');
        console.error('Details:', error.message || error);
    }
}

checkRazorpay();
