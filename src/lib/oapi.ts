export interface DiscordProfile {
  username: string;
  discord_id: string;
  discord_tag?: string | null;
  avatar_url?: string | null;
}

export interface FriendProfile {
  id: string;
  username?: string | null;
  discord_id?: string | null;
  discord_tag?: string | null;
  avatar_url?: string | null;
}

export interface Friendship {
  friendship_id: string;
  user: FriendProfile;
  status: 'pending' | 'accepted';
  since: string;
}

export interface FriendList {
  friends: Friendship[];
  incoming: Friendship[];
  outgoing: Friendship[];
}

export type FriendAction = 'accept' | 'remove';

export interface RomLinkCode {
  code: string;
  expires_at: string;
  device_id: string;
}

export interface RomDevice {
  id: string;
  label: string;
  created: string;
  updated: string;
  is_disabled: boolean;
}

export interface LinkedSave {
  file: Blob;
  outcome: 'created' | 'reused';
}

/** Raw Mario Kart DS (EUR) save: exact size and `MKDSSV10` header. */
export const MKDS_SAVE_SIZE = 0x40000;
const MKDS_SAVE_MAGIC = 'MKDSSV10';

export async function isRawMkdsSave(file: Blob): Promise<boolean> {
  if (file.size !== MKDS_SAVE_SIZE) return false;
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return String.fromCharCode(...header) === MKDS_SAVE_MAGIC;
}

const memberId = /^[a-zA-Z0-9]{1,64}$/;
const messages: Record<number, string> = {
  400: 'Vérifiez l’identifiant OAPI du membre. Vous ne pouvez pas vous ajouter vous-même.',
  401: 'Votre session a expiré. Reconnectez-vous avec Discord.',
  403: 'OAPI refuse cet accès. Vérifiez que ce site est autorisé dans sa configuration.',
  404: 'Compte ou demande introuvable. Vérifiez l’identifiant ou actualisez la liste.',
  409: 'Vous êtes déjà amis ou une demande a déjà été envoyée.',
  429: 'Trop de requêtes. Patientez avant de réessayer.',
  502: 'La gestion des amis est temporairement indisponible. Réessayez plus tard.',
};

export class OapiError extends Error {
  status: number;
  retryAfter: number;

  constructor(status: number, message = messages[status] ?? 'OAPI est indisponible. Réessayez plus tard.', retryAfter = 0) {
    super(message);
    this.name = 'OapiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function hasValidProfileFields(profile: object) {
  return ['username', 'discord_id', 'discord_tag', 'avatar_url'].every((key) => {
    const value = (profile as Record<string, unknown>)[key];
    return value == null || typeof value === 'string';
  });
}

function isFriendship(value: unknown): value is Friendship {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Friendship;
  return typeof entry.friendship_id === 'string'
    && !!entry.user && typeof entry.user.id === 'string' && memberId.test(entry.user.id)
    && hasValidProfileFields(entry.user)
    && (entry.status === 'pending' || entry.status === 'accepted')
    && typeof entry.since === 'string';
}

export function createOapiClient(baseUrl: string, fetcher: typeof fetch = fetch) {
  const base = new URL(baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(local && base.protocol === 'http:'))
    || base.username || base.password || base.search || base.hash) {
    throw new Error('L’URL OAPI doit être une URL HTTPS (HTTP autorisé en local), sans identifiants ni paramètres.');
  }
  const prefix = base.href.replace(/\/+$/, '');
  let retryAt = 0;

