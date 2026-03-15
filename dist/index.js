import { z } from 'zod';
export { z } from 'zod';
import pino from 'pino';
import { Buffer as Buffer$1 } from 'buffer';
import * as util from 'util';
import { promisify } from 'util';
import * as crypto2 from 'crypto';
import { createPrivateKey, createSecretKey, KeyObject, constants } from 'crypto';
import twilio from 'twilio';
import { WebSocket } from 'ws';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import gracefulShutdown from 'fastify-graceful-shutdown';

// packages/core/src/types/tac.ts
var EnvironmentSchema = z.enum(["dev", "stage", "prod"]).default("prod");
var ChannelTypeSchema = z.enum(["sms", "voice"]);
var ProfileServiceProviderSchema = z.enum(["segment", "memora"]);
var TACConfigSchema = z.object({
  environment: EnvironmentSchema,
  twilioAccountSid: z.string().min(1, "Twilio Account SID is required"),
  twilioAuthToken: z.string().min(1, "Twilio Auth Token is required"),
  apiKey: z.string().min(1, "API Key is required"),
  apiToken: z.string().min(1, "API Token is required"),
  twilioPhoneNumber: z.string().min(1, "Twilio Phone Number is required"),
  // Profile service provider (segment or memora)
  profileServiceProvider: ProfileServiceProviderSchema.optional(),
  // Segment configuration (for segment profile service)
  segmentWriteKey: z.string().optional(),
  segmentSpaceId: z.string().optional(),
  segmentAccessToken: z.string().optional(),
  segmentUnifyToken: z.string().optional(),
  // Memora configuration (for memora profile service)
  memoryStoreId: z.string().regex(/^mem_(service|store)_[0-9a-z]{26}$/, "Invalid Memory Store ID format").optional(),
  traitGroups: z.array(z.string()).optional(),
  conversationServiceId: z.string().regex(
    /^(comms_service|conv_configuration)_[0-9a-z]{26}$/,
    "Invalid Conversation Configuration ID format"
  ),
  voicePublicDomain: z.string().url().optional(),
  cintelConfigurationId: z.string().optional(),
  cintelObservationOperatorSid: z.string().optional(),
  cintelSummaryOperatorSid: z.string().optional()
});
var WebhookPathsSchema = z.object({
  twiml: z.string().optional(),
  ws: z.string().optional(),
  conversation: z.string().optional(),
  conversationRelayCallback: z.string().optional(),
  cintel: z.string().optional()
});
var EnvironmentVariables = {
  ENVIRONMENT: "ENVIRONMENT",
  TWILIO_ACCOUNT_SID: "TWILIO_ACCOUNT_SID",
  TWILIO_AUTH_TOKEN: "TWILIO_AUTH_TOKEN",
  TWILIO_API_KEY: "TWILIO_API_KEY",
  TWILIO_API_TOKEN: "TWILIO_API_TOKEN",
  TWILIO_PHONE_NUMBER: "TWILIO_PHONE_NUMBER",
  // Profile service configuration
  PROFILE_SERVICE_PROVIDER: "PROFILE_SERVICE_PROVIDER",
  // Segment configuration
  SEGMENT_WRITE_KEY: "SEGMENT_WRITE_KEY",
  SEGMENT_SPACE_ID: "SEGMENT_SPACE_ID",
  SEGMENT_ACCESS_TOKEN: "SEGMENT_ACCESS_TOKEN",
  SEGMENT_UNIFY_TOKEN: "SEGMENT_UNIFY_TOKEN",
  // Memora configuration
  MEMORY_STORE_ID: "MEMORY_STORE_ID",
  TRAIT_GROUPS: "TRAIT_GROUPS",
  CONVERSATION_SERVICE_ID: "CONVERSATION_SERVICE_ID",
  VOICE_PUBLIC_DOMAIN: "VOICE_PUBLIC_DOMAIN",
  TWILIO_TAC_CI_CONFIGURATION_ID: "TWILIO_TAC_CI_CONFIGURATION_ID",
  TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID: "TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID",
  TWILIO_TAC_CI_SUMMARY_OPERATOR_SID: "TWILIO_TAC_CI_SUMMARY_OPERATOR_SID"
};
function computeServiceUrls(environment) {
  const baseUrls = {
    dev: {
      memoryApiUrl: "https://memory.dev-us1.twilio.com",
      conversationsApiUrl: "https://conversations.dev-us1.twilio.com",
      knowledgeApiUrl: "https://knowledge.dev.twilio.com"
    },
    stage: {
      memoryApiUrl: "https://memory.stage-us1.twilio.com",
      conversationsApiUrl: "https://conversations.stage-us1.twilio.com",
      knowledgeApiUrl: "https://knowledge.stage.twilio.com"
    },
    prod: {
      memoryApiUrl: "https://memory.twilio.com",
      conversationsApiUrl: "https://conversations.twilio.com",
      knowledgeApiUrl: "https://knowledge.twilio.com"
    }
  };
  return baseUrls[environment];
}
var VoiceServerConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.number().int().positive().default(3e3)
});

// packages/core/src/types/conversation.ts
var ParticipantAddressTypeSchema = z.enum([
  "VOICE",
  "SMS",
  "RCS",
  "EMAIL",
  "WHATSAPP",
  "CHAT",
  "API",
  "SYSTEM"
]);
var ParticipantAddressSchema = z.object({
  channel: ParticipantAddressTypeSchema,
  address: z.string().min(1, "Address is required"),
  channel_id: z.string().nullable().optional()
});
var CommunicationParticipantSchema = z.object({
  address: z.string().max(254),
  channel: ParticipantAddressTypeSchema,
  participant_id: z.string(),
  delivery_status: z.enum(["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]).optional()
});
var TranscriptionWordSchema = z.object({
  text: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional()
});
var TranscriptionSchema = z.object({
  channel: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
  engine: z.string().optional(),
  words: z.array(TranscriptionWordSchema).optional()
});
var CommunicationContentSchema = z.object({
  type: z.enum(["TEXT", "TRANSCRIPTION"]),
  text: z.string().max(8388608),
  transcription: TranscriptionSchema.optional()
});
var CommunicationSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  account_id: z.string(),
  author: CommunicationParticipantSchema,
  content: CommunicationContentSchema,
  recipients: z.array(CommunicationParticipantSchema),
  channel_id: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});
var AuthorInfoSchema = z.object({
  address: z.string(),
  participant_id: z.string().optional()
});
var ProfileSchema = z.object({
  profile_id: z.string(),
  traits: z.record(z.unknown()).optional()
});
var ConversationSessionSchema = z.object({
  conversation_id: z.string().min(1, "Conversation ID is required"),
  profile_id: z.string().optional(),
  service_id: z.string().optional(),
  channel: ChannelTypeSchema,
  started_at: z.date(),
  author_info: AuthorInfoSchema.optional(),
  profile: ProfileSchema.optional(),
  metadata: z.record(z.unknown()).optional().default({})
});
function isConversationId(value) {
  return value.length > 0;
}
function isProfileId(value) {
  return value.length > 0;
}
function isParticipantId(value) {
  return value.length > 0;
}
var ConversationResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  status: z.string().optional(),
  name: z.string().nullish(),
  // API returns null when not set
  configurationId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
var ConversationAddressSchema = z.object({
  channel: ParticipantAddressTypeSchema,
  address: z.string(),
  channelId: z.string().nullish()
  // API returns null when not set
});
var ConversationParticipantSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  accountId: z.string(),
  name: z.string().optional(),
  type: z.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]).optional(),
  profileId: z.string().nullable().optional(),
  addresses: z.array(ConversationAddressSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
var ConversationsCommunicationDataSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  accountId: z.string(),
  author: z.object({
    address: z.string(),
    channel: z.string(),
    participantId: z.string().optional()
  }),
  content: z.object({
    type: z.enum(["TEXT", "TRANSCRIPTION"]),
    text: z.string(),
    transcription: z.object({}).passthrough().optional()
  }),
  recipients: z.array(
    z.object({
      address: z.string(),
      channel: z.string(),
      participantId: z.string().optional(),
      deliveryStatus: z.string().optional()
    })
  ),
  channelId: z.string().optional(),
  serviceId: z.string().optional(),
  // Legacy/forward compatibility
  profileId: z.string().optional(),
  // May be included for cross-event compatibility
  participantType: z.string().optional(),
  // May be included for cross-event compatibility
  status: z.enum(["ACTIVE", "INACTIVE", "CLOSED"]).optional(),
  // May be included for cross-event compatibility
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish()
});
var ConversationsConversationDataSchema = z.object({
  id: z.string(),
  conversationId: z.string().optional(),
  // Optional on input; will default to id
  accountId: z.string(),
  configurationId: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE", "CLOSED"]).optional(),
  name: z.string().nullable().optional(),
  serviceId: z.string().optional(),
  // Legacy/forward compatibility
  profileId: z.string().nullish(),
  // Profile ID may be included in conversation events (can be null)
  participantType: z.string().optional(),
  // May be included for cross-event compatibility
  // Communication-specific fields (optional for cross-event compatibility)
  author: z.object({
    address: z.string(),
    channel: z.string(),
    participantId: z.string().optional()
  }).optional(),
  content: z.object({
    type: z.enum(["TEXT", "TRANSCRIPTION"]),
    text: z.string(),
    transcription: z.object({}).passthrough().optional()
  }).optional(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish()
}).transform((data) => ({
  ...data,
  conversationId: data.conversationId ?? data.id
}));
var ConversationsParticipantDataSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  accountId: z.string(),
  name: z.string(),
  type: z.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]).optional(),
  participantType: z.string().optional(),
  // Legacy field name (same as 'type')
  profileId: z.string().nullish(),
  // Can be null in some webhook events
  serviceId: z.string().optional(),
  // Legacy/forward compatibility
  addresses: z.array(
    z.object({
      channel: z.string(),
      address: z.string(),
      channelId: z.string().nullish()
    })
  ).optional(),
  // Communication-specific fields (optional for cross-event compatibility)
  author: z.object({
    address: z.string(),
    channel: z.string(),
    participantId: z.string().optional()
  }).optional(),
  content: z.object({
    type: z.enum(["TEXT", "TRANSCRIPTION"]),
    text: z.string(),
    transcription: z.object({}).passthrough().optional()
  }).optional(),
  // Conversation-specific fields (optional for cross-event compatibility)
  status: z.enum(["ACTIVE", "INACTIVE", "CLOSED"]).optional(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish()
});
var CommunicationWebhookPayloadSchema = z.object({
  eventType: z.enum(["COMMUNICATION_CREATED", "COMMUNICATION_UPDATED"]),
  timestamp: z.string().optional(),
  data: ConversationsCommunicationDataSchema
});
var ConversationWebhookPayloadSchema = z.object({
  eventType: z.enum(["CONVERSATION_CREATED", "CONVERSATION_UPDATED"]),
  timestamp: z.string().optional(),
  data: ConversationsConversationDataSchema
});
var ParticipantWebhookPayloadSchema = z.object({
  eventType: z.enum(["PARTICIPANT_ADDED", "PARTICIPANT_UPDATED", "PARTICIPANT_REMOVED"]),
  timestamp: z.string().optional(),
  data: ConversationsParticipantDataSchema
});
var ConversationsWebhookPayloadSchema = z.discriminatedUnion("eventType", [
  CommunicationWebhookPayloadSchema,
  ConversationWebhookPayloadSchema,
  ParticipantWebhookPayloadSchema
]);

// packages/core/src/types/tac.ts
var TACChannelTypeSchema = z.enum([
  "VOICE",
  "SMS",
  "RCS",
  "EMAIL",
  "WHATSAPP",
  "CHAT",
  "API",
  "SYSTEM"
]);
var TACDeliveryStatusSchema = z.enum([
  "INITIATED",
  "IN_PROGRESS",
  "DELIVERED",
  "COMPLETED",
  "FAILED"
]);
var TACParticipantTypeSchema = z.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]);
var TACCommunicationAuthorSchema = z.object({
  // Common fields (both APIs)
  address: z.string(),
  channel: TACChannelTypeSchema,
  // Conversations API-only fields
  participant_id: z.string().optional(),
  delivery_status: TACDeliveryStatusSchema.optional(),
  // Memory-only fields
  id: z.string().optional(),
  name: z.string().optional(),
  type: TACParticipantTypeSchema.optional(),
  profile_id: z.string().optional()
});
var TACCommunicationContentSchema = z.object({
  // Conversations API-only: content type discriminator
  type: z.enum(["TEXT", "TRANSCRIPTION"]).optional(),
  // Both APIs: message text (optional in unified model to handle both)
  text: z.string().optional(),
  // Conversations API-only: transcription metadata
  transcription: TranscriptionSchema.optional()
});
var TACCommunicationSchema = z.object({
  // Common fields (both APIs)
  id: z.string(),
  author: TACCommunicationAuthorSchema,
  content: TACCommunicationContentSchema,
  recipients: z.array(TACCommunicationAuthorSchema).default([]),
  channel_id: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  // Conversations API-only fields
  conversation_id: z.string().optional(),
  account_id: z.string().optional()
});

// packages/core/src/lib/tac-memory-response.ts
function isMemoryRetrievalResponse(data) {
  return !Array.isArray(data);
}
var TACMemoryResponse = class {
  _data;
  _communications;
  /**
   * Initialize wrapper with either Memory or Conversations API data.
   *
   * @param data - Either MemoryRetrievalResponse (Memory) or Communication[] (Conversations API)
   */
  constructor(data) {
    this._data = data;
    if (isMemoryRetrievalResponse(data)) {
      this._communications = (data.communications ?? []).map(
        (comm) => TACCommunicationSchema.parse(comm)
      );
    } else {
      this._communications = data.map((comm) => TACCommunicationSchema.parse(comm));
    }
  }
  /**
   * Get observation memories.
   *
   * @returns List of observations if Memory is configured, empty array for Conversations API fallback
   */
  get observations() {
    if (isMemoryRetrievalResponse(this._data)) {
      return this._data.observations;
    }
    return [];
  }
  /**
   * Get summary memories.
   *
   * @returns List of summaries if Memory is configured, empty array for Conversations API fallback
   */
  get summaries() {
    if (isMemoryRetrievalResponse(this._data)) {
      return this._data.summaries;
    }
    return [];
  }
  /**
   * Get communications in unified format with all available fields.
   *
   * Communications are converted to a common format during initialization that includes
   * all fields from both Memory and Conversations API. Fields not available from a particular
   * API will be undefined.
   *
   * @returns List of unified communications with all available fields
   */
  get communications() {
    return this._communications;
  }
  /**
   * Check if Memory API is configured and providing full features.
   *
   * @returns true if Memory is configured (observations/summaries available),
   *          false if using Conversations API fallback (only communications available)
   */
  get hasMemoryFeatures() {
    return isMemoryRetrievalResponse(this._data);
  }
  /**
   * Access raw underlying data for advanced use cases.
   *
   * Use this when you need access to all fields from the original API responses,
   * not just the unified common fields.
   *
   * @returns Either MemoryRetrievalResponse or Communication[] depending on configuration
   */
  get rawData() {
    return this._data;
  }
};
var MessageDirectionSchema = z.enum(["inbound", "outbound"]);
var MemoryChannelTypeSchema = z.enum([
  "VOICE",
  "SMS",
  "RCS",
  "EMAIL",
  "WHATSAPP",
  "CHAT",
  "API",
  "SYSTEM"
]);
var MemoryParticipantTypeSchema = z.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]);
var MemoryDeliveryStatusSchema = z.enum([
  "INITIATED",
  "IN_PROGRESS",
  "DELIVERED",
  "COMPLETED",
  "FAILED"
]);
var MemoryParticipantSchema = z.object({
  id: z.string(),
  name: z.string().max(256),
  address: z.string().max(254),
  channel: MemoryChannelTypeSchema,
  type: MemoryParticipantTypeSchema.optional(),
  profile_id: z.string().optional(),
  delivery_status: MemoryDeliveryStatusSchema.optional()
});
var MemoryCommunicationContentSchema = z.object({
  text: z.string().max(8388608).optional()
});
var MemoryCommunicationSchema = z.object({
  id: z.string(),
  author: MemoryParticipantSchema,
  content: MemoryCommunicationContentSchema,
  recipients: z.array(MemoryParticipantSchema).max(100),
  channel_id: z.string().max(256).optional(),
  created_at: z.string(),
  updated_at: z.string().optional()
});
var SessionMessageSchema = z.object({
  direction: MessageDirectionSchema,
  channel: z.string(),
  from_address: z.string().optional(),
  to_address: z.string().optional(),
  content: z.string(),
  timestamp: z.string().datetime()
});
var SessionInfoSchema = z.object({
  session_id: z.string(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
  channel: z.string(),
  messages: z.array(SessionMessageSchema)
});
var ObservationInfoSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
  occurredAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  conversationIds: z.array(z.string()).nullable().optional(),
  source: z.string().optional()
});
var SummaryInfoSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  conversationIds: z.array(z.string()).optional()
});
var MemoryRetrievalRequestSchema = z.object({
  query: z.string().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  observation_limit: z.number().int().positive().optional().default(10),
  summary_limit: z.number().int().positive().optional().default(5),
  session_limit: z.number().int().positive().optional().default(3)
});
var MemoryRetrievalResponseSchema = z.object({
  observations: z.array(ObservationInfoSchema),
  summaries: z.array(SummaryInfoSchema),
  communications: z.array(MemoryCommunicationSchema).optional().default([]),
  meta: z.object({
    queryTime: z.number().optional()
  }).optional()
});
var ProfileLookupResponseSchema = z.object({
  normalizedValue: z.string().max(255),
  profiles: z.array(z.string()).max(100)
});
var ProfileResponseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  traits: z.record(z.unknown())
});
var EMPTY_MEMORY_RESPONSE = {
  observations: [],
  summaries: [],
  communications: []
};
var CreateObservationResponseSchema = z.object({
  content: z.string(),
  source: z.string(),
  occurredAt: z.string(),
  conversationIds: z.array(z.string())
});
var CreateConversationSummariesResponseSchema = z.object({
  message: z.string()
});
var LanguageAttributesSchema = z.object({
  /** Language code (e.g., 'en-US', 'es-ES', 'en-AU') */
  code: z.string(),
  /** TTS provider for this language */
  ttsProvider: z.string().optional(),
  /** TTS voice for this language */
  voice: z.string().optional(),
  /** TTS language (may differ from code) */
  ttsLanguage: z.string().optional(),
  /** Transcription provider for this language */
  transcriptionProvider: z.string().optional(),
  /** Speech model for transcription */
  speechModel: z.string().optional(),
  /** Transcription language (may differ from code) */
  transcriptionLanguage: z.string().optional()
});
var ConversationRelayAttributesSchema = z.object({
  /** WebSocket URL for ConversationRelay (required) */
  url: z.string().url(),
  // Welcome greeting settings
  /** Initial greeting to play when call connects */
  welcomeGreeting: z.string().optional(),
  /** Whether welcome greeting can be interrupted */
  welcomeGreetingInterruptible: z.enum(["any", "speech", "none"]).optional(),
  // Transcription settings
  /** Transcription provider (e.g., 'Deepgram', 'Google') */
  transcriptionProvider: z.string().optional(),
  /** Language for transcription (e.g., 'en-US') */
  transcriptionLanguage: z.string().optional(),
  /** Speech model for transcription (e.g., 'nova-3-general') */
  speechModel: z.string().optional(),
  // TTS settings
  /** Text-to-speech provider (e.g., 'Google', 'ElevenLabs') */
  ttsProvider: z.string().optional(),
  /** Language for TTS (e.g., 'en-US') */
  ttsLanguage: z.string().optional(),
  /** Voice identifier for TTS (e.g., 'en-US-Journey-O') */
  voice: z.string().optional(),
  /** ElevenLabs text normalization setting */
  elevenlabsTextNormalization: z.string().optional(),
  // Interaction settings
  /** When agent speech can be interrupted */
  interruptible: z.enum(["any", "speech", "none"]).optional(),
  /** Interrupt detection sensitivity */
  interruptSensitivity: z.enum(["low", "medium", "high"]).optional(),
  /** Enable DTMF tone detection */
  dtmfDetection: z.boolean().optional(),
  /** Recognition hints for domain-specific vocabulary */
  hints: z.string().optional(),
  /** Whether prompts should be reported when TTS is playing and interrupt is disabled */
  reportInputDuringAgentSpeech: z.boolean().optional(),
  // Advanced settings
  /** Enable partial prompts (streaming) */
  partialPrompts: z.boolean().optional(),
  /** Enable profanity filtering */
  profanityFilter: z.boolean().optional(),
  /** Allow preemption of agent speech */
  preemptible: z.boolean().optional(),
  /** Default language code */
  language: z.string().optional(),
  /** Debug options for troubleshooting (string per SDK, not boolean) */
  debug: z.string().optional(),
  // Intelligence service
  /** Conversational Intelligence Service ID or unique name */
  intelligenceService: z.string().optional()
});
var CustomParametersSchema = z.object({
  conversation_id: z.string().optional(),
  profile_id: z.string().optional(),
  customer_participant_id: z.string().optional(),
  ai_agent_participant_id: z.string().optional()
});
var SetupMessageSchema = z.object({
  type: z.literal("setup"),
  sessionId: z.string(),
  callSid: z.string(),
  parentCallSid: z.string().optional(),
  from: z.string(),
  to: z.string(),
  forwardedFrom: z.string().optional(),
  callerName: z.string().optional(),
  direction: z.string(),
  callType: z.string(),
  callStatus: z.string(),
  accountSid: z.string(),
  customParameters: z.record(z.unknown()).optional()
});
var PromptMessageSchema = z.object({
  type: z.literal("prompt"),
  voicePrompt: z.string(),
  lang: z.string().optional(),
  last: z.boolean().optional(),
  agentSpeaking: z.string().optional()
});
var InterruptMessageSchema = z.object({
  type: z.literal("interrupt"),
  reason: z.string().optional(),
  transcript: z.string().optional()
});
var WebSocketMessageSchema = z.union([
  SetupMessageSchema,
  PromptMessageSchema,
  InterruptMessageSchema
]);
var TextTokenMessageSchema = z.object({
  type: z.literal("text"),
  token: z.string(),
  last: z.boolean().optional().default(true)
});
var ConversationRelayConfigSchema = ConversationRelayAttributesSchema.extend({
  /** Optional language configurations as child <Language> elements */
  languages: z.array(LanguageAttributesSchema).optional()
});
var ConversationRelayCallbackPayloadSchema = z.object({
  // Core Twilio identifiers (required)
  AccountSid: z.string(),
  CallSid: z.string(),
  /** Call status with strict type checking for all valid Twilio call states */
  CallStatus: z.enum([
    "queued",
    "initiated",
    "ringing",
    "in-progress",
    "completed",
    "busy",
    "no-answer",
    "failed",
    "canceled"
  ]),
  // Call participants (required)
  From: z.string(),
  To: z.string(),
  /** Direction of the call */
  Direction: z.enum(["inbound", "outbound-api", "outbound-dial"]),
  // Standard voice webhook parameters (optional)
  ApiVersion: z.string().optional(),
  ForwardedFrom: z.string().optional(),
  CallerName: z.string().optional(),
  ParentCallSid: z.string().optional(),
  ApplicationSid: z.string().optional(),
  // ConversationRelay session information (optional)
  SessionId: z.string().optional(),
  SessionStatus: z.string().optional(),
  SessionDuration: z.string().optional(),
  HandoffData: z.string().optional()
  // JSON string
});
var HandoffDataSchema = z.object({
  reason: z.string(),
  call_summary: z.string(),
  sentiment: z.string()
});
var JSONSchemaSchema = z.object({
  type: z.enum(["object", "string", "number", "boolean", "array"]),
  properties: z.record(z.any()).optional(),
  required: z.array(z.string()).optional(),
  items: z.any().optional(),
  enum: z.array(z.any()).optional(),
  description: z.string().optional()
});
var OpenAIToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string(),
    parameters: JSONSchemaSchema
  })
});
z.object({
  conversationId: z.string().optional(),
  profileId: z.string().optional(),
  channel: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});
var ToolExecutionResultSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});
var BuiltInTools = {
  RETRIEVE_MEMORY: "retrieve_profile_memory",
  SEND_MESSAGE: "send_message",
  ESCALATE_TO_HUMAN: "escalate_to_human",
  SEARCH_KNOWLEDGE: "search_knowledge"
};
var CintelParticipantSchema = z.object({
  type: z.string(),
  profileId: z.string().optional(),
  mediaParticipantId: z.string().optional()
});
var ExecutionDetailsSchema = z.object({
  participants: z.array(CintelParticipantSchema).optional()
});
var OperatorSchema = z.object({
  id: z.string(),
  name: z.string().optional()
});
var OperatorResultSchema = z.object({
  id: z.string(),
  operator: OperatorSchema,
  outputFormat: z.string(),
  result: z.unknown(),
  dateCreated: z.string(),
  referenceIds: z.array(z.string()).optional().default([]),
  executionDetails: ExecutionDetailsSchema.optional()
});
var IntelligenceConfigurationSchema = z.object({
  id: z.string(),
  friendlyName: z.string().optional()
});
var OperatorResultEventSchema = z.object({
  accountId: z.string(),
  conversationId: z.string(),
  memoryStoreId: z.string().optional(),
  intelligenceConfiguration: IntelligenceConfigurationSchema,
  operatorResults: z.array(OperatorResultSchema)
});
var OperatorProcessingResultSchema = z.object({
  success: z.boolean(),
  eventType: z.string().optional(),
  skipped: z.boolean().default(false),
  skipReason: z.string().optional(),
  error: z.string().optional(),
  createdCount: z.number().default(0)
});
var ConversationIntelligenceConfigSchema = z.object({
  configurationId: z.string(),
  observationOperatorSid: z.string().optional(),
  summaryOperatorSid: z.string().optional()
});
var ConversationSummaryItemSchema = z.object({
  content: z.string(),
  conversationId: z.string(),
  occurredAt: z.string(),
  source: z.string().optional()
});
var KnowledgeBaseStatusSchema = z.enum([
  "QUEUED",
  "PROVISIONING",
  "ACTIVE",
  "FAILED",
  "DELETING"
]);
var KnowledgeBaseSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  status: KnowledgeBaseStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number()
});
var KnowledgeChunkResultSchema = z.object({
  content: z.string(),
  knowledgeId: z.string(),
  createdAt: z.string(),
  score: z.number().optional()
});
var KnowledgeSearchResponseSchema = z.object({
  chunks: z.array(KnowledgeChunkResultSchema)
});

