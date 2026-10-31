import Chart from 'chart.js/auto';
import { io } from 'socket.io-client';
import { initializeStaffUI } from './staff.js';
import { renderDataTable } from './components/data-table.js';

const API = '/api/v1';
const elements = {
  signedOut: document.querySelector('#signed-out'),
  noGuilds: document.querySelector('#no-guilds'),
  availableGuildForm: document.querySelector('#available-guild-form'),
  availableGuildSelector: document.querySelector('#available-guild-selector'),
  dashboard: document.querySelector('#dashboard'),
  guildSelector: document.querySelector('#guild-selector'),
  pageTitle: document.querySelector('#page-title'),
  pageEyebrow: document.querySelector('#page-eyebrow'),
  logout: document.querySelector('#logout-button'),
  form: document.querySelector('#filters-form'),
  dateFrom: document.querySelector('#date-from'),
  dateTo: document.querySelector('#date-to'),
  compare: document.querySelector('#compare-toggle'),
  status: document.querySelector('#status-message'),
  content: document.querySelector('#analytics-content'),
  export: document.querySelector('#export-button'),
  channelForm: document.querySelector('#channel-filter-form'),
  channelFilter: document.querySelector('#channel-filter'),
  channelsBody: document.querySelector('#channels-body'),
  previousPage: document.querySelector('#previous-page'),
  nextPage: document.querySelector('#next-page'),
  pageStatus: document.querySelector('#page-status'),
  timezoneLabel: document.querySelector('#timezone-label'),
  timezoneForm: document.querySelector('#timezone-form'),
  timezoneInput: document.querySelector('#timezone-input'),
  coverageNote: document.querySelector('#coverage-note'),
  realtimeStatus: document.querySelector('#realtime-status'),
};

