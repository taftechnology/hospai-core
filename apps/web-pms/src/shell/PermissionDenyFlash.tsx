const KEY = 'hospai.permission-deny';

export function setPermissionDenyFlash(): void {
  sessionStorage.setItem(KEY, '1');
}

export function consumePermissionDenyFlash(): boolean {
  if (sessionStorage.getItem(KEY) !== '1') return false;
  sessionStorage.removeItem(KEY);
  return true;
}