// packages/core/src/lib/config.ts
var TACConfig = class _TACConfig {
  environment;
  twilioAccountSid;
  twilioAuthToken;
  apiKey;
  apiToken;
  twilioPhoneNumber;
  // Profile service configuration
  profileServiceProvider;
  // Segment configuration
  segmentWriteKey;
  segmentSpaceId;
  segmentAccessToken;
  segmentUnifyToken;
  // Memora configuration
  memoryStoreId;
  traitGroups;
  conversationServiceId;
  voicePublicDomain;
  cintelConfigurationId;
  cintelObservationOperatorSid;
  cintelSummaryOperatorSid;
  memoryApiUrl;
  conversationsApiUrl;
  knowledgeApiUrl;
  constructor(data) {
    const validatedConfig = TACConfigSchema.parse(data);
    const serviceUrls = computeServiceUrls(validatedConfig.environment);
    this.environment = validatedConfig.environment;
    this.twilioAccountSid = validatedConfig.twilioAccountSid;
    this.twilioAuthToken = validatedConfig.twilioAuthToken;
    this.apiKey = validatedConfig.apiKey;
    this.apiToken = validatedConfig.apiToken;
    this.twilioPhoneNumber = validatedConfig.twilioPhoneNumber;
    if (validatedConfig.profileServiceProvider) {
      this.profileServiceProvider = validatedConfig.profileServiceProvider;
    }
    if (validatedConfig.segmentWriteKey) {
      this.segmentWriteKey = validatedConfig.segmentWriteKey;
    }
    if (validatedConfig.segmentSpaceId) {
      this.segmentSpaceId = validatedConfig.segmentSpaceId;
    }
    if (validatedConfig.segmentAccessToken) {
      this.segmentAccessToken = validatedConfig.segmentAccessToken;
    }
    if (validatedConfig.segmentUnifyToken) {
      this.segmentUnifyToken = validatedConfig.segmentUnifyToken;
    }
    if (validatedConfig.memoryStoreId) {
      this.memoryStoreId = validatedConfig.memoryStoreId;
    }
    if (validatedConfig.traitGroups) {
      this.traitGroups = validatedConfig.traitGroups;
    }
    this.conversationServiceId = validatedConfig.conversationServiceId;
    if (validatedConfig.voicePublicDomain) {
      this.voicePublicDomain = validatedConfig.voicePublicDomain;
    }
    if (validatedConfig.cintelConfigurationId) {
      this.cintelConfigurationId = validatedConfig.cintelConfigurationId;
    }
    if (validatedConfig.cintelObservationOperatorSid) {
      this.cintelObservationOperatorSid = validatedConfig.cintelObservationOperatorSid;
    }
    if (validatedConfig.cintelSummaryOperatorSid) {
      this.cintelSummaryOperatorSid = validatedConfig.cintelSummaryOperatorSid;
    }
    this.memoryApiUrl = serviceUrls.memoryApiUrl;
    this.conversationsApiUrl = serviceUrls.conversationsApiUrl;
    this.knowledgeApiUrl = serviceUrls.knowledgeApiUrl;
  }
  /**
   * Create TACConfig from environment variables.
   *
   * Loads configuration from the following environment variables:
   * - ENVIRONMENT: TAC environment (dev, stage, or prod) - defaults to 'prod'
   * - TWILIO_ACCOUNT_SID: Twilio Account SID (required)
   * - TWILIO_AUTH_TOKEN: Twilio Auth Token (required)
   * - TWILIO_API_KEY: Twilio API Key (required)
   * - TWILIO_API_TOKEN: Twilio API Token (required)
   * - TWILIO_PHONE_NUMBER: Twilio Phone Number (required)
   * - MEMORY_STORE_ID: Memory Store ID (optional, for Twilio Memory)
   * - TRAIT_GROUPS: Comma-separated trait group names (optional, for profile fetching)
   * - CONVERSATION_SERVICE_ID: Twilio Conversation Configuration ID (required)
   * - VOICE_PUBLIC_DOMAIN: Public domain for voice webhooks (optional)
   *
   * @throws Error if required environment variables are not set or invalid
   *
   * @example
   * ```typescript
   * // Ensure env vars are set before calling (e.g. via dotenv, Docker, CI, etc.)
   * const config = TACConfig.fromEnv();
   *
   * // Use in TAC initialization
   * const tac = new TAC({ config });
   * ```
   */
  static fromEnv() {
    const requiredVars = [
      { key: EnvironmentVariables.TWILIO_ACCOUNT_SID, name: "TWILIO_ACCOUNT_SID" },
      { key: EnvironmentVariables.TWILIO_AUTH_TOKEN, name: "TWILIO_AUTH_TOKEN" },
      { key: EnvironmentVariables.TWILIO_API_KEY, name: "TWILIO_API_KEY" },
      { key: EnvironmentVariables.TWILIO_API_TOKEN, name: "TWILIO_API_TOKEN" },
      { key: EnvironmentVariables.TWILIO_PHONE_NUMBER, name: "TWILIO_PHONE_NUMBER" },
      { key: EnvironmentVariables.CONVERSATION_SERVICE_ID, name: "CONVERSATION_SERVICE_ID" }
    ];
    for (const { key, name } of requiredVars) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${name}`);
      }
    }
    const rawConfig = {
      environment: process.env[EnvironmentVariables.ENVIRONMENT] ?? "prod",
      twilioAccountSid: process.env[EnvironmentVariables.TWILIO_ACCOUNT_SID],
      twilioAuthToken: process.env[EnvironmentVariables.TWILIO_AUTH_TOKEN],
      apiKey: process.env[EnvironmentVariables.TWILIO_API_KEY],
      apiToken: process.env[EnvironmentVariables.TWILIO_API_TOKEN],
      twilioPhoneNumber: process.env[EnvironmentVariables.TWILIO_PHONE_NUMBER],
      // Profile service configuration
      profileServiceProvider: process.env[EnvironmentVariables.PROFILE_SERVICE_PROVIDER],
      // Segment configuration
      segmentWriteKey: process.env[EnvironmentVariables.SEGMENT_WRITE_KEY],
      segmentSpaceId: process.env[EnvironmentVariables.SEGMENT_SPACE_ID],
      segmentAccessToken: process.env[EnvironmentVariables.SEGMENT_ACCESS_TOKEN],
      segmentUnifyToken: process.env[EnvironmentVariables.SEGMENT_UNIFY_TOKEN],
      // Memora configuration
      memoryStoreId: process.env[EnvironmentVariables.MEMORY_STORE_ID],
      traitGroups: process.env[EnvironmentVariables.TRAIT_GROUPS]?.split(","),
      conversationServiceId: process.env[EnvironmentVariables.CONVERSATION_SERVICE_ID],
      voicePublicDomain: process.env[EnvironmentVariables.VOICE_PUBLIC_DOMAIN],
      cintelConfigurationId: process.env[EnvironmentVariables.TWILIO_TAC_CI_CONFIGURATION_ID],
      cintelObservationOperatorSid: process.env[EnvironmentVariables.TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID],
      cintelSummaryOperatorSid: process.env[EnvironmentVariables.TWILIO_TAC_CI_SUMMARY_OPERATOR_SID]
    };
    return new _TACConfig(rawConfig);
  }
  /**
   * Get basic auth credentials for Twilio APIs
   */
  getBasicAuthCredentials() {
    return {
      username: this.twilioAccountSid,
      password: this.twilioAuthToken
    };
  }
};
function createLogger(options) {
  const level = options?.level || process.env.LOG_LEVEL || "info";
  const isDevelopment = process.env.NODE_ENV !== "production";
  const usePretty = options?.pretty !== void 0 ? options.pretty : isDevelopment;
  const pinoOptions = {
    level,
    ...options?.name && { name: options.name }
  };
  if (usePretty) {
    return pino({
      ...pinoOptions,
      transport: {
        target: "pino-pretty",
        options: {}
      }
    });
  }
  return pino(pinoOptions);
}

// packages/core/src/clients/memory.ts
var MemoryClient = class {
  baseUrl;
  credentials;
  logger;
  constructor(config, logger2) {
    this.baseUrl = config.memoryApiUrl;
    this.credentials = {
      username: config.apiKey,
      password: config.apiToken
    };
    const baseLogger = logger2 || createLogger({ name: "tac-memory" });
    this.logger = baseLogger.child({ client: "memory" });
  }
  /**
   * Retrieve memories for a specific profile
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to retrieve memories for
   * @param request - Optional request parameters for filtering results
   * @returns Promise containing memory retrieval response
   */
  async retrieveMemories(serviceSid, profileId, request = {}) {
    try {
      const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}/Recall`;
      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId,
          request
        },
        "Retrieving memories"
      );
      const requestBody = {
        query: request.query,
        start_date: request.start_date,
        end_date: request.end_date,
        observation_limit: request.observation_limit ?? 10,
        summary_limit: request.summary_limit ?? 5,
        session_limit: request.session_limit ?? 3
      };
      const cleanedBody = Object.fromEntries(
        Object.entries(requestBody).filter(([_, value]) => value !== void 0)
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.getBasicAuthHeader()
        },
        body: JSON.stringify(cleanedBody)
      };
      this.logRequest(options.method, url, options.body);
      const response = await fetch(url, options);
      await this.logResponse(response);
      if (!response.ok) {
        this.logger.warn(
          {
            http_status: response.status,
            status_text: response.statusText,
            profile_id: profileId,
            memory_store_id: serviceSid
          },
          "Memory retrieval failed"
        );
        return EMPTY_MEMORY_RESPONSE;
      }
      const data = await response.json();
      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId
        },
        "Raw memory response received"
      );
      const validatedResponse = MemoryRetrievalResponseSchema.safeParse(data);
      if (!validatedResponse.success) {
        this.logger.warn(
          {
            profile_id: profileId,
            memory_store_id: serviceSid,
            validation_errors: validatedResponse.error.errors
          },
          "Invalid memory response format"
        );
        return EMPTY_MEMORY_RESPONSE;
      }
      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId,
          observation_count: validatedResponse.data.observations.length,
          summary_count: validatedResponse.data.summaries.length
        },
        "Memory retrieval succeeded"
      );
      return validatedResponse.data;
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          profile_id: profileId,
          memory_store_id: serviceSid
        },
        "Memory retrieval error"
      );
      return EMPTY_MEMORY_RESPONSE;
    }
  }
  /**
   * Find profiles that contain a specific identifier value
   *
   * @param serviceSid - The memory service SID
   * @param idType - Identifier type (e.g., 'phone', 'email')
   * @param value - Raw value captured for the identifier
   * @returns Promise containing profile lookup response with normalized value and matching profile IDs
   */
  async lookupProfile(serviceSid, idType, value) {
    const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/Lookup`;
    const requestBody = {
      idType,
      value
    };
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to lookup profile: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ProfileLookupResponseSchema.parse(data);
  }
  /**
   * Fetch profile information with traits
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to fetch
   * @param traitGroups - Optional list of trait group names to include
   * @returns Promise containing profile response with ID, created timestamp, and traits
   */
  async getProfile(serviceSid, profileId, traitGroups) {
    let url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}`;
    if (traitGroups && traitGroups.length > 0) {
      url += `?traitGroups=${traitGroups.join(",")}`;
    }
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to get profile: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ProfileResponseSchema.parse(data);
  }
  /**
   * Create an observation for a profile
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to create the observation for
   * @param content - The observation content
   * @param source - Source of the observation (default: 'conversation-intelligence')
   * @param conversationIds - Optional array of conversation IDs associated with this observation
   * @param occurredAt - Optional timestamp when the observation occurred
   * @returns Promise containing the created observation
   */
  async createObservation(serviceSid, profileId, content, source = "conversation-intelligence", conversationIds, occurredAt) {
    const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}/Observations`;
    const requestBody = {
      content,
      source
    };
    if (conversationIds && conversationIds.length > 0) {
      requestBody.conversationIds = conversationIds;
    }
    if (occurredAt) {
      requestBody.occurredAt = occurredAt;
    }
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to create observation: ${response.status} ${response.statusText} - ${errorBody}`
      );
    }
    const data = await response.json();
    return CreateObservationResponseSchema.parse(data);
  }
  /**
   * Create conversation summaries for a profile
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to create summaries for
   * @param summaries - Array of summary items to create
   * @returns Promise containing a success message for the created conversation summaries
   */
  async createConversationSummaries(serviceSid, profileId, summaries) {
    const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}/ConversationSummaries`;
    const requestBody = {
      summaries: summaries.map((s) => ({
        content: s.content,
        conversationId: s.conversationId,
        occurredAt: s.occurredAt,
        source: s.source ?? "conversation-intelligence"
      }))
    };
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(
        `Failed to create conversation summaries: ${response.status} ${response.statusText}`
      );
    }
    const data = await response.json();
    return CreateConversationSummariesResponseSchema.parse(data);
  }
  /**
   * Get Basic Auth header for HTTP requests
   */
  getBasicAuthHeader() {
    const credentials = `${this.credentials.username}:${this.credentials.password}`;
    const encoded = Buffer.from(credentials).toString("base64");
    return `Basic ${encoded}`;
  }
  /**
   * Log HTTP request details
   */
  logRequest(method, url, body) {
    this.logger.debug(
      {
        http_method: method,
        http_url: url,
        http_body: body ? JSON.parse(body) : void 0
      },
      "Memory HTTP request"
    );
  }
  /**
   * Log HTTP response details
   */
  async logResponse(response) {
    const bodyText = await response.clone().text();
    let bodyJson;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : void 0;
    } catch {
      bodyJson = bodyText;
    }
    this.logger.debug(
      {
        http_status: response.status,
        http_status_text: response.statusText,
        http_body: bodyJson
      },
      "HTTP response"
    );
  }
};

// packages/core/src/clients/conversation.ts
var ConversationClient = class {
  baseUrl;
  credentials;
  conversationServiceId;
  logger;
  constructor(config, logger2) {
    this.baseUrl = config.conversationsApiUrl;
    this.credentials = {
      username: config.apiKey,
      password: config.apiToken
    };
    this.conversationServiceId = config.conversationServiceId;
    const baseLogger = logger2 || createLogger({ name: "tac-conversations" });
    this.logger = baseLogger.child({ client: "conversations" });
  }
  /**
   * List communications for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Promise containing array of communications
   */
  async listCommunications(conversationId) {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}/Communications`;
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to list communications: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (typeof data === "object" && data !== null && "communications" in data && Array.isArray(data.communications)) {
      return data.communications.map(
        (comm) => CommunicationSchema.parse(comm)
      );
    }
    return [];
  }
  /**
   * Create a new conversation
   *
   * @param name - Optional conversation name
   * @returns Promise containing conversation response
   */
  async createConversation(name) {
    const url = `${this.baseUrl}/v2/Conversations`;
    const requestBody = {
      configurationId: this.conversationServiceId
    };
    if (name) {
      requestBody.name = name;
    }
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to create conversation: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ConversationResponseSchema.parse(data);
  }
  /**
   * Add a participant to a conversation
   *
   * @param conversationId - The conversation ID
   * @param addresses - Array of participant addresses
   * @param participantType - Type of participant (CUSTOMER, AI_AGENT, HUMAN_AGENT)
   * @returns Promise containing participant response
   */
  async addParticipant(conversationId, addresses, participantType) {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}/Participants`;
    const requestBody = {
      type: participantType,
      addresses
    };
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to add participant: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ConversationParticipantSchema.parse(data);
  }
  /**
   * List participants in a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Promise containing array of participants
   */
  async listParticipants(conversationId) {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}/Participants`;
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to list participants: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (typeof data === "object" && data !== null && "participants" in data && Array.isArray(data.participants)) {
      return data.participants.map(
        (participant) => ConversationParticipantSchema.parse(participant)
      );
    }
    return [];
  }
  /**
   * List conversations with optional filters
   *
   * @param filters - Optional filters (channelId, status)
   * @returns Promise containing array of conversations
   */
  async listConversations(filters) {
    const urlObj = new URL(`${this.baseUrl}/v2/Conversations`);
    if (filters?.channelId) {
      urlObj.searchParams.set("channelId", filters.channelId);
    }
    if (filters?.status && filters.status.length > 0) {
      urlObj.searchParams.set("status", filters.status.join(","));
    }
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, urlObj.toString());
    const response = await fetch(urlObj.toString(), options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to list conversations: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (typeof data === "object" && data !== null && "conversations" in data && Array.isArray(data.conversations)) {
      return data.conversations.map(
        (c) => ConversationResponseSchema.parse(c)
      );
    }
    return [];
  }
  /**
   * Update conversation status
   *
   * @param conversationId - The conversation ID
   * @param status - New status (ACTIVE, INACTIVE, CLOSED)
   * @returns Promise containing updated conversation
   */
  async updateConversation(conversationId, status) {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}`;
    const requestBody = { status };
    const options = {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to update conversation: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ConversationResponseSchema.parse(data);
  }
  /**
   * Get Basic Auth header for HTTP requests
   */
  getBasicAuthHeader() {
    const credentials = `${this.credentials.username}:${this.credentials.password}`;
    const encoded = Buffer.from(credentials).toString("base64");
    return `Basic ${encoded}`;
  }
  /**
   * Log HTTP request details
   */
  logRequest(method, url, body) {
    this.logger.debug(
      {
        http_method: method,
        http_url: url,
        http_body: body ? JSON.parse(body) : void 0
      },
      "Conversations Service HTTP request"
    );
  }
  /**
   * Log HTTP response details
   */
  async logResponse(response) {
    const bodyText = await response.clone().text();
    let bodyJson;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : void 0;
    } catch {
      bodyJson = bodyText;
    }
    this.logger.debug(
      {
        http_status: response.status,
        http_status_text: response.statusText,
        http_body: bodyJson
      },
      "HTTP response"
    );
  }
};

// packages/core/src/clients/knowledge.ts
var KnowledgeClient = class {
  baseUrl;
  credentials;
  logger;
  constructor(config, logger2) {
    this.baseUrl = config.knowledgeApiUrl;
    this.credentials = {
      username: config.apiKey,
      password: config.apiToken
    };
    const baseLogger = logger2 || createLogger({ name: "tac-knowledge" });
    this.logger = baseLogger.child({ client: "knowledge" });
  }
  /**
   * Get knowledge base metadata
   *
   * @param knowledgeBaseId - The knowledge base ID (format: know_knowledgebase_*)
   * @returns Promise containing knowledge base metadata
   */
  async getKnowledgeBase(knowledgeBaseId) {
    const url = `${this.baseUrl}/v2/ControlPlane/KnowledgeBases/${knowledgeBaseId}`;
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to get knowledge base: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return KnowledgeBaseSchema.parse(data);
  }
  /**
   * Search knowledge base for relevant content
   *
   * @param knowledgeBaseId - The knowledge base ID (format: know_knowledgebase_*)
   * @param query - Search query (max 2048 characters)
   * @param topK - Maximum number of results to return (default: 5, max: 20)
   * @param knowledgeIds - Optional list of knowledge IDs to filter results
   * @returns Promise containing array of search result chunks
   */
  async searchKnowledgeBase(knowledgeBaseId, query, topK = 5, knowledgeIds) {
    const url = `${this.baseUrl}/v2/KnowledgeBases/${knowledgeBaseId}/Search`;
    const requestBody = {
      query,
      top: Math.min(Math.max(topK, 1), 20)
      // Clamp to 1-20
    };
    if (knowledgeIds && knowledgeIds.length > 0) {
      requestBody.knowledgeIds = knowledgeIds;
    }
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to search knowledge base: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const validated = KnowledgeSearchResponseSchema.parse(data);
    return validated.chunks;
  }
  /**
   * Get Basic Auth header for HTTP requests
   */
  getBasicAuthHeader() {
    const credentials = `${this.credentials.username}:${this.credentials.password}`;
    const encoded = Buffer.from(credentials).toString("base64");
    return `Basic ${encoded}`;
  }
  /**
   * Log HTTP request details
   */
  logRequest(method, url, body) {
    this.logger.debug(
      {
        http_method: method,
        http_url: url,
        http_body: body ? JSON.parse(body) : void 0
      },
      "Knowledge HTTP request"
    );
  }
  /**
   * Log HTTP response details
   */
  async logResponse(response) {
    const bodyText = await response.clone().text();
    let bodyJson;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : void 0;
    } catch {
      bodyJson = bodyText;
    }
    this.logger.debug(
      {
        http_status: response.status,
        http_status_text: response.statusText,
        http_body: bodyJson
      },
      "HTTP response"
    );
  }
};

// packages/core/src/lib/operator-result-processor.ts
function extractProfileIds(operatorResult) {
  const profileIds = [];
  if (operatorResult.executionDetails?.participants) {
    for (const participant of operatorResult.executionDetails.participants) {
      if (participant.profileId) {
        profileIds.push(participant.profileId);
      }
    }
  }
  return profileIds;
}
function generateContent(operatorResult) {
  const result = operatorResult.result;
  if (result === null || result === void 0) {
    return void 0;
  }
  if (typeof result === "string") {
    return result.trim() || void 0;
  }
  const jsonString = JSON.stringify(result);
  return jsonString === "{}" || jsonString === "[]" ? void 0 : jsonString;
}
function parseObservationsContent(jsonContent) {
  try {
    const parsed = JSON.parse(jsonContent);
    if (typeof parsed === "object" && parsed !== null && "observations" in parsed) {
      const observations = parsed.observations;
      if (Array.isArray(observations)) {
        return observations.filter(
          (obs) => typeof obs === "string" && obs.trim() !== ""
        );
      }
    }
    return [];
  } catch {
    return [];
  }
}
function parseSummariesContent(jsonContent) {
  try {
    const parsed = JSON.parse(jsonContent);
    if (typeof parsed === "object" && parsed !== null && "summaries" in parsed) {
      const summaries = parsed.summaries;
      if (Array.isArray(summaries)) {
        return summaries.filter((s) => typeof s === "string" && s.trim() !== "");
      }
    }
    return [];
  } catch {
    return [];
  }
}
var OperatorResultProcessor = class {
  memoryClient;
  config;
  logger;
  constructor(memoryClient, config, logger2) {
    this.memoryClient = memoryClient;
    this.config = config;
    this.logger = logger2 ?? createLogger({ name: "cintel-processor" });
  }
  /**
   * Process an operator result event webhook payload
   *
   * @param payload - The raw webhook payload
   * @returns Processing result indicating success/failure and details
   */
  async processEvent(payload) {
    const parseResult = OperatorResultEventSchema.safeParse(payload);
    if (!parseResult.success) {
      this.logger.warn(
        { validation_errors: parseResult.error.errors },
        "Invalid operator result event payload"
      );
      return {
        success: false,
        skipped: false,
        error: `Invalid payload: ${parseResult.error.message}`,
        createdCount: 0
      };
    }
    const event = parseResult.data;
    if (event.intelligenceConfiguration.id !== this.config.configurationId) {
      this.logger.debug(
        {
          received_config_id: event.intelligenceConfiguration.id,
          expected_config_id: this.config.configurationId
        },
        "Skipping event from different CI configuration"
      );
      return {
        success: true,
        skipped: true,
        skipReason: `Event from different CI configuration: ${event.intelligenceConfiguration.id}`,
        createdCount: 0
      };
    }
    const results = [];
    for (const operatorResult of event.operatorResults) {
      const result = await this.processOperatorResult(event, operatorResult);
      results.push(result);
    }
    const successCount = results.filter((r) => r.success && !r.skipped).length;
    const skippedCount = results.filter((r) => r.skipped).length;
    const errorCount = results.filter((r) => !r.success).length;
    const totalCreated = results.reduce((sum, r) => sum + r.createdCount, 0);
    const eventTypes = results.filter((r) => r.success && !r.skipped && r.eventType).map((r) => r.eventType);
    const uniqueEventTypes = [...new Set(eventTypes)];
    const eventType = uniqueEventTypes.length === 1 ? uniqueEventTypes[0] : uniqueEventTypes.length > 1 ? "mixed" : void 0;
    if (errorCount > 0) {
      const errors = results.filter((r) => !r.success).map((r) => r.error);
      return {
        success: false,
        eventType,
        skipped: false,
        error: `${errorCount} operator(s) failed: ${errors.join("; ")}`,
        createdCount: totalCreated
      };
    }
    if (skippedCount === results.length) {
      return {
        success: true,
        skipped: true,
        skipReason: "All operator results were skipped",
        createdCount: 0
      };
    }
    this.logger.info(
      {
        conversation_id: event.conversationId,
        success_count: successCount,
        skipped_count: skippedCount,
        created_count: totalCreated,
        event_type: eventType
      },
      "Processed operator result event"
    );
    return {
      success: true,
      eventType,
      skipped: false,
      createdCount: totalCreated
    };
  }
  /**
   * Process an individual operator result
   */
  async processOperatorResult(event, operatorResult) {
    const operatorSid = operatorResult.operator.id;
    const isObservationOperator = this.config.observationOperatorSid === operatorSid;
    const isSummaryOperator = this.config.summaryOperatorSid === operatorSid;
    if (!isObservationOperator && !isSummaryOperator) {
      this.logger.debug(
        {
          operator_sid: operatorSid,
          observation_operator_sid: this.config.observationOperatorSid,
          summary_operator_sid: this.config.summaryOperatorSid
        },
        "Skipping unconfigured operator"
      );
      return {
        success: true,
        skipped: true,
        skipReason: `Operator ${operatorSid} is not configured for processing`,
        createdCount: 0
      };
    }
    const content = generateContent(operatorResult);
    if (!content) {
      this.logger.debug(
        { operator_sid: operatorSid },
        "Skipping operator result with empty content"
      );
      return {
        success: true,
        skipped: true,
        skipReason: "Operator result has empty content",
        createdCount: 0
      };
    }
    const profileIds = extractProfileIds(operatorResult);
    if (profileIds.length === 0) {
      this.logger.warn(
        { operator_sid: operatorSid, conversation_id: event.conversationId },
        "No profile IDs found in operator result"
      );
      return {
        success: true,
        skipped: true,
        skipReason: "No profile IDs found in operator result execution details",
        createdCount: 0
      };
    }
    if (!event.memoryStoreId) {
      this.logger.warn({ conversation_id: event.conversationId }, "No memory store ID in event");
      return {
        success: false,
        skipped: false,
        error: "No memory store ID provided in event",
        createdCount: 0
      };
    }
    if (isObservationOperator) {
      return this.processObservationEvent(event, operatorResult, content, profileIds);
    } else {
      return this.processSummaryEvent(event, operatorResult, content, profileIds);
    }
  }
  /**
   * Process an observation operator result
   */
  async processObservationEvent(event, operatorResult, content, profileIds) {
    const observations = parseObservationsContent(content);
    if (observations.length === 0) {
      this.logger.debug(
        { operator_sid: operatorResult.operator.id },
        "No observations found in content"
      );
      return {
        success: true,
        eventType: "observation",
        skipped: true,
        skipReason: "No observations found in operator result content",
        createdCount: 0
      };
    }
    let createdCount = 0;
    for (const profileId of profileIds) {
      for (const observation of observations) {
        try {
          await this.memoryClient.createObservation(
            event.memoryStoreId,
            profileId,
            observation,
            "conversation-intelligence",
            [event.conversationId],
            operatorResult.dateCreated
          );
          createdCount++;
          this.logger.debug(
            {
              profile_id: profileId,
              conversation_id: event.conversationId,
              observation_preview: observation.substring(0, 100)
            },
            "Created observation"
          );
        } catch (error) {
          this.logger.error(
            {
              err: error,
              profile_id: profileId,
              conversation_id: event.conversationId
            },
            "Failed to create observation"
          );
          return {
            success: false,
            eventType: "observation",
            skipped: false,
            error: `Failed to create observation: ${error instanceof Error ? error.message : String(error)}`,
            createdCount
          };
        }
      }
    }
    return {
      success: true,
      eventType: "observation",
      skipped: false,
      createdCount
    };
  }
  /**
   * Process a summary operator result
   */
  async processSummaryEvent(event, operatorResult, content, profileIds) {
    const summaries = parseSummariesContent(content);
    if (summaries.length === 0) {
      this.logger.debug(
        { operator_sid: operatorResult.operator.id },
        "No summaries found in content"
      );
      return {
        success: true,
        eventType: "summary",
        skipped: true,
        skipReason: "No summaries found in operator result content",
        createdCount: 0
      };
    }
    let createdCount = 0;
    for (const profileId of profileIds) {
      try {
        const summaryItems = summaries.map((summaryContent) => ({
          content: summaryContent,
          conversationId: event.conversationId,
          occurredAt: operatorResult.dateCreated,
          source: "conversation-intelligence"
        }));
        await this.memoryClient.createConversationSummaries(
          event.memoryStoreId,
          profileId,
          summaryItems
        );
        createdCount += summaries.length;
        this.logger.debug(
          {
            profile_id: profileId,
            conversation_id: event.conversationId,
            summary_count: summaries.length
          },
          "Created conversation summaries"
        );
      } catch (error) {
        this.logger.error(
          {
            err: error,
            profile_id: profileId,
            conversation_id: event.conversationId
          },
          "Failed to create conversation summaries"
        );
        return {
          success: false,
          eventType: "summary",
          skipped: false,
          error: `Failed to create summaries: ${error instanceof Error ? error.message : String(error)}`,
          createdCount
        };
      }
    }
    return {
      success: true,
      eventType: "summary",
      skipped: false,
      createdCount
    };
  }
};

// node_modules/tslib/tslib.es6.mjs
var extendStatics = function(d, b) {
  extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
    d2.__proto__ = b2;
  } || function(d2, b2) {
    for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
  };
  return extendStatics(d, b);
};
function __extends(d, b) {
  if (typeof b !== "function" && b !== null)
    throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
  extendStatics(d, b);
  function __() {
    this.constructor = d;
  }
  d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
}
var __assign = function() {
  __assign = Object.assign || function __assign2(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
      s = arguments[i];
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
    }
    return t;
  };
  return __assign.apply(this, arguments);
};
function __rest(s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
    t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function")
    for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
      if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
        t[p[i]] = s[p[i]];
    }
  return t;
}
function __awaiter(thisArg, _arguments, P, generator) {
  function adopt(value) {
    return value instanceof P ? value : new P(function(resolve) {
      resolve(value);
    });
  }
  return new (P || (P = Promise))(function(resolve, reject) {
    function fulfilled(value) {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    }
    function rejected(value) {
      try {
        step(generator["throw"](value));
      } catch (e) {
        reject(e);
      }
    }
    function step(result) {
      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
    }
    step((generator = generator.apply(thisArg, [])).next());
  });
}
function __generator(thisArg, body) {
  var _ = { label: 0, sent: function() {
    if (t[0] & 1) throw t[1];
    return t[1];
  }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
  return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() {
    return this;
  }), g;
  function verb(n) {
    return function(v) {
      return step([n, v]);
    };
  }
  function step(op) {
    if (f) throw new TypeError("Generator is already executing.");
    while (g && (g = 0, op[0] && (_ = 0)), _) try {
      if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
      if (y = 0, t) op = [op[0] & 2, t.value];
      switch (op[0]) {
        case 0:
        case 1:
          t = op;
          break;
        case 4:
          _.label++;
          return { value: op[1], done: false };
        case 5:
          _.label++;
          y = op[1];
          op = [0];
          continue;
        case 7:
          op = _.ops.pop();
          _.trys.pop();
          continue;
        default:
          if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
            _ = 0;
            continue;
          }
          if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
            _.label = op[1];
            break;
          }
          if (op[0] === 6 && _.label < t[1]) {
            _.label = t[1];
            t = op;
            break;
          }
          if (t && _.label < t[2]) {
            _.label = t[2];
            _.ops.push(op);
            break;
          }
          if (t[2]) _.ops.pop();
          _.trys.pop();
          continue;
      }
      op = body.call(thisArg, _);
    } catch (e) {
      op = [6, e];
      y = 0;
    } finally {
      f = t = 0;
    }
    if (op[0] & 5) throw op[1];
    return { value: op[0] ? op[1] : void 0, done: true };
  }
}
function __spreadArray(to, from, pack) {
  if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
    if (ar || !(i in from)) {
      if (!ar) ar = Array.prototype.slice.call(from, 0, i);
      ar[i] = from[i];
    }
  }
  return to.concat(ar || Array.prototype.slice.call(from));
}

// node_modules/dset/dist/index.mjs
function dset(obj, keys, val) {
  keys.split && (keys = keys.split("."));
  var i = 0, l = keys.length, t = obj, x, k;
  while (i < l) {
    k = "" + keys[i++];
    if (k === "__proto__" || k === "constructor" || k === "prototype") break;
    t = t[k] = i === l ? val : typeof (x = t[k]) === typeof keys ? x : keys[i] * 0 !== 0 || !!~("" + keys[i]).indexOf(".") ? {} : [];
  }
}

// node_modules/@segment/analytics-core/dist/esm/utils/pick.js
var pickBy = function(obj, fn) {
  return Object.keys(obj).filter(function(k) {
    return fn(k, obj[k]);
  }).reduce(function(acc, key) {
    return acc[key] = obj[key], acc;
  }, {});
};

// node_modules/@segment/analytics-core/dist/esm/validation/errors.js
var ValidationError = (
  /** @class */
  (function(_super) {
    __extends(ValidationError2, _super);
    function ValidationError2(field, message2) {
      var _this = _super.call(this, "".concat(field, " ").concat(message2)) || this;
      _this.field = field;
      return _this;
    }
    return ValidationError2;
  })(Error)
);

// node_modules/@segment/analytics-core/dist/esm/validation/helpers.js
function isString(obj) {
  return typeof obj === "string";
}
function exists(val) {
  return val !== void 0 && val !== null;
}
function isPlainObject(obj) {
  return Object.prototype.toString.call(obj).slice(8, -1).toLowerCase() === "object";
}

// node_modules/@segment/analytics-core/dist/esm/validation/assertions.js
var stringError = "is not a string";
var objError = "is not an object";
var nilError = "is nil";
function assertUserIdentity(event) {
  var USER_FIELD_NAME = ".userId/anonymousId/previousId/groupId";
  var getAnyUserId = function(event2) {
    var _a, _b, _c;
    return (_c = (_b = (_a = event2.userId) !== null && _a !== void 0 ? _a : event2.anonymousId) !== null && _b !== void 0 ? _b : event2.groupId) !== null && _c !== void 0 ? _c : event2.previousId;
  };
  var id = getAnyUserId(event);
  if (!exists(id)) {
    throw new ValidationError(USER_FIELD_NAME, nilError);
  } else if (!isString(id)) {
    throw new ValidationError(USER_FIELD_NAME, stringError);
  }
}
function assertEventExists(event) {
  if (!exists(event)) {
    throw new ValidationError("Event", nilError);
  }
  if (typeof event !== "object") {
    throw new ValidationError("Event", objError);
  }
}
function assertEventType(event) {
  if (!isString(event.type)) {
    throw new ValidationError(".type", stringError);
  }
}
function assertTrackEventName(event) {
  if (!isString(event.event)) {
    throw new ValidationError(".event", stringError);
  }
}
function assertTrackEventProperties(event) {
  if (!isPlainObject(event.properties)) {
    throw new ValidationError(".properties", objError);
  }
}
function assertTraits(event) {
  if (!isPlainObject(event.traits)) {
    throw new ValidationError(".traits", objError);
  }
}
function assertMessageId(event) {
  if (!isString(event.messageId)) {
    throw new ValidationError(".messageId", stringError);
  }
}
function validateEvent(event) {
  assertEventExists(event);
  assertEventType(event);
  assertMessageId(event);
  if (event.type === "track") {
    assertTrackEventName(event);
    assertTrackEventProperties(event);
  }
  if (["group", "identify"].includes(event.type)) {
    assertTraits(event);
  }
}

// node_modules/@segment/analytics-core/dist/esm/events/index.js
var InternalEventFactorySettings = (
  /** @class */
  /* @__PURE__ */ (function() {
    function InternalEventFactorySettings2(settings) {
      var _a, _b;
      this.settings = settings;
      this.createMessageId = settings.createMessageId;
      this.onEventMethodCall = (_a = settings.onEventMethodCall) !== null && _a !== void 0 ? _a : (function() {
      });
      this.onFinishedEvent = (_b = settings.onFinishedEvent) !== null && _b !== void 0 ? _b : (function() {
      });
    }
    return InternalEventFactorySettings2;
  })()
);
var CoreEventFactory = (
  /** @class */
  (function() {
    function CoreEventFactory2(settings) {
      this.settings = new InternalEventFactorySettings(settings);
    }
    CoreEventFactory2.prototype.track = function(event, properties, options, integrationOptions) {
      this.settings.onEventMethodCall({ type: "track", options });
      return this.normalize(__assign(__assign({}, this.baseEvent()), { event, type: "track", properties: properties !== null && properties !== void 0 ? properties : {}, options: __assign({}, options), integrations: __assign({}, integrationOptions) }));
    };
    CoreEventFactory2.prototype.page = function(category, page, properties, options, integrationOptions) {
      var _a;
      this.settings.onEventMethodCall({ type: "page", options });
      var event = {
        type: "page",
        properties: __assign({}, properties),
        options: __assign({}, options),
        integrations: __assign({}, integrationOptions)
      };
      if (category !== null) {
        event.category = category;
        event.properties = (_a = event.properties) !== null && _a !== void 0 ? _a : {};
        event.properties.category = category;
      }
      if (page !== null) {
        event.name = page;
      }
      return this.normalize(__assign(__assign({}, this.baseEvent()), event));
    };
    CoreEventFactory2.prototype.screen = function(category, screen, properties, options, integrationOptions) {
      this.settings.onEventMethodCall({ type: "screen", options });
      var event = {
        type: "screen",
        properties: __assign({}, properties),
        options: __assign({}, options),
        integrations: __assign({}, integrationOptions)
      };
      if (category !== null) {
        event.category = category;
      }
      if (screen !== null) {
        event.name = screen;
      }
      return this.normalize(__assign(__assign({}, this.baseEvent()), event));
    };
    CoreEventFactory2.prototype.identify = function(userId, traits, options, integrationsOptions) {
      this.settings.onEventMethodCall({ type: "identify", options });
      return this.normalize(__assign(__assign({}, this.baseEvent()), { type: "identify", userId, traits: traits !== null && traits !== void 0 ? traits : {}, options: __assign({}, options), integrations: integrationsOptions }));
    };
    CoreEventFactory2.prototype.group = function(groupId, traits, options, integrationOptions) {
      this.settings.onEventMethodCall({ type: "group", options });
      return this.normalize(__assign(__assign({}, this.baseEvent()), {
        type: "group",
        traits: traits !== null && traits !== void 0 ? traits : {},
        options: __assign({}, options),
        integrations: __assign({}, integrationOptions),
        //
        groupId
      }));
    };
    CoreEventFactory2.prototype.alias = function(to, from, options, integrationOptions) {
      this.settings.onEventMethodCall({ type: "alias", options });
      var base = {
        userId: to,
        type: "alias",
        options: __assign({}, options),
        integrations: __assign({}, integrationOptions)
      };
      if (from !== null) {
        base.previousId = from;
      }
      if (to === void 0) {
        return this.normalize(__assign(__assign({}, base), this.baseEvent()));
      }
      return this.normalize(__assign(__assign({}, this.baseEvent()), base));
    };
    CoreEventFactory2.prototype.baseEvent = function() {
      return {
        integrations: {},
        options: {}
      };
    };
    CoreEventFactory2.prototype.context = function(options) {
      var _a;
      var eventOverrideKeys = [
        "userId",
        "anonymousId",
        "timestamp",
        "messageId"
      ];
      delete options["integrations"];
      var providedOptionsKeys = Object.keys(options);
      var context = (_a = options.context) !== null && _a !== void 0 ? _a : {};
      var eventOverrides = {};
      providedOptionsKeys.forEach(function(key) {
        if (key === "context") {
          return;
        }
        if (eventOverrideKeys.includes(key)) {
          dset(eventOverrides, key, options[key]);
        } else {
          dset(context, key, options[key]);
        }
      });
      return [context, eventOverrides];
    };
    CoreEventFactory2.prototype.normalize = function(event) {
      var _a, _b;
      var integrationBooleans = Object.keys((_a = event.integrations) !== null && _a !== void 0 ? _a : {}).reduce(function(integrationNames, name) {
        var _a2;
        var _b2;
        return __assign(__assign({}, integrationNames), (_a2 = {}, _a2[name] = Boolean((_b2 = event.integrations) === null || _b2 === void 0 ? void 0 : _b2[name]), _a2));
      }, {});
      event.options = pickBy(event.options || {}, function(_, value) {
        return value !== void 0;
      });
      var allIntegrations = __assign(__assign({}, integrationBooleans), (_b = event.options) === null || _b === void 0 ? void 0 : _b.integrations);
      var _c = event.options ? this.context(event.options) : [], context = _c[0], overrides = _c[1];
      var options = event.options, rest = __rest(event, ["options"]);
      var evt = __assign(__assign(__assign(__assign({ timestamp: /* @__PURE__ */ new Date() }, rest), { context, integrations: allIntegrations }), overrides), { messageId: options.messageId || this.settings.createMessageId() });
      this.settings.onFinishedEvent(evt);
      validateEvent(evt);
      return evt;
    };
    return CoreEventFactory2;
  })()
);

// node_modules/@segment/analytics-core/dist/esm/callback/index.js
function pTimeout(promise, timeout) {
  return new Promise(function(resolve, reject) {
    var timeoutId = setTimeout(function() {
      reject(Error("Promise timed out"));
    }, timeout);
    promise.then(function(val) {
      clearTimeout(timeoutId);
      return resolve(val);
    }).catch(reject);
  });
}
function sleep(timeoutInMs) {
  return new Promise(function(resolve) {
    return setTimeout(resolve, timeoutInMs);
  });
}
function invokeCallback(ctx, callback, delay) {
  var cb = function() {
    try {
      return Promise.resolve(callback(ctx));
    } catch (err) {
      return Promise.reject(err);
    }
  };
  return sleep(delay).then(function() {
    return pTimeout(cb(), 1e3);
  }).catch(function(err) {
    ctx === null || ctx === void 0 ? void 0 : ctx.log("warn", "Callback Error", { error: err });
    ctx === null || ctx === void 0 ? void 0 : ctx.stats.increment("callback_error");
  }).then(function() {
    return ctx;
  });
}

// node_modules/@segment/analytics-generic-utils/dist/esm/create-deferred/create-deferred.js
var createDeferred = function() {
  var resolve;
  var reject;
  var settled = false;
  var promise = new Promise(function(_resolve, _reject) {
    resolve = function() {
      var args = [];
      for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
      }
      settled = true;
      _resolve.apply(void 0, args);
    };
    reject = function() {
      var args = [];
      for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
      }
      settled = true;
      _reject.apply(void 0, args);
    };
  });
  return {
    resolve,
    reject,
    promise,
    isSettled: function() {
      return settled;
    }
  };
};

// node_modules/@segment/analytics-generic-utils/dist/esm/emitter/emitter.js
var Emitter = (
  /** @class */
  (function() {
    function Emitter2(options) {
      var _a;
      this.callbacks = {};
      this.warned = false;
      this.maxListeners = (_a = options === null || options === void 0 ? void 0 : options.maxListeners) !== null && _a !== void 0 ? _a : 10;
    }
    Emitter2.prototype.warnIfPossibleMemoryLeak = function(event) {
      if (this.warned) {
        return;
      }
      if (this.maxListeners && this.callbacks[event].length > this.maxListeners) {
        console.warn("Event Emitter: Possible memory leak detected; ".concat(String(event), " has exceeded ").concat(this.maxListeners, " listeners."));
        this.warned = true;
      }
    };
    Emitter2.prototype.on = function(event, callback) {
      if (!this.callbacks[event]) {
        this.callbacks[event] = [callback];
      } else {
        this.callbacks[event].push(callback);
        this.warnIfPossibleMemoryLeak(event);
      }
      return this;
    };
    Emitter2.prototype.once = function(event, callback) {
      var _this = this;
      var on = function() {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
          args[_i] = arguments[_i];
        }
        _this.off(event, on);
        callback.apply(_this, args);
      };
      this.on(event, on);
      return this;
    };
    Emitter2.prototype.off = function(event, callback) {
      var _a;
      var fns = (_a = this.callbacks[event]) !== null && _a !== void 0 ? _a : [];
      var without = fns.filter(function(fn) {
        return fn !== callback;
      });
      this.callbacks[event] = without;
      return this;
    };
    Emitter2.prototype.emit = function(event) {
      var _this = this;
      var _a;
      var args = [];
      for (var _i = 1; _i < arguments.length; _i++) {
        args[_i - 1] = arguments[_i];
      }
      var callbacks = (_a = this.callbacks[event]) !== null && _a !== void 0 ? _a : [];
      callbacks.forEach(function(callback) {
        callback.apply(_this, args);
      });
      return this;
    };
    return Emitter2;
  })()
);

// node_modules/@segment/analytics-core/dist/esm/priority-queue/backoff.js
function backoff(params) {
  var random = Math.random() + 1;
  var _a = params.minTimeout, minTimeout = _a === void 0 ? 500 : _a, _b = params.factor, factor = _b === void 0 ? 2 : _b, attempt2 = params.attempt, _c = params.maxTimeout, maxTimeout = _c === void 0 ? Infinity : _c;
  return Math.min(random * minTimeout * Math.pow(factor, attempt2), maxTimeout);
}

// node_modules/@segment/analytics-core/dist/esm/priority-queue/index.js
var ON_REMOVE_FROM_FUTURE = "onRemoveFromFuture";
var PriorityQueue = (
  /** @class */
  (function(_super) {
    __extends(PriorityQueue2, _super);
    function PriorityQueue2(maxAttempts, queue, seen) {
      var _this = _super.call(this) || this;
      _this.future = [];
      _this.maxAttempts = maxAttempts;
      _this.queue = queue;
      _this.seen = seen !== null && seen !== void 0 ? seen : {};
      return _this;
    }
    PriorityQueue2.prototype.push = function() {
      var _this = this;
      var items = [];
      for (var _i = 0; _i < arguments.length; _i++) {
        items[_i] = arguments[_i];
      }
      var accepted = items.map(function(operation) {
        var attempts = _this.updateAttempts(operation);
        if (attempts > _this.maxAttempts || _this.includes(operation)) {
          return false;
        }
        _this.queue.push(operation);
        return true;
      });
      this.queue = this.queue.sort(function(a, b) {
        return _this.getAttempts(a) - _this.getAttempts(b);
      });
      return accepted;
    };
    PriorityQueue2.prototype.pushWithBackoff = function(item, minTimeout) {
      var _this = this;
      if (minTimeout === void 0) {
        minTimeout = 0;
      }
      if (minTimeout == 0 && this.getAttempts(item) === 0) {
        return this.push(item)[0];
      }
      var attempt2 = this.updateAttempts(item);
      if (attempt2 > this.maxAttempts || this.includes(item)) {
        return false;
      }
      var timeout = backoff({ attempt: attempt2 - 1 });
      if (minTimeout > 0 && timeout < minTimeout) {
        timeout = minTimeout;
      }
      setTimeout(function() {
        _this.queue.push(item);
        _this.future = _this.future.filter(function(f) {
          return f.id !== item.id;
        });
        _this.emit(ON_REMOVE_FROM_FUTURE);
      }, timeout);
      this.future.push(item);
      return true;
    };
    PriorityQueue2.prototype.getAttempts = function(item) {
      var _a;
      return (_a = this.seen[item.id]) !== null && _a !== void 0 ? _a : 0;
    };
    PriorityQueue2.prototype.updateAttempts = function(item) {
      this.seen[item.id] = this.getAttempts(item) + 1;
      return this.getAttempts(item);
    };
    PriorityQueue2.prototype.includes = function(item) {
      return this.queue.includes(item) || this.future.includes(item) || Boolean(this.queue.find(function(i) {
        return i.id === item.id;
      })) || Boolean(this.future.find(function(i) {
        return i.id === item.id;
      }));
    };
    PriorityQueue2.prototype.pop = function() {
      return this.queue.shift();
    };
    Object.defineProperty(PriorityQueue2.prototype, "length", {
      get: function() {
        return this.queue.length;
      },
      enumerable: false,
      configurable: true
    });
    Object.defineProperty(PriorityQueue2.prototype, "todo", {
      get: function() {
        return this.queue.length + this.future.length;
      },
      enumerable: false,
      configurable: true
    });
    return PriorityQueue2;
  })(Emitter)
);

// node_modules/@lukeed/uuid/dist/index.mjs
var IDX = 256;
var HEX = [];
var BUFFER;
while (IDX--) HEX[IDX] = (IDX + 256).toString(16).substring(1);
function v4() {
  var i = 0, num, out = "";
  if (!BUFFER || IDX + 16 > 256) {
    BUFFER = Array(i = 256);
    while (i--) BUFFER[i] = 256 * Math.random() | 0;
    i = IDX = 0;
  }
  for (; i < 16; i++) {
    num = BUFFER[IDX + i];
    if (i == 6) out += HEX[num & 15 | 64];
    else if (i == 8) out += HEX[num & 63 | 128];
    else out += HEX[num];
    if (i & 1 && i > 1 && i < 11) out += "-";
  }
  IDX++;
  return out;
}

// node_modules/@segment/analytics-core/dist/esm/logger/index.js
var CoreLogger = (
  /** @class */
  (function() {
    function CoreLogger2() {
      this._logs = [];
    }
    CoreLogger2.prototype.log = function(level, message2, extras) {
      var time = /* @__PURE__ */ new Date();
      this._logs.push({
        level,
        message: message2,
        time,
        extras
      });
    };
    Object.defineProperty(CoreLogger2.prototype, "logs", {
      get: function() {
        return this._logs;
      },
      enumerable: false,
      configurable: true
    });
    CoreLogger2.prototype.flush = function() {
      if (this.logs.length > 1) {
        var formatted = this._logs.reduce(function(logs, log) {
          var _a;
          var _b, _c;
          var line = __assign(__assign({}, log), { json: JSON.stringify(log.extras, null, " "), extras: log.extras });
          delete line["time"];
          var key = (_c = (_b = log.time) === null || _b === void 0 ? void 0 : _b.toISOString()) !== null && _c !== void 0 ? _c : "";
          if (logs[key]) {
            key = "".concat(key, "-").concat(Math.random());
          }
          return __assign(__assign({}, logs), (_a = {}, _a[key] = line, _a));
        }, {});
        if (console.table) {
          console.table(formatted);
        } else {
          console.log(formatted);
        }
      } else {
        this.logs.forEach(function(logEntry) {
          var level = logEntry.level, message2 = logEntry.message, extras = logEntry.extras;
          if (level === "info" || level === "debug") {
            console.log(message2, extras !== null && extras !== void 0 ? extras : "");
          } else {
            console[level](message2, extras !== null && extras !== void 0 ? extras : "");
          }
        });
      }
      this._logs = [];
    };
    return CoreLogger2;
  })()
);

// node_modules/@segment/analytics-core/dist/esm/stats/index.js
var compactMetricType = function(type) {
  var enums = {
    gauge: "g",
    counter: "c"
  };
  return enums[type];
};
var CoreStats = (
  /** @class */
  (function() {
    function CoreStats2() {
      this.metrics = [];
    }
    CoreStats2.prototype.increment = function(metric, by, tags) {
      if (by === void 0) {
        by = 1;
      }
      this.metrics.push({
        metric,
        value: by,
        tags: tags !== null && tags !== void 0 ? tags : [],
        type: "counter",
        timestamp: Date.now()
      });
    };
    CoreStats2.prototype.gauge = function(metric, value, tags) {
      this.metrics.push({
        metric,
        value,
        tags: tags !== null && tags !== void 0 ? tags : [],
        type: "gauge",
        timestamp: Date.now()
      });
    };
    CoreStats2.prototype.flush = function() {
      var formatted = this.metrics.map(function(m) {
        return __assign(__assign({}, m), { tags: m.tags.join(",") });
      });
      if (console.table) {
        console.table(formatted);
      } else {
        console.log(formatted);
      }
      this.metrics = [];
    };
    CoreStats2.prototype.serialize = function() {
      return this.metrics.map(function(m) {
        return {
          m: m.metric,
          v: m.value,
          t: m.tags,
          k: compactMetricType(m.type),
          e: m.timestamp
        };
      });
    };
    return CoreStats2;
  })()
);
var NullStats = (
  /** @class */
  (function(_super) {
    __extends(NullStats2, _super);
    function NullStats2() {
      return _super !== null && _super.apply(this, arguments) || this;
    }
    NullStats2.prototype.gauge = function() {
    };
    NullStats2.prototype.increment = function() {
    };
    NullStats2.prototype.flush = function() {
    };
    NullStats2.prototype.serialize = function() {
      return [];
    };
    return NullStats2;
  })(CoreStats)
);

// node_modules/@segment/analytics-core/dist/esm/context/index.js
var ContextCancelation = (
  /** @class */
  /* @__PURE__ */ (function() {
    function ContextCancelation2(options) {
      var _a, _b, _c;
      this.retry = (_a = options.retry) !== null && _a !== void 0 ? _a : true;
      this.type = (_b = options.type) !== null && _b !== void 0 ? _b : "plugin Error";
      this.reason = (_c = options.reason) !== null && _c !== void 0 ? _c : "";
    }
    return ContextCancelation2;
  })()
);
var CoreContext = (
  /** @class */
  (function() {
    function CoreContext2(event, id, stats, logger2) {
      if (id === void 0) {
        id = v4();
      }
      if (stats === void 0) {
        stats = new NullStats();
      }
      if (logger2 === void 0) {
        logger2 = new CoreLogger();
      }
      this.attempts = 0;
      this.event = event;
      this._id = id;
      this.logger = logger2;
      this.stats = stats;
    }
    CoreContext2.system = function() {
    };
    CoreContext2.prototype.isSame = function(other) {
      return other.id === this.id;
    };
    CoreContext2.prototype.cancel = function(error) {
      if (error) {
        throw error;
      }
      throw new ContextCancelation({ reason: "Context Cancel" });
    };
    CoreContext2.prototype.log = function(level, message2, extras) {
      this.logger.log(level, message2, extras);
    };
    Object.defineProperty(CoreContext2.prototype, "id", {
      get: function() {
        return this._id;
      },
      enumerable: false,
      configurable: true
    });
    CoreContext2.prototype.updateEvent = function(path, val) {
      var _a;
      if (path.split(".")[0] === "integrations") {
        var integrationName = path.split(".")[1];
        if (((_a = this.event.integrations) === null || _a === void 0 ? void 0 : _a[integrationName]) === false) {
          return this.event;
        }
      }
      dset(this.event, path, val);
      return this.event;
    };
    CoreContext2.prototype.failedDelivery = function() {
      return this._failedDelivery;
    };
    CoreContext2.prototype.setFailedDelivery = function(options) {
      this._failedDelivery = options;
    };
    CoreContext2.prototype.logs = function() {
      return this.logger.logs;
    };
    CoreContext2.prototype.flush = function() {
      this.logger.flush();
      this.stats.flush();
    };
    CoreContext2.prototype.toJSON = function() {
      return {
        id: this._id,
        event: this.event,
        logs: this.logger.logs,
        metrics: this.stats.metrics
      };
    };
    return CoreContext2;
  })()
);

// node_modules/@segment/analytics-core/dist/esm/utils/group-by.js
function groupBy(collection, grouper) {
  var results = {};
  collection.forEach(function(item) {
    var _a;
    var key = void 0;
    {
      var suggestedKey = item[grouper];
      key = typeof suggestedKey !== "string" ? JSON.stringify(suggestedKey) : suggestedKey;
    }
    if (key === void 0) {
      return;
    }
    results[key] = __spreadArray(__spreadArray([], (_a = results[key]) !== null && _a !== void 0 ? _a : [], true), [item], false);
  });
  return results;
}

// node_modules/@segment/analytics-core/dist/esm/utils/is-thenable.js
var isThenable = function(value) {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
};

// node_modules/@segment/analytics-core/dist/esm/task/task-group.js
var createTaskGroup = function() {
  var taskCompletionPromise;
  var resolvePromise;
  var count = 0;
  return {
    done: function() {
      return taskCompletionPromise;
    },
    run: function(op) {
      var returnValue = op();
      if (isThenable(returnValue)) {
        if (++count === 1) {
          taskCompletionPromise = new Promise(function(res) {
            return resolvePromise = res;
          });
        }
        returnValue.finally(function() {
          return --count === 0 && resolvePromise();
        });
      }
      return returnValue;
    }
  };
};

// node_modules/@segment/analytics-core/dist/esm/queue/delivery.js
function tryAsync(fn) {
  return __awaiter(this, void 0, void 0, function() {
    var err_1;
    return __generator(this, function(_a) {
      switch (_a.label) {
        case 0:
          _a.trys.push([0, 2, , 3]);
          return [4, fn()];
        case 1:
          return [2, _a.sent()];
        case 2:
          err_1 = _a.sent();
          return [2, Promise.reject(err_1)];
        case 3:
          return [
            2
            /*return*/
          ];
      }
    });
  });
}
function attempt(ctx, plugin) {
  ctx.log("debug", "plugin", { plugin: plugin.name });
  var start = (/* @__PURE__ */ new Date()).getTime();
  var hook = plugin[ctx.event.type];
  if (hook === void 0) {
    return Promise.resolve(ctx);
  }
  var newCtx = tryAsync(function() {
    return hook.apply(plugin, [ctx]);
  }).then(function(ctx2) {
    var done = (/* @__PURE__ */ new Date()).getTime() - start;
    ctx2.stats.gauge("plugin_time", done, ["plugin:".concat(plugin.name)]);
    return ctx2;
  }).catch(function(err) {
    if (err instanceof ContextCancelation && err.type === "middleware_cancellation") {
      throw err;
    }
    if (err instanceof ContextCancelation) {
      ctx.log("warn", err.type, {
        plugin: plugin.name,
        error: err
      });
      return err;
    }
    ctx.log("error", "plugin Error", {
      plugin: plugin.name,
      error: err
    });
    ctx.stats.increment("plugin_error", 1, ["plugin:".concat(plugin.name)]);
    return err;
  });
  return newCtx;
}
function ensure(ctx, plugin) {
  return attempt(ctx, plugin).then(function(newContext) {
    if (newContext instanceof CoreContext) {
      return newContext;
    }
    ctx.log("debug", "Context canceled");
    ctx.stats.increment("context_canceled");
    ctx.cancel(newContext);
  });
}

// node_modules/@segment/analytics-core/dist/esm/queue/event-queue.js
var CoreEventQueue = (
  /** @class */
  (function(_super) {
    __extends(CoreEventQueue2, _super);
    function CoreEventQueue2(priorityQueue) {
      var _this = _super.call(this) || this;
      _this.criticalTasks = createTaskGroup();
      _this.plugins = [];
      _this.failedInitializations = [];
      _this.flushing = false;
      _this.queue = priorityQueue;
      _this.queue.on(ON_REMOVE_FROM_FUTURE, function() {
        _this.scheduleFlush(0);
      });
      return _this;
    }
    CoreEventQueue2.prototype.register = function(ctx, plugin, instance) {
      return __awaiter(this, void 0, void 0, function() {
        var handleLoadError, err_1;
        var _this = this;
        return __generator(this, function(_a) {
          switch (_a.label) {
            case 0:
              this.plugins.push(plugin);
              handleLoadError = function(err) {
                _this.failedInitializations.push(plugin.name);
                _this.emit("initialization_failure", plugin);
                console.warn(plugin.name, err);
                ctx.log("warn", "Failed to load destination", {
                  plugin: plugin.name,
                  error: err
                });
                _this.plugins = _this.plugins.filter(function(p) {
                  return p !== plugin;
                });
              };
              if (!(plugin.type === "destination" && plugin.name !== "Segment.io")) return [3, 1];
              plugin.load(ctx, instance).catch(handleLoadError);
              return [3, 4];
            case 1:
              _a.trys.push([1, 3, , 4]);
              return [4, plugin.load(ctx, instance)];
            case 2:
              _a.sent();
              return [3, 4];
            case 3:
              err_1 = _a.sent();
              handleLoadError(err_1);
              return [3, 4];
            case 4:
              return [
                2
                /*return*/
              ];
          }
        });
      });
    };
    CoreEventQueue2.prototype.deregister = function(ctx, plugin, instance) {
      return __awaiter(this, void 0, void 0, function() {
        var e_1;
        return __generator(this, function(_a) {
          switch (_a.label) {
            case 0:
              _a.trys.push([0, 3, , 4]);
              if (!plugin.unload) return [3, 2];
              return [4, Promise.resolve(plugin.unload(ctx, instance))];
            case 1:
              _a.sent();
              _a.label = 2;
            case 2:
              this.plugins = this.plugins.filter(function(p) {
                return p.name !== plugin.name;
              });
              return [3, 4];
            case 3:
              e_1 = _a.sent();
              ctx.log("warn", "Failed to unload destination", {
                plugin: plugin.name,
                error: e_1
              });
              return [3, 4];
            case 4:
              return [
                2
                /*return*/
              ];
          }
        });
      });
    };
    CoreEventQueue2.prototype.dispatch = function(ctx) {
      return __awaiter(this, void 0, void 0, function() {
        var willDeliver;
        return __generator(this, function(_a) {
          ctx.log("debug", "Dispatching");
          ctx.stats.increment("message_dispatched");
          this.queue.push(ctx);
          willDeliver = this.subscribeToDelivery(ctx);
          this.scheduleFlush(0);
          return [2, willDeliver];
        });
      });
    };
    CoreEventQueue2.prototype.subscribeToDelivery = function(ctx) {
      return __awaiter(this, void 0, void 0, function() {
        var _this = this;
        return __generator(this, function(_a) {
          return [2, new Promise(function(resolve) {
            var onDeliver = function(flushed, delivered) {
              if (flushed.isSame(ctx)) {
                _this.off("flush", onDeliver);
                if (delivered) {
                  resolve(flushed);
                } else {
                  resolve(flushed);
                }
              }
            };
            _this.on("flush", onDeliver);
          })];
        });
      });
    };
    CoreEventQueue2.prototype.dispatchSingle = function(ctx) {
      return __awaiter(this, void 0, void 0, function() {
        var _this = this;
        return __generator(this, function(_a) {
          ctx.log("debug", "Dispatching");
          ctx.stats.increment("message_dispatched");
          this.queue.updateAttempts(ctx);
          ctx.attempts = 1;
          return [2, this.deliver(ctx).catch(function(err) {
            var accepted = _this.enqueuRetry(err, ctx);
            if (!accepted) {
              ctx.setFailedDelivery({ reason: err });
              return ctx;
            }
            return _this.subscribeToDelivery(ctx);
          })];
        });
      });
    };
    CoreEventQueue2.prototype.isEmpty = function() {
      return this.queue.length === 0;
    };
    CoreEventQueue2.prototype.scheduleFlush = function(timeout) {
      var _this = this;
      if (timeout === void 0) {
        timeout = 500;
      }
      if (this.flushing) {
        return;
      }
      this.flushing = true;
      setTimeout(function() {
        _this.flush().then(function() {
          setTimeout(function() {
            _this.flushing = false;
            if (_this.queue.length) {
              _this.scheduleFlush(0);
            }
          }, 0);
        });
      }, timeout);
    };
    CoreEventQueue2.prototype.deliver = function(ctx) {
      return __awaiter(this, void 0, void 0, function() {
        var start, done, err_2, error;
        return __generator(this, function(_a) {
          switch (_a.label) {
            case 0:
              return [4, this.criticalTasks.done()];
            case 1:
              _a.sent();
              start = Date.now();
              _a.label = 2;
            case 2:
              _a.trys.push([2, 4, , 5]);
              return [4, this.flushOne(ctx)];
            case 3:
              ctx = _a.sent();
              done = Date.now() - start;
              this.emit("delivery_success", ctx);
              ctx.stats.gauge("delivered", done);
              ctx.log("debug", "Delivered", ctx.event);
              return [2, ctx];
            case 4:
              err_2 = _a.sent();
              error = err_2;
              ctx.log("error", "Failed to deliver", error);
              this.emit("delivery_failure", ctx, error);
              ctx.stats.increment("delivery_failed");
              throw err_2;
            case 5:
              return [
                2
                /*return*/
              ];
          }
        });
      });
    };
    CoreEventQueue2.prototype.enqueuRetry = function(err, ctx) {
      var retriable = !(err instanceof ContextCancelation) || err.retry;
      if (!retriable) {
        return false;
      }
      return this.queue.pushWithBackoff(ctx);
    };
    CoreEventQueue2.prototype.flush = function() {
      return __awaiter(this, void 0, void 0, function() {
        var ctx, err_3, accepted;
        return __generator(this, function(_a) {
          switch (_a.label) {
            case 0:
              if (this.queue.length === 0) {
                return [2, []];
              }
              ctx = this.queue.pop();
              if (!ctx) {
                return [2, []];
              }
              ctx.attempts = this.queue.getAttempts(ctx);
              _a.label = 1;
            case 1:
              _a.trys.push([1, 3, , 4]);
              return [4, this.deliver(ctx)];
            case 2:
              ctx = _a.sent();
              this.emit("flush", ctx, true);
              return [3, 4];
            case 3:
              err_3 = _a.sent();
              accepted = this.enqueuRetry(err_3, ctx);
              if (!accepted) {
                ctx.setFailedDelivery({ reason: err_3 });
                this.emit("flush", ctx, false);
              }
              return [2, []];
            case 4:
              return [2, [ctx]];
          }
        });
      });
    };
    CoreEventQueue2.prototype.isReady = function() {
      return true;
    };
    CoreEventQueue2.prototype.availableExtensions = function(denyList) {
      var available = this.plugins.filter(function(p) {
        var _a2, _b2, _c2;
        if (p.type !== "destination" && p.name !== "Segment.io") {
          return true;
        }
        var alternativeNameMatch = void 0;
        (_a2 = p.alternativeNames) === null || _a2 === void 0 ? void 0 : _a2.forEach(function(name) {
          if (denyList[name] !== void 0) {
            alternativeNameMatch = denyList[name];
          }
        });
        return (_c2 = (_b2 = denyList[p.name]) !== null && _b2 !== void 0 ? _b2 : alternativeNameMatch) !== null && _c2 !== void 0 ? _c2 : (p.name === "Segment.io" ? true : denyList.All) !== false;
      });
      var _a = groupBy(available, "type"), _b = _a.before, before = _b === void 0 ? [] : _b, _c = _a.enrichment, enrichment = _c === void 0 ? [] : _c, _d = _a.destination, destination = _d === void 0 ? [] : _d, _e = _a.after, after = _e === void 0 ? [] : _e;
      return {
        before,
        enrichment,
        destinations: destination,
        after
      };
    };
    CoreEventQueue2.prototype.flushOne = function(ctx) {
      var _a, _b;
      return __awaiter(this, void 0, void 0, function() {
        var _c, before, enrichment, _i, before_1, beforeWare, temp, _d, enrichment_1, enrichmentWare, temp, _e, destinations, after, afterCalls;
        return __generator(this, function(_f) {
          switch (_f.label) {
            case 0:
              if (!this.isReady()) {
                throw new Error("Not ready");
              }
              if (ctx.attempts > 1) {
                this.emit("delivery_retry", ctx);
              }
              _c = this.availableExtensions((_a = ctx.event.integrations) !== null && _a !== void 0 ? _a : {}), before = _c.before, enrichment = _c.enrichment;
              _i = 0, before_1 = before;
              _f.label = 1;
            case 1:
              if (!(_i < before_1.length)) return [3, 4];
              beforeWare = before_1[_i];
              return [4, ensure(ctx, beforeWare)];
            case 2:
              temp = _f.sent();
              if (temp instanceof CoreContext) {
                ctx = temp;
              }
              this.emit("message_enriched", ctx, beforeWare);
              _f.label = 3;
            case 3:
              _i++;
              return [3, 1];
            case 4:
              _d = 0, enrichment_1 = enrichment;
              _f.label = 5;
            case 5:
              if (!(_d < enrichment_1.length)) return [3, 8];
              enrichmentWare = enrichment_1[_d];
              return [4, attempt(ctx, enrichmentWare)];
            case 6:
              temp = _f.sent();
              if (temp instanceof CoreContext) {
                ctx = temp;
              }
              this.emit("message_enriched", ctx, enrichmentWare);
              _f.label = 7;
            case 7:
              _d++;
              return [3, 5];
            case 8:
              _e = this.availableExtensions((_b = ctx.event.integrations) !== null && _b !== void 0 ? _b : {}), destinations = _e.destinations, after = _e.after;
              return [4, new Promise(function(resolve, reject) {
                setTimeout(function() {
                  var attempts = destinations.map(function(destination) {
                    return attempt(ctx, destination);
                  });
                  Promise.all(attempts).then(resolve).catch(reject);
                }, 0);
              })];
            case 9:
              _f.sent();
              ctx.stats.increment("message_delivered");
              this.emit("message_delivered", ctx);
              afterCalls = after.map(function(after2) {
                return attempt(ctx, after2);
              });
              return [4, Promise.all(afterCalls)];
            case 10:
              _f.sent();
              return [2, ctx];
          }
        });
      });
    };
    return CoreEventQueue2;
  })(Emitter)
);

// node_modules/@segment/analytics-core/dist/esm/analytics/dispatch.js
var getDelay = function(startTimeInEpochMS, timeoutInMS) {
  var elapsedTime = Date.now() - startTimeInEpochMS;
  return Math.max((timeoutInMS !== null && timeoutInMS !== void 0 ? timeoutInMS : 300) - elapsedTime, 0);
};
function dispatch(ctx, queue, emitter, options) {
  return __awaiter(this, void 0, void 0, function() {
    var startTime, dispatched;
    return __generator(this, function(_a) {
      switch (_a.label) {
        case 0:
          emitter.emit("dispatch_start", ctx);
          startTime = Date.now();
          if (!queue.isEmpty()) return [3, 2];
          return [4, queue.dispatchSingle(ctx)];
        case 1:
          dispatched = _a.sent();
          return [3, 4];
        case 2:
          return [4, queue.dispatch(ctx)];
        case 3:
          dispatched = _a.sent();
          _a.label = 4;
        case 4:
          if (!(options === null || options === void 0 ? void 0 : options.callback)) return [3, 6];
          return [4, invokeCallback(dispatched, options.callback, getDelay(startTime, options.timeout))];
        case 5:
          dispatched = _a.sent();
          _a.label = 6;
        case 6:
          if (options === null || options === void 0 ? void 0 : options.debug) {
            dispatched.flush();
          }
          return [2, dispatched];
      }
    });
  });
}

// node_modules/@segment/analytics-core/dist/esm/utils/bind-all.js
function bindAll(obj) {
  var proto = obj.constructor.prototype;
  for (var _i = 0, _a = Object.getOwnPropertyNames(proto); _i < _a.length; _i++) {
    var key = _a[_i];
    if (key !== "constructor") {
      var desc = Object.getOwnPropertyDescriptor(obj.constructor.prototype, key);
      if (!!desc && typeof desc.value === "function") {
        obj[key] = obj[key].bind(obj);
      }
    }
  }
  return obj;
}

// node_modules/@segment/analytics-node/dist/esm/app/settings.js
var validateSettings = (settings) => {
  if (!settings.writeKey) {
    throw new ValidationError("writeKey", "writeKey is missing.");
  }
};

// node_modules/@segment/analytics-node/dist/esm/generated/version.js
var version = "3.0.0";

// node_modules/@segment/analytics-node/dist/esm/lib/create-url.js
var stripTrailingSlash = (str) => str.replace(/\/$/, "");
var tryCreateFormattedUrl = (host, path) => {
  return stripTrailingSlash(new URL(path || "", host).href);
};

// node_modules/@segment/analytics-node/dist/esm/plugins/segmentio/context-batch.js
var MAX_EVENT_SIZE_IN_KB = 32;
var MAX_BATCH_SIZE_IN_KB = 480;
var ContextBatch = class {
  id = v4();
  items = [];
  sizeInBytes = 0;
  maxEventCount;
  constructor(maxEventCount) {
    this.maxEventCount = Math.max(1, maxEventCount);
  }
  tryAdd(item) {
    if (this.length === this.maxEventCount)
      return {
        success: false,
        message: `Event limit of ${this.maxEventCount} has been exceeded.`
      };
    const eventSize = this.calculateSize(item.context);
    if (eventSize > MAX_EVENT_SIZE_IN_KB * 1024) {
      return {
        success: false,
        message: `Event exceeds maximum event size of ${MAX_EVENT_SIZE_IN_KB} KB`
      };
    }
    if (this.sizeInBytes + eventSize > MAX_BATCH_SIZE_IN_KB * 1024) {
      return {
        success: false,
        message: `Event has caused batch size to exceed ${MAX_BATCH_SIZE_IN_KB} KB`
      };
    }
    this.items.push(item);
    this.sizeInBytes += eventSize;
    return { success: true };
  }
  get length() {
    return this.items.length;
  }
  calculateSize(ctx) {
    return encodeURI(JSON.stringify(ctx.event)).split(/%..|i/).length;
  }
  getEvents() {
    const events = this.items.map(({ context }) => context.event);
    return events;
  }
  getContexts() {
    return this.items.map((item) => item.context);
  }
  resolveEvents() {
    this.items.forEach(({ resolver, context }) => resolver(context));
  }
};

// node_modules/jose/dist/node/esm/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0);
  const buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers) {
    buf.set(buffer, i);
    i += buffer.length;
  }
  return buf;
}

// node_modules/jose/dist/node/esm/runtime/base64url.js
var encode = (input) => Buffer$1.from(input).toString("base64url");

// node_modules/jose/dist/node/esm/util/errors.js
var JOSEError = class extends Error {
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var JOSENotSupported = class extends JOSEError {
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
};
var JWSInvalid = class extends JOSEError {
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
};
var JWTInvalid = class extends JOSEError {
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
};
var is_key_object_default = (obj) => util.types.isKeyObject(obj);
var webcrypto2 = crypto2.webcrypto;
var webcrypto_default = webcrypto2;
var isCryptoKey = (key) => util.types.isCryptoKey(key);

// node_modules/jose/dist/node/esm/lib/crypto_key.js
function unusable(name, prop = "algorithm.name") {
  return new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`);
}
function isAlgorithm(algorithm, name) {
  return algorithm.name === name;
}
function getHashLength(hash) {
  return parseInt(hash.name.slice(4), 10);
}
function getNamedCurve(alg) {
  switch (alg) {
    case "ES256":
      return "P-256";
    case "ES384":
      return "P-384";
    case "ES512":
      return "P-521";
    default:
      throw new Error("unreachable");
  }
}
function checkUsage(key, usages) {
  if (usages.length && !usages.some((expected) => key.usages.includes(expected))) {
    let msg = "CryptoKey does not support this operation, its usages must include ";
    if (usages.length > 2) {
      const last = usages.pop();
      msg += `one of ${usages.join(", ")}, or ${last}.`;
    } else if (usages.length === 2) {
      msg += `one of ${usages[0]} or ${usages[1]}.`;
    } else {
      msg += `${usages[0]}.`;
    }
    throw new TypeError(msg);
  }
}
function checkSigCryptoKey(key, alg, ...usages) {
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512": {
      if (!isAlgorithm(key.algorithm, "HMAC"))
        throw unusable("HMAC");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "RS256":
    case "RS384":
    case "RS512": {
      if (!isAlgorithm(key.algorithm, "RSASSA-PKCS1-v1_5"))
        throw unusable("RSASSA-PKCS1-v1_5");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "PS256":
    case "PS384":
    case "PS512": {
      if (!isAlgorithm(key.algorithm, "RSA-PSS"))
        throw unusable("RSA-PSS");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "EdDSA": {
      if (key.algorithm.name !== "Ed25519" && key.algorithm.name !== "Ed448") {
        throw unusable("Ed25519 or Ed448");
      }
      break;
    }
    case "Ed25519": {
      if (!isAlgorithm(key.algorithm, "Ed25519"))
        throw unusable("Ed25519");
      break;
    }
    case "ES256":
    case "ES384":
    case "ES512": {
      if (!isAlgorithm(key.algorithm, "ECDSA"))
        throw unusable("ECDSA");
      const expected = getNamedCurve(alg);
      const actual = key.algorithm.namedCurve;
      if (actual !== expected)
        throw unusable(expected, "algorithm.namedCurve");
      break;
    }
    default:
      throw new TypeError("CryptoKey does not support this operation");
  }
  checkUsage(key, usages);
}

// node_modules/jose/dist/node/esm/lib/invalid_key_input.js
function message(msg, actual, ...types4) {
  types4 = types4.filter(Boolean);
  if (types4.length > 2) {
    const last = types4.pop();
    msg += `one of type ${types4.join(", ")}, or ${last}.`;
  } else if (types4.length === 2) {
    msg += `one of type ${types4[0]} or ${types4[1]}.`;
  } else {
    msg += `of type ${types4[0]}.`;
  }
  if (actual == null) {
    msg += ` Received ${actual}`;
  } else if (typeof actual === "function" && actual.name) {
    msg += ` Received function ${actual.name}`;
  } else if (typeof actual === "object" && actual != null) {
    if (actual.constructor?.name) {
      msg += ` Received an instance of ${actual.constructor.name}`;
    }
  }
  return msg;
}
var invalid_key_input_default = (actual, ...types4) => {
  return message("Key must be ", actual, ...types4);
};
function withAlg(alg, actual, ...types4) {
  return message(`Key for the ${alg} algorithm must be `, actual, ...types4);
}

// node_modules/jose/dist/node/esm/runtime/is_key_like.js
var is_key_like_default = (key) => is_key_object_default(key) || isCryptoKey(key);
var types3 = ["KeyObject"];
if (globalThis.CryptoKey || webcrypto_default?.CryptoKey) {
  types3.push("CryptoKey");
}

// node_modules/jose/dist/node/esm/lib/is_disjoint.js
var isDisjoint = (...headers) => {
  const sources = headers.filter(Boolean);
  if (sources.length === 0 || sources.length === 1) {
    return true;
  }
  let acc;
  for (const header of sources) {
    const parameters = Object.keys(header);
    if (!acc || acc.size === 0) {
      acc = new Set(parameters);
      continue;
    }
    for (const parameter of parameters) {
      if (acc.has(parameter)) {
        return false;
      }
      acc.add(parameter);
    }
  }
  return true;
};
var is_disjoint_default = isDisjoint;

// node_modules/jose/dist/node/esm/lib/is_object.js
function isObjectLike(value) {
  return typeof value === "object" && value !== null;
}
function isObject(input) {
  if (!isObjectLike(input) || Object.prototype.toString.call(input) !== "[object Object]") {
    return false;
  }
  if (Object.getPrototypeOf(input) === null) {
    return true;
  }
  let proto = input;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getPrototypeOf(input) === proto;
}

// node_modules/jose/dist/node/esm/lib/is_jwk.js
function isJWK(key) {
  return isObject(key) && typeof key.kty === "string";
}
function isPrivateJWK(key) {
  return key.kty !== "oct" && typeof key.d === "string";
}
function isPublicJWK(key) {
  return key.kty !== "oct" && typeof key.d === "undefined";
}
function isSecretJWK(key) {
  return isJWK(key) && key.kty === "oct" && typeof key.k === "string";
}

// node_modules/jose/dist/node/esm/runtime/get_named_curve.js
var namedCurveToJOSE = (namedCurve) => {
  switch (namedCurve) {
    case "prime256v1":
      return "P-256";
    case "secp384r1":
      return "P-384";
    case "secp521r1":
      return "P-521";
    case "secp256k1":
      return "secp256k1";
    default:
      throw new JOSENotSupported("Unsupported key curve for this operation");
  }
};
var getNamedCurve2 = (kee, raw) => {
  let key;
  if (isCryptoKey(kee)) {
    key = KeyObject.from(kee);
  } else if (is_key_object_default(kee)) {
    key = kee;
  } else if (isJWK(kee)) {
    return kee.crv;
  } else {
    throw new TypeError(invalid_key_input_default(kee, ...types3));
  }
  if (key.type === "secret") {
    throw new TypeError('only "private" or "public" type keys can be used for this operation');
  }
  switch (key.asymmetricKeyType) {
    case "ed25519":
    case "ed448":
      return `Ed${key.asymmetricKeyType.slice(2)}`;
    case "x25519":
    case "x448":
      return `X${key.asymmetricKeyType.slice(1)}`;
    case "ec": {
      const namedCurve = key.asymmetricKeyDetails.namedCurve;
      if (raw) {
        return namedCurve;
      }
      return namedCurveToJOSE(namedCurve);
    }
    default:
      throw new TypeError("Invalid asymmetric key type for this operation");
  }
};
var get_named_curve_default = getNamedCurve2;
var check_key_length_default = (key, alg) => {
  let modulusLength;
  try {
    if (key instanceof KeyObject) {
      modulusLength = key.asymmetricKeyDetails?.modulusLength;
    } else {
      modulusLength = Buffer.from(key.n, "base64url").byteLength << 3;
    }
  } catch {
  }
  if (typeof modulusLength !== "number" || modulusLength < 2048) {
    throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
  }
};
var fromPKCS8 = (pem) => createPrivateKey({
  key: Buffer$1.from(pem.replace(/(?:-----(?:BEGIN|END) PRIVATE KEY-----|\s)/g, ""), "base64"),
  type: "pkcs8",
  format: "der"
});

// node_modules/jose/dist/node/esm/key/import.js
async function importPKCS8(pkcs8, alg, options) {
  if (typeof pkcs8 !== "string" || pkcs8.indexOf("-----BEGIN PRIVATE KEY-----") !== 0) {
    throw new TypeError('"pkcs8" must be PKCS#8 formatted string');
  }
  return fromPKCS8(pkcs8);
}

// node_modules/jose/dist/node/esm/lib/check_key_type.js
var tag = (key) => key?.[Symbol.toStringTag];
var jwkMatchesOp = (alg, key, usage) => {
  if (key.use !== void 0 && key.use !== "sig") {
    throw new TypeError("Invalid key for this operation, when present its use must be sig");
  }
  if (key.key_ops !== void 0 && key.key_ops.includes?.(usage) !== true) {
    throw new TypeError(`Invalid key for this operation, when present its key_ops must include ${usage}`);
  }
  if (key.alg !== void 0 && key.alg !== alg) {
    throw new TypeError(`Invalid key for this operation, when present its alg must be ${alg}`);
  }
  return true;
};
var symmetricTypeCheck = (alg, key, usage, allowJwk) => {
  if (key instanceof Uint8Array)
    return;
  if (allowJwk && isJWK(key)) {
    if (isSecretJWK(key) && jwkMatchesOp(alg, key, usage))
      return;
    throw new TypeError(`JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present`);
  }
  if (!is_key_like_default(key)) {
    throw new TypeError(withAlg(alg, key, ...types3, "Uint8Array", allowJwk ? "JSON Web Key" : null));
  }
  if (key.type !== "secret") {
    throw new TypeError(`${tag(key)} instances for symmetric algorithms must be of type "secret"`);
  }
};
var asymmetricTypeCheck = (alg, key, usage, allowJwk) => {
  if (allowJwk && isJWK(key)) {
    switch (usage) {
      case "sign":
        if (isPrivateJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a private JWK`);
      case "verify":
        if (isPublicJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a public JWK`);
    }
  }
  if (!is_key_like_default(key)) {
    throw new TypeError(withAlg(alg, key, ...types3, allowJwk ? "JSON Web Key" : null));
  }
  if (key.type === "secret") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithms must not be of type "secret"`);
  }
  if (usage === "sign" && key.type === "public") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm signing must be of type "private"`);
  }
  if (usage === "decrypt" && key.type === "public") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm decryption must be of type "private"`);
  }
  if (key.algorithm && usage === "verify" && key.type === "private") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm verifying must be of type "public"`);
  }
  if (key.algorithm && usage === "encrypt" && key.type === "private") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm encryption must be of type "public"`);
  }
};
function checkKeyType(allowJwk, alg, key, usage) {
  const symmetric = alg.startsWith("HS") || alg === "dir" || alg.startsWith("PBES2") || /^A\d{3}(?:GCM)?KW$/.test(alg);
  if (symmetric) {
    symmetricTypeCheck(alg, key, usage, allowJwk);
  } else {
    asymmetricTypeCheck(alg, key, usage, allowJwk);
  }
}
checkKeyType.bind(void 0, false);
var checkKeyTypeWithJwk = checkKeyType.bind(void 0, true);

// node_modules/jose/dist/node/esm/lib/validate_crit.js
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0) {
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  }
  if (!protectedHeader || protectedHeader.crit === void 0) {
    return /* @__PURE__ */ new Set();
  }
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input !== "string" || input.length === 0)) {
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  }
  let recognized;
  if (recognizedOption !== void 0) {
    recognized = new Map([...Object.entries(recognizedOption), ...recognizedDefault.entries()]);
  } else {
    recognized = recognizedDefault;
  }
  for (const parameter of protectedHeader.crit) {
    if (!recognized.has(parameter)) {
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    }
    if (joseHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    }
    if (recognized.get(parameter) && protectedHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
    }
  }
  return new Set(protectedHeader.crit);
}
var validate_crit_default = validateCrit;

// node_modules/jose/dist/node/esm/runtime/dsa_digest.js
function dsaDigest(alg) {
  switch (alg) {
    case "PS256":
    case "RS256":
    case "ES256":
    case "ES256K":
      return "sha256";
    case "PS384":
    case "RS384":
    case "ES384":
      return "sha384";
    case "PS512":
    case "RS512":
    case "ES512":
      return "sha512";
    case "Ed25519":
    case "EdDSA":
      return void 0;
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}
var ecCurveAlgMap = /* @__PURE__ */ new Map([
  ["ES256", "P-256"],
  ["ES256K", "secp256k1"],
  ["ES384", "P-384"],
  ["ES512", "P-521"]
]);
function keyForCrypto(alg, key) {
  let asymmetricKeyType;
  let asymmetricKeyDetails;
  let isJWK2;
  if (key instanceof KeyObject) {
    asymmetricKeyType = key.asymmetricKeyType;
    asymmetricKeyDetails = key.asymmetricKeyDetails;
  } else {
    isJWK2 = true;
    switch (key.kty) {
      case "RSA":
        asymmetricKeyType = "rsa";
        break;
      case "EC":
        asymmetricKeyType = "ec";
        break;
      case "OKP": {
        if (key.crv === "Ed25519") {
          asymmetricKeyType = "ed25519";
          break;
        }
        if (key.crv === "Ed448") {
          asymmetricKeyType = "ed448";
          break;
        }
        throw new TypeError("Invalid key for this operation, its crv must be Ed25519 or Ed448");
      }
      default:
        throw new TypeError("Invalid key for this operation, its kty must be RSA, OKP, or EC");
    }
  }
  let options;
  switch (alg) {
    case "Ed25519":
      if (asymmetricKeyType !== "ed25519") {
        throw new TypeError(`Invalid key for this operation, its asymmetricKeyType must be ed25519`);
      }
      break;
    case "EdDSA":
      if (!["ed25519", "ed448"].includes(asymmetricKeyType)) {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be ed25519 or ed448");
      }
      break;
    case "RS256":
    case "RS384":
    case "RS512":
      if (asymmetricKeyType !== "rsa") {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be rsa");
      }
      check_key_length_default(key, alg);
      break;
    case "PS256":
    case "PS384":
    case "PS512":
      if (asymmetricKeyType === "rsa-pss") {
        const { hashAlgorithm, mgf1HashAlgorithm, saltLength } = asymmetricKeyDetails;
        const length = parseInt(alg.slice(-3), 10);
        if (hashAlgorithm !== void 0 && (hashAlgorithm !== `sha${length}` || mgf1HashAlgorithm !== hashAlgorithm)) {
          throw new TypeError(`Invalid key for this operation, its RSA-PSS parameters do not meet the requirements of "alg" ${alg}`);
        }
        if (saltLength !== void 0 && saltLength > length >> 3) {
          throw new TypeError(`Invalid key for this operation, its RSA-PSS parameter saltLength does not meet the requirements of "alg" ${alg}`);
        }
      } else if (asymmetricKeyType !== "rsa") {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be rsa or rsa-pss");
      }
      check_key_length_default(key, alg);
      options = {
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST
      };
      break;
    case "ES256":
    case "ES256K":
    case "ES384":
    case "ES512": {
      if (asymmetricKeyType !== "ec") {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be ec");
      }
      const actual = get_named_curve_default(key);
      const expected = ecCurveAlgMap.get(alg);
      if (actual !== expected) {
        throw new TypeError(`Invalid key curve for the algorithm, its curve must be ${expected}, got ${actual}`);
      }
      options = { dsaEncoding: "ieee-p1363" };
      break;
    }
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
  if (isJWK2) {
    return { format: "jwk", key, ...options };
  }
  return options ? { ...options, key } : key;
}

// node_modules/jose/dist/node/esm/runtime/hmac_digest.js
function hmacDigest(alg) {
  switch (alg) {
    case "HS256":
      return "sha256";
    case "HS384":
      return "sha384";
    case "HS512":
      return "sha512";
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}
function getSignVerifyKey(alg, key, usage) {
  if (key instanceof Uint8Array) {
    if (!alg.startsWith("HS")) {
      throw new TypeError(invalid_key_input_default(key, ...types3));
    }
    return createSecretKey(key);
  }
  if (key instanceof KeyObject) {
    return key;
  }
  if (isCryptoKey(key)) {
    checkSigCryptoKey(key, alg, usage);
    return KeyObject.from(key);
  }
  if (isJWK(key)) {
    if (alg.startsWith("HS")) {
      return createSecretKey(Buffer.from(key.k, "base64url"));
    }
    return key;
  }
  throw new TypeError(invalid_key_input_default(key, ...types3, "Uint8Array", "JSON Web Key"));
}

// node_modules/jose/dist/node/esm/runtime/sign.js
var oneShotSign = promisify(crypto2.sign);
var sign2 = async (alg, key, data) => {
  const k = getSignVerifyKey(alg, key, "sign");
  if (alg.startsWith("HS")) {
    const hmac = crypto2.createHmac(hmacDigest(alg), k);
    hmac.update(data);
    return hmac.digest();
  }
  return oneShotSign(dsaDigest(alg), data, keyForCrypto(alg, k));
};
var sign_default = sign2;

// node_modules/jose/dist/node/esm/lib/epoch.js
var epoch_default = (date) => Math.floor(date.getTime() / 1e3);

// node_modules/jose/dist/node/esm/lib/secs.js
var minute = 60;
var hour = minute * 60;
var day = hour * 24;
var week = day * 7;
var year = day * 365.25;
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var secs_default = (str) => {
  const matched = REGEX.exec(str);
  if (!matched || matched[4] && matched[1]) {
    throw new TypeError("Invalid time period format");
  }
  const value = parseFloat(matched[2]);
  const unit = matched[3].toLowerCase();
  let numericDate;
  switch (unit) {
    case "sec":
    case "secs":
    case "second":
    case "seconds":
    case "s":
      numericDate = Math.round(value);
      break;
    case "minute":
    case "minutes":
    case "min":
    case "mins":
    case "m":
      numericDate = Math.round(value * minute);
      break;
    case "hour":
    case "hours":
    case "hr":
    case "hrs":
    case "h":
      numericDate = Math.round(value * hour);
      break;
    case "day":
    case "days":
    case "d":
      numericDate = Math.round(value * day);
      break;
    case "week":
    case "weeks":
    case "w":
      numericDate = Math.round(value * week);
      break;
    default:
      numericDate = Math.round(value * year);
      break;
  }
  if (matched[1] === "-" || matched[4] === "ago") {
    return -numericDate;
  }
  return numericDate;
};

// node_modules/jose/dist/node/esm/jws/flattened/sign.js
var FlattenedSign = class {
  _payload;
  _protectedHeader;
  _unprotectedHeader;
  constructor(payload) {
    if (!(payload instanceof Uint8Array)) {
      throw new TypeError("payload must be an instance of Uint8Array");
    }
    this._payload = payload;
  }
  setProtectedHeader(protectedHeader) {
    if (this._protectedHeader) {
      throw new TypeError("setProtectedHeader can only be called once");
    }
    this._protectedHeader = protectedHeader;
    return this;
  }
  setUnprotectedHeader(unprotectedHeader) {
    if (this._unprotectedHeader) {
      throw new TypeError("setUnprotectedHeader can only be called once");
    }
    this._unprotectedHeader = unprotectedHeader;
    return this;
  }
  async sign(key, options) {
    if (!this._protectedHeader && !this._unprotectedHeader) {
      throw new JWSInvalid("either setProtectedHeader or setUnprotectedHeader must be called before #sign()");
    }
    if (!is_disjoint_default(this._protectedHeader, this._unprotectedHeader)) {
      throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
    }
    const joseHeader = {
      ...this._protectedHeader,
      ...this._unprotectedHeader
    };
    const extensions = validate_crit_default(JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, this._protectedHeader, joseHeader);
    let b64 = true;
    if (extensions.has("b64")) {
      b64 = this._protectedHeader.b64;
      if (typeof b64 !== "boolean") {
        throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
      }
    }
    const { alg } = joseHeader;
    if (typeof alg !== "string" || !alg) {
      throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
    }
    checkKeyTypeWithJwk(alg, key, "sign");
    let payload = this._payload;
    if (b64) {
      payload = encoder.encode(encode(payload));
    }
    let protectedHeader;
    if (this._protectedHeader) {
      protectedHeader = encoder.encode(encode(JSON.stringify(this._protectedHeader)));
    } else {
      protectedHeader = encoder.encode("");
    }
    const data = concat(protectedHeader, encoder.encode("."), payload);
    const signature = await sign_default(alg, key, data);
    const jws = {
      signature: encode(signature),
      payload: ""
    };
    if (b64) {
      jws.payload = decoder.decode(payload);
    }
    if (this._unprotectedHeader) {
      jws.header = this._unprotectedHeader;
    }
    if (this._protectedHeader) {
      jws.protected = decoder.decode(protectedHeader);
    }
    return jws;
  }
};

// node_modules/jose/dist/node/esm/jws/compact/sign.js
var CompactSign = class {
  _flattened;
  constructor(payload) {
    this._flattened = new FlattenedSign(payload);
  }
  setProtectedHeader(protectedHeader) {
    this._flattened.setProtectedHeader(protectedHeader);
    return this;
  }
  async sign(key, options) {
    const jws = await this._flattened.sign(key, options);
    if (jws.payload === void 0) {
      throw new TypeError("use the flattened module for creating JWS with b64: false");
    }
    return `${jws.protected}.${jws.payload}.${jws.signature}`;
  }
};

// node_modules/jose/dist/node/esm/jwt/produce.js
function validateInput(label, input) {
  if (!Number.isFinite(input)) {
    throw new TypeError(`Invalid ${label} input`);
  }
  return input;
}
var ProduceJWT = class {
  _payload;
  constructor(payload = {}) {
    if (!isObject(payload)) {
      throw new TypeError("JWT Claims Set MUST be an object");
    }
    this._payload = payload;
  }
  setIssuer(issuer) {
    this._payload = { ...this._payload, iss: issuer };
    return this;
  }
  setSubject(subject) {
    this._payload = { ...this._payload, sub: subject };
    return this;
  }
  setAudience(audience) {
    this._payload = { ...this._payload, aud: audience };
    return this;
  }
  setJti(jwtId) {
    this._payload = { ...this._payload, jti: jwtId };
    return this;
  }
  setNotBefore(input) {
    if (typeof input === "number") {
      this._payload = { ...this._payload, nbf: validateInput("setNotBefore", input) };
    } else if (input instanceof Date) {
      this._payload = { ...this._payload, nbf: validateInput("setNotBefore", epoch_default(input)) };
    } else {
      this._payload = { ...this._payload, nbf: epoch_default(/* @__PURE__ */ new Date()) + secs_default(input) };
    }
    return this;
  }
  setExpirationTime(input) {
    if (typeof input === "number") {
      this._payload = { ...this._payload, exp: validateInput("setExpirationTime", input) };
    } else if (input instanceof Date) {
      this._payload = { ...this._payload, exp: validateInput("setExpirationTime", epoch_default(input)) };
    } else {
      this._payload = { ...this._payload, exp: epoch_default(/* @__PURE__ */ new Date()) + secs_default(input) };
    }
    return this;
  }
  setIssuedAt(input) {
    if (typeof input === "undefined") {
      this._payload = { ...this._payload, iat: epoch_default(/* @__PURE__ */ new Date()) };
    } else if (input instanceof Date) {
      this._payload = { ...this._payload, iat: validateInput("setIssuedAt", epoch_default(input)) };
    } else if (typeof input === "string") {
      this._payload = {
        ...this._payload,
        iat: validateInput("setIssuedAt", epoch_default(/* @__PURE__ */ new Date()) + secs_default(input))
      };
    } else {
      this._payload = { ...this._payload, iat: validateInput("setIssuedAt", input) };
    }
    return this;
  }
};

// node_modules/jose/dist/node/esm/jwt/sign.js
var SignJWT = class extends ProduceJWT {
  _protectedHeader;
  setProtectedHeader(protectedHeader) {
    this._protectedHeader = protectedHeader;
    return this;
  }
  async sign(key, options) {
    const sig = new CompactSign(encoder.encode(JSON.stringify(this._payload)));
    sig.setProtectedHeader(this._protectedHeader);
    if (Array.isArray(this._protectedHeader?.crit) && this._protectedHeader.crit.includes("b64") && this._protectedHeader.b64 === false) {
      throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
    }
    return sig.sign(key, options);
  }
};

// node_modules/@segment/analytics-node/dist/esm/lib/token-manager.js
var isAccessToken = (thing) => {
  return Boolean(thing && typeof thing === "object" && "access_token" in thing && "expires_in" in thing && typeof thing.access_token === "string" && typeof thing.expires_in === "number");
};
var isValidCustomResponse = (response) => {
  return typeof response.text === "function";
};
function convertHeaders(headers) {
  const lowercaseHeaders = {};
  if (!headers)
    return {};
  if (isHeaders(headers)) {
    for (const [name, value] of headers.entries()) {
      lowercaseHeaders[name.toLowerCase()] = value;
    }
    return lowercaseHeaders;
  }
  for (const [name, value] of Object.entries(headers)) {
    lowercaseHeaders[name.toLowerCase()] = value;
  }
  return lowercaseHeaders;
}
function isHeaders(thing) {
  if (typeof thing === "object" && thing !== null && "entries" in Object(thing) && typeof Object(thing).entries === "function") {
    return true;
  }
  return false;
}
var TokenManager = class {
  alg = "RS256";
  grantType = "client_credentials";
  clientAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
  clientId;
  clientKey;
  keyId;
  scope;
  authServer;
  httpClient;
  maxRetries;
  clockSkewInSeconds = 0;
  accessToken;
  tokenEmitter = new Emitter();
  retryCount;
  pollerTimer;
  constructor(props) {
    this.keyId = props.keyId;
    this.clientId = props.clientId;
    this.clientKey = props.clientKey;
    this.authServer = props.authServer ?? "https://oauth2.segment.io";
    this.scope = props.scope ?? "tracking_api:write";
    this.httpClient = props.httpClient;
    this.maxRetries = props.maxRetries;
    this.tokenEmitter.on("access_token", (event) => {
      if ("token" in event) {
        this.accessToken = event.token;
      }
    });
    this.retryCount = 0;
  }
  stopPoller() {
    clearTimeout(this.pollerTimer);
  }
  async pollerLoop() {
    let timeUntilRefreshInMs = 25;
    let response;
    try {
      response = await this.requestAccessToken();
    } catch (err) {
      return this.handleTransientError({ error: err });
    }
    if (!isValidCustomResponse(response)) {
      return this.handleInvalidCustomResponse();
    }
    const headers = convertHeaders(response.headers);
    if (headers["date"]) {
      this.updateClockSkew(Date.parse(headers["date"]));
    }
    if (response.status === 200) {
      try {
        const body = await response.text();
        const token = JSON.parse(body);
        if (!isAccessToken(token)) {
          throw new Error("Response did not contain a valid access_token and expires_in");
        }
        token.expires_at = Math.round(Date.now() / 1e3) + token.expires_in;
        this.tokenEmitter.emit("access_token", { token });
        this.retryCount = 0;
        timeUntilRefreshInMs = token.expires_in / 2 * 1e3;
        return this.queueNextPoll(timeUntilRefreshInMs);
      } catch (err) {
        return this.handleTransientError({ error: err, forceEmitError: true });
      }
    } else if (response.status === 429) {
      return await this.handleRateLimited(response, headers, timeUntilRefreshInMs);
    } else if ([400, 401, 415].includes(response.status)) {
      return this.handleUnrecoverableErrors(response);
    } else {
      return this.handleTransientError({
        error: new Error(`[${response.status}] ${response.statusText}`)
      });
    }
  }
  handleTransientError({ error, forceEmitError }) {
    this.incrementRetries({ error, forceEmitError });
    const timeUntilRefreshInMs = backoff({
      attempt: this.retryCount,
      minTimeout: 25,
      maxTimeout: 1e3
    });
    this.queueNextPoll(timeUntilRefreshInMs);
  }
  handleInvalidCustomResponse() {
    this.tokenEmitter.emit("access_token", {
      error: new Error("HTTPClient does not implement response.text method")
    });
  }
  async handleRateLimited(response, headers, timeUntilRefreshInMs) {
    this.incrementRetries({
      error: new Error(`[${response.status}] ${response.statusText}`)
    });
    if (headers["x-ratelimit-reset"]) {
      const rateLimitResetTimestamp = parseInt(headers["x-ratelimit-reset"], 10);
      if (isFinite(rateLimitResetTimestamp)) {
        timeUntilRefreshInMs = rateLimitResetTimestamp - Date.now() + this.clockSkewInSeconds * 1e3;
      } else {
        timeUntilRefreshInMs = 5 * 1e3;
      }
      await sleep(timeUntilRefreshInMs);
      timeUntilRefreshInMs = 0;
    }
    this.queueNextPoll(timeUntilRefreshInMs);
  }
  handleUnrecoverableErrors(response) {
    this.retryCount = 0;
    this.tokenEmitter.emit("access_token", {
      error: new Error(`[${response.status}] ${response.statusText}`)
    });
    this.stopPoller();
  }
  updateClockSkew(dateInMs) {
    this.clockSkewInSeconds = (Date.now() - dateInMs) / 1e3;
  }
  incrementRetries({ error, forceEmitError }) {
    this.retryCount++;
    if (forceEmitError || this.retryCount % this.maxRetries === 0) {
      this.retryCount = 0;
      this.tokenEmitter.emit("access_token", { error });
    }
  }
  queueNextPoll(timeUntilRefreshInMs) {
    this.pollerTimer = setTimeout(() => this.pollerLoop(), timeUntilRefreshInMs);
    if (this.pollerTimer.unref) {
      this.pollerTimer.unref();
    }
  }
  /**
   * Solely responsible for building the HTTP request and calling the token service.
   */
  async requestAccessToken() {
    const ISSUED_AT_BUFFER_IN_SECONDS = 5;
    const MAX_EXPIRY_IN_SECONDS = 60;
    const EXPIRY_IN_SECONDS = MAX_EXPIRY_IN_SECONDS - ISSUED_AT_BUFFER_IN_SECONDS;
    const jti = v4();
    const currentUTCInSeconds = Math.round(Date.now() / 1e3) - this.clockSkewInSeconds;
    const jwtBody = {
      iss: this.clientId,
      sub: this.clientId,
      aud: this.authServer,
      iat: currentUTCInSeconds - ISSUED_AT_BUFFER_IN_SECONDS,
      exp: currentUTCInSeconds + EXPIRY_IN_SECONDS,
      jti
    };
    const key = await importPKCS8(this.clientKey);
    const signedJwt = await new SignJWT(jwtBody).setProtectedHeader({ alg: this.alg, kid: this.keyId, typ: "JWT" }).sign(key);
    const requestBody = `grant_type=${this.grantType}&client_assertion_type=${this.clientAssertionType}&client_assertion=${signedJwt}&scope=${this.scope}`;
    const accessTokenEndpoint = `${this.authServer}/token`;
    const requestOptions = {
      method: "POST",
      url: accessTokenEndpoint,
      body: requestBody,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      httpRequestTimeout: 1e4
    };
    return this.httpClient.makeRequest(requestOptions);
  }
  async getAccessToken() {
    if (this.isValidToken(this.accessToken)) {
      return this.accessToken;
    }
    this.stopPoller();
    this.pollerLoop().catch(() => {
    });
    return new Promise((resolve, reject) => {
      this.tokenEmitter.once("access_token", (event) => {
        if ("token" in event) {
          resolve(event.token);
        } else {
          reject(event.error);
        }
      });
    });
  }
  clearToken() {
    this.accessToken = void 0;
  }
  isValidToken(token) {
    return typeof token !== "undefined" && token !== null && token.expires_in < Date.now() / 1e3;
  }
};

// node_modules/@segment/analytics-node/dist/esm/plugins/segmentio/publisher.js
function sleep2(timeoutInMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutInMs));
}
function noop() {
}
var Publisher = class {
  pendingFlushTimeout;
  _batch;
  _flushInterval;
  _flushAt;
  _maxRetries;
  _url;
  _flushPendingItemsCount;
  _httpRequestTimeout;
  _emitter;
  _disable;
  _httpClient;
  _writeKey;
  _tokenManager;
  constructor({ host, path, maxRetries, flushAt, flushInterval, writeKey, httpRequestTimeout, httpClient, disable, oauthSettings }, emitter) {
    this._emitter = emitter;
    this._maxRetries = maxRetries;
    this._flushAt = Math.max(flushAt, 1);
    this._flushInterval = flushInterval;
    this._url = tryCreateFormattedUrl(host ?? "https://api.segment.io", path ?? "/v1/batch");
    this._httpRequestTimeout = httpRequestTimeout ?? 1e4;
    this._disable = Boolean(disable);
    this._httpClient = httpClient;
    this._writeKey = writeKey;
    if (oauthSettings) {
      this._tokenManager = new TokenManager({
        ...oauthSettings,
        httpClient: oauthSettings.httpClient ?? httpClient,
        maxRetries: oauthSettings.maxRetries ?? maxRetries
      });
    }
  }
  createBatch() {
    this.pendingFlushTimeout && clearTimeout(this.pendingFlushTimeout);
    const batch = new ContextBatch(this._flushAt);
    this._batch = batch;
    this.pendingFlushTimeout = setTimeout(() => {
      if (batch === this._batch) {
        this._batch = void 0;
      }
      this.pendingFlushTimeout = void 0;
      if (batch.length) {
        this.send(batch).catch(noop);
      }
    }, this._flushInterval);
    return batch;
  }
  clearBatch() {
    this.pendingFlushTimeout && clearTimeout(this.pendingFlushTimeout);
    this._batch = void 0;
  }
  flush(pendingItemsCount) {
    if (!pendingItemsCount) {
      if (this._tokenManager) {
        this._tokenManager.stopPoller();
      }
      return;
    }
    this._flushPendingItemsCount = pendingItemsCount;
    if (!this._batch)
      return;
    const isExpectingNoMoreItems = this._batch.length === pendingItemsCount;
    if (isExpectingNoMoreItems) {
      this.send(this._batch).catch(noop).finally(() => {
        if (this._tokenManager) {
          this._tokenManager.stopPoller();
        }
      });
      this.clearBatch();
    }
  }
  /**
   * Enqueues the context for future delivery.
   * @param ctx - Context containing a Segment event.
   * @returns a promise that resolves with the context after the event has been delivered.
   */
  enqueue(ctx) {
    const batch = this._batch ?? this.createBatch();
    const { promise: ctxPromise, resolve } = createDeferred();
    const pendingItem = {
      context: ctx,
      resolver: resolve
    };
    const addStatus = batch.tryAdd(pendingItem);
    if (addStatus.success) {
      const isExpectingNoMoreItems = batch.length === this._flushPendingItemsCount;
      const isFull = batch.length === this._flushAt;
      if (isFull || isExpectingNoMoreItems) {
        this.send(batch).catch(noop);
        this.clearBatch();
      }
      return ctxPromise;
    }
    if (batch.length) {
      this.send(batch).catch(noop);
      this.clearBatch();
    }
    const fallbackBatch = this.createBatch();
    const fbAddStatus = fallbackBatch.tryAdd(pendingItem);
    if (fbAddStatus.success) {
      const isExpectingNoMoreItems = fallbackBatch.length === this._flushPendingItemsCount;
      if (isExpectingNoMoreItems) {
        this.send(fallbackBatch).catch(noop);
        this.clearBatch();
      }
      return ctxPromise;
    } else {
      ctx.setFailedDelivery({
        reason: new Error(fbAddStatus.message)
      });
      return Promise.resolve(ctx);
    }
  }
  async send(batch) {
    if (this._flushPendingItemsCount) {
      this._flushPendingItemsCount -= batch.length;
    }
    const events = batch.getEvents();
    const maxAttempts = this._maxRetries + 1;
    let currentAttempt = 0;
    while (currentAttempt < maxAttempts) {
      currentAttempt++;
      let requestedRetryTimeout;
      let failureReason;
      try {
        if (this._disable) {
          return batch.resolveEvents();
        }
        let authString = void 0;
        if (this._tokenManager) {
          const token = await this._tokenManager.getAccessToken();
          if (token && token.access_token) {
            authString = `Bearer ${token.access_token}`;
          }
        }
        const headers = {
          "Content-Type": "application/json",
          "User-Agent": "analytics-node-next/latest",
          ...authString ? { Authorization: authString } : {}
        };
        const request = {
          url: this._url,
          method: "POST",
          headers,
          body: JSON.stringify({
            batch: events,
            writeKey: this._writeKey,
            sentAt: /* @__PURE__ */ new Date()
          }),
          httpRequestTimeout: this._httpRequestTimeout
        };
        this._emitter.emit("http_request", {
          body: request.body,
          method: request.method,
          url: request.url,
          headers: request.headers
        });
        const response = await this._httpClient.makeRequest(request);
        if (response.status >= 200 && response.status < 300) {
          batch.resolveEvents();
          return;
        } else if (this._tokenManager && (response.status === 400 || response.status === 401 || response.status === 403)) {
          this._tokenManager.clearToken();
          failureReason = new Error(`[${response.status}] ${response.statusText}`);
        } else if (response.status === 400) {
          resolveFailedBatch(batch, new Error(`[${response.status}] ${response.statusText}`));
          return;
        } else if (response.status === 429) {
          if (response.headers && "x-ratelimit-reset" in response.headers) {
            const rateLimitResetTimestamp = parseInt(response.headers["x-ratelimit-reset"], 10);
            if (isFinite(rateLimitResetTimestamp)) {
              requestedRetryTimeout = rateLimitResetTimestamp - Date.now();
            }
          }
          failureReason = new Error(`[${response.status}] ${response.statusText}`);
        } else {
          failureReason = new Error(`[${response.status}] ${response.statusText}`);
        }
      } catch (err) {
        failureReason = err;
      }
      if (currentAttempt === maxAttempts) {
        resolveFailedBatch(batch, failureReason);
        return;
      }
      await sleep2(requestedRetryTimeout ? requestedRetryTimeout : backoff({
        attempt: currentAttempt,
        minTimeout: 25,
        maxTimeout: 1e3
      }));
    }
  }
};
function resolveFailedBatch(batch, reason) {
  batch.getContexts().forEach((ctx) => ctx.setFailedDelivery({ reason }));
  batch.resolveEvents();
}

// node_modules/@segment/analytics-node/dist/esm/lib/env.js
var detectRuntime = () => {
  if (typeof process === "object" && process && typeof process.env === "object" && process.env && typeof process.version === "string") {
    return "node";
  }
  if (typeof window === "object") {
    return "browser";
  }
  if (typeof WebSocketPair !== "undefined") {
    return "cloudflare-worker";
  }
  if (typeof EdgeRuntime === "string") {
    return "vercel-edge";
  }
  if (
    // @ts-ignore
    typeof WorkerGlobalScope !== "undefined" && // @ts-ignore
    typeof importScripts === "function"
  ) {
    return "web-worker";
  }
  return "unknown";
};

// node_modules/@segment/analytics-node/dist/esm/plugins/segmentio/index.js
function normalizeEvent(ctx) {
  ctx.updateEvent("context.library.name", "@segment/analytics-node");
  ctx.updateEvent("context.library.version", version);
  const runtime = detectRuntime();
  if (runtime === "node") {
    ctx.updateEvent("_metadata.nodeVersion", process.version);
  }
  ctx.updateEvent("_metadata.jsRuntime", runtime);
}
function createNodePlugin(publisher) {
  function action(ctx) {
    normalizeEvent(ctx);
    return publisher.enqueue(ctx);
  }
  return {
    name: "Segment.io",
    type: "destination",
    version: "1.0.0",
    isLoaded: () => true,
    load: () => Promise.resolve(),
    alias: action,
    group: action,
    identify: action,
    page: action,
    screen: action,
    track: action
  };
}
var createConfiguredNodePlugin = (props, emitter) => {
  const publisher = new Publisher(props, emitter);
  return {
    publisher,
    plugin: createNodePlugin(publisher)
  };
};

// node_modules/@segment/analytics-node/dist/esm/lib/get-message-id.js
var createMessageId = () => {
  return `node-next-${Date.now()}-${v4()}`;
};

// node_modules/@segment/analytics-node/dist/esm/app/event-factory.js
var NodeEventFactory = class extends CoreEventFactory {
  constructor() {
    super({
      createMessageId,
      onFinishedEvent: (event) => {
        assertUserIdentity(event);
      }
    });
  }
};

// node_modules/@segment/analytics-node/dist/esm/app/context.js
var Context = class extends CoreContext {
  static system() {
    return new this({ type: "track", event: "system" });
  }
};

// node_modules/@segment/analytics-node/dist/esm/app/dispatch-emit.js
var normalizeDispatchCb = (cb) => (ctx) => {
  const failedDelivery = ctx.failedDelivery();
  return failedDelivery ? cb(failedDelivery.reason, ctx) : cb(void 0, ctx);
};
var dispatchAndEmit = async (event, queue, emitter, callback) => {
  try {
    const context = new Context(event);
    const ctx = await dispatch(context, queue, emitter, {
      ...callback ? { callback: normalizeDispatchCb(callback) } : {}
    });
    const failedDelivery = ctx.failedDelivery();
    if (failedDelivery) {
      emitter.emit("error", {
        code: "delivery_failure",
        reason: failedDelivery.reason,
        ctx
      });
    } else {
      emitter.emit(event.type, ctx);
    }
  } catch (err) {
    emitter.emit("error", {
      code: "unknown",
      reason: err
    });
  }
};

// node_modules/@segment/analytics-node/dist/esm/app/emitter.js
var NodeEmitter = class extends Emitter {
};

// node_modules/@segment/analytics-node/dist/esm/app/event-queue.js
var NodePriorityQueue = class extends PriorityQueue {
  constructor() {
    super(1, []);
  }
  // do not use an internal "seen" map
  getAttempts(ctx) {
    return ctx.attempts ?? 0;
  }
  updateAttempts(ctx) {
    ctx.attempts = this.getAttempts(ctx) + 1;
    return this.getAttempts(ctx);
  }
};
var NodeEventQueue = class extends CoreEventQueue {
  constructor() {
    super(new NodePriorityQueue());
  }
};

// node_modules/@segment/analytics-node/dist/esm/lib/abort.js
var AbortSignal = class {
  onabort = null;
  aborted = false;
  eventEmitter = new Emitter();
  toString() {
    return "[object AbortSignal]";
  }
  get [Symbol.toStringTag]() {
    return "AbortSignal";
  }
  removeEventListener(...args) {
    this.eventEmitter.off(...args);
  }
  addEventListener(...args) {
    this.eventEmitter.on(...args);
  }
  dispatchEvent(type) {
    const event = { type, target: this };
    const handlerName = `on${type}`;
    if (typeof this[handlerName] === "function") {
      this[handlerName](event);
    }
    this.eventEmitter.emit(type, event);
  }
};
var AbortController2 = class {
  signal = new AbortSignal();
  abort() {
    if (this.signal.aborted)
      return;
    this.signal.aborted = true;
    this.signal.dispatchEvent("abort");
  }
  toString() {
    return "[object AbortController]";
  }
  get [Symbol.toStringTag]() {
    return "AbortController";
  }
};
var abortSignalAfterTimeout = (timeoutMs) => {
  if (detectRuntime() === "cloudflare-worker") {
    return [];
  }
  const ac = new (globalThis.AbortController || AbortController2)();
  const timeoutId = setTimeout(() => {
    ac.abort();
  }, timeoutMs);
  timeoutId?.unref?.();
  return [ac.signal, timeoutId];
};

// node_modules/@segment/analytics-node/dist/esm/lib/fetch.js
var fetch2 = (...args) => {
  return globalThis.fetch(...args);
};

// node_modules/@segment/analytics-node/dist/esm/lib/http-client.js
var FetchHTTPClient = class {
  _fetch;
  constructor(fetchFn) {
    this._fetch = fetchFn ?? fetch2;
  }
  async makeRequest(options) {
    const [signal, timeoutId] = abortSignalAfterTimeout(options.httpRequestTimeout);
    const requestInit = {
      url: options.url,
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal
    };
    return this._fetch(options.url, requestInit).finally(() => clearTimeout(timeoutId));
  }
};

// node_modules/@segment/analytics-node/dist/esm/app/analytics-node.js
var Analytics = class extends NodeEmitter {
  _eventFactory;
  _isClosed = false;
  _pendingEvents = 0;
  _closeAndFlushDefaultTimeout;
  _publisher;
  _isFlushing = false;
  _queue;
  ready;
  constructor(settings) {
    super();
    validateSettings(settings);
    this._eventFactory = new NodeEventFactory();
    this._queue = new NodeEventQueue();
    const flushInterval = settings.flushInterval ?? 1e4;
    this._closeAndFlushDefaultTimeout = flushInterval * 1.25;
    const { plugin, publisher } = createConfiguredNodePlugin({
      writeKey: settings.writeKey,
      host: settings.host,
      path: settings.path,
      maxRetries: settings.maxRetries ?? 3,
      flushAt: settings.flushAt ?? settings.maxEventsInBatch ?? 15,
      httpRequestTimeout: settings.httpRequestTimeout,
      disable: settings.disable,
      flushInterval,
      httpClient: typeof settings.httpClient === "function" ? new FetchHTTPClient(settings.httpClient) : settings.httpClient ?? new FetchHTTPClient(),
      oauthSettings: settings.oauthSettings
    }, this);
    this._publisher = publisher;
    this.ready = this.register(plugin).then(() => void 0);
    this.emit("initialize", settings);
    bindAll(this);
  }
  get VERSION() {
    return version;
  }
  /**
   * Call this method to stop collecting new events and flush all existing events.
   * This method also waits for any event method-specific callbacks to be triggered,
   * and any of their subsequent promises to be resolved/rejected.
   */
  closeAndFlush({ timeout = this._closeAndFlushDefaultTimeout } = {}) {
    return this.flush({ timeout, close: true });
  }
  /**
   * Call this method to flush all existing events..
   * This method also waits for any event method-specific callbacks to be triggered,
   * and any of their subsequent promises to be resolved/rejected.
   */
  async flush({ timeout, close = false } = {}) {
    if (this._isFlushing) {
      console.warn("Overlapping flush calls detected. Please wait for the previous flush to finish before calling .flush again");
      return;
    } else {
      this._isFlushing = true;
    }
    if (close) {
      this._isClosed = true;
    }
    this._publisher.flush(this._pendingEvents);
    const promise = new Promise((resolve) => {
      if (!this._pendingEvents) {
        resolve();
      } else {
        this.once("drained", () => {
          resolve();
        });
      }
    }).finally(() => {
      this._isFlushing = false;
    });
    return timeout ? pTimeout(promise, timeout).catch(() => void 0) : promise;
  }
  _dispatch(segmentEvent, callback) {
    if (this._isClosed) {
      this.emit("call_after_close", segmentEvent);
      return void 0;
    }
    this._pendingEvents++;
    dispatchAndEmit(segmentEvent, this._queue, this, callback).catch((ctx) => ctx).finally(() => {
      this._pendingEvents--;
      if (!this._pendingEvents) {
        this.emit("drained");
      }
    });
  }
  /**
   * Combines two unassociated user identities.
   * @link https://segment.com/docs/connections/sources/catalog/libraries/server/node/#alias
   */
  alias({ userId, previousId, context, timestamp, integrations, messageId }, callback) {
    const segmentEvent = this._eventFactory.alias(userId, previousId, {
      context,
      integrations,
      timestamp,
      messageId
    });
    this._dispatch(segmentEvent, callback);
  }
  /**
   * Associates an identified user with a collective.
   *  @link https://segment.com/docs/connections/sources/catalog/libraries/server/node/#group
   */
  group({ timestamp, groupId, userId, anonymousId, traits = {}, context, integrations, messageId }, callback) {
    const segmentEvent = this._eventFactory.group(groupId, traits, {
      context,
      anonymousId,
      userId,
      timestamp,
      integrations,
      messageId
    });
    this._dispatch(segmentEvent, callback);
  }
  /**
   * Includes a unique userId and (maybe anonymousId) and any optional traits you know about them.
   * @link https://segment.com/docs/connections/sources/catalog/libraries/server/node/#identify
   */
  identify({ userId, anonymousId, traits = {}, context, timestamp, integrations, messageId }, callback) {
    const segmentEvent = this._eventFactory.identify(userId, traits, {
      context,
      anonymousId,
      userId,
      timestamp,
      integrations,
      messageId
    });
    this._dispatch(segmentEvent, callback);
  }
  /**
   * The page method lets you record page views on your website, along with optional extra information about the page being viewed.
   * @link https://segment.com/docs/connections/sources/catalog/libraries/server/node/#page
   */
  page({ userId, anonymousId, category, name, properties, context, timestamp, integrations, messageId }, callback) {
    const segmentEvent = this._eventFactory.page(category ?? null, name ?? null, properties, { context, anonymousId, userId, timestamp, integrations, messageId });
    this._dispatch(segmentEvent, callback);
  }
  /**
   * Records screen views on your app, along with optional extra information
   * about the screen viewed by the user.
   *
   * TODO: This is not documented on the segment docs ATM (for node).
   */
  screen({ userId, anonymousId, category, name, properties, context, timestamp, integrations, messageId }, callback) {
    const segmentEvent = this._eventFactory.screen(category ?? null, name ?? null, properties, { context, anonymousId, userId, timestamp, integrations, messageId });
    this._dispatch(segmentEvent, callback);
  }
  /**
   * Records actions your users perform.
   * @link https://segment.com/docs/connections/sources/catalog/libraries/server/node/#track
   */
  track({ userId, anonymousId, event, properties, context, timestamp, integrations, messageId }, callback) {
    const segmentEvent = this._eventFactory.track(event, properties, {
      context,
      userId,
      anonymousId,
      timestamp,
      integrations,
      messageId
    });
    this._dispatch(segmentEvent, callback);
  }
  /**
   * Registers one or more plugins to augment Analytics functionality.
   * @param plugins
   */
  register(...plugins) {
    return this._queue.criticalTasks.run(async () => {
      const ctx = Context.system();
      const registrations = plugins.map((xt) => this._queue.register(ctx, xt, this));
      await Promise.all(registrations);
      this.emit("register", plugins.map((el) => el.name));
    });
  }
  /**
   * Deregisters one or more plugins based on their names.
   * @param pluginNames - The names of one or more plugins to deregister.
   */
  async deregister(...pluginNames) {
    const ctx = Context.system();
    const deregistrations = pluginNames.map((pl) => {
      const plugin = this._queue.plugins.find((p) => p.name === pl);
      if (plugin) {
        return this._queue.deregister(ctx, plugin, this);
      } else {
        ctx.log("warn", `plugin ${pl} not found`);
      }
    });
    await Promise.all(deregistrations);
    this.emit("deregister", pluginNames);
  }
};

// packages/core/src/services/segment-profile-service.ts
var SegmentProfileService = class {
  analytics;
  spaceId;
  accessToken;
  unifyToken;
  logger;
  constructor(config, logger2) {
    this.analytics = new Analytics({ writeKey: config.writeKey });
    this.spaceId = config.spaceId;
    this.accessToken = config.accessToken;
    this.unifyToken = config.unifyToken;
    this.logger = logger2.child({ component: "segment-profile-service" });
    this.logger.info("Segment Profile Service initialized");
  }
  /**
   * Background identity tracking (fire-and-forget)
   * Creates/updates user identity in Segment for analytics
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Fire-and-forget pattern
  async identify(phone) {
    const userId = `phone_${phone}`;
    this.analytics.identify(
      {
        userId,
        traits: { phone }
      },
      (err) => {
        if (err) {
          this.logger.warn({ err, phone }, "Segment identify failed (non-blocking)");
        }
      }
    );
  }
  /**
   * Background event tracking (fire-and-forget)
   * Tracks conversation events for analytics
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Fire-and-forget pattern
  async track(phone, event, properties) {
    const userId = `phone_${phone}`;
    this.analytics.track(
      {
        userId,
        event,
        properties
      },
      (err) => {
        if (err) {
          this.logger.warn({ err, event, phone }, "Segment track failed (non-blocking)");
        }
      }
    );
  }
  /**
   * Retrieve customer profile traits from Segment Profile API
   * Used by LLM tools to fetch customer context on-demand
   */
  async getProfile(phone, fields) {
    const token = this.unifyToken || this.accessToken;
    if (!this.spaceId || !token) {
      this.logger.warn("Segment Profile API not configured (missing spaceId or token)");
      return {};
    }
    const userId = `phone_${phone}`;
    const url = `https://profiles.segment.com/v1/spaces/${this.spaceId}/collections/users/profiles/user_id:${userId}/traits`;
    try {
      const auth = Buffer.from(`${token}:`).toString("base64");
      const response = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`
        }
      });
      if (response.status === 404) {
        this.logger.debug({ phone }, "Profile not found (will be created on first write)");
        return {};
      }
      if (!response.ok) {
        throw new Error(`Profile API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      if (fields && fields.length > 0) {
        const filtered = {};
        for (const field of fields) {
          if (field in data.traits) {
            filtered[field] = data.traits[field];
          }
        }
        return filtered;
      }
      return data.traits || {};
    } catch (error) {
      this.logger.error({ err: error, phone }, "Failed to retrieve profile from Segment");
      return {};
    }
  }
  /**
   * Update customer profile traits in Segment
   * Uses Events API (identify) - Profile API is read-only and only supports GET
   */
  async updateProfile(phone, traits) {
    const userId = `phone_${phone}`;
    return new Promise((resolve, reject) => {
      this.analytics.identify(
        {
          userId,
          traits: { ...traits, phone }
          // Include phone in traits
        },
        (err) => {
          if (err) {
            this.logger.error({ err, phone, traits }, "Failed to update profile in Segment");
            reject(err);
          } else {
            this.logger.debug({ phone, traits }, "Profile traits sent to Segment");
            resolve();
          }
        }
      );
    });
  }
  /**
   * Graceful shutdown - flush queued events to Segment
   */
  async close() {
    try {
      await this.analytics.closeAndFlush();
      this.logger.info("Segment analytics flushed and closed");
    } catch (error) {
      this.logger.error({ err: error }, "Error closing Segment analytics");
    }
  }
};