const formatter = new Intl.NumberFormat('fr-FR');
let selectedGuildId = null;
let channelPage = 1;
let channelPages = 0;
let summary = null;
let comparison = null;
let messagesChart = null;
let membersChart = null;
let currentView = 'analytics';
let sessionUser = null;
let realtimeSocket = null;
let memberPage = 1;
let memberPages = 0;
const pageSize = 25;
const staffUI = initializeStaffUI({
  api: (path, options) => api(path, options),
  getGuildId: () => selectedGuildId,
  getUser: () => sessionUser,
});
const viewTitles = {
  dashboard: ['Tableau de bord', 'Vue d’ensemble'],
  analytics: ['Analytics', 'Vue d’ensemble'],
  members: ['Membres', 'Communauté'],
  staff: ['Staff', 'Équipe & responsabilités'],
  tasks: ['Tâches staff', 'Organisation'],
  reports: ['Signalements', 'Communauté'],
  applications: ['Candidatures', 'Recrutement'],
  moderation: ['Modération', 'Application des règles'],
  audit: ['Journal d’audit', 'Traçabilité'],
  notifications: ['Notifications', 'Votre espace'],
  settings: ['Paramètres', 'Configuration du serveur'],
};

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  document
    .querySelector('#members-filter-form')
    .addEventListener('submit', (event) => {
      event.preventDefault();
      memberPage = 1;
      void loadMembers();
    });

  document.querySelector('#members-previous').addEventListener('click', () => {
    memberPage = Math.max(1, memberPage - 1);
    void loadMembers();
  });

  document.querySelector('#members-next').addEventListener('click', () => {
    memberPage = Math.min(memberPages, memberPage + 1);
    void loadMembers();
  });

  document
    .querySelector('#settings-timezone-form')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await api(`/guilds/${escapePath(selectedGuildId)}/analytics/timezone`, {
          method: 'PUT',
          body: JSON.stringify({
            timezone: document.querySelector('#settings-timezone').value.trim(),
          }),
        });
        await loadSettings();
        showModuleStatus('settings', 'Fuseau horaire mis à jour.', 'success');
      } catch (error) {
        reportModuleError('settings', error);
      } finally {
        submit.disabled = false;
      }
    });

  document
    .querySelector('#role-create-form')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      const permissions = Object.fromEntries(
        [...form.querySelectorAll('input[name="permission"]:checked')].map(
          (input) => [input.value, 'ALLOW'],
        ),
      );
      submit.disabled = true;
      try {
        await api(`/guilds/${escapePath(selectedGuildId)}/roles`, {
          method: 'POST',
          body: JSON.stringify({
            name: new FormData(form).get('name').trim(),
            permissions,
          }),
        });
        form.reset();
        await loadSettings();
        showModuleStatus('settings-roles', 'Rôle créé.', 'success');
      } catch (error) {
        reportModuleError('settings-roles', error);
      } finally {
        submit.disabled = false;
      }
    });

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const error = new Error(
      payload?.error?.message ?? `La requête a échoué (${response.status}).`,
    );
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function setActiveView(view) {
  if (!viewTitles[view]) return;
  currentView = view;
  for (const [name, title] of Object.entries(viewTitles)) {
    const section = document.querySelector(`#${name}-view`);
    if (section) section.hidden = name !== view;
    const link = document.querySelector(`[data-view="${name}"]`);
    if (link) {
      link.classList.toggle('active', name === view);
      if (name === view) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    if (name === view) {
      elements.pageTitle.textContent = title[0];
      elements.pageEyebrow.textContent = title[1];
    }
  }
  if (view === 'dashboard') void loadDashboard();
  else if (view === 'members') void loadMembers();
  else if (view === 'settings') void loadSettings();
  else if (view !== 'analytics') void staffUI.load(view);
}

function showModuleStatus(view, message, state = 'info') {
  const element = document.querySelector(`[data-status-for="${view}"]`);
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
  element.hidden = !message;
}

function reportModuleError(view, error) {
  const message =
    error.status === 401
      ? 'Votre session a expiré. Reconnectez-vous avec Discord.'
      : error.status === 403
        ? 'Accès refusé : votre rôle ne permet pas de consulter ces données.'
        : error.message;
  showModuleStatus(view, message, error.status === 403 ? 'denied' : 'error');
}

async function loadDashboard() {
  if (!selectedGuildId) return;
  showModuleStatus('dashboard', 'Chargement du résumé du serveur…', 'loading');
  document.querySelector('#dashboard-guild-name').textContent =
    elements.guildSelector.selectedOptions[0]?.textContent ?? 'votre serveur';
  try {
    const { summary } = await api(
      `/guilds/${escapePath(selectedGuildId)}/dashboard`,
    );
    document.querySelector('#dashboard-messages').textContent =
      formatter.format(summary.totals.messageCount);
    document.querySelector('#dashboard-joins').textContent = formatter.format(
      summary.totals.joins,
    );
    document.querySelector('#dashboard-leaves').textContent = formatter.format(
      summary.totals.leaves,
    );
    document.querySelector('#dashboard-active').textContent = formatter.format(
      summary.active.dau,
    );
    showModuleStatus(
      'dashboard',
      summary.series.length
        ? `Données observées du ${summary.from} au ${summary.to} · Fuseau ${summary.timezone}.`
        : 'Aucune donnée observée pour les sept derniers jours. Vérifiez la connexion et les permissions du bot.',
      summary.series.length ? 'success' : 'empty',
    );
  } catch (error) {
    reportModuleError('dashboard', error);
  }
}

async function loadMembers() {
  if (!selectedGuildId) return;
  showModuleStatus('members', 'Chargement des membres…', 'loading');
  const params = new URLSearchParams({
    page: String(memberPage),
    pageSize: String(pageSize),
  });
  const search = document.querySelector('#members-search').value.trim();
  const roleId = document.querySelector('#members-role-filter').value.trim();
  if (search) params.set('search', search);
  if (roleId) params.set('roleId', roleId);

  try {
    const response = await api(
      `/guilds/${escapePath(selectedGuildId)}/members?${params}`,
    );
    renderDataTable(document.querySelector('#members-table'), {
      columns: [
        {
          label: 'Pseudo',
          value: (member) => member.displayName ?? member.discordUserId,
        },
        {
          label: 'Identifiant Discord',
          value: (member) => member.discordUserId,
        },
        {
          label: 'Date d’arrivée observée',
          value: (member) =>
            member.joinedAt
              ? new Intl.DateTimeFormat('fr-FR', {
                  dateStyle: 'medium',
                }).format(new Date(member.joinedAt))
              : 'Inconnue',
        },
        {
          label: 'Rôles Discord',
          value: (member) =>
            member.roleIds.length
              ? member.roleIds.join(', ')
              : 'Aucun rôle observé',
        },
        {
          label: 'Dernière synchronisation',
          value: (member) =>
            new Intl.DateTimeFormat('fr-FR', {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(new Date(member.syncedAt)),
        },
      ],
      rows: response.members,
      emptyMessage: 'Aucun membre ne correspond à ces filtres.',
    });
    memberPages = response.pages;
    document.querySelector('#members-page-status').textContent =
      `Page ${response.page} sur ${Math.max(response.pages, 1)} · ${response.total} membre${response.total === 1 ? '' : 's'}`;
    document.querySelector('#members-previous').disabled = response.page <= 1;
    document.querySelector('#members-next').disabled =
      response.page >= response.pages;
    showModuleStatus('members', '', 'success');
  } catch (error) {
    reportModuleError('members', error);
    renderDataTable(document.querySelector('#members-table'), {
      columns: [{ label: 'Membres', value: () => '' }],
      rows: [],
      emptyMessage:
        error.status === 403
          ? 'Accès refusé à la liste privée des membres.'
          : 'La liste des membres ne peut pas être chargée.',
    });
  }
}

function renderRoles(roles) {
  renderDataTable(document.querySelector('#roles-table'), {
    columns: [
      { label: 'Rôle', value: (role) => role.name },
      {
        label: 'Permissions',
        value: (role) =>
          role.permissions
            .filter((permission) => permission.effect === 'ALLOW')
            .map((permission) => permission.key)
            .join(', ') || 'Aucune permission explicite',
      },
    ],
    rows: roles,
    emptyMessage: 'Aucun rôle Nexus n’est configuré.',
  });
}

async function loadSettings() {
  if (!selectedGuildId) return;
  const guildPath = `/guilds/${escapePath(selectedGuildId)}`;
  showModuleStatus('settings', 'Chargement des paramètres…', 'loading');
  try {
    const { settings } = await api(`${guildPath}/settings`);
    document.querySelector('#settings-timezone-current').textContent =
      `Fuseau actuel : ${settings.analyticsTimezone}`;
    document.querySelector('#settings-timezone').value =
      settings.analyticsTimezone;
    showModuleStatus('settings', '', 'success');
  } catch (error) {
    document.querySelector('#settings-timezone-current').textContent =
      'Fuseau actuel indisponible.';
    reportModuleError('settings', error);
  }

  try {
    const [rolesResponse, catalogResponse] = await Promise.all([
      api(`${guildPath}/roles`),
      api(`${guildPath}/permission-catalog`),
    ]);
    renderRoles(rolesResponse.roles);
    const options = document.querySelector('#role-permission-options');
    const legend = options.querySelector('legend');
    const note = options.querySelector('p');
    options.replaceChildren(legend, note);
    for (const permission of catalogResponse.permissions) {
      const label = document.createElement('label');
      label.className = 'permission-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'permission';
      checkbox.value = permission.key;
      const description = document.createElement('span');
      description.textContent = `${permission.key} — ${permission.description}`;
      label.append(checkbox, description);
      options.append(label);
    }
    showModuleStatus('settings-roles', '', 'success');
  } catch (error) {
    reportModuleError('settings-roles', error);
    renderRoles([]);
  }
}

function connectRealtime(guildId) {
  realtimeSocket?.disconnect();
  elements.realtimeStatus.hidden = false;
  elements.realtimeStatus.textContent = 'Connexion aux mises à jour…';
  realtimeSocket = io({ withCredentials: true });
  realtimeSocket.on('connect', () => {
    realtimeSocket.emit('guild:subscribe', guildId, (result) => {
      elements.realtimeStatus.textContent = result.ok
        ? 'Mises à jour en temps réel actives.'
        : 'Accès temps réel refusé pour ce serveur.';
      if (result.ok) elements.realtimeStatus.dataset.state = 'success';
      else elements.realtimeStatus.dataset.state = 'denied';
    });
  });
  realtimeSocket.on('guild:updated', () => {
    if (currentView === 'dashboard') void loadDashboard();
    else if (currentView === 'analytics') void loadAnalytics();
    else if (currentView === 'members') void loadMembers();
    else if (currentView === 'settings') void loadSettings();
    else void staffUI.load(currentView);
  });
  realtimeSocket.on('connect_error', (error) => {
    elements.realtimeStatus.textContent =
      error.message === 'authentication_required'
        ? 'Reconnectez-vous pour recevoir les notifications temps réel.'
        : 'Les mises à jour temps réel sont momentanément indisponibles.';
    elements.realtimeStatus.dataset.state = 'error';
  });
}

function dateOffset(date, offset) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function showStatus(message, state = 'info') {
  elements.status.textContent = message;
  elements.status.dataset.state = state;
  elements.status.hidden = !message;
}

function setLoading(loading) {
  elements.content.setAttribute('aria-busy', String(loading));
  elements.form.querySelector('button[type="submit"]').disabled = loading;
  elements.export.disabled = loading;
  if (loading) {
    showStatus('Chargement des statistiques…', 'loading');
  }
}

function escapePath(value) {
  return encodeURIComponent(value);
}

function formatComparison(current, previous) {
  if (previous === 0) {
    return current === 0
      ? 'Identique à la période comparée'
      : 'Aucune donnée précédente';
  }
  const change = ((current - previous) / previous) * 100;
  const sign = change > 0 ? '+' : '';
  return `${sign}${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(change)} %`;
}

function setMetric(id, value, comparisonId, previousValue) {
  document.querySelector(`#${id}`).textContent = formatter.format(value);
  const comparisonElement = document.querySelector(`#${comparisonId}`);
  comparisonElement.textContent =
    previousValue === undefined ? '' : formatComparison(value, previousValue);
}

function makeChart(context, existing, config) {
  if (existing) {
    existing.destroy();
  }
  return new Chart(context, config);
}

function renderCharts() {
  const points = summary?.series ?? [];
  const comparePoints = comparison?.series ?? [];
  document.querySelector('#messages-chart-description').textContent = summary
    ? `Graphique des messages observés du ${summary.from} au ${summary.to}, fuseau ${summary.timezone}. Total : ${formatter.format(summary.totals.messageCount)}.`
    : 'Aucune donnée de messages disponible.';
  document.querySelector('#members-chart-description').textContent = summary
    ? `Graphique des membres actifs et des arrivées et départs du ${summary.from} au ${summary.to}, fuseau ${summary.timezone}. Membres actifs sur la période : DAU ${formatter.format(summary.active.dau)}, WAU ${formatter.format(summary.active.wau)}, MAU ${formatter.format(summary.active.mau)}.`
    : 'Aucune donnée de membres disponible.';
  if (points.length === 0) {
    messagesChart?.destroy();
    membersChart?.destroy();
    messagesChart = null;
    membersChart = null;
    return;
  }

  const labels = points.map((point) => point.date);
  const compareMessages = points.map((point) => {
    if (!comparison) {
      return null;
    }
    const offset =
      (Date.parse(`${point.date}T00:00:00Z`) -
        Date.parse(`${summary.from}T00:00:00Z`)) /
      86_400_000;
    return (
      comparePoints.find(
        (comparePoint) =>
          comparePoint.date === dateOffset(comparison.from, offset),
      )?.messageCount ?? null
    );
  });
  const compareActive = points.map((point) => {
    if (!comparison) {
      return null;
    }
    const offset =
      (Date.parse(`${point.date}T00:00:00Z`) -
        Date.parse(`${summary.from}T00:00:00Z`)) /
      86_400_000;
    return (
      comparePoints.find(
        (comparePoint) =>
          comparePoint.date === dateOffset(comparison.from, offset),
      )?.activeMembers ?? null
    );
  });
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { labels: { color: '#c4c9d8' } },
      tooltip: {
        callbacks: {
          title: (items) => `${items[0]?.label ?? ''} (${summary.timezone})`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#9299ad', maxTicksLimit: 10 },
        grid: { color: '#262b3b' },
      },
      y: {
        beginAtZero: true,
        ticks: { color: '#9299ad', precision: 0 },
        grid: { color: '#262b3b' },
      },
    },
  };

  messagesChart = makeChart(
    document.querySelector('#messages-chart'),
    messagesChart,
    {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Messages observés',
            data: points.map((point) => point.messageCount),
            borderColor: '#5865f2',
            backgroundColor: 'rgba(88, 101, 242, 0.18)',
            fill: true,
            tension: 0.3,
          },
          ...(comparison
            ? [
                {
                  label: 'Période comparée',
                  data: compareMessages,
                  borderColor: '#8b5cf6',
                  borderDash: [6, 4],
                  tension: 0.3,
                },
              ]
            : []),
        ],
      },
      options: commonOptions,
    },
  );

  membersChart = makeChart(
    document.querySelector('#members-chart'),
    membersChart,
    {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Membres actifs (DAU)',
            data: points.map((point) => point.activeMembers),
            backgroundColor: 'rgba(139, 92, 246, 0.72)',
            borderRadius: 4,
          },
          {
            label: 'Arrivées',
            data: points.map((point) => point.joins),
            backgroundColor: 'rgba(52, 211, 153, 0.68)',
            borderRadius: 4,
          },
          {
            label: 'Départs',
            data: points.map((point) => point.leaves),
            backgroundColor: 'rgba(248, 113, 113, 0.68)',
            borderRadius: 4,
          },
          ...(comparison
            ? [
                {
                  label: 'DAU période comparée',
                  data: compareActive,
                  type: 'line',
                  borderColor: '#5865f2',
                  tension: 0.3,
                },
              ]
            : []),
        ],
      },
      options: commonOptions,
    },
  );
}

