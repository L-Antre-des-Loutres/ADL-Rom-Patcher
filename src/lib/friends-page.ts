import { createOapiClient, OapiError } from './oapi';
import type { DiscordProfile, FriendAction, FriendList, FriendProfile, Friendship } from './oapi';

export function initFriendsPage(root: HTMLElement) {
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const guest = get('[data-guest]');
  const account = get('[data-account]');
  const workspace = get('[data-workspace]');
  const errorBox = get('[data-error]');
  const feedback = get('[data-feedback]');
  const loading = get('[data-session-loading]');
  const listLoading = get('[data-list-loading]');
  const lists = get('[data-lists]');
  const form = get<HTMLFormElement>('[data-add-form]');
  const memberInput = get<HTMLInputElement>('#friend-id');
  const search = get<HTMLInputElement>('[data-search]');
  const template = get<HTMLTemplateElement>('[data-friend-template]');
  const dialog = get<HTMLDialogElement>('[data-confirm-dialog]');
  let session: DiscordProfile | null = null;
  let data: FriendList | null = null;
  let busy = false;
  let cooldownTimer: ReturnType<typeof setInterval> | undefined;
  let client: ReturnType<typeof createOapiClient>;

  try {
    client = createOapiClient(root.dataset.apiUrl!);
  } catch {
    loading.hidden = true;
    errorBox.hidden = false;
    get('[data-error-message]').textContent = 'La connexion Discord n’est pas configurée. Renseignez l’URL OAPI du site.';
    get('[data-retry]').hidden = true;
    return;
  }
  get<HTMLAnchorElement>('[data-login]').href = client.authUrl('login', window.location.origin, '/amis');
  get<HTMLAnchorElement>('[data-logout]').href = client.authUrl('logout', window.location.origin, '/amis');

  function syncControls() {
    const waiting = Date.now() < client.retryAt;
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('[data-api-control]').forEach((control) => {
      control.disabled = busy || waiting || (workspace.contains(control) && !session);
    });
    workspace.setAttribute('aria-busy', String(busy));
  }

  function showCooldown() {
    if (cooldownTimer) clearInterval(cooldownTimer);
    const label = get('[data-cooldown]');
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((client.retryAt - Date.now()) / 1000));
      label.hidden = remaining === 0;
      label.textContent = remaining ? `Nouvel essai possible dans ${remaining} s.` : '';
      syncControls();
      if (!remaining && cooldownTimer) clearInterval(cooldownTimer);
    };
    tick();
    if (Date.now() < client.retryAt) cooldownTimer = setInterval(tick, 1000);
  }

  function setAvatar(container: HTMLElement, profile: Pick<FriendProfile, 'username' | 'avatar_url'>, accountAvatar = false) {
    const initial = container.querySelector<HTMLElement>(accountAvatar ? '[data-account-initial]' : '[data-initial]')!;
    const image = container.querySelector<HTMLImageElement>('img')!;
    initial.textContent = profile.username?.trim().charAt(0).toLocaleUpperCase('fr') || '?';
    image.hidden = true;
    image.removeAttribute('src');
    if (typeof profile.avatar_url !== 'string') return;
    try {
      const url = new URL(profile.avatar_url);
      if (url.protocol !== 'https:') return;
      image.onload = () => { image.hidden = false; };
      image.onerror = () => { image.hidden = true; };
      image.src = url.href;
    } catch { /* Keep the initial when the avatar URL is missing or invalid. */ }
  }

  function signedOut() {
    session = null;
    data = null;
    account.hidden = true;
    workspace.hidden = true;
    lists.hidden = true;
    guest.hidden = false;
    memberInput.value = '';
    search.value = '';
    get('[data-account-name]').textContent = '';
    const avatar = get<HTMLImageElement>('[data-account-avatar]');
    avatar.removeAttribute('src');
    avatar.hidden = true;
    root.querySelectorAll('[data-list]').forEach((list) => list.replaceChildren());
  }

  function reportError(error: unknown, prefix = '') {
    if (error instanceof OapiError && error.status === 401) signedOut();
    errorBox.hidden = false;
    get('[data-error-message]').textContent = prefix + (error instanceof Error ? error.message : 'Une erreur est survenue. Réessayez plus tard.');
    if (error instanceof OapiError && error.status === 429) showCooldown();
  }

  async function perform(work: () => Promise<void>) {
    if (busy || Date.now() < client.retryAt) return;
    busy = true;
    errorBox.hidden = true;
    feedback.textContent = '';
    syncControls();
    try {
      await work();
    } catch (error) {
      reportError(error);
    } finally {
      busy = false;
      loading.hidden = true;
      syncControls();
    }
  }

  function dateLabel(since: string, kind: keyof FriendList) {
    // PocketBase timestamps use a space instead of ISO's T separator.
    const date = new Date(since.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return '';
    const formatted = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
    return `${kind === 'friends' ? 'Amis depuis le' : kind === 'incoming' ? 'Reçue le' : 'Envoyée le'} ${formatted}`;
  }

  function displayName(profile: FriendProfile) {
    return profile.username || profile.discord_tag || 'Compte indisponible';
  }

  function renderList(kind: keyof FriendList) {
    if (!data) return;
    const list = get<HTMLUListElement>(`[data-list="${kind}"]`);
    const query = search.value.trim().toLocaleLowerCase('fr');
    const entries = data[kind].filter(({ user }) => kind !== 'friends' ||
      `${user.username ?? ''} ${user.discord_tag ?? ''} ${user.id}`.toLocaleLowerCase('fr').includes(query));
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const row = template.content.cloneNode(true) as DocumentFragment;
      const name = displayName(entry.user);
      row.querySelector('[data-name]')!.textContent = name;
      row.querySelector('[data-tag]')!.textContent = entry.user.discord_tag || '';
      row.querySelector('[data-since]')!.textContent = dateLabel(entry.since, kind);
      setAvatar(row.querySelector<HTMLElement>('.friend-avatar')!, entry.user);
      const actions = row.querySelector<HTMLElement>('[data-actions]')!;
      const addAction = (label: string, action: FriendAction, style: string) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `friend-button ${style}`;
        button.textContent = label;
        button.setAttribute('aria-label', `${label} : ${name}`);
        button.dataset.apiControl = '';
        button.addEventListener('click', () => {
          if (kind === 'friends' && action === 'remove') confirmRemoval(entry);
          else void mutate(entry.user.id, action, kind);
        });
        actions.append(button);
      };
      if (kind === 'incoming') addAction('Accepter', 'accept', '');
      addAction(kind === 'friends' ? 'Retirer' : kind === 'incoming' ? 'Refuser' : 'Annuler', 'remove', kind === 'friends' ? 'danger' : 'secondary');
      fragment.append(row);
    }
    list.replaceChildren(fragment);
    const empty = get(`[data-empty="${kind}"]`);
    empty.hidden = entries.length > 0;
    if (kind === 'friends') empty.textContent = data.friends.length && query
      ? 'Aucun ami ne correspond à votre recherche.'
      : 'Votre équipe commence ici. Envoyez votre première demande !';
    get(`[data-count="${kind}"]`).textContent = String(data[kind].length);
    syncControls();
  }

  async function refreshFriends() {
    listLoading.hidden = false;
    try {
      data = await client.getFriends();
      for (const kind of ['friends', 'incoming', 'outgoing'] as const) renderList(kind);
      lists.hidden = false;
    } finally {
      listLoading.hidden = true;
    }
  }

  async function connect() {
    loading.hidden = false;
    session = await client.getSession();
    if (!session) { signedOut(); return; }
    guest.hidden = true;
    account.hidden = false;
    workspace.hidden = false;
    get('[data-account-name]').textContent = session.username;
    setAvatar(get('.friends-identity .friend-avatar'), session, true);
    loading.hidden = true;
    await refreshFriends();
  }

  async function mutate(id: string, action: FriendAction | 'request', kind?: keyof FriendList) {
    await perform(async () => {
      const result = action === 'request' ? await client.requestByTag(id) : await client.mutate(id, action);
      if (action === 'request') memberInput.value = '';
      feedback.textContent = action === 'request'
        ? result?.status === 'accepted' ? 'Demande réciproque acceptée : vous êtes maintenant amis !' : 'Votre demande d’ami a été envoyée.'
        : action === 'accept' ? 'Demande acceptée : votre équipe s’agrandit !'
        : kind === 'incoming' ? 'La demande a été refusée.'
        : kind === 'outgoing' ? 'Votre demande a été annulée.' : 'Cet ami a été retiré de votre liste.';
      // Keep successful actions distinct from a subsequent refresh failure.
      try {
        await refreshFriends();
      } catch (error) {
        lists.hidden = true;
        reportError(error, 'L’action a réussi, mais la liste n’a pas pu être actualisée. ');
      }
    });
  }

  function confirmRemoval(entry: Friendship) {
    get('#remove-description').textContent = `Voulez-vous retirer ${displayName(entry.user)} de vos amis ? Vous pourrez lui envoyer une nouvelle demande plus tard.`;
    const onClose = () => {
      if (dialog.returnValue === 'confirm') void mutate(entry.user.id, 'remove', 'friends');
    };
    dialog.returnValue = 'cancel';
    dialog.addEventListener('close', onClose, { once: true });
    dialog.showModal();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const tag = memberInput.value.trim();
    memberInput.value = tag;
    if (form.reportValidity()) void mutate(tag, 'request');
  });
  search.addEventListener('input', () => renderList('friends'));
  get('[data-refresh]').addEventListener('click', () => { void perform(refreshFriends); });
  get('[data-retry]').addEventListener('click', () => { void perform(session ? refreshFriends : connect); });
  void perform(connect);
}
