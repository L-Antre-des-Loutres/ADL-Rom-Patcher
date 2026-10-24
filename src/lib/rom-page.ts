import { createOapiClient, OapiError } from './oapi';
import type { DiscordProfile, RomDevice, RomLinkCode } from './oapi';

export function initRomPage(root: HTMLElement) {
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const guest = get('[data-guest]');
  const account = get('[data-account]');
  const workspace = get('[data-workspace]');
  const errorBox = get('[data-error]');
  const loading = get('[data-session-loading]');
  const feedback = get('[data-feedback]');
  const label = get<HTMLInputElement>('#device-label');
  const copy = get<HTMLButtonElement>('[data-copy]');
  const dialog = get<HTMLDialogElement>('[data-confirm-dialog]');
  let session: DiscordProfile | null = null;
  let pending: RomLinkCode | null = null;
  let devices: RomDevice[] = [];
  let busy = false;
  let operation = 0;
  let expiryTimer: ReturnType<typeof setInterval> | undefined;
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
    get<HTMLAnchorElement>(`[data-${action}]`).href = client.authUrl(action, window.location.origin, '/connexion/');
  }

  function syncControls() {
    const waiting = Date.now() < client.retryAt;
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('[data-api-control]').forEach((control) => {
      control.disabled = busy || waiting || (workspace.contains(control) && !session);
    });
    get('[data-generate]').textContent = pending ? 'Générer un nouveau code' : 'Générer un code';
    copy.disabled = !pending;
    workspace.setAttribute('aria-busy', String(busy));
  }

  function clearCode() {
    pending = null;
    if (expiryTimer) clearInterval(expiryTimer);
    get('[data-code-value]').textContent = '';
    get('[data-code-value]').removeAttribute('aria-label');
    get('[data-expires]').textContent = '';
    get('[data-expires]').removeAttribute('datetime');
    get('[data-countdown]').textContent = '';
    get('[data-code-panel]').hidden = true;
    get('[data-code-placeholder]').hidden = false;
    copy.disabled = true;
    get('[data-generate]').textContent = 'Générer un code';
  }

  function signedOut() {
    clearCode();
    session = null;
    devices = [];
    account.hidden = true;
    workspace.hidden = true;
    guest.hidden = false;
    label.value = '';
    get('[data-account-name]').textContent = '';
    get('[data-account-initial]').textContent = '';
    get('[data-devices]').replaceChildren();
    get('[data-device-count]').textContent = '—';
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

  function showCode(code: RomLinkCode) {
    pending = code;
    const expiry = new Date(code.expires_at.replace(' ', 'T'));
    get('[data-code-value]').textContent = code.code;
    get('[data-code-value]').setAttribute('aria-label', `Code de liaison : ${code.code.split('').join(' ')}`);
    get('[data-expires]').textContent = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' }).format(expiry);
    get('[data-expires]').setAttribute('datetime', expiry.toISOString());
    get('[data-code-placeholder]').hidden = true;
    get('[data-code-panel]').hidden = false;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 1000));
      if (!seconds) {
        clearCode();
        feedback.textContent = 'Ce code a expiré. Générez un nouveau code lorsque votre jeu est prêt.';
        return;
      }
      get('[data-countdown]').textContent = `Temps restant : ${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
    };
    expiryTimer = setInterval(tick, 1000);
    tick();
  }

  function renderDevices() {
    const fragment = document.createDocumentFragment();
    const template = get<HTMLTemplateElement>('[data-device-template]');
    for (const device of devices) {
      const row = template.content.cloneNode(true) as DocumentFragment;
      const name = device.label || 'Appareil sans nom';
      row.querySelector('[data-device-name]')!.textContent = name;
      const created = new Date(device.created.replace(' ', 'T'));
      row.querySelector('[data-device-date]')!.textContent = Number.isNaN(created.getTime()) ? 'Date de liaison indisponible'
        : `Lié le ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(created)}`;
      const status = row.querySelector<HTMLElement>('[data-device-status]')!;
      status.textContent = device.is_disabled ? 'Désactivé' : 'Connecté';
      status.dataset.disabled = String(device.is_disabled);
      const button = row.querySelector<HTMLButtonElement>('[data-revoke]')!;
      button.setAttribute('aria-label', `Révoquer : ${name}`);
      button.addEventListener('click', () => confirmRevocation(device));
      fragment.append(row);
    }
    get('[data-devices]').replaceChildren(fragment);
    get('[data-device-count]').textContent = String(devices.length);
    get('[data-devices-empty]').hidden = devices.length > 0;
    syncControls();
  }

  async function refreshDevices(isCurrent: () => boolean) {
    get('[data-devices-loading]').hidden = false;
    try {
      const result = await client.getRomDevices();
      if (!isCurrent()) return;
      devices = result;
      const linked = pending && devices.find((device) => device.id === pending!.device_id);
      if (linked) {
        clearCode();
        feedback.textContent = linked.is_disabled ? 'Votre appareil a été lié, mais il est désactivé.' : 'Votre jeu est maintenant lié à votre compte Discord !';
      }
      renderDevices();
    } finally { if (isCurrent()) get('[data-devices-loading]').hidden = true; }
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
    loading.hidden = true;
    await refreshDevices(isCurrent);
  }

  function confirmRevocation(device: RomDevice) {
    const name = device.label || 'Appareil sans nom';
    get('#revoke-description').textContent = `L’appareil « ${name} » perdra immédiatement l’accès à votre compte. Vous pourrez le relier avec un nouveau code.`;
    dialog.returnValue = 'cancel';
    dialog.addEventListener('close', () => {
      if (dialog.returnValue !== 'confirm') return;
      let revoked = false;
      void perform(async (isCurrent) => {
        await client.revokeRomDevice(device.id);
        if (!isCurrent()) return;
        devices = devices.filter((entry) => entry.id !== device.id);
        renderDevices();
        feedback.textContent = 'L’appareil a été déconnecté de votre compte.';
        revoked = true;
      }).then(() => {
        if (revoked && session) get<HTMLButtonElement>('[data-refresh]').focus();
      });
    }, { once: true });
    dialog.showModal();
  }

  get<HTMLFormElement>('[data-code-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    void perform(async (isCurrent) => {
      clearCode();
      const code = await client.createRomCode(label.value);
      if (isCurrent()) showCode(code);
    });
  });
  get('[data-refresh]').addEventListener('click', () => { void perform(refreshDevices); });
  get('[data-retry]').addEventListener('click', () => { void perform(session ? refreshDevices : connect); });
  copy.addEventListener('click', async () => {
    const code = pending;
    if (!code || Date.parse(code.expires_at.replace(' ', 'T')) <= Date.now()) return;
    try {
      await navigator.clipboard.writeText(code.code);
      if (pending === code) feedback.textContent = 'Code copié. Vous pouvez le saisir dans votre jeu.';
    } catch { feedback.textContent = 'La copie est indisponible. Recopiez les six chiffres affichés dans votre jeu.'; }
  });
  window.addEventListener('pagehide', () => {
    operation++;
    busy = false;
    clearCode();
    if (cooldownTimer) clearInterval(cooldownTimer);
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      signedOut();
      void perform(connect);
    }
  });
  void perform(connect);
}
