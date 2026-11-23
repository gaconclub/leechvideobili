import { getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId || '';
export const FIREBASE_AUTH_SETTINGS_URL = FIREBASE_PROJECT_ID
  ? `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/settings`
  : 'https://console.firebase.google.com/';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of WORKSPACE_SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({
  prompt: 'select_account',
});

let isSigningIn = false;
// In-memory only access token cache (never stored in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

export interface GoogleAuthErrorInfo {
  code: 'unauthorized-domain' | 'popup-blocked' | 'popup-closed' | 'unknown';
  message: string;
  currentHostname: string;
  firebaseProjectId: string;
  firebaseAuthSettingsUrl: string;
}

export function classifyGoogleAuthError(err: any): GoogleAuthErrorInfo {
  const rawCode = String(err?.code || '');
  const rawMsg = String(err?.message || '');
  const currentHostname =
    typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : 'localhost';

  if (
    rawCode === 'auth/unauthorized-domain' ||
    rawMsg.includes('auth/unauthorized-domain')
  ) {
    return {
      code: 'unauthorized-domain',
      message: `Tên miền hiện tại (${currentHostname}) chưa nằm trong danh sách Authorized domains của Firebase project "${FIREBASE_PROJECT_ID}".`,
      currentHostname,
      firebaseProjectId: FIREBASE_PROJECT_ID,
      firebaseAuthSettingsUrl: FIREBASE_AUTH_SETTINGS_URL,
    };
  }

  if (rawCode === 'auth/popup-blocked' || rawMsg.includes('auth/popup-blocked')) {
    return {
      code: 'popup-blocked',
      message:
        'Trình duyệt đang chặn cửa sổ đăng nhập Google (Pop-up). Hãy cho phép Pop-up cho trang này rồi bấm đăng nhập lại.',
      currentHostname,
      firebaseProjectId: FIREBASE_PROJECT_ID,
      firebaseAuthSettingsUrl: FIREBASE_AUTH_SETTINGS_URL,
    };
  }

  if (
    rawCode === 'auth/popup-closed-by-user' ||
    rawCode === 'auth/cancelled-popup-request' ||
    rawMsg.includes('auth/popup-closed-by-user')
  ) {
    return {
      code: 'popup-closed',
      message: 'Bạn đã đóng cửa sổ đăng nhập Google trước khi hoàn tất.',
      currentHostname,
      firebaseProjectId: FIREBASE_PROJECT_ID,
      firebaseAuthSettingsUrl: FIREBASE_AUTH_SETTINGS_URL,
    };
  }

  return {
    code: 'unknown',
    message: rawMsg || 'Đăng nhập Google chưa thành công. Vui lòng thử lại.',
    currentHostname,
    firebaseProjectId: FIREBASE_PROJECT_ID,
    firebaseAuthSettingsUrl: FIREBASE_AUTH_SETTINGS_URL,
  };
}

export function initGoogleWorkspaceAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
}

export async function signInGoogleWorkspace(): Promise<{
  user: User;
  accessToken: string;
} | null> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Không lấy được mã truy cập Google Sheets & Drive.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getGoogleWorkspaceAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearGoogleWorkspaceAccessToken(): void {
  cachedAccessToken = null;
}

export async function logoutGoogleWorkspace(): Promise<void> {
  cachedAccessToken = null;
  await auth.signOut();
}
