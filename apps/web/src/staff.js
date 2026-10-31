const formatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function textInput(options = {}) {
  const input = document.createElement('input');
  for (const [key, value] of Object.entries(options)) {
    if (key === 'checked') input.checked = value;
    else if (key === 'required') input.required = value;
    else input[key] = value;
  }
  return input;
}

function textarea(options = {}) {
  const control = document.createElement('textarea');
  for (const [key, value] of Object.entries(options)) {
    if (key === 'required') control.required = value;
    else control[key] = value;
  }
  return control;
}

function button(text, className = 'button button-quiet') {
  const control = node('button', className, text);
  control.type = 'button';
  return control;
}

function formatDate(value) {
  if (!value) return 'Sans échéance';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date inconnue'
    : formatter.format(date);
}

function emptyMessage(container, message) {
  container.replaceChildren(node('p', 'empty-note', message));
}

function recordCard(title, metadata) {
  const card = node('article', 'record-card');
  const header = node('div', 'record-heading');
  header.append(node('h4', '', title), node('span', 'record-meta', metadata));
  card.append(header);
  return card;
}

function jsonBody(value) {
  return {
    method: 'POST',
    body: JSON.stringify(value),
  };
}

export function initializeStaffUI({ api, getGuildId, getUser }) {
  const statusNodes = new Map(
    [...document.querySelectorAll('[data-status-for]')].map((element) => [
      element.dataset.statusFor,
      element,
    ]),
  );
  const status = (view, message, state = 'info') => {
    const element = statusNodes.get(view);
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
    element.hidden = !message;
  };
  const request = (path, options = {}) =>
    api(`/guilds/${encodeURIComponent(getGuildId())}${path}`, options);
  const reportError = (view, error) => {
    const message =
      error.status === 401
        ? 'Votre session a expiré. Reconnectez-vous avec Discord.'
        : error.status === 403
          ? 'Accès refusé : votre rôle ne permet pas de consulter ou modifier ces données.'
          : error.message;
    status(view, message, error.status === 403 ? 'denied' : 'error');
  };
  const withSubmit = (view, form, callback) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await callback(new FormData(form));
      } catch (error) {
        reportError(view, error);
      } finally {
        submit.disabled = false;
      }
    });
  };
  const attachRefresh = (view, callback) => {
    for (const control of document.querySelectorAll(
      `[data-refresh="${view}"]`,
    )) {
      control.addEventListener('click', () => void callback());
    }
  };

  async function loadStaff() {
    status('staff', 'Chargement des profils et équipes…', 'loading');
    try {
      const [profiles, teams] = await Promise.all([
        request('/staff'),
        request('/staff/teams'),
      ]);
      const profileList = document.querySelector('#staff-profiles');
      profileList.replaceChildren();
      if (profiles.profiles.length === 0) {
        emptyMessage(profileList, 'Aucun profil staff enregistré.');
      }
      for (const profile of profiles.profiles) {
        const card = recordCard(
          profile.title || `Membre ${profile.userId}`,
          profile.active ? 'Actif' : 'Inactif',
        );
        card.append(
          node('p', 'record-description', `ID Nexus : ${profile.userId}`),
        );
        profileList.append(card);
      }

      const teamList = document.querySelector('#staff-teams');
      teamList.replaceChildren();
      if (teams.teams.length === 0) {
        emptyMessage(teamList, 'Aucune équipe créée.');
      }
      for (const team of teams.teams) {
        const card = recordCard(
          team.name,
          `${team.members.length} membre${team.members.length === 1 ? '' : 's'}`,
        );
        if (team.description) {
          card.append(node('p', 'record-description', team.description));
        }
        for (const member of team.members) {
          card.append(node('p', 'record-meta', `ID Nexus : ${member.userId}`));
        }
        const form = node('form', 'inline-form');
        const userId = textInput({
          name: 'userId',
          placeholder: 'ID utilisateur Nexus',
          required: true,
          maxLength: 128,
        });
        const add = node('button', 'button button-quiet', 'Ajouter un membre');
        add.type = 'submit';
        form.append(userId, add);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          add.disabled = true;
          try {
            await request(
              `/staff/teams/${encodeURIComponent(team.id)}/members`,
              jsonBody({ userId: userId.value.trim() }),
            );
            status('staff', 'Membre ajouté à l’équipe.', 'success');
          } catch (error) {
            reportError('staff', error);
          } finally {
            add.disabled = false;
          }
        });
        card.append(form);
        teamList.append(card);
      }
      status('staff', '', 'success');
    } catch (error) {
      reportError('staff', error);
      emptyMessage(
        document.querySelector('#staff-profiles'),
        'Les profils ne peuvent pas être chargés.',
      );
      emptyMessage(
        document.querySelector('#staff-teams'),
        'Les équipes ne peuvent pas être chargées.',
      );
    }
  }

  withSubmit(
    'staff',
    document.querySelector('#staff-profile-form'),
    async (data) => {
      await request(`/staff/${encodeURIComponent(data.get('userId').trim())}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: data.get('title').trim() || null,
          active: data.get('active') === 'on',
        }),
      });
      status('staff', 'Profil staff enregistré.', 'success');
    },
  );

  withSubmit(
    'staff',
    document.querySelector('#staff-team-form'),
    async (data) => {
      await request(
        '/staff/teams',
        jsonBody({
          name: data.get('name').trim(),
          description: data.get('description').trim() || null,
        }),
      );
      document.querySelector('#staff-team-form').reset();
      status('staff', 'Équipe créée.', 'success');
    },
  );
  attachRefresh('staff', loadStaff);

  async function loadTasks() {
    status('tasks', 'Chargement des tâches…', 'loading');
    try {
      const { tasks } = await request('/tasks');
      const list = document.querySelector('#tasks-list');
      list.replaceChildren();
      if (!tasks.length) emptyMessage(list, 'Aucune tâche pour le moment.');
      for (const task of tasks) {
        const card = recordCard(task.title, task.status);
        card.append(
          node('p', 'record-description', task.description),
          node(
            'p',
            'record-meta',
            `${task.assigneeId ? `Responsable Nexus : ${task.assigneeId} · ` : ''}${formatDate(task.dueAt)}`,
          ),
        );
        const comments = node('div', 'comment-list');
        for (const comment of task.comments ?? []) {
          comments.append(
            node(
              'p',
              'record-meta',
              `${comment.content} — ${formatDate(comment.createdAt)}`,
            ),
          );
        }
        if (task.comments?.length) card.append(comments);

        const form = node('form', 'inline-form task-update-form');
        const state = document.createElement('select');
        state.name = 'status';
        for (const [value, label] of [
          ['OPEN', 'À faire'],
          ['IN_PROGRESS', 'En cours'],
          ['COMPLETED', 'Terminée'],
          ['VALIDATED', 'Validée'],
        ]) {
          const option = new Option(label, value, false, value === task.status);
          state.add(option);
        }
        const comment = textInput({
          name: 'comment',
          placeholder: 'Ajouter un commentaire (facultatif)',
          maxLength: 2000,
        });
        const save = node('button', 'button button-quiet', 'Mettre à jour');
        save.type = 'submit';
        form.append(state, comment, save);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          save.disabled = true;
          const payload = { status: state.value };
          if (comment.value.trim()) payload.comment = comment.value.trim();
          try {
            await request(`/tasks/${encodeURIComponent(task.id)}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
            status('tasks', 'Tâche mise à jour.', 'success');
          } catch (error) {
            reportError('tasks', error);
          } finally {
            save.disabled = false;
          }
        });
        card.append(form);
        list.append(card);
      }
      status('tasks', '', 'success');
    } catch (error) {
      reportError('tasks', error);
      emptyMessage(
        document.querySelector('#tasks-list'),
        'Accès aux tâches refusé.',
      );
    }
  }

  withSubmit('tasks', document.querySelector('#task-form'), async (data) => {
    const dueAt = data.get('dueAt');
    await request(
      '/tasks',
      jsonBody({
        title: data.get('title').trim(),
        description: data.get('description').trim(),
        assigneeId: data.get('assigneeId').trim() || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      }),
    );
    document.querySelector('#task-form').reset();
    status('tasks', 'Tâche créée.', 'success');
  });
  attachRefresh('tasks', loadTasks);

  async function loadReports() {
    status('reports', 'Chargement des signalements…', 'loading');
    try {
      const { reports } = await request('/reports');
      const list = document.querySelector('#reports-list');
      list.replaceChildren();
      if (!reports.length) emptyMessage(list, 'Aucun signalement reçu.');
      for (const report of reports) {
        const card = recordCard(report.category, report.status);
        card.append(
          node('p', 'record-description', report.details),
          node(
            'p',
            'record-meta',
            `Cible Discord : ${report.targetDiscordId} · ${formatDate(report.createdAt)}`,
          ),
        );
        const form = node('form', 'inline-form');
        const state = document.createElement('select');
        state.name = 'status';
        for (const value of [
          'OPEN',
          'UNDER_REVIEW',
          'ACCEPTED',
          'REJECTED',
          'CLOSED',
        ]) {
          state.add(
            new Option(
              value.replace('_', ' '),
              value,
              false,
              value === report.status,
            ),
          );
        }
        const assign = textInput({
          name: 'assignedTo',
          placeholder: 'ID Nexus du responsable',
          maxLength: 128,
          value: report.assignedTo ?? '',
        });
        const save = node('button', 'button button-quiet', 'Enregistrer');
        save.type = 'submit';
        form.append(state, assign, save);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          save.disabled = true;
          try {
            await request(`/reports/${encodeURIComponent(report.id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                status: state.value,
                assignedTo: assign.value.trim() || null,
              }),
            });
            status('reports', 'Signalement mis à jour.', 'success');
          } catch (error) {
            reportError('reports', error);
          } finally {
            save.disabled = false;
          }
        });
        card.append(form);
        list.append(card);
      }
      status('reports', '', 'success');
    } catch (error) {
      reportError('reports', error);
      emptyMessage(
        document.querySelector('#reports-list'),
        'Les signalements sont privés et leur accès est refusé.',
      );
    }
  }

  withSubmit(
    'reports',
    document.querySelector('#report-form'),
    async (data) => {
      await request(
        '/reports',
        jsonBody({
          targetDiscordId: data.get('targetDiscordId').trim(),
          category: data.get('category').trim(),
          details: data.get('details').trim(),
        }),
      );
      document.querySelector('#report-form').reset();
      status('reports', 'Signalement envoyé de manière privée.', 'success');
    },
  );
  attachRefresh('reports', loadReports);

  async function loadApplications() {
    status('applications', 'Chargement des candidatures…', 'loading');
    try {
      const { applications } = await request('/applications');
      const list = document.querySelector('#applications-list');
      list.replaceChildren();
      if (!applications.length) emptyMessage(list, 'Aucune candidature reçue.');
      for (const application of applications) {
        const card = recordCard('Candidature', application.status);
        const answers = application.answers ?? {};
        for (const [question, answer] of Object.entries(answers)) {
          card.append(
            node('p', 'record-description', `${question}: ${answer}`),
          );
        }
        card.append(
          node(
            'p',
            'record-meta',
            `Candidature reçue le ${formatDate(application.createdAt)}`,
          ),
        );
        const form = node('form', 'inline-form');
        const state = document.createElement('select');
        for (const value of [
          'UNDER_REVIEW',
          'ACCEPTED',
          'REJECTED',
          'CLOSED',
        ]) {
          state.add(
            new Option(
              value.replace('_', ' '),
              value,
              false,
              value === application.status,
            ),
          );
        }
        const save = node('button', 'button button-quiet', 'Examiner');
        save.type = 'submit';
        form.append(state, save);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          save.disabled = true;
          try {
            await request(
              `/applications/${encodeURIComponent(application.id)}`,
              {
                method: 'PATCH',
                body: JSON.stringify({ status: state.value }),
              },
            );
            status('applications', 'Candidature examinée.', 'success');
          } catch (error) {
            reportError('applications', error);
          } finally {
            save.disabled = false;
          }
        });
        card.append(form);
        list.append(card);
      }
      status('applications', '', 'success');
    } catch (error) {
      reportError('applications', error);
      emptyMessage(
        document.querySelector('#applications-list'),
        'Les candidatures sont privées et leur accès est refusé.',
      );
    }
  }

  withSubmit(
    'applications',
    document.querySelector('#application-form'),
    async (data) => {
      await request(
        '/applications',
        jsonBody({
          answers: {
            motivation: data.get('motivation').trim(),
            experience: data.get('experience').trim(),
            availability: data.get('availability').trim(),
          },
        }),
      );
      document.querySelector('#application-form').reset();
      status('applications', 'Candidature envoyée en privé.', 'success');
    },
  );
  attachRefresh('applications', loadApplications);

  async function loadModeration() {
    status('moderation', 'Chargement des dossiers de modération…', 'loading');
    const list = document.querySelector('#moderation-list');
    const appealsList = document.querySelector('#appeals-list');
    try {
      const { cases } = await request('/moderation/cases');
      list.replaceChildren();
      if (!cases.length) emptyMessage(list, 'Aucun dossier de modération.');
      for (const moderationCase of cases) {
        const card = recordCard(
          `${moderationCase.action} — ${moderationCase.status}`,
          formatDate(moderationCase.createdAt),
        );
        card.append(
          node('p', 'record-description', moderationCase.reason),
          node(
            'p',
            'record-meta',
            `Cible Discord : ${moderationCase.targetDiscordId}${moderationCase.durationSeconds ? ` · ${moderationCase.durationSeconds} s` : ''}`,
          ),
        );
        if (moderationCase.resultMessage) {
          card.append(node('p', 'record-meta', moderationCase.resultMessage));
        }
        if (
          moderationCase.targetDiscordId === getUser()?.discordId &&
          moderationCase.status === 'COMPLETED'
        ) {
          const form = node('form', 'inline-form');
          const message = textarea({
            name: 'message',
            placeholder: 'Expliquez votre contestation',
            required: true,
            maxLength: 3000,
            rows: 2,
          });
          const submit = node('button', 'button button-quiet', 'Contester');
          submit.type = 'submit';
          form.append(message, submit);
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            submit.disabled = true;
            try {
              await request(
                `/moderation/cases/${encodeURIComponent(moderationCase.id)}/appeals`,
                jsonBody({ message: message.value.trim() }),
              );
              status('moderation', 'Contestation déposée.', 'success');
            } catch (error) {
              reportError('moderation', error);
            } finally {
              submit.disabled = false;
            }
          });
          card.append(form);
        }
        list.append(card);
      }
      status('moderation', '', 'success');
    } catch (error) {
      reportError('moderation', error);
      emptyMessage(
        list,
        'Les dossiers sont privés ou la permission moderation.view est absente.',
      );
    }

    try {
      const { appeals } = await request('/moderation/appeals');
      appealsList.replaceChildren();
      if (!appeals.length)
        emptyMessage(appealsList, 'Aucune contestation en attente.');
      for (const appeal of appeals) {
        const card = recordCard(
          `Contestation ${appeal.status}`,
          formatDate(appeal.createdAt),
        );
        card.append(
          node('p', 'record-description', appeal.message),
          node(
            'p',
            'record-meta',
            `Dossier : ${appeal.case?.action ?? 'Modération'} · ${appeal.case?.targetDiscordId ?? ''}`,
          ),
        );
        if (appeal.status === 'OPEN') {
          const form = node('form', 'inline-form');
          const decision = document.createElement('select');
          decision.add(new Option('Accepter', 'ACCEPTED'));
          decision.add(new Option('Rejeter', 'REJECTED'));
          const save = node('button', 'button button-quiet', 'Décider');
          save.type = 'submit';
          form.append(decision, save);
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            save.disabled = true;
            try {
              await request(
                `/moderation/appeals/${encodeURIComponent(appeal.id)}`,
                {
                  method: 'PATCH',
                  body: JSON.stringify({ status: decision.value }),
                },
              );
              status('moderation', 'Décision enregistrée.', 'success');
            } catch (error) {
              reportError('moderation', error);
            } finally {
              save.disabled = false;
            }
          });
          card.append(form);
        }
        appealsList.append(card);
      }
    } catch (error) {
      emptyMessage(
        appealsList,
        error.status === 403
          ? 'L’accès aux contestations exige moderation.appeals.view.'
          : error.message,
      );
    }
  }

  const moderationForm = document.querySelector('#moderation-form');
  const actionSelect = moderationForm.elements.action;
  const durationField = document.querySelector('#timeout-duration-field');
  const durationInput = moderationForm.elements.durationSeconds;
  actionSelect.addEventListener('change', () => {
    durationField.hidden = actionSelect.value !== 'TIMEOUT';
    durationInput.required = actionSelect.value === 'TIMEOUT';
  });
  withSubmit('moderation', moderationForm, async (data) => {
    const value = {
      targetDiscordId: data.get('targetDiscordId').trim(),
      action: data.get('action'),
      reason: data.get('reason').trim(),
      durationSeconds:
        data.get('action') === 'TIMEOUT'
          ? Number(data.get('durationSeconds'))
          : null,
    };
    await request('/moderation/cases', jsonBody(value));
    moderationForm.reset();
    durationField.hidden = true;
    durationInput.required = false;
    status(
      'moderation',
      'Action mise en file. Le bot vérifiera les permissions Discord et la hiérarchie avant exécution.',
      'success',
    );
  });
  attachRefresh('moderation', loadModeration);

  async function loadAudit() {
    status('audit', 'Chargement du journal…', 'loading');
    try {
      const { events } = await request('/audit?limit=50');
      const list = document.querySelector('#audit-list');
      list.replaceChildren();
      if (!events.length) emptyMessage(list, 'Aucun événement audité.');
      for (const event of events) {
        const card = recordCard(event.action, formatDate(event.createdAt));
        card.append(
          node(
            'p',
            'record-description',
            `${event.subjectType}${event.subjectId ? ` · ${event.subjectId}` : ''}`,
          ),
          node('p', 'record-meta', `Acteur Nexus : ${event.actorUserId}`),
          node('pre', 'audit-details', JSON.stringify(event.details, null, 2)),
        );
        list.append(card);
      }
      status('audit', '', 'success');
    } catch (error) {
      reportError('audit', error);
      emptyMessage(
        document.querySelector('#audit-list'),
        'Le journal est privé et exige audit.view.',
      );
    }
  }
  attachRefresh('audit', loadAudit);

  async function loadNotifications() {
    status('notifications', 'Chargement des notifications…', 'loading');
    try {
      const { notifications } = await request('/notifications');
      const list = document.querySelector('#notifications-list');
      list.replaceChildren();
      if (!notifications.length)
        emptyMessage(list, 'Aucune notification reçue.');
      for (const notification of notifications) {
        const card = recordCard(
          notification.message,
          formatDate(notification.createdAt),
        );
        card.append(node('p', 'record-meta', notification.type));
        if (!notification.readAt) {
          const markRead = button('Marquer comme lue');
          markRead.addEventListener('click', async () => {
            markRead.disabled = true;
            try {
              await request(
                `/notifications/${encodeURIComponent(notification.id)}/read`,
                { method: 'POST' },
              );
              status(
                'notifications',
                'Notification marquée comme lue.',
                'success',
              );
              await loadNotifications();
            } catch (error) {
              reportError('notifications', error);
            } finally {
              markRead.disabled = false;
            }
          });
          card.append(markRead);
        } else {
          card.append(
            node(
              'p',
              'record-meta',
              `Lue le ${formatDate(notification.readAt)}`,
            ),
          );
        }
        list.append(card);
      }
      status('notifications', '', 'success');
    } catch (error) {
      reportError('notifications', error);
      emptyMessage(
        document.querySelector('#notifications-list'),
        'Impossible de charger vos notifications.',
      );
    }
  }
  attachRefresh('notifications', loadNotifications);

  const loaders = {
    analytics: async () => {},
    staff: loadStaff,
    tasks: loadTasks,
    reports: loadReports,
    applications: loadApplications,
    moderation: loadModeration,
    audit: loadAudit,
    notifications: loadNotifications,
  };
  return {
    load(view) {
      return loaders[view]?.();
    },
  };
}
