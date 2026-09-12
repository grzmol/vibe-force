'use strict';
/**
 * vibe-force hook I/O helpers.
 *
 * Every hook handler is a short-lived node process. Claude Code writes the event
 * payload as JSON on stdin and reads a JSON decision from stdout. Exit code 0
 * with empty stdout means "no opinion".
 *
 * Failure policy: handlers fail open. A crashing hook must never wedge a
 * session, so `main()` wraps the handler and downgrades internal errors to a
 * stderr note. Set VF_DEBUG=1 to see the stack.
 */

const fs = require('node:fs');

const EVENT_KEYS = {
  PreToolUse: 'PreToolUse',
  PostToolUse: 'PostToolUse',
  PostToolUseFailure: 'PostToolUseFailure',
  SessionStart: 'SessionStart',
  UserPromptSubmit: 'UserPromptSubmit',
  Stop: 'Stop',
  SubagentStop: 'SubagentStop',
  PreCompact: 'PreCompact'
};

function readPayload() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_) {
    return {};
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    return { _raw: raw };
  }
}

function emit(payload) {
  if (payload) process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

/** PreToolUse: block the tool call and tell the model why. */
function deny(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: EVENT_KEYS.PreToolUse,
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  });
}

/** PreToolUse: force a human permission prompt. */
function ask(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: EVENT_KEYS.PreToolUse,
      permissionDecision: 'ask',
      permissionDecisionReason: reason
    }
  });
}

/** No decision: normal permission flow applies. */
function pass() {
  process.exit(0);
}

/** Inject text the model will read, without changing permissions. */
function addContext(eventName, text) {
  if (!text) pass();
  emit({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: text
    }
  });
}

/** Stop / SubagentStop: refuse to end the turn and hand back an instruction. */
function block(reason) {
  emit({ decision: 'block', reason });
}

function note(message) {
  process.stderr.write(`[vibe-force] ${message}\n`);
}

function debug(message) {
  if (process.env.VF_DEBUG === '1') process.stderr.write(`[vibe-force:debug] ${message}\n`);
}

/**
 * Normalises the fields hook handlers actually use across events.
 */
function facts(payload) {
  const input = payload.tool_input || {};
  return {
    event: payload.hook_event_name || '',
    session: payload.session_id || 'unknown',
    cwd: payload.cwd || process.cwd(),
    projectDir: payload.project_dir || process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(),
    tool: payload.tool_name || '',
    agentId: payload.agent_id || '',
    agentType: payload.agent_type || '',
    command: typeof input.command === 'string' ? input.command : '',
    filePath: input.file_path || input.notebook_path || input.path || '',
    content: typeof input.content === 'string' ? input.content : typeof input.new_string === 'string' ? input.new_string : '',
    input,
    payload
  };
}

/**
 * Runs a handler with fail-open semantics.
 * @param {(f: ReturnType<typeof facts>) => void} handler
 */
function main(handler) {
  let f;
  try {
    f = facts(readPayload());
  } catch (err) {
    debug(`payload parse failed: ${err && err.stack}`);
    process.exit(0);
  }
  try {
    handler(f);
  } catch (err) {
    if (err && err.__vfExit) throw err;
    debug(`handler failed: ${err && err.stack}`);
    note(`hook handler error (ignored): ${err && err.message}`);
  }
  process.exit(0);
}

module.exports = { EVENT_KEYS, readPayload, emit, deny, ask, pass, addContext, block, note, debug, facts, main };
