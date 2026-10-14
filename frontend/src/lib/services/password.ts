// Settings → Password (backend `accounts/password.py`): set a first password on an account that
// signs in only through Google / Apple / GitHub / Facebook, or change the one you have.

import { apiClient } from '$lib/api/client';

export async function getHasPassword(): Promise<boolean> {
	const res = await apiClient.get<{ has_password: boolean }>('/auth/me/password/');
	return res.has_password;
}

/** Throws `ApiError` whose body names the field: `current_password` ('current_password_required'
 *  | 'current_password_wrong') or `new_password` ('new_password_required' or Django's validator
 *  sentences). `currentPassword` is ignored by the server when the account has none. */
export async function setPassword(newPassword: string, currentPassword?: string): Promise<void> {
	await apiClient.post('/auth/me/password/', {
		new_password: newPassword,
		current_password: currentPassword ?? ''
	});
}

/** Fired on `window` after a successful set/change, so Settings → Sign-in methods (which shows
 *  whether a password exists, and refuses to unlink the last provider without one) re-reads. */
export const PASSWORD_CHANGED_EVENT = 'edmat:password-changed';
