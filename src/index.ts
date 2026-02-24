import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  TELEGRAM_BOT_POOL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_ONLY,
  TRIGGER_PATTERN,
} from './config.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { TelegramChannel, initBotPool } from './channels/telegram.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import { cleanupOrphans, ensureContainerRuntimeRunning } from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  deleteSession,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let groupModels: Record<string, string> = {};
const runtimeBootstrapPending: Record<string, { from: 'claude' | 'codex'; to: 'claude' | 'codex' }> = {};
let messageLoopRunning = false;

let whatsapp: WhatsAppChannel;
const channels: Channel[] = [];
const queue = new GroupQueue();

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }

  const modelState = getRouterState('group_models');
  try {
    groupModels = modelState ? JSON.parse(modelState) : {};
  } catch {
    logger.warn('Corrupted group_models in DB, resetting');
    groupModels = {};
  }

  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState(
    'last_agent_timestamp',
    JSON.stringify(lastAgentTimestamp),
  );
  setRouterState('group_models', JSON.stringify(groupModels));
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  registeredGroups = groups;
}

type AgentRuntime = 'claude' | 'codex';

type ParsedModelCommand =
  | { action: 'show' | 'list' | 'reset' }
  | { action: 'set'; model: string }
  | { action: 'invalid'; error: string };

function parseModelCommand(content: string): ParsedModelCommand | null {
  let text = content.trim();
  if (TRIGGER_PATTERN.test(text)) {
    text = text.replace(TRIGGER_PATTERN, '').trim();
  }

  if (!text.toLowerCase().startsWith('/model')) return null;

  const args = text.slice('/model'.length).trim();
  if (!args) return { action: 'show' };

  const lowerArgs = args.toLowerCase();
  if (lowerArgs === 'list') return { action: 'list' };
  if (['default', 'reset', 'auto', 'clear'].includes(lowerArgs)) {
    return { action: 'reset' };
  }

  if (!/^[a-zA-Z0-9._:-]{2,100}$/.test(args)) {
    return {
      action: 'invalid',
      error:
        'Invalid model name. Use letters/numbers plus . _ : - (example: /model sonnet).',
    };
  }

  return { action: 'set', model: args };
}

function resolveRuntimeAndModel(modelSetting?: string): {
  runtime: AgentRuntime;
  model?: string;
} {
  if (!modelSetting) {
    return { runtime: 'claude' };
  }

  const raw = modelSetting.trim();
  if (!raw) {
    return { runtime: 'claude' };
  }

  let runtime: AgentRuntime;
  let model = raw;

  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0) {
    const prefix = raw.slice(0, colonIdx).toLowerCase();
    if (prefix === 'codex' || prefix === 'openai') {
      runtime = 'codex';
      model = raw.slice(colonIdx + 1).trim();
      return model ? { runtime, model } : { runtime };
    }
    if (prefix === 'claude') {
      runtime = 'claude';
      model = raw.slice(colonIdx + 1).trim();
      return model ? { runtime, model } : { runtime };
    }
  }

  const lower = raw.toLowerCase();
  if (lower === 'codex' || lower === 'openai') {
    return { runtime: 'codex' };
  }
  if (lower === 'claude') {
    return { runtime: 'claude' };
  }

  runtime = /^(gpt-|o[1-9]|codex)/.test(lower) ? 'codex' : 'claude';
  return { runtime, model: raw };
}

function currentModelLabel(groupFolder: string): string {
  const modelSetting = groupModels[groupFolder];
  if (!modelSetting) return 'default (claude runtime)';
  const { runtime, model } = resolveRuntimeAndModel(modelSetting);
  return model ? `${model} (${runtime})` : `default (${runtime})`;
}

function getRuntimeForGroup(groupFolder: string): AgentRuntime {
  return resolveRuntimeAndModel(groupModels[groupFolder]).runtime;
}

function getModelForGroup(groupFolder: string): string | undefined {
  return resolveRuntimeAndModel(groupModels[groupFolder]).model;
}

function sessionKey(groupFolder: string, runtime: AgentRuntime): string {
  return `${groupFolder}::${runtime}`;
}

function getSessionId(groupFolder: string, runtime: AgentRuntime): string | undefined {
  // Backwards compatibility: old installs stored only one session per group.
  if (runtime === 'claude') {
    return sessions[sessionKey(groupFolder, runtime)] || sessions[groupFolder];
  }
  return sessions[sessionKey(groupFolder, runtime)];
}

function setSessionId(groupFolder: string, runtime: AgentRuntime, sessionId: string): void {
  const key = sessionKey(groupFolder, runtime);
  sessions[key] = sessionId;
  setSession(key, sessionId);

  // Migrate legacy key for Claude so older tooling keeps seeing the active session.
  if (runtime === 'claude') {
    sessions[groupFolder] = sessionId;
    setSession(groupFolder, sessionId);
  }
}

