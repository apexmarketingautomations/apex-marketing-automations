export interface Message {
  id: string;
  subAccountId: string;
  direction: 'inbound' | 'outbound';
  body: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'received';
  createdAt: string;
  contactPhone: string;
  channel?: 'sms' | 'instagram' | 'email';
}

export interface SubAccount {
  id: string;
  name: string;
  twilioNumber: string;
}

// Mock Data
export const MOCK_ACCOUNTS: SubAccount[] = [
  { id: 'acc_1', name: 'Sales Team A', twilioNumber: '+15550101' },
  { id: 'acc_2', name: 'Support Team', twilioNumber: '+15550102' },
];

const INITIAL_MESSAGES: Message[] = [
  {
    id: 'msg_1',
    subAccountId: 'acc_1',
    direction: 'inbound',
    body: 'Hey, I am interested in the enterprise plan.',
    status: 'received',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
    contactPhone: '+15559999',
    channel: 'sms'
  },
  {
    id: 'msg_2',
    subAccountId: 'acc_1',
    direction: 'outbound',
    body: 'Hi there! I would be happy to help you with that. When are you free for a call?',
    status: 'delivered',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 1.9).toISOString(),
    contactPhone: '+15559999',
    channel: 'sms'
  }
];

// Simple in-memory store for the prototype
let messagesStore = [...INITIAL_MESSAGES];

export const mockApi = {
  getAccounts: async () => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return MOCK_ACCOUNTS;
  },

  getMessages: async (subAccountId: string) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return messagesStore
      .filter(m => m.subAccountId === subAccountId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  sendSms: async (payload: { subAccountId: string; contactPhone: string; messageBody: string }) => {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay

    const newMessage: Message = {
      id: `msg_${Date.now()}`,
      subAccountId: payload.subAccountId,
      direction: 'outbound',
      body: payload.messageBody,
      status: 'sent',
      createdAt: new Date().toISOString(),
      contactPhone: payload.contactPhone,
      channel: 'sms'
    };

    messagesStore.push(newMessage);
    return { success: true, sid: `SM${Date.now()}`, message: newMessage };
  },

  // Added to simulate the sendInstagramReply function
  sendInstagram: async (payload: { subAccountId: string; recipientId: string; text: string }) => {
    await new Promise(resolve => setTimeout(resolve, 800)); // Simulate Meta API latency

    const newMessage: Message = {
      id: `ig_${Date.now()}`,
      subAccountId: payload.subAccountId,
      direction: 'outbound',
      body: payload.text,
      status: 'sent',
      createdAt: new Date().toISOString(),
      contactPhone: payload.recipientId, // storing ID here for prototype
      channel: 'instagram'
    };

    messagesStore.push(newMessage);
    return { success: true, messageId: `ig_mid_${Date.now()}`, message: newMessage };
  }
};
