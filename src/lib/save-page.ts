import { createOapiClient, OapiError } from './oapi';
import type { DiscordProfile } from './oapi';
import { linkedFileName } from './save-file';

export function initSavePage(root: HTMLElement) {
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const guest = get('[data-guest]');
  const account = get('[data-account]');
  const workspace = get('[data-workspace]');
  const errorBox = get('[data-error]');
  const loading = get('[data-session-loading]');
  const feedback = get('[data-feedback]');
  const input = get<HTMLInputElement>('#save-file');
  const result = get('[data-result]');
  const download = get<HTMLAnchorElement>('[data-download]');
  let session: DiscordProfile | null = null;
  let busy = false;
  let operation = 0;
  let downloadUrl = '';
  let cooldownTimer: ReturnType<typeof setInterval> | undefined;
  let client: ReturnType<typeof createOapiClient>;

  try { client = createOapiClient(root.dataset.apiUrl!); }
  catch {
    loading.hidden = true;
    errorBox.hidden = false;
    get('[data-error-message]').textContent = 'La connexion Discord n’est pas configurée. Renseignez l’URL OAPI du site.';
    get('[data-retry]').hidden = true;
    return;
  }
  for (const action of ['login', 'logout'] as const) {
    get<HTMLAnchorElement>(`[data-${action}]`).href = client.authUrl(action, window.location.origin, '/sauvegarde/');
  }

  function syncControls() {
    const waiting = Date.now() < client.retryAt;
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('[data-api-control]').forEach((control) => {
      control.disabled = busy || waiting || (workspace.contains(control) && !session);
    });
    get<HTMLButtonElement>('[data-link]').disabled ||= !input.files?.length;
    workspace.setAttribute('aria-busy', String(busy));
  }

  /** The linked copy only lives in memory, behind a revocable object URL. */
  function clearResult() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = '';
    download.removeAttribute('href');
    download.removeAttribute('download');
    result.hidden = true;
  }

  function signedOut() {
    clearResult();
    session = null;
    account.hidden = true;
    workspace.hidden = true;
    guest.hidden = false;
    input.value = '';
    get('[data-account-name]').textContent = '';
    get('[data-account-initial]').textContent = '';
  }

  function cooldown() {
    if (cooldownTimer) clearInterval(cooldownTimer);
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((client.retryAt - Date.now()) / 1000));
      get('[data-cooldown]').hidden = seconds === 0;
      get('[data-cooldown]').textContent = seconds ? `Nouvel essai possible dans ${seconds} s.` : '';
      syncControls();
      if (!seconds && cooldownTimer) clearInterval(cooldownTimer);
    };
    tick();
    if (Date.now() < client.retryAt) cooldownTimer = setInterval(tick, 1000);
  }

  function reportError(error: unknown) {
    if (error instanceof OapiError && error.status === 401) signedOut();
    get('[data-error-message]').textContent = error instanceof Error ? error.message : 'Une erreur est survenue. Réessayez plus tard.';
    errorBox.hidden = false;
    if (error instanceof OapiError && error.status === 429) cooldown();
  }

  async function perform(work: (isCurrent: () => boolean) => Promise<void>) {
    if (busy) return;
    if (Date.now() < client.retryAt) {
      reportError(new OapiError(429));
      loading.hidden = true;
      return;
    }
    const version = ++operation;
    const isCurrent = () => version === operation;
    busy = true;
    errorBox.hidden = true;
    feedback.textContent = '';
    syncControls();
    try { await work(isCurrent); }
    catch (error) {
      if (isCurrent()) reportError(error);
    } finally {
      if (isCurrent()) {
        busy = false;
        loading.hidden = true;
        syncControls();
      }
    }
  }

  async function connect(isCurrent: () => boolean) {
    loading.hidden = false;
    const profile = await client.getSession();
    if (!isCurrent()) return;
    session = profile;
    if (!session) { signedOut(); return; }
    guest.hidden = true;
    account.hidden = false;
    workspace.hidden = false;
    get('[data-account-name]').textContent = session.username;
    get('[data-account-initial]').textContent = session.username.trim().charAt(0).toLocaleUpperCase('fr') || '?';
  }

  input.addEventListener('change', () => {
    clearResult();
    errorBox.hidden = true;
    feedback.textContent = '';
    syncControls();
  });

  get<HTMLFormElement>('[data-save-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const file = input.files?.[0];
    if (!file) return;
    void perform(async (isCurrent) => {
      clearResult();
      const linked = await client.linkMkdsSave(file);
      if (!isCurrent()) return;
      downloadUrl = URL.createObjectURL(linked.file);
      download.href = downloadUrl;
      download.download = linkedFileName(file.name);
      get('[data-result-message]').textContent = linked.outcome === 'reused'
        ? 'Cette sauvegarde était déjà liée à votre compte : son identifiant a été vérifié et conservé.'
        : 'Votre sauvegarde est liée à votre compte ADL.';
      result.hidden = false;
      feedback.textContent = 'Sauvegarde liée. Téléchargez la copie liée ci-dessous.';
      download.focus();
    });
  });
  get('[data-retry]').addEventListener('click', () => { void perform(connect); });
  window.addEventListener('pagehide', () => {
    operation++;
    busy = false;
    clearResult();
    if (cooldownTimer) clearInterval(cooldownTimer);
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      signedOut();
      void perform(connect);
    }
  });
  syncControls();
  void perform(connect);
}