  async function send(path: string, init: RequestInit, timeout = 15_000): Promise<Response> {
    if (Date.now() < retryAt) {
      throw new OapiError(429, undefined, Math.ceil((retryAt - Date.now()) / 1000));
    }
    let response: Response;
    try {
      response = await fetcher(`${prefix}${path}`, {
        ...init,
        credentials: 'include',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new OapiError(0, 'Impossible de joindre OAPI. Vérifiez votre connexion, puis réessayez.');
    }
    if (response.status === 429) {
      // Cross-origin responses may not expose Retry-After: wait a full quota window then.
      const header = response.headers.get('Retry-After');
      const seconds = header && /^\d+$/.test(header) ? Number(header)
        : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : NaN;
      const wait = Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
      retryAt = Date.now() + wait * 1000;
      throw new OapiError(429, undefined, wait);
    }
    return response;
  }

  async function call(path: string, method = 'GET'): Promise<unknown> {
    const response = await send(path, { method });
    if (!response.ok) throw new OapiError(response.status);
    if (response.status === 204) return undefined;
    try {
      return await response.json();
    } catch {
      throw new OapiError(0, 'La réponse d’OAPI est illisible. Réessayez plus tard.');
    }
  }

  async function romCall(path: string, method = 'GET'): Promise<unknown> {
    try {
      return await call(path, method);
    } catch (error) {
      if (error instanceof OapiError) {
        const romMessages: Record<number, string> = {
          400: 'Les informations de liaison sont invalides. Vérifiez le nom de l’appareil.',
          404: 'Le compte ou l’appareil n’a pas été trouvé. Actualisez la liste avant de réessayer.',
          502: 'La liaison des jeux est temporairement indisponible. Réessayez plus tard.',
        };
        if (romMessages[error.status]) throw new OapiError(error.status, romMessages[error.status]);
      }
      throw error;
    }
  }

  return {
    get retryAt() { return retryAt; },
    authUrl(action: 'login' | 'logout', origin: string, returnTo: string) {
      const url = new URL(`${prefix}/auth/site/${action}`);
      url.searchParams.set('origin', new URL(origin).origin);
      url.searchParams.set('return_to', returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/amis');
      return url.href;
    },
    async getSession(): Promise<DiscordProfile | null> {
      const data = await call('/auth/site/me') as Record<string, unknown> | null;
      if (data?.authenticated === false) return null;
      if (data?.authenticated !== true || typeof data.username !== 'string' || typeof data.discord_id !== 'string' || !hasValidProfileFields(data)) {
        throw new OapiError(0, 'La réponse de connexion d’OAPI est illisible.');
      }
      return data as unknown as DiscordProfile;
    },
    async getFriends(): Promise<FriendList> {
      const data = await call('/friends/me') as FriendList | null;
      if (!data || !['friends', 'incoming', 'outgoing'].every((key) => {
        const entries = data[key as keyof FriendList];
        return Array.isArray(entries) && entries.every(isFriendship);
      })) {
        throw new OapiError(0, 'La réponse de la liste d’amis est illisible. Réessayez plus tard.');
      }
      return data;
    },
    async createRomCode(label = ''): Promise<RomLinkCode> {
      const query = label.trim() ? `?label=${encodeURIComponent(label.trim())}` : '';
      const data = await romCall(`/auth/rom/code${query}`, 'POST') as RomLinkCode | null;
      if (!data || typeof data.code !== 'string' || !/^[1-9]{6}$/.test(data.code)
        || typeof data.expires_at !== 'string' || !Number.isFinite(Date.parse(data.expires_at.replace(' ', 'T')))
        || typeof data.device_id !== 'string' || !memberId.test(data.device_id)) {
        throw new OapiError(0, 'La réponse du code de liaison est illisible. Réessayez plus tard.');
      }
      return data;
    },
    async getRomDevices(): Promise<RomDevice[]> {
      const data = await romCall('/auth/rom/devices') as { devices: RomDevice[] } | null;
      if (!data || !Array.isArray(data.devices) || !data.devices.every((device) => device
        && typeof device.id === 'string' && memberId.test(device.id)
        && typeof device.label === 'string' && typeof device.created === 'string'
        && typeof device.updated === 'string' && typeof device.is_disabled === 'boolean')) {
        throw new OapiError(0, 'La réponse de la liste des appareils est illisible. Réessayez plus tard.');
      }
      return data.devices;
    },
    /** Sends the save in a single `save` field; the account comes from the session only. */
    async linkMkdsSave(save: Blob): Promise<LinkedSave> {
      const invalid = 'Ce fichier n’est pas une sauvegarde brute de Mario Kart DS (.sav de 262 144 octets). Les états de sauvegarde et fichiers .dsv ne sont pas acceptés.';
      if (!await isRawMkdsSave(save)) throw new OapiError(400, invalid);
      const body = new FormData();
      body.append('save', save, 'mario-kart-ds.sav');
      const response = await send('/saves/mkds/link', { method: 'POST', body }, 60_000);
      if (!response.ok) {
        const saveMessages: Record<number, string> = {
          400: invalid,
          403: 'Cette sauvegarde est liée à un autre compte, ou ce site n’est pas autorisé par OAPI.',
          409: 'Les identifiants présents dans cette sauvegarde ne peuvent pas être réutilisés.',
          422: 'La zone de liaison de cette sauvegarde est illisible ou endommagée.',
          502: 'La liaison est temporairement indisponible. Réessayez plus tard avec le même fichier.',
          503: 'La liaison de sauvegarde n’est pas encore activée sur le serveur.',
        };
        // OAPI explains save-specific refusals in a short plain-text body.
        let detail = '';
        if ((response.headers.get('Content-Type') ?? '').startsWith('text/plain')) {
          detail = (await response.text().catch(() => '')).trim();
        }
        const fallback = saveMessages[response.status] ?? messages[response.status];
        throw new OapiError(response.status, detail && detail.length <= 300 && response.status !== 502 ? detail : fallback);
      }
      const file = await response.blob();
      if (!await isRawMkdsSave(file)) {
        throw new OapiError(0, 'La sauvegarde renvoyée par OAPI est illisible. Réessayez avec le même fichier.');
      }
      const outcome = response.headers.get('X-ADLN-Link') === 'reused' ? 'reused' : 'created';
      return { file: new Blob([file], { type: 'application/octet-stream' }), outcome };
    },
    async revokeRomDevice(id: string): Promise<void> {
      if (!memberId.test(id)) throw new OapiError(400, 'L’identifiant de l’appareil est invalide.');
      await romCall(`/auth/rom/devices/${encodeURIComponent(id)}/revoke`, 'POST');
    },
    async requestByTag(value: string): Promise<{ friendship_id: string; status: 'pending' | 'accepted' }> {
      const tag = value.trim().replace(/^@/, '').toLowerCase();
      const invalidTag = 'Vérifiez le tag Discord : 2 à 32 lettres, chiffres, points ou underscores, sans espaces ni points consécutifs.';
      if (!/^[a-z0-9._]{2,32}$/.test(tag) || tag.includes('..')) throw new OapiError(400, invalidTag);
      try {
        return await call(`/friends/me/${encodeURIComponent(tag)}/request`, 'POST') as { friendship_id: string; status: 'pending' | 'accepted' };
      } catch (error) {
        if (error instanceof OapiError && error.status === 400) {
          throw new OapiError(400, 'Vérifiez le tag Discord. Vous ne pouvez pas vous ajouter vous-même.');
        }
        if (error instanceof OapiError && error.status === 404) {
          throw new OapiError(404, 'Aucun membre OAPI ne correspond à ce tag Discord. Vérifiez son nom d’utilisateur exact.');
        }
        throw error;
      }
    },
    async mutate(id: string, action: FriendAction): Promise<{ friendship_id: string; status: 'pending' | 'accepted' } | undefined> {
      if (action !== 'accept' && action !== 'remove') throw new OapiError(400, 'Envoyez les demandes exclusivement par tag Discord.');
      if (!memberId.test(id)) throw new OapiError(400);
      return await call(`/friends/me/${encodeURIComponent(id)}/${action}`, 'POST') as { friendship_id: string; status: 'pending' | 'accepted' } | undefined;
    },
  };
}