// packages/core/src/services/memora-profile-service.ts
var MemoraProfileService = class {
  memoryClient;
  storeId;
  logger;
  /**
   * Cache mapping phone numbers to profile IDs
   * Populated during identify() call
   */
  profileCache = /* @__PURE__ */ new Map();
  constructor(memoryClient, storeId, logger2) {
    this.memoryClient = memoryClient;
    this.storeId = storeId;
    this.logger = logger2.child({ component: "memora-profile-service" });
    this.logger.info("Memora Profile Service initialized");
  }
  /**
   * BLOCKING identity resolution
   * Looks up profile by phone number and caches profile_id for later use
   */
  async identify(phone) {
    try {
      const lookupResponse = await this.memoryClient.lookupProfile(this.storeId, "phone", phone);
      if (lookupResponse.profiles && lookupResponse.profiles.length > 0) {
        const profileId = lookupResponse.profiles[0];
        this.profileCache.set(phone, profileId);
        this.logger.debug({ phone, profile_id: profileId }, "Profile identified and cached");
      } else {
        this.logger.warn({ phone }, "No profile found for phone number");
      }
    } catch (error) {
      this.logger.error({ err: error, phone }, "Failed to identify profile");
      throw error;
    }
  }
  /**
   * No-op for Memora (no event tracking capability)
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- No-op method
  async track(phone, event, _properties) {
    this.logger.debug({ phone, event }, "Event tracking not supported in Memora (no-op)");
  }
  /**
   * Retrieve customer profile traits from Memora
   * Used by LLM tools to fetch customer context on-demand
   */
  async getProfile(phone, fields) {
    const profileId = this.profileCache.get(phone);
    if (!profileId) {
      this.logger.warn({ phone }, "Profile not identified - call identify() first");
      throw new Error("Profile not identified - call identify() first");
    }
    try {
      const profileResponse = await this.memoryClient.getProfile(this.storeId, profileId);
      if (fields && fields.length > 0) {
        const filtered = {};
        for (const field of fields) {
          if (field in profileResponse.traits) {
            filtered[field] = profileResponse.traits[field];
          }
        }
        return filtered;
      }
      return profileResponse.traits;
    } catch (error) {
      this.logger.error({ err: error, phone, profile_id: profileId }, "Failed to retrieve profile");
      throw error;
    }
  }
  /**
   * Update customer profile traits
   * Note: MemoryClient doesn't have updateProfile method - this would need to be added to MemoryClient
   * For now, throw an error indicating this is not yet implemented
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Throws error, no async operation
  async updateProfile(phone, traits) {
    const profileId = this.profileCache.get(phone);
    if (!profileId) {
      this.logger.warn({ phone }, "Profile not identified - call identify() first");
      throw new Error("Profile not identified - call identify() first");
    }
    this.logger.warn(
      { phone, profile_id: profileId, traits },
      "updateProfile not yet implemented for Memora"
    );
    throw new Error(
      "updateProfile not yet implemented for Memora - MemoryClient needs updateProfile method"
    );
  }
  /**
   * No cleanup needed for Memora
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- No async cleanup needed
  async close() {
    this.logger.debug("Memora profile service closed (no cleanup needed)");
  }
};

// packages/core/src/lib/tac.ts
var TAC = class {
  config;
  logger;
  memoryClient;
  knowledgeClient;
  conversationClient;
  channels;
  cintelProcessor;
  profileService;
  // Callback registrations
  messageReadyCallback;
  interruptCallback;
  handoffCallback;
  conversationEndedCallback;
  constructor(options = {}) {
    const finalConfig = options.config ? options.config instanceof TACConfig ? options.config : new TACConfig(options.config) : TACConfig.fromEnv();
    const finalLogger = options.logger ?? createLogger({ name: "tac" });
    this.config = finalConfig;
    this.logger = finalLogger;
    this.channels = /* @__PURE__ */ new Map();
    if (this.config.profileServiceProvider === "memora" && this.config.memoryStoreId) {
      this.memoryClient = new MemoryClient(this.config, this.logger.child({ component: "memory" }));
      this.logger.info("Memora Memory client initialized");
      this.knowledgeClient = new KnowledgeClient(
        this.config,
        this.logger.child({ component: "knowledge" })
      );
      this.logger.info("Knowledge client initialized");
    } else if (this.config.memoryStoreId) {
      this.logger.info(
        'Memory credentials provided but PROFILE_SERVICE_PROVIDER is not "memora". Memory client not initialized (use PROFILE_SERVICE_PROVIDER=memora to enable)'
      );
    } else {
      this.logger.info("Memory and Knowledge clients not initialized (credentials not provided)");
    }
    if (this.config.profileServiceProvider === "segment") {
      if (!this.config.segmentWriteKey) {
        throw new Error("SEGMENT_WRITE_KEY is required when PROFILE_SERVICE_PROVIDER=segment");
      }
      const segmentConfig = {
        writeKey: this.config.segmentWriteKey
      };
      if (this.config.segmentSpaceId !== void 0) {
        segmentConfig.spaceId = this.config.segmentSpaceId;
      }
      if (this.config.segmentAccessToken !== void 0) {
        segmentConfig.accessToken = this.config.segmentAccessToken;
      }
      if (this.config.segmentUnifyToken !== void 0) {
        segmentConfig.unifyToken = this.config.segmentUnifyToken;
      }
      this.profileService = new SegmentProfileService(
        segmentConfig,
        this.logger.child({ component: "segment-profile" })
      );
      this.logger.info("Segment Profile Service initialized");
    } else if (this.config.profileServiceProvider === "memora") {
      if (!this.memoryClient || !this.config.memoryStoreId) {
        throw new Error("MEMORY_STORE_ID is required when PROFILE_SERVICE_PROVIDER=memora");
      }
      this.profileService = new MemoraProfileService(
        this.memoryClient,
        this.config.memoryStoreId,
        this.logger.child({ component: "memora-profile" })
      );
      this.logger.info("Memora Profile Service initialized");
    } else if (this.config.profileServiceProvider) {
      throw new Error(
        `Invalid PROFILE_SERVICE_PROVIDER: ${String(this.config.profileServiceProvider)}. Must be "segment" or "memora"`
      );
    }
    if (this.memoryClient && this.config.cintelConfigurationId) {
      this.cintelProcessor = new OperatorResultProcessor(
        this.memoryClient,
        {
          configurationId: this.config.cintelConfigurationId,
          observationOperatorSid: this.config.cintelObservationOperatorSid,
          summaryOperatorSid: this.config.cintelSummaryOperatorSid
        },
        this.logger.child({ component: "cintel" })
      );
      this.logger.info("Conversation Intelligence processor initialized");
    }
    this.conversationClient = new ConversationClient(
      this.config,
      this.logger.child({ component: "conversation" })
    );
  }
  /**
   * Register a channel with the framework
   */
  registerChannel(channel) {
    this.logger.info({ channel: channel.channelType }, "Registering channel");
    const existingChannel = this.channels.get(channel.channelType);
    if (existingChannel) {
      this.logger.info({ channel: channel.channelType }, "Replacing existing channel registration");
      existingChannel.shutdown();
    }
    this.channels.set(channel.channelType, channel);
    this.setupChannelEventListeners(channel);
    this.logger.info({ channel: channel.channelType }, "Channel registration complete");
  }
  /**
   * Set up event listeners for a channel
   */
  setupChannelEventListeners(channel) {
    channel.on(
      "error",
      ({ error, context }) => {
        this.logger.error({ err: error, ...context }, "Channel error");
      }
    );
    channel.on(
      "messageReceived",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async callback
      async (data) => {
        await this.handleMessageReady({ ...data, channelType: channel.channelType });
      }
    );
    channel.on(
      "prompt",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async callback
      async ({
        conversationId,
        transcript
      }) => {
        const session = channel.getConversationSession(conversationId);
        if (session) {
          await this.handleMessageReady({
            conversationId,
            profileId: session.profile_id ? session.profile_id : void 0,
            message: transcript,
            author: "user",
            // Voice transcripts are always from user
            userMemory: void 0,
            channelType: channel.channelType
          });
        }
      }
    );
    channel.on(
      "interrupt",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async event handler
      async ({
        conversationId,
        reason,
        transcript
      }) => {
        const session = channel.getConversationSession(conversationId);
        if (session && this.interruptCallback) {
          try {
            await this.interruptCallback({
              conversationId,
              reason,
              transcript: transcript ?? void 0,
              session
            });
          } catch (error) {
            this.logger.error(
              { err: error, conversation_id: conversationId },
              "Interrupt callback error"
            );
          }
        }
      }
    );
    channel.on(
      "conversationEnded",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async event handler
      async ({ session }) => {
        if (this.conversationEndedCallback) {
          try {
            await this.conversationEndedCallback({ session });
          } catch (error) {
            this.logger.error(
              { err: error, conversation_id: session.conversation_id },
              "Conversation ended callback error"
            );
          }
        }
      }
    );
  }
  /**
   * Handle message ready event from channels
   */
  async handleMessageReady(data) {
    this.logger.debug(
      {
        conversation_id: data.conversationId,
        profile_id: data.profileId,
        author: data.author,
        message_length: data.message.length,
        channel: data.channelType,
        operation: "handle_message_ready"
      },
      "Handling message ready"
    );
    if (!this.messageReadyCallback) {
      this.logger.warn("No message ready callback registered");
      return;
    }
    try {
      const channel = this.channels.get(data.channelType);
      if (!channel) {
        throw new Error(`No channel found for type ${data.channelType}`);
      }
      this.logger.debug(
        { conversation_id: data.conversationId, channel: channel.channelType },
        "Using channel for message"
      );
      const session = channel.getConversationSession(data.conversationId);
      if (!session) {
        throw new Error(`No session found for conversation ${data.conversationId}`);
      }
      let memory = data.userMemory;
      if (!memory && data.profileId && this.memoryClient && this.config.memoryStoreId) {
        this.logger.debug(
          { profile_id: data.profileId, operation: "memory_retrieval" },
          "Retrieving memory for profile"
        );
        try {
          const memoryResponse = await this.memoryClient.retrieveMemories(
            this.config.memoryStoreId,
            data.profileId
          );
          memory = new TACMemoryResponse(memoryResponse);
          this.logger.debug({ profile_id: data.profileId }, "Memory retrieved");
        } catch (error) {
          this.logger.warn({ err: error, profile_id: data.profileId }, "Failed to retrieve memory");
        }
      }
      this.logger.debug(
        { conversation_id: data.conversationId },
        "Executing message ready callback"
      );
      try {
        await this.messageReadyCallback({
          conversationId: data.conversationId,
          profileId: data.profileId,
          message: data.message,
          author: data.author,
          memory: memory ?? void 0,
          session,
          channel: channel.channelType
        });
        this.logger.debug(
          { conversation_id: data.conversationId },
          "Message ready callback completed"
        );
      } catch (error) {
        this.logger.error(
          { err: error, conversation_id: data.conversationId },
          "Message ready callback error"
        );
      }
      this.logger.debug({ conversation_id: data.conversationId }, "Message handling completed");
    } catch (error) {
      this.logger.error(
        { err: error, conversation_id: data.conversationId },
        "Message handling error"
      );
    }
  }
  /**
   * Register callback for when messages are ready to be processed
   */
  onMessageReady(callback) {
    this.messageReadyCallback = callback;
  }
  /**
   * Register callback for when user interrupts (voice channel)
   */
  onInterrupt(callback) {
    this.interruptCallback = callback;
  }
  /**
   * Register callback for human handoff
   */
  onHandoff(callback) {
    this.handoffCallback = callback;
  }
  /**
   * Register callback for when a conversation ends.
   *
   * The callback is triggered by channels when a conversation is closed
   * (e.g., SMS conversation status changed to CLOSED, or voice WebSocket
   * disconnected). The callback receives the full ConversationSession before
   * it is cleaned up.
   */
  onConversationEnded(callback) {
    this.conversationEndedCallback = callback;
  }
  /**
   * Trigger handoff callback
   */
  async triggerHandoff(conversationId, reason) {
    if (!this.handoffCallback) {
      this.logger.warn({ conversation_id: conversationId }, "No handoff callback registered");
      return;
    }
    const channel = this.getChannelByConversationId(conversationId);
    const session = channel?.getConversationSession(conversationId);
    if (!session) {
      throw new Error(`No session found for conversation ${conversationId}`);
    }
    try {
      await this.handoffCallback({
        conversationId,
        profileId: session.profile_id ? session.profile_id : void 0,
        reason,
        session
      });
    } catch (error) {
      this.logger.error({ err: error, conversation_id: conversationId }, "Handoff callback error");
    }
  }
  /**
   * Get channel by conversation ID
   */
  getChannelByConversationId(conversationId) {
    for (const channel of this.channels.values()) {
      if (channel.isConversationActive(conversationId)) {
        return channel;
      }
    }
    return void 0;
  }
  /**
   * Get registered channel by type
   */
  getChannel(channelType) {
    return this.channels.get(channelType);
  }
  /**
   * Get all registered channels
   */
  getChannels() {
    return Array.from(this.channels.values());
  }
  /**
   * Get configuration
   */
  getConfig() {
    return this.config;
  }
  /**
   * Get memory client for advanced memory operations
   * Returns undefined if memory credentials are not configured
   */
  getMemoryClient() {
    return this.memoryClient;
  }
  /**
   * Get knowledge client for knowledge base operations
   * Returns undefined if memory credentials are not configured
   */
  getKnowledgeClient() {
    return this.knowledgeClient;
  }
  /**
   * Get profile service for customer profile and identity operations
   * Returns undefined if no profile service provider is configured
   */
  getProfileService() {
    return this.profileService;
  }
  /**
   * Get conversation client for advanced conversation operations
   */
  getConversationClient() {
    return this.conversationClient;
  }
  /**
   * Check if Twilio Memory functionality is enabled
   *
   * @returns true if memory client is initialized, false otherwise
   */
  isMemoryEnabled() {
    return this.memoryClient !== void 0;
  }
  /**
   * Check if Knowledge functionality is enabled
   *
   * @returns true if knowledge client is initialized, false otherwise
   */
  isKnowledgeEnabled() {
    return this.knowledgeClient !== void 0;
  }
  /**
   * Check if Conversation Intelligence processing is enabled
   *
   * @returns true if CI processor is initialized, false otherwise
   */
  isCintelEnabled() {
    return this.cintelProcessor !== void 0;
  }
  /**
   * Process a Conversation Intelligence operator result webhook event
   *
   * @param payload - The raw webhook payload from CI
   * @returns Promise containing the processing result
   * @throws Error if CI processor is not initialized
   */
  async processCintelEvent(payload) {
    if (!this.cintelProcessor) {
      throw new Error(
        "Conversation Intelligence processor is not initialized. Ensure both memory credentials and cintelConfigurationId are provided."
      );
    }
    return this.cintelProcessor.processEvent(payload);
  }
  /**
   * Retrieve memories from Memory API or fallback to Conversations API
   *
   * @param session - Conversation session context
   * @param query - Optional semantic search query
   * @returns Promise containing TACMemoryResponse wrapper providing unified access to memory data.
   *
   * When Memory is configured:
   * - observations, summaries, and communications available
   * - communications include author name and type
   *
   * When using Maestro fallback:
   * - observations and summaries are empty arrays
   * - communications have basic fields only (no author name/type)
   */
  async retrieveMemory(session, query) {
    if (this.memoryClient && this.config.memoryStoreId) {
      if (!session.profile_id) {
        this.logger.debug("profile_id not found, attempting to lookup profile using phone number");
        if (!session.author_info || !session.author_info.address) {
          throw new Error(
            "profile_id is required for memory retrieval but was not found in conversation context. Additionally, author_info.address is not available for profile lookup. Ensure either profile_id or author_info.address is provided when creating the ConversationSession."
          );
        }
        try {
          const lookupResponse = await this.memoryClient.lookupProfile(
            this.config.memoryStoreId,
            "phone",
            session.author_info.address
          );
          if (!lookupResponse.profiles || lookupResponse.profiles.length === 0) {
            throw new Error(
              `No profile found for phone number ${session.author_info.address}. Profile lookup returned no results. Ensure the phone number is registered in the identity resolution system.`
            );
          }
          session.profile_id = lookupResponse.profiles[0];
        } catch (error) {
          this.logger.error(
            { err: error },
            `Failed to lookup profile for ${session.author_info.address}`
          );
          throw error;
        }
      }
      try {
        const memoryResponse = await this.memoryClient.retrieveMemories(
          this.config.memoryStoreId,
          session.profile_id,
          { query }
        );
        return new TACMemoryResponse(memoryResponse);
      } catch (error) {
        this.logger.error({ err: error }, "Failed to retrieve memory");
        throw error;
      }
    } else {
      this.logger.info("Twilio Memory not configured, falling back to Conversations API");
      try {
        const communications = await this.conversationClient.listCommunications(
          session.conversation_id
        );
        return new TACMemoryResponse(communications);
      } catch (error) {
        this.logger.error({ err: error }, "Failed to retrieve communications");
        throw error;
      }
    }
  }
  /**
   * Fetch profile information with traits
   *
   * @param profileId - Profile ID to fetch
   * @returns Promise containing profile response or undefined if not available
   */
  async fetchProfile(profileId) {
    if (!this.memoryClient || !this.config.memoryStoreId) {
      this.logger.warn(
        "Memory client is not initialized. Cannot fetch profile. Provide memory credentials when creating TAC to enable profile fetching."
      );
      return void 0;
    }
    if (!profileId) {
      this.logger.warn("profile_id is required for profile fetching but was not provided");
      return void 0;
    }
    try {
      const traitGroups = this.config.traitGroups;
      const profileResponse = await this.memoryClient.getProfile(
        this.config.memoryStoreId,
        profileId,
        traitGroups
      );
      return profileResponse;
    } catch (error) {
      this.logger.error({ err: error }, `Failed to fetch profile for ${profileId}`);
      return void 0;
    }
  }
  /**
   * Shutdown TAC and cleanup resources
   */
  async shutdown() {
    for (const channel of this.channels.values()) {
      this.logger.debug({ channel: channel.channelType }, "Shutting down channel");
      channel.shutdown();
    }
    if (this.profileService) {
      await this.profileService.close();
    }
    this.channels.clear();
    this.logger.info("TAC shutdown complete");
  }
};
var BaseChannel = class {
  tac;
  config;
  logger;
  conversationClient;
  activeConversations;
  callbacks;
  constructor(tac) {
    this.tac = tac;
    this.config = tac.getConfig();
    this.logger = tac.logger.child({ component: "channel" });
    this.conversationClient = new ConversationClient(this.config);
    this.activeConversations = /* @__PURE__ */ new Map();
    this.callbacks = {};
  }
  /**
   * Register event callbacks
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  on(event, callback) {
    switch (event) {
      case "conversationStarted":
        this.callbacks.onConversationStarted = callback;
        break;
      case "conversationEnded":
        this.callbacks.onConversationEnded = callback;
        break;
      case "error":
        this.callbacks.onError = callback;
        break;
    }
  }
  /**
   * Process Conversations webhook
   * This is the default implementation that handles standard Conversations events.
   * Channels can override to add channel-specific behavior.
   */
  async processConversationsWebhook(payload) {
    this.logger.debug(
      { operation: "conversations_webhook_processing", payload },
      "Processing Conversations webhook"
    );
    try {
      const validationResult = this.validateConversationsWebhookPayload(payload);
      if (!validationResult.success) {
        this.logger.error(
          {
            validation_errors: validationResult.error.errors,
            payload,
            operation: "conversations_webhook_validation"
          },
          "Invalid Conversations webhook payload"
        );
        throw new Error("Invalid Conversations webhook payload");
      }
      const webhookData = validationResult.data;
      const eventType = webhookData.eventType;
      const conversationId = webhookData.data.conversationId ?? webhookData.data.id;
      this.logger.info(
        {
          event_type: eventType,
          conversation_id: conversationId,
          channel: this.channelType
        },
        "Processing Conversations webhook event"
      );
      switch (eventType) {
        case "CONVERSATION_CREATED":
          this.handleConversationCreated(webhookData);
          break;
        case "PARTICIPANT_ADDED":
          this.handleParticipantAdded(webhookData);
          break;
        case "PARTICIPANT_UPDATED":
          this.handleParticipantUpdated(webhookData);
          break;
        case "PARTICIPANT_REMOVED":
          this.handleParticipantRemoved(webhookData);
          break;
        case "COMMUNICATION_CREATED":
          await this.handleCommunicationCreated(webhookData);
          break;
        case "COMMUNICATION_UPDATED":
          await this.handleCommunicationUpdated(webhookData);
          break;
        case "CONVERSATION_UPDATED":
          await this.handleConversationUpdated(webhookData);
          break;
        default: {
          this.logger.warn(
            {
              event_type: eventType,
              conversation_id: conversationId,
              channel: this.channelType
            },
            "Unhandled Conversations event type"
          );
          break;
        }
      }
    } catch (error) {
      this.logger.error(
        { err: error, operation: "conversations_webhook_processing" },
        "Conversations webhook processing error"
      );
      this.handleError(error instanceof Error ? error : new Error(String(error)), { payload });
    }
  }
  /**
   * Validate Conversations webhook payload structure using Zod schema
   * Returns parse result with success flag and either data or error details
   */
  validateConversationsWebhookPayload(payload) {
    if (!this.validateWebhookPayload(payload)) {
      return {
        success: false,
        error: new z.ZodError([
          {
            code: "invalid_type",
            expected: "object",
            received: typeof payload,
            path: [],
            message: "Payload is null or undefined"
          }
        ])
      };
    }
    return ConversationsWebhookPayloadSchema.safeParse(payload);
  }
  /**
   * Handle CONVERSATION_CREATED event
   */
  handleConversationCreated(payload) {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);
    if (!conversationId) {
      throw new Error("Missing conversation ID in CONVERSATION_CREATED event");
    }
    this.startConversation(conversationId, profileId ?? void 0, payload.data.serviceId);
  }
  /**
   * Handle PARTICIPANT_ADDED event
   */
  handleParticipantAdded(payload) {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);
    if (!conversationId) {
      throw new Error("Missing conversation ID in PARTICIPANT_ADDED event");
    }
    if (this.isConversationActive(conversationId)) {
      const session = this.getConversationSession(conversationId);
      if (session && profileId) {
        session.profile_id = profileId;
      }
      if (session && payload.data.serviceId) {
        session.service_id = payload.data.serviceId;
      }
    } else {
      this.startConversation(conversationId, profileId ?? void 0, payload.data.serviceId);
    }
  }
  /**
   * Handle PARTICIPANT_UPDATED event
   */
  handleParticipantUpdated(payload) {
    const conversationId = this.extractConversationId(payload);
    if (!conversationId) {
      throw new Error("Missing conversation ID in PARTICIPANT_UPDATED event");
    }
    this.logger.debug(
      { conversation_id: conversationId, participant_type: payload.data.participantType },
      "Participant updated"
    );
  }
  /**
   * Handle PARTICIPANT_REMOVED event
   */
  handleParticipantRemoved(payload) {
    const conversationId = this.extractConversationId(payload);
    if (!conversationId) {
      throw new Error("Missing conversation ID in PARTICIPANT_REMOVED event");
    }
    this.logger.info(
      { conversation_id: conversationId, participant_type: payload.data.participantType },
      "Participant removed from conversation"
    );
  }
  /**
   * Handle COMMUNICATION_CREATED event
   * Override in channel-specific classes to add message handling logic
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Base implementation is synchronous, but subclasses may need async
  async handleCommunicationCreated(payload) {
    const conversationId = this.extractConversationId(payload);
    if (!conversationId) {
      throw new Error("Missing conversation ID in COMMUNICATION_CREATED event");
    }
    if (!this.isConversationActive(conversationId)) {
      const profileId = this.extractProfileId(payload);
      this.startConversation(conversationId, profileId ?? void 0, payload.data.serviceId);
    }
  }
  /**
   * Handle COMMUNICATION_UPDATED event
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Base implementation is synchronous, but subclasses may need async
  async handleCommunicationUpdated(payload) {
    const conversationId = this.extractConversationId(payload);
    if (!conversationId) {
      throw new Error("Missing conversation ID in COMMUNICATION_UPDATED event");
    }
    this.logger.debug(
      { conversation_id: conversationId, communication_id: payload.data.id },
      "Communication updated"
    );
  }
  /**
   * Handle CONVERSATION_UPDATED event
   */
  async handleConversationUpdated(payload) {
    const conversationId = this.extractConversationId(payload);
    if (!conversationId) {
      throw new Error("Missing conversation ID in CONVERSATION_UPDATED event");
    }
    if (payload.data.status === "CLOSED") {
      this.logger.info(
        { conversation_id: conversationId, status: payload.data.status },
        "Conversation closed by Conversations Service"
      );
      await this.endConversation(conversationId);
    }
  }
  /**
   * Start a new conversation session
   */
  startConversation(conversationId, profileId, serviceId) {
    if (this.activeConversations.has(conversationId)) {
      this.logger.debug(
        {
          conversation_id: conversationId,
          profile_id: this.activeConversations.get(conversationId)?.profile_id,
          service_id: this.activeConversations.get(conversationId)?.service_id
        },
        "Conversation already active"
      );
      return this.activeConversations.get(conversationId);
    }
    const session = {
      conversation_id: conversationId,
      profile_id: profileId,
      service_id: serviceId,
      channel: this.channelType,
      started_at: /* @__PURE__ */ new Date(),
      metadata: {}
    };
    this.activeConversations.set(conversationId, session);
    this.logger.debug(
      {
        conversation_id: conversationId,
        profile_id: profileId,
        service_id: serviceId,
        channel: this.channelType
      },
      "Conversation started"
    );
    if (this.callbacks.onConversationStarted) {
      this.callbacks.onConversationStarted({ session });
    }
    return session;
  }
  /**
   * End a conversation session.
   *
   * Triggers the onConversationEnded callback BEFORE removing the session,
   * so the callback receives the full ConversationSession data.
   * Errors in the callback do not prevent session cleanup.
   */
  async endConversation(conversationId) {
    const session = this.activeConversations.get(conversationId);
    if (session) {
      if (this.callbacks.onConversationEnded) {
        try {
          await this.callbacks.onConversationEnded({ session });
        } catch (error) {
          this.logger.error(
            { err: error, conversation_id: conversationId },
            "Error in conversation ended callback"
          );
        }
      }
      this.activeConversations.delete(conversationId);
      this.logger.debug(
        {
          conversation_id: conversationId,
          channel: this.channelType,
          service_id: session.service_id
        },
        "Conversation ended"
      );
    } else {
      this.logger.debug(
        { conversation_id: conversationId, channel: this.channelType },
        "Conversation end requested but no active session found"
      );
    }
  }
  /**
   * Get an active conversation session
   */
  getConversationSession(conversationId) {
    return this.activeConversations.get(conversationId);
  }
  /**
   * Check if a conversation is active
   */
  isConversationActive(conversationId) {
    return this.activeConversations.has(conversationId);
  }
  /**
   * Handle errors with proper context
   */
  handleError(error, context) {
    this.logger.error({ err: error, ...context }, "Channel error");
    if (this.callbacks.onError) {
      if (context) {
        this.callbacks.onError({ error, context });
      } else {
        this.callbacks.onError({ error });
      }
    }
  }
  /**
   * Validate webhook payload (override in subclasses for specific validation)
   */
  validateWebhookPayload(payload) {
    return payload !== null && payload !== void 0;
  }
  /**
   * Extract conversation ID from Conversations webhook payload
   */
  extractConversationId(payload) {
    const validationResult = this.validateConversationsWebhookPayload(payload);
    if (!validationResult.success) {
      return null;
    }
    const conversationId = validationResult.data.data.conversationId || validationResult.data.data.id;
    if (conversationId && typeof conversationId === "string" && isConversationId(conversationId)) {
      return conversationId;
    }
    return null;
  }
  /**
   * Extract profile ID from Conversations webhook payload
   */
  extractProfileId(payload) {
    const validationResult = this.validateConversationsWebhookPayload(payload);
    if (!validationResult.success) {
      return null;
    }
    const profileId = validationResult.data.data.profileId;
    if (profileId && typeof profileId === "string" && isProfileId(profileId)) {
      return profileId;
    }
    return null;
  }
  /**
   * Cleanup resources when shutting down
   */
  shutdown() {
    this.activeConversations.clear();
    delete this.callbacks.onConversationStarted;
    delete this.callbacks.onConversationEnded;
    delete this.callbacks.onError;
  }
};
var SMSChannel = class extends BaseChannel {
  twilioClient;
  smsCallbacks;
  constructor(tac) {
    super(tac);
    this.twilioClient = twilio(this.config.twilioAccountSid, this.config.twilioAuthToken);
    this.smsCallbacks = {};
  }
  get channelType() {
    return "sms";
  }
  /**
   * Register event callbacks (override for SMS-specific events)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  on(event, callback) {
    if (event === "messageReceived") {
      this.smsCallbacks.onMessageReceived = callback;
    } else {
      super.on(event, callback);
    }
  }
  /**
   * Process SMS webhook - delegates to Conversations webhook handler
   */
  async processWebhook(payload) {
    await this.processConversationsWebhook(payload);
  }
  /**
   * Handle COMMUNICATION_CREATED with SMS-specific logic
   * Override from base class to add message processing
   */
  async handleCommunicationCreated(payload) {
    await super.handleCommunicationCreated(payload);
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);
    const message2 = payload.data.content.text.trim();
    const author = payload.data.author.address || "unknown";
    if (!conversationId || !message2) {
      return;
    }
    if (author === this.config.twilioPhoneNumber) {
      this.logger.info({ conversation_id: conversationId }, "Ignoring message from AI agent");
      return;
    }
    const session = this.getConversationSession(conversationId);
    if (session) {
      session.author_info = {
        address: author,
        participant_id: payload.data.author.participantId
      };
    }
    const profileService = this.tac.getProfileService();
    if (profileService) {
      const phone = author;
      if (this.config.profileServiceProvider === "segment") {
        profileService.identify(phone).catch((err) => {
          this.logger.warn({ err, phone }, "Profile identify failed (non-blocking)");
        });
        profileService.track(phone, "message_received", { conversation_id: conversationId }).catch((err) => {
          this.logger.warn(
            { err, phone, event: "message_received" },
            "Profile track failed (non-blocking)"
          );
        });
      } else if (this.config.profileServiceProvider === "memora") {
        try {
          await profileService.identify(phone);
        } catch (error) {
          this.logger.warn({ err: error, phone }, "Memora profile identify failed");
        }
      }
    }
    let userMemory;
    if (session && this.tac.isMemoryEnabled()) {
      try {
        userMemory = await this.tac.retrieveMemory(session, message2);
      } catch (error) {
        this.logger.warn(
          { err: error, conversation_id: conversationId },
          "Failed to retrieve memory"
        );
      }
    }
    if (this.smsCallbacks.onMessageReceived) {
      this.smsCallbacks.onMessageReceived({
        conversationId,
        profileId: profileId ?? void 0,
        message: message2,
        author,
        userMemory
      });
    }
  }
  /**
   * Send SMS response using Twilio Messages API
   * Note: This is a workaround until Conversations Service supports sending messages
   */
  async sendResponse(conversationId, message2, metadata) {
    this.logger.debug(
      {
        conversation_id: conversationId,
        message_length: message2.length,
        operation: "send_response"
      },
      "Sending SMS response"
    );
    try {
      const session = this.getConversationSession(conversationId);
      if (!session) {
        throw new Error(`No active session found for conversation ${conversationId}`);
      }
      try {
        this.logger.debug(
          { conversation_id: conversationId },
          "Listing participants for conversation"
        );
        const participants = await this.conversationClient.listParticipants(conversationId);
        this.logger.debug(
          {
            conversation_id: conversationId,
            participant_count: participants.length,
            service_id: session.service_id ?? this.config.conversationServiceId
          },
          "Found participants"
        );
        let messagesSent = 0;
        for (const participant of participants) {
          if (participant.type !== "CUSTOMER") {
            this.logger.debug(
              { participant_type: participant.type },
              "Skipping non-customer participant"
            );
            continue;
          }
          const addresses = participant.addresses || [];
          this.logger.debug(
            { addresses_count: addresses.length },
            "Checking participant addresses"
          );
          for (const addr of addresses) {
            if (addr.channel !== "SMS") {
              this.logger.debug({ channel: addr.channel }, "Skipping non-SMS address");
              continue;
            }
            this.logger.debug(
              { to_address: addr.address, from_number: this.config.twilioPhoneNumber },
              "Sending SMS"
            );
            await this.twilioClient.messages.create({
              to: addr.address,
              from: this.config.twilioPhoneNumber,
              body: message2
            });
            this.logger.info(
              { conversation_id: conversationId, to_address: addr.address },
              "SMS sent successfully"
            );
            messagesSent++;
          }
        }
        if (messagesSent === 0) {
          this.logger.warn(
            { conversation_id: conversationId },
            "No SMS addresses found for any CUSTOMER participants"
          );
        }
      } catch (error) {
        this.logger.error(
          { err: error, conversation_id: conversationId },
          "Failed to list participants"
        );
        throw error;
      }
    } catch (error) {
      this.logger.error({ err: error, conversation_id: conversationId }, "Send response error");
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId,
        message: message2,
        metadata
      });
      throw error;
    }
  }
};
var VoiceChannel = class extends BaseChannel {
  webSocketConnections;
  callSidToConversationId;
  voiceCallbacks;
  streamTasks;
  constructor(tac) {
    super(tac);
    this.webSocketConnections = /* @__PURE__ */ new Map();
    this.callSidToConversationId = /* @__PURE__ */ new Map();
    this.voiceCallbacks = {};
    this.streamTasks = /* @__PURE__ */ new Map();
  }
  get channelType() {
    return "voice";
  }
  /**
   * Register event callbacks (override for Voice-specific events)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  on(event, callback) {
    switch (event) {
      case "setup":
        this.voiceCallbacks.onSetup = callback;
        break;
      case "prompt":
        this.voiceCallbacks.onPrompt = callback;
        break;
      case "interrupt":
        this.voiceCallbacks.onInterrupt = callback;
        break;
      case "webSocketConnected":
        this.voiceCallbacks.onWebSocketConnected = callback;
        break;
      case "webSocketDisconnected":
        this.voiceCallbacks.onWebSocketDisconnected = callback;
        break;
      default:
        super.on(event, callback);
        break;
    }
  }
  /**
   * Process Voice webhook - delegates to Conversations webhook handler
   * Voice receives Conversations events for conversation lifecycle
   */
  async processWebhook(payload) {
    await this.processConversationsWebhook(payload);
  }
  /**
   * Get active WebSocket connection for a conversation
   */
  getWebsocket(conversationId) {
    return this.webSocketConnections.get(conversationId) || null;
  }
  /**
   * Handle WebSocket connection from ConversationRelay
   */
  handleWebSocketConnection(ws) {
    let conversationId = null;
    ws.on("message", (data) => {
      try {
        const messageText = data.toString();
        const messageData = JSON.parse(messageText);
        this.logger.debug({ raw_message: messageData }, "Received WebSocket message");
        const validatedMessage = WebSocketMessageSchema.safeParse(messageData);
        if (!validatedMessage.success) {
          this.logger.error(
            { validation_errors: validatedMessage.error.errors, raw_message: messageData },
            "Invalid WebSocket message"
          );
          return;
        }
        const message2 = validatedMessage.data;
        switch (message2.type) {
          case "setup":
            conversationId = this.handleSetupMessage(ws, message2);
            break;
          case "prompt":
            if (conversationId) {
              this.handlePromptMessage(conversationId, message2);
            }
            break;
          case "interrupt":
            if (conversationId) {
              this.handleInterruptMessage(conversationId, message2);
            }
            break;
          default:
            this.logger.warn(
              { conversation_id: conversationId, message: messageData },
              "Unhandled WebSocket event type"
            );
            break;
        }
      } catch (error) {
        this.handleError(error instanceof Error ? error : new Error(String(error)), {
          conversationId,
          message: data.toString()
        });
      }
    });
    ws.on("close", () => {
      if (conversationId) {
        void this.handleWebSocketDisconnect(conversationId).catch((err) => {
          this.logger.error(
            { err, conversation_id: conversationId },
            "WebSocket disconnect handler error"
          );
        });
      }
    });
    ws.on("error", (error) => {
      this.handleError(error, { conversationId });
    });
  }
  /**
   * Handle WebSocket setup message
   */
  handleSetupMessage(ws, message2) {
    const { callSid, from, to, customParameters } = message2;
    let conversationId;
    let profileId;
    if (customParameters?.conversation_id && typeof customParameters.conversation_id === "string" && isConversationId(customParameters.conversation_id)) {
      conversationId = customParameters.conversation_id;
    } else {
      conversationId = callSid;
    }
    if (customParameters?.profile_id && typeof customParameters.profile_id === "string" && isProfileId(customParameters.profile_id)) {
      profileId = customParameters.profile_id;
    }
    this.webSocketConnections.set(conversationId, ws);
    this.callSidToConversationId.set(callSid, conversationId);
    const session = this.startConversation(conversationId, profileId);
    session.author_info = {
      address: from
    };
    const profileService = this.tac.getProfileService();
    if (profileService) {
      const phone = from;
      profileService.identify(phone).catch((err) => {
        this.logger.warn({ err, phone }, "Profile identify failed (non-blocking)");
      });
      profileService.track(phone, "call_started", { conversation_id: conversationId, call_sid: callSid }).catch((err) => {
        this.logger.warn(
          { err, phone, event: "call_started" },
          "Profile track failed (non-blocking)"
        );
      });
    }
    if (this.voiceCallbacks.onSetup) {
      this.voiceCallbacks.onSetup({
        conversationId,
        profileId: profileId ?? void 0,
        callSid,
        from,
        to,
        customParameters: customParameters ?? void 0
      });
    }
    if (this.voiceCallbacks.onWebSocketConnected) {
      this.voiceCallbacks.onWebSocketConnected({ conversationId });
    }
    return conversationId;
  }
  /**
   * Handle WebSocket prompt message (user speech)
   */
  handlePromptMessage(conversationId, message2) {
    const transcript = message2.voicePrompt;
    this.cancelStreamTask(conversationId);
    if (this.voiceCallbacks.onPrompt) {
      this.voiceCallbacks.onPrompt({
        conversationId,
        transcript
      });
    }
  }
  /**
   * Handle WebSocket interrupt message
   */
  handleInterruptMessage(conversationId, message2) {
    const { reason, transcript } = message2;
    const cancelled = this.cancelStreamTask(conversationId);
    if (cancelled) {
      this.logger.info(
        { conversation_id: conversationId },
        "Cancelled stream task due to interrupt"
      );
    }
    if (this.voiceCallbacks.onInterrupt) {
      this.voiceCallbacks.onInterrupt({
        conversationId,
        reason: reason ?? "unknown",
        transcript: transcript ?? void 0
      });
    }
  }
  /**
   * Handle WebSocket disconnection
   */
  async handleWebSocketDisconnect(conversationId) {
    this.webSocketConnections.delete(conversationId);
    for (const [callSid, cId] of this.callSidToConversationId.entries()) {
      if (cId === conversationId) {
        this.callSidToConversationId.delete(callSid);
        break;
      }
    }
    if (this.voiceCallbacks.onWebSocketDisconnected) {
      this.voiceCallbacks.onWebSocketDisconnected({ conversationId });
    }
    await this.endConversation(conversationId);
  }
  /**
   * Send voice response via WebSocket
   */
  sendResponse(conversationId, message2, metadata) {
    try {
      const ws = this.webSocketConnections.get(conversationId);
      if (ws?.readyState !== WebSocket.OPEN) {
        throw new Error(`No active WebSocket connection for conversation ${conversationId}`);
      }
      const response = {
        type: "text",
        token: message2,
        last: true
      };
      ws.send(JSON.stringify(response));
      return Promise.resolve();
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId,
        message: message2,
        metadata
      });
      throw error;
    }
  }
  // =========================================================================
  // Incoming Call Handling (with conversation creation)
  // =========================================================================
  /**
   * Handle incoming voice call - create conversation, add participants, generate TwiML
   *
   * @param options - Options for handling the incoming call
   * @returns TwiML XML string with ConversationRelay configuration
   */
  async handleIncomingCall(options) {
    const { toNumber, fromNumber, callSid, actionUrl, conversationRelayConfig } = options;
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replaceAll(/[-:.]/g, "").slice(0, 15) + "Z";
    const conversationName = `tac-voice-${fromNumber}-${timestamp}`;
    const conversationClient = this.tac.getConversationClient();
    const conversation = await conversationClient.createConversation(conversationName);
    const conversationId = conversation.id;
    this.logger.debug(
      { conversation_id: conversationId, call_sid: callSid },
      "Created conversation for voice call"
    );
    const customerParticipant = await conversationClient.addParticipant(
      conversationId,
      [{ channel: "VOICE", address: fromNumber, channelId: callSid }],
      "CUSTOMER"
    );
    const profileId = customerParticipant.profileId || "";
    const customerParticipantId = customerParticipant.id;
    const aiAgentParticipant = await conversationClient.addParticipant(
      conversationId,
      [{ channel: "VOICE", address: toNumber, channelId: callSid }],
      "AI_AGENT"
    );
    const aiAgentParticipantId = aiAgentParticipant.id;
    return this.connectConversationRelay(
      conversationRelayConfig,
      {
        conversation_id: conversationId,
        profile_id: profileId,
        customer_participant_id: customerParticipantId,
        ai_agent_participant_id: aiAgentParticipantId
      },
      actionUrl ? { actionUrl } : void 0
    );
  }
  // =========================================================================
  // ConversationRelay Callback Handling
  // =========================================================================
  /**
   * Handle ConversationRelay callback from Twilio
   *
   * @param payload - Callback payload from Twilio
   * @param handoffHandler - Optional handler for handoff requests
   * @returns Response with status, content, and content type
   */
  async handleConversationRelayCallback(payload, handoffHandler) {
    this.logger.debug(
      { call_sid: payload.CallSid, call_status: payload.CallStatus },
      "ConversationRelay callback received"
    );
    if (payload.CallStatus === "in-progress" && payload.HandoffData) {
      if (handoffHandler) {
        try {
          const response = await handoffHandler(payload);
          return { status: 200, content: response, contentType: "application/xml" };
        } catch (error) {
          this.logger.error({ err: error }, "Handoff handler failed");
          return { status: 500, content: "Handoff handler error", contentType: "text/plain" };
        }
      }
      return { status: 501, content: "No handoff handler registered", contentType: "text/plain" };
    }
    if (payload.CallStatus === "completed") {
      await this.closeConversationsForCall(payload.CallSid);
    }
    return { status: 200, content: "OK", contentType: "text/plain" };
  }
  /**
   * Close all conversations associated with a call
   */
  async closeConversationsForCall(callSid) {
    try {
      const conversationClient = this.tac.getConversationClient();
      const conversations = await conversationClient.listConversations({ channelId: callSid });
      this.logger.info(
        { call_sid: callSid, count: conversations.length },
        "Closing conversations for completed call"
      );
      for (const conversation of conversations) {
        try {
          await conversationClient.updateConversation(conversation.id, "CLOSED");
          this.logger.debug({ conversation_id: conversation.id }, "Closed conversation");
        } catch (error) {
          this.logger.error(
            { err: error, conversation_id: conversation.id },
            "Failed to close conversation"
          );
        }
      }
    } catch (error) {
      this.logger.error({ err: error, call_sid: callSid }, "Failed to list conversations for call");
    }
  }
  // =========================================================================
  // Stream Task Management
  // =========================================================================
  /**
   * Start tracking a streaming task for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns AbortController for the task
   */
  startStreamTask(conversationId) {
    this.cancelStreamTask(conversationId);
    const controller = new AbortController();
    this.streamTasks.set(conversationId, controller);
    this.logger.debug({ conversation_id: conversationId }, "Started stream task");
    return controller;
  }
  /**
   * Cancel an active streaming task
   *
   * @param conversationId - The conversation ID
   * @returns true if a task was cancelled, false otherwise
   */
  cancelStreamTask(conversationId) {
    const controller = this.streamTasks.get(conversationId);
    if (controller) {
      controller.abort();
      this.streamTasks.delete(conversationId);
      this.logger.debug({ conversation_id: conversationId }, "Cancelled stream task");
      return true;
    }
    return false;
  }
  /**
   * Complete a streaming task (remove from tracking)
   *
   * @param conversationId - The conversation ID
   */
  completeStreamTask(conversationId) {
    this.streamTasks.delete(conversationId);
    this.logger.debug({ conversation_id: conversationId }, "Completed stream task");
  }
  /**
   * Check if a stream task is active
   *
   * @param conversationId - The conversation ID
   * @returns true if an active task exists
   */
  hasActiveStreamTask(conversationId) {
    const controller = this.streamTasks.get(conversationId);
    return controller !== void 0 && !controller.signal.aborted;
  }
  // =========================================================================
  // ConversationRelay TwiML Generation
  // =========================================================================
  /**
   * Generate TwiML to connect a call to ConversationRelay.
   * Validates configuration with Zod before generating TwiML.
   *
   * @param config - ConversationRelay configuration (url, transcription, TTS, etc.)
   * @param parameters - Optional custom parameters to pass via TwiML <Parameter> elements
   * @param options - Optional settings for the Connect verb (e.g., actionUrl)
   * @returns TwiML XML string
   * @throws {Error} if config validation fails
   */
  connectConversationRelay(config, parameters, options) {
    const validationResult = ConversationRelayConfigSchema.safeParse(config);
    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
      throw new Error(`Invalid ConversationRelay configuration: ${errorMessage}`);
    }
    const validatedConfig = validationResult.data;
    const { languages, ...conversationRelayAttributes } = validatedConfig;
    const filteredConfig = this.filterUnsetValues(conversationRelayAttributes);
    const response = new VoiceResponse();
    const connect = response.connect(options?.actionUrl ? { action: options.actionUrl } : {});
    const relay = connect.conversationRelay(filteredConfig);
    if (languages && languages.length > 0) {
      for (const lang of languages) {
        const filteredLang = this.filterUnsetValues(lang);
        relay.language(filteredLang);
      }
    }
    if (parameters) {
      const paramResult = CustomParametersSchema.safeParse(parameters);
      if (!paramResult.success) {
        throw new Error(`Invalid custom parameters: ${paramResult.error.message}`);
      }
      for (const [name, value] of Object.entries(paramResult.data)) {
        if (value !== void 0) {
          relay.parameter({ name, value });
        }
      }
    }
    return response.toString();
  }
  /**
   * Filter out undefined values from configuration object.
   * Keeps null, false, 0, and empty strings as they are valid values.
   */
  filterUnsetValues(config) {
    const filtered = {};
    for (const [key, value] of Object.entries(config)) {
      if (value !== void 0) {
        filtered[key] = value;
      }
    }
    return filtered;
  }
  /**
   * Cleanup channel state on shutdown
   *
   * Note: WebSocket connections are managed by the server and closed there.
   * This method only cleans up internal channel state.
   */
  shutdown() {
    this.streamTasks.clear();
    this.webSocketConnections.clear();
    this.callSidToConversationId.clear();
    super.shutdown();
  }
};
var logger = createLogger({ name: "tac-flex" });
function handleFlexHandoffLogic(formData, flexWorkflowSid) {
  if (!flexWorkflowSid) {
    logger.error("No Flex workflow SID configured");
    return {
      success: false,
      status: 400,
      content: "Invalid handoff data",
      contentType: "text/plain"
    };
  }
  const response = new VoiceResponse();
  const handoffDataRaw = formData["HandoffData"] || "";
  if (handoffDataRaw) {
    let handoffData;
    try {
      handoffData = HandoffDataSchema.parse(JSON.parse(handoffDataRaw));
    } catch (error) {
      logger.error({ err: error }, "Invalid handoff data");
      return {
        success: false,
        status: 400,
        content: "Invalid handoff data",
        contentType: "text/plain"
      };
    }
    const enqueue = response.enqueue({
      workflowSid: flexWorkflowSid
    });
    enqueue.task(
      {
        priority: 5
      },
      JSON.stringify(handoffData)
    );
    logger.debug(
      { workflow_sid: flexWorkflowSid, handoff_data: handoffData },
      "Generated Flex handoff TwiML"
    );
    return {
      success: true,
      status: 200,
      content: response.toString(),
      contentType: "application/xml"
    };
  } else {
    if (formData["CallStatus"] === "completed") {
      return {
        success: true,
        status: 200,
        content: "Call Completed",
        contentType: "application/xml"
      };
    } else {
      return {
        success: false,
        status: 400,
        content: "Handoff Data is Missing",
        contentType: "application/xml"
      };
    }
  }
}