function clearRuntimeSession(groupFolder: string, runtime: AgentRuntime): void {
  const key = sessionKey(groupFolder, runtime);
  delete sessions[key];
  deleteSession(key);

  if (runtime === 'claude') {
    delete sessions[groupFolder];
    deleteSession(groupFolder);
  }
}

async function sendControlMessage(
  channel: Channel,
  chatJid: string,
  text: string,
): Promise<void> {
  try {
    await channel.sendMessage(chatJid, text);
  } catch (err) {
    logger.warn({ chatJid, err }, 'Failed to send control message');
  }
}

async function applyModelCommands(
  messages: NewMessage[],
  group: RegisteredGroup,
  chatJid: string,
  channel: Channel,
): Promise<NewMessage[]> {
  const userMessages: NewMessage[] = [];

  for (const msg of messages) {
    const command = parseModelCommand(msg.content);
    if (!command) {
      userMessages.push(msg);
      continue;
    }

    if (command.action === 'show') {
      await sendControlMessage(
        channel,
        chatJid,
        `Model for this chat: ${currentModelLabel(group.folder)}\nUse /model <name> to switch (e.g. opus or gpt-5), /model default to reset.`,
      );
      continue;
    }

    if (command.action === 'list') {
      await sendControlMessage(
        channel,
        chatJid,
        'Examples: sonnet, opus, haiku (Claude) or gpt-5/o3 (Codex). You can force runtime with prefixes like codex:gpt-5 or claude:opus, or use /model codex for Codex defaults.',
      );
      continue;
    }

    if (command.action === 'reset') {
      const previousRuntime = getRuntimeForGroup(group.folder);
      delete groupModels[group.folder];
      const nextRuntime = getRuntimeForGroup(group.folder);

      if (previousRuntime !== nextRuntime) {
        runtimeBootstrapPending[chatJid] = {
          from: previousRuntime,
          to: nextRuntime,
        };
        clearRuntimeSession(group.folder, nextRuntime);
        // Close active container so next message starts under the new runtime.
        queue.closeStdin(chatJid);
      }

      saveState();
      await sendControlMessage(
        channel,
        chatJid,
        previousRuntime !== nextRuntime
          ? 'Model reset to default for this chat. Runtime switched; I will hand over recent context on the next message.'
          : 'Model reset to default for this chat.',
      );
      continue;
    }

    if (command.action === 'invalid') {
      await sendControlMessage(channel, chatJid, command.error);
      continue;
    }

    if (command.action === 'set') {
      const previousRuntime = getRuntimeForGroup(group.folder);
      groupModels[group.folder] = command.model;
      const resolved = resolveRuntimeAndModel(command.model);

      if (previousRuntime !== resolved.runtime) {
        runtimeBootstrapPending[chatJid] = {
          from: previousRuntime,
          to: resolved.runtime,
        };
        clearRuntimeSession(group.folder, resolved.runtime);
        // Close active container so next message starts under the new runtime.
        queue.closeStdin(chatJid);
      }

      saveState();
      const label = resolved.model
        ? `${resolved.model} (${resolved.runtime})`
        : `default (${resolved.runtime})`;
      await sendControlMessage(
        channel,
        chatJid,
        previousRuntime !== resolved.runtime
          ? `Model/runtime set to ${label} for this chat. Runtime switched; I will hand over recent context on the next message.`
          : `Model set to ${label} for this chat.`,
      );
    }
  }

  return userMessages;
}