function rangeQuery() {
  const params = new URLSearchParams();
  if (elements.dateFrom.value && elements.dateTo.value) {
    params.set('from', elements.dateFrom.value);
    params.set('to', elements.dateTo.value);
  }
  if (
    elements.compare.checked &&
    elements.dateFrom.value &&
    elements.dateTo.value
  ) {
    const from = new Date(`${elements.dateFrom.value}T00:00:00Z`);
    const to = new Date(`${elements.dateTo.value}T00:00:00Z`);
    const days = Math.round((to - from) / 86_400_000) + 1;
    const compareTo = new Date(from.getTime() - 86_400_000);
    const compareFrom = new Date(compareTo.getTime() - (days - 1) * 86_400_000);
    params.set('compareFrom', compareFrom.toISOString().slice(0, 10));
    params.set('compareTo', compareTo.toISOString().slice(0, 10));
  }
  return params;
}

async function loadChannels() {
  const params = rangeQuery();
  params.set('page', String(channelPage));
  params.set('pageSize', '10');
  const channelId = elements.channelFilter.value.trim();
  if (channelId) {
    params.set('channelId', channelId);
  }
  const response = await api(
    `/guilds/${escapePath(selectedGuildId)}/analytics/channels?${params}`,
  );
  elements.channelsBody.replaceChildren();
  for (const channel of response.channels) {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    const count = document.createElement('td');
    name.textContent = channel.channelId;
    count.textContent = formatter.format(channel.messageCount);
    row.append(name, count);
    elements.channelsBody.append(row);
  }
  if (response.channels.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 2;
    cell.textContent = 'Aucune donnée pour cette période.';
    row.append(cell);
    elements.channelsBody.append(row);
  }
  channelPages = response.pages;
  elements.pageStatus.textContent = `Page ${response.page} sur ${Math.max(response.pages, 1)}`;
  elements.previousPage.disabled = response.page <= 1;
  elements.nextPage.disabled = response.page >= response.pages;
}

