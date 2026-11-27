import { randomUUID } from 'node:crypto';

// Only these template identifiers can become public content. The UI owns their copy.
export const HELP_TYPES = Object.freeze(['explain_step', 'check_observation', 'compare_results']);

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function role(card, childId, projectId) {
  if (childId === card.author && projectId === card.authorProject) return 'author';
  if (childId === card.helper && projectId === card.helperProject) return 'helper';
  return 'member';
}

function view(card, childId, projectId) {
  const myRole = role(card, childId, projectId);
  return {
    cardId: card.cardId,
    type: card.type,
    status: card.status,
    myRole,
    myConfirmed:
      myRole === 'author' ? card.authorConfirmed : myRole === 'helper' && card.helperConfirmed,
  };
}

/** Per-process state. Resolve the current Host binding afresh before every operation. */
export function createTeamHelp({ resolveBinding }) {
  if (typeof resolveBinding !== 'function') throw new TypeError('resolveBinding is required');
  const teams = new Map();

  async function scope(session) {
    try {
      const { childId, projectId, teamId } = await resolveBinding(session);
      if ([childId, projectId, teamId].every((id) => typeof id === 'string' && id.trim())) {
        return { childId, projectId, key: teamId };
      }
    } catch {
      // Host errors may contain credentials or session details. Do not propagate them.
    }
    fail('unbound');
  }

  function lookup(key, cardId) {
    const card = teams.get(key)?.cards.get(cardId);
    if (!card) fail('not_found'); // foreign and nonexistent cards are indistinguishable
    return card;
  }

  return {
    async publish(session, input) {
      const { key, childId, projectId } = await scope(session);
      if (
        !input ||
        typeof input !== 'object' ||
        !Object.hasOwn(input, 'type') ||
        !Object.hasOwn(input, 'requestId') ||
        Reflect.ownKeys(input).length !== 2
      )
        fail('invalid_input');
      const { type, requestId } = input;
      if (
        !HELP_TYPES.includes(type) ||
        typeof requestId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)
      )
        fail('invalid_input');

      let team = teams.get(key);
      if (!team) {
        team = { cards: new Map(), requests: new Map(), points: 0 };
        teams.set(key, team);
      }
      const request = JSON.stringify([childId, projectId, requestId]);
      let card = team.requests.get(request);
      if (card) {
        if (card.type !== type) fail('request_conflict');
      } else {
        card = {
          cardId: randomUUID(),
          type,
          status: 'open',
          author: childId,
          authorProject: projectId,
          helper: null,
          helperProject: null,
          authorConfirmed: false,
          helperConfirmed: false,
        };
        team.cards.set(card.cardId, card);
        team.requests.set(request, card);
      }
      return view(card, childId, projectId);
    },

    async board(session) {
      const { key, childId, projectId } = await scope(session);
      const team = teams.get(key);
      return {
        cards: team
          ? Array.from(team.cards.values(), (card) => view(card, childId, projectId))
          : [],
        teamPoints: team?.points ?? 0,
      };
    },

    async claim(session, cardId) {
      const { key, childId, projectId } = await scope(session);
      const card = lookup(key, cardId);
      if (childId === card.author) fail('self_claim');
      if (card.helper !== null && role(card, childId, projectId) !== 'helper')
        fail('already_claimed');
      if (card.helper === null) {
        card.helper = childId;
        card.helperProject = projectId;
        card.status = 'claimed';
      }
      return view(card, childId, projectId);
    },

    async confirm(session, cardId) {
      const { key, childId, projectId } = await scope(session);
      const card = lookup(key, cardId);
      if (role(card, childId, projectId) === 'member') fail('not_participant');
      if (card.helper === null) fail('not_claimed');
      if (childId === card.author) card.authorConfirmed = true;
      else card.helperConfirmed = true;
      // No awaits between checking the transition and crediting the team's score.
      if (card.status !== 'completed' && card.authorConfirmed && card.helperConfirmed) {
        card.status = 'completed';
        teams.get(key).points++;
      }
      return view(card, childId, projectId);
    },
  };
}
