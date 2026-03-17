import type { ConversationsWebhookPayload } from '../types/conversation';

/**
 * Extracts the channel identifier from a Conversations webhook payload.
 *
 * Tries multiple strategies:
 * 1. author.channel (COMMUNICATION_* events)
 * 2. addresses[0].channel (PARTICIPANT_* events)
 *
 * @param webhookData - The webhook payload data
 * @returns Lowercase channel string ('sms', 'voice') or undefined
 */
export function extractChannelFromWebhook(
  webhookData: ConversationsWebhookPayload['data']
): string | undefined {
  // Try author.channel first (COMMUNICATION_* events)
  if ('author' in webhookData && webhookData.author?.channel) {
    return webhookData.author.channel.toLowerCase();
  }

  // Try addresses array (PARTICIPANT_* events)
  if ('addresses' in webhookData && Array.isArray(webhookData.addresses)) {
    const addresses = webhookData.addresses;
    if (addresses.length > 0 && addresses[0]?.channel) {
      return addresses[0].channel.toLowerCase();
    }
  }

  return undefined;
}