async function loadAnalytics() {
  if (!selectedGuildId) {
    return;
  }
  setLoading(true);
  try {
    const params = rangeQuery();
    const result = await api(
      `/guilds/${escapePath(selectedGuildId)}/analytics/overview?${params}`,
    );
    summary = result.summary;
    comparison = result.comparison;
    elements.timezoneLabel.textContent = `Fuseau : ${summary.timezone}`;
    elements.timezoneInput.value = summary.timezone;

    if (!elements.dateFrom.value) {
      elements.dateFrom.value = summary.from;
      elements.dateTo.value = summary.to;
    }
    setMetric(
      'metric-messages',
      summary.totals.messageCount,
      'metric-messages-compare',
      comparison?.totals.messageCount,
    );
    setMetric(
      'metric-joins',
      summary.totals.joins,
      'metric-joins-compare',
      comparison?.totals.joins,
    );
    setMetric(
      'metric-leaves',
      summary.totals.leaves,
      'metric-leaves-compare',
      comparison?.totals.leaves,
    );
    document.querySelector('#metric-dau').textContent = formatter.format(
      summary.active.dau,
    );
    document.querySelector('#metric-active-period').textContent =
      `au ${summary.to} · WAU ${formatter.format(summary.active.wau)} · MAU ${formatter.format(summary.active.mau)}`;
    renderCharts();
    await loadChannels();

    if (!summary.observedFrom || summary.series.length === 0) {
      showStatus(
        'Aucune donnée observée pour cette période. Vérifiez que le bot est installé, connecté et autorisé à voir les salons.',
        'empty',
      );
    } else {
      showStatus(
        `Données disponibles depuis le ${summary.observedFrom}.`,
        'success',
      );
    }
  } catch (error) {
    const message =
      error.status === 401
        ? 'Votre session a expiré. Reconnectez-vous avec Discord.'
        : error.status === 403
          ? 'Accès refusé : vérifiez votre accès au serveur et la permission analytics.view.'
          : error.message;
    showStatus(message, error.status === 403 ? 'denied' : 'error');
  } finally {
    setLoading(false);
  }
}