// packages/tools/src/lib/builder.ts
var TACTool = class {
  constructor(name, description, parameters, implementation) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.implementation = implementation;
  }
  /**
   * Convert to OpenAI function calling format
   */
  toOpenAIFormat() {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters
      }
    };
  }
  /**
   * Convert to Anthropic tool calling format
   */
  toAnthropicFormat() {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.parameters
    };
  }
  /**
   * Convert to JSON string (OpenAI format by default)
   */
  toJSON() {
    return JSON.stringify(this.toOpenAIFormat(), null, 2);
  }
};
function defineTool(name, description, parameters, implementation) {
  if (!name) {
    throw new Error("Tool name is required");
  }
  if (!description) {
    throw new Error("Tool description is required");
  }
  if (!parameters) {
    throw new Error("Tool parameters schema is required");
  }
  if (!implementation) {
    throw new Error("Tool implementation is required");
  }
  return new TACTool(name, description, parameters, implementation);
}

// packages/tools/src/built-in/memory.ts
function createMemoryRetrievalTool(memoryClient, serviceSid, profileId) {
  return defineTool(
    BuiltInTools.RETRIEVE_MEMORY,
    "Retrieve user memories including observations, summaries, and conversation history",
    {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional semantic search query to filter memories"
        },
        start_date: {
          type: "string",
          description: "Optional start date for filtering memories (ISO 8601 format)"
        },
        end_date: {
          type: "string",
          description: "Optional end date for filtering memories (ISO 8601 format)"
        },
        observation_limit: {
          type: "number",
          description: "Maximum number of observations to retrieve (default: 10)"
        },
        summary_limit: {
          type: "number",
          description: "Maximum number of summaries to retrieve (default: 5)"
        },
        session_limit: {
          type: "number",
          description: "Maximum number of sessions to retrieve (default: 3)"
        }
      },
      required: [],
      // No required parameters
      description: "Retrieve memories for the current user"
    },
    async (params) => {
      if (!profileId) {
        throw new Error("No profile ID available for memory retrieval");
      }
      const request = {
        query: params.query,
        start_date: params.start_date,
        end_date: params.end_date,
        observation_limit: params.observation_limit ?? 10,
        summary_limit: params.summary_limit ?? 5,
        session_limit: params.session_limit ?? 3
      };
      return memoryClient.retrieveMemories(serviceSid, profileId, request);
    }
  );
}
function createMemoryTools(memoryClient, serviceSid) {
  return {
    /**
     * Create memory tool for specific profile
     */
    forProfile: (profileId) => createMemoryRetrievalTool(memoryClient, serviceSid, profileId),
    /**
     * Create memory tool for current session
     */
    forSession: (profileId) => createMemoryRetrievalTool(memoryClient, serviceSid, profileId)
  };
}