function stripModelCommands(messages: NewMessage[]): NewMessage[] {
  return messages.filter((m) => !parseModelCommand(m.content));
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) return true;

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  const userMessages = await applyModelCommands(
    missedMessages,
    group,
    chatJid,
    channel,
  );

  if (userMessages.length === 0) {
    logger.info(
      { group: group.name, messageCount: missedMessages.length },
      'Processed control command(s) with no agent invocation',
    );
    return true;
  }

  let promptMessages = userMessages;
  const bootstrap = runtimeBootstrapPending[chatJid];
  if (bootstrap) {
    const fullHistory = stripModelCommands(
      getMessagesSince(chatJid, '', ASSISTANT_NAME),
    );
    const recentHistory = fullHistory.slice(-80);
    if (recentHistory.length > 0) {
      promptMessages = recentHistory;
    }
    delete runtimeBootstrapPending[chatJid];
    logger.info(
      {
        group: group.name,
        fromRuntime: bootstrap.from,
        toRuntime: bootstrap.to,
        historyMessages: promptMessages.length,
      },
      'Bootstrapping runtime switch with recent history',
    );
  }

  const prompt = formatMessages(promptMessages);

  logger.info(
    { group: group.name, messageCount: promptMessages.length },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ group: group.name }, 'Idle timeout, closing container stdin');
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await channel.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    // Streaming output callback — called for each agent result
    if (result.result) {
      const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
      if (text) {
        await channel.sendMessage(chatJid, text);
        outputSentToUser = true;
      }
      // Only reset idle timer on actual results, not session-update markers (result: null)
      resetIdleTimer();
    }

    if (result.status === 'success') {
      queue.notifyIdle(chatJid);
    }

    if (result.status === 'error') {
      hadError = true;
    }
  });

  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn({ group: group.name }, 'Agent error after output was sent, skipping cursor rollback to prevent duplicates');
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn({ group: group.name }, 'Agent error, rolled back message cursor for retry');
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const runtime = getRuntimeForGroup(group.folder);
  const sessionId = getSessionId(group.folder, runtime);
  const model = getModelForGroup(group.folder);

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          setSessionId(group.folder, runtime, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        runtime,
        model,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      setSessionId(group.folder, runtime, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(jids, lastTimestamp, ASSISTANT_NAME);

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) continue;

          const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const hasTrigger = groupMessages.some((m) =>
              TRIGGER_PATTERN.test(m.content.trim()),
            );
            if (!hasTrigger) continue;
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;

          // If a container is already active, handle model commands here and
          // pipe only non-command messages into the running session.
          if (queue.hasActiveContainer(chatJid)) {
            const userMessages = await applyModelCommands(
              messagesToSend,
              group,
              chatJid,
              channel,
            );

            if (userMessages.length === 0) {
              lastAgentTimestamp[chatJid] =
                messagesToSend[messagesToSend.length - 1].timestamp;
              saveState();
              logger.debug(
                { chatJid, count: messagesToSend.length },
                'Processed control command(s) for active container',
              );
              continue;
            }

            const formatted = formatMessages(userMessages);
            if (queue.sendMessage(chatJid, formatted)) {
              lastAgentTimestamp[chatJid] =
                messagesToSend[messagesToSend.length - 1].timestamp;
              saveState();
              logger.debug(
                { chatJid, count: userMessages.length },
                'Piped messages to active container',
              );
              // Show typing indicator while the container processes the piped message
              channel.setTyping?.(chatJid, true)?.catch((err) =>
                logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
              );
            } else {
              // Race: container died after hasActiveContainer check
              queue.enqueueMessageCheck(chatJid);
            }
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}

async function sendStartupGreeting(channelErrors: string[]): Promise<void> {
  const mainEntry = Object.entries(registeredGroups).find(
    ([, g]) => g.folder === MAIN_GROUP_FOLDER,
  );
  if (!mainEntry) return; // fresh install, no main group registered yet

  const [mainJid] = mainEntry;
  const channel = findChannel(channels, mainJid);
  if (!channel) return;

  const msg =
    channelErrors.length > 0
      ? `Started. ⚠️ ${channelErrors.join('; ')}.`
      : 'Started.';

  await channel.sendMessage(mainJid, msg).catch((err) =>
    logger.warn({ err }, 'Failed to send startup greeting'),
  );
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
    onChatMetadata: (chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean) =>
      storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
  };

  // Create and connect channels — failures are non-fatal as long as one channel works
  const channelErrors: string[] = [];

  if (!TELEGRAM_ONLY) {
    whatsapp = new WhatsAppChannel(channelOpts);
    try {
      await whatsapp.connect();
      channels.push(whatsapp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, 'WhatsApp failed to connect — continuing without it');
      channelErrors.push(`WhatsApp: ${msg}`);
    }
  }

  if (TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramChannel(TELEGRAM_BOT_TOKEN, channelOpts);
    try {
      await telegram.connect();
      channels.push(telegram);
      if (TELEGRAM_BOT_POOL.length > 0) {
        await initBotPool(TELEGRAM_BOT_POOL);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, 'Telegram failed to connect — continuing without it');
      channelErrors.push(`Telegram: ${msg}`);
    }
  }

  if (channels.length === 0) {
    logger.fatal({ channelErrors }, 'All channels failed to connect — shutting down');
    process.exit(1);
  }

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    getModelForGroup,
    getRuntimeForGroup,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) => queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) return;
      const text = formatOutbound(rawText);
      if (text) await channel.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroupMetadata: (force) => whatsapp?.syncGroupMetadata(force) ?? Promise.resolve(),
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) => writeGroupsSnapshot(gf, im, ag, rj),
  });
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  await sendStartupGreeting(channelErrors);
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
