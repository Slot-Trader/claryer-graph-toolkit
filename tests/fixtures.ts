import type { ConversationInput } from '../src/index.js';

// Fictional people and conversations used across tests.
export const ada = { id: 'ada', name: 'Ada Lin', role: 'Designer' };
export const ben = { id: 'ben', name: 'Ben Cole', role: 'Engineer' };
export const cara = { id: 'cara', name: 'Cara Diaz' };

export const kickoff: ConversationInput = {
  id: 'c-kickoff',
  title: 'Kickoff',
  startedAt: '2026-01-05T10:00:00Z',
  participants: [ada, ben],
  topics: ['Onboarding flow'],
  messages: [
    { id: 'k1', senderId: 'ada', text: 'Let us ship the onboarding flow in March.' },
    { id: 'k2', senderId: 'ben', text: 'Agreed, I will build it.' },
  ],
  decisions: [
    { id: 'd-ship-march', description: 'Ship onboarding in March', madeBy: 'ada', assignedTo: ['ben'], topics: ['Onboarding flow'] },
  ],
};

export const unrelated: ConversationInput = {
  id: 'c-unrelated',
  title: 'Lunch',
  startedAt: '2026-01-06T12:00:00Z',
  participants: [cara],
  topics: ['Food'],
  messages: [{ id: 'u1', senderId: 'cara', text: 'Anyone for lunch?' }],
  decisions: [{ id: 'd-lunch', description: 'Lunch at noon', madeBy: 'cara' }],
};

export const followUp: ConversationInput = {
  id: 'c-followup',
  title: 'Follow-up',
  startedAt: '2026-02-01T10:00:00Z',
  participants: [ada, ben],
  topics: ['Onboarding flow'],
  messages: [
    { id: 'f1', senderId: 'ada', text: '@ben can we get onboarding out by end of February?' },
    { id: 'f2', senderId: 'ben', text: 'I thought March was the plan.' },
  ],
};

export const validAnalysisJson = JSON.stringify({
  summary: 'Deadline disagreement.',
  decisions: [
    {
      description: 'Ship onboarding by end of February',
      owner: 'ben',
      interpretations: [
        { personId: 'ada', understanding: 'End of February' },
        { personId: 'ben', understanding: 'March' },
      ],
    },
  ],
  risks: [
    {
      type: 'conflicting-deadline',
      description: 'February vs March',
      severity: 'high',
      involvedPersonIds: ['ada', 'ben'],
      evidenceMessageIds: ['f1', 'f2'],
    },
  ],
  suggestedClarifications: ['Confirm the deadline.'],
});
