export const vapiConfig = {
  privateKey: process.env.VAPI_PRIVATE_KEY!,
  publicKey: process.env.VAPI_PUBLIC_KEY || null,
  orgId: process.env.VAPI_ORG_ID || null,
  phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || null,

  isConfigured() {
    return !!this.privateKey;
  },

  privateHeaders() {
    if (!this.privateKey) throw new Error('VAPI_PRIVATE_KEY not set in environment');
    return { Authorization: `Bearer ${this.privateKey}` };
  }
};
