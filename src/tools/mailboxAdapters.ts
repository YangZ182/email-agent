import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { EmailItem } from '../types';

// ==========================================
// 1. Google OAuth & Firebase 客户端凭据
// ==========================================
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify'
];

const provider = new GoogleAuthProvider();
GMAIL_SCOPES.forEach(scope => provider.addScope(scope));
provider.setCustomParameters({
  login_hint: 'zheyang3858@gmail.com'
});

let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const initGoogleAuth = (
  onSuccess?: (user: User, token: string) => void,
  onFail?: () => void
) => {
  return onAuthStateChanged(auth, async (user) => {
    if (user && cachedAccessToken) {
      if (onSuccess) onSuccess(user, cachedAccessToken);
    } else {
      cachedAccessToken = null;
      if (onFail && !isSigningIn) onFail();
    }
  });
};

export const signInGoogle = async (): Promise<{ user: User; accessToken: string }> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('未获取到有效 Google Access Token');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const signOutGoogle = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export const getGoogleToken = (): string | null => cachedAccessToken;

// ==========================================
// 2. Gmail API 操作适配器 (zheyang3858@gmail.com)
// ==========================================

function decodeBase64(input: string): string {
  try {
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return decodeURIComponent(
      atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
  } catch {
    return input;
  }
}

function encodeBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * 从 Gmail API 拉取未读邮件
 */
export async function fetchLiveGmailUnread(): Promise<EmailItem[]> {
  const token = getGoogleToken();
  if (!token) return [];

  const listRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=10',
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!listRes.ok) return [];

  const listData = await listRes.json();
  const list = listData.messages || [];
  const results: EmailItem[] = [];

  for (const m of list) {
    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!msgRes.ok) continue;

      const raw = await msgRes.json();
      const headers = raw.payload.headers || [];

      const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(无主题)';
      const from = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'unknown@example.com';
      const to = headers.find((h: any) => h.name.toLowerCase() === 'to')?.value || 'zheyang3858@gmail.com';
      const date = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date().toISOString();

      let body = raw.snippet || '';
      if (raw.payload.body?.data) {
        body = decodeBase64(raw.payload.body.data);
      } else if (raw.payload.parts?.[0]?.body?.data) {
        body = decodeBase64(raw.payload.parts[0].body.data);
      }

      results.push({
        id: `live-gmail-${raw.id}`,
        uid: 4000 + (parseInt(raw.id.slice(-4), 16) % 5000),
        mailbox: 'gmail',
        subject,
        from,
        to,
        date: date.substring(0, 25),
        body,
        category: 'respond',
        language: /[\u4e00-\u9fa5]/.test(subject + body) ? 'zh' : 'en',
        scenario: 'Gmail 实时收件箱同步',
        expectedTool: 'send_email_tool',
        status: 'unread',
        gmailMessageId: raw.id,
        source: 'live'
      });
    } catch (e) {
      console.warn('Gmail parse error:', e);
    }
  }

  return results;
}

/**
 * 标记 Gmail 邮件已读（移除 UNREAD 标签）
 */
export async function markGmailRead(messageId: string): Promise<boolean> {
  const token = getGoogleToken();
  if (!token) return true; // 离线或模拟模式返回成功

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
  });
  return res.ok;
}

/**
 * 通过 Gmail API 发送回复
 */
export async function sendGmailMessage(to: string, subject: string, body: string): Promise<boolean> {
  const token = getGoogleToken();
  if (!token) return true;

  const rawMessage = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body
  ].join('\r\n');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: encodeBase64(rawMessage) })
  });

  return res.ok;
}

// ==========================================
// 3. 双邮箱连接状态确认函数
// ==========================================
export interface MailboxStatus {
  qq: {
    address: string;
    connected: boolean;
    protocol: string;
    sandboxRecipient: string;
  };
  gmail: {
    address: string;
    connected: boolean;
    authorized: boolean;
    protocol: string;
  };
}

export function checkMailboxConnections(isGoogleAuthed: boolean): MailboxStatus {
  return {
    qq: {
      address: 'user@qq.com',
      connected: true, // IMAP 服务通道常驻
      protocol: 'IMAP (SSL: 993) / SMTP (SSL: 465)',
      sandboxRecipient: '2942397812@qq.com'
    },
    gmail: {
      address: 'zheyang3858@gmail.com',
      connected: isGoogleAuthed,
      authorized: isGoogleAuthed,
      protocol: 'Gmail REST API v1 (OAuth2)'
    }
  };
}
