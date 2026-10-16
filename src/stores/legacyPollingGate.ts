/**
 * Whether the legacy stores may talk to the bots on their own. True only while a legacy tool page
 * is on screen (see `initBots` and `suspendBots` in `ftbotwrapper.ts`). A module of its own because
 * the per-bot store (which opens the bot socket) cannot import the wrapper that imports it.
 *
 * The gate is what stops the chains already in flight when the user leaves a legacy page: a batch
 * that was waiting on a slow bot used to go on with the next batches, and a `/show_config` answered
 * after the suspend opened the bot socket, behind the gateway's back.
 */
let allowed = false;

export function legacyPollingAllowed(): boolean {
  return allowed;
}

export function setLegacyPollingAllowed(value: boolean): void {
  allowed = value;
}