// packages/tools/src/built-in/messaging.ts
function createSendMessageTool(channel, conversationId) {
  return defineTool(
    BuiltInTools.SEND_MESSAGE,
    "Send a message to the user in the current conversation",
    {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The message content to send to the user"
        },
        metadata: {
          type: "object",
          description: "Optional metadata to include with the message"
        }
      },
      required: ["message"],
      description: "Send a message to the user"
    },
    async (params) => {
      try {
        await channel.sendResponse(conversationId, params.message, params.metadata);
        return {
          success: true,
          message_id: `msg_${Date.now()}`
          // Simple ID generation
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );
}
function createMessagingTools() {
  return {
    /**
     * Create send message tool for specific channel and conversation
     */
    forConversation: (channel, conversationId) => createSendMessageTool(channel, conversationId)
  };
}

// packages/tools/src/built-in/handoff.ts
function createHandoffTool(tac, conversationId) {
  return defineTool(
    BuiltInTools.ESCALATE_TO_HUMAN,
    "Escalate the conversation to a human agent when the AI cannot help further",
    {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "The reason for escalating to a human agent"
        },
        urgency: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "The urgency level of the handoff (default: medium)"
        },
        context: {
          type: "string",
          description: "Additional context to provide to the human agent"
        },
        metadata: {
          type: "object",
          description: "Optional metadata for the handoff"
        }
      },
      required: ["reason"],
      description: "Escalate to human agent"
    },
    async (params) => {
      try {
        let fullReason = params.reason;
        if (params.context) {
          fullReason += `

Additional Context: ${params.context}`;
        }
        if (params.urgency) {
          fullReason += `

Urgency: ${params.urgency}`;
        }
        await tac.triggerHandoff(conversationId, fullReason);
        return {
          success: true,
          handoff_id: `handoff_${Date.now()}`,
          estimated_wait_time: getEstimatedWaitTime(params.urgency ?? "medium")
        };
      } catch (error) {
        return {
          success: false,
          handoff_id: `failed_${Date.now()}`,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );
}
function getEstimatedWaitTime(urgency) {
  switch (urgency) {
    case "high":
      return "< 2 minutes";
    case "medium":
      return "2-5 minutes";
    case "low":
      return "5-10 minutes";
    default:
      return "2-5 minutes";
  }
}
function createHandoffTools() {
  return {
    /**
     * Create handoff tool for specific TAC instance and conversation
     */
    forConversation: (tac, conversationId) => createHandoffTool(tac, conversationId)
  };
}

// packages/tools/src/built-in/knowledge.ts
function createKnowledgeSearchTool(knowledgeClient, knowledgeBaseId, config) {
  const topK = config.topK ?? 5;
  return defineTool(
    config.name,
    config.description,
    {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant knowledge"
        }
      },
      required: ["query"],
      description: config.description
    },
    async (params) => {
      return knowledgeClient.searchKnowledgeBase(knowledgeBaseId, params.query, topK);
    }
  );
}
async function createKnowledgeSearchToolAsync(knowledgeClient, knowledgeBaseId, config) {
  let name = config?.name;
  let description = config?.description;
  if (!name || !description) {
    const kb = await knowledgeClient.getKnowledgeBase(knowledgeBaseId);
    if (!name) {
      const normalized = kb.displayName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
      name = normalized ? `search_${normalized}` : "search_knowledge_base";
    }
    if (!description) {
      description = kb.description || `Search the ${kb.displayName} knowledge base`;
    }
  }
  const toolConfig = {
    name,
    description
  };
  if (config?.topK !== void 0) {
    toolConfig.topK = config.topK;
  }
  return createKnowledgeSearchTool(knowledgeClient, knowledgeBaseId, toolConfig);
}
function createKnowledgeTools(knowledgeClient) {
  return {
    /**
     * Create knowledge search tool with explicit config
     */
    forKnowledgeBase: (knowledgeBaseId, config) => createKnowledgeSearchTool(knowledgeClient, knowledgeBaseId, config),
    /**
     * Create knowledge search tool with auto-fetched metadata
     */
    forKnowledgeBaseAsync: (knowledgeBaseId, config) => createKnowledgeSearchToolAsync(knowledgeClient, knowledgeBaseId, config)
  };
}
var DEFAULT_CONFIG = {
  voice: {
    host: "0.0.0.0",
    port: 3e3
  },
  webhookPaths: {
    twiml: "/twiml",
    ws: "/ws",
    conversation: "/conversation",
    conversationRelayCallback: "/conversation-relay-callback"
  },
  conversationRelayConfig: {
    welcomeGreeting: "Hello! How can I assist you today?"
  },
  development: false,
  validateWebhooks: true
};
var TACServer = class {
  fastify;
  tac;
  config;
  constructor(tac, config = {}) {
    this.tac = tac;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      // Deep merge webhookPaths to preserve defaults while allowing overrides
      webhookPaths: {
        ...DEFAULT_CONFIG.webhookPaths,
        ...config.webhookPaths
      },
      // Deep merge conversationRelayConfig to preserve defaults while allowing overrides
      conversationRelayConfig: {
        ...DEFAULT_CONFIG.conversationRelayConfig,
        ...config.conversationRelayConfig
      }
    };
    this.fastify = Fastify({
      logger: this.config.development ? {
        level: process.env.LOG_LEVEL || "info",
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true
          }
        }
      } : {
        level: process.env.LOG_LEVEL || "info"
      },
      ...config.fastify
    });
  }
  /**
   * Get the full URL for webhook validation
   * Handles X-Forwarded-* headers for proxy/ngrok scenarios
   */
  getWebhookUrl(request) {
    const proto = request.headers["x-forwarded-proto"] || "https";
    const host = request.headers["x-forwarded-host"] || request.headers.host || "";
    return `${proto}://${host}${request.url}`;
  }
  /**
   * Register global Twilio webhook signature validation hook
   */
  registerWebhookValidation() {
    if (!this.config.validateWebhooks) {
      return;
    }
    this.fastify.addHook("preHandler", (request, reply, done) => {
      if (request.method === "GET") {
        done();
        return;
      }
      const signature = request.headers["x-twilio-signature"];
      const url = this.getWebhookUrl(request);
      const authToken = this.tac.getConfig().twilioAuthToken;
      let isValid;
      if (request.url.includes("bodySHA256=")) {
        const body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
        isValid = twilio.validateRequestWithBody(authToken, signature, url, body);
      } else {
        const params = request.body || {};
        isValid = twilio.validateRequest(authToken, signature, url, params);
      }
      if (!isValid) {
        this.fastify.log.warn(
          { url, hasSignature: !!signature },
          "Invalid Twilio webhook signature"
        );
        void reply.code(403).send({ error: "Invalid webhook signature" });
        done();
        return;
      }
      done();
    });
  }
  /**
   * Extract channel string from webhook payload data
   * Checks author.channel first (COMMUNICATION events),
   * then addresses[0].channel (PARTICIPANT events)
   */
  extractChannelFromWebhook(webhookData) {
    if ("author" in webhookData && webhookData.author?.channel) {
      return webhookData.author.channel.toLowerCase();
    }
    if ("addresses" in webhookData && Array.isArray(webhookData.addresses)) {
      const addresses = webhookData.addresses;
      if (addresses.length > 0 && addresses[0]?.channel) {
        return addresses[0].channel.toLowerCase();
      }
    }
    return void 0;
  }
  /**
   * Setup routes
   */
  async setupRoutes() {
    this.fastify.post(
      this.config.webhookPaths.conversation || "/conversation",
      async (request, reply) => {
        try {
          const parseResult = ConversationsWebhookPayloadSchema.safeParse(request.body);
          if (!parseResult.success) {
            this.fastify.log.error(
              { errors: parseResult.error.errors },
              "Invalid Conversations webhook payload"
            );
            await reply.code(400).send({ error: "Invalid webhook payload" });
            return;
          }
          const payload = parseResult.data;
          const webhookData = payload.data;
          const author = "author" in webhookData ? webhookData.author : void 0;
          const channelString = this.extractChannelFromWebhook(webhookData);
          if (channelString && !author?.channel && "addresses" in webhookData) {
            this.fastify.log.debug(
              {
                event_type: payload.eventType,
                addresses_count: Array.isArray(webhookData.addresses) ? webhookData.addresses.length : 0,
                extracted_channel: channelString
              },
              "Extracted channel from participant addresses"
            );
          }
          if (!channelString) {
            const eventType2 = payload.eventType;
            const conversationId2 = webhookData.conversationId;
            if (eventType2 === "CONVERSATION_UPDATED" || eventType2 === "CONVERSATION_CREATED") {
              const channels = this.tac.getChannels();
              let targetChannel2;
              for (const channel of channels) {
                if (channel.isConversationActive(conversationId2)) {
                  targetChannel2 = channel;
                  break;
                }
              }
              if (targetChannel2) {
                this.fastify.log.info(
                  {
                    event_type: eventType2,
                    conversation_id: conversationId2,
                    channel: targetChannel2.channelType
                  },
                  `\u2192 Routing lifecycle event ${eventType2} to ${targetChannel2.channelType} channel`
                );
                await targetChannel2.processWebhook(payload);
                await reply.code(200).send({ status: "ok" });
                return;
              } else {
                this.fastify.log.info(
                  {
                    event_type: eventType2,
                    conversation_id: conversationId2
                  },
                  `\u2713 Lifecycle event ${eventType2} acknowledged (conversation not yet in channel)`
                );
                await reply.code(200).send({ status: "ok" });
                return;
              }
            }
            this.fastify.log.info(
              {
                event_type: eventType2,
                conversation_id: conversationId2
              },
              `\u2713 Skipped ${eventType2} event (no channel info)`
            );
            await reply.code(200).send({ status: "ok" });
            return;
          }
          const isValidChannel = (ch) => {
            return ch === "sms" || ch === "voice";
          };
          if (!isValidChannel(channelString)) {
            this.fastify.log.warn({ channel: channelString }, "Unknown channel type in webhook");
            await reply.code(400).send({ error: "Unknown channel type" });
            return;
          }
          const targetChannel = this.tac.getChannel(channelString);
          if (!targetChannel) {
            this.fastify.log.error({ channel: channelString }, "Channel not registered");
            await reply.code(500).send({ error: "Channel not available" });
            return;
          }
          const eventType = payload.eventType;
          const conversationId = webhookData.conversationId || webhookData.id;
          this.fastify.log.info(
            {
              event_type: eventType,
              conversation_id: conversationId,
              channel: channelString
            },
            `\u2192 Routing ${eventType} to ${channelString} channel`
          );
          await targetChannel.processWebhook(payload);
          await reply.code(200).send({ status: "ok" });
        } catch (error) {
          this.fastify.log.error(
            "Conversations webhook error: " + (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    );
    this.fastify.post(
      this.config.webhookPaths.twiml || "/twiml",
      async (request, reply) => {
        try {
          const formData = request.body;
          const fromNumber = formData["From"] || "";
          const toNumber = formData["To"] || "";
          const callSid = formData["CallSid"] || "";
          const voiceChannel = this.tac.getChannel("voice");
          if (!voiceChannel) {
            await reply.code(500).send({ error: "Voice channel not available" });
            return;
          }
          const protocol = request.headers["x-forwarded-proto"] || "http";
          const host = request.headers.host;
          const websocketUrl = `${protocol === "https" ? "wss" : "ws"}://${host}${this.config.webhookPaths.ws || "/ws"}`;
          const callbackUrl = `${protocol}://${host}${this.config.webhookPaths.conversationRelayCallback || "/conversation-relay-callback"}`;
          const twiml = await voiceChannel.handleIncomingCall({
            toNumber,
            fromNumber,
            callSid,
            actionUrl: callbackUrl,
            conversationRelayConfig: {
              url: websocketUrl,
              ...this.config.conversationRelayConfig
            }
          });
          await reply.type("application/xml").send(twiml);
        } catch (error) {
          this.fastify.log.error(
            "TwiML generation error: " + (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    );
    this.fastify.post(
      this.config.webhookPaths.conversationRelayCallback || "/conversation-relay-callback",
      async (request, reply) => {
        try {
          const voiceChannel = this.tac.getChannel("voice");
          if (!voiceChannel) {
            await reply.code(500).send({ error: "Voice channel not available" });
            return;
          }
          const formData = request.body;
          const parseResult = ConversationRelayCallbackPayloadSchema.safeParse(formData);
          if (!parseResult.success) {
            this.fastify.log.error(
              { errors: parseResult.error.errors },
              "Invalid ConversationRelay callback payload"
            );
            await reply.code(400).send({ error: "Invalid payload" });
            return;
          }
          const result = await voiceChannel.handleConversationRelayCallback(
            parseResult.data,
            this.config.handoffHandler
          );
          await reply.code(result.status).type(result.contentType).send(result.content);
        } catch (error) {
          this.fastify.log.error(
            "ConversationRelay callback error: " + (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({ error: "Internal server error" });
        }
      }
    );
    await this.fastify.register((fastify) => {
      fastify.get(
        this.config.webhookPaths.ws || "/ws",
        { websocket: true },
        (socket) => {
          const voiceChannel = this.tac.getChannel("voice");
          if (!voiceChannel) {
            socket.terminate();
            return;
          }
          voiceChannel.handleWebSocketConnection(socket);
        }
      );
    });
    if (this.config.webhookPaths.cintel) {
      this.fastify.post(
        this.config.webhookPaths.cintel,
        async (request, reply) => {
          if (!this.tac.isCintelEnabled()) {
            await reply.code(400).send({
              error: "Conversation Intelligence is not enabled",
              message: "Set TWILIO_TAC_CI_CONFIGURATION_ID and memory credentials to enable CI processing"
            });
            return;
          }
          try {
            this.fastify.log.info("Processing Conversation Intelligence webhook");
            const result = await this.tac.processCintelEvent(request.body);
            if (result.success) {
              if (result.skipped) {
                this.fastify.log.debug({ reason: result.skipReason }, "CI event skipped");
              } else {
                this.fastify.log.info(
                  { eventType: result.eventType, createdCount: result.createdCount },
                  "CI event processed"
                );
              }
            } else {
              this.fastify.log.error({ error: result.error }, "CI event processing failed");
            }
            await reply.send(result);
          } catch (error) {
            this.fastify.log.error(
              "CI webhook error: " + (error instanceof Error ? error.message : String(error))
            );
            await reply.code(500).send({
              success: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  }
  /**
   * Start the server
   */
  async start() {
    try {
      await this.fastify.register(formbody);
      await this.fastify.register(websocket);
      await this.fastify.register(gracefulShutdown);
      this.registerWebhookValidation();
      await this.setupRoutes();
      this.fastify.gracefulShutdown(async (signal) => {
        this.fastify.log.info({ signal }, "Received shutdown signal");
        await this.waitForWebSocketsToClose();
        await this.tac.shutdown();
      });
      const voiceConfig = VoiceServerConfigSchema.parse(this.config.voice);
      await this.fastify.listen({
        host: voiceConfig.host,
        port: voiceConfig.port
      });
      this.fastify.log.info(
        {
          host: voiceConfig.host,
          port: voiceConfig.port,
          twiml_webhook: this.config.webhookPaths.twiml,
          ws_websocket: this.config.webhookPaths.ws,
          conversation_webhook: this.config.webhookPaths.conversation,
          conversation_relay_callback: this.config.webhookPaths.conversationRelayCallback,
          ...this.config.webhookPaths.cintel && {
            cintel_webhook: this.config.webhookPaths.cintel
          },
          webhook_validation: this.config.validateWebhooks ? "enabled" : "disabled"
        },
        "TAC Server started"
      );
      if (!this.config.validateWebhooks) {
        this.fastify.log.warn(
          "Webhook signature validation is DISABLED. Enable in production for security."
        );
      }
    } catch (error) {
      this.fastify.log.error({ err: error }, "Failed to start TAC Server");
      throw error;
    }
  }
  /**
   * Wait for all WebSocket connections to close
   */
  async waitForWebSocketsToClose(timeoutMs = 3e4) {
    const wsServer = this.fastify.websocketServer;
    if (!wsServer || wsServer.clients.size === 0) {
      return;
    }
    this.fastify.log.info(
      { websocket_count: wsServer.clients.size },
      "Waiting for WebSocket connections to close..."
    );
    const startTime = Date.now();
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const clientCount = wsServer.clients.size;
        if (clientCount === 0) {
          clearInterval(checkInterval);
          this.fastify.log.info("All WebSocket connections closed");
          resolve();
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(checkInterval);
          this.fastify.log.warn(
            { remaining_websockets: clientCount },
            "Timeout waiting for WebSockets to close, proceeding with shutdown"
          );
          resolve();
          return;
        }
        this.fastify.log.info(
          { remaining_websockets: clientCount },
          "Waiting for WebSockets to close..."
        );
      }, 5e3);
    });
  }
  /**
   * Stop the server gracefully
   */
  async stop() {
    try {
      await this.fastify.close();
      this.fastify.log.info("TAC Server stopped");
    } catch (error) {
      this.fastify.log.error({ err: error }, "Error stopping TAC Server");
      throw error;
    }
  }
};

export { AuthorInfoSchema, BaseChannel, BuiltInTools, ChannelTypeSchema, CintelParticipantSchema, CommunicationContentSchema, CommunicationParticipantSchema, CommunicationSchema, CommunicationWebhookPayloadSchema, ConversationAddressSchema, ConversationClient, ConversationIntelligenceConfigSchema, ConversationParticipantSchema, ConversationRelayAttributesSchema, ConversationRelayCallbackPayloadSchema, ConversationRelayConfigSchema, ConversationResponseSchema, ConversationSessionSchema, ConversationSummaryItemSchema, ConversationWebhookPayloadSchema, ConversationsCommunicationDataSchema, ConversationsConversationDataSchema, ConversationsParticipantDataSchema, ConversationsWebhookPayloadSchema, CreateConversationSummariesResponseSchema, CreateObservationResponseSchema, CustomParametersSchema, EMPTY_MEMORY_RESPONSE, EnvironmentSchema, EnvironmentVariables, ExecutionDetailsSchema, HandoffDataSchema, IntelligenceConfigurationSchema, InterruptMessageSchema, JSONSchemaSchema, KnowledgeBaseSchema, KnowledgeBaseStatusSchema, KnowledgeChunkResultSchema, KnowledgeClient, KnowledgeSearchResponseSchema, LanguageAttributesSchema, MemoraProfileService, MemoryChannelTypeSchema, MemoryClient, MemoryCommunicationContentSchema, MemoryCommunicationSchema, MemoryDeliveryStatusSchema, MemoryParticipantSchema, MemoryParticipantTypeSchema, MemoryRetrievalRequestSchema, MemoryRetrievalResponseSchema, MessageDirectionSchema, ObservationInfoSchema, OpenAIToolSchema, OperatorProcessingResultSchema, OperatorResultEventSchema, OperatorResultProcessor, OperatorResultSchema, OperatorSchema, ParticipantAddressSchema, ParticipantAddressTypeSchema, ParticipantWebhookPayloadSchema, ProfileLookupResponseSchema, ProfileResponseSchema, ProfileSchema, ProfileServiceProviderSchema, PromptMessageSchema, SMSChannel, SegmentProfileService, SessionInfoSchema, SessionMessageSchema, SetupMessageSchema, SummaryInfoSchema, TAC, TACChannelTypeSchema, TACCommunicationAuthorSchema, TACCommunicationContentSchema, TACCommunicationSchema, TACConfig, TACConfigSchema, TACDeliveryStatusSchema, TACMemoryResponse, TACParticipantTypeSchema, TACServer, TACTool, TextTokenMessageSchema, ToolExecutionResultSchema, TranscriptionSchema, TranscriptionWordSchema, VoiceChannel, VoiceServerConfigSchema, WebSocketMessageSchema, WebhookPathsSchema, computeServiceUrls, createHandoffTool, createHandoffTools, createKnowledgeSearchTool, createKnowledgeSearchToolAsync, createKnowledgeTools, createLogger, createMemoryRetrievalTool, createMemoryTools, createMessagingTools, createSendMessageTool, defineTool, handleFlexHandoffLogic, isConversationId, isParticipantId, isProfileId };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map