import { z } from 'zod';
import { ChannelTypeSchema } from './config';

/**
 * Participant address type for different communication channels
 */
export const ParticipantAddressTypeSchema = z.enum([
  'VOICE',
  'SMS',
  'RCS',
  'EMAIL',
  'WHATSAPP',
  'CHAT',
  'API',
  'SYSTEM',
]);
export type ParticipantAddressType = z.infer<typeof ParticipantAddressTypeSchema>;

/**
 * Participant address containing channel and address (snake_case format)
 */
export const ParticipantAddressSchema = z.object({
  channel: ParticipantAddressTypeSchema,
  address: z.string().min(1, 'Address is required'),
  channel_id: z.string().nullable().optional(),
});

export type ParticipantAddress = z.infer<typeof ParticipantAddressSchema>;

/**
 * Communication participant for Conversations Service API.
 *
 * Note: participant_id is required for SDK validation when creating communications.
 */
export const CommunicationParticipantSchema = z.object({
  address: z.string().max(254),
  channel: ParticipantAddressTypeSchema,
  participant_id: z.string(),
  delivery_status: z
    .enum(['INITIATED', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED', 'FAILED'])
    .optional(),
});

export type CommunicationParticipant = z.infer<typeof CommunicationParticipantSchema>;

/**
 * Word-level transcription data with timing information.
 */
export const TranscriptionWordSchema = z.object({
  text: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

export type TranscriptionWord = z.infer<typeof TranscriptionWordSchema>;

/**
 * Transcription metadata for communication content.
 */
export const TranscriptionSchema = z.object({
  channel: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
  engine: z.string().optional(),
  words: z.array(TranscriptionWordSchema).optional(),
});

export type Transcription = z.infer<typeof TranscriptionSchema>;

/**
 * Communication content (ContentText or ContentTranscription).
 *
 * Note: In Conversations API, both `type` and `text` are required fields.
 */
export const CommunicationContentSchema = z.object({
  type: z.enum(['TEXT', 'TRANSCRIPTION']),
  text: z.string().max(8388608),
  transcription: TranscriptionSchema.optional(),
});

export type CommunicationContent = z.infer<typeof CommunicationContentSchema>;

/**
 * Communication from Conversations Service API.
 *
 * Note: `created_at` is optional per API spec.
 */
export const CommunicationSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  account_id: z.string(),
  author: CommunicationParticipantSchema,
  content: CommunicationContentSchema,
  recipients: z.array(CommunicationParticipantSchema),
  channel_id: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type Communication = z.infer<typeof CommunicationSchema>;

/**
 * Author information for a conversation session
 */
export const AuthorInfoSchema = z.object({
  address: z.string(),
  participant_id: z.string().optional(),
});

export type AuthorInfo = z.infer<typeof AuthorInfoSchema>;

/**
 * Profile information for a conversation participant
 */
export const ProfileSchema = z.object({
  profile_id: z.string(),
  traits: z.record(z.unknown()).optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;

/**
 * Conversation session context
 */
export const ConversationSessionSchema = z.object({
  conversation_id: z.string().min(1, 'Conversation ID is required'),
  profile_id: z.string().optional(),
  service_id: z.string().optional(),
  channel: ChannelTypeSchema,
  started_at: z.date(),
  author_info: AuthorInfoSchema.optional(),
  profile: ProfileSchema.optional(),
  metadata: z.record(z.unknown()).optional().default({}),
});

export type ConversationSession = z.infer<typeof ConversationSessionSchema>;

/**
 * Branded types for type safety
 */
export type ConversationId = string & { readonly _brand: 'ConversationId' };
export type ProfileId = string & { readonly _brand: 'ProfileId' };
export type ParticipantId = string & { readonly _brand: 'ParticipantId' };

/**
 * Type guards for branded types
 */
export function isConversationId(value: string): value is ConversationId {
  return value.length > 0;
}

export function isProfileId(value: string): value is ProfileId {
  return value.length > 0;
}

export function isParticipantId(value: string): value is ParticipantId {
  return value.length > 0;
}

/**
 * Conversation response from Conversations Service API
 */
export const ConversationResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  status: z.string().optional(),
  name: z.string().nullish(), // API returns null when not set
  configurationId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ConversationResponse = z.infer<typeof ConversationResponseSchema>;

/**
 * Participant address from Conversations Service API (camelCase format)
 */
export const ConversationAddressSchema = z.object({
  channel: ParticipantAddressTypeSchema,
  address: z.string(),
  channelId: z.string().nullish(), // API returns null when not set
});

export type ConversationAddress = z.infer<typeof ConversationAddressSchema>;

/**
 * Participant response from Conversations Service API
 */
export const ConversationParticipantSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  accountId: z.string(),
  name: z.string().optional(),
  type: z.enum(['HUMAN_AGENT', 'CUSTOMER', 'AI_AGENT']).optional(),
  profileId: z.string().nullable().optional(),
  addresses: z.array(ConversationAddressSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ConversationParticipant = z.infer<typeof ConversationParticipantSchema>;

/**
 * Communication resource data from COMMUNICATION_CREATED/UPDATED webhook events.
 * Matches the Conversations API Communication resource structure (camelCase).
 */
export const ConversationsCommunicationDataSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  accountId: z.string(),
  author: z.object({
    address: z.string(),
    channel: z.string(),
    participantId: z.string().optional(),
  }),
  content: z.object({
    type: z.enum(['TEXT', 'TRANSCRIPTION']),
    text: z.string(),
    transcription: z.object({}).passthrough().optional(),
  }),
  recipients: z.array(
    z.object({
      address: z.string(),
      channel: z.string(),
      participantId: z.string().optional(),
      deliveryStatus: z.string().optional(),
    })
  ),
  channelId: z.string().optional(),
  serviceId: z.string().optional(), // Legacy/forward compatibility
  profileId: z.string().optional(), // May be included for cross-event compatibility
  participantType: z.string().optional(), // May be included for cross-event compatibility
  status: z.enum(['ACTIVE', 'INACTIVE', 'CLOSED']).optional(), // May be included for cross-event compatibility
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ConversationsCommunicationData = z.infer<typeof ConversationsCommunicationDataSchema>;

/**
 * Conversation resource data from CONVERSATION_CREATED/UPDATED webhook events.
 * Matches the Conversations API Conversation resource structure (camelCase).
 *
 * Note: For Conversation events, the conversation ID is in the `id` field.
 * The conversationId field is optional on input and defaults to id for type consistency.
 */
export const ConversationsConversationDataSchema = z
  .object({
    id: z.string(),
    conversationId: z.string().optional(), // Optional on input; will default to id
    accountId: z.string(),
    configurationId: z.string(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'CLOSED']).optional(),
    name: z.string().nullable().optional(),
    serviceId: z.string().optional(), // Legacy/forward compatibility
    profileId: z.string().optional(), // Profile ID may be included in conversation events
    participantType: z.string().optional(), // May be included for cross-event compatibility
    // Communication-specific fields (optional for cross-event compatibility)
    author: z
      .object({
        address: z.string(),
        channel: z.string(),
        participantId: z.string().optional(),
      })
      .optional(),
    content: z
      .object({
        type: z.enum(['TEXT', 'TRANSCRIPTION']),
        text: z.string(),
        transcription: z.object({}).passthrough().optional(),
      })
      .optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .transform(data => ({
    ...data,
    conversationId: data.conversationId ?? data.id,
  }));

export type ConversationsConversationData = z.infer<typeof ConversationsConversationDataSchema>;

/**
 * Participant resource data from PARTICIPANT_ADDED/UPDATED/REMOVED webhook events.
 * Matches the Conversations API Participant resource structure (camelCase).
 */
export const ConversationsParticipantDataSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  accountId: z.string(),
  name: z.string(),
  type: z.enum(['HUMAN_AGENT', 'CUSTOMER', 'AI_AGENT']).optional(),
  participantType: z.string().optional(), // Legacy field name (same as 'type')
  profileId: z.string().optional(),
  serviceId: z.string().optional(), // Legacy/forward compatibility
  addresses: z
    .array(
      z.object({
        channel: z.string(),
        address: z.string(),
        channelId: z.string().optional(),
      })
    )
    .optional(),
  // Communication-specific fields (optional for cross-event compatibility)
  author: z
    .object({
      address: z.string(),
      channel: z.string(),
      participantId: z.string().optional(),
    })
    .optional(),
  content: z
    .object({
      type: z.enum(['TEXT', 'TRANSCRIPTION']),
      text: z.string(),
      transcription: z.object({}).passthrough().optional(),
    })
    .optional(),
  // Conversation-specific fields (optional for cross-event compatibility)
  status: z.enum(['ACTIVE', 'INACTIVE', 'CLOSED']).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ConversationsParticipantData = z.infer<typeof ConversationsParticipantDataSchema>;

/**
 * Communication webhook payload (COMMUNICATION_CREATED/UPDATED events)
 */
export const CommunicationWebhookPayloadSchema = z.object({
  eventType: z.enum(['COMMUNICATION_CREATED', 'COMMUNICATION_UPDATED']),
  timestamp: z.string().optional(),
  data: ConversationsCommunicationDataSchema,
});

export type CommunicationWebhookPayload = z.infer<typeof CommunicationWebhookPayloadSchema>;

/**
 * Conversation webhook payload (CONVERSATION_CREATED/UPDATED events)
 */
export const ConversationWebhookPayloadSchema = z.object({
  eventType: z.enum(['CONVERSATION_CREATED', 'CONVERSATION_UPDATED']),
  timestamp: z.string().optional(),
  data: ConversationsConversationDataSchema,
});

export type ConversationWebhookPayload = z.infer<typeof ConversationWebhookPayloadSchema>;

/**
 * Participant webhook payload (PARTICIPANT_ADDED/UPDATED/REMOVED events)
 */
export const ParticipantWebhookPayloadSchema = z.object({
  eventType: z.enum(['PARTICIPANT_ADDED', 'PARTICIPANT_UPDATED', 'PARTICIPANT_REMOVED']),
  timestamp: z.string().optional(),
  data: ConversationsParticipantDataSchema,
});

export type ParticipantWebhookPayload = z.infer<typeof ParticipantWebhookPayloadSchema>;

/**
 * Conversations webhook payload - discriminated union based on event type.
 *
 * Different webhook events send different resource types in the `data` field:
 * - COMMUNICATION_CREATED/UPDATED → Communication resource
 * - CONVERSATION_CREATED/UPDATED → Conversation resource
 * - PARTICIPANT_ADDED/UPDATED/REMOVED → Participant resource
 *
 * TypeScript automatically narrows the `data` type based on `eventType` checks,
 * eliminating the need for optional chaining and providing full type safety.
 */
export const ConversationsWebhookPayloadSchema = z.discriminatedUnion('eventType', [
  CommunicationWebhookPayloadSchema,
  ConversationWebhookPayloadSchema,
  ParticipantWebhookPayloadSchema,
]);

export type ConversationsWebhookPayload = z.infer<typeof ConversationsWebhookPayloadSchema>;