async function loadSession() {
  try {
    const me = await api('/me');
    sessionUser = me.user;
    elements.logout.hidden = false;
    const { guilds } = await api('/guilds');
    if (guilds.length === 0) {
      await loadAvailableGuilds();
      return;
    }
    elements.guildSelector.replaceChildren();
    for (const guild of guilds) {
      const option = document.createElement('option');
      option.value = guild.id;
      option.textContent = guild.name;
      option.selected = guild.id === me.selectedGuildId;
      elements.guildSelector.append(option);
    }
    elements.guildSelector.disabled = false;
    selectedGuildId =
      me.selectedGuildId &&
      guilds.some((guild) => guild.id === me.selectedGuildId)
        ? me.selectedGuildId
        : guilds[0].id;
    elements.guildSelector.value = selectedGuildId;
    elements.dashboard.hidden = false;
    if (selectedGuildId !== me.selectedGuildId) {
      await api(`/guilds/${escapePath(selectedGuildId)}/select`, {
        method: 'POST',
      });
    }
    connectRealtime(selectedGuildId);
    await loadAnalytics();
    const initialView = window.location.hash.slice(1);
    if (viewTitles[initialView]) setActiveView(initialView);
    else setActiveView('analytics');
  } catch (error) {
    if (error.status === 401) {
      elements.signedOut.hidden = false;
      elements.dashboard.hidden = true;
      return;
    }
    if (error.status === 404) {
      try {
        await loadAvailableGuilds();
      } catch (availableError) {
        showStatus(availableError.message, 'error');
      }
      return;
    }
    showStatus(error.message, 'error');
  }
}

