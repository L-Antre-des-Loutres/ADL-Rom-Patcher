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

export type FriendAction = 'request' | 'accept' | 'remove';

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

  async function call(path: string, method = 'GET'): Promise<unknown> {
    if (Date.now() < retryAt) {
      throw new OapiError(429, undefined, Math.ceil((retryAt - Date.now()) / 1000));
    }
    let response: Response;
    try {
      response = await fetcher(`${prefix}${path}`, {
        method,
        credentials: 'include',
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new OapiError(0, 'Impossible de joindre OAPI. Vérifiez votre connexion, puis réessayez.');
    }
    if (!response.ok) {
      if (response.status === 429) {
        // Cross-origin responses may not expose Retry-After: wait a full quota window then.
        const header = response.headers.get('Retry-After');
        const seconds = header && /^\d+$/.test(header) ? Number(header)
          : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : NaN;
        const wait = Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
        retryAt = Date.now() + wait * 1000;
        throw new OapiError(429, undefined, wait);
      }
      throw new OapiError(response.status);
    }
    if (response.status === 204) return undefined;
    try {
      return await response.json();
    } catch {
      throw new OapiError(0, 'La réponse d’OAPI est illisible. Réessayez plus tard.');
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
    async mutate(id: string, action: FriendAction): Promise<{ friendship_id: string; status: 'pending' | 'accepted' } | undefined> {
      if (!memberId.test(id)) throw new OapiError(400);
      return await call(`/friends/me/${encodeURIComponent(id)}/${action}`, 'POST') as { friendship_id: string; status: 'pending' | 'accepted' } | undefined;
    },
  };
}