async function loadAvailableGuilds() {
  elements.noGuilds.hidden = false;
  const available = await api('/guilds/available');
  elements.availableGuildSelector.replaceChildren(
    new Option('Sélectionnez un serveur', ''),
  );
  for (const guild of available.guilds.filter(
    (entry) => entry.canCreateNexus,
  )) {
    elements.availableGuildSelector.add(new Option(guild.name, guild.id));
  }
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  channelPage = 1;
  void loadAnalytics();
});

elements.guildSelector.addEventListener('change', async () => {
  selectedGuildId = elements.guildSelector.value;
  try {
    await api(`/guilds/${escapePath(selectedGuildId)}/select`, {
      method: 'POST',
    });
    channelPage = 1;
    memberPage = 1;
    connectRealtime(selectedGuildId);
    if (currentView === 'dashboard') await loadDashboard();
    else if (currentView === 'analytics') await loadAnalytics();
    else if (currentView === 'members') await loadMembers();
    else if (currentView === 'settings') await loadSettings();
    else await staffUI.load(currentView);
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

for (const link of document.querySelectorAll('[data-view]')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const view = link.dataset.view;
    setActiveView(view);
    window.history.replaceState(null, '', `#${view}`);
  });
}

elements.availableGuildForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const guildId = elements.availableGuildSelector.value;
  if (!guildId) {
    return;
  }
  try {
    await api(`/guilds/${escapePath(guildId)}/select`, { method: 'POST' });
    window.location.reload();
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

elements.channelForm.addEventListener('submit', (event) => {
  event.preventDefault();
  channelPage = 1;
  void loadChannels().catch((error) => showStatus(error.message, 'error'));
});

elements.previousPage.addEventListener('click', () => {
  channelPage = Math.max(1, channelPage - 1);
  void loadChannels().catch((error) => showStatus(error.message, 'error'));
});

elements.nextPage.addEventListener('click', () => {
  channelPage = Math.min(channelPages, channelPage + 1);
  void loadChannels().catch((error) => showStatus(error.message, 'error'));
});

elements.export.addEventListener('click', async () => {
  try {
    const params = rangeQuery();
    const response = await fetch(
      `${API}/guilds/${escapePath(selectedGuildId)}/analytics/export.csv?${params}`,
      { credentials: 'same-origin' },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(
        payload?.error?.message ??
          (response.status === 403
            ? 'La permission analytics.export est requise.'
            : 'L’export a échoué.'),
      );
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = 'nexus-analytics.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    showStatus('Export CSV téléchargé.', 'success');
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

elements.timezoneForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api(`/guilds/${escapePath(selectedGuildId)}/analytics/timezone`, {
      method: 'PUT',
      body: JSON.stringify({ timezone: elements.timezoneInput.value.trim() }),
    });
    channelPage = 1;
    await loadAnalytics();
  } catch (error) {
    showStatus(
      error.status === 403
        ? 'La permission settings.manage est requise pour changer le fuseau.'
        : error.message,
      error.status === 403 ? 'denied' : 'error',
    );
  }
});

elements.logout.addEventListener('click', async () => {
  try {
    await api('/auth/logout', { method: 'POST' });
    window.location.reload();
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

void loadSession();
